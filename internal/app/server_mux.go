package app

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func (m *MuxManager) file(ctx context.Context, service string, id int) (File, error) {
	f, e := m.s.Store.muxFile(service, id)
	if e != nil {
		return f, errors.New("File is no longer in Radarr/Sonarr")
	}
	if f.SourcePath == "" {
		c := m.s.Config().GetService(service)
		route := "moviefile/"
		if serviceKind(service) == "sonarr" {
			route = "episodefile/"
		}
		var data struct {
			Path string `json:"path"`
			Size int64  `json:"size"`
		}
		if e = NewArr(c).get(ctx, route+strconv.Itoa(id), nil, &data); e != nil {
			return f, e
		}
		if data.Size != f.Size {
			return f, errors.New("File differs from cache. Synchronize first")
		}
		f.SourcePath = data.Path
		m.s.Store.DB.Exec("UPDATE files SET source_path=? WHERE service=? AND id=?", f.SourcePath, service, id)
	}
	return f, nil
}
func (s *Server) muxHTTP(w http.ResponseWriter, r *http.Request) {
	m := s.Mux
	cfg := s.Config()
	route := strings.TrimPrefix(r.URL.Path, "/api/mux/")
	if route != "tool" && !cfg.Mux.Enabled {
		http.NotFound(w, r)
		return
	}
	fail := func(code int, e error) { failure(w, r, code, e) }
	if route == "tool" {
		if r.Method == "GET" {
			st := m.toolStatus()
			if cfg.Mux.Enabled && (st.CheckedAt == nil || time.Since(*st.CheckedAt) > 6*time.Hour) && st.Busy == "" {
				m.toolAction("check")
			}
			jsonOut(w, 200, m.toolStatus())
			return
		}
		if r.Method == "POST" {
			if e := m.toolAction(r.URL.Query().Get("action")); e != nil {
				fail(409, e)
				return
			}
			jsonOut(w, 202, m.toolStatus())
			return
		}
	}
	if s.Demo && r.Method != "GET" {
		fail(403, errors.New("Mux operations are disabled in demo mode"))
		return
	}
	if (route == "check-paths" || route == "root-folders") && r.Method == "POST" {
		s.muxPathHTTP(w, r, route)
		return
	}
	if route == "jobs/log" && r.Method == "GET" {
		s.muxLogHTTP(w, r)
		return
	}
	if route == "jobs" && r.Method == "GET" {
		if raw := r.URL.Query().Get("id"); raw != "" {
			id, _ := strconv.ParseInt(raw, 10, 64)
			j, e := s.Store.muxJob(id)
			if e != nil {
				http.NotFound(w, r)
				return
			}
			j.Check = m.cachedCheck(j, r.URL.Query().Get("fresh") == "1")
			jsonOut(w, 200, j)
			return
		}
		jobs, e := s.Store.muxJobs()
		if e != nil {
			fail(500, errors.New("Could not read mux jobs"))
			return
		}
		out := []MuxJob{}
		for _, j := range jobs {
			if v := r.URL.Query().Get("service"); v != "" && v != j.Service {
				continue
			}
			if v := r.URL.Query().Get("fileId"); v != "" && v != strconv.Itoa(j.FileID) {
				continue
			}
			j.Check = m.cachedCheck(j)
			out = append(out, j)
		}
		jsonOut(w, 200, out)
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if route == "jobs" && r.Method == "POST" {
		if !s.renameMu.TryLock() {
			fail(409, errors.New("Another rename is in progress"))
			return
		}
		defer s.renameMu.Unlock()
		if m.tool.Busy != "" || !m.tool.Installed {
			fail(409, errors.New("Install MKVToolNix first"))
			return
		}
		var in struct {
			Service string `json:"service"`
			FileID  int    `json:"fileId"`
		}
		if e := decode(w, r, &in); e != nil {
			fail(400, e)
			return
		}
		c := cfg.GetService(in.Service)
		if !serviceOK(in.Service) || !c.Enabled {
			fail(400, errors.New("Invalid library service"))
			return
		}
		jobs, _ := s.Store.muxJobs()
		for _, j := range jobs {
			if j.Service == in.Service && j.FileID == in.FileID {
				jsonOut(w, 200, j)
				return
			}
		}
		f, e := m.file(r.Context(), in.Service, in.FileID)
		if e != nil {
			fail(400, e)
			return
		}
		src, e := resolveLocalPath(cfg.Mux, in.Service, f.SourcePath)
		if e != nil {
			fail(400, e)
			return
		}
		check := checkMuxFile(src, f.Size, MuxSource{}, cfg.Mux.WorkDir)
		if !check.Ready() {
			fail(400, errors.New("Media file checks failed"))
			return
		}
		source, e := m.runner().Identify(r.Context(), src)
		if e != nil {
			fail(400, e)
			return
		}
		spec := MuxSpec{OutputName: strings.TrimSuffix(filepath.Base(src), filepath.Ext(src)), DeleteOriginal: cfg.Mux.DeleteOriginal, Tracks: map[int]MuxTrackSpec{}, Chapters: true, Attachments: true}
		defaults := map[string]bool{}
		for _, t := range source.Tracks {
			lang := t.Language
			if lang == "" {
				lang = "und"
			}
			def := t.Default && !defaults[t.Type]
			if def {
				defaults[t.Type] = true
			}
			spec.Tracks[t.ID] = MuxTrackSpec{true, lang, t.Name, def, t.Forced}
		}
		j := MuxJob{Service: in.Service, FileID: f.ID, MediaID: f.MediaID, Title: f.Title, SourceName: filepath.Base(src), Status: "draft", Source: source, Spec: spec, Check: check}
		if f.Series != "" {
			j.Title = f.Series + " · " + f.Title
		}
		if e = s.Store.muxSave(&j); e != nil {
			fail(500, errors.New("Could not save mux job"))
			return
		}
		s.Store.Events.Info("mux", j.Service, "Marked for muxing", map[string]any{"job": j.ID}, j.SourceName)
		jsonOut(w, 201, j)
		return
	}
	if route == "run" && r.Method == "POST" {
		var in struct {
			IDs []int64 `json:"ids"`
			All bool    `json:"all"`
		}
		if e := decode(w, r, &in); e != nil {
			fail(400, e)
			return
		}
		jobs, _ := s.Store.muxJobs()
		if in.All {
			for _, j := range jobs {
				if j.Status == "ready" || j.Status == "failed" || j.Status == "cancelled" {
					in.IDs = append(in.IDs, j.ID)
				}
			}
		}
		rejected := map[int64]string{}
		accepted := []int64{}
		for _, id := range in.IDs {
			j, e := s.Store.muxJob(id)
			if e != nil {
				rejected[id] = "Mux job not found"
				continue
			}
			if j.Status == "draft" {
				rejected[id] = "Save the mux options first"
				continue
			}
			if j.Status != "ready" && j.Status != "failed" && j.Status != "cancelled" {
				rejected[id] = "Mux job cannot be started"
				continue
			}
			check := m.checkJob(j)
			if reason := muxCheckReason(check); reason != "" {
				rejected[id] = reason
				if check.Exists && !check.Unchanged {
					j.Status = "needs_review"
					j.Message = "Media file changed. Identify it again"
					if e = s.Store.muxSave(&j); e != nil {
						rejected[id] = "Could not save mux job"
					}
				}
				continue
			}
			if _, e = buildMuxArgs("/source", "/output", j.Source, j.Spec); e != nil {
				rejected[id] = e.Error()
				continue
			}
			if !m.tool.Installed || m.tool.Busy != "" {
				rejected[id] = "MKVToolNix is not available"
				continue
			}
			j.Spec.DeleteOriginal = cfg.Mux.DeleteOriginal
			j.Status = "queued"
			j.Message = "Queued"
			if e = s.Store.muxSave(&j); e != nil {
				rejected[id] = e.Error()
			} else {
				os.Remove(m.logPath(id))
				accepted = append(accepted, id)
			}
		}
		jsonOut(w, 200, map[string]any{"accepted": accepted, "rejected": rejected})
		return
	}
	id, _ := strconv.ParseInt(r.URL.Query().Get("id"), 10, 64)
	j, e := s.Store.muxJob(id)
	if e != nil {
		http.NotFound(w, r)
		return
	}
	if route == "cancel" && r.Method == "POST" {
		if m.active == id {
			if m.cancel != nil {
				m.cancel()
			}
		} else if j.Status == "queued" {
			j.Status = "cancelled"
			e = s.Store.muxSave(&j)
		}
		jsonOut(w, 200, map[string]bool{"ok": e == nil})
		return
	}
	if j.Status == "running" || j.Status == "queued" {
		fail(409, errors.New("Mux job is busy"))
		return
	}
	if route == "jobs" && r.Method == "PUT" {
		var in struct {
			Spec     MuxSpec `json:"spec"`
			Revision int     `json:"revision"`
		}
		if e = decode(w, r, &in); e != nil {
			fail(400, e)
			return
		}
		if in.Revision != j.Revision {
			fail(409, errMuxRevision)
			return
		}
		if j.Status == "succeeded" || j.Status == "needs_attention" {
			fail(409, errors.New("Completed output cannot be edited"))
			return
		}
		if j.Status == "needs_review" {
			fail(409, errors.New("Identify the media file again before saving"))
			return
		}
		in.Spec.OutputName, e = muxOutputName(in.Spec.OutputName)
		if e == nil {
			_, e = buildMuxArgs("/source", "/output", j.Source, in.Spec)
		}
		if e != nil {
			fail(400, e)
			return
		}
		in.Spec.DeleteOriginal = j.Spec.DeleteOriginal
		j.Spec = in.Spec
		j.Status = "ready"
		j.Message = "Ready"
		if e = s.Store.muxSave(&j); e != nil {
			fail(409, e)
			return
		}
		jsonOut(w, 200, j)
		return
	}
	if route == "jobs" && r.Method == "DELETE" {
		if j.Status == "needs_attention" {
			f, e := m.recoveryFile(r.Context(), j)
			if e != nil {
				fail(409, e)
				return
			}
			src, e := resolveMuxJobDestination(cfg, j, f.SourcePath)
			if e != nil {
				fail(409, e)
				return
			}
			if _, e := os.Lstat(muxTemp(src, j)); !os.IsNotExist(e) {
				fail(409, errors.New("Verified temporary output is preserved. Restore or publish it locally before retrying the rescan"))
				return
			}
		}
		if j.BackupName != "" {
			fail(409, errors.New("Delete the preserved backup before removing this job"))
			return
		}
		_, e = s.Store.DB.Exec("DELETE FROM mux_jobs WHERE id=?", id)
		if e != nil {
			fail(500, errors.New("Could not remove mux job"))
			return
		}
		os.Remove(m.logPath(id))
		delete(m.checks, id)
		s.Store.Events.Info("mux", j.Service, "Mux marking removed", nil, j.SourceName)
		jsonOut(w, 200, map[string]bool{"ok": true})
		return
	}
	if r.Method == "POST" && route == "jobs/identify" {
		if j.Status == "succeeded" || j.Status == "needs_attention" {
			fail(409, errors.New("Completed output cannot be edited"))
			return
		}
		if m.tool.Busy != "" || !m.tool.Installed {
			fail(409, errors.New("Install MKVToolNix first"))
			return
		}
		f, e := m.file(r.Context(), j.Service, j.FileID)
		if e != nil {
			fail(400, e)
			return
		}
		src, e := resolveLocalPath(cfg.Mux, j.Service, f.SourcePath)
		if e != nil {
			fail(400, e)
			return
		}
		source, e := m.runner().Identify(r.Context(), src)
		if e != nil {
			fail(400, e)
			return
		}
		same := len(source.Tracks) == len(j.Source.Tracks)
		if same {
			for i, t := range source.Tracks {
				old := j.Source.Tracks[i]
				if t.ID != old.ID || t.Codec != old.Codec || t.Language != old.Language {
					same = false
				}
			}
		}
		if !same {
			j.Spec.Tracks = map[int]MuxTrackSpec{}
			defaults := map[string]bool{}
			for _, t := range source.Tracks {
				def := t.Default && !defaults[t.Type]
				if def {
					defaults[t.Type] = true
				}
				j.Spec.Tracks[t.ID] = MuxTrackSpec{true, t.Language, t.Name, def, t.Forced}
			}
		}
		j.Source = source
		delete(m.checks, j.ID)
		j.Status = "draft"
		j.Message = "Review track selection"
		s.Store.muxSave(&j)
		jsonOut(w, 200, j)
		return
	}
	if r.Method == "POST" && (route == "jobs/rescan" || route == "jobs/backup") {
		f, e := m.recoveryFile(r.Context(), j)
		if e != nil {
			fail(400, e)
			return
		}
		if route == "jobs/rescan" {
			if j.Status != "needs_attention" {
				fail(409, errors.New("Mux job does not need a rescan"))
				return
			}
			if m.active != 0 || m.tool.Busy != "" {
				fail(409, errors.New("MKVToolNix is busy"))
				return
			}
			if e = m.checkPublished(r.Context(), j, f); e != nil {
				fail(400, e)
				return
			}
			http.NewResponseController(w).SetWriteDeadline(time.Now().Add(6 * time.Minute))
			workCtx, cancel := context.WithCancel(r.Context())
			m.active = j.ID
			m.cancel = cancel
			j.Status = "running"
			j.Message = "Rescanning"
			if e = s.Store.muxSave(&j); e != nil {
				m.active = 0
				m.cancel = nil
				cancel()
				fail(409, e)
				return
			}
			m.mu.Unlock()
			logCtx, closeLog, logErr := m.openJobLog(workCtx, j, true)
			if logErr != nil {
				e = logErr
			} else {
				e = m.finishSync(logCtx, &j, f)
			}
			if e != nil {
				j.Status = "needs_attention"
				j.Message = e.Error()
				muxLogLine(logCtx, "Error: "+e.Error())
				var detail *muxVerificationError
				if errors.As(e, &detail) {
					muxLogLine(logCtx, "Details: "+detail.detail)
				}
			} else {
				j.Status = "succeeded"
				j.Progress = 100
				j.Message = "Mux completed"
				muxLogLine(logCtx, "Done: Mux completed")
			}
			closeLog()
			now := time.Now().UTC().Format(time.RFC3339Nano)
			j.FinishedAt = &now
			// Persist independently of a disconnected HTTP client, bounded by server shutdown.
			storeErr := m.persistFinal(s.ctx, &j)
			cancel()
			m.mu.Lock()
			m.rememberFinal(j, storeErr)
			m.active = 0
			m.cancel = nil
			if storeErr != nil {
				fail(503, errors.New("Could not save mux job"))
				return
			}
			if e != nil {
				fail(400, e)
				return
			}
		} else {
			if j.BackupName == "" || filepath.Base(j.BackupName) != j.BackupName || !strings.HasSuffix(j.BackupName, ".scopearr-backup-"+strconv.FormatInt(j.ID, 10)) {
				fail(400, errors.New("Invalid backup"))
				return
			}
			src, e := resolveMuxJobDestination(cfg, j, f.SourcePath)
			if e != nil {
				fail(400, e)
				return
			}
			backup := filepath.Join(filepath.Dir(src), j.BackupName)
			st, e := os.Lstat(backup)
			if e != nil || !st.Mode().IsRegular() || st.Size() != j.Source.Size || !st.ModTime().Equal(j.Source.ModTime) {
				fail(400, errors.New("Backup file changed or is not reachable"))
				return
			}
			if e = os.Remove(backup); e != nil {
				fail(400, errors.New("Could not delete backup"))
				return
			}
			j.BackupName = ""
		}
		if route == "jobs/backup" {
			if e = s.Store.muxSave(&j); e != nil {
				fail(409, e)
				return
			}
		}
		jsonOut(w, 200, j)
		return
	}
	fail(405, errors.New("Endpoint or method not supported"))
}
func safeMuxLog(value string) string {
	if value == "" {
		return ""
	}
	lines := []string{}
	for _, line := range strings.Split(value, "\n") {
		if strings.HasPrefix(line, "#GUI#warning") {
			lines = append(lines, "MKVToolNix completed with a warning. Check the local mux log.")
		} else if strings.HasPrefix(line, "#GUI#error") {
			lines = append(lines, "MKVToolNix reported an error. Check the local mux log.")
		}
	}
	return strings.Join(lines, "\n")
}

func (m *MuxManager) recoveryFile(ctx context.Context, j MuxJob) (File, error) {
	if f, e := m.s.Store.muxFile(j.Service, j.FileID); e == nil && f.SourcePath != "" {
		return f, nil
	}
	var otherID int
	if e := m.s.Store.DB.QueryRow("SELECT id FROM files WHERE service=? AND media_id=? AND source_path<>'' LIMIT 1", j.Service, j.MediaID).Scan(&otherID); e != nil {
		return File{}, errors.New("Synchronize the library before recovering this job")
	}
	f, e := m.file(ctx, j.Service, otherID)
	if e != nil {
		return f, e
	}
	f.SourcePath = path.Join(path.Dir(cleanMediaPath(f.SourcePath)), j.SourceName)
	f.Size = j.Source.Size
	f.ID = j.FileID
	return f, nil
}
func (m *MuxManager) checkPublished(ctx context.Context, j MuxJob, f File) error {
	src, e := resolveMuxJobDestination(m.s.Config(), j, f.SourcePath)
	if e != nil {
		return e
	}
	final := filepath.Join(filepath.Dir(src), j.Spec.OutputName+".mkv")
	tmp := muxTemp(src, j)
	if st, e := os.Lstat(tmp); e == nil && st.Mode().IsRegular() {
		return errors.New("Verified temporary output is preserved. Restore or publish it locally before retrying the rescan")
	}
	st, e := os.Lstat(final)
	if e != nil || !st.Mode().IsRegular() {
		return errors.New("Published output is not reachable")
	}
	output, e := m.identifyOutput(ctx, m.runner(), final)
	if e != nil {
		return e
	}
	return verifyMux(j.Source, output, j.Spec)
}
