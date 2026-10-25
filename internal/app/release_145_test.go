package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPlacementMediaNames145(t *testing.T) {
	s, cfg := shareFixture144(t)
	for _, name := range []string{"#amleben", "@cinema", ".arr-hidden", "#snapshot", "@Recycle", "@Recently-Snapshot", "@tmp", "@SynoResource", "lost+found", ".Trash-1000", ".hidden"} {
		shareFile144(t, cfg, "disk3", "documentaries/"+name+"/film.mkv")
	}
	arr := arrServer144(t, []string{"/documentaries"}, []arrMedia144{{41, "Hidden movie", "/documentaries/.arr-hidden"}, {42, "Hashtag movie", "/documentaries/#amleben"}})
	cfg.Instances[0].URL = arr.URL
	setTestSettings(s, cfg)
	s.Placement.runScan(context.Background(), cfg)
	if e := s.Placement.scanStatus().Error; e != "" {
		t.Fatal(e)
	}
	rows := placementRows144(t, s)
	for _, name := range []string{"#amleben", "@cinema", ".arr-hidden"} {
		if got, ok := rows["documentaries/"+name]; !ok || got.ScanStatus != "ok" {
			t.Errorf("ordinary media folder %s missing: %+v", name, got)
		}
	}
	for _, name := range []string{"#snapshot", "@Recycle", "@Recently-Snapshot", "@tmp", "@SynoResource", "lost+found", ".Trash-1000", ".hidden"} {
		if _, ok := rows["documentaries/"+name]; ok {
			t.Errorf("system folder %s included", name)
		}
	}
}

func emptyDir145(t *testing.T, cfg Settings, disk, rel string) {
	t.Helper()
	if e := os.MkdirAll(filepath.Join(cfg.Unraid.DiskRoot, disk, rel), 0755); e != nil {
		t.Fatal(e)
	}
}

