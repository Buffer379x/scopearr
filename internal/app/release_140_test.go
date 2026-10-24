package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSlidingSessions140(t *testing.T) {
	store := testStore(t)
	sec, e := NewSecurity(store)
	if e != nil {
		t.Fatal(e)
	}
	if e = sec.Setup("tester", "synthetic-session-password", sec.setupToken); e != nil {
		t.Fatal(e)
	}
	login := httptest.NewRecorder()
	r := httptest.NewRequest("POST", "/api/login", nil)
	if e = sec.CreateSession(login, r); e != nil {
		t.Fatal(e)
	}
	c := login.Result().Cookies()[0]
	if c.MaxAge != 7*86400 || c.SameSite != http.SameSiteLaxMode || !c.HttpOnly {
		t.Fatal(c)
	}
	req := httptest.NewRequest("GET", "/api/status", nil)
	req.AddCookie(c)
	now := time.Now().Unix()
	for _, tc := range []struct {
		name             string
		created, expires int64
		renew            bool
		max              int64
	}{
		{"recent", now, now + 7*86400 - 600, false, now + 7*86400 - 600},
		{"two hours", now - 7200, now + 7*86400 - 7200, true, now + 7*86400},
		{"absolute cap", now - 30*86400 + 7200, now + 1800, true, now + 7200},
		{"legacy", 0, now + 1800, true, now + 7*86400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, e := store.DB.Exec("UPDATE sessions SET created=?,expires=?", tc.created, tc.expires); e != nil {
				t.Fatal(e)
			}
			state, e := sec.readSession(req)
			if e != nil || !state.valid {
				t.Fatal(state, e)
			}
			w := httptest.NewRecorder()
			sec.renewSession(w, req, state)
			if (len(w.Result().Cookies()) > 0) != tc.renew {
				t.Fatal(w.Result().Cookies())
			}
			var expires int64
			if e := store.DB.QueryRow("SELECT expires FROM sessions").Scan(&expires); e != nil || expires < tc.max || expires > tc.max+2 {
				t.Fatal(expires, tc.max, e)
			}
		})
	}
	if _, e = store.DB.Exec("UPDATE sessions SET created=?,expires=?", now-31*86400, now+86400); e != nil {
		t.Fatal(e)
	}
	if state, e := sec.readSession(req); e != nil || state.valid {
		t.Fatal(state, e)
	}
	// A temporary write failure must never revoke a valid session.
	if _, e = store.DB.Exec("UPDATE sessions SET created=?,expires=?", now-7200, now+7*86400-7200); e != nil {
		t.Fatal(e)
	}
	state, _ := sec.readSession(req)
	if _, e = store.DB.Exec("CREATE TRIGGER deny_session_renew BEFORE UPDATE ON sessions BEGIN SELECT RAISE(ABORT,'synthetic busy'); END"); e != nil {
		t.Fatal(e)
	}
	w := httptest.NewRecorder()
	sec.renewSession(w, req, state)
	if _, _, valid, e := sec.Session(req); e != nil || !valid {
		t.Fatal(valid, e)
	}
	if e = store.DB.Close(); e != nil {
		t.Fatal(e)
	}
	server := &Server{Store: store, Security: sec}
	server.Handler().ServeHTTP(w, req)
	if w.Code != 503 || strings.Contains(w.Body.String(), "authenticated") {
		t.Fatal(w.Code, w.Body.String())
	}
}

func TestOpenJobCounts140(t *testing.T) {
	s, cfg := placementFixture130(t)
	base := MuxJob{Service: "radarr", FileID: 1, Title: "Fixture", SourceName: "fixture.mkv"}
	for n, status := range []string{"draft", "ready", "queued", "running", "succeeded", "failed", "cancelled", "needs_attention", "needs_review", "future_status"} {
		stamp := time.Now().UTC().Format(time.RFC3339Nano)
		if _, e := s.Store.DB.Exec("INSERT INTO mux_jobs(service,file_id,media_id,title,source_name,status,spec,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)", base.Service, n+1, n+1, base.Title, base.SourceName, status, `{}`, `{"tracks":[]}`, stamp, stamp); e != nil {
			t.Fatal(e)
		}
	}
	got := s.Mux.status()
	if got["pending"] != 3 || got["running"] != 1 || got["failed"] != 3 {
		t.Fatal(got)
	}
	root := filepath.Join(cfg.Unraid.ShareRoot, "movies", "Film")
	for n, status := range []string{"", "queued", "running", "failed", "succeeded", "cancelled", "needs_review"} {
		name := jsonNumber130(int64(n)) + ".txt"
		fileCheckWrite131(t, root, name, "x")
		row := fileCheckRow131(t, s, root, name, "junk", "delete")
		if _, e := s.Store.DB.Exec("UPDATE filecheck_items SET job_status=? WHERE id=?", status, row.ID); e != nil {
			t.Fatal(e)
		}
	}
	got = s.openFileJobs("filecheck_items")
	if got["pending"] != 1 || got["running"] != 1 || got["failed"] != 2 {
		t.Fatal(got)
	}
	placementWrite130(t, cfg, "disk3", "Film.nfo", "nfo")
	placementWrite130(t, cfg, "disk6", "Film.mkv", "video")
	row := placementPlan130(t, s, cfg)
	for _, status := range []string{"", "queued", "running", "failed", "succeeded", "cancelled", "needs_attention"} {
		if _, e := s.Store.DB.Exec("UPDATE placement_items SET job_status=? WHERE id=?", status, row.ID); e != nil {
			t.Fatal(e)
		}
		got = s.openFileJobs("placement_items")
		want := 0
		if status == "queued" || status == "running" || status == "failed" || status == "needs_attention" {
			want = 1
		}
		if got["pending"].(int)+got["running"].(int)+got["failed"].(int) != want {
			t.Fatal(status, got)
		}
	}
}

