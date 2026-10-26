package app

import (
	"context"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

var muxMediaRoot = "/media"

type muxSyntax struct {
	OK    bool   `json:"ok"`
	Line  int    `json:"line,omitempty"`
	Error string `json:"error,omitempty"`
}

func muxDraftMappings(value string) (string, muxSyntax) {
	valid := []string{}
	syntax := muxSyntax{OK: true}
	for i, line := range strings.Split(value, "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		trial := strings.Join(append(append([]string{}, valid...), line), "\n")
		_, e := parsePathMappings(trial)
		if e != nil {
			if syntax.OK {
				syntax = muxSyntax{false, i + 1, muxMappingError}
			}
			continue
		}
		valid = append(valid, line)
	}
	return strings.Join(valid, "\n"), syntax
}

type muxRootFolder struct {
	ArrPath     string   `json:"arrPath"`
	Instances   []string `json:"instances"`
	InstanceIDs []string `json:"instanceIds"`
	Mapped      bool     `json:"mapped"`
	LocalPath   string   `json:"localPath"`
	LocalExists bool     `json:"localExists"`
	Suggestion  string   `json:"suggestion"`
}
type muxRootError struct {
	Instance string `json:"instance"`
	Error    string `json:"error"`
}
type muxRoots struct {
	Folders []muxRootFolder `json:"rootFolders"`
	Errors  []muxRootError  `json:"errors"`
}

func mappedMuxRoot(value, root string) (string, bool) {
	mappings, _ := parsePathMappings(value)
	for _, p := range mappings {
		if pathWithin(p.arr, root) {
			return filepath.Clean(p.emby + strings.TrimPrefix(root, p.arr)), true
		}
	}
	return "", false
}
func muxDirectoryExists(p string) bool {
	real, e := filepath.EvalSymlinks(p)
	if e != nil || muxForbidden(real) {
		return false
	}
	st, e := os.Stat(real)
	return e == nil && st.IsDir()
}
func (s *Server) muxRootFolders(ctx context.Context, mappings string) muxRoots {
	out := muxRoots{Folders: []muxRootFolder{}, Errors: []muxRootError{}}
	roots := map[string]*muxRootFolder{}
	// Each instance gets its own bounded request while sharing the overall deadline.
	for _, c := range s.Config().ArrInstances() {
		if !c.Enabled {
			continue
		}
		var folders []struct {
			Path string `json:"path"`
		}
		if e := NewArr(c).get(ctx, "rootfolder", nil, &folders); e != nil {
			out.Errors = append(out.Errors, muxRootError{c.Name, "Root folders unavailable"})
			if out.Errors[len(out.Errors)-1].Instance == "" {
				out.Errors[len(out.Errors)-1].Instance = c.ID
			}
			continue
		}
		name := instanceLabel(c)
		for _, f := range folders {
			root := cleanMediaPath(f.Path)
			if root == "" || !(strings.HasPrefix(root, "/") || len(root) > 2 && root[1] == ':' && root[2] == '/') {
				continue
			}
			row := roots[root]
			if row == nil {
				row = &muxRootFolder{ArrPath: root, Instances: []string{}}
				roots[root] = row
			}
			if !containsColumn(row.InstanceIDs, c.ID) {
				row.InstanceIDs = append(row.InstanceIDs, c.ID)
			}
			if !containsColumn(row.Instances, name) {
				row.Instances = append(row.Instances, name)
			}
		}
	}
	for _, row := range roots {
		sort.Strings(row.Instances)
		row.LocalPath, row.Mapped = mappedMuxRoot(mappings, row.ArrPath)
		if row.Mapped {
			row.LocalExists = muxDirectoryExists(row.LocalPath)
		} else {
			for _, p := range []string{muxMediaRoot + row.ArrPath, filepath.Join(muxMediaRoot, filepath.Base(row.ArrPath))} {
				if muxDirectoryExists(p) {
					row.Suggestion = p
					break
				}
			}
		}
		out.Folders = append(out.Folders, *row)
	}
	sort.Slice(out.Folders, func(i, j int) bool { return out.Folders[i].ArrPath < out.Folders[j].ArrPath })
	return out
}

type muxMappingCheck struct {
	ArrPath   string `json:"arrPath"`
	LocalPath string `json:"localPath"`
	Exists    bool   `json:"exists"`
	IsDir     bool   `json:"isDir"`
	Readable  bool   `json:"readable"`
	Writable  bool   `json:"writable"`
	FreeBytes uint64 `json:"freeBytes"`
	Error     string `json:"error,omitempty"`
}

func checkMuxMapping(p pathMapping, readOnly bool) muxMappingCheck {
	c := muxMappingCheck{ArrPath: p.arr, LocalPath: p.emby}
	real, e := filepath.EvalSymlinks(p.emby)
	if muxForbidden(filepath.Clean(p.emby)) || (e == nil && muxForbidden(real)) {
		c.Error = "Media must be mounted outside Appdata and system directories"
		return c
	}
	st, e := os.Stat(p.emby)
	c.Exists = e == nil
	if e != nil {
		return c
	}
	c.IsDir = st.IsDir()
	if !c.IsDir {
		return c
	}
	if f, e := os.Open(real); e == nil {
		_, e = f.ReadDir(1)
		c.Readable = (e == nil || e == io.EOF) && st.Mode().Perm()&0444 != 0
		f.Close()
	}
	if !readOnly {
		c.Writable = muxDirWritable(real)
		c.FreeBytes, _ = muxSpace(real)
	}
	return c
}

type muxSampleCheck struct {
	Instance    string `json:"instance"`
	Checked     int    `json:"checked"`
	Reachable   int    `json:"reachable"`
	SizeMatches int    `json:"sizeMatches"`
}

func (s *Server) muxPathHTTP(w http.ResponseWriter, r *http.Request, route string) {
	var in struct {
		Mappings string `json:"mappings"`
		WorkDir  string `json:"workDir"`
	}
	if e := decode(w, r, &in); e != nil {
		failure(w, r, 400, e)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	mappings, syntax := muxDraftMappings(in.Mappings)
	roots := s.muxRootFolders(ctx, mappings)
	if route == "root-folders" {
		jsonOut(w, 200, roots)
		return
	}
	readOnly := route == "check-paths-readonly"
	checks := []muxMappingCheck{}
	parts, _ := parsePathMappings(mappings)
	for _, p := range parts {
		if ctx.Err() != nil {
			break
		}
		checks = append(checks, checkMuxMapping(p, readOnly))
	}
	samples := []muxSampleCheck{}
	m := s.Config().Mux
	m.Mappings = mappings
	m.WorkDir = in.WorkDir
	for _, c := range s.Config().ArrInstances() {
		if !c.Enabled {
			continue
		}
		name := instanceLabel(c)
		sample := muxSampleCheck{Instance: name}
		rows, e := s.Store.DB.QueryContext(ctx, "SELECT id FROM files WHERE service=? ORDER BY id LIMIT 3", c.ID)
		ids := []int{}
		if e == nil {
			for rows.Next() {
				var id int
				if rows.Scan(&id) == nil {
					ids = append(ids, id)
				}
			}
			rows.Close()
		}
		for _, id := range ids {
			if ctx.Err() != nil {
				break
			}
			sample.Checked++
			f, e := s.Store.muxFile(c.ID, id)
			if e != nil {
				continue
			}
			p, e := resolveLocalPath(m, c.ID, f.SourcePath)
			if e != nil {
				continue
			}
			st, e := os.Stat(p)
			if e == nil && st.Mode().IsRegular() {
				sample.Reachable++
				if st.Size() == f.Size {
					sample.SizeMatches++
				}
			}
		}
		samples = append(samples, sample)
	}
	work := MuxWorkCheck{}
	if !readOnly {
		work = checkMuxWorkDir(in.WorkDir)
	}
	jsonOut(w, 200, map[string]any{"readOnly": readOnly, "syntax": syntax, "mappings": checks, "rootFolders": roots.Folders, "errors": roots.Errors, "samples": samples, "workDir": work, "timedOut": ctx.Err() != nil})
}