func placementFixture145(t *testing.T) (*Server, Settings) {
	t.Helper()
	s, cfg := placementFixture130(t)
	// Hosted runners cannot chown to root. Keep normal entries on the existing
	// test identity and explicitly mark only the declared foreign-owner fixtures.
	if os.Geteuid() != 0 {
		originalOwner := placementOwner
		placementOwner = func(info os.FileInfo) (uint32, uint32) {
			if strings.HasPrefix(info.Name(), "foreign-") {
				return 0, 0
			}
			return originalOwner(info)
		}
		t.Cleanup(func() { placementOwner = originalOwner })
	}
	cfg.Mux.Mappings = ""
	cfg.Unraid.ShareRoot = filepath.Join(cfg.Unraid.DiskRoot, "user")
	cfg.Unraid.SeriesGrouping = "season"
	for _, share := range []string{"movies", "shows", "documentaries", "Fotos"} {
		emptyDir145(t, cfg, "user", share)
	}
	for _, disk := range []string{"disk1", "disk2", "disk3", "cache"} {
		emptyDir145(t, cfg, disk, "")
	}
	for _, spec := range []struct{ disk, rel string }{
		{"disk1", "movies/A/a.mkv"}, {"disk2", "movies/A/b.mkv"},
		{"disk1", "movies/B/a.mkv"}, {"cache", "movies/C/c.mkv"},
		{"cache", "movies/D/c.mkv"}, {"disk1", "movies/D/a.mkv"}, {"cache", "movies/E/e.mkv"},
		{"disk1", "movies/#amleben/a.mkv"}, {"disk1", "movies/#amleben2/a.mkv"}, {"disk2", "movies/#amleben2/b.mkv"},
		{"disk1", "movies/J/foreign-a.mkv"}, {"disk2", "movies/J/foreign-b.mkv"},
		{"disk1", "shows/Serie K/Season 01/a.mkv"}, {"disk2", "shows/Serie K/Season 02/b.mkv"},
		{"disk1", "Fotos/V/a.jpg"}, {"disk2", "Fotos/V/b.jpg"},
	} {
		shareFile144(t, cfg, spec.disk, spec.rel)
	}
	for _, spec := range []struct{ disk, rel string }{{"disk2", "movies/B"}, {"disk1", "movies/C"}, {"disk1", "movies/F"}, {"disk1", "movies/G"}, {"disk2", "movies/G"}, {"disk1", "movies/H/empty/also-empty"}, {"disk1", "movies/I"}, {"disk1", "shows/Harry Potter"}} {
		emptyDir145(t, cfg, spec.disk, spec.rel)
	}
	if e := os.Symlink("/missing-target", filepath.Join(cfg.Unraid.DiskRoot, "disk1/movies/I/link")); e != nil {
		t.Fatal(e)
	}
	if os.Geteuid() == 0 {
		for _, rel := range []string{"disk1/movies/J/foreign-a.mkv", "disk2/movies/J/foreign-b.mkv"} {
			if e := os.Chown(filepath.Join(cfg.Unraid.DiskRoot, rel), 0, 0); e != nil {
				t.Fatal(e)
			}
		}
	}
	for _, name := range []string{"#recycle", "@eaDir", ".Recycle.Bin", "lost+found"} {
		shareFile144(t, cfg, "disk1", "movies/"+name+"/ignored")
	}
	for n := 0; n < 10; n++ {
		name := string(rune('L' + n))
		switch n % 5 {
		case 0:
			shareFile144(t, cfg, "disk1", "documentaries/"+name+"/a")
			shareFile144(t, cfg, "disk2", "documentaries/"+name+"/b")
		case 1:
			shareFile144(t, cfg, "disk1", "documentaries/"+name+"/a")
			emptyDir145(t, cfg, "disk2", "documentaries/"+name)
		case 2:
			shareFile144(t, cfg, "cache", "documentaries/"+name+"/c")
			emptyDir145(t, cfg, "disk1", "documentaries/"+name)
		case 3:
			shareFile144(t, cfg, "cache", "documentaries/"+name+"/c")
			shareFile144(t, cfg, "disk1", "documentaries/"+name+"/a")
		case 4:
			for _, disk := range []string{"disk1", "disk2"} {
				rel := "documentaries/" + name + "/foreign-" + disk
				shareFile144(t, cfg, disk, rel)
				if os.Geteuid() == 0 {
					if e := os.Chown(filepath.Join(cfg.Unraid.DiskRoot, disk, rel), 0, 0); e != nil {
						t.Fatal(e)
					}
				}
			}
		}
	}
	movies := arrServer144(t, []string{"/movies", "/documentaries"}, []arrMedia144{{1, "#amleben", "/movies/#amleben"}, {2, "Missing", "/movies/Missing"}})
	shows := arrServer144(t, []string{"/shows", "/documentaries"}, []arrMedia144{{3, "Serie K", "/shows/Serie K"}})
	cfg.Instances = []ServiceConfig{{ID: "radarr", Type: "radarr", Name: "Movies", Enabled: true, URL: movies.URL}, {ID: "sonarr", Type: "sonarr", Name: "Shows", Enabled: true, URL: shows.URL}}
	setTestSettings(s, cfg)
	return s, cfg
}

