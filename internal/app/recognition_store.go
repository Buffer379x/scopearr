package app

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"runtime/debug"
	"slices"
	"strconv"
	"strings"
)

var ErrRecognitionRevision = errors.New("Recognition rules changed in another session. Reload before saving.")

// Status polling only needs the committed immutable revision, without waiting
// for a running cache rewrite to release recognitionMu.
func (s *Store) RecognitionRevision() string {
	return s.recognition.Load().config.Revision
}

func (s *Store) Recognition() RecognitionConfig {
	s.recognitionMu.Lock()
	defer s.recognitionMu.Unlock()
	return s.recognition.Load().Config()
}

// Pin the database snapshot while its matching immutable rules are protected.
// Release the recognition lock before doing the expensive catalog queries.
func (s *Store) beginRecognitionRead(ctx context.Context) (*sql.Tx, []RecognitionRule, error) {
	s.recognitionMu.Lock()
	defer s.recognitionMu.Unlock()
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, nil, err
	}
	var entries int
	if err = tx.QueryRowContext(ctx, "SELECT count(*) FROM kv").Scan(&entries); err != nil {
		tx.Rollback()
		return nil, nil, err
	}
	return tx, s.recognition.Load().Config().Rules, nil
}
func reparseFile(f *File, engine *RecognitionEngine) {
	f.comparisonEngine = engine
	if f.RecognitionRevision == engine.config.Revision {
		return
	}
	api := APIInfo{}
	if f.APIInfo != nil {
		api = *f.APIInfo
	} else {
		old := func(field, fallback string) string {
			if e, ok := f.Evidence[field]; ok {
				return e.API
			}
			return fallback
		}
		api.Resolution = old("resolution", f.Resolution)
		api.VideoCodec = old("codec", f.Codec)
		api.Quality = old("source", f.Source) + " " + old("processing", f.Processing)
		api.VideoBitDepth, _ = strconv.Atoi(old("bitDepth", f.BitDepth))
		api.VideoDynamicRangeType = old("hdr", f.HDR)
		api.AudioCodec = old("audio", f.Audio)
		api.AudioChannels, _ = strconv.ParseFloat(old("channels", f.Channels), 64)
		api.AudioLanguages = old("language", f.Language)
		api.AudioStreamCount = f.AudioStreamCount
	}
	// Resolving cached media metadata already enriches from API and filename
	// rules. Doing that first here would run every recognition rule twice.
	if f.MediaServers.count() > 0 {
		f.APIInfo = &api
		resolveMediaServers(f)
		return
	}
	embyHDR := f.Evidence["hdr"].Emby
	EnrichWithRules(f, api, engine)
	if embyHDR != "" {
		f.HDR = mergeHDR(f.HDR, embyHDR)
		e := f.Evidence["hdr"]
		e.Emby = embyHDR
		e.Origin = "combined"
		f.Evidence["hdr"] = e
	}
	if f.EmbyMatch == "matched" && len(f.AudioTracks) > 0 {
		streams := []embyStream{}
		for _, track := range f.AudioTracks {
			streams = append(streams, embyStream{Type: "Audio", Index: track.Index, Language: track.Language, Codec: track.Codec, Channels: track.Channels, ChannelLayout: track.ChannelLayout, Title: track.Title, IsDefault: track.Default})
		}
		applyEmby(f, streams)
	}
	updateCompleteness(f)
}
func (s *Store) SaveRecognition(ctx context.Context, rules []RecognitionRule, revision string) (RecognitionConfig, error) {
	engine, err := CompileRecognition(rules)
	if err != nil {
		return RecognitionConfig{}, err
	}
	s.recognitionMu.Lock()
	defer s.recognitionMu.Unlock()
	if err = s.validateCustomRules(ctx, rules); err != nil {
		return RecognitionConfig{}, err
	}
	if revision != s.recognition.Load().config.Revision {
		return RecognitionConfig{}, ErrRecognitionRevision
	}
	if engine.config.Revision == revision {
		return engine.Config(), nil
	}
	restoreMemory := recognitionMemoryBudget()
	defer restoreMemory()
	// Large syncs may leave reclaimable heap pages behind. Release them before
	// SQLite's backup and reprocessing allocations, outside the request hot path.
	debug.FreeOSMemory()
	if err = s.BackupContext(ctx); err != nil {
		return RecognitionConfig{}, err
	}
	debug.FreeOSMemory()
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return RecognitionConfig{}, err
	}
	defer tx.Rollback()
	if err = rememberTagRules(ctx, tx, s.recognition.Load().config.Rules); err != nil {
		return RecognitionConfig{}, err
	}
	if err = rememberTagRules(ctx, tx, rules); err != nil {
		return RecognitionConfig{}, err
	}
	if err = reparseCached(ctx, tx, engine); err != nil {
		return RecognitionConfig{}, err
	}
	if err = rememberDisplayTags(ctx, tx, engine.config.Rules); err != nil {
		return RecognitionConfig{}, err
	}
	data, _ := json.Marshal(engine.Config())
	if _, err = tx.ExecContext(ctx, "INSERT INTO kv(key,value) VALUES('recognition',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", string(data)); err != nil {
		return RecognitionConfig{}, err
	}
	if err = tx.Commit(); err != nil {
		return RecognitionConfig{}, err
	}
	s.recognition.Store(engine)
	s.invalidateAggregates()
	return engine.Config(), nil
}

