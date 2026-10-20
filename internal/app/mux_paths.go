package app

import (
	"errors"
	"golang.org/x/sys/unix"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type MuxCheck struct {
	WorkWritable  bool `json:"workWritable"`
	WorkFreeSpace bool `json:"workFreeSpace"`
	Exists        bool `json:"exists"`
	Readable      bool `json:"readable"`
	Writable      bool `json:"writable"`
	FreeSpace     bool `json:"freeSpace"`
	SizeMatches   bool `json:"sizeMatches"`
	Unchanged     bool `json:"unchanged"`
}

func pathWithin(root, path string) bool {
	return root == path || strings.HasPrefix(path, root+string(filepath.Separator))
}
func resolveLocalPath(m MuxSettings, id, arrPath string) (string, error) {
	mappings, e := parsePathMappings(m.PathMappings[id])
	if e != nil {
		return "", errors.New("Invalid mux path mapping")
	}
	for _, mapping := range mappings {
		if !pathWithin(mapping.arr, cleanMediaPath(arrPath)) {
			continue
		}
		root := filepath.Clean(mapping.emby)
		if muxForbidden(root) {
			break
		}
		realRoot, e := filepath.EvalSymlinks(root)
		if e != nil || muxForbidden(realRoot) {
			break
		}
		candidate := filepath.Clean(root + strings.TrimPrefix(cleanMediaPath(arrPath), mapping.arr))
		if !pathWithin(root, candidate) {
			break
		}
		real, e := filepath.EvalSymlinks(candidate)
		if e != nil {
			return "", errors.New("Media file is not reachable")
		}
		dir, e := filepath.EvalSymlinks(filepath.Dir(candidate))
		if e != nil || !pathWithin(realRoot, real) || !pathWithin(realRoot, dir) || muxForbidden(real) {
			return "", errors.New("Media path escapes the configured mount")
		}
		return real, nil
	}
	return "", errors.New("No usable mux path mapping")
}

var muxSpace = func(dir string) (uint64, error) {
	var st unix.Statfs_t
	e := unix.Statfs(dir, &st)
	return st.Bavail * uint64(st.Bsize), e
}

func checkMuxFile(path string, size int64, source MuxSource, workDir ...string) MuxCheck {
	c := MuxCheck{WorkWritable: true, WorkFreeSpace: true}
	if len(workDir) > 0 && workDir[0] != "" {
		w := checkMuxWorkDir(workDir[0])
		c.WorkWritable = w.Writable
		c.WorkFreeSpace = w.Exists && w.FreeBytes >= uint64(size)+(1<<30)
	}
	st, e := os.Stat(path)
	if e != nil || !st.Mode().IsRegular() {
		return c
	}
	c.Exists = true
	c.SizeMatches = st.Size() == size
	c.Unchanged = source.Size == 0 || st.Size() == source.Size && st.ModTime().Equal(source.ModTime)
	f, e := os.Open(path)
	if e == nil {
		var b [1]byte
		_, e = f.Read(b[:])
		f.Close()
		c.Readable = e == nil || e == io.EOF
	}
	dir := filepath.Dir(path)
	c.Writable = muxDirWritable(dir)
	free, e := muxSpace(dir)
	c.FreeSpace = e == nil && free >= uint64(st.Size())+(1<<30)
	return c
}
func (c MuxCheck) Ready() bool {
	return c.WorkWritable && c.WorkFreeSpace && c.Exists && c.Readable && c.Writable && c.FreeSpace && c.SizeMatches && c.Unchanged
}

// Resolve a destination through an existing parent, even after Arr has removed the original.
func resolveMuxDestination(m MuxSettings, id, arrPath string) (string, error) {
	mappings, e := parsePathMappings(m.PathMappings[id])
	if e != nil {
		return "", errors.New("Invalid mux path mapping")
	}
	for _, mapping := range mappings {
		if !pathWithin(mapping.arr, cleanMediaPath(arrPath)) {
			continue
		}
		root := filepath.Clean(mapping.emby)
		if muxForbidden(root) {
			break
		}
		realRoot, e := filepath.EvalSymlinks(root)
		if e != nil || muxForbidden(realRoot) {
			break
		}
		candidate := filepath.Clean(root + strings.TrimPrefix(cleanMediaPath(arrPath), mapping.arr))
		if !pathWithin(root, candidate) {
			break
		}
		dir, e := filepath.EvalSymlinks(filepath.Dir(candidate))
		if e != nil || !pathWithin(realRoot, dir) || muxForbidden(dir) {
			break
		}
		return filepath.Join(dir, filepath.Base(candidate)), nil
	}
	return "", errors.New("No usable mux path mapping")
}

type muxCheckCache struct {
	at    time.Time
	check MuxCheck
}

func (m *MuxManager) cachedCheck(j MuxJob) MuxCheck {
	m.mu.Lock()
	cached, ok := m.checks[j.ID]
	m.mu.Unlock()
	if ok && time.Since(cached.at) < 30*time.Second {
		return cached.check
	}
	c := MuxCheck{}
	if f, e := m.s.Store.muxFile(j.Service, j.FileID); e == nil {
		if p, e := resolveLocalPath(m.s.Config().Mux, j.Service, f.SourcePath); e == nil {
			c = checkMuxFile(p, f.Size, j.Source, m.s.Config().Mux.WorkDir)
		}
	}
	m.mu.Lock()
	if m.checks == nil {
		m.checks = map[int64]muxCheckCache{}
	}
	m.checks[j.ID] = muxCheckCache{time.Now(), c}
	m.mu.Unlock()
	return c
}

// Check the resolved directory as well: a symlink must not bypass forbidden roots.
type MuxWorkCheck struct {
	Configured bool   `json:"configured"`
	Exists     bool   `json:"exists"`
	Writable   bool   `json:"writable"`
	FreeBytes  uint64 `json:"freeBytes"`
}

func muxDirWritable(dir string) bool {
	real, e := filepath.EvalSymlinks(dir)
	if e != nil || muxForbidden(real) {
		return false
	}
	st, e := os.Stat(real)
	if e != nil || !st.IsDir() || st.Mode().Perm()&0222 == 0 {
		return false
	}
	f, e := os.CreateTemp(real, ".scopearr-write-test-")
	if e != nil {
		return false
	}
	name := f.Name()
	e = f.Close()
	return os.Remove(name) == nil && e == nil
}
func checkMuxWorkDir(dir string) MuxWorkCheck {
	c := MuxWorkCheck{Configured: dir != ""}
	if dir == "" {
		return c
	}
	real, e := filepath.EvalSymlinks(dir)
	if e != nil || muxForbidden(real) {
		return c
	}
	st, e := os.Stat(real)
	c.Exists = e == nil && st.IsDir()
	if !c.Exists {
		return c
	}
	c.Writable = muxDirWritable(real)
	c.FreeBytes, _ = muxSpace(real)
	return c
}