func TestPlacementClassification145(t *testing.T) {
	s, cfg := placementFixture145(t)
	metadata := &countingMetadata144{}
	s.Placement.metadata = metadata
	s.Placement.runScan(context.Background(), cfg)
	if e := s.Placement.scanStatus().Error; e != "" {
		t.Fatal(e)
	}
	if scan := s.Placement.scanStatus(); scan.Several != 18 {
		t.Errorf("snapshot several=%d want18", scan.Several)
	}
	rows := placementRows144(t, s)
	for rel, want := range map[string]string{
		"movies/A": "split", "movies/B": "empty_folders", "movies/C": "split", "movies/D": "split", "movies/E": "ok", "movies/F": "empty", "movies/G": "empty", "movies/H": "empty", "movies/#amleben": "ok", "movies/#amleben2": "split", "movies/I": "ok", "movies/J": "split", "shows/Harry Potter": "empty", "shows/Serie K": "seasons_spread", "shows/Serie K/Season 01": "ok", "movies/Missing": "not_found",
	} {
		if got, ok := rows[rel]; !ok || got.ScanStatus != want {
			t.Errorf("%s: want %s, got %+v", rel, want, got)
		}
	}
	for _, rel := range []string{"movies/F", "movies/G", "movies/H", "shows/Harry Potter"} {
		i := rows[rel]
		if i.Target != "" || i.selectable() || i.startable() {
			t.Errorf("%s must never be planned: %+v", rel, i)
		}
	}
	if rows["movies/D"].Target == "" {
		t.Error("pool and array content must retain manual target")
	}
	for _, p := range append(metadata.reads, metadata.walks...) {
		if strings.Contains(p, "/Fotos") {
			t.Errorf("unrelated share touched: %s", p)
		}
	}
	if len(rows["movies/F"].Files) > 0 || rows["movies/E"].TotalBytes != 0 {
		t.Error("single-device entries must remain compact")
	}
	t.Logf("metadata ReadDir=%d WalkDir=%d", len(metadata.reads), len(metadata.walks))
}

const placementTable144 = `(id INTEGER PRIMARY KEY, item_key TEXT NOT NULL UNIQUE,
 service TEXT NOT NULL, instance TEXT NOT NULL, media_id INTEGER NOT NULL, season INTEGER,
 title TEXT NOT NULL, rel TEXT NOT NULL, scan_status TEXT NOT NULL, kind TEXT NOT NULL DEFAULT '',
 target TEXT NOT NULL DEFAULT '', total_bytes INTEGER NOT NULL, move_bytes INTEGER NOT NULL,
 move_files INTEGER NOT NULL, disks TEXT NOT NULL DEFAULT '{}', files TEXT NOT NULL DEFAULT '[]',
 warnings TEXT NOT NULL DEFAULT '[]', job_status TEXT NOT NULL DEFAULT '', queue_pos INTEGER,
 progress INTEGER NOT NULL DEFAULT 0, bytes_done INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT '',
 updated_at TEXT NOT NULL, finished_at TEXT)`

const placementColumns144 = `id,item_key,service,instance,media_id,season,title,rel,scan_status,kind,target,total_bytes,move_bytes,move_files,disks,files,warnings,job_status,queue_pos,progress,bytes_done,message,updated_at,finished_at`

func TestPlacementPersistence145(t *testing.T) {
	dir := t.TempDir()
	store, e := OpenStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	var version int
	store.DB.QueryRow("PRAGMA user_version").Scan(&version)
	// Recreate the actual 1.4.4 table shape, without the additive columns.
	if _, e = store.DB.Exec("DROP TABLE placement_items; CREATE TABLE placement_items" + placementTable144); e != nil {
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
		t.Fatalf("schema version changed %d -> %d", version, after)
	}
	var n int
	if e = store.DB.QueryRow("SELECT count(*) FROM pragma_table_info('placement_items') WHERE name IN ('share','devices')").Scan(&n); e != nil || n != 2 {
		t.Fatalf("new columns missing: %d %v", n, e)
	}
	item := PlacementItem{Key: "folder:movies/A", Rel: "movies/A", Title: "A", ScanStatus: "split", Disks: map[string]PlacementDisk{"disk1": {}, "disk2": {}}}
	raw := []byte(`{"share":"movies","devices":2}`)
	if e = json.Unmarshal(raw, &item); e != nil {
		t.Fatal(e)
	}
	if e = insertPlacement(context.Background(), store.DB, "placement_items", &item); e != nil {
		t.Fatal(e)
	}
	got, e := store.placementItem(item.ID)
	if e != nil {
		t.Fatal(e)
	}
	var share string
	var devices int
	if e = store.DB.QueryRow("SELECT share,devices FROM placement_items WHERE id=?", item.ID).Scan(&share, &devices); e != nil || share != "movies" || devices != 2 {
		t.Fatalf("lost share/devices: %s %d %v %+v", share, devices, e, got)
	}
	// A 1.4.4 SELECT and INSERT must still work, using its literal old columns.
	rows, e := store.DB.Query("SELECT " + placementColumns144 + " FROM placement_items")
	if e != nil {
		t.Fatal(e)
	}
	rows.Close()
	oldColumns := strings.TrimPrefix(placementColumns144, "id,")
	if _, e = store.DB.Exec("INSERT INTO placement_items("+oldColumns+") SELECT 'old-reader',service,instance,media_id,season,title,rel,scan_status,kind,target,total_bytes,move_bytes,move_files,disks,files,warnings,job_status,queue_pos,progress,bytes_done,message,updated_at,finished_at FROM placement_items WHERE id=?", item.ID); e != nil {
		t.Fatal(e)
	}
	// Reopening a migrated database is idempotent.
	store.DB.Close()
	store, e = OpenStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer store.DB.Close()
}

