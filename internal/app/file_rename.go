package app

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"time"
)

type renameRequest struct {
	Service        string   `json:"service"`
	FileID         int      `json:"fileId"`
	Name           string   `json:"name"`
	Companions     bool     `json:"companions"`
	CompanionNames []string `json:"companionNames"`
}
type renamePlan struct {
	file                             File
	src, dst, oldArrPath, newArrPath string
	companions                       []companion
}

func (s *Server) prepareRename(ctx context.Context, in renameRequest) (renamePlan, int, error) {
	p := renamePlan{}
	cfg := s.Config()
	c := cfg.GetService(in.Service)
	fail := func(status int, msg string) (renamePlan, int, error) { return p, status, errors.New(msg) }
	if !cfg.Mux.Enabled {
		return fail(400, "Renaming requires the media mount and path mapping under Settings → Services → MKVToolNix")
	}
	if !serviceOK(in.Service) || !c.Enabled {
		return fail(400, "Invalid library service")
	}
	f, e := s.Store.muxFile(in.Service, in.FileID)
	if e != nil || f.SourcePath == "" {
		return fail(400, "File is no longer in Radarr/Sonarr")
	}
	var jobs int
	if e = s.Store.DB.QueryRow("SELECT count(*) FROM mux_jobs WHERE service=? AND file_id=?", in.Service, in.FileID).Scan(&jobs); e != nil {
		return fail(500, "Could not read mux jobs")
	}
	if jobs > 0 {
		return fail(409, "Remove the mux job for this file first")
	}
	// Validate the entire stem, preserving literal dots and the source extension.
	if len(in.Name) > 200 {
		return fail(400, "Invalid output filename")
	}
	if _, e = muxOutputName(in.Name); e != nil {
		return fail(400, "Invalid output filename")
	}
	ext := filepath.Ext(f.SourcePath)
	newBase := in.Name + ext
	if !validCompanionName(newBase) {
		return fail(400, "Invalid output filename")
	}
	if newBase == path.Base(cleanMediaPath(f.SourcePath)) {
		return fail(400, "The filename is unchanged")
	}
	src, e := resolveLocalPath(cfg.Mux, in.Service, f.SourcePath)
	if e != nil {
		return p, 400, e
	}
	candidate, e := resolveMuxDestination(cfg.Mux, in.Service, f.SourcePath)
	if e != nil {
		return p, 400, e
	}
	st, e := os.Lstat(candidate)
	if e != nil || !st.Mode().IsRegular() {
		return fail(400, "Media file is not reachable")
	}
	check := checkMuxFile(src, f.Size, MuxSource{})
	check.FreeSpace = true // Renaming consumes no additional media-file storage.
	if reason := muxCheckReason(check); reason != "" {
		return fail(400, reason)
	}
	dst := filepath.Join(filepath.Dir(src), newBase)
	if targetConflict(src, dst) {
		return fail(409, "A target name already exists")
	}
	client := NewArr(c)
	if e = arrFileUnchanged(ctx, client, in.FileID, f); e != nil {
		return p, 400, e
	}
	// Radarr associates any supported video basename inside the movie directory with that movie.
	if serviceKind(in.Service) == "sonarr" {
		var parsed struct {
			Series struct {
				ID int `json:"id"`
			} `json:"series"`
			Episodes []struct {
				ID int `json:"id"`
			} `json:"episodes"`
		}
		e = client.get(ctx, "parse", url.Values{"title": {newBase}}, &parsed)
		expected, actual := []int{}, []int{}
		for _, ep := range f.Episodes {
			expected = append(expected, ep.ID)
		}
		for _, ep := range parsed.Episodes {
			actual = append(actual, ep.ID)
		}
		sort.Ints(expected)
		sort.Ints(actual)
		if e != nil || parsed.Series.ID != f.MediaID || len(expected) == 0 || expected[0] <= 0 || !reflect.DeepEqual(expected, actual) {
			return fail(400, "Sonarr cannot match the new filename to the same episodes. Keep the season/episode number in the name.")
		}
	}
	companions, e := findCompanions(filepath.Dir(src), strings.TrimSuffix(filepath.Base(src), filepath.Ext(src)), in.Name)
	if e != nil {
		return p, 400, e
	}
	return renamePlan{f, src, dst, f.SourcePath, path.Join(path.Dir(cleanMediaPath(f.SourcePath)), newBase), companions}, 200, nil
}
func (s *Server) renameHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		w.WriteHeader(405)
		return
	}
	if s.Demo {
		failure(w, r, 403, errors.New("File renaming is disabled in demo mode"))
		return
	}
	if !s.renameMu.TryLock() {
		failure(w, r, 409, errors.New("Another rename is in progress"))
		return
	}
	defer s.renameMu.Unlock()
	var in renameRequest
	if e := decode(w, r, &in); e != nil {
		failure(w, r, 400, e)
		return
	}
	p, status, e := s.prepareRename(r.Context(), in)
	if e != nil {
		failure(w, r, status, e)
		return
	}
	if r.URL.Path == "/api/files/rename/preview" {
		jsonOut(w, 200, map[string]any{"filename": filepath.Base(p.dst), "companions": p.companions})
		return
	}
	moves := []companion{{filepath.Base(p.src), filepath.Base(p.dst), false}}
	if in.Companions {
		names := []string{}
		for _, c := range p.companions {
			names = append(names, c.From)
		}
		confirmed := append([]string{}, in.CompanionNames...)
		sort.Strings(confirmed)
		if !reflect.DeepEqual(names, confirmed) {
			failure(w, r, 409, errors.New("Companion files changed. Review them again"))
			return
		}
		for _, c := range p.companions {
			if c.Conflict {
				failure(w, r, 409, errors.New("A target name already exists"))
				return
			}
		}
		moves = append(moves, p.companions...)
	}
	moveFile := renameNoReplace
	if s.testRenameFS != nil {
		moveFile = s.testRenameFS.move
	}
	completed := []companion{}
	dir := filepath.Dir(p.src)
	for _, move := range moves {
		if e = moveFile(filepath.Join(dir, move.From), filepath.Join(dir, move.To)); e != nil {
			failed := []string{}
			var incomplete *renameIncomplete
			if errors.As(e, &incomplete) {
				failed = append(failed, move.From+" → "+move.To)
			}
			for i := len(completed) - 1; i >= 0; i-- {
				v := completed[i]
				if undo := moveFile(filepath.Join(dir, v.To), filepath.Join(dir, v.From)); undo != nil {
					failed = append(failed, v.From+" → "+v.To)
				}
			}
			if len(failed) > 0 {
				s.Store.Events.Error("rename", in.Service, "Rename rollback failed", nil, filepath.Base(p.src), strings.Join(failed, ", "))
				jsonOut(w, 500, map[string]any{"error": localizedMessage(requestLocale(r), "Rename rollback failed. Check these files manually.") + " " + strings.Join(failed, ", ")})
				return
			}
			message := localizedMessage(requestLocale(r), "Could not rename companion file {name}. All changes were reverted.")
			if len(completed) == 0 {
				failure(w, r, 400, errors.New("Could not rename the media file"))
			} else {
				jsonOut(w, 400, map[string]string{"error": strings.ReplaceAll(message, "{name}", move.From)})
			}
			return
		}
		completed = append(completed, move)
	}
	s.Store.Events.Info("rename", in.Service, "File renamed to {name}", map[string]any{"name": filepath.Base(p.dst)}, filepath.Base(p.src))
	http.NewResponseController(w).SetWriteDeadline(time.Now().Add(6 * time.Minute))
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 6*time.Minute)
	defer cancel()
	stop := context.AfterFunc(s.ctx, cancel)
	defer stop()
	e = s.Mux.refreshAfterFileChange(ctx, in.Service, p.file.MediaID, p.oldArrPath, p.newArrPath)
	refresh, warning := "completed", ""
	if e != nil {
		refresh = "failed"
		warning = "File renamed, but service refresh failed. Synchronize the library manually."
		var pending *fileRefreshTimeout
		if errors.As(e, &pending) {
			refresh = "pending"
			warning = "File renamed. " + muxServiceName(in.Service) + " has not finished the rescan yet; the library updates afterwards."
		}
		// A durable delayed delta still refreshes the cache when Arr finishes after the HTTP wait.
		c := s.Config().GetService(in.Service)
		waitID := 0
		if pending != nil {
			waitID = pending.commandID
		}
		if err := s.Webhooks.Enqueue(WebhookJob{WaitCommandID: waitID, Service: in.Service, MediaID: p.file.MediaID, All: true, InternalMux: true, Source: tagEndpoint(c), Next: time.Now().Add(30 * time.Second)}); err != nil {
			refresh = "failed"
			warning = "File renamed, but service refresh failed. Synchronize the library manually."
		}
		if err := s.Mux.notifyFileChange(ctx, s.Config(), in.Service, p.oldArrPath, p.newArrPath); err != nil {
			s.Store.Events.Warning("rename", in.Service, "Media server notification failed after renaming", nil, filepath.Base(p.dst), "")
		}
		s.Store.Events.Warning("rename", in.Service, "Service refresh incomplete after renaming", nil, filepath.Base(p.dst), redactMuxLine(e.Error(), []string{p.src, p.dst, p.oldArrPath, p.newArrPath}))
	}
	renamed := []string{}
	for _, v := range completed[1:] {
		renamed = append(renamed, v.To)
	}
	jsonOut(w, 200, map[string]any{"renamed": true, "filename": filepath.Base(p.dst), "companions": renamed, "refresh": refresh, "warning": warning})
}
