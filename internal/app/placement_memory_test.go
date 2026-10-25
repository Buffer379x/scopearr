package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

type placementSyntheticInfo130 struct {
	name string
	dir  bool
}

func (f placementSyntheticInfo130) Name() string { return f.name }
func (f placementSyntheticInfo130) Size() int64  { return 1024 }
func (f placementSyntheticInfo130) Mode() os.FileMode {
	if f.dir {
		return os.ModeDir | 0755
	}
	return 0644
}
func (f placementSyntheticInfo130) ModTime() time.Time { return time.Unix(1700000000, 0) }
func (f placementSyntheticInfo130) IsDir() bool        { return f.dir }
func (f placementSyntheticInfo130) Sys() any           { return &syscall.Stat_t{Uid: 99, Gid: 100} }

type placementSyntheticFS130 struct {
	limit bool
	files int
}

func (f *placementSyntheticFS130) EvalSymlinks(path string) (string, error) { return path, nil }
func (f *placementSyntheticFS130) Lstat(path string) (os.FileInfo, error) {
	return placementSyntheticInfo130{filepath.Base(path), true}, nil
}
func (f *placementSyntheticFS130) ReadDir(path string) ([]os.DirEntry, error) {
	disk, _ := strconv.Atoi(strings.TrimPrefix(filepath.Base(filepath.Dir(path)), "disk"))
	out := []os.DirEntry{}
	for n := 0; n < 20000; n++ {
		if disk == (n%8)+1 || n%20 == 0 && disk == ((n+1)%8)+1 {
			out = append(out, fs.FileInfoToDirEntry(placementSyntheticInfo130{fmt.Sprintf("Film-%05d", n), true}))
		}
	}
	return out, nil
}
func (f *placementSyntheticFS130) WalkDir(path string, walk fs.WalkDirFunc) error {
	if e := walk(path, fs.FileInfoToDirEntry(placementSyntheticInfo130{filepath.Base(path), true}), nil); e != nil {
		return e
	}
	n, _ := strconv.Atoi(strings.TrimPrefix(filepath.Base(path), "Film-"))
	disk, _ := strconv.Atoi(strings.TrimPrefix(filepath.Base(filepath.Dir(filepath.Dir(path))), "disk"))
	count := 7 + n%2
	start := 0
	if n%20 == 0 {
		if disk == n%8+1 {
			count--
		} else {
			start = count - 1
			count = 1
		}
	}
	if f.limit {
		count = placementFileLimit + 1
	}
	for k := start; k < start+count; k++ {
		name := fmt.Sprintf("file-%d.nfo", k)
		if e := walk(filepath.Join(path, name), fs.FileInfoToDirEntry(placementSyntheticInfo130{name, false}), nil); e != nil {
			if e == fs.SkipAll {
				return nil
			}
			return e
		}
		f.files++
	}
	return nil
}

func TestPlacementMetadataMemory130(t *testing.T) {
	access := placementAccess
	accessCalls := 0
	placementAccess = func(string, uint32) error { accessCalls++; return nil }
	defer func() { placementAccess = access }()

	s, cfg := placementFixture130(t)
	for n := 1; n <= 8; n++ {
		if e := os.MkdirAll(filepath.Join(cfg.Unraid.DiskRoot, fmt.Sprintf("disk%d", n)), 0755); e != nil {
			t.Fatal(e)
		}
	}
	if e := os.RemoveAll(filepath.Join(cfg.Unraid.DiskRoot, "cache")); e != nil {
		t.Fatal(e)
	}
	arr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Share-first scans read root folders separately from the media list.
		if strings.HasSuffix(r.URL.Path, "rootfolder") {
			w.Write([]byte(`[{"path":"/arr/movies"}]`))
			return
		}
		w.Write([]byte("["))
		for n := 0; n < 20000; n++ {
			if n > 0 {
				w.Write([]byte(","))
			}
			json.NewEncoder(w).Encode(map[string]any{"id": n + 1, "title": fmt.Sprintf("Film-%05d", n), "path": fmt.Sprintf("/arr/movies/Film-%05d", n)})
		}
		w.Write([]byte("]"))
	}))
	defer arr.Close()
	cfg.Instances[0].URL = arr.URL
	setTestSettings(s, cfg)
	metadata := &placementSyntheticFS130{}
	s.Placement.metadata = metadata
	old := debug.SetMemoryLimit(64 << 20)
	defer debug.SetMemoryLimit(old)
	runtime.GC()
	var peak uint64
	done := make(chan struct{})
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		tick := time.NewTicker(time.Millisecond)
		defer tick.Stop()
		for {
			var st runtime.MemStats
			runtime.ReadMemStats(&st)
			peak = max(peak, st.HeapAlloc)
			select {
			case <-done:
				return
			case <-tick.C:
			}
		}
	}()
	s.Placement.runScan(context.Background(), cfg)
	close(done)
	<-finished
	scan := s.Placement.scanStatus()
	// Only the 1,000 multi-device folders retain full metadata (7 files each).
	// Compact one-device probes stop at the first entry with fs.SkipAll.
	t.Logf("items=%d files=%d split=%d access_calls=%d peak_heap_mib=%.2f", scan.Checked, metadata.files, scan.Several, accessCalls, float64(peak)/(1<<20))
	if accessCalls != 2000 {
		t.Errorf("access calls=%d want2000 (only 1000 outside-target source files)", accessCalls)
	}
	if scan.Error != "" || scan.Checked != 20000 || metadata.files != 7000 || scan.Several != 1000 || scan.OK != 19000 {
		t.Fatal(scan, metadata.files)
	}
	if peak >= 64<<20 {
		t.Fatalf("heap limit exceeded: %.2f MiB", float64(peak)/(1<<20))
	}
	// The interface cannot open media. A single excessively large item also
	// fails before any staged result replaces the existing result.
	metadata.limit = true
	_, e := s.Placement.inspectItem(context.Background(), cfg.Unraid, []UnraidDisk{{Name: "disk1", Kind: "array"}}, PlacementItem{Rel: "movies/Film-00000"}, placementParents{})
	if e != errPlacementLimit {
		t.Fatal(e)
	}
}
