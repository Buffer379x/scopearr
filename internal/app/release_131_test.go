package app

import (
	"context"
	"database/sql"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"testing"
	"time"
)

func placementJobStatus131(t *testing.T, s *Server, id int64) string {
	t.Helper()
	var status string
	if e := s.Store.DB.QueryRow("SELECT job_status FROM placement_items WHERE id=?", id).Scan(&status); e != nil {
		t.Fatal(e)
	}
	return status
}

func TestPlacementCacheItemsStartInBulk146(t *testing.T) {
	s, cfg := placementFixture130(t)
	placementWrite130(t, cfg, "cache", "Film.nfo", "nfo")
	placementWrite130(t, cfg, "disk6", "Film.mkv", "long video")
	item := placementPlan130(t, s, cfg)
	if item.ScanStatus != "split" || item.Target != "disk6" || !item.startable() {
		t.Fatalf("%#v", item)
	}
	w := httptest.NewRecorder()
	s.placementStartJobs(w, httptest.NewRequest("POST", "/api/placement/start", strings.NewReader(`{"all":true}`)))
	if w.Code != 202 || placementJobStatus131(t, s, item.ID) != "queued" {
		t.Fatal(w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	s.placementStartJobs(w, httptest.NewRequest("POST", "/api/placement/start", strings.NewReader(`{"ids":[`+jsonNumber130(item.ID)+`]}`)))
	if w.Code != 202 || placementJobStatus131(t, s, item.ID) != "queued" {
		t.Fatal(w.Code, w.Body.String())
	}
	check, _, e := s.Placement.checkItem(context.Background(), s.Config(), item)
	if e != nil || !check.NoConflict {
		t.Fatalf("%#v %v", check, e)
	}
}

func TestPlacementSortAndSingleRemove131(t *testing.T) {
	s, cfg := placementFixture130(t)
	placementWrite130(t, cfg, "disk3", "Film.nfo", "nfo")
	placementWrite130(t, cfg, "disk6", "Film.mkv", "long video")
	item := placementPlan130(t, s, cfg)
	for query, code := range map[string]int{"sort=title&dir=desc": 200, "sort=disks&dir=asc": 200, "sort=title": 400, "sort=size%3BDROP&dir=asc": 400, "": 200} {
		w := httptest.NewRecorder()
		s.placementHTTP(w, httptest.NewRequest("GET", "/api/placement/items?"+query, nil))
		if w.Code != code {
			t.Fatal(query, w.Code, w.Body.String())
		}
	}
	path := "/api/placement/items/" + jsonNumber130(item.ID)
	w := httptest.NewRecorder()
	s.placementHTTP(w, httptest.NewRequest("DELETE", path, nil))
	if w.Code != 409 {
		t.Fatal(w.Code, w.Body.String())
	}
	if _, e := s.Store.DB.Exec("UPDATE placement_items SET job_status='succeeded' WHERE id=?", item.ID); e != nil {
		t.Fatal(e)
	}
	w = httptest.NewRecorder()
	s.placementHTTP(w, httptest.NewRequest("DELETE", path, nil))
	var n int
	_ = s.Store.DB.QueryRow("SELECT count(*) FROM placement_items").Scan(&n)
	if w.Code != 200 || n != 0 {
		t.Fatal(w.Code, n)
	}
}

func TestReserveAndColumnMigration131(t *testing.T) {
	cfg := DefaultSettings()
	legacy := 15
	cfg.Unraid.ReserveGB, cfg.Unraid.LegacyReserve = 0, &legacy
	if e := normalizeUnraid(&cfg); e != nil || cfg.Unraid.ReserveGB != 15 || *cfg.Unraid.LegacyReserve != 15 {
		t.Fatal(e, cfg.Unraid.ReserveGB)
	}
	zero := 0
	cfg.Unraid.ReserveGB, cfg.Unraid.LegacyReserve = 0, &zero
	if e := normalizeUnraid(&cfg); e != nil || cfg.Unraid.ReserveGB != 0 {
		t.Fatal(e, cfg.Unraid.ReserveGB)
	}
	if placementHasSpace(21e9, 0, 20) != true || placementHasSpace(19e9, 0, 20) {
		t.Fatal("reserve must use decimal GB")
	}
	cfg.PlacementColumnOrder = []string{"select", "progress", "actions", "title", "service", "size", "disks", "target", "move", "kind", "status"}
	cfg.PlacementVisibleColumns = []string{"select", "title"}
	if e := normalizePlacementColumns(&cfg); e != nil || cfg.PlacementColumnOrder[len(cfg.PlacementColumnOrder)-1] != "remove" || !slices.Contains(cfg.PlacementVisibleColumns, "remove") {
		t.Fatal(e, cfg.PlacementColumnOrder, cfg.PlacementVisibleColumns)
	}
}

func TestFileCheckRules131(t *testing.T) {
	stems := []string{"Film (2020)"}
	for name, want := range map[string]bool{"Film (2020).de.forced.srt": true, "Film (2020)-poster.jpg": true, "Film (2020).nfo": true, "Film (2020)": true, "Film (2020)x.srt": false, "Old.srt": false} {
		if fileCheckMatchesStem(name, stems) != want {
			t.Fatal(name)
		}
	}
	if !fileCheckJunk(".DS_Store", false) || !fileCheckJunk("._Film.mkv", false) || !fileCheckJunk("@eaDir", true) || fileCheckJunk("@eaDir", false) || fileCheckJunk("Film.mkv", false) {
		t.Fatal("junk")
	}
	if !fileCheckMatches(defaultFileCheckAllowed, "Season01-Poster.JPG", false) || fileCheckMatches(defaultFileCheckAllowed, "extrafanart", false) || !fileCheckMatches(defaultFileCheckAllowed, "extrafanart", true) {
		t.Fatal("allowed")
	}
	if !fileCheckExtra("Film-trailer.mkv") || fileCheckExtra("Film.mkv") {
		t.Fatal("extras")
	}
	cfg := DefaultSettings()
	for _, broken := range []func(*FileCheckSettings){
		func(f *FileCheckSettings) { f.FileMode = "0777" },
		func(f *FileCheckSettings) { f.FileMode = "644" },
		func(f *FileCheckSettings) { f.DirMode = "0666" },
		func(f *FileCheckSettings) { f.OwnerUID = -1 },
		func(f *FileCheckSettings) { f.Kinds = []string{"nonsense"} },
		func(f *FileCheckSettings) { f.Ignore = []string{"[broken"} },
		func(f *FileCheckSettings) { f.Libraries = []string{"missing"} },
	} {
		next := cfg
		next.FileCheck = defaultFileCheckSettings()
		broken(&next.FileCheck)
		if normalizeFileCheck(&next) == nil {
			t.Fatalf("%#v", next.FileCheck)
		}
	}
	old := DefaultSettings()
	old.FileCheck = FileCheckSettings{}
	if e := normalizeFileCheck(&old); e != nil || old.FileCheck.FileMode != "0666" || len(old.FileCheck.Kinds) != len(fileCheckKinds) {
		t.Fatal(e, old.FileCheck)
	}
}

func fileCheckWrite131(t *testing.T, root, rel, content string) string {
	t.Helper()
	path := filepath.Join(root, rel)
	if e := os.MkdirAll(filepath.Dir(path), 0755); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(path, []byte(content), 0644); e != nil {
		t.Fatal(e)
	}
	return path
}

func TestFileCheckInspect131(t *testing.T) {
	root := filepath.Join(t.TempDir(), "Film (2020)")
	video := fileCheckWrite131(t, root, "Film (2020).mkv", "video")
	for _, rel := range []string{"Film (2020).de.srt", "Old.srt", "poster.jpg", ".DS_Store", ".secret", "notes.txt", "Trailers/x.mkv", "Film-trailer.mkv", "Other.mkv", "sample.mkv", ".actors/a.jpg", "Film (2020).trickplay/1.jpg", "Gone.trickplay/1.jpg", "@eaDir/x", "locked.nfo", "root.nfo"} {
		fileCheckWrite131(t, root, rel, "x")
	}
	if e := os.MkdirAll(filepath.Join(root, "empty"), 0755); e != nil {
		t.Fatal(e)
	}
	if e := os.Symlink("/etc/passwd", filepath.Join(root, "link")); e != nil {
		t.Fatal(e)
	}
	access, owner, euid, egid := fileCheckAccess, placementOwner, fileCheckEUID, fileCheckEGID
	t.Cleanup(func() { fileCheckAccess, placementOwner, fileCheckEUID, fileCheckEGID = access, owner, euid, egid })
	fileCheckAccess = func(p string, dir bool) bool {
		return filepath.Base(p) != "locked.nfo" && filepath.Base(p) != "root.nfo"
	}
	placementOwner = func(info os.FileInfo) (uint32, uint32) {
		if info.Name() == "root.nfo" {
			return 0, 0
		}
		return 99, 100
	}
	fileCheckEUID = func() int { return 99 }
	fileCheckEGID = func() int { return 100 }
	cfg := DefaultSettings()
	folder := arrFolder{Service: "radarr", Instance: "Movies", MediaID: 1, Title: "Film", Local: root}
	got := []string{}
	files, e := fileCheckInspect(cfg, folder, map[string]bool{video: true}, func(item FileCheckItem) error {
		if item.Root != root || item.Path != filepath.Join(root, item.Rel) {
			t.Fatalf("%#v", item)
		}
		got = append(got, item.Rel+"|"+item.Kind+"|"+item.Fix+"|"+item.Note)
		return nil
	})
	if e != nil || files == 0 {
		t.Fatal(e, files)
	}
	sort.Strings(got)
	want := []string{
		".DS_Store|junk|delete|",
		".secret|hidden|delete|",
		"@eaDir|junk|delete|",
		"Gone.trickplay|orphan|delete|Trickplay",
		"Old.srt|orphan|delete|",
		"Other.mkv|untracked_media|delete|",
		"empty|empty_dir|delete|",
		"link|other|manual|Symlink",
		"locked.nfo|orphan|delete|",
		"locked.nfo|permissions|chmod|",
		"notes.txt|other|delete|",
		"root.nfo|orphan|delete|",
		"root.nfo|owner|manual|",
		"root.nfo|permissions|manual|",
		"sample.mkv|untracked_media|delete|Sample",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("got\n%s", strings.Join(got, "\n"))
	}
	cfg.FileCheck.Kinds = []string{"owner"}
	cfg.FileCheck.Ignore = []string{"root.nfo"}
	got = got[:0]
	if _, e = fileCheckInspect(cfg, folder, map[string]bool{video: true}, func(item FileCheckItem) error {
		got = append(got, item.Rel)
		return nil
	}); e != nil || len(got) != 0 {
		t.Fatal(e, got)
	}
}

func TestFileCheckCommands131(t *testing.T) {
	cfg := DefaultSettings()
	cfg.Unraid.Enabled = true
	items := []FileCheckItem{
		{Path: "/media/movies/It's $(x)/a.nfo", Kind: "orphan"},
		{Path: "/media/movies/Dir", Kind: "owner", Dir: true},
		{Path: "/media/movies/Empty", Kind: "empty_dir", Dir: true},
		{Path: "/media/movies/bad\nname", Kind: "junk"},
	}
	text := fileCheckCommands(cfg, items)
	for _, want := range []string{`rm -f -- '/mnt/user/movies/It'\''s $(x)/a.nfo'`, "chown 99:100 -- '/mnt/user/movies/Dir'", "rmdir -- '/mnt/user/movies/Empty'", "# skipped: unsupported characters"} {
		if !strings.Contains(text, want) {
			t.Fatal(want, "\n", text)
		}
	}
	text = fileCheckCommands(cfg, []FileCheckItem{{Path: "/media/a.nfo", Kind: "owner"}, {Path: "/media/a.nfo", Kind: "permissions"}, {Path: "/media/a.nfo", Kind: "orphan"}, {Path: "/media/b.nfo", Kind: "owner"}, {Path: "/media/b.nfo", Kind: "permissions"}})
	if strings.Count(text, "a.nfo") != 1 || !strings.Contains(text, "rm -f -- '/mnt/user/a.nfo'") || strings.Count(text, "chown 99:100 -- '/mnt/user/b.nfo'") != 1 || strings.Count(text, "b.nfo") != 2 {
		t.Fatal(text)
	}
	cfg.Unraid.Enabled = false
	if text = fileCheckCommands(cfg, items[:1]); !strings.Contains(text, "container paths") || !strings.Contains(text, "'/media/movies/It") {
		t.Fatal(text)
	}
}

func fileCheckRow131(t *testing.T, s *Server, root, rel, kind, fix string) FileCheckItem {
	t.Helper()
	path := filepath.Join(root, rel)
	info, e := os.Lstat(path)
	if e != nil {
		t.Fatal(e)
	}
	uid, gid := placementOwner(info)
	item := FileCheckItem{Service: "radarr", Instance: "Movies", MediaID: 1, Title: "Film", Root: root, Rel: rel, Path: path, Dir: info.IsDir(), Kind: kind, Fix: fix, Mode: uint32(info.Mode()), UID: int(uid), GID: int(gid), Mtime: info.ModTime().UnixNano(), UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	if !item.Dir {
		item.Size = info.Size()
	}
	result, e := s.Store.DB.Exec("INSERT INTO filecheck_items("+strings.TrimPrefix(fileCheckColumns, "id,")+") VALUES(?"+strings.Repeat(",?", 21)+")", fileCheckArgs(&item)...)
	if e != nil {
		t.Fatal(e)
	}
	item.ID, _ = result.LastInsertId()
	return item
}

func TestFileCheckFixes131(t *testing.T) {
	s, cfg := placementFixture130(t)
	root := filepath.Join(cfg.Unraid.ShareRoot, "movies", "Film")
	fileCheckWrite131(t, root, "Film.mkv", "video")
	fileCheckWrite131(t, root, "Old.srt", "x")
	orphan := fileCheckRow131(t, s, root, "Old.srt", "orphan", "delete")
	fileCheckWrite131(t, root, "Changed.nfo", "x")
	changed := fileCheckRow131(t, s, root, "Changed.nfo", "orphan", "delete")
	if e := os.WriteFile(changed.Path, []byte("different"), 0644); e != nil {
		t.Fatal(e)
	}
	fileCheckWrite131(t, root, "mode.nfo", "x")
	if e := os.Chmod(filepath.Join(root, "mode.nfo"), 0600); e != nil {
		t.Fatal(e)
	}
	mode := fileCheckRow131(t, s, root, "mode.nfo", "permissions", "chmod")
	managed := fileCheckRow131(t, s, root, "Film.mkv", "untracked_media", "delete")
	if e := s.Store.Replace("radarr", []File{{Service: "radarr", ID: 1, MediaID: 1, Title: "Film", Filename: "Film.mkv", SourcePath: "/arr/movies/Film/Film.mkv", Size: 5, Years: []int{}, Episodes: []Episode{}, Evidence: map[string]Evidence{}, Custom: []CustomTag{}, AudioTracks: []AudioTrack{}}}, SyncStatus{Count: 1}); e != nil {
		t.Fatal(e)
	}
	if e := os.MkdirAll(filepath.Join(root, "empty"), 0755); e != nil {
		t.Fatal(e)
	}
	empty := fileCheckRow131(t, s, root, "empty", "empty_dir", "delete")
	fileCheckWrite131(t, root, "empty/late.txt", "x")
	ctx := context.Background()
	f := s.FileCheck
	if e := f.fix(ctx, s.Config(), &orphan); e != nil {
		t.Fatal(e)
	}
	if _, e := os.Lstat(orphan.Path); !os.IsNotExist(e) {
		t.Fatal("orphan not deleted")
	}
	if e := f.fix(ctx, s.Config(), &changed); e != errFileCheckChanged {
		t.Fatal(e)
	}
	if e := f.fix(ctx, s.Config(), &managed); e != errFileCheckChanged {
		t.Fatal("managed video must never be deleted", e)
	}
	if e := f.fix(ctx, s.Config(), &empty); e != errFileCheckChanged {
		t.Fatal(e)
	}
	if e := f.fix(ctx, s.Config(), &mode); e != nil {
		t.Fatal(e)
	}
	if st, _ := os.Stat(mode.Path); st.Mode().Perm() != 0666 {
		t.Fatal(st.Mode())
	}
	escape := orphan
	escape.Rel = "../outside"
	if e := f.fix(ctx, s.Config(), &escape); e != errFileCheckChanged {
		t.Fatal(e)
	}
}

func TestFileCheckTakeOwnership131(t *testing.T) {
	s, cfg := placementFixture130(t)
	shareRoot := filepath.Join(cfg.Unraid.ShareRoot, "movies", "Film")
	stamp := time.Unix(1700000000, 123456789)
	for _, base := range []string{shareRoot, filepath.Join(cfg.Unraid.DiskRoot, "disk6", "movies", "Film")} {
		p := fileCheckWrite131(t, base, "Film.nfo", "metadata")
		if e := os.Chmod(p, 0600); e != nil {
			t.Fatal(e)
		}
		if e := os.Chtimes(p, stamp, stamp); e != nil {
			t.Fatal(e)
		}
	}
	item := fileCheckRow131(t, s, shareRoot, "Film.nfo", "owner", "take_ownership")
	if e := s.FileCheck.fix(context.Background(), s.Config(), &item); e != nil {
		t.Fatal(e)
	}
	physical := filepath.Join(cfg.Unraid.DiskRoot, "disk6", "movies", "Film", "Film.nfo")
	st, e := os.Stat(physical)
	data, _ := os.ReadFile(physical)
	if e != nil || st.Mode().Perm() != 0666 || !st.ModTime().Equal(stamp) || string(data) != "metadata" {
		t.Fatal(e, st.Mode(), st.ModTime())
	}
	if left, _ := filepath.Glob(filepath.Join(filepath.Dir(physical), ".*.partial")); len(left) != 0 {
		t.Fatal(left)
	}
	cfg.Unraid.Enabled = false
	s.mu.Lock()
	s.settings = cfg
	s.mu.Unlock()
	if e := s.FileCheck.fix(context.Background(), s.Config(), &item); e == nil {
		t.Fatal("take ownership needs the Unraid service")
	}
}

func TestFileCheckFixAllSkipsUntracked131(t *testing.T) {
	s, cfg := placementFixture130(t)
	root := filepath.Join(cfg.Unraid.ShareRoot, "movies", "Film")
	fileCheckWrite131(t, root, "Old.srt", "x")
	fileCheckWrite131(t, root, "Other.mkv", "x")
	orphan := fileCheckRow131(t, s, root, "Old.srt", "orphan", "delete")
	untracked := fileCheckRow131(t, s, root, "Other.mkv", "untracked_media", "delete")
	fileCheckWrite131(t, root, "notes.txt", "x")
	other := fileCheckRow131(t, s, root, "notes.txt", "other", "delete")
	status := func(id int64) string {
		var v string
		_ = s.Store.DB.QueryRow("SELECT job_status FROM filecheck_items WHERE id=?", id).Scan(&v)
		return v
	}
	w := httptest.NewRecorder()
	s.fileCheckHTTP(w, httptest.NewRequest("POST", "/api/filecheck/fix", strings.NewReader(`{"all":true,"query":"kind=orphan&q=old"}`)))
	if w.Code != 202 || status(orphan.ID) != "queued" || status(other.ID) != "" {
		t.Fatal(w.Code, w.Body.String(), status(other.ID))
	}
	w = httptest.NewRecorder()
	s.fileCheckHTTP(w, httptest.NewRequest("POST", "/api/filecheck/fix", strings.NewReader(`{"all":true}`)))
	if w.Code != 202 || status(orphan.ID) != "queued" || status(untracked.ID) != "" {
		t.Fatal(w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	s.fileCheckHTTP(w, httptest.NewRequest("POST", "/api/filecheck/fix", strings.NewReader(`{"ids":[`+jsonNumber130(untracked.ID)+`]}`)))
	if w.Code != 202 || status(untracked.ID) != "queued" {
		t.Fatal(w.Code, w.Body.String())
	}
	if !s.fileWork.try("mux") {
		t.Fatal("lock busy")
	}
	if s.FileCheck.processOne(context.Background()) {
		t.Fatal("file fixes must wait for the shared lock")
	}
	s.fileWork.release("mux")
	for s.FileCheck.processOne(context.Background()) {
	}
	if status(orphan.ID) != "succeeded" || status(untracked.ID) != "succeeded" || status(other.ID) != "succeeded" {
		t.Fatal(status(orphan.ID), status(untracked.ID))
	}
	w = httptest.NewRecorder()
	s.fileCheckHTTP(w, httptest.NewRequest("GET", "/api/filecheck/items?sort=path&dir=desc", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), "Other.mkv") {
		t.Fatal(w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	s.fileCheckHTTP(w, httptest.NewRequest("GET", "/api/filecheck/items?sort=evil&dir=asc", nil))
	if w.Code != 400 {
		t.Fatal(w.Code)
	}
}

func TestSchema18Migration131(t *testing.T) {
	dir := t.TempDir()
	store, e := OpenStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = store.DB.Exec("DROP TABLE filecheck_items; DROP TABLE filecheck_scan; PRAGMA user_version=17"); e != nil {
		t.Fatal(e)
	}
	store.DB.Close()
	store, e = OpenStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	var version, tables int
	_ = store.DB.QueryRow("PRAGMA user_version").Scan(&version)
	_ = store.DB.QueryRow("SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('filecheck_items','filecheck_scan')").Scan(&tables)
	store.DB.Close()
	if version != 18 || tables != 2 {
		t.Fatal(version, tables)
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
	if e = backup.QueryRow("PRAGMA user_version").Scan(&version); e != nil || version != 17 {
		t.Fatal(version, e)
	}
}
