package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

// These cases catch commands that change more than the selected finding, or
// turn a review-only finding into a destructive operation.
func TestFileCheckCommandsKinds162(t *testing.T) {
	cfg := DefaultSettings()
	cfg.Unraid.Enabled = true
	cfg.FileCheck.FileMode, cfg.FileCheck.DirMode = "0664", "0775"
	for _, tc := range []struct {
		name         string
		items        []FileCheckItem
		want, absent []string
	}{
		{"owner", []FileCheckItem{{Path: "/media/owner", Kind: "owner"}}, []string{"chown 99:100 -- '/mnt/user/owner'"}, []string{"chmod "}},
		{"permissions", []FileCheckItem{{Path: "/media/file", Kind: "permissions"}, {Path: "/media/dir", Kind: "permissions", Dir: true}}, []string{"chmod 664 -- '/mnt/user/file'", "chmod 775 -- '/mnt/user/dir'"}, []string{"chown "}},
		{"both", []FileCheckItem{{Path: "/media/both", Kind: "owner"}, {Path: "/media/both", Kind: "permissions"}}, []string{"chown 99:100 -- '/mnt/user/both'", "chmod 664 -- '/mnt/user/both'"}, nil},
		{"manual", []FileCheckItem{{Path: "/media/link", Kind: "other"}, {Path: "/media/video.mkv", Kind: "untracked_media"}}, []string{"# review manually: '/mnt/user/link' (other)", "# review manually: '/mnt/user/video.mkv' (untracked_media)"}, []string{"rm ", "chown ", "chmod "}},
		{"deletion wins", []FileCheckItem{{Path: "/media/gone", Kind: "owner"}, {Path: "/media/gone", Kind: "permissions"}, {Path: "/media/gone", Kind: "junk"}}, []string{"rm -f -- '/mnt/user/gone'"}, []string{"chown ", "chmod "}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			text := fileCheckCommands(cfg, tc.items)
			for _, want := range tc.want {
				if !strings.Contains(text, want) {
					t.Errorf("missing %q in %s", want, text)
				}
			}
			for _, absent := range tc.absent {
				if strings.Contains(text, absent) {
					t.Errorf("unsafe %q in %s", absent, text)
				}
			}
		})
	}
}

// A review-only classification must not hide independently selected metadata
// repairs for the same regular file. Only explicit deletion findings win.
func TestFileCheckCommandsMixedManualKinds162(t *testing.T) {
	cfg := DefaultSettings()
	cfg.Unraid.Enabled = true
	cfg.FileCheck.FileMode = "0664"
	for _, tc := range []struct {
		name         string
		kinds        []string
		want, absent []string
	}{
		{"other with owner", []string{"owner", "other"}, []string{"chown 99:100 -- '/mnt/user/mixed'", "# review manually: '/mnt/user/mixed' (other)"}, []string{"chmod ", "rm "}},
		{"untracked with permissions", []string{"permissions", "untracked_media"}, []string{"chmod 664 -- '/mnt/user/mixed'", "# review manually: '/mnt/user/mixed' (untracked_media)"}, []string{"chown ", "rm "}},
		{"other with both", []string{"owner", "permissions", "other"}, []string{"chown 99:100 -- '/mnt/user/mixed'", "chmod 664 -- '/mnt/user/mixed'", "# review manually: '/mnt/user/mixed' (other)"}, []string{"rm "}},
		{"untracked with both", []string{"owner", "permissions", "untracked_media"}, []string{"chown 99:100 -- '/mnt/user/mixed'", "chmod 664 -- '/mnt/user/mixed'", "# review manually: '/mnt/user/mixed' (untracked_media)"}, []string{"rm "}},
		{"explicit deletion still wins", []string{"owner", "permissions", "other", "junk"}, []string{"rm -f -- '/mnt/user/mixed'"}, []string{"chown ", "chmod "}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			items := []FileCheckItem{}
			for _, kind := range tc.kinds {
				items = append(items, FileCheckItem{Path: "/media/mixed", Kind: kind})
			}
			text := fileCheckCommands(cfg, items)
			for _, want := range tc.want {
				if !strings.Contains(text, want) {
					t.Errorf("missing %q in %s", want, text)
				}
			}
			for _, absent := range tc.absent {
				if strings.Contains(text, absent) {
					t.Errorf("unexpected %q in %s", absent, text)
				}
			}
		})
	}
}

