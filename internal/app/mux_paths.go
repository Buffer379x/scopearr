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
	Exists      bool `json:"exists"`
	Readable    bool `json:"readable"`
	Writable    bool `json:"writable"`
	FreeSpace   bool `json:"freeSpace"`
	SizeMatches bool `json:"sizeMatches"`
	Unchanged   bool `json:"unchanged"`
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

func checkMuxFile(path string, size int64, source MuxSource) MuxCheck {
	c := MuxCheck{}
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
	ds, e := os.Stat(dir)
	if e == nil && ds.Mode().Perm()&0222 != 0 {
		f, e := os.CreateTemp(dir, ".scopearr-write-test-")
		if e == nil {
			name := f.Name()
			e = f.Close()
			if os.Remove(name) == nil && e == nil {
				c.Writable = true
			}
		}
	}
	free, e := muxSpace(dir)
	c.FreeSpace = e == nil && free >= uint64(st.Size())+(1<<30)
	return c
}
func (c MuxCheck) Ready() bool {
	return c.Exists && c.Readable && c.Writable && c.FreeSpace && c.SizeMatches && c.Unchanged
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
			c = checkMuxFile(p, f.Size, j.Source)
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
