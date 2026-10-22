package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func placementFixture130(t *testing.T) (*Server, Settings) {
	t.Helper()
	if os.Geteuid() != 0 && os.Geteuid() != 99 {
		// Unprivileged CI fixtures retain their real owner. Virtualize the
		// expected container identity, while still checking source/copy equality.
		previous := placementOwner
		placementOwner = func(os.FileInfo) (uint32, uint32) { return 99, 100 }
		t.Cleanup(func() { placementOwner = previous })
	}
	base := muxTempDir120(t)
	store, e := OpenStore(filepath.Join(base, "data"))
	if e != nil {
		t.Fatal(e)
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	t.Cleanup(func() { store.DB.Close() })
	server, e := NewServer(ctx, store, nil, "1.3.0")
	if e != nil {
		t.Fatal(e)
	}
	cfg := DefaultSettings()
	cfg.Instances = []ServiceConfig{{ID: "radarr", Type: "radarr", Name: "Movies", Enabled: true}}
	cfg.Mux.Enabled = true
	cfg.Unraid.Enabled = true
	cfg.Unraid.DiskRoot = filepath.Join(base, "unraid")
	cfg.Unraid.ShareRoot = filepath.Join(base, "share")
	cfg.Unraid.ReserveGiB = 0
	cfg.Mux.Mappings = "/arr => " + cfg.Unraid.ShareRoot
	for _, p := range []string{cfg.Unraid.ShareRoot, filepath.Join(cfg.Unraid.DiskRoot, "user"), filepath.Join(cfg.Unraid.DiskRoot, "disk3"), filepath.Join(cfg.Unraid.DiskRoot, "disk6"), filepath.Join(cfg.Unraid.DiskRoot, "cache")} {
		if e = os.MkdirAll(p, 0755); e != nil {
			t.Fatal(e)
		}
	}
	old := unraidIsMount
	unraidIsMount = func(_, child string) bool { return filepath.Base(child) != "user" }
	t.Cleanup(func() { unraidIsMount = old })
	server.mu.Lock()
	server.settings = cfg
	server.mu.Unlock()
	snapshot := PlacementScan{Options: cfg.Unraid, MappingHash: placementMappingHash(cfg), FinishedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	raw, _ := json.Marshal(snapshot)
	if _, e = store.DB.Exec("INSERT INTO placement_scan(id,data)VALUES(1,?)", string(raw)); e != nil {
		t.Fatal(e)
	}
	server.Placement.scan = snapshot
	// The Go suite runs as root. Match the production UID99:GID100 for newly
	// created copies without changing the production copier or ownership checks.
	server.Placement.testCopy = func(ctx context.Context, src, dst *os.File, progress func(int64)) error {
		if e := copyPlacement(ctx, src, dst, progress); e != nil {
			return e
		}
		if os.Geteuid() == 0 {
			return dst.Chown(99, 100)
		}
		return nil
	}
	return server, cfg
}
func placementWrite130(t *testing.T, cfg Settings, disk, rel, content string) {
	t.Helper()
	path := filepath.Join(cfg.Unraid.DiskRoot, disk, "movies/Film", rel)
	if e := os.MkdirAll(filepath.Dir(path), 0750); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(path, []byte(content), 0640); e != nil {
		t.Fatal(e)
	}
	if os.Geteuid() == 0 {
		if e := os.Chown(path, 99, 100); e != nil {
			t.Fatal(e)
		}
	}
	at := time.Unix(1700000000, 123456789)
	if e := os.Chtimes(path, at, at); e != nil {
		t.Fatal(e)
	}
}
func placementPlan130(t *testing.T, s *Server, cfg Settings) PlacementItem {
	t.Helper()
	disks, e := discoverDisks(cfg.Unraid.DiskRoot)
	if e != nil {
		t.Fatal(e)
	}
	item := PlacementItem{Key: "radarr:radarr:1", Service: "radarr", Instance: "Movies", MediaID: 1, Title: "Film", Rel: "movies/Film"}
	item, e = s.Placement.inspectItem(context.Background(), cfg.Unraid, disks, item, placementParents{})
	if e != nil {
		t.Fatal(e)
	}
	item = planPlacement(item, cfg.Unraid, disks, map[string]int64{}, "")
	if e = insertPlacement(context.Background(), s.Store.DB, "placement_items", &item); e != nil {
		t.Fatal(e)
	}
	return item
}
func TestPlacementClassification130(t *testing.T) {
	for _, tc := range []struct {
		name                 string
		setup                func(*testing.T, Settings)
		status, target, kind string
	}{
		{"one disk", func(t *testing.T, c Settings) { placementWrite130(t, c, "disk6", "Film.mkv", "video") }, "ok", "", ""},
		{"small files", func(t *testing.T, c Settings) {
			placementWrite130(t, c, "disk3", "Film.nfo", "nfo")
			placementWrite130(t, c, "disk6", "Film.mkv", "long video")
		}, "split", "disk6", "small_files"},
		{"media", func(t *testing.T, c Settings) {
			placementWrite130(t, c, "disk3", "extra.mp4", "small")
			placementWrite130(t, c, "disk6", "Film.mkv", "long video")
		}, "split", "disk6", "media_files"},
		{"pool", func(t *testing.T, c Settings) {
			placementWrite130(t, c, "cache", "Film.nfo", "nfo")
			placementWrite130(t, c, "disk6", "Film.mkv", "long video")
		}, "waiting_for_mover", "", ""},
		{"pool only", func(t *testing.T, c Settings) { placementWrite130(t, c, "cache", "Film.mkv", "video") }, "ok", "", ""},
		{"conflict", func(t *testing.T, c Settings) {
			placementWrite130(t, c, "disk3", "Film.mkv", "one")
			placementWrite130(t, c, "disk6", "Film.mkv", "two")
		}, "conflict", "", ""},
		{"empty other", func(t *testing.T, c Settings) {
			placementWrite130(t, c, "disk6", "Film.mkv", "video")
			if e := os.MkdirAll(filepath.Join(c.Unraid.DiskRoot, "disk3/movies/Film/empty"), 0755); e != nil {
				t.Fatal(e)
			}
		}, "empty_folders", "disk6", "small_files"},
		{"empty only", func(t *testing.T, c Settings) {
			if e := os.MkdirAll(filepath.Join(c.Unraid.DiskRoot, "disk3/movies/Film"), 0755); e != nil {
				t.Fatal(e)
			}
		}, "empty_folders", "disk3", "small_files"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, cfg := placementFixture130(t)
			tc.setup(t, cfg)
			item := placementPlan130(t, s, cfg)
			if item.ScanStatus != tc.status || item.Target != tc.target || item.Kind != tc.kind {
				t.Fatalf("%#v", item)
			}
		})
	}
}
func TestPlacementMove130(t *testing.T) {
	s, cfg := placementFixture130(t)
	cfg.Unraid.VerifyChecksum = true
	s.settings = cfg
	placementWrite130(t, cfg, "disk3", "art/Film.nfo", "information")
	placementWrite130(t, cfg, "disk6", "Film.mkv", strings.Repeat("video", 100))
	item := placementPlan130(t, s, cfg)
	if !item.startable() {
		t.Fatal(item)
	}
	original, e := os.Stat(filepath.Join(cfg.Unraid.DiskRoot, "disk3/movies/Film/art/Film.nfo"))
	if e != nil {
		t.Fatal(e)
	}
	if e = s.Placement.executeMove(context.Background(), cfg, &item); e != nil {
		t.Fatal(e)
	}
	destination := filepath.Join(cfg.Unraid.DiskRoot, "disk6/movies/Film/art/Film.nfo")
	data, e := os.ReadFile(destination)
	if e != nil || string(data) != "information" {
		t.Fatal(string(data), e)
	}
	copied, e := os.Stat(destination)
	if e != nil {
		t.Fatal(e)
	}
	if copied.Mode() != original.Mode() || !copied.ModTime().Equal(original.ModTime()) || copied.Size() != original.Size() {
		t.Fatalf("metadata changed: %#v / %#v", original, copied)
	}
	uid, gid := placementOwner(copied)
	if uid != 99 || gid != 100 {
		t.Fatal(uid, gid)
	}
	if _, e = os.Lstat(filepath.Join(cfg.Unraid.DiskRoot, "disk3/movies/Film")); !os.IsNotExist(e) {
		t.Fatal("source folder remains", e)
	}
	log, _ := os.ReadFile(s.Placement.logPath(item.ID))
	if strings.Contains(string(log), cfg.Unraid.DiskRoot) {
		t.Fatal("absolute path leaked")
	}
	partials, _ := filepath.Glob(filepath.Join(cfg.Unraid.DiskRoot, "disk6/movies/Film/art/.*.partial"))
	if len(partials) != 0 {
		t.Fatal(partials)
	}
}
func TestPlacementChangedAndCollision130(t *testing.T) {
	for _, scenario := range []string{"source", "destination", "during copy", "checksum"} {
		t.Run(scenario, func(t *testing.T) {
			s, cfg := placementFixture130(t)
			placementWrite130(t, cfg, "disk3", "Film.nfo", "info")
			placementWrite130(t, cfg, "disk6", "Film.mkv", strings.Repeat("v", 100))
			item := placementPlan130(t, s, cfg)
			source := filepath.Join(cfg.Unraid.DiskRoot, "disk3/movies/Film/Film.nfo")
			dest := filepath.Join(cfg.Unraid.DiskRoot, "disk6/movies/Film/Film.nfo")
			copier := s.Placement.testCopy
			switch scenario {
			case "source":
				if e := os.WriteFile(source, []byte("changed"), 0640); e != nil {
					t.Fatal(e)
				}
			case "destination":
				placementWrite130(t, cfg, "disk6", "Film.nfo", "existing")
			case "during copy":
				s.Placement.testCopy = func(ctx context.Context, src, dst *os.File, progress func(int64)) error {
					if e := copier(ctx, src, dst, progress); e != nil {
						return e
					}
					return os.WriteFile(source, []byte("changed"), 0640)
				}
			case "checksum":
				cfg.Unraid.VerifyChecksum = true
				s.settings = cfg
				s.Placement.testCopy = func(ctx context.Context, src, dst *os.File, progress func(int64)) error {
					if e := copier(ctx, src, dst, progress); e != nil {
						return e
					}
					_, e := dst.WriteAt([]byte("xxxx"), 0)
					return e
				}
			}
			e := s.Placement.executeMove(context.Background(), cfg, &item)
			if e == nil {
				t.Fatal("unsafe move accepted")
			}
			if scenario != "checksum" && !errors.Is(e, errPlacementChanged) {
				t.Fatal(e)
			}
			if _, e = os.Stat(source); e != nil {
				t.Fatal("source lost", e)
			}
			if scenario == "destination" {
				data, _ := os.ReadFile(dest)
				if string(data) != "existing" {
					t.Fatal("existing destination overwritten")
				}
			} else if _, e = os.Lstat(dest); !os.IsNotExist(e) {
				t.Fatal("destination published", e)
			}
			partials, _ := filepath.Glob(filepath.Join(filepath.Dir(dest), ".*.partial"))
			if len(partials) > 0 {
				t.Fatal(partials)
			}
		})
	}
}
func TestPlacementCancel130(t *testing.T) {
	s, cfg := placementFixture130(t)
	placementWrite130(t, cfg, "disk3", "1.nfo", "1")
	placementWrite130(t, cfg, "disk3", "2.nfo", "22")
	placementWrite130(t, cfg, "disk3", "3.nfo", "333")
	placementWrite130(t, cfg, "disk6", "Film.mkv", strings.Repeat("v", 100))
	item := placementPlan130(t, s, cfg)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	copier := s.Placement.testCopy
	count := 0
	s.Placement.testCopy = func(ctx context.Context, src, dst *os.File, progress func(int64)) error {
		count++
		if count == 2 {
			cancel()
		}
		return copier(ctx, src, dst, progress)
	}
	if e := s.Placement.executeMove(ctx, cfg, &item); !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
	for n, name := range []string{"1.nfo", "2.nfo", "3.nfo"} {
		_, src := os.Stat(filepath.Join(cfg.Unraid.DiskRoot, "disk3/movies/Film", name))
		_, dst := os.Stat(filepath.Join(cfg.Unraid.DiskRoot, "disk6/movies/Film", name))
		if n == 0 {
			if !os.IsNotExist(src) || dst != nil {
				t.Fatal(name, src, dst)
			}
		} else if src != nil || !os.IsNotExist(dst) {
			t.Fatal(name, src, dst)
		}
	}
	partials, _ := filepath.Glob(filepath.Join(cfg.Unraid.DiskRoot, "disk6/movies/Film/.*.partial"))
	if len(partials) > 0 {
		t.Fatal(partials)
	}
}
func TestPlacementRecovery130(t *testing.T) {
	for _, different := range []bool{false, true} {
		t.Run(strconvBool130(different), func(t *testing.T) {
			s, cfg := placementFixture130(t)
			placementWrite130(t, cfg, "disk3", "Film.nfo", "info")
			placementWrite130(t, cfg, "disk6", "Film.mkv", strings.Repeat("v", 100))
			item := placementPlan130(t, s, cfg)
			content := "info"
			if different {
				content = "DIFFERENT"
			}
			placementWrite130(t, cfg, "disk6", "Film.nfo", content)
			partial := filepath.Join(cfg.Unraid.DiskRoot, "disk6/movies/Film", placementPartial(PlacementFile{Rel: "Film.nfo"}, item.ID))
			if e := os.WriteFile(partial, []byte("partial"), 0600); e != nil {
				t.Fatal(e)
			}
			item.JobStatus = "running"
			s.Placement.recoverItem(&item)
			if _, e := os.Lstat(partial); !os.IsNotExist(e) {
				t.Fatal("partial remains", e)
			}
			if different {
				if item.JobStatus != "needs_attention" {
					t.Fatal(item.JobStatus)
				}
				if _, e := os.Stat(filepath.Join(cfg.Unraid.DiskRoot, "disk3/movies/Film/Film.nfo")); e != nil {
					t.Fatal(e)
				}
			} else {
				if item.JobStatus != "failed" {
					t.Fatal(item.JobStatus)
				}
				if _, e := os.Stat(filepath.Join(cfg.Unraid.DiskRoot, "disk3/movies/Film/Film.nfo")); !os.IsNotExist(e) {
					t.Fatal("source remains", e)
				}
			}
		})
	}
}
func strconvBool130(v bool) string {
	if v {
		return "different"
	}
	return "same"
}
func TestPlacementScanAtomic130(t *testing.T) {
	s, cfg := placementFixture130(t)
	placementWrite130(t, cfg, "disk3", "Film.nfo", "info")
	placementWrite130(t, cfg, "disk6", "Film.mkv", strings.Repeat("v", 100))
	arr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode([]map[string]any{{"id": 1, "title": "Film", "path": "/arr/movies/Film"}})
	}))
	defer arr.Close()
	cfg.Instances[0].URL = arr.URL
	s.settings = cfg
	s.Placement.runScan(context.Background(), cfg)
	scan := s.Placement.scanStatus()
	if scan.Error != "" || scan.Checked != 1 || scan.Several != 1 {
		t.Fatalf("%#v", scan)
	}
	var firstID int64
	if e := s.Store.DB.QueryRow("SELECT id FROM placement_items").Scan(&firstID); e != nil {
		t.Fatal(e)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	s.Placement.runScan(ctx, cfg)
	var after int64
	if e := s.Store.DB.QueryRow("SELECT id FROM placement_items").Scan(&after); e != nil || after != firstID {
		t.Fatal(after, e)
	}
	s.Placement.runScan(context.Background(), cfg)
	if e := s.Store.DB.QueryRow("SELECT id FROM placement_items").Scan(&after); e != nil || after <= firstID {
		t.Fatal("identifiers reused", after, e)
	}
}
func TestCopyPlacementSync130(t *testing.T) {
	dir := t.TempDir()
	src, e := os.Create(filepath.Join(dir, "src"))
	if e != nil {
		t.Fatal(e)
	}
	defer src.Close()
	if e = src.Truncate(33 << 20); e != nil {
		t.Fatal(e)
	}
	dst, e := os.Create(filepath.Join(dir, "dst"))
	if e != nil {
		t.Fatal(e)
	}
	defer dst.Close()
	var done int64
	if e = copyPlacement(context.Background(), src, dst, func(n int64) { done = n }); e != nil {
		t.Fatal(e)
	}
	if done != 33<<20 {
		t.Fatal(done)
	}
	if _, e = dst.Seek(0, 0); e != nil {
		t.Fatal(e)
	}
	if n, e := io.Copy(io.Discard, dst); e != nil || n != done {
		t.Fatal(n, e)
	}
}

