package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	_ "modernc.org/sqlite"
)

type Store struct {
	demo bool
	// Events is the 24-hour system event log shared by every manager.
	Events          *EventLog
	presetMu        sync.Mutex
	recognitionMu   sync.Mutex
	recognition     atomic.Pointer[RecognitionEngine]
	DB              *sql.DB
	Dir             string
	cacheMu         sync.Mutex
	facetCache      map[string]map[string][]string
	statisticsCache *Statistics
	cacheGeneration uint64
	facetLoad       [2]sync.Mutex
	statisticsLoad  sync.Mutex
	catalogLoad     sync.Mutex
	catalogCache    []CatalogTag
}

func (s *Store) Backup() error {
	return s.BackupContext(context.Background())
}

func (s *Store) BackupContext(ctx context.Context) error {
	if err := os.MkdirAll(filepath.Join(s.Dir, "backups"), 0700); err != nil {
		return err
	}
	p := filepath.Join(s.Dir, "backups", time.Now().UTC().Format("20060102T150405.000000000")+".db")
	if _, err := s.DB.ExecContext(ctx, "VACUUM INTO ?", p); err != nil {
		return err
	}
	os.Chmod(p, 0600)
	fs, _ := filepath.Glob(filepath.Join(s.Dir, "backups", "*.db"))
	sort.Strings(fs)
	if len(fs) > 3 {
		for _, f := range fs[:len(fs)-3] {
			if err := os.Remove(f); err != nil {
				return err
			}
		}
	}
	return nil
}
func (s *Store) Get(key string, v any) error {
	var raw string
	if err := s.DB.QueryRow("SELECT value FROM kv WHERE key=?", key).Scan(&raw); err != nil {
		return err
	}
	return json.Unmarshal([]byte(raw), v)
}
func (s *Store) Put(key string, v any) error {
	if key == "settings" {
		switch cfg := v.(type) {
		case Settings:
			v = settingsForStorage(cfg)
		case *Settings:
			if cfg != nil {
				v = settingsForStorage(*cfg)
			}
		}
	}
	b, e := json.Marshal(v)
	if e != nil {
		return e
	}
	_, e = s.DB.Exec("INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, string(b))
	return e
}
func (s *Store) Replace(service string, files []File, status SyncStatus) error {
	return s.replaceContext(context.Background(), service, files, status, false, nil, nil)
}

func (s *Store) replaceContext(ctx context.Context, service string, files []File, status SyncStatus, consume bool, scope *DeltaScope, commit func(*sql.Tx) error) error {
	if consume {
		defer clear(files)
	}
	s.recognitionMu.Lock()
	defer s.recognitionMu.Unlock()
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	customActive := false
	for _, rule := range s.recognition.Load().config.Rules {
		if rule.Enabled && rule.Field == "custom" {
			customActive = true
			break
		}
	}
	if !customActive {
		if e = tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM custom_overrides WHERE service=?) OR EXISTS(SELECT 1 FROM external_tag_bindings WHERE service=? AND present=1 AND imported=1)", service, service).Scan(&customActive); e != nil {
			return e
		}
	}
	measurements, e := loadMediaInfo(ctx, tx, service)
	if e != nil {
		return e
	}
	confirmations, e := loadFieldConfirmations(ctx, tx, service)
	if e != nil {
		return e
	}
	if _, e = deleteScopedFiles(ctx, tx, service, scope); e != nil {
		return e
	}
	st, e := tx.PrepareContext(ctx, "INSERT INTO files(service,id,media_id,season,title,filename,resolution,codec,family,source,processing,hdr,bitDepth,audio,channels,language,size,conflict,data,series,episode_sort,rule_conflict,emby_match,source_path) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
	if e != nil {
		return e
	}
	defer st.Close()
	for index, f := range files {
		if consume {
			files[index] = File{}
		}
		if f.APIInfo != nil || len(f.Evidence) > 0 || s.recognition.Load().config.Revision != defaultRecognitionEngine.config.Revision || len(confirmations[f.ID]) > 0 || measurements[f.ID].Path != "" {
			measured, ok := measurements[f.ID]
			var value *savedMediaInfo
			if ok {
				value = &measured
			}
			resolveSavedMetadata(&f, s.recognition.Load(), confirmations[f.ID], value)
		}
		updateCompleteness(&f)
		f.Service = service
		f.Type = serviceKind(service)
		f.Matched = true
		b, e := json.Marshal(f)
		if e != nil {
			return e
		}
		episodeSort := 0
		if len(f.Episodes) > 0 {
			episodeSort = f.Episodes[0].Number
		}
		r, e := st.ExecContext(ctx, service, f.ID, f.MediaID, f.Season, f.Title, f.Filename, f.Resolution, f.Codec, f.Family, f.Source, f.Processing, f.HDR, f.BitDepth, f.Audio, f.Channels, f.Language, f.Size, f.Conflict, string(b), f.Series, episodeSort, f.RuleConflict, f.EmbyMatch, f.SourcePath)
		if e != nil {
			return e
		}
		id, _ := r.LastInsertId()
		if customActive {
			if e = replaceFileCustom(ctx, tx, id, f, true); e != nil {
				return e
			}
		}
		if e = replaceFileLanguages(ctx, tx, id, f); e != nil {
			return e
		}
		if _, e = tx.ExecContext(ctx, "INSERT INTO search(rowid,title,filename) VALUES(?,?,?)", id, f.Series+" "+f.Title, f.Filename); e != nil {
			return e
		}
		for _, year := range f.Years {
			if _, e = tx.ExecContext(ctx, "INSERT OR IGNORE INTO years(file_rowid,year) VALUES(?,?)", id, year); e != nil {
				return e
			}
		}
	}
	if _, e = tx.ExecContext(ctx, "DELETE FROM custom_overrides WHERE service=? AND NOT EXISTS(SELECT 1 FROM files f WHERE f.service=custom_overrides.service AND f.id=custom_overrides.file_id)", service); e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, "DELETE FROM field_confirmations WHERE service=? AND NOT EXISTS(SELECT 1 FROM files f WHERE f.service=field_confirmations.service AND f.id=field_confirmations.file_id AND f.size=field_confirmations.size)", service); e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, "DELETE FROM mediainfo_results WHERE service=? AND NOT EXISTS(SELECT 1 FROM files f WHERE f.service=mediainfo_results.service AND f.id=mediainfo_results.file_id AND f.size=mediainfo_results.size AND f.source_path=mediainfo_results.arr_path)", service); e != nil {
		return e
	}
	if serviceKind(service) == "sonarr" {
		var affected *int
		if scope != nil {
			affected = &scope.MediaID
		}
		if e = rebuildSeasonAnalysis(ctx, tx, affected, service); e != nil {
			return e
		}
	}
	if e = rememberDisplayTags(ctx, tx, s.recognition.Load().config.Rules); e != nil {
		return e
	}
	if scope == nil {
		b, _ := json.Marshal(status)
		if _, e = tx.ExecContext(ctx, "INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", "sync:"+service, string(b)); e != nil {
			return e
		}
	}
	if _, e = tx.ExecContext(ctx, "INSERT INTO kv(key,value) VALUES('cacheRevision',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", strconv.Quote(fmt.Sprintf("%d", time.Now().UnixNano()))); e != nil {
		return e
	}
	if commit == nil {
		commit = func(tx *sql.Tx) error { return tx.Commit() }
	}
	if e = commit(tx); e != nil {
		return e
	}
	s.invalidateAggregates()
	return nil
}

func (s *Store) invalidateAggregates() {
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	s.facetCache = map[string]map[string][]string{}
	s.statisticsCache = nil
	s.catalogCache = nil
	s.cacheGeneration++
}

func (s *Store) Presets() ([]Preset, error) {
	out := []Preset{}
	rows, e := s.DB.Query("SELECT id,name,service,query FROM presets ORDER BY name COLLATE NOCASE")
	if e != nil {
		return out, e
	}
	defer rows.Close()
	for rows.Next() {
		var p Preset
		if e = rows.Scan(&p.ID, &p.Name, &p.Service, &p.Query); e != nil {
			return out, e
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// SQL expressions and direction come exclusively from this allowlist.
