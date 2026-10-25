package app

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPlacementCache146(t *testing.T) {
	for _, tc := range []struct {
		name, policy, status, target string
		files, empty                 []string
		start                        bool
		move                         int64
	}{
		{"pool and array", "yes", "split", "disk6", []string{"cache/c.mkv", "disk6/a.mkv"}, nil, true, 1},
		{"pool and empty array", "yes", "split", "disk6", []string{"cache/c.mkv"}, []string{"disk6"}, true, 1},
		{"one pool", "yes", "ok", "", []string{"cache/c.mkv"}, nil, false, 0},
		{"two pools new target", "yes", "split", "disk3", []string{"cache/c.mkv", "cache2/d.mkv"}, nil, true, 2},
		{"array and pool", "yes", "split", "disk3", []string{"cache/c.mkv", "disk3/b.mkv", "disk6/a.mkv"}, nil, true, 2},
		{"prefer", "prefer", "split", "", []string{"cache/c.mkv", "disk6/a.mkv"}, nil, false, 0},
		{"only", "only", "split", "", []string{"cache/c.mkv", "disk6/a.mkv"}, nil, false, 0},
		{"prefer empty array", "prefer", "ok", "", []string{"cache/c.mkv"}, []string{"disk6"}, false, 0},
		{"missing settings", "", "split", "disk6", []string{"cache/c.mkv", "disk6/a.mkv"}, nil, true, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, cfg := placementFixture130(t)
			if tc.policy != "" {
				cfg.Unraid.StateDir = t.TempDir()
				os.WriteFile(filepath.Join(cfg.Unraid.StateDir, "shares.ini"), []byte("[movies]\nshareUseCache=\""+tc.policy+"\"\n"), 0644)
			}
			for _, f := range tc.files {
				disk, rel, _ := strings.Cut(f, "/")
				placementWrite130(t, cfg, disk, rel, "x")
			}
			for _, disk := range tc.empty {
				os.MkdirAll(filepath.Join(cfg.Unraid.DiskRoot, disk, "movies/Film"), 0755)
			}
			setTestSettings(s, cfg)
			disks, e := discoverDisks(cfg.Unraid.DiskRoot)
			if e != nil {
				t.Fatal(e)
			}
			// Deterministic target tie-break: all array candidates have equal available space.
			for n := range disks {
				disks[n].Free = 1e9
			}
			i, e := s.Placement.inspectItem(context.Background(), cfg.Unraid, disks, PlacementItem{Rel: "movies/Film", Share: "movies"}, placementParents{})
			if e != nil {
				t.Fatal(e)
			}
			influx := map[string]int64{}
			i = planPlacement(i, cfg.Unraid, disks, influx, "")
			if i.ScanStatus != tc.status || i.Target != tc.target || i.startable() != tc.start || i.MoveBytes != tc.move {
				t.Fatalf("got status=%s target=%s start=%v bytes=%d; want %+v", i.ScanStatus, i.Target, i.startable(), i.MoveBytes, tc)
			}
			if tc.start && influx[tc.target] != tc.move {
				t.Errorf("pool bytes missing from influx: %v", influx)
			}
			if tc.name == "two pools new target" && !strings.Contains(i.Message, "new for this folder") {
				t.Error(i.Message)
			}
			if (tc.policy == "prefer" || tc.policy == "only") && tc.status == "split" && !strings.Contains(i.Message, "This share keeps files") {
				t.Error(i.Message)
			}
		})
	}
}

func TestPlacementOwnerAllowed146(t *testing.T) {
	s, cfg := placementFixture130(t)
	placementWrite130(t, cfg, "disk3", "foreign.nfo", "nfo")
	placementWrite130(t, cfg, "disk6", "film.mkv", "much bigger video")
	original := placementOwner
	placementOwner = func(st os.FileInfo) (uint32, uint32) {
		if st.Name() == "foreign.nfo" {
			return 0, 0
		}
		return original(st)
	}
	defer func() { placementOwner = original }()
	i := placementPlan130(t, s, cfg)
	if !i.startable() || i.ScanStatus != "split" {
		t.Fatalf("readable root-owned companion should not block: %+v", i)
	}
	if e := s.Placement.executeMove(context.Background(), cfg, &i); e != nil {
		t.Fatal(e)
	}
	if _, e := os.Stat(filepath.Join(cfg.Unraid.DiskRoot, "disk6", i.Rel, "foreign.nfo")); e != nil {
		t.Fatal(e)
	}
}

