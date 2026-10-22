package app

import (
	"context"
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestPlacementSeasonsAndMetadata130(t *testing.T) {
	s, cfg := placementFixture130(t)
	cfg.Instances[0].Type = "sonarr"
	cfg.Unraid.SeriesGrouping = "season"
	placementWrite130(t, cfg, "disk3", "Season 01/Episode.mkv", "one")
	placementWrite130(t, cfg, "disk6", "Season 02/Episode.mkv", "a much longer episode")
	placementWrite130(t, cfg, "disk3", "poster.jpg", "art")
	base := filepath.Join(cfg.Unraid.DiskRoot, "disk3/movies/Film")
	if e := os.Symlink("/etc/passwd", filepath.Join(base, "escape")); e != nil {
		t.Fatal(e)
	}
	if e := syscall.Mkfifo(filepath.Join(base, "fifo"), 0600); e != nil {
		t.Fatal(e)
	}
	arr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode([]map[string]any{{"id": 1, "title": "Film", "path": "/arr/movies/Film"}, {"id": 2, "title": "Outside", "path": "/other/outside"}})
	}))
	defer arr.Close()
	cfg.Instances[0].URL = arr.URL
	s.settings = cfg
	s.Placement.runScan(context.Background(), cfg)
	scan := s.Placement.scanStatus()
	if scan.Error != "" || scan.Checked != 4 || scan.OK != 2 {
		t.Fatal(scan)
	}
	rows, e := s.Store.DB.Query("SELECT " + placementColumns + " FROM placement_items ORDER BY id")
	if e != nil {
		t.Fatal(e)
	}
	foundRoot, foundOutside := false, false
	for rows.Next() {
		j, e := scanPlacement(rows)
		if e != nil {
			t.Fatal(e)
		}
		if j.rootOnly() {
			foundRoot = true
			if j.Target != "disk6" || len(j.Warnings) != 2 || j.MoveFiles != 1 {
				t.Fatal(j)
			}
			for _, f := range j.Files {
				if strings.Contains(f.Rel, "Episode") || f.Rel == "fifo" || f.Rel == "escape" {
					t.Fatal(f)
				}
			}
		}
		if j.ScanStatus == "outside_share" {
			foundOutside = true
		}
	}
	rows.Close()
	if !foundRoot || !foundOutside {
		t.Fatal(foundRoot, foundOutside)
	}
	cfg.Unraid.SeriesGrouping = "series"
	s.settings = cfg
	s.Placement.runScan(context.Background(), cfg)
	scan = s.Placement.scanStatus()
	if scan.Error != "" || scan.Checked != 2 || scan.Several != 1 {
		t.Fatal(scan)
	}
}

func TestPlacementSpaceFalls130(t *testing.T) {
	s, cfg := placementFixture130(t)
	placementWrite130(t, cfg, "disk3", "1.nfo", "first")
	placementWrite130(t, cfg, "disk3", "2.nfo", "second")
	placementWrite130(t, cfg, "disk6", "Film.mkv", "much larger media")
	item := placementPlan130(t, s, cfg)
	oldSpace := muxSpace
	t.Cleanup(func() { muxSpace = oldSpace })
	free := uint64(1 << 30)
	muxSpace = func(string) (uint64, error) { return free, nil }
	copier := s.Placement.testCopy
	s.Placement.testCopy = func(ctx context.Context, a, b *os.File, progress func(int64)) error {
		e := copier(ctx, a, b, progress)
		free = 0
		return e
	}
	e := s.Placement.executeMove(context.Background(), cfg, &item)
	if e == nil || !strings.Contains(e.Error(), "free space") {
		t.Fatal(e)
	}
	for _, test := range []struct{ disk, name string }{{"disk6", "1.nfo"}, {"disk3", "2.nfo"}} {
		if _, e := os.Stat(filepath.Join(cfg.Unraid.DiskRoot, test.disk, "movies/Film", test.name)); e != nil {
			t.Fatal(e)
		}
	}
	if _, e := os.Stat(filepath.Join(cfg.Unraid.DiskRoot, "disk3/movies/Film/1.nfo")); !os.IsNotExist(e) {
		t.Fatal(e)
	}
}

