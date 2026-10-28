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
	OutputDisk    string `json:"outputDisk,omitempty"`
	DiskConflict  bool   `json:"diskConflict,omitempty"`
	WorkWritable  bool   `json:"workWritable"`
	WorkFreeSpace bool   `json:"workFreeSpace"`
	Exists        bool   `json:"exists"`
	Readable      bool   `json:"readable"`
	Writable      bool   `json:"writable"`
	FreeSpace     bool   `json:"freeSpace"`
	SizeMatches   bool   `json:"sizeMatches"`
	Unchanged     bool   `json:"unchanged"`
}

func pathWithin(root, path string) bool {
	return root == path || strings.HasPrefix(path, root+string(filepath.Separator))
}
func resolveLocalPath(m MuxSettings, arrPath string) (string, error) {
	mappings, e := parsePathMappings(m.Mappings)
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

var muxOpenFile = os.Open

func checkMuxFile(path string, size int64, source MuxSource, workDir ...string) MuxCheck {
	return checkMuxFileAccess(path, size, source, true, workDir...)
}

func checkMuxFileAccess(path string, size int64, source MuxSource, read bool, workDir ...string) MuxCheck {
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
	if read {
		f, e := muxOpenFile(path)
		if e == nil {
			var b [1]byte
			_, e = f.Read(b[:])
			f.Close()
			c.Readable = e == nil || e == io.EOF
		}
	} else {
		c.Readable = placementAccess(path, unix.R_OK) == nil
	}

	dir := filepath.Dir(path)
	c.Writable = dirWritable(dir)
	free, e := muxSpace(dir)
	c.FreeSpace = e == nil && free >= uint64(st.Size())+(1<<30)
	return c
}
func (c MuxCheck) Ready() bool {
	return !c.DiskConflict && c.WorkWritable && c.WorkFreeSpace && c.Exists && c.Readable && c.Writable && c.FreeSpace && c.SizeMatches && c.Unchanged
}

// Match the status checklist so queue rejection names the failing prerequisite.
func muxCheckReason(c MuxCheck) string {
	switch {
	case c.DiskConflict:
		return errMuxSeveralDisks.Error()
	case !c.Exists:
		return "Media file is not reachable"
	case !c.Readable:
		return "Media file is not readable"
	case !c.Writable:
		return "Media directory is not writable"
	case !c.FreeSpace:
		return "Not enough free space in the media directory"
	case !c.WorkWritable:
		return "Mux working directory is not writable"
	case !c.WorkFreeSpace:
		return "Not enough free space in the mux working directory"
	case !c.SizeMatches:
		return "File size differs from Radarr/Sonarr"
	case !c.Unchanged:
		return "Media file changed. Identify it again"
	}
	return ""
}

// Resolve a destination through an existing parent, even after Arr has removed the original.
func resolveMuxDestination(m MuxSettings, id, arrPath string) (string, error) {
	mappings, e := parsePathMappings(m.Mappings)
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

func (m *MuxManager) cachedCheck(j MuxJob, fresh ...bool) MuxCheck {
	m.mu.Lock()
	cached, ok := m.checks[j.ID]
	m.mu.Unlock()
	if ok && !(len(fresh) > 0 && fresh[0]) && time.Since(cached.at) < 30*time.Second {
		return cached.check
	}
	c := m.checkJobAccess(j, len(fresh) > 0 && fresh[0])
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

// Never creates entries; media folders must stay untouched by checks.
func dirWritable(dir string) bool {
	real, e := filepath.EvalSymlinks(dir)
	if e != nil || muxForbidden(real) {
		return false
	}
	st, e := os.Stat(real)
	if e != nil || !st.IsDir() || st.Mode().Perm()&0222 == 0 {
		return false
	}
	return placementAccess(real, 3) == nil
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
	c.Writable = dirWritable(real)
	// Only the explicitly configured mux workspace may be write-probed.
	if c.Writable {
		probe, err := os.CreateTemp(real, ".scopearr-write-test-")
		if err != nil {
			c.Writable = false
		} else {
			closeErr := probe.Close()
			removeErr := os.Remove(probe.Name())
			c.Writable = closeErr == nil && removeErr == nil
		}
	}
	c.FreeBytes, _ = muxSpace(real)
	return c
}

func (m *MuxManager) checkJob(j MuxJob) MuxCheck { return m.checkJobAccess(j, true) }

func (m *MuxManager) checkJobAccess(j MuxJob, read bool) MuxCheck {
	c := MuxCheck{}
	if f, e := m.s.Store.muxFile(j.Service, j.FileID); e == nil {
		cfg := m.s.Config()
		if p, e := resolveLocalPath(cfg.Mux, f.SourcePath); e == nil {
			physical, disk, e := muxResolvePhysical(cfg, p)
			if errors.Is(e, errMuxSeveralDisks) {
				return MuxCheck{DiskConflict: true}
			}
			if e != nil {
				return c
			}
			c = checkMuxFileAccess(physical, f.Size, j.Source, read, cfg.Mux.WorkDir)
			c.OutputDisk = disk
		}
	}
	return c
}