func TestPlacementCheckStored146(t *testing.T) {
	s, cfg := placementFixture130(t)
	placementWrite130(t, cfg, "disk3", "art.nfo", "small")
	placementWrite130(t, cfg, "disk6", "film.mkv", "larger film")
	i := placementPlan130(t, s, cfg)
	i.Check = &PlacementCheck{Reachable: true, Writable: true, FreeSpace: true, Unchanged: true, NoConflict: true, Owner: true}
	if e := s.Store.placementSave(&i); e != nil {
		t.Fatal(e)
	}
	saved, e := s.Store.placementItem(i.ID)
	if e != nil {
		t.Fatal(e)
	}
	if saved.Check == nil || !saved.Check.Reachable {
		t.Fatalf("last check lost after reload: %+v", saved.Check)
	}
}

func TestPlacementAccess146(t *testing.T) {
	for _, tc := range []struct {
		name           string
		read, remove   bool
		owner          uint32
		status, reason string
	}{
		{"different group readable", true, true, 99, "split", "owner_changes"},
		{"root readable", true, true, 0, "split", "owner_changes"},
		{"unreadable", false, true, 0, "error", "unreadable"},
		{"cannot remove", true, false, 99, "error", "not_removable"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, cfg := placementFixture130(t)
			placementWrite130(t, cfg, "disk3", "source.nfo", "x")
			placementWrite130(t, cfg, "disk6", "target.mkv", "long video")
			originalOwner, originalAccess := placementOwner, placementAccess
			placementOwner = func(st os.FileInfo) (uint32, uint32) {
				if st.Name() == "source.nfo" {
					return tc.owner, 1000
				}
				return originalOwner(st)
			}
			calls := 0
			placementAccess = func(path string, mode uint32) error {
				calls++
				if strings.Contains(path, "disk6") {
					t.Error("must not inspect target access")
				}
				if (mode == 4 && !tc.read) || (mode == 3 && !tc.remove) {
					return os.ErrPermission
				}
				return nil
			}
			defer func() { placementOwner, placementAccess = originalOwner, originalAccess }()
			i := placementPlan130(t, s, cfg)
			if i.ScanStatus != tc.status {
				t.Fatalf("status=%s want%s", i.ScanStatus, tc.status)
			}
			if calls != 2 {
				t.Errorf("scan access calls=%d want2", calls)
			}
			check, _, _ := s.Placement.checkItem(context.Background(), cfg, i)
			if check.Readable != tc.read || check.Removable != tc.remove || check.OwnerChanges != 1 {
				t.Errorf("check=%+v", check)
			}
			found := false
			for _, f := range check.Files {
				if f.Rel == "source.nfo" && f.Reason == tc.reason {
					found = true
				}
			}
			if !found {
				t.Errorf("missing concrete reason %s: %+v", tc.reason, check.Files)
			}
		})
	}
}

func TestPlacementCheckRescan146(t *testing.T) {
	s, cfg := placementFixture145(t)
	s.Placement.runScan(context.Background(), cfg)
	first := placementRows144(t, s)["movies/A"]
	first.Check = &PlacementCheck{CheckedAt: "2026-10-25T10:00:00Z", Reachable: true, Readable: true, Removable: true, Owner: true}
	if e := s.Store.placementSave(&first); e != nil {
		t.Fatal(e)
	}
	s.Placement.runScan(context.Background(), cfg)
	second := placementRows144(t, s)["movies/A"]
	if second.Check == nil || second.Check.CheckedAt != "2026-10-25T10:00:00Z" {
		t.Fatal("unchanged rescan lost check")
	}
	path := filepath.Join(cfg.Unraid.DiskRoot, "disk1/movies/A/a.mkv")
	if e := os.WriteFile(path, []byte("changed file contents and size"), 0644); e != nil {
		t.Fatal(e)
	}
	s.Placement.runScan(context.Background(), cfg)
	third := placementRows144(t, s)["movies/A"]
	if third.Check != nil {
		t.Fatal("changed files kept stale check")
	}
}

