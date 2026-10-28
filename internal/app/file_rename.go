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
	locations                        map[string]renameLocation
	unraid                           *UnraidSettings
	localFolder                      string
}

type renameLocation struct {
	src, dst, device string
	physical         bool
}

type renameCompanionPreview struct {
	companion
	Device string `json:"device"`
}

const renameSeveralDisks = "This file exists on several disks. Consolidate the folder in Disk placement first."
const renameDeviceCheckFailed = "File renamed, but folder locations could not be checked. Check Disk placement manually."
const renameNewDevices = "After renaming, the folder also exists on {devices}. Radarr/Sonarr or a media server wrote new files there. Use Disk placement to consolidate it."

// Only the directories are inspected; a service may create new metadata during
// its refresh, but reading their contents is unnecessary to detect new devices.
func renameFolderDevices(u UnraidSettings, localFolder string) ([]string, error) {
	rel, err := filepath.Rel(u.ShareRoot, localFolder)
	if err != nil || rel != "." && !validPlacementRel(rel) {
		return nil, errors.New("Folder is outside the user share")
	}
	disks, err := discoverDisks(u.DiskRoot)
	if err != nil {
		return nil, err
	}
	devices := []string{}
	for _, disk := range disks {
		info, err := os.Lstat(filepath.Join(u.DiskRoot, disk.Name, rel))
		if err == nil && info.IsDir() {
			devices = append(devices, disk.Name)
		} else if err != nil && !os.IsNotExist(err) {
			return nil, errors.New("Unraid disk root is not reachable")
		}
	}
	return devices, nil
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
	src, e := resolveLocalPath(cfg.Mux, f.SourcePath)
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
	local := src
	p.localFolder = filepath.Dir(local)
	device := ""
	physical := false
	if cfg.Unraid.Enabled && unraidPrerequisite(cfg) == nil {
		p.unraid = &cfg.Unraid
		src, device, e = resolveDiskPath(cfg.Unraid, local)
		if errors.Is(e, errMuxSeveralDisks) {
			return fail(409, renameSeveralDisks)
		}
		if e != nil {
			return p, 400, e
		}
		physical = device != muxDiskFallback
		if !physical {
			device = ""
		}
	}
	check := checkMuxFile(src, f.Size, MuxSource{})
	check.FreeSpace = true // Renaming consumes no additional media-file storage.
	if reason := muxCheckReason(check); reason != "" {
		return fail(400, reason)
	}
	dst := filepath.Join(filepath.Dir(src), newBase)
	if targetConflict(src, dst) || targetConflict(local, filepath.Join(filepath.Dir(local), newBase)) {
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
	companions, e := findCompanions(filepath.Dir(local), strings.TrimSuffix(filepath.Base(local), filepath.Ext(local)), in.Name)
	if e != nil {
		return p, 400, e
	}
	p.file, p.src, p.dst = f, src, dst
	p.oldArrPath, p.newArrPath = f.SourcePath, path.Join(path.Dir(cleanMediaPath(f.SourcePath)), newBase)
	p.companions = companions
	p.locations = map[string]renameLocation{filepath.Base(src): {src, dst, device, physical}}
	for i, companion := range p.companions {
		from, disk := filepath.Join(filepath.Dir(local), companion.From), ""
		onDisk := false
		if p.unraid != nil {
			from, disk, e = resolveDiskPath(*p.unraid, from)
			if errors.Is(e, errMuxSeveralDisks) {
				return fail(409, renameSeveralDisks)
			}
			if e != nil {
				return p, 400, e
			}
			onDisk = disk != muxDiskFallback
			if !onDisk {
				disk = ""
			}
		}
		to := filepath.Join(filepath.Dir(from), companion.To)
		p.locations[companion.From] = renameLocation{from, to, disk, onDisk}
		p.companions[i].Conflict = companion.Conflict || targetConflict(from, to)
	}
	return p, 200, nil
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
		companions := []renameCompanionPreview{}
		for _, companion := range p.companions {
			companions = append(companions, renameCompanionPreview{companion, p.locations[companion.From].device})
		}
		location := p.locations[filepath.Base(p.src)]
		jsonOut(w, 200, map[string]any{"filename": filepath.Base(p.dst), "companions": companions, "device": location.device, "userShare": !location.physical})
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
	fs := defaultRenameFS()
	if s.testRenameFS != nil {
		fs = *s.testRenameFS
	}
	before := []string{}
	if p.unraid != nil {
		before, e = renameFolderDevices(*p.unraid, p.localFolder)
		if e != nil {
			failure(w, r, 400, e)
			return
		}
	}
	completed := []companion{}
	for _, move := range moves {
		location := p.locations[move.From]
		if e = fs.moveOnDevice(location.src, location.dst, location.physical); e != nil {
			failed := []string{}
			var incomplete *renameIncomplete
			if errors.As(e, &incomplete) {
				failed = append(failed, move.From+" → "+move.To)
			}
			for i := len(completed) - 1; i >= 0; i-- {
				v := completed[i]
				previous := p.locations[v.From]
				if undo := fs.moveOnDevice(previous.dst, previous.src, previous.physical); undo != nil {
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
	if err := s.Store.renameMediaInfo(r.Context(), in.Service, p.file.ID, p.newArrPath); err != nil {
		s.Store.Events.Warning("rename", in.Service, "Could not retain MediaInfo after renaming", nil, p.file.Title, err.Error())
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
	newDevices := []string{}
	if refresh == "completed" && p.unraid != nil {
		after, err := renameFolderDevices(*p.unraid, p.localFolder)
		if err != nil {
			s.Store.Events.Warning("rename", in.Service, renameDeviceCheckFailed, nil, filepath.Base(p.dst), "")
			warning = localizedMessage(requestLocale(r), renameDeviceCheckFailed)
		} else {
			known := map[string]bool{}
			for _, device := range before {
				known[device] = true
			}
			for _, device := range after {
				if !known[device] {
					newDevices = append(newDevices, device)
				}
			}
			if len(newDevices) > 0 {
				devices := strings.Join(newDevices, ", ")
				s.Store.Events.Warning("rename", in.Service, renameNewDevices, map[string]any{"devices": devices}, filepath.Base(p.dst), "")
				warning = strings.TrimSpace(warning + " " + strings.ReplaceAll(localizedMessage(requestLocale(r), renameNewDevices), "{devices}", devices))
			}
		}
	}
	renamed := []string{}
	for _, v := range completed[1:] {
		renamed = append(renamed, v.To)
	}
	jsonOut(w, 200, map[string]any{"renamed": true, "filename": filepath.Base(p.dst), "companions": renamed, "refresh": refresh, "warning": warning, "newDevices": newDevices})
}