func placementJSON145(t *testing.T, s *Server, path string, out any) {
	t.Helper()
	w := httptest.NewRecorder()
	s.placementHTTP(w, httptest.NewRequest("GET", path, nil))
	if w.Code != 200 {
		t.Fatalf("%s: %d %s", path, w.Code, w.Body.String())
	}
	if e := json.Unmarshal(w.Body.Bytes(), out); e != nil {
		t.Fatal(e)
	}
}

func TestPlacementFilterCounts145(t *testing.T) {
	s, cfg := placementFixture145(t)
	s.Placement.runScan(context.Background(), cfg)
	for phase := 0; phase < 2; phase++ {
		var status struct {
			Counts map[string]int `json:"counts"`
		}
		placementJSON145(t, s, "/api/placement/scan", &status)
		if phase == 0 {
			for key, want := range map[string]int{"all": 27, "several": 18, "one_disk": 8, "empty": 4, "no_arr": 22, "foreign_owner": 0} {
				if status.Counts[key] != want {
					t.Errorf("%s want %d got %d", key, want, status.Counts[key])
				}
			}
		}
		for _, key := range []string{"all", "several", "one_disk", "empty", "empty_folders", "not_found", "seasons_spread", "waiting_for_mover", "conflict", "no_space", "errors", "no_arr", "open", "moved", "ok", "foreign_owner", "error", "outside_share", "failed"} {
			var list struct {
				Total int `json:"total"`
			}
			placementJSON145(t, s, "/api/placement/items?status="+url.QueryEscape(key), &list)
			if list.Total != status.Counts[key] {
				t.Errorf("phase=%d %s count=%d list=%d", phase, key, status.Counts[key], list.Total)
			}
		}
		if _, e := s.Store.DB.Exec("UPDATE placement_items SET job_status='succeeded' WHERE rel='movies/A'"); e != nil {
			t.Fatal(e)
		}
	}
}

