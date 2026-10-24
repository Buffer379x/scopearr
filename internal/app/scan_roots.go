package app

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

// Root coverage is shared by the two manual scanners. It never changes their
// traversal or starts a scan; suggestions come only from the existing checker.
type ScanRoot struct {
	muxRootFolder
	Share         string `json:"share"`
	Items         int    `json:"items"`
	Skipped       int    `json:"skipped"`
	DiskRel       string `json:"diskRel"`
	PathWarning   string `json:"pathWarning"`
	Scanned       int    `json:"scanned"`
	OneDisk       int    `json:"one_disk"`
	SeveralDisks  int    `json:"several_disks"`
	SeasonsSpread int    `json:"seasons_spread"`
	NotFound      int    `json:"not_found"`
	OutsideShare  int    `json:"outside_share"`
	Errors        int    `json:"errors"`
	Unselected    int    `json:"unselected"`
	pathBlocked   bool
}

func cloneScanRoots(roots []ScanRoot) []ScanRoot {
	out := slices.Clone(roots)
	for n := range out {
		out[n].Instances = slices.Clone(out[n].Instances)
		out[n].InstanceIDs = slices.Clone(out[n].InstanceIDs)
	}
	return out
}
func (s *Server) coveredRoots(ctx context.Context, cfg Settings, libraries []string, folders []arrFolder) []ScanRoot {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	roots := s.muxRootFolders(ctx, cfg.Mux.Mappings)
	out := []ScanRoot{}
	for _, root := range roots.Folders {
		row := ScanRoot{muxRootFolder: root}
		if rel, e := placementRel(cfg.Unraid.ShareRoot, root.LocalPath); root.Mapped && e == nil {
			row.Share = strings.Split(filepath.ToSlash(rel), "/")[0]
			row.DiskRel, row.PathWarning, row.pathBlocked = placementRootPath(ctx, cfg.Unraid, root.LocalPath, rel)
			if row.DiskRel != "" {
				row.Share = strings.Split(filepath.ToSlash(row.DiskRel), "/")[0]
			}
		}
		out = append(out, row)
	}
	// Retain provenance before any physical path remapping. IDs, never labels,
	// disambiguate overlapping roots from separate Arr instances.
	for n := range folders {
		folders[n].rootKey = scanRootKey(out, folders[n])
		if root := scanRootByKey(out, folders[n].rootKey); root != nil {
			root.Items++
		}
	}
	// Excluded libraries still contribute to "From Arr". Their availability
	// must not prevent an explicitly selected library from being scanned.
	if len(libraries) > 0 {
		for _, c := range cfg.ArrInstances() {
			if !c.Enabled || slices.Contains(libraries, c.ID) {
				continue
			}
			extra, err := s.arrFolders(ctx, cfg, []string{c.ID})
			if err != nil {
				continue
			}
			for _, folder := range extra {
				if root := scanRootByKey(out, scanRootKey(out, folder)); root != nil {
					root.Items++
					root.Unselected++
				}
			}
		}
	}
	return out
}

func scanRootKey(roots []ScanRoot, folder arrFolder) string {
	key := ""
	for _, root := range roots {
		if slices.Contains(root.InstanceIDs, folder.Service) && pathWithin(root.ArrPath, folder.Source) && len(root.ArrPath) > len(key) {
			key = root.ArrPath
		}
	}
	return key
}
func scanRootByKey(roots []ScanRoot, key string) *ScanRoot {
	if key == "" {
		return nil
	}
	for n := range roots {
		if roots[n].ArrPath == key {
			return &roots[n]
		}
	}
	return nil
}