func TestPlacementCheckHTTPAndBounds146(t *testing.T) {
	s, cfg := placementFixture130(t)
	placementWrite130(t, cfg, "disk3", "art.nfo", "x")
	placementWrite130(t, cfg, "disk6", "film.mkv", "larger movie")
	i := placementPlan130(t, s, cfg)
	w := httptest.NewRecorder()
	s.placementRecheck(w, httptest.NewRequest("POST", "/api/placement/items/1/recheck", nil), i)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	saved, e := s.Store.placementItem(i.ID)
	if e != nil || saved.Check == nil {
		t.Fatal(e, "missing persisted recheck")
	}
	if _, e = time.Parse(time.RFC3339, saved.Check.CheckedAt); e != nil {
		t.Fatal(e)
	}
	var list struct{ Items []PlacementItem }
	placementJSON145(t, s, "/api/placement/items", &list)
	if len(list.Items) != 1 || list.Items[0].Check == nil {
		t.Fatal("list projection dropped check")
	}
	// A late access failure must persist a fresh failed preflight, before any copy.
	access := placementAccess
	placementAccess = func(string, uint32) error { return os.ErrPermission }
	defer func() { placementAccess = access }()
	if e = s.Placement.executeMove(context.Background(), cfg, &saved); e == nil {
		t.Fatal("unreadable source moved")
	}
	failed, e := s.Store.placementItem(i.ID)
	if e != nil || failed.Check == nil || failed.Check.Readable || failed.Check.Removable {
		t.Fatalf("failed preflight not durable: %+v %v", failed.Check, e)
	}
	// Large paths cannot make a stored/list check unbounded.
	check := &PlacementCheck{CheckedAt: "2026-10-25T10:00:00Z"}
	for n := 0; n < 80; n++ {
		check.Files = append(check.Files, PlacementCheckFile{Disk: "disk1", Rel: strings.Repeat("x", 2000), Reason: "unreadable"})
	}
	i.Check = check
	if e = s.Store.placementSave(&i); e != nil {
		t.Fatal(e)
	}
	var raw string
	s.Store.DB.QueryRow("SELECT check_result FROM placement_items WHERE id=?", i.ID).Scan(&raw)
	var bounded PlacementCheck
	if e = json.Unmarshal([]byte(raw), &bounded); e != nil {
		t.Fatal(e)
	}
	if len(raw) > 16*1024 || len(bounded.Files) > 50 || len(bounded.Files)+bounded.MoreFiles != 80 {
		t.Fatalf("unbounded/incomplete check: bytes=%d files=%d more=%d", len(raw), len(bounded.Files), bounded.MoreFiles)
	}
}

func TestPlacementPoolMove146(t *testing.T) {
	for _, newTarget := range []bool{false, true} {
		t.Run(map[bool]string{false: "empty array folder", true: "new array folder"}[newTarget], func(t *testing.T) {
			s, cfg := placementFixture130(t)
			placementWrite130(t, cfg, "cache", "art.nfo", "x")
			if newTarget {
				placementWrite130(t, cfg, "cache2", "other.mkv", "long video")
			} else {
				os.MkdirAll(filepath.Join(cfg.Unraid.DiskRoot, "disk6/movies/Film"), 0755)
			}
			i := placementPlan130(t, s, cfg)
			if !i.startable() {
				t.Fatal(i)
			}
			if e := s.Placement.executeMove(context.Background(), cfg, &i); e != nil {
				t.Fatal(e)
			}
			for _, disk := range []string{"cache", "cache2"} {
				if _, e := os.Stat(filepath.Join(cfg.Unraid.DiskRoot, disk, i.Rel)); !os.IsNotExist(e) {
					t.Fatalf("pool source remains: %s %v", disk, e)
				}
			}
			if _, e := os.Stat(filepath.Join(cfg.Unraid.DiskRoot, i.Target, i.Rel, "art.nfo")); e != nil {
				t.Fatal(e)
			}
		})
	}
}

