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

const mediaInfoSchema = `CREATE TABLE IF NOT EXISTS mediainfo_results(service TEXT NOT NULL,file_id INTEGER NOT NULL,arr_path TEXT NOT NULL,size INTEGER NOT NULL,scanned_at INTEGER NOT NULL,version TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(service,file_id));`

type MediaInfoResult struct {
	mediaInfoResult
	ScannedAt int64  `json:"scannedAt"`
	Version   string `json:"version"`
}
type savedMediaInfo struct {
	Path   string
	Size   int64
	Result MediaInfoResult
}

func loadMediaInfo(ctx context.Context, db metadataQuerier, service string) (map[int]savedMediaInfo, error) {
	rows, err := db.QueryContext(ctx, "SELECT file_id,arr_path,size,data FROM mediainfo_results WHERE service=?", service)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int]savedMediaInfo{}
	for rows.Next() {
		var id int
		var value savedMediaInfo
		var raw string
		if err = rows.Scan(&id, &value.Path, &value.Size, &raw); err != nil {
			return nil, err
		}
		if err = json.Unmarshal([]byte(raw), &value.Result); err != nil {
			return nil, err
		}
		out[id] = value
	}
	return out, rows.Err()
}

// Every persisted file uses this ordering, including full and webhook sync rebuilds.
func resolveSavedMetadata(f *File, engine *RecognitionEngine, confirmations map[string]FieldConfirmation, measured *savedMediaInfo) {
	f.MediaInfo = nil
	if measured != nil && measured.Path == f.SourcePath && measured.Size == f.Size {
		result := measured.Result
		f.MediaInfo = &result
	}
	if f.Confirmed || f.MediaInfo != nil {
		f.RecognitionRevision = ""
	}
	reparseFile(f, engine)
	if f.MediaInfo != nil {
		applyMediaInfo(f, f.MediaInfo.mediaInfoResult)
	}
	applyFieldConfirmations(f, confirmations)
}
func applyMediaInfo(f *File, result mediaInfoResult) {
	if result.Ambiguous {
		return
	}
	// Reuse the media-server normalizer to derive channels and comparison semantics,
	// retaining its evidence as a separate fourth opinion.
	probe := File{Filename: f.Filename, comparisonEngine: f.comparisonEngine, Evidence: map[string]Evidence{}}
	applyEmbyMetadata(&probe, result.metadata())
	engine := f.comparisonEngine
	if engine == nil {
		engine = defaultRecognitionEngine
	}
	for _, field := range confirmationFields {
		measured := probe.Evidence[field].Emby
		if measured == "" {
			continue
		}
		e := f.Evidence[field]
		e.MediaInfo = measured
		compatible := func(value string) bool {
			if field == "channels" {
				return mediaChannelsCompatible(measured, value)
			}
			return equivalentValue(field, measured, value, engine, e.Rules)
		}
		e.Conflict = e.Filename != "" && !compatible(e.Filename)
		e.MediaServerDiffers = e.Emby != "" && !compatible(e.Emby)
		// Verified per-track audio/language retain the existing precise-track behavior.
		if e.Filename == "" || field == "audio" || field == "language" {
			if target := fileTrait(f, field); target != nil {
				*target = measured
			}
			e.Origin = "mediainfo"
		}
		if field == "hdr" {
			f.HDR = mergeHDR(f.HDR, measured)
			e.Origin = "combined"
		}
		f.Evidence[field] = e
	}
	if len(result.AudioTracks) > 0 {
		f.AudioTracks = result.AudioTracks
		f.AudioStreamCount = len(result.AudioTracks)
		f.MediaOrigin = "mediainfo"
	}
	f.Family = family(f.Codec)
	markAPIDifferences(f, engine)
	f.Conflict = false
	for _, e := range f.Evidence {
		f.Conflict = f.Conflict || e.Conflict
	}
	updateCompleteness(f)
}
func (s *Store) renameMediaInfo(ctx context.Context, service string, id int, path string) error {
	_, err := s.DB.ExecContext(ctx, "UPDATE mediainfo_results SET arr_path=? WHERE service=? AND file_id=?", path, service, id)
	return err
}
func (s *Store) saveMediaInfo(ctx context.Context, original File, result MediaInfoResult, tagSync bool) error {
	raw, err := json.Marshal(result)
	if err != nil {
		return err
	}
	if len(raw) > mediaInfoResultLimit {
		return errors.New("MediaInfo result exceeds limit")
	}
	s.recognitionMu.Lock()
	defer s.recognitionMu.Unlock()
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var f File
	var data string
	if err = tx.QueryRowContext(ctx, "SELECT data,source_path FROM files WHERE service=? AND id=?", original.Service, original.ID).Scan(&data, &f.SourcePath); err != nil {
		return err
	}
	if err = json.Unmarshal([]byte(data), &f); err != nil {
		return err
	}
	if f.SourcePath != original.SourcePath || f.Size != original.Size {
		return errors.New("Media file changed while it was being read")
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO mediainfo_results(service,file_id,arr_path,size,scanned_at,version,data) VALUES(?,?,?,?,?,?,?) ON CONFLICT(service,file_id) DO UPDATE SET arr_path=excluded.arr_path,size=excluded.size,scanned_at=excluded.scanned_at,version=excluded.version,data=excluded.data", f.Service, f.ID, f.SourcePath, f.Size, result.ScannedAt, result.Version, string(raw))
	if err != nil {
		return err
	}
	confirmations, err := loadFieldConfirmations(ctx, tx, f.Service)
	if err != nil {
		return err
	}
	f.RecognitionRevision = ""
	resolveSavedMetadata(&f, s.recognition.Load(), confirmations[f.ID], &savedMediaInfo{Path: f.SourcePath, Size: f.Size, Result: result})
	if err = writeResolvedFile(ctx, tx, f); err != nil {
		return err
	}
	if tagSync {
		if _, err = tx.ExecContext(ctx, "INSERT INTO kv(key,value) VALUES(?,'true') ON CONFLICT(key) DO UPDATE SET value=excluded.value", "tagSyncDirty:"+f.Service); err != nil {
			return err
		}
	}
	if err = tx.Commit(); err == nil {
		s.invalidateAggregates()
	}
	return err
}
func (s *Server) mediaInfoToolHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		jsonOut(w, 200, s.MediaInfo.toolStatus())
		return
	}
	if r.Method != "POST" {
		w.WriteHeader(405)
		return
	}
	if s.Demo {
		failure(w, r, 403, errors.New("Tool installation is disabled in demo mode"))
		return
	}
	if err := s.MediaInfo.toolAction(r.URL.Query().Get("action")); err != nil {
		code := 400
		if errors.Is(err, errMediaInfoBusy) {
			code = 409
		}
		failure(w, r, code, err)
		return
	}
	jsonOut(w, 202, s.MediaInfo.toolStatus())
}
func (s *Server) mediaInfoReadHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		w.WriteHeader(405)
		return
	}
	if s.Demo {
		failure(w, r, 403, errors.New("MediaInfo reads are disabled in demo mode"))
		return
	}
	var in struct {
		Service string `json:"service"`
		FileID  int    `json:"fileId"`
	}
	if err := decode(w, r, &in); err != nil {
		failure(w, r, 400, err)
		return
	}
	if !serviceOK(in.Service) || in.FileID <= 0 {
		failure(w, r, 400, errors.New("Invalid library service"))
		return
	}
	f, err := s.Store.muxFile(in.Service, in.FileID)
	if err != nil {
		failure(w, r, 404, errors.New("File is no longer in Radarr/Sonarr"))
		return
	}
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(125 * time.Second))
	version := s.MediaInfo.toolStatus().Version
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	stop := context.AfterFunc(s.ctx, cancel)
	defer stop()
	result, err := s.MediaInfo.read(ctx, s.Config(), f)
	if err == nil {
		err = s.Store.saveMediaInfo(ctx, f, MediaInfoResult{mediaInfoResult: result, ScannedAt: time.Now().UnixMilli(), Version: version}, s.Config().GetService(f.Service).TagSync.Active())
	}
	if err != nil {
		code := 400
		if errors.Is(err, errMediaInfoBusy) {
			code = 409
		}
		s.Store.Events.Error("mediainfo", in.Service, "MediaInfo read failed", nil, f.Title, err.Error())
		failure(w, r, code, err)
		return
	}
	current, err := s.Store.muxFile(in.Service, in.FileID)
	if err != nil {
		failure(w, r, 500, err)
		return
	}
	s.Store.Events.Info("mediainfo", in.Service, "MediaInfo read completed", map[string]any{"fileId": strconv.Itoa(f.ID)}, f.Title)
	jsonOut(w, 200, current)
}