// Opt-in production copier check, run in a 512 MiB container without swap.
func TestPlacementLargeCopy130(t *testing.T) {
	if os.Getenv("SCOPEARR_PLACEMENT_LARGE") != "1" {
		t.Skip("set SCOPEARR_PLACEMENT_LARGE=1 inside a 512 MiB container")
	}
	dir := muxTempDir120(t)
	src, e := os.Create(filepath.Join(dir, "source"))
	if e != nil {
		t.Fatal(e)
	}
	defer src.Close()
	const size = int64(5000 << 20)
	if e = src.Truncate(size); e != nil {
		t.Fatal(e)
	}
	for _, offset := range []int64{0, 2000 << 20, size - 64} {
		if _, e = src.WriteAt([]byte("scopearr placement copy boundary"), offset); e != nil {
			t.Fatal(e)
		}
	}
	if e = src.Sync(); e != nil {
		t.Fatal(e)
	}
	dst, e := os.Create(filepath.Join(dir, "partial"))
	if e != nil {
		t.Fatal(e)
	}
	defer dst.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	var done int64
	started := time.Now()
	if e = copyPlacement(ctx, src, dst, func(n int64) { done = n }); e != nil {
		t.Fatal(e)
	}
	if done != size {
		t.Fatal(done)
	}
	if _, e = src.Seek(0, 0); e != nil {
		t.Fatal(e)
	}
	if _, e = dst.Seek(0, 0); e != nil {
		t.Fatal(e)
	}
	a, e := hashPlacement(ctx, src)
	if e != nil {
		t.Fatal(e)
	}
	b, e := hashPlacement(ctx, dst)
	if e != nil || a != b {
		t.Fatal("checksum", e)
	}
	peak, _ := os.ReadFile("/sys/fs/cgroup/memory.peak")
	limit, e := os.ReadFile("/sys/fs/cgroup/memory.max")
	if e != nil || strings.TrimSpace(string(limit)) != "536870912" {
		t.Fatal("run with --memory=512m", string(limit), e)
	}
	events, e := os.ReadFile("/sys/fs/cgroup/memory.events")
	if e != nil || !strings.Contains("\n"+string(events), "\noom_kill 0\n") {
		t.Fatal("OOM events", string(events), e)
	}
	t.Logf("memory.max=%s memory.events=%s", strings.TrimSpace(string(limit)), strings.ReplaceAll(strings.TrimSpace(string(events)), "\n", ", "))
	t.Logf("bytes=%d duration=%s cgroup_memory_peak=%s", done, time.Since(started).Round(time.Millisecond), strings.TrimSpace(string(peak)))
}
