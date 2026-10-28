package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"
)

const confirmationSchema = `CREATE TABLE IF NOT EXISTS field_confirmations(service TEXT NOT NULL,file_id INTEGER NOT NULL,field TEXT NOT NULL,source TEXT NOT NULL CHECK(source IN ('filename','api','mediaServer','mediainfo')),value TEXT NOT NULL,size INTEGER NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(service,file_id,field));`

type FieldConfirmation struct {
	Source string `json:"source"`
	Value  string `json:"value"`
	At     int64  `json:"at"`
	Size   int64  `json:"-"`
}

var confirmationFields = []string{"resolution", "codec", "source", "processing", "hdr", "bitDepth", "audio", "channels", "language"}

type metadataQuerier interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func loadFieldConfirmations(ctx context.Context, db metadataQuerier, service string) (map[int]map[string]FieldConfirmation, error) {
	rows, err := db.QueryContext(ctx, "SELECT file_id,field,source,value,size,created FROM field_confirmations WHERE service=?", service)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int]map[string]FieldConfirmation{}
	for rows.Next() {
		var id int
		var field string
		var c FieldConfirmation
		if err = rows.Scan(&id, &field, &c.Source, &c.Value, &c.Size, &c.At); err != nil {
			return nil, err
		}
		if out[id] == nil {
			out[id] = map[string]FieldConfirmation{}
		}
		out[id][field] = c
	}
	return out, rows.Err()
}
func evidenceSource(e Evidence, source string) string {
	switch source {
	case "filename":
		return e.Filename
	case "api":
		return e.API
	case "mediaServer":
		return e.Emby
	case "mediainfo":
		return e.MediaInfo
	}
	return ""
}
func fileTrait(f *File, field string) *string {
	switch field {
	case "resolution":
		return &f.Resolution
	case "codec":
		return &f.Codec
	case "source":
		return &f.Source
	case "processing":
		return &f.Processing
	case "hdr":
		return &f.HDR
	case "bitDepth":
		return &f.BitDepth
	case "audio":
		return &f.Audio
	case "channels":
		return &f.Channels
	case "language":
		return &f.Language
	}
	return nil
}
func applyFieldConfirmations(f *File, confirmations map[string]FieldConfirmation) {
	f.Confirmed = false
	if len(confirmations) == 0 {
		return
	}
	for field, c := range confirmations {
		if c.Size != f.Size {
			continue
		}
		e, ok := f.Evidence[field]
		if !ok {
			continue
		}
		saved := c
		e.Confirmed = &saved
		f.Confirmed = true
		if value := evidenceSource(e, c.Source); value != "" {
			if target := fileTrait(f, field); target != nil {
				*target = value
			}
			e.Origin = c.Source
			e.Conflict = false
			e.APIDiffers = false
			e.MediaServerDiffers = false
			kept := f.RecognitionConflicts[:0]
			for _, conflict := range f.RecognitionConflicts {
				if conflict.Field != field {
					kept = append(kept, conflict)
				}
			}
			f.RecognitionConflicts = kept
		}
		f.Evidence[field] = e
	}
	f.Family = family(f.Codec)
	f.RuleConflict = len(f.RecognitionConflicts) > 0
	f.Conflict = false
	for _, e := range f.Evidence {
		f.Conflict = f.Conflict || e.Conflict
	}
	updateCompleteness(f)
}