// Older releases tolerate the side tables but rewrite file JSON during sync.
// Restore those saved choices immediately on re-upgrade without reading media.
func (s *Store) restoreSavedMetadata(ctx context.Context) error {
	var needed bool
	err := s.DB.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM files f JOIN field_confirmations c ON c.service=f.service AND c.file_id=f.id AND c.size=f.size WHERE coalesce(json_extract(f.data,'$.confirmed'),0)=0) OR EXISTS(SELECT 1 FROM files f JOIN mediainfo_results m ON m.service=f.service AND m.file_id=f.id AND m.size=f.size AND m.arr_path=f.source_path WHERE json_extract(f.data,'$.mediaInfo') IS NULL)`).Scan(&needed)
	if err != nil || !needed {
		return err
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = reparseCachedForced(ctx, tx, s.recognition.Load()); err != nil {
		return err
	}
	var raw string
	if err = tx.QueryRowContext(ctx, "SELECT value FROM kv WHERE key='settings'").Scan(&raw); err == nil {
		var cfg Settings
		if err = json.Unmarshal([]byte(raw), &cfg); err != nil {
			return err
		}
		for _, c := range cfg.AllInstances() {
			if c.TagSync.Active() {
				if _, err = tx.ExecContext(ctx, "INSERT INTO kv(key,value) VALUES(?,'true') ON CONFLICT(key) DO UPDATE SET value=excluded.value", "tagSyncDirty:"+c.ID); err != nil {
					return err
				}
			}
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	return tx.Commit()
}