func TestPlacementMigration130(t *testing.T) {
	dir := t.TempDir()
	store, e := OpenStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	source, spec := muxFixture120()
	job := MuxJob{Service: "radarr", FileID: 1, Source: source, Spec: spec, Status: "queued"}
	if e = store.muxSave(&job); e != nil {
		t.Fatal(e)
	}
	before, _ := store.muxJobs()
	if _, e = store.DB.Exec("DROP TABLE placement_items; DROP TABLE placement_scan; PRAGMA user_version=16"); e != nil {
		t.Fatal(e)
	}
	store.DB.Close()
	store, e = OpenStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer store.DB.Close()
	var version int
	if e = store.DB.QueryRow("PRAGMA user_version").Scan(&version); e != nil || version != 17 {
		t.Fatal(version, e)
	}
	after, _ := store.muxJobs()
	a, _ := json.Marshal(before)
	b, _ := json.Marshal(after)
	if string(a) != string(b) {
		t.Fatal("mux jobs changed")
	}
	backups, _ := filepath.Glob(filepath.Join(dir, "backups", "*.db"))
	if len(backups) != 1 {
		t.Fatal(backups)
	}
	backup, e := sql.Open("sqlite", backups[0])
	if e != nil {
		t.Fatal(e)
	}
	defer backup.Close()
	if e = backup.QueryRow("PRAGMA user_version").Scan(&version); e != nil || version != 16 {
		t.Fatal(version, e)
	}
	if _, e = store.DB.Exec("PRAGMA user_version=18"); e != nil {
		t.Fatal(e)
	}
	store.DB.Close()
	if future, e := OpenStore(dir); e == nil {
		future.DB.Close()
		t.Fatal("future schema accepted")
	}
}

func TestPlacementGreedy130(t *testing.T) {
	u := defaultUnraidSettings()
	u.ReserveGiB = 0
	disks := []UnraidDisk{{Name: "disk3", Kind: "array", Free: 20}, {Name: "disk6", Kind: "array", Free: 30}}
	item := PlacementItem{ScanStatus: "split", TotalBytes: 30, Disks: map[string]PlacementDisk{"disk3": {Bytes: 15, Files: 1}, "disk6": {Bytes: 15, Files: 1}}, Files: []PlacementFile{{Disk: "disk3", Rel: "a.nfo", Size: 15, UID: 99, GID: 100}, {Disk: "disk6", Rel: "b.nfo", Size: 15, UID: 99, GID: 100}}}
	influx := map[string]int64{}
	a := planPlacement(item, u, disks, influx, "")
	b := planPlacement(item, u, disks, influx, "")
	c := planPlacement(item, u, disks, influx, "")
	d := planPlacement(item, u, disks, influx, "")
	if a.Target != "disk6" || b.Target != "disk6" || c.Target != "disk3" || d.ScanStatus != "no_space" {
		t.Fatal(a.Target, b.Target, c.Target, d.ScanStatus, influx)
	}
	u.ExcludedDisks = []string{"disk6"}
	if v := planPlacement(item, u, disks, map[string]int64{}, ""); v.Target != "disk3" {
		t.Fatal(v)
	}
	u.ReserveGiB = 1
	if v := planPlacement(item, u, disks, map[string]int64{}, ""); v.ScanStatus != "no_space" {
		t.Fatal(v)
	}
	u.ReserveGiB = 0
	item.Files[1].UID = 0
	if v := planPlacement(item, u, disks, map[string]int64{}, ""); v.ScanStatus != "foreign_owner" {
		t.Fatal(v)
	}
}

func TestPlacementQueueLocksAndMover130(t *testing.T) {
	s, cfg := placementFixture130(t)
	placementWrite130(t, cfg, "disk3", "Film.nfo", "info")
	placementWrite130(t, cfg, "disk6", "Film.mkv", "a longer video")
	item := placementPlan130(t, s, cfg)
	item.JobStatus = "queued"
	if e := s.Store.placementSave(&item); e != nil {
		t.Fatal(e)
	}
	if !s.fileWork.try("mux") {
		t.Fatal("claim")
	}
	s.Placement.processOne(context.Background())
	s.fileWork.release("mux")
	stored, _ := s.Store.placementItem(item.ID)
	if stored.JobStatus != "queued" || !strings.Contains(stored.Message, "mux") {
		t.Fatal(stored)
	}
	cfg.Unraid.StateDir = filepath.Join(filepath.Dir(cfg.Unraid.DiskRoot), "state")
	if e := os.Mkdir(cfg.Unraid.StateDir, 0755); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(filepath.Join(cfg.Unraid.StateDir, "var.ini"), []byte("shareMoverActive=yes\nmdResync=0\nmdResyncPos=0"), 0600); e != nil {
		t.Fatal(e)
	}
	s.settings = cfg
	s.Placement.processOne(context.Background())
	stored, _ = s.Store.placementItem(item.ID)
	if stored.JobStatus != "queued" || !strings.Contains(stored.Message, "mover") {
		t.Fatal(stored)
	}
	source, spec := muxFixture120()
	j := MuxJob{Service: "radarr", FileID: 1, MediaID: 1, Source: source, Spec: spec, Status: "queued"}
	if e := s.Store.muxSave(&j); e != nil {
		t.Fatal(e)
	}
	s.Mux.tool.Installed = true
	if !s.fileWork.try("placement") {
		t.Fatal("claim")
	}
	defer s.fileWork.release("placement")
	s.Mux.processOne(context.Background())
	jobs, _ := s.Store.muxJobs()
	if len(jobs) != 1 || jobs[0].Status != "queued" || !strings.Contains(jobs[0].Message, "placement") {
		t.Fatal(jobs)
	}
	// Orphan recovery must respect the same claim, too.
	jobs[0].Status = "running"
	if e := s.Store.muxSave(&jobs[0]); e != nil {
		t.Fatal(e)
	}
	if _, e := s.Store.DB.Exec("UPDATE mux_jobs SET updated_at=?", time.Now().Add(-time.Hour).UTC().Format(time.RFC3339Nano)); e != nil {
		t.Fatal(e)
	}
	s.Mux.processOne(context.Background())
	jobs, _ = s.Store.muxJobs()
	if jobs[0].Status != "running" {
		t.Fatal(jobs[0])
	}
}