// One transactional file write keeps list filters, CSV, tags and detail JSON in agreement.
func writeResolvedFile(ctx context.Context, tx *sql.Tx, f File) error {
	raw, err := json.Marshal(f)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, "UPDATE files SET resolution=?,codec=?,family=?,source=?,processing=?,hdr=?,bitDepth=?,audio=?,channels=?,language=?,conflict=?,rule_conflict=?,emby_match=?,data=? WHERE service=? AND id=?", f.Resolution, f.Codec, f.Family, f.Source, f.Processing, f.HDR, f.BitDepth, f.Audio, f.Channels, f.Language, f.Conflict, f.RuleConflict, f.EmbyMatch, string(raw), f.Service, f.ID)
	if err != nil {
		return err
	}
	var rowid int64
	if err = tx.QueryRowContext(ctx, "SELECT rowid FROM files WHERE service=? AND id=?", f.Service, f.ID).Scan(&rowid); err != nil {
		return err
	}
	if err = replaceFileLanguages(ctx, tx, rowid, f); err != nil {
		return err
	}
	return rebuildSeasonAnalysis(ctx, tx, nil)
}
func (s *Server) confirmationHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != "PUT" && r.Method != "DELETE" {
		w.WriteHeader(405)
		return
	}
	if s.Demo {
		failure(w, r, 403, errors.New("Metadata confirmations are disabled in demo mode"))
		return
	}
	var in struct {
		Service string `json:"service"`
		FileID  int    `json:"fileId"`
		Field   string `json:"field"`
		Source  string `json:"source"`
	}
	if r.Method == "PUT" {
		if err := decode(w, r, &in); err != nil {
			failure(w, r, 400, err)
			return
		}
	} else {
		in.Service = r.URL.Query().Get("service")
		in.FileID, _ = strconv.Atoi(r.URL.Query().Get("fileId"))
		in.Field = r.URL.Query().Get("field")
	}
	if !serviceOK(in.Service) || in.FileID <= 0 || !containsString(confirmationFields, in.Field) {
		failure(w, r, 400, errors.New("Invalid metadata confirmation"))
		return
	}
	store := s.Store
	store.recognitionMu.Lock()
	defer store.recognitionMu.Unlock()
	tx, err := store.DB.BeginTx(r.Context(), nil)
	if err != nil {
		failure(w, r, 500, err)
		return
	}
	defer tx.Rollback()
	var f File
	var raw string
	err = tx.QueryRowContext(r.Context(), "SELECT data,source_path FROM files WHERE service=? AND id=?", in.Service, in.FileID).Scan(&raw, &f.SourcePath)
	if err != nil {
		failure(w, r, 404, errors.New("File is no longer in Radarr/Sonarr"))
		return
	}
	if err = json.Unmarshal([]byte(raw), &f); err != nil {
		failure(w, r, 500, err)
		return
	}
	// Always rebuild from raw evidence so removing/changing a choice restores automatic behavior.
	f.RecognitionRevision = ""
	measured, loadErr := loadMediaInfo(r.Context(), tx, in.Service)
	if loadErr != nil {
		failure(w, r, 500, loadErr)
		return
	}
	measurement, ok := measured[f.ID]
	var saved *savedMediaInfo
	if ok {
		saved = &measurement
	}
	resolveSavedMetadata(&f, store.recognition.Load(), nil, saved)
	if r.Method == "PUT" {
		value := evidenceSource(f.Evidence[in.Field], in.Source)
		if value == "" {
			failure(w, r, 400, errors.New("The selected source has no value"))
			return
		}
		_, err = tx.ExecContext(r.Context(), "INSERT INTO field_confirmations(service,file_id,field,source,value,size,created) VALUES(?,?,?,?,?,?,?) ON CONFLICT(service,file_id,field) DO UPDATE SET source=excluded.source,value=excluded.value,size=excluded.size,created=excluded.created", in.Service, in.FileID, in.Field, in.Source, value, f.Size, time.Now().UnixMilli())
	} else {
		_, err = tx.ExecContext(r.Context(), "DELETE FROM field_confirmations WHERE service=? AND file_id=? AND field=?", in.Service, in.FileID, in.Field)
	}
	if err != nil {
		failure(w, r, 500, err)
		return
	}
	values, err := loadFieldConfirmations(r.Context(), tx, in.Service)
	if err == nil {
		applyFieldConfirmations(&f, values[f.ID])
		err = writeResolvedFile(r.Context(), tx, f)
	}
	if err == nil && s.Config().GetService(in.Service).TagSync.Active() {
		_, err = tx.ExecContext(r.Context(), "INSERT INTO kv(key,value) VALUES(?,'true') ON CONFLICT(key) DO UPDATE SET value=excluded.value", "tagSyncDirty:"+in.Service)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		failure(w, r, 500, err)
		return
	}
	store.invalidateAggregates()
	if r.Method == "PUT" {
		c := f.Evidence[in.Field].Confirmed
		store.Events.Info("metadata", in.Service, "Metadata confirmed: {field} uses {source} ({value})", map[string]any{"field": in.Field, "source": c.Source, "value": c.Value}, f.Title)
	} else {
		store.Events.Info("metadata", in.Service, "Metadata confirmation removed: {field}", map[string]any{"field": in.Field}, f.Title)
	}
	jsonOut(w, 200, f)
}