func TestFileCheckCommandsGroupingAndSafety162(t *testing.T) {
	cfg := DefaultSettings()
	cfg.Unraid.Enabled, cfg.Unraid.ShareRoot = true, "/custom/media"
	items := []FileCheckItem{}
	for n := range 205 {
		items = append(items, FileCheckItem{Path: fmt.Sprintf("/custom/media/file%03d", n), Kind: "owner"})
	}
	items = append(items, FileCheckItem{Path: "/custom/media/It's $(touch bad)", Kind: "owner"}, FileCheckItem{Path: "/custom/media/bad\nname", Kind: "owner"})
	text := fileCheckCommands(cfg, items)
	var counts []int
	for _, line := range strings.Split(text, "\n") {
		if strings.HasPrefix(line, "chown ") {
			counts = append(counts, strings.Count(line, "'/mnt/user/"))
		}
	}
	if !reflect.DeepEqual(counts, []int{100, 100, 6}) {
		t.Fatalf("unbounded or ungrouped commands: %v", counts)
	}
	for _, want := range []string{"set -u", "# skipped: unsupported characters", "'/mnt/user/It'\\''s $(touch bad)'"} {
		if !strings.Contains(text, want) {
			t.Errorf("missing %q", want)
		}
	}
	if strings.Contains(text, "bad\nname") || strings.Contains(text, "'/custom/media/") {
		t.Fatal("unsafe or unmapped path in script")
	}
	parent, child := "/custom/media/parent", "/custom/media/parent/child"
	text = fileCheckCommands(cfg, []FileCheckItem{{Path: parent, Kind: "empty_dir", Dir: true}, {Path: child, Kind: "empty_dir", Dir: true}, {Path: child + "/junk", Kind: "junk"}})
	fileAt, childAt, parentAt := strings.Index(text, "rm -f --"), strings.Index(text, "'/mnt/user/parent/child'"), strings.Index(text, "'/mnt/user/parent'")
	if fileAt < 0 || childAt <= fileAt || parentAt <= childAt {
		t.Fatalf("parent removed before contents: %s", text)
	}
}

func TestFileCheckCommands10000Performance162(t *testing.T) {
	items := make([]FileCheckItem, 10000)
	for n := range items {
		items[n] = FileCheckItem{Path: fmt.Sprintf("/media/file%05d", n), Kind: "owner"}
	}
	start := time.Now()
	text := fileCheckCommands(DefaultSettings(), items)
	elapsed := time.Since(start)
	t.Logf("10000 findings generated in %s", elapsed)
	if elapsed >= 2*time.Second {
		t.Fatalf("10000 findings took %s", elapsed)
	}
	if strings.Count(text, "\nchown ") != 100 {
		t.Fatal("10000 paths were not grouped into 100 commands")
	}
}

func insertFileCheck162(t *testing.T, s *Server, item FileCheckItem) int64 {
	t.Helper()
	result, err := s.Store.DB.Exec("INSERT INTO filecheck_items("+strings.TrimPrefix(fileCheckColumns, "id,")+") VALUES(?"+strings.Repeat(",?", 21)+")", fileCheckArgs(&item)...)
	if err != nil {
		t.Fatal(err)
	}
	id, _ := result.LastInsertId()
	return id
}

func TestFileCheckCommandsFilteredHTTP162(t *testing.T) {
	s, cfg := placementFixture130(t)
	root := filepath.Join(cfg.Unraid.ShareRoot, "movies")
	s.FileCheck.scan.Roots = []ScanRoot{{muxRootFolder: muxRootFolder{LocalPath: root}, Share: "movies"}}
	ids := []int64{}
	for _, status := range []string{"", "failed", "needs_review", "cancelled", "queued", "running", "succeeded"} {
		ids = append(ids, insertFileCheck162(t, s, FileCheckItem{Path: filepath.Join(root, "pick-"+status), Root: root, Rel: "pick-" + status, Title: "Pick", Kind: "owner", Fix: "manual", JobStatus: status}))
	}
	insertFileCheck162(t, s, FileCheckItem{Path: filepath.Join(root, "unrelated"), Root: root, Rel: "unrelated", Title: "Else", Kind: "owner", Fix: "manual"})
	insertFileCheck162(t, s, FileCheckItem{Path: "/other/pick", Root: "/other", Rel: "pick", Title: "Pick", Kind: "owner", Fix: "manual"})
	for _, body := range []any{map[string]any{"all": true, "query": "share=movies&kind=owner&q=Pick"}, map[string]any{"ids": ids}} {
		raw, _ := json.Marshal(body)
		w := httptest.NewRecorder()
		s.fileCheckCommandsHTTP(w, httptest.NewRequest("POST", "/api/filecheck/commands", bytes.NewReader(raw)))
		var result struct {
			Text      string
			Count     int
			HostPaths bool
		}
		if w.Code != 200 {
			t.Fatalf("%d %s", w.Code, w.Body.String())
		}
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if result.Count != 4 || !result.HostPaths {
			t.Fatalf("incorrect eligible export: %+v", result)
		}
		for _, excluded := range []string{"pick-queued", "pick-running", "pick-succeeded", "unrelated", "/other/pick"} {
			if strings.Contains(result.Text, excluded) {
				t.Errorf("exported %s", excluded)
			}
		}
	}
	for _, body := range []string{`{"all":true,"query":"share=unknown"}`, `{"all":true,"query":"kind=invalid"}`, `{"all":true,"query":"q=%zz"}`, `{"ids":[]}`} {
		w := httptest.NewRecorder()
		s.fileCheckCommandsHTTP(w, httptest.NewRequest("POST", "/api/filecheck/commands", strings.NewReader(body)))
		if w.Code != 400 {
			t.Fatalf("accepted %s: %d", body, w.Code)
		}
	}
}