// Compare directory identity only. Bound discovery to normal shares and one
// nested directory; neither media file contents nor arbitrary trees are read.
func placementRootPath(ctx context.Context, u UnraidSettings, local, rel string) (string, string, bool) {
	user := filepath.Join(u.DiskRoot, "user")
	info, err := os.Stat(local)
	warning := "Container path " + local + " was not found under " + user
	if err != nil || !info.IsDir() {
		return rel, warning, false
	}
	parts := strings.Split(filepath.ToSlash(rel), "/")
	allowed := func(name string) bool { return !unraidExcludedRoot(name) && !strings.EqualFold(name, "system") }
	if !allowed(parts[0]) {
		return "", warning, true
	}
	expected := filepath.Join(user, rel)
	// A direct symlink name is not a disk share name: discover its real alias.
	if st, e := os.Lstat(expected); e == nil && st.IsDir() && os.SameFile(info, st) {
		return rel, "", false
	}
	entries, err := os.ReadDir(user)
	if err != nil {
		return rel, warning, false
	}
	matches := []string{}
	for _, entry := range entries {
		if ctx.Err() != nil {
			break
		}
		if !entry.IsDir() || !allowed(entry.Name()) {
			continue
		}
		path := filepath.Join(user, entry.Name())
		if st, e := os.Stat(path); e == nil && st.IsDir() && os.SameFile(info, st) {
			matches = append(matches, entry.Name())
		}
		children, e := os.ReadDir(path)
		if e != nil {
			continue
		}
		for _, child := range children {
			if ctx.Err() != nil {
				break
			}
			if !child.IsDir() || strings.HasPrefix(child.Name(), ".") {
				continue
			}
			candidate := filepath.Join(path, child.Name())
			if st, e := os.Stat(candidate); e == nil && st.IsDir() && os.SameFile(info, st) {
				matches = append(matches, filepath.Join(entry.Name(), child.Name()))
			}
		}
	}
	if len(matches) == 1 {
		return matches[0], "Container path " + local + " corresponds to " + filepath.Join(user, matches[0]), false
	}
	if len(matches) > 1 {
		return "", "Container path " + local + " matches multiple share directories; no replacement was selected", true
	}
	return rel, warning, false
}
func (s *Server) applyRootMappings(w http.ResponseWriter, r *http.Request) {
	if s.Demo {
		failure(w, r, 403, errors.New("Unraid operations are disabled in demo mode"))
		return
	}
	var in struct {
		Roots []string `json:"roots"`
		All   bool     `json:"all"`
	}
	if e := decode(w, r, &in); e != nil {
		failure(w, r, 400, e)
		return
	}
	s.settingsMu.Lock()
	defer s.settingsMu.Unlock()
	cfg := s.Config()
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	roots := s.muxRootFolders(ctx, cfg.Mux.Mappings)
	proposals := map[string]string{}
	for _, root := range roots.Folders {
		if !root.Mapped && root.Suggestion != "" {
			proposals[root.ArrPath] = root.Suggestion
		}
	}
	if in.All {
		in.Roots = nil
		for root := range proposals {
			in.Roots = append(in.Roots, root)
		}
		slices.Sort(in.Roots)
	}
	if len(in.Roots) == 0 {
		failure(w, r, 400, errors.New("No path mapping suggestions available"))
		return
	}
	seen := map[string]bool{}
	for _, root := range in.Roots {
		suggestion, ok := proposals[root]
		if !ok {
			failure(w, r, 400, errors.New("Invalid path mapping suggestion"))
			return
		}
		if !seen[root] {
			cfg.Mux.Mappings = strings.TrimSpace(cfg.Mux.Mappings) + "\n" + root + " => " + suggestion
			seen[root] = true
		}
	}
	if e := normalizeMux(&cfg); e != nil {
		failure(w, r, 400, e)
		return
	}
	// Same lock order as settings publication and queue startup.
	s.Mux.mu.Lock()
	defer s.Mux.mu.Unlock()
	s.Placement.mu.Lock()
	defer s.Placement.mu.Unlock()
	s.FileCheck.mu.Lock()
	defer s.FileCheck.mu.Unlock()
	active, e := s.Store.placementActive()
	var muxActive, filesActive int
	if e == nil {
		e = s.Store.DB.QueryRowContext(r.Context(), "SELECT count(*) FROM mux_jobs WHERE status IN ('queued','running')").Scan(&muxActive)
	}
	if e == nil {
		e = s.Store.DB.QueryRowContext(r.Context(), "SELECT count(*) FROM filecheck_items WHERE job_status IN ('queued','running')").Scan(&filesActive)
	}
	if e != nil {
		failure(w, r, 500, errors.New("Could not read move queue"))
		return
	}
	if active || muxActive > 0 || filesActive > 0 || s.Mux.active != 0 || len(s.Mux.pendingFinal) > 0 || s.Placement.scan.Running || s.Placement.pendingFinal != nil || s.FileCheck.scan.Running || s.fileWork.current() != "" {
		failure(w, r, 409, errors.New("Finish or cancel file work before applying mappings"))
		return
	}
	if e = s.Store.Put("settings", cfg); e != nil {
		failure(w, r, 500, errors.New("Could not save settings"))
		return
	}
	s.mu.Lock()
	s.settings = cfg
	s.mu.Unlock()
	jsonOut(w, 200, map[string]bool{"ok": true})
}