func TestShareCacheSettings146(t *testing.T) {
	policies := parseShareCache([]byte("# comment\n[movies]\nshareUseCache=\"yes\"\nshareCachePool=\"fast-pool\"\n[media]\nshareUseCache='prefer'\n[unknown]\nshareUseCache='future'\n"))
	if policies.policy("movies/nested/Film").UseCache != "yes" || policies.policy("media/documentaries/Film").UseCache != "prefer" || policies.policy("unknown/Film").UseCache != "unknown" {
		t.Fatal(policies)
	}
	s, cfg := placementFixture130(t)
	setTestSettings(s, cfg)
	var report struct {
		CacheWarning string `json:"cacheWarning"`
	}
	placementJSON145(t, s, "/api/placement/report", &report)
	if report.CacheWarning != shareCacheUnknown {
		t.Fatal(report)
	}
	cfg.Unraid.StateDir = t.TempDir()
	os.WriteFile(filepath.Join(cfg.Unraid.StateDir, "shares.ini"), []byte("[movies]\nshareUseCache=prefer\n"), 0644)
	setTestSettings(s, cfg)
	s.Placement.scan.Shares = []PlacementShare{{ShareDir: "movies"}}
	var known struct {
		Shares       []PlacementShareReport
		CacheWarning string
	}
	placementJSON145(t, s, "/api/placement/report", &known)
	if known.CacheWarning != "" || len(known.Shares) != 1 || known.Shares[0].Cache.UseCache != "prefer" {
		t.Fatal(known)
	}
}

func TestPlacementRecoveryOwner146(t *testing.T) {
	s, cfg := placementFixture130(t)
	placementWrite130(t, cfg, "disk3", "owner.nfo", "info")
	placementWrite130(t, cfg, "disk6", "Film.mkv", strings.Repeat("v", 100))
	sourceInfo, e := os.Stat(filepath.Join(cfg.Unraid.DiskRoot, "disk3/movies/Film/owner.nfo"))
	if e != nil {
		t.Fatal(e)
	}
	orig := placementOwner
	placementOwner = func(st os.FileInfo) (uint32, uint32) {
		if os.SameFile(sourceInfo, st) {
			return 1000, 1000
		}
		return orig(st)
	}
	defer func() { placementOwner = orig }()
	i := placementPlan130(t, s, cfg)
	placementWrite130(t, cfg, "disk6", "owner.nfo", "info")
	i.JobStatus = "running"
	s.Placement.recoverItem(&i)
	if _, e := os.Stat(filepath.Join(cfg.Unraid.DiskRoot, "disk3", i.Rel, "owner.nfo")); !os.IsNotExist(e) {
		t.Fatalf("verified owner-changing copy not recovered: %v %s", e, i.Message)
	}
	saved, e := s.Store.placementItem(i.ID)
	if e != nil || saved.Check == nil || saved.Check.CheckedAt == "" {
		t.Fatal("recovery check was not stored", e)
	}
}