func TestPlacementReport145(t *testing.T) {
	s, cfg := placementFixture145(t)
	s.Placement.runScan(context.Background(), cfg)
	for phase := 0; phase < 2; phase++ {
		var report struct {
			Shares []struct {
				ShareDir string         `json:"shareDir"`
				Counts   map[string]int `json:"counts"`
				Several  map[string]int `json:"several"`
			} `json:"shares"`
		}
		placementJSON145(t, s, "/api/placement/report", &report)
		if len(report.Shares) != 3 {
			t.Fatalf("expected only resolved shares: %+v", report)
		}
		for _, share := range report.Shares {
			sum := 0
			for _, n := range share.Several {
				sum += n
			}
			if sum != share.Counts["several"] {
				t.Errorf("%s breakdown %d != %d", share.ShareDir, sum, share.Counts["several"])
			}
			if phase == 0 && share.ShareDir == "documentaries" && share.Counts["several"] != 10 {
				t.Errorf("documentaries must have exactly ten matches: %+v", share)
			}
			for _, key := range []string{"all", "several", "one_disk", "empty", "no_arr", "not_found", "several_split", "several_empty_folders", "several_empty", "several_waiting_for_mover", "several_seasons_spread", "several_errors"} {
				var list struct {
					Total int `json:"total"`
				}
				placementJSON145(t, s, "/api/placement/items?share="+url.QueryEscape(share.ShareDir)+"&status="+key, &list)
				if list.Total != share.Counts[key] {
					t.Errorf("phase %d %s/%s: report %d != list %d", phase, share.ShareDir, key, share.Counts[key], list.Total)
				}
			}
		}
		if _, e := s.Store.DB.Exec("UPDATE placement_items SET job_status='succeeded' WHERE rel IN ('documentaries/L','movies/G')"); e != nil {
			t.Fatal(e)
		}
	}
}