func TestPlacementQueueOrderCSVAndBusy130(t *testing.T) {
	s, cfg := placementFixture130(t)
	placementWrite130(t, cfg, "disk3", "Film.nfo", "info")
	placementWrite130(t, cfg, "disk6", "Film.mkv", "longer video")
	a := placementPlan130(t, s, cfg)
	b := a
	b.ID = 0
	b.Key = "other"
	b.Title = " =HYPERLINK(\"bad\")\nquoted"
	if e := insertPlacement(context.Background(), s.Store.DB, "placement_items", &b); e != nil {
		t.Fatal(e)
	}
	body := `{"ids":[` + jsonNumber130(b.ID) + `,` + jsonNumber130(a.ID) + `]}`
	for n := 0; n < 2; n++ {
		w := httptest.NewRecorder()
		s.placementStartJobs(w, httptest.NewRequest("POST", "/api/placement/start", strings.NewReader(body)))
		if w.Code != 202 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	rows, e := s.Store.DB.Query("SELECT id FROM placement_items ORDER BY queue_pos,id")
	if e != nil {
		t.Fatal(e)
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if e := rows.Scan(&id); e != nil {
			t.Fatal(e)
		}
		ids = append(ids, id)
	}
	rows.Close()
	if len(ids) != 2 || ids[0] != b.ID || ids[1] != a.ID {
		t.Fatal(ids)
	}
	w := httptest.NewRecorder()
	s.placementStartScan(w, httptest.NewRequest("POST", "/api/placement/scan", strings.NewReader(`{"seriesGrouping":"series","reserveGiB":0}`)))
	if w.Code != 409 {
		t.Fatal(w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	s.placementCSV(w, httptest.NewRequest("GET", "/api/placement/export.csv?target=disk6", nil))
	if w.Code != 200 || !strings.HasPrefix(w.Body.String(), "\xef\xbb\xbf") {
		t.Fatal(w.Code, w.Body.String())
	}
	data, e := csv.NewReader(strings.NewReader(strings.TrimPrefix(w.Body.String(), "\xef\xbb\xbf"))).ReadAll()
	if e != nil || len(data) != 3 {
		t.Fatal(data, e)
	}
	if !strings.Contains(w.Body.String(), "' =HYPERLINK") {
		t.Fatal("unescaped formula", w.Body.String())
	}
	w = httptest.NewRecorder()
	s.placementCSV(w, httptest.NewRequest("GET", "/api/placement/export.csv?target=disk3", nil))
	data, e = csv.NewReader(strings.NewReader(strings.TrimPrefix(w.Body.String(), "\xef\xbb\xbf"))).ReadAll()
	if e != nil || len(data) != 1 {
		t.Fatal(data, e)
	}
}
func jsonNumber130(id int64) string { b, _ := json.Marshal(id); return string(b) }

func TestPlacementCompletedPresentation130(t *testing.T) {
	original := PlacementItem{JobStatus: "succeeded", Target: "disk6", TotalBytes: 12, Disks: map[string]PlacementDisk{"disk3": {Files: 1, Bytes: 2}, "disk6": {Files: 1, Bytes: 10}}, Files: []PlacementFile{{Disk: "disk3", Rel: ".", Dir: true}, {Disk: "disk3", Rel: "Film.nfo", Size: 2}, {Disk: "disk6", Rel: "Film.mkv", Size: 10}}}
	shown := placementPresentation(original)
	if len(shown.Disks) != 1 || shown.Disks["disk6"].Files != 2 || shown.Disks["disk6"].Bytes != 12 || len(shown.Files) != 2 {
		t.Fatal(shown)
	}
	for _, file := range shown.Files {
		if file.Disk != "disk6" || file.Dir {
			t.Fatal(file)
		}
	}
	if original.Files[1].Disk != "disk3" || len(original.Disks) != 2 {
		t.Fatal("durable plan mutated")
	}
	original.JobStatus = "running"
	shown = placementPresentation(original)
	if len(shown.Disks) != 2 || len(shown.Files) != 3 {
		t.Fatal(shown)
	}
	empty := placementPresentation(PlacementItem{JobStatus: "succeeded", Target: "disk6", Disks: map[string]PlacementDisk{"disk3": {Dirs: 1}}})
	if len(empty.Disks) != 0 {
		t.Fatal(empty)
	}
}

func TestPlacementHTTPBoundary130(t *testing.T) {
	s, _ := placementFixture130(t)
	if _, e := s.Store.DB.Exec("INSERT INTO sessions VALUES(?,?,?)", tokenHash("placement-session"), "placement-csrf", time.Now().Add(time.Hour).Unix()); e != nil {
		t.Fatal(e)
	}
	for _, route := range []string{"/api/unraid/status", "/api/placement/scan", "/api/placement/items", "/api/placement/export.csv"} {
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, httptest.NewRequest("GET", route, nil))
		if w.Code != 401 {
			t.Fatal(route, w.Code)
		}
		r := httptest.NewRequest("GET", route, nil)
		r.AddCookie(&http.Cookie{Name: "scopearr_session", Value: "placement-session"})
		w = httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		if w.Code != 200 {
			t.Fatal(route, w.Code, w.Body.String())
		}
	}
	for _, test := range []struct{ method, route string }{{"POST", "/api/unraid/check"}, {"POST", "/api/placement/scan"}, {"DELETE", "/api/placement/scan"}, {"POST", "/api/placement/start"}, {"POST", "/api/placement/cancel"}, {"DELETE", "/api/placement/items?moved=1"}, {"POST", "/api/placement/items/1/recheck"}} {
		r := httptest.NewRequest(test.method, test.route, strings.NewReader("{}"))
		r.AddCookie(&http.Cookie{Name: "scopearr_session", Value: "placement-session"})
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		if w.Code != 403 {
			t.Fatal(test, w.Code, w.Body.String())
		}
	}
}

func TestUnraidMuxResolution130(t *testing.T) {
	s, cfg := placementFixture130(t)
	_ = s
	placementWrite130(t, cfg, "disk6", "Film.mkv", "video")
	local := filepath.Join(cfg.Unraid.ShareRoot, "movies/Film/Film.mkv")
	if e := os.MkdirAll(filepath.Dir(local), 0755); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(local, []byte("video"), 0640); e != nil {
		t.Fatal(e)
	}
	stamp := time.Unix(1700000000, 123456789)
	if e := os.Chtimes(local, stamp, stamp); e != nil {
		t.Fatal(e)
	}
	path, disk, e := muxResolvePhysical(cfg, local)
	if e != nil || disk != "disk6" || path != filepath.Join(cfg.Unraid.DiskRoot, "disk6/movies/Film/Film.mkv") {
		t.Fatal(path, disk, e)
	}
	j := MuxJob{}
	muxRecordLocation(&j, cfg, local, path, disk)
	data, _ := json.Marshal(j)
	if strings.Contains(string(data), cfg.Unraid.DiskRoot) || strings.Contains(string(data), cfg.Unraid.ShareRoot) {
		t.Fatal("private paths in JSON", string(data))
	}
	if resolved, e := resolveMuxJobDestination(cfg, j, "/arr/movies/Film/Film.mkv"); e != nil || resolved != path {
		t.Fatal(resolved, e)
	}
	placementWrite130(t, cfg, "disk3", "Film.mkv", "video")
	if _, _, e = muxResolvePhysical(cfg, local); !errors.Is(e, errMuxSeveralDisks) {
		t.Fatal(e)
	}
	if e := os.Remove(filepath.Join(cfg.Unraid.DiskRoot, "disk6/movies/Film/Film.mkv")); e != nil {
		t.Fatal(e)
	}
	if e := os.Remove(filepath.Join(cfg.Unraid.DiskRoot, "disk3/movies/Film/Film.mkv")); e != nil {
		t.Fatal(e)
	}
	path, disk, e = muxResolvePhysical(cfg, local)
	if e != nil || disk != muxDiskFallback || path != local {
		t.Fatal(path, disk, e)
	}
	placementWrite130(t, cfg, "cache", "Film.mkv", "video")
	_, disk, e = muxResolvePhysical(cfg, local)
	if e != nil || disk != "cache" {
		t.Fatal(disk, e)
	}
	cfg.Unraid.MuxSameDisk = false
	path, disk, e = muxResolvePhysical(cfg, local)
	if e != nil || disk != "" || path != local {
		t.Fatal(path, disk, e)
	}
}