func TestPlacementRealAccess146(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("effective UID access must be checked unprivileged")
	}
	s, cfg := placementFixture130(t)
	placementWrite130(t, cfg, "disk3", "unreadable.nfo", "x")
	placementWrite130(t, cfg, "disk6", "Film.mkv", "larger movie")
	path := filepath.Join(cfg.Unraid.DiskRoot, "disk3/movies/Film/unreadable.nfo")
	if e := os.Chmod(path, 0000); e != nil {
		t.Fatal(e)
	}
	defer os.Chmod(path, 0640)
	item := placementPlan130(t, s, cfg)
	if item.ScanStatus != "error" || item.Disks["disk3"].Unreadable != 1 {
		t.Fatalf("real unreadability missed: %+v", item)
	}
	os.Chmod(path, 0640)
	if _, e := s.Store.DB.Exec("DELETE FROM placement_items"); e != nil {
		t.Fatal(e)
	}
	parent := filepath.Dir(path)
	os.Chmod(parent, 0500)
	defer os.Chmod(parent, 0750)
	item = placementPlan130(t, s, cfg)
	if item.ScanStatus != "error" || item.Disks["disk3"].NotRemovable != 1 {
		t.Fatalf("real parent access missed: %+v", item)
	}
}

func TestPlacementMigrationRollback146(t *testing.T) {
	const columns145 = `id,item_key,service,instance,media_id,season,title,rel,scan_status,kind,target,total_bytes,move_bytes,move_files,disks,files,warnings,job_status,queue_pos,progress,bytes_done,message,updated_at,finished_at,share,devices`
	dir := t.TempDir()
	store, e := OpenStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	var version int
	store.DB.QueryRow("PRAGMA user_version").Scan(&version)
	// Recreate the literal predecessor shape without 1.4.6 check_result.
	if _, e = store.DB.Exec("DROP TABLE placement_items;CREATE TABLE placement_items" + strings.TrimSuffix(placementTable144, ")") + ",share TEXT NOT NULL DEFAULT '',devices INTEGER NOT NULL DEFAULT 0)"); e != nil {
		t.Fatal(e)
	}
	store.DB.Close()
	store, e = OpenStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer store.DB.Close()
	var after int
	store.DB.QueryRow("PRAGMA user_version").Scan(&after)
	if version != after {
		t.Fatal("user_version changed")
	}
	item := PlacementItem{Key: "new", Rel: "movies/Film", Disks: map[string]PlacementDisk{}, Check: &PlacementCheck{CheckedAt: "2026-10-25T10:00:00Z"}}
	if e = insertPlacement(context.Background(), store.DB, "placement_items", &item); e != nil {
		t.Fatal(e)
	}
	rows, e := store.DB.Query("SELECT " + columns145 + " FROM placement_items")
	if e != nil {
		t.Fatal(e)
	}
	if lenMust := func() int { c, _ := rows.Columns(); return len(c) }(); lenMust != 26 {
		t.Fatal(lenMust)
	}
	rows.Close()
	if _, e = store.DB.Exec("INSERT INTO placement_items("+strings.TrimPrefix(columns145, "id,")+") SELECT 'old-reader',service,instance,media_id,season,title,rel,scan_status,kind,target,total_bytes,move_bytes,move_files,disks,files,warnings,job_status,queue_pos,progress,bytes_done,message,updated_at,finished_at,share,devices FROM placement_items WHERE id=?", item.ID); e != nil {
		t.Fatal(e)
	}
	var raw string
	store.DB.QueryRow("SELECT check_result FROM placement_items WHERE item_key='old-reader'").Scan(&raw)
	if raw != "" {
		t.Fatal("old writer default differs")
	}
	store.DB.Close()
	store, e = OpenStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer store.DB.Close()
}

func TestPlacementCheckInvalidatedBySpecial146(t *testing.T) {
	s, cfg := placementFixture145(t)
	s.Placement.runScan(context.Background(), cfg)
	item := placementRows144(t, s)["movies/A"]
	item.Check = &PlacementCheck{CheckedAt: "2026-10-25T10:00:00Z", Readable: true, Removable: true}
	s.Store.placementSave(&item)
	if e := os.Symlink("/missing", filepath.Join(cfg.Unraid.DiskRoot, "disk2/movies/A/new-link")); e != nil {
		t.Fatal(e)
	}
	s.Placement.runScan(context.Background(), cfg)
	fresh := placementRows144(t, s)["movies/A"]
	if fresh.Check != nil {
		t.Fatal("new source special entry retained a stale check")
	}
}