func TestPerformance100KPlacement145(t *testing.T) {
	if os.Getenv("SCOPEARR_PERF") != "1" {
		t.Skip("explicit 100,000-row query check")
	}
	store := testStore(t)
	_, e := store.DB.Exec(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<100000)
 INSERT INTO placement_items(item_key,service,instance,media_id,title,rel,scan_status,total_bytes,move_bytes,move_files,updated_at,share,devices)
 SELECT 'folder:'||x,'','','0','Film '||x,'movies/Film '||x,CASE x%5 WHEN 0 THEN 'empty' WHEN 1 THEN 'split' WHEN 2 THEN 'waiting_for_mover' WHEN 3 THEN 'empty_folders' ELSE 'ok' END,0,0,0,'','movies',CASE x%5 WHEN 4 THEN 1 ELSE 2 END FROM n`)
	if e != nil {
		t.Fatal(e)
	}
	keys, columns := placementCountColumns()
	started := time.Now()
	counts, e := placementReadCounts(store.DB.QueryRow(placementCountFacts+"SELECT "+columns+" FROM placement_count_facts"), keys)
	elapsed := time.Since(started)
	if e != nil || counts["all"] != 100000 || counts["several"] != 80000 {
		t.Fatal(counts, e)
	}
	t.Logf("100k counts query: %s", elapsed)
	started = time.Now()
	report, e := store.placementReport(context.Background(), []PlacementShare{{ShareDir: "movies"}})
	reportElapsed := time.Since(started)
	if e != nil || len(report) != 1 || report[0].Counts["all"] != 100000 {
		t.Fatal(report, e)
	}
	t.Logf("100k report queries: %s", reportElapsed)
	if elapsed >= 50*time.Millisecond || reportElapsed >= 50*time.Millisecond {
		t.Errorf("100k count/report budget exceeded: %s / %s", elapsed, reportElapsed)
	}
}

func TestPlacementEmptyCopyCleanup145(t *testing.T) {
	for _, content := range []string{"video", ""} {
		t.Run(fmt.Sprintf("bytes-%d", len(content)), func(t *testing.T) {
			s, cfg := placementFixture130(t)
			placementWrite130(t, cfg, "disk3", "film.mkv", content)
			emptyDir145(t, cfg, "disk3", "movies/Film/keep-target-empty-dir")
			emptyDir145(t, cfg, "disk6", "movies/Film/empty-source")
			item := placementPlan130(t, s, cfg)
			if item.ScanStatus != "empty_folders" || item.MoveFiles != 0 || item.Target != "disk3" {
				t.Fatalf("expected cleanup-only plan: %+v", item)
			}
			if e := s.Placement.executeMove(context.Background(), cfg, &item); e != nil {
				t.Fatal(e)
			}
			if _, e := os.Stat(filepath.Join(cfg.Unraid.DiskRoot, "disk3/movies/Film/keep-target-empty-dir")); e != nil {
				t.Fatalf("target changed: %v", e)
			}
			if _, e := os.Stat(filepath.Join(cfg.Unraid.DiskRoot, "disk3/movies/Film/film.mkv")); e != nil {
				t.Fatal(e)
			}
			if _, e := os.Stat(filepath.Join(cfg.Unraid.DiskRoot, "disk6/movies/Film")); !os.IsNotExist(e) {
				t.Fatalf("empty source remains: %v", e)
			}
		})
	}
	s, cfg := placementFixture130(t)
	placementWrite130(t, cfg, "disk3", "film.mkv", "video")
	emptyDir145(t, cfg, "disk6", "movies/Film/empty")
	item := placementPlan130(t, s, cfg)
	placementWrite130(t, cfg, "disk6", "new.nfo", "do not remove")
	if e := s.Placement.executeMove(context.Background(), cfg, &item); e == nil {
		t.Error("changed nonempty source was accepted")
	}
	if _, e := os.Stat(filepath.Join(cfg.Unraid.DiskRoot, "disk6/movies/Film/new.nfo")); e != nil {
		t.Fatal("nonempty source lost", e)
	}
}

func TestPlacementSpecialFileProtection145(t *testing.T) {
	s, cfg := shareFixture144(t)
	shareFile144(t, cfg, "disk3", "documentaries/Links/regular.mkv")
	emptyDir145(t, cfg, "disk6", "documentaries/Links")
	if e := os.Symlink("/unreachable", filepath.Join(cfg.Unraid.DiskRoot, "disk6/documentaries/Links/link")); e != nil {
		t.Fatal(e)
	}
	s.Placement.runScan(context.Background(), cfg)
	item := placementRows144(t, s)["documentaries/Links"]
	if item.ScanStatus == "empty" {
		t.Fatal("link-only source is not empty")
	}
	if len(item.Warnings) == 0 {
		t.Error("special entry must retain its warning")
	}
	if item.selectable() {
		t.Errorf("a link on a source disk cannot be silently left behind by a successful move: %+v", item)
	}
}

type failingPlacementStat145 struct {
	placementOSMetadata
	fail string
}

func (m failingPlacementStat145) Lstat(path string) (os.FileInfo, error) {
	if path == m.fail {
		return nil, os.ErrPermission
	}
	return m.placementOSMetadata.Lstat(path)
}
func TestPlacementUnreadableDevicePresence145(t *testing.T) {
	s, cfg := shareFixture144(t)
	s.Placement.metadata = failingPlacementStat145{fail: filepath.Join(cfg.Unraid.DiskRoot, "disk6/documentaries/Film A")}
	s.Placement.runScan(context.Background(), cfg)
	item := placementRows144(t, s)["documentaries/Film A"]
	if item.ScanStatus != "error" || item.Devices != 2 || len(item.Disks) != 2 {
		t.Fatalf("unreadable folder must retain known device presence: %+v", item)
	}
}

func TestPlacementFileCheckFolderParity145(t *testing.T) {
	s, cfg := placementFixture145(t)
	cfg.Mux.Mappings = "/movies => " + filepath.Join(cfg.Unraid.ShareRoot, "movies") + "\n/shows => " + filepath.Join(cfg.Unraid.ShareRoot, "shows") + "\n/documentaries => " + filepath.Join(cfg.Unraid.ShareRoot, "documentaries")
	setTestSettings(s, cfg)
	s.Placement.runScan(context.Background(), cfg)
	folders, e := s.arrFolders(context.Background(), cfg, nil)
	if e != nil {
		t.Fatal(e)
	}
	for _, folder := range folders {
		rel, e := placementRel(cfg.Unraid.ShareRoot, folder.Local)
		if e != nil {
			t.Fatal(e)
		}
		var n int
		if e = s.Store.DB.QueryRow("SELECT count(*) FROM placement_items WHERE rel=?", rel).Scan(&n); e != nil || n != 1 {
			t.Fatalf("Files & permissions folder %s has %d placement rows: %v", rel, n, e)
		}
	}
}

func TestPlacementLateSpecialSource145(t *testing.T) {
	s, cfg := placementFixture130(t)
	placementWrite130(t, cfg, "disk3", "film.mkv", "video")
	emptyDir145(t, cfg, "disk6", "movies/Film")
	item := placementPlan130(t, s, cfg)
	if item.ScanStatus != "empty_folders" || item.Target != "disk3" {
		t.Fatal(item)
	}
	path := filepath.Join(cfg.Unraid.DiskRoot, "disk6/movies/Film/late-link")
	if e := os.Symlink("/unreachable", path); e != nil {
		t.Fatal(e)
	}
	if e := s.Placement.executeMove(context.Background(), cfg, &item); e == nil {
		t.Error("a late special source entry must reject execution")
	}
	if _, e := os.Lstat(path); e != nil {
		t.Fatal("late source entry lost", e)
	}
	if _, e := os.Stat(filepath.Join(cfg.Unraid.DiskRoot, "disk3/movies/Film/film.mkv")); e != nil {
		t.Fatal("target lost", e)
	}
}

func TestPlacementSpecialSourceDuringCopy145(t *testing.T) {
	s, cfg := placementFixture130(t)
	placementWrite130(t, cfg, "disk3", "film.mkv", strings.Repeat("video", 100))
	placementWrite130(t, cfg, "disk6", "subtitle.srt", "small")
	item := placementPlan130(t, s, cfg)
	if item.Target != "disk3" {
		t.Fatal(item)
	}
	originalCopy := s.Placement.testCopy
	path := filepath.Join(cfg.Unraid.DiskRoot, "disk6/movies/Film/during-copy-link")
	s.Placement.testCopy = func(ctx context.Context, src, dst *os.File, progress func(int64)) error {
		if e := originalCopy(ctx, src, dst, progress); e != nil {
			return e
		}
		return os.Symlink("/unreachable", path)
	}
	if e := s.Placement.executeMove(context.Background(), cfg, &item); e == nil {
		t.Error("a source left behind during copying must not succeed")
	}
	if _, e := os.Lstat(path); e != nil {
		t.Fatal("new source entry lost", e)
	}
	if _, e := os.Stat(filepath.Join(cfg.Unraid.DiskRoot, "disk3/movies/Film/subtitle.srt")); e != nil {
		t.Fatal("published copy lost", e)
	}
}

func TestPlacementRootCompanionKeepsSeasons145(t *testing.T) {
	s, cfg := placementFixture130(t)
	placementWrite130(t, cfg, "disk3", "poster.jpg", "art")
	placementWrite130(t, cfg, "disk3", "Season 01/episode.mkv", "one")
	placementWrite130(t, cfg, "disk6", "Season 02/episode.mkv", "two")
	disks, e := discoverDisks(cfg.Unraid.DiskRoot)
	if e != nil {
		t.Fatal(e)
	}
	season := -1
	item, e := s.Placement.inspectItem(context.Background(), cfg.Unraid, disks, PlacementItem{ID: 1, Key: "root", Rel: "movies/Film", Season: &season}, placementParents{})
	if e != nil {
		t.Fatal(e)
	}
	item = planPlacement(item, cfg.Unraid, disks, map[string]int64{}, "disk6")
	if !item.startable() {
		t.Fatal(item)
	}
	if e = s.Placement.executeMove(context.Background(), cfg, &item); e != nil {
		t.Fatalf("root metadata move must retain managed season directories: %v", e)
	}
	for _, path := range []string{"disk3/movies/Film/Season 01/episode.mkv", "disk6/movies/Film/Season 02/episode.mkv", "disk6/movies/Film/poster.jpg"} {
		if _, e = os.Stat(filepath.Join(cfg.Unraid.DiskRoot, path)); e != nil {
			t.Fatal(path, e)
		}
	}
}