func TestFileCheckCommandsAllLimit162(t *testing.T) {
	s, _ := placementFixture130(t)
	// One SQL statement keeps the fixture inexpensive while exercising the real
	// database-backed boundary, including its inclusive 50,000-finding limit.
	_, err := s.Store.DB.Exec(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<50001)
	INSERT INTO filecheck_items(service,instance,media_id,title,root,rel,path,is_dir,kind,fix,size,mode,uid,gid,mtime,updated_at)
	SELECT 'radarr','Movies',1,'Film','/media',printf('file%05d',x),printf('/media/file%05d',x),0,'owner','manual',0,0,0,0,0,'' FROM n`)
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	s.fileCheckCommandsHTTP(w, httptest.NewRequest("POST", "/api/filecheck/commands", strings.NewReader(`{"all":true}`)))
	if w.Code != 400 {
		t.Fatalf("export silently exceeded 50000 findings: %d", w.Code)
	}
	if _, err = s.Store.DB.Exec("DELETE FROM filecheck_items WHERE id=50001"); err != nil {
		t.Fatal(err)
	}
	w = httptest.NewRecorder()
	s.fileCheckCommandsHTTP(w, httptest.NewRequest("POST", "/api/filecheck/commands", strings.NewReader(`{"all":true}`)))
	if w.Code != 200 {
		t.Fatalf("50000 findings should export: %d %s", w.Code, w.Body.String())
	}
	var result struct {
		Count int
		Text  string
	}
	if err = json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Count != 50000 || strings.Count(result.Text, "\nchown ") != 500 {
		t.Fatal("missing findings in export", result.Count)
	}
}

func TestPlacementScanPreservesChecksumSetting162(t *testing.T) {
	for _, saved := range []bool{false, true} {
		t.Run(fmt.Sprint(saved), func(t *testing.T) {
			s, cfg := placementFixture130(t)
			cfg.Unraid.VerifyChecksum = saved
			cfg.Instances[0].Enabled = false
			setTestSettings(s, cfg)
			// A 1.6.1 settings payload survives a real PUT/GET/store roundtrip.
			raw, _ := json.Marshal(cfg)
			w := httptest.NewRecorder()
			s.settingsHTTP(w, httptest.NewRequest("PUT", "/api/settings", bytes.NewReader(raw)))
			if w.Code != 200 {
				t.Fatal(w.Code, w.Body.String())
			}
			var persisted Settings
			if err := s.Store.Get("settings", &persisted); err != nil || persisted.Unraid.VerifyChecksum != saved {
				t.Fatal("settings checksum lost", err)
			}
			body := fmt.Sprintf(`{"libraries":[],"seriesGrouping":"series","excludedDisks":[],"reserveGB":0,"verifyChecksum":%t}`, !saved)
			w = httptest.NewRecorder()
			s.placementStartScan(w, httptest.NewRequest("POST", "/api/placement/scan", strings.NewReader(body)))
			if w.Code != 202 {
				t.Fatal(w.Code, w.Body.String())
			}
			s.Placement.mu.Lock()
			s.Placement.scanCancel()
			s.Placement.mu.Unlock()
			s.Placement.wg.Wait()
			if s.Config().Unraid.VerifyChecksum != saved {
				t.Fatal("legacy scan payload changed saved checksum preference")
			}
			if err := s.Store.Get("settings", &persisted); err != nil || persisted.Unraid.VerifyChecksum != saved {
				t.Fatal("scan persisted wrong checksum", err)
			}
			get := httptest.NewRecorder()
			s.settingsHTTP(get, httptest.NewRequest("GET", "/api/settings", nil))
			var returned Settings
			if err := json.Unmarshal(get.Body.Bytes(), &returned); err != nil || returned.Unraid.VerifyChecksum != saved {
				t.Fatal("GET checksum mismatch", err)
			}
		})
	}
}

func TestSettingsFileCheckNames162(t *testing.T) {
	s, cfg := placementFixture130(t)
	cfg.Instances[0].Enabled = false
	setTestSettings(s, cfg)
	cfg.FileCheck.Allowed = []string{"custom.*", "Extras/"}
	cfg.FileCheck.Ignore = []string{"*.tmp"}
	raw, _ := json.Marshal(cfg)
	w := httptest.NewRecorder()
	s.settingsHTTP(w, httptest.NewRequest("PUT", "/api/settings", bytes.NewReader(raw)))
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var stored Settings
	if err := s.Store.Get("settings", &stored); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(stored.FileCheck.Allowed, cfg.FileCheck.Allowed) || !reflect.DeepEqual(stored.FileCheck.Ignore, cfg.FileCheck.Ignore) {
		t.Fatal("name lists not saved", stored.FileCheck)
	}
	for _, field := range []string{"allowed", "ignore"} {
		for _, pattern := range []string{"[broken", "bad\nname", ""} {
			next := s.Config()
			if field == "allowed" {
				next.FileCheck.Allowed = []string{pattern}
			} else {
				next.FileCheck.Ignore = []string{pattern}
			}
			raw, _ = json.Marshal(next)
			w = httptest.NewRecorder()
			s.settingsHTTP(w, httptest.NewRequest("PUT", "/api/settings", bytes.NewReader(raw)))
			actual := s.Config().FileCheck
			if w.Code != 400 || !reflect.DeepEqual(actual.Ignore, []string{"*.tmp"}) || !reflect.DeepEqual(actual.Allowed, []string{"custom.*", "Extras/"}) {
				t.Fatal("invalid pattern accepted or saved", field, pattern, w.Code)
			}
		}
	}
}

func TestCompletedScanReportsRemainAvailable162(t *testing.T) {
	s, _ := placementFixture130(t)
	finished := "2026-10-20T10:01:20Z"
	started := "2026-10-20T10:00:00Z"
	fileReport := FileCheckScan{StartedAt: started, FinishedAt: finished, Checked: 42, Kinds: map[string]int{"owner": 5}}
	raw, _ := json.Marshal(fileReport)
	if _, err := s.Store.DB.Exec("INSERT INTO filecheck_scan(id,data)VALUES(1,?)", string(raw)); err != nil {
		t.Fatal(err)
	}
	placementReport := s.Placement.scan
	placementReport.StartedAt, placementReport.FinishedAt = started, finished
	raw, _ = json.Marshal(placementReport)
	if _, err := s.Store.DB.Exec("UPDATE placement_scan SET data=? WHERE id=1", string(raw)); err != nil {
		t.Fatal(err)
	}
	s.FileCheck.scan = FileCheckScan{Running: true, StartedAt: "2026-10-26T10:00:00Z"}
	s.Placement.scan.Running = true
	s.Placement.scan.StartedAt = "2026-10-26T10:00:00Z"
	responses := []map[string]any{s.fileCheckActivity()}
	w := httptest.NewRecorder()
	s.placementHTTP(w, httptest.NewRequest("GET", "/api/placement/scan", nil))
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var placement map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &placement); err != nil {
		t.Fatal(err)
	}
	responses = append(responses, placement)
	for _, response := range responses {
		raw, _ := json.Marshal(response["report"])
		var report struct{ StartedAt, FinishedAt string }
		if err := json.Unmarshal(raw, &report); err != nil || report.StartedAt != started || report.FinishedAt != finished {
			t.Fatalf("completed report overwritten: %s %v", raw, err)
		}
	}
}

// Deliberately corrupt the copied bytes, preserving size and metadata, so only
// the configured checksum distinguishes a safe copy from an unsafe one.
func TestPlacementMoverUsesSavedChecksum162(t *testing.T) {
	s, cfg := placementFixture130(t)
	cfg.Unraid.VerifyChecksum = true
	setTestSettings(s, cfg)
	placementWrite130(t, cfg, "disk3", "Film.nfo", "info")
	placementWrite130(t, cfg, "disk6", "Film.mkv", strings.Repeat("v", 100))
	item := placementPlan130(t, s, cfg)
	copier := s.Placement.testCopy
	s.Placement.testCopy = func(ctx context.Context, src, dst *os.File, progress func(int64)) error {
		if err := copier(ctx, src, dst, progress); err != nil {
			return err
		}
		_, err := dst.WriteAt([]byte("xxxx"), 0)
		return err
	}
	if err := s.Placement.executeMove(context.Background(), s.Config(), &item); err == nil || !strings.Contains(err.Error(), "checksum") {
		t.Fatalf("mover ignored configured checksum: %v", err)
	}
}