// Bulk cache work shares one process-level budget under the recognition mutex.
// Nested calls respect an already smaller target; the outer caller restores it.
func recognitionMemoryBudget() func() {
	previous := debug.SetMemoryLimit(-1)
	if previous <= 24<<20 {
		return func() {}
	}
	debug.SetMemoryLimit(24 << 20)
	return func() { debug.FreeOSMemory(); debug.SetMemoryLimit(previous) }
}

func reparseCached(ctx context.Context, tx *sql.Tx, engine *RecognitionEngine) error {
	_, err := reparseCachedMode(ctx, tx, engine, false)
	return err
}

// Derived metadata can change without changing the user's recognition revision.
func reparseCachedForced(ctx context.Context, tx *sql.Tx, engine *RecognitionEngine) (int, error) {
	return reparseCachedMode(ctx, tx, engine, true)
}

func reparseCachedMode(ctx context.Context, tx *sql.Tx, engine *RecognitionEngine, force bool) (int, error) {
	changed := 0
	restoreMemory := recognitionMemoryBudget()
	defer restoreMemory()
	update, err := tx.PrepareContext(ctx, "UPDATE files SET resolution=?,codec=?,family=?,source=?,processing=?,hdr=?,bitDepth=?,audio=?,channels=?,language=?,conflict=?,rule_conflict=?,emby_match=?,data=? WHERE rowid=?")
	if err != nil {
		return changed, err
	}
	defer update.Close()
	var last int64
	for {
		rows, err := tx.QueryContext(ctx, "SELECT rowid,data FROM files WHERE rowid>? ORDER BY rowid LIMIT 250", last)
		if err != nil {
			return changed, err
		}
		type entry struct {
			id   int64
			file File
			raw  string
		}
		batch := []entry{}
		for rows.Next() {
			var id int64
			var raw string
			if err = rows.Scan(&id, &raw); err != nil {
				rows.Close()
				return changed, err
			}
			var f File
			if err = json.Unmarshal([]byte(raw), &f); err != nil {
				rows.Close()
				return changed, err
			}
			batch = append(batch, entry{id, f, raw})
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return changed, err
		}
		if len(batch) == 0 {
			return changed, rebuildSeasonAnalysis(ctx, tx, nil)
		}
		for _, item := range batch {
			oldCustom := item.file.RecognizedCustom
			oldLanguage := item.file.Language
			oldUnknownLanguage := slices.Contains(item.file.UnknownTraits, "language")
			if force {
				item.file.RecognitionRevision = ""
			}
			reparseFile(&item.file, engine)
			f := item.file
			data, err := json.Marshal(f)
			if err != nil {
				return changed, err
			}
			last = item.id
			if bytes.Equal(data, []byte(item.raw)) {
				continue
			}
			if _, err = update.ExecContext(ctx, f.Resolution, f.Codec, f.Family, f.Source, f.Processing, f.HDR, f.BitDepth, f.Audio, f.Channels, f.Language, f.Conflict, f.RuleConflict, f.EmbyMatch, string(data), item.id); err != nil {
				return changed, err
			}
			changed++
			// Source/codec rules commonly leave verified audio languages unchanged.
			// Avoid rebuilding those indexed associations for every cached file.
			if oldLanguage != f.Language || oldUnknownLanguage != slices.Contains(f.UnknownTraits, "language") {
				if err = replaceFileLanguages(ctx, tx, item.id, f); err != nil {
					return changed, err
				}
			}
			if !slices.Equal(oldCustom, f.RecognizedCustom) {
				if err = replaceFileCustom(ctx, tx, item.id, f, false); err != nil {
					return changed, err
				}
			}
		}
	}
}
func replaceFileLanguages(ctx context.Context, tx *sql.Tx, id int64, f File) error {
	if _, err := tx.ExecContext(ctx, "DELETE FROM file_languages WHERE file_rowid=?", id); err != nil {
		return err
	}
	languages := splitLanguages(f.Language)
	for _, trait := range f.UnknownTraits {
		if trait == "language" {
			languages = append(languages, "")
		}
	}
	for _, language := range languages {
		if _, err := tx.ExecContext(ctx, "INSERT OR IGNORE INTO file_languages(file_rowid,language) VALUES(?,?)", id, language); err != nil {
			return err
		}
	}
	return nil
}
func splitLanguages(value string) []string {
	if value == "" {
		return []string{""}
	}
	return strings.Split(normLanguage(value), ", ")
}