func TestRootCoverageAndMapping140(t *testing.T) {
	s, cfg := placementFixture130(t)
	media := filepath.Join(cfg.Unraid.ShareRoot, "documentaries")
	if e := os.MkdirAll(media, 0755); e != nil {
		t.Fatal(e)
	}
	oldRoot := muxMediaRoot
	muxMediaRoot = cfg.Unraid.ShareRoot
	t.Cleanup(func() { muxMediaRoot = oldRoot })
	arr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "rootfolder") {
			json.NewEncoder(w).Encode([]map[string]any{{"path": "/arr/movies"}, {"path": "/documentaries"}})
			return
		}
		json.NewEncoder(w).Encode([]map[string]any{{"id": 1, "title": "Film", "path": "/arr/movies/Film"}, {"id": 2, "title": "Documentary", "path": "/documentaries/Film"}})
	}))
	defer arr.Close()
	cfg.Instances[0].URL = arr.URL
	s.settings = cfg
	if e := s.Store.Put("settings", cfg); e != nil {
		t.Fatal(e)
	}
	placementWrite130(t, cfg, "disk3", "Film.nfo", "nfo")
	placementWrite130(t, cfg, "disk6", "Film.mkv", "video")
	for _, disk := range []string{"disk3", "disk6"} {
		p := filepath.Join(cfg.Unraid.DiskRoot, disk, "documentaries", "Film")
		if e := os.MkdirAll(p, 0755); e != nil {
			t.Fatal(e)
		}
		if e := os.WriteFile(filepath.Join(p, disk+".mkv"), []byte(disk), 0644); e != nil {
			t.Fatal(e)
		}
	}
	s.Placement.runScan(context.Background(), cfg)
	// Without a share directory under /mnt/user the root stays unresolved and is
	// reported, never guessed; the mapping suggestion remains available.
	roots := s.Placement.scanStatus().RootFolders
	if len(roots) != 2 {
		t.Fatal(roots)
	}
	for _, root := range roots {
		if root.ArrPath == "/documentaries" && (root.Status != "unresolved" || root.Items != 1) {
			t.Fatal(root)
		}
		if root.ArrPath == "/arr/movies" && (root.Status != "resolved" || root.ShareDir != "movies") {
			t.Fatal(root)
		}
	}
	apply := func(body string) int {
		w := httptest.NewRecorder()
		s.applyRootMappings(w, httptest.NewRequest("POST", "/api/unraid/mappings/apply", strings.NewReader(body)))
		return w.Code
	}
	if code := apply(`{"roots":["/invented"]}`); code != 400 {
		t.Fatal(code)
	}
	s.Mux.mu.Lock()
	s.Mux.active = 1
	s.Mux.mu.Unlock()
	if code := apply(`{"all":true}`); code != 409 {
		t.Fatal(code)
	}
	s.Mux.mu.Lock()
	s.Mux.active = 0
	s.Mux.mu.Unlock()
	s.Demo = true
	if code := apply(`{"all":true}`); code != 403 {
		t.Fatal(code)
	}
	s.Demo = false
	if code := apply(`{"roots":["/documentaries"]}`); code != 200 {
		t.Fatal(code)
	}
	cfg = s.Config()
	// On Unraid the share exists under /mnt/user; the fixture adds it only now so
	// the first scan above could report the unresolved root.
	if e := os.MkdirAll(filepath.Join(cfg.Unraid.DiskRoot, "user", "documentaries"), 0755); e != nil {
		t.Fatal(e)
	}
	s.Placement.runScan(context.Background(), cfg)
	w := httptest.NewRecorder()
	s.placementListHTTP(w, httptest.NewRequest("GET", "/api/placement/items?share=documentaries", nil))
	var list struct {
		Items []PlacementItem
		Total int
	}
	if e := json.Unmarshal(w.Body.Bytes(), &list); e != nil {
		t.Fatal(e)
	}
	if w.Code != 200 || list.Total != 1 || !strings.HasPrefix(list.Items[0].Rel, "documentaries/") {
		t.Fatal(w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	s.placementListHTTP(w, httptest.NewRequest("GET", "/api/placement/items?share=invented", nil))
	if w.Code != 400 {
		t.Fatal(w.Code)
	}
}
