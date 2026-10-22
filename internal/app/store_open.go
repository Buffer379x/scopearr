package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

func OpenStore(dir string) (*Store, error) {
	if dir == "" {
		return nil, errors.New("Data directory is required")
	}
	dir, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	// Never silently initialize an empty account over an existing differently
	// named database. Current deployments use scopearr.db.
	if _, e := os.Stat(filepath.Join(dir, "scopearr.db")); os.IsNotExist(e) {
		// Older unescaped DSNs could place this database outside a directory
		// containing '?'. Its local key must not accompany a new empty account.
		if strings.Contains(dir, "?") {
			if _, keyErr := os.Stat(filepath.Join(dir, "secret.key")); keyErr == nil {
				return nil, fmt.Errorf("Existing database found. Restore the active database as scopearr.db before starting")
			} else if !os.IsNotExist(keyErr) {
				return nil, keyErr
			}
		}
		entries, err := os.ReadDir(dir)
		if err != nil {
			return nil, err
		}
		for _, entry := range entries {
			if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".db") {
				return nil, fmt.Errorf("Existing database found. Restore the active database as scopearr.db before starting")
			}
		}
	}
	dbPath := filepath.Join(dir, "scopearr.db")
	file, err := os.OpenFile(dbPath, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	err = file.Chmod(0600)
	closeErr := file.Close()
	if err != nil {
		return nil, err
	}
	if closeErr != nil {
		return nil, closeErr
	}
	dsn := url.URL{Scheme: "file", Path: dbPath, RawQuery: "_txlock=immediate&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=soft_heap_limit(16777216)&_pragma=cache_size(-1024)&_pragma=temp_store(FILE)"}
	db, err := sql.Open("sqlite", dsn.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(4)
	s := &Store{DB: db, Dir: dir, facetCache: map[string]map[string][]string{}}
	s.recognition.Store(defaultRecognitionEngine)
	fail := func(e error) (*Store, error) { db.Close(); return nil, e }
	if _, err = db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		return fail(err)
	}
	var version int
	if err = db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return fail(err)
	}
	originalVersion := version
	if version > 17 {
		return fail(fmt.Errorf("Datenbankversion %d ist neuer als diese App; passende Sicherung wiederherstellen", version))
	}
	var hasConfig bool
	if err = db.QueryRow("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='kv')").Scan(&hasConfig); err != nil {
		return fail(err)
	}
	if hasConfig {
		// Validate existing JSON before any historical migration can mistake a
		// failed read for an absent entry and persist replacement defaults.
		for key, destination := range map[string]any{"settings": &Settings{}, "recognition": &RecognitionConfig{}} {
			if err = s.Get(key, destination); err != nil && !errors.Is(err, sql.ErrNoRows) {
				return fail(fmt.Errorf("Could not load %s: %w", key, err))
			}
		}
	}
	if version < 1 {
		var tables int
		if err = db.QueryRow("SELECT count(*) FROM sqlite_master WHERE type='table'").Scan(&tables); err != nil {
			return fail(err)
		}
		if tables > 0 {
			if err = s.Backup(); err != nil {
				return fail(err)
			}
		}
		_, err = db.Exec(`BEGIN;
CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS files(rowid INTEGER PRIMARY KEY,service TEXT NOT NULL,id INTEGER NOT NULL,media_id INTEGER NOT NULL,season INTEGER NOT NULL,title TEXT NOT NULL,filename TEXT NOT NULL,resolution TEXT NOT NULL,codec TEXT NOT NULL,family TEXT NOT NULL,source TEXT NOT NULL,processing TEXT NOT NULL,hdr TEXT NOT NULL,bitDepth TEXT NOT NULL,audio TEXT NOT NULL,channels TEXT NOT NULL,language TEXT NOT NULL,size INTEGER NOT NULL,conflict INTEGER NOT NULL,data TEXT NOT NULL,UNIQUE(service,id));
CREATE INDEX IF NOT EXISTS files_service ON files(service,title,id);
CREATE INDEX IF NOT EXISTS files_group ON files(service,media_id,season);
CREATE INDEX IF NOT EXISTS files_filter ON files(service,resolution,codec,source);
CREATE INDEX IF NOT EXISTS files_family ON files(service,family);
CREATE INDEX IF NOT EXISTS files_size ON files(service,size);
CREATE TABLE IF NOT EXISTS years(file_rowid INTEGER REFERENCES files(rowid) ON DELETE CASCADE,year INTEGER NOT NULL,PRIMARY KEY(file_rowid,year));
CREATE INDEX IF NOT EXISTS years_value ON years(year,file_rowid);
CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(title,filename, tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER IF NOT EXISTS files_delete AFTER DELETE ON files BEGIN DELETE FROM search WHERE rowid=old.rowid; END;
CREATE TABLE IF NOT EXISTS presets(id INTEGER PRIMARY KEY,name TEXT NOT NULL,service TEXT NOT NULL,query TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,csrf TEXT NOT NULL,expires INTEGER NOT NULL);
PRAGMA user_version=1;COMMIT;`)
		if err != nil {
			return fail(err)
		}
		version = 1
	}
	if originalVersion < 13 {
		if _, err = db.Exec(strings.TrimSuffix(seasonSchema, "PRAGMA user_version=14;")); err != nil {
			return fail(err)
		}
	}
	if version < 2 {
		if originalVersion == 1 {
			if err = s.Backup(); err != nil {
				return fail(err)
			}
		}
		_, err = db.Exec(`BEGIN; ALTER TABLE files ADD COLUMN series TEXT NOT NULL DEFAULT ''; ALTER TABLE files ADD COLUMN episode_sort INTEGER NOT NULL DEFAULT 0; UPDATE files SET series=coalesce(json_extract(data,'$.series'),''),episode_sort=coalesce(json_extract(data,'$.episodes[0].number'),0); CREATE INDEX files_series_sort ON files(service,series COLLATE NOCASE,media_id,season,episode_sort,id); PRAGMA user_version=2; COMMIT;`)
		if err != nil {
			return fail(err)
		}
	}
	if version < 4 {
		if originalVersion >= 2 {
			if err = s.Backup(); err != nil {
				return fail(err)
			}
		}
		if err = s.upgradeMediaTraits(); err != nil {
			return fail(err)
		}
	}
	if version < 5 {
		if originalVersion >= 4 {
			if err = s.Backup(); err != nil {
				return fail(err)
			}
		}
		tx, e := db.Begin()
		if e != nil {
			return fail(e)
		}
		for _, column := range []struct{ name, definition string }{{"rule_conflict", "INTEGER NOT NULL DEFAULT 0"}, {"emby_match", "TEXT NOT NULL DEFAULT ''"}} {
			var exists int
			e = tx.QueryRow("SELECT count(*) FROM pragma_table_info('files') WHERE name=?", column.name).Scan(&exists)
			if e != nil {
				break
			}
			if exists == 0 {
				_, e = tx.Exec("ALTER TABLE files ADD COLUMN " + column.name + " " + column.definition)
				if e != nil {
					break
				}
			}
		}
		if e == nil {
			_, e = tx.Exec(`UPDATE files SET emby_match=coalesce(json_extract(data,'$.embyMatch'),''); CREATE INDEX IF NOT EXISTS files_conflicts ON files(service,conflict); CREATE INDEX IF NOT EXISTS files_rule_conflicts ON files(service,rule_conflict); CREATE INDEX IF NOT EXISTS files_emby_match ON files(service,emby_match); CREATE TABLE IF NOT EXISTS file_languages(file_rowid INTEGER REFERENCES files(rowid) ON DELETE CASCADE,language TEXT NOT NULL,PRIMARY KEY(file_rowid,language)); CREATE INDEX IF NOT EXISTS file_languages_value ON file_languages(language,file_rowid);`)
		}
		if e == nil {
			e = reparseCached(context.Background(), tx, defaultRecognitionEngine)
		}
		if e == nil {
			_, e = tx.Exec("PRAGMA user_version=5")
		}
		if e != nil {
			tx.Rollback()
			return fail(e)
		}
		if e = tx.Commit(); e != nil {
			return fail(e)
		}
	}
	if version < 6 {
		if originalVersion >= 5 {
			if err = s.Backup(); err != nil {
				return fail(err)
			}
		}
		var cfg Settings
		saved := s.Get("settings", &cfg) == nil
		if saved {
			for service, columns := range cfg.VisibleColumns {
				if !containsColumn(columns, "custom") {
					cfg.VisibleColumns[service] = append(columns, "custom")
				}
			}
		}
		tx, e := db.Begin()
		if e != nil {
			return fail(e)
		}
		if _, e = tx.Exec(customSchema); e == nil && saved {
			raw, _ := json.Marshal(cfg)
			_, e = tx.Exec("UPDATE kv SET value=? WHERE key='settings'", string(raw))
		}
		if e != nil {
			tx.Rollback()
			return fail(e)
		}
		if e = tx.Commit(); e != nil {
			return fail(e)
		}
	}
	if originalVersion < 7 {
		if originalVersion == 6 {
			if err = s.Backup(); err != nil {
				return fail(err)
			}
		}
		var cfg RecognitionConfig
		loaded := s.Get("recognition", &cfg) == nil
		upgraded, changed := upgradeDefaultRules(cfg.Rules)
		tx, e := db.Begin()
		if e != nil {
			return fail(e)
		}
		if _, e = tx.Exec(tagSyncSchema); e == nil && loaded && changed {
			engine, compileErr := CompileRecognition(upgraded)
			e = compileErr
			if e == nil {
				var raw []byte
				raw, e = json.Marshal(engine.Config())
				if e == nil {
					_, e = tx.Exec("UPDATE kv SET value=? WHERE key='recognition'", string(raw))
				}
			}
			if e == nil {
				e = reparseCached(context.Background(), tx, engine)
			}
		}
		if e != nil {
			tx.Rollback()
			return fail(e)
		}
		if e = tx.Commit(); e != nil {
			return fail(e)
		}
	}

	if originalVersion < 8 {
		if originalVersion == 7 {
			if err = s.Backup(); err != nil {
				return fail(err)
			}
		}
		var cfg RecognitionConfig
		loaded := s.Get("recognition", &cfg) == nil
		upgraded, changed := addUHDBDDefault(cfg.Rules)
		tx, e := db.Begin()
		if e != nil {
			return fail(e)
		}
		if _, e = tx.Exec(tagPolicySchema); e == nil && loaded {
			var engine *RecognitionEngine
			engine, e = CompileRecognition(upgraded)
			if e == nil {
				s.recognition.Store(engine)
			}
			if e == nil && changed {
				raw, _ := json.Marshal(engine.Config())
				_, e = tx.Exec("UPDATE kv SET value=? WHERE key='recognition'", string(raw))
				if e == nil {
					e = reparseCached(context.Background(), tx, engine)
				}
			}
		}
		var settings Settings
		if e == nil && s.Get("settings", &settings) == nil {
			for service, c := range map[string]ServiceConfig{"radarr": settings.Radarr, "sonarr": settings.Sonarr} {
				if !c.TagSync.Active() {
					continue
				}
				endpoint := tagEndpoint(c)
				if e = s.seedTagValues(context.Background(), tx, service, endpoint, c.TagSync, true, s.recognition.Load().config.Rules); e != nil {
					break
				}
				for field, on := range c.TagSync.fields() {
					if on {
						_, e = tx.Exec("INSERT OR IGNORE INTO tag_sync_groups VALUES(?,?,?,'active')", service, endpoint, field)
						if e != nil {
							break
						}
					}
				}
				if e != nil {
					break
				}
				_, e = tx.Exec("INSERT INTO kv VALUES(?, 'true') ON CONFLICT(key) DO UPDATE SET value=excluded.value", "tagSyncDirty:"+service)
				if e != nil {
					break
				}
			}
		}
		if e != nil {
			tx.Rollback()
			return fail(e)
		}
		if e = tx.Commit(); e != nil {
			return fail(e)
		}
	}

	if originalVersion < 9 {
		if originalVersion == 8 {
			if err = s.Backup(); err != nil {
				return fail(err)
			}
		}
		var cfg RecognitionConfig
		loaded := s.Get("recognition", &cfg) == nil
		upgraded, changed := upgradeRules053(cfg.Rules)
		tx, e := db.Begin()
		if e != nil {
			return fail(e)
		}
		if _, e = tx.Exec(tagApprovalSchema); e == nil && loaded && changed {
			var engine *RecognitionEngine
			engine, e = CompileRecognition(upgraded)
			if e == nil {
				raw, _ := json.Marshal(engine.Config())
				_, e = tx.Exec("UPDATE kv SET value=? WHERE key='recognition'", string(raw))
			}
			if e == nil {
				e = reparseCached(context.Background(), tx, engine)
			}
		}
		var settings Settings
		if e == nil && s.Get("settings", &settings) == nil {
			for service, c := range map[string]ServiceConfig{"radarr": settings.Radarr, "sonarr": settings.Sonarr} {
				if c.TagSync.Active() {
					_, e = tx.Exec("INSERT INTO kv VALUES(?, 'true') ON CONFLICT(key) DO UPDATE SET value=excluded.value", "tagSyncDirty:"+service)
					if e != nil {
						break
					}
				}
			}
		}
		if e != nil {
			tx.Rollback()
			return fail(e)
		}
		if e = tx.Commit(); e != nil {
			return fail(e)
		}
	}
	if originalVersion < 10 {
		if originalVersion == 9 {
			if err = s.Backup(); err != nil {
				return fail(err)
			}
		}
		var cfg RecognitionConfig
		loaded := s.Get("recognition", &cfg) == nil
		rules, changed := upgradeRules054(cfg.Rules)
		tx, e := db.Begin()
		if e != nil {
			return fail(e)
		}
		if loaded && changed {
			var engine *RecognitionEngine
			engine, e = CompileRecognition(rules)
			if e == nil {
				raw, _ := json.Marshal(engine.Config())
				_, e = tx.Exec("UPDATE kv SET value=? WHERE key='recognition'", string(raw))
			}
			if e == nil {
				e = reparseCached(context.Background(), tx, engine)
			}
			if e == nil {
				var settings Settings
				if s.Get("settings", &settings) == nil {
					for service, config := range map[string]ServiceConfig{"radarr": settings.Radarr, "sonarr": settings.Sonarr} {
						if config.TagSync.Active() {
							_, e = tx.Exec("INSERT INTO kv(key,value) VALUES(?, 'true') ON CONFLICT(key) DO UPDATE SET value=excluded.value", "tagSyncDirty:"+service)
							if e != nil {
								break
							}
						}
					}
				}
			}
		}
		if e == nil {
			_, e = tx.Exec("PRAGMA user_version=10")
		}
		if e != nil {
			tx.Rollback()
			return fail(e)
		}
		if e = tx.Commit(); e != nil {
			return fail(e)
		}
	}

	if originalVersion < 11 {
		if originalVersion == 10 {
			if err = s.Backup(); err != nil {
				return fail(err)
			}
		}
		engine := defaultRecognitionEngine
		var config RecognitionConfig
		if err = s.Get("recognition", &config); err == nil {
			engine, err = CompileRecognition(config.Rules)
			if err != nil {
				return fail(err)
			}
		} else if !errors.Is(err, sql.ErrNoRows) {
			return fail(fmt.Errorf("Could not load recognition rules: %w", err))
		}
		tx, e := db.Begin()
		if e != nil {
			return fail(e)
		}
		e = reparseCached(context.Background(), tx, engine)
		if e == nil {
			raw, _ := json.Marshal(engine.Config())
			_, e = tx.Exec("INSERT INTO kv(key,value) VALUES('recognition',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", string(raw))
		}
		if e == nil {
			var settings Settings
			if s.Get("settings", &settings) == nil {
				for service, cfg := range map[string]ServiceConfig{"radarr": settings.Radarr, "sonarr": settings.Sonarr} {
					if cfg.TagSync.Active() {
						_, e = tx.Exec("INSERT INTO kv(key,value) VALUES(?, 'true') ON CONFLICT(key) DO UPDATE SET value=excluded.value", "tagSyncDirty:"+service)
						if e != nil {
							break
						}
					}
				}
			}
		}

		if e == nil {
			_, e = tx.Exec("PRAGMA user_version=11")
		}
		if e != nil {
			tx.Rollback()
			return fail(e)
		}
		if e = tx.Commit(); e != nil {
			return fail(e)
		}
	}

	if version < 12 {
		if originalVersion >= 11 {
			if err = s.Backup(); err != nil {
				return fail(err)
			}
		}
		if _, err = db.Exec("BEGIN;" + tagImportSchema + "COMMIT;"); err != nil {
			return fail(err)
		}
	}

	var recognition RecognitionConfig
	if originalVersion < 13 {
		if originalVersion == 12 {
			if err = s.Backup(); err != nil {
				return fail(err)
			}
		}
		if _, err = db.Exec("BEGIN;" + tagCatalogSchema + "COMMIT;"); err != nil {
			return fail(err)
		}
	}
	if originalVersion < 14 {
		if originalVersion == 13 {
			if err = s.Backup(); err != nil {
				return fail(err)
			}
		}
		tx, e := db.Begin()
		if e != nil {
			return fail(e)
		}
		if _, e = tx.Exec(seasonSchema); e == nil {
			e = rebuildSeasonAnalysis(context.Background(), tx, nil)
		}
		if e != nil {
			tx.Rollback()
			return fail(e)
		}
		if e = tx.Commit(); e != nil {
			return fail(e)
		}
	}
	if originalVersion < 15 {
		if originalVersion == 14 {
			if err = s.Backup(); err != nil {
				return fail(err)
			}
		}
		if _, err = db.Exec("BEGIN;" + mediaTagSchema + "PRAGMA user_version=15;COMMIT;"); err != nil {
			return fail(err)
		}
	}
	if originalVersion < 16 {
		if originalVersion == 15 {
			if err = s.Backup(); err != nil {
				return fail(err)
			}
		}
		var hasPath bool
		if err = db.QueryRow("SELECT EXISTS(SELECT 1 FROM pragma_table_info('files') WHERE name='source_path')").Scan(&hasPath); err != nil {
			return fail(err)
		}
		addPath := ""
		if !hasPath {
			addPath = "ALTER TABLE files ADD COLUMN source_path TEXT NOT NULL DEFAULT '';"
		}
		if _, err = db.Exec("BEGIN;" + addPath + muxSchema + "PRAGMA user_version=16;COMMIT;"); err != nil {
			return fail(err)
		}
	}
	if version < 17 {
		if originalVersion == 16 {
			if err = s.Backup(); err != nil {
				return fail(err)
			}
		}
		if _, err = db.Exec("BEGIN;" + placementSchema + "PRAGMA user_version=17;COMMIT;"); err != nil {
			return fail(err)
		}
	}
	// The catalog needs only normalized traits and compact unknown/origin tuples.
	// Materializing that exact projection avoids full JSON reads and a temporary
	// grouping B-tree when settings and dashboard cold requests run concurrently.
	// Its redundant predicate (data is NOT NULL) makes the index available only
	// to catalog reads that explicitly request it. Otherwise SQLite can choose
	// this wide index over the smaller indexes used by interactive list filters.
	// Replace the initial unscoped index in existing prerelease schema15 caches.
	if err = ensureCatalogCountIndex(context.Background(), db); err != nil {
		return fail(err)
	}
	// A compact covering index avoids reading full evidence/audio JSON while
	// counting and selecting IDs for compound filters and season membership.
	if _, err = db.Exec(`CREATE INDEX IF NOT EXISTS files_traits ON files(service,resolution,codec,source,hdr,audio,language,media_id,season,processing,family,bitDepth,channels,size,conflict,rule_conflict,emby_match,title COLLATE NOCASE,id)`); err != nil {
		return fail(err)
	}
	// Dashboard reads need only episode identities and completeness, not the large
	// evidence/track JSON. SQLite maintains these compact expressions on every write.
	if _, err = db.Exec(`CREATE INDEX IF NOT EXISTS files_statistics ON files(service,media_id,season,id,CASE WHEN json_valid(data) THEN json_extract(data,'$.episodes') END,CASE WHEN json_valid(data) THEN coalesce(json_extract(data,'$.metadataIncomplete'),0) END,json_valid(data))`); err != nil {
		return fail(err)
	}
	// Audio distributions retain unknown-track semantics without scanning full JSON.
	if _, err = db.Exec(`CREATE INDEX IF NOT EXISTS files_audio_statistics ON files(service,audio,CASE WHEN json_valid(data) THEN json_extract(data,'$.unknownTraits') END)`); err != nil {
		return fail(err)
	}

	if err = s.Get("recognition", &recognition); err == nil {
		engine, e := CompileRecognition(recognition.Rules)
		if e != nil {
			return fail(e)
		}
		s.recognition.Store(engine)
	} else if err == sql.ErrNoRows {
		if err = s.Put("recognition", s.recognition.Load().Config()); err != nil {
			return fail(err)
		}
	} else {
		return fail(err)
	}
	if err = s.queueStaleTagRefresh(); err != nil {
		return fail(err)
	}
	if err = s.seedTagCatalog(context.Background()); err != nil {
		return fail(err)
	}
	return s, nil
}

