package app

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

type unraidServiceStatus struct {
	Enabled  bool         `json:"enabled"`
	Ready    bool         `json:"ready"`
	Error    string       `json:"error,omitempty"`
	Disks    []UnraidDisk `json:"disks"`
	State    UnraidState  `json:"state"`
	FileWork string       `json:"fileWork"`
}

func (s *Server) unraidStatus() unraidServiceStatus {
	cfg := s.Config()
	out := unraidServiceStatus{Enabled: cfg.Unraid.Enabled, Disks: []UnraidDisk{}, State: readUnraidState(cfg.Unraid), FileWork: s.fileWork.current()}
	if e := placementPrerequisite(cfg); e != nil {
		out.Error = e.Error()
		return out
	}
	disks, e := discoverDisks(cfg.Unraid.DiskRoot)
	if e != nil {
		out.Error = e.Error()
		return out
	}
	arrays := 0
	for n := range disks {
		disks[n].Excluded = slices.Contains(cfg.Unraid.ExcludedDisks, disks[n].Name)
		if disks[n].Kind == "array" {
			arrays++
		}
	}
	out.Disks = disks
	if arrays == 0 {
		out.Error = "No Unraid array disks found"
		return out
	}
	out.Ready = true
	return out
}

type UnraidPathCheck struct {
	Root     bool         `json:"root"`
	Share    bool         `json:"share"`
	Checked  int          `json:"checked"`
	Found    int          `json:"found"`
	Disks    []UnraidDisk `json:"disks"`
	State    UnraidState  `json:"state"`
	Warnings []string     `json:"warnings"`
	Error    string       `json:"error,omitempty"`
}

func (s *Server) unraidHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/api/unraid/shares" || r.URL.Path == "/api/unraid/share-dirs" {
		s.shareRootsHTTP(w, r)
		return
	}
	if r.URL.Path == "/api/unraid/mappings/apply" && r.Method == "POST" {
		s.applyRootMappings(w, r)
		return
	}
	if r.URL.Path == "/api/unraid/status" && r.Method == "GET" {
		jsonOut(w, 200, s.unraidStatus())
		return
	}
	if r.URL.Path != "/api/unraid/check" || r.Method != "POST" {
		failure(w, r, 405, errors.New("Endpoint or method not supported"))
		return
	}
	if s.Demo {
		failure(w, r, 403, errors.New("Unraid operations are disabled in demo mode"))
		return
	}
	cfg := s.Config()
	var draft UnraidSettings
	if e := decode(w, r, &draft); e != nil {
		failure(w, r, 400, e)
		return
	}
	cfg.Unraid = draft
	if e := normalizeUnraid(&cfg); e != nil {
		failure(w, r, 400, e)
		return
	}
	result := UnraidPathCheck{Disks: []UnraidDisk{}, Warnings: []string{}, State: readUnraidState(cfg.Unraid)}
	disks, e := discoverDisks(cfg.Unraid.DiskRoot)
	if e != nil {
		result.Error = e.Error()
		jsonOut(w, 200, result)
		return
	}
	arrays := 0
	for n := range disks {
		if disks[n].Kind == "array" {
			arrays++
		}
		disks[n].Writable = muxDirWritable(filepath.Join(cfg.Unraid.DiskRoot, disks[n].Name))
		disks[n].Excluded = slices.Contains(cfg.Unraid.ExcludedDisks, disks[n].Name)
		if !disks[n].Writable {
			result.Warnings = append(result.Warnings, disks[n].Name+": Moving and same-disk mux output need read-write access")
		}
	}
	result.Disks = disks
	result.Root = arrays > 0
	if !result.Root {
		result.Error = "No Unraid array disks found"
	}
	st, e := os.Stat(cfg.Unraid.ShareRoot)
	result.Share = e == nil && st.IsDir()
	if !result.Share {
		result.Error = "User share root is not reachable"
	}
	rows, e := s.Store.DB.QueryContext(r.Context(), "SELECT service,source_path FROM files WHERE source_path<>'' ORDER BY service,id LIMIT 5")
	type sample struct{ id, path string }
	samples := []sample{}
	if e == nil {
		for rows.Next() {
			var v sample
			if rows.Scan(&v.id, &v.path) == nil {
				samples = append(samples, v)
			}
		}
		rows.Close()
	}
	if strings.TrimSpace(cfg.Mux.Mappings) == "" {
		samples = nil
	}
	for _, v := range samples {
		result.Checked++
		local, e := resolveLocalPath(cfg.Mux, v.id, v.path)
		if e != nil {
			continue
		}
		rel, e := placementRel(cfg.Unraid.ShareRoot, local)
		if e != nil {
			continue
		}
		st, e := os.Lstat(local)
		if e != nil || !st.Mode().IsRegular() {
			continue
		}
		matches := 0
		for _, disk := range disks {
			other, e := os.Lstat(filepath.Join(cfg.Unraid.DiskRoot, disk.Name, rel))
			if e == nil && other.Mode().IsRegular() && other.Size() == st.Size() && other.ModTime().Equal(st.ModTime()) {
				matches++
			}
		}
		if matches == 1 {
			result.Found++
		}
	}
	if strings.TrimSpace(cfg.Mux.Mappings) == "" {
		result.Warnings = append(result.Warnings, "Without path mappings the share-to-disk check is skipped")
	} else if result.Checked == 0 {
		result.Warnings = append(result.Warnings, "No cached media files available for the share-to-disk check")
	} else if result.Found == 0 {
		result.Error = "Share root and disk root do not belong to the same Unraid system"
	}
	if result.State.Warning != "" {
		result.Warnings = append(result.Warnings, result.State.Warning)
	}
	jsonOut(w, 200, result)
}