// Queue a full reconciliation once so upgrades also refresh accumulated values.
// AllInstances handles both legacy settings and named instances before server startup.
func (s *Store) queueStaleTagRefresh() error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var marker string
	err = tx.QueryRow("SELECT value FROM kv WHERE key='tagStaleRefresh:1.1.1'").Scan(&marker)
	if err == nil {
		return nil
	}
	if err != sql.ErrNoRows {
		return err
	}
	var raw string
	err = tx.QueryRow("SELECT value FROM kv WHERE key='settings'").Scan(&raw)
	if err == nil {
		var settings Settings
		if err = json.Unmarshal([]byte(raw), &settings); err != nil {
			return err
		}
		for _, c := range settings.AllInstances() {
			if c.TagSync.Active() && tagMode(c) == "add" {
				if _, err = tx.Exec("INSERT INTO kv(key,value) VALUES(?, 'true') ON CONFLICT(key) DO UPDATE SET value=excluded.value", "tagSyncDirty:"+c.ID); err != nil {
					return err
				}
			}
		}
	} else if err != sql.ErrNoRows {
		return err
	}
	if _, err = tx.Exec("INSERT INTO kv(key,value) VALUES('tagStaleRefresh:1.1.1', 'true')"); err != nil {
		return err
	}
	return tx.Commit()
}
