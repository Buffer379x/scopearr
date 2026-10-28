package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

type renameFixture struct {
	s                                    *Server
	dir, service, basename, upstreamPath string
	size                                 int64
	episodes                             []Episode
	parsed                               []map[string]int
	parsedSeries                         int
	state                                string
	commands                             atomic.Int32
	parseCalls                           atomic.Int32
	commandBody                          map[string]any
	block, entered                       chan struct{}
}

func newRenameFixture(t *testing.T, service string) *renameFixture {
	t.Helper()
	s, _ := muxServer120(t)
	x := &renameFixture{s: s, dir: muxTempDir120(t), service: service, basename: "Old.mkv", size: 8, parsedSeries: 10, state: "completed"}
	x.upstreamPath = "/arr/" + x.basename
	x.episodes = []Episode{{ID: 11, Number: 1}, {ID: 12, Number: 2}}
	x.parsed = []map[string]int{{"id": 12}, {"id": 11}}
	if e := os.WriteFile(filepath.Join(x.dir, x.basename), []byte("original"), 0600); e != nil {
		t.Fatal(e)
	}
	arr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v3/moviefile/1", "/api/v3/episodefile/1":
			jsonOut(w, 200, map[string]any{"path": x.upstreamPath, "size": x.size})
		case "/api/v3/parse":
			x.parseCalls.Add(1)
			if r.URL.Query().Get("title") == "" {
				t.Error("missing parse title")
			}
			jsonOut(w, 200, map[string]any{"series": map[string]int{"id": x.parsedSeries}, "episodes": x.parsed})
		case "/api/v3/command":
			if r.Method != "POST" {
				t.Error("unexpected command method", r.Method)
			}
			json.NewDecoder(r.Body).Decode(&x.commandBody)
			x.commands.Add(1)
			if x.block != nil {
				close(x.entered)
				<-x.block
			}
			jsonOut(w, 200, map[string]int{"id": 3})
		case "/api/v3/movie/10":
			jsonOut(w, 200, map[string]any{"id": 10, "title": "Movie", "year": 2026})
		case "/api/v3/moviefile":
			jsonOut(w, 200, []map[string]any{{"id": 2, "movieId": 10, "path": "/arr/New.mkv", "size": 8}})
		case "/api/v3/command/3":
			jsonOut(w, 200, map[string]any{"id": 3, "status": x.state})
		default:
			t.Errorf("unexpected Arr request %s %s", r.Method, r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(arr.Close)
	s.mu.Lock()
	s.settings.Instances = []ServiceConfig{{ID: service, Type: service, Enabled: true, URL: arr.URL, APIKey: "arr-key"}}
	s.settings.Mux.Mappings = "/arr => " + x.dir
	s.settings.Mux.NotifyMedia = false
	s.mu.Unlock()
	s.Mux.tool.Installed = false // File operations require mappings, not mkvmerge installation.
	f := sample(1, x.basename)
	f.Service = service
	f.SourcePath = x.upstreamPath
	f.MediaID = 10
	f.Size = 8
	f.Episodes = x.episodes
	if e := s.Store.Replace(service, []File{f}, SyncStatus{}); e != nil {
		t.Fatal(e)
	}
	s.Mux.testRescanPoll = time.Millisecond
	// Successful refreshes include Arr requests, durable queueing and media notification.
	// Leave scheduler headroom under the race detector on hosted runners.
	s.Mux.testRescanTimeout = 2 * time.Second
	return x
}
func (x *renameFixture) request(t *testing.T, preview bool, in renameRequest) *httptest.ResponseRecorder {
	t.Helper()
	in.Service = x.service
	in.FileID = 1
	body, _ := json.Marshal(in)
	route := "/api/files/rename"
	if preview {
		route += "/preview"
	}
	r := httptest.NewRequest("POST", route, strings.NewReader(string(body)))
	w := httptest.NewRecorder()
	x.s.renameHTTP(w, r)
	if strings.Contains(w.Body.String(), x.dir) || strings.Contains(w.Body.String(), "/arr/") {
		t.Fatal("path leaked", w.Body.String())
	}
	return w
}
func (x *renameFixture) contents(t *testing.T, name string, want string) {
	t.Helper()
	got, e := os.ReadFile(filepath.Join(x.dir, name))
	if want == "" {
		if !os.IsNotExist(e) {
			t.Fatalf("%s should not exist: %v", name, e)
		}
		return
	}
	if e != nil || string(got) != want {
		t.Fatalf("%s: %q %v", name, got, e)
	}
}
func TestFileRenameSuccess(t *testing.T) {
	for _, service := range []string{"radarr", "sonarr"} {
		t.Run(service, func(t *testing.T) {
			x := newRenameFixture(t, service)
			var updates struct {
				Updates []struct{ Path, UpdateType string }
			}
			media := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/emby/Library/Media/Updated" || r.Method != "POST" || r.Header.Get("X-Emby-Token") != "key" {
					t.Error("unexpected media notification")
				}
				json.NewDecoder(r.Body).Decode(&updates)
				w.WriteHeader(204)
			}))
			defer media.Close()
			x.s.mu.Lock()
			x.s.settings.Mux.NotifyMedia = true
			x.s.settings.Instances = append(x.s.settings.Instances, ServiceConfig{ID: "emby", Type: "emby", Enabled: true, URL: media.URL, APIKey: "key", SourceIDs: service, PathMappings: "/arr => /server"})
			x.s.mu.Unlock()
			w := x.request(t, false, renameRequest{Name: "New.S01E01-E02"})
			if w.Code != 200 || !strings.Contains(w.Body.String(), `"refresh":"completed"`) {
				t.Fatal(w.Code, w.Body.String())
			}
			x.contents(t, "New.S01E01-E02.mkv", "original")
			x.contents(t, "Old.mkv", "")
			name, key := "RescanMovie", "movieId"
			if service == "sonarr" {
				name, key = "RescanSeries", "seriesId"
				if x.parseCalls.Load() != 1 {
					t.Fatal("missing Sonarr parse")
				}
			} else if x.parseCalls.Load() != 0 {
				t.Fatal("Radarr parse called")
			}
			if x.commandBody["name"] != name || x.commandBody[key] != float64(10) {
				t.Fatal(x.commandBody)
			}
			var job WebhookJob
			if e := x.s.Store.Get(jobKey(WebhookJob{Service: service, MediaID: 10}), &job); e != nil || !job.InternalMux || !job.All {
				t.Fatal("missing internal delta", job, e)
			}
			if len(updates.Updates) != 2 || updates.Updates[0].UpdateType != "Deleted" || updates.Updates[0].Path != "/server/Old.mkv" || updates.Updates[1].Path != "/server/New.S01E01-E02.mkv" || updates.Updates[1].UpdateType != "Created" {
				t.Fatal(updates)
			}
		})
	}
}
func TestFileRenameRejected(t *testing.T) {
	for _, scenario := range []string{"collision", "path", "size", "job", "disabled", "instance", "demo", "parse-series", "parse-episode", "parse-multi", "unmapped", "source-symlink"} {
		t.Run(scenario, func(t *testing.T) {
			service := "radarr"
			if strings.HasPrefix(scenario, "parse") {
				service = "sonarr"
			}
			x := newRenameFixture(t, service)
			switch scenario {
			case "collision":
				os.WriteFile(filepath.Join(x.dir, "New.mkv"), []byte("keep"), 0600)
			case "path":
				x.upstreamPath = "/arr/Another.mkv"
			case "size":
				x.size = 99
			case "job":
				j := MuxJob{Service: service, FileID: 1, Status: "succeeded"}
				if e := x.s.Store.muxSave(&j); e != nil {
					t.Fatal(e)
				}
			case "disabled":
				x.s.settings.Mux.Enabled = false
			case "instance":
				x.s.settings.Instances[0].Enabled = false
			case "demo":
				x.s.Demo = true
			case "parse-series":
				x.parsedSeries = 99
			case "parse-episode":
				x.parsed = []map[string]int{{"id": 99}}
			case "parse-multi":
				x.parsed = x.parsed[:1]
			case "unmapped":
				x.s.settings.Mux.Mappings = "/other => " + x.dir
			case "source-symlink":
				os.Rename(filepath.Join(x.dir, "Old.mkv"), filepath.Join(x.dir, "original.mkv"))
				os.Symlink("original.mkv", filepath.Join(x.dir, "Old.mkv"))
			}
			w := x.request(t, false, renameRequest{Name: "New"})
			if w.Code < 400 {
				t.Fatal(w.Code, w.Body.String())
			}
			if x.commands.Load() != 0 {
				t.Fatal("rescan before valid rename")
			}
			x.contents(t, "Old.mkv", "original")
			if scenario == "collision" {
				x.contents(t, "New.mkv", "keep")
			} else {
				x.contents(t, "New.mkv", "")
			}
		})
	}
	for _, name := range []string{"../x", ".x", "a/b", "a\\b", "a\n", strings.Repeat("a", 201), strings.Repeat("ä", 101), "", "Old", "x.partial", "x.scopearr-backup-1"} {
		t.Run(fmt.Sprintf("name-%q", name), func(t *testing.T) {
			x := newRenameFixture(t, "radarr")
			w := x.request(t, false, renameRequest{Name: name})
			if w.Code != 400 {
				t.Fatal(w.Code, w.Body.String())
			}
			x.contents(t, "Old.mkv", "original")
			if x.commands.Load() != 0 {
				t.Fatal("unexpected rescan")
			}
		})
	}
}
func TestFileRenameCaseAndNoExtension(t *testing.T) {
	for _, name := range []string{"old", "New.mkv"} {
		t.Run(name, func(t *testing.T) {
			x := newRenameFixture(t, "radarr")
			w := x.request(t, false, renameRequest{Name: name})
			if w.Code != 200 {
				t.Fatal(w.Body.String())
			}
			x.contents(t, name+".mkv", "original")
		})
	}
	t.Run("no-extension", func(t *testing.T) {
		x := newRenameFixture(t, "radarr")
		os.Rename(filepath.Join(x.dir, "Old.mkv"), filepath.Join(x.dir, "Old"))
		x.upstreamPath = "/arr/Old"
		f, _ := x.s.Store.muxFile("radarr", 1)
		f.SourcePath = x.upstreamPath
		f.Filename = "Old"
		x.s.Store.Replace("radarr", []File{f}, SyncStatus{})
		w := x.request(t, false, renameRequest{Name: "New"})
		if w.Code != 200 {
			t.Fatal(w.Body.String())
		}
		x.contents(t, "New", "original")
	})
}
func TestFileRenameRefreshPendingAndFailure(t *testing.T) {
	for _, state := range []string{"started", "failed"} {
		t.Run(state, func(t *testing.T) {
			x := newRenameFixture(t, "radarr")
			x.state = state
			if state == "started" {
				x.s.Mux.testRescanTimeout = 250 * time.Millisecond
			}
			w := x.request(t, false, renameRequest{Name: "New"})
			refresh := "failed"
			if state == "started" {
				refresh = "pending"
			}
			if w.Code != 200 || !strings.Contains(w.Body.String(), `"refresh":"`+refresh+`"`) || !strings.Contains(w.Body.String(), `"renamed":true`) {
				t.Fatal(w.Code, w.Body.String())
			}
			x.contents(t, "New.mkv", "original")
			if x.s.Webhooks.Statuses()["radarr"].Pending != 1 {
				t.Fatal("missing delayed cache refresh")
			}
		})
	}
}
func TestFileRenameSerializedAndDetached(t *testing.T) {
	x := newRenameFixture(t, "radarr")
	x.block = make(chan struct{})
	x.entered = make(chan struct{})
	defer func() {
		select {
		case <-x.block:
		default:
			close(x.block)
		}
	}()
	body := `{"service":"radarr","fileId":1,"name":"New"}`
	r := httptest.NewRequest("POST", "/api/files/rename", strings.NewReader(body))
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	r = r.WithContext(ctx)
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() { w := httptest.NewRecorder(); x.s.renameHTTP(w, r); done <- w }()
	select {
	case <-x.entered:
	case <-time.After(2 * time.Second):
		t.Fatal("rename never reached rescan")
	}
	cancel()
	w := x.request(t, false, renameRequest{Name: "Other"})
	if w.Code != 409 || !strings.Contains(w.Body.String(), "Another rename") {
		t.Fatal(w.Code, w.Body.String())
	}
	close(x.block)
	select {
	case w := <-done:
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"refresh":"completed"`) {
			t.Fatal(w.Code, w.Body.String())
		}
	case <-time.After(2 * time.Second):
		t.Fatal("detached refresh did not finish")
	}
}
func TestFindCompanions(t *testing.T) {
	dir := t.TempDir()
	stem := "Show.S01E01"
	want := []string{".srt", ".de.srt", ".de.forced.srt", ".ger.sub", ".idx", ".nfo", "-poster.jpg", "-thumb.jpg", "-fanart.jpg"}
	for _, suffix := range want {
		os.WriteFile(filepath.Join(dir, stem+suffix), []byte("extra"), 0600)
	}
	for _, name := range []string{stem + ".mkv", stem + ".MP4", stem + ".partial", stem + ".scopearr-backup-1", "." + stem + ".srt", "Show.S01E10.srt", "show.S01E01.srt", ".scopearr-write-test-1"} {
		os.WriteFile(filepath.Join(dir, name), []byte("ignore"), 0600)
	}
	os.Mkdir(filepath.Join(dir, stem+".subs"), 0700)
	os.WriteFile(filepath.Join(dir, stem+".subs", stem+".srt"), []byte("ignore"), 0600)
	os.Symlink(stem+".srt", filepath.Join(dir, stem+".en.srt"))
	os.WriteFile(filepath.Join(dir, "New.srt"), []byte("keep"), 0600)
	got, e := findCompanions(dir, stem, "New")
	if e != nil || len(got) != len(want) {
		t.Fatal(got, e)
	}
	for _, v := range got {
		if v.To != "New"+strings.TrimPrefix(v.From, stem) {
			t.Fatal(v)
		}
		if v.Conflict != (v.To == "New.srt") {
			t.Fatal(v)
		}
	}
	if _, e := findCompanions(dir, stem, strings.Repeat("x", 250)); e == nil {
		t.Fatal("long companion target accepted")
	}
	for ext := range videoExtensions {
		os.WriteFile(filepath.Join(dir, stem+".version"+ext), nil, 0600)
	}
	for i := 0; i < 41; i++ {
		os.WriteFile(filepath.Join(dir, fmt.Sprintf("%s.%d.srt", stem, i)), nil, 0600)
	}
	if got, e := findCompanions(dir, stem, "New"); e != nil || len(got) != 50 {
		t.Fatal("50 companion boundary", len(got), e)
	}
	os.WriteFile(filepath.Join(dir, stem+".51.srt"), nil, 0600)
	if _, e := findCompanions(dir, stem, "New"); e == nil {
		t.Fatal("more than 50 accepted")
	}
}
func TestFileRenameCompanions(t *testing.T) {
	for _, scenario := range []string{"preview", "all", "media", "changed", "conflict", "rollback", "rollback-failed"} {
		t.Run(scenario, func(t *testing.T) {
			x := newRenameFixture(t, "radarr")
			for _, n := range []string{"Old.de.srt", "Old.nfo"} {
				os.WriteFile(filepath.Join(x.dir, n), []byte(n), 0600)
			}
			if scenario == "conflict" {
				os.WriteFile(filepath.Join(x.dir, "New.nfo"), []byte("keep"), 0600)
			}
			in := renameRequest{Name: "New", Companions: true, CompanionNames: []string{"Old.nfo", "Old.de.srt"}}
			if scenario == "media" {
				in.Companions = false
			}
			if scenario == "changed" {
				in.CompanionNames = in.CompanionNames[:1]
			}
			if strings.HasPrefix(scenario, "rollback") {
				fs := defaultRenameFS()
				fs.link = func(src, dst string) error {
					if filepath.Base(src) == "Old.nfo" || scenario == "rollback-failed" && filepath.Base(src) == "New.de.srt" {
						return syscall.EIO
					}
					return os.Link(src, dst)
				}
				x.s.testRenameFS = &fs
			}
			w := x.request(t, scenario == "preview", in)
			switch scenario {
			case "preview":
				if w.Code != 200 || !strings.Contains(w.Body.String(), `"from":"Old.de.srt"`) {
					t.Fatal(w.Code, w.Body.String())
				}
				x.contents(t, "Old.mkv", "original")
				x.contents(t, "New.mkv", "")
				x.contents(t, "Old.de.srt", "Old.de.srt")
			case "changed", "conflict", "rollback", "rollback-failed":
				want := 409
				if scenario == "rollback" {
					want = 400
				}
				if scenario == "rollback-failed" {
					want = 500
				}
				if w.Code != want {
					t.Fatal(w.Code, w.Body.String())
				}
				x.contents(t, "Old.mkv", "original")
				if scenario != "rollback-failed" {
					x.contents(t, "Old.de.srt", "Old.de.srt")
				}
				if scenario == "conflict" {
					x.contents(t, "New.nfo", "keep")
				}
			default:
				if w.Code != 200 {
					t.Fatal(w.Code, w.Body.String())
				}
				x.contents(t, "New.mkv", "original")
				if in.Companions {
					x.contents(t, "New.de.srt", "Old.de.srt")
					x.contents(t, "New.nfo", "Old.nfo")
					x.contents(t, "Old.nfo", "")
				} else {
					x.contents(t, "Old.nfo", "Old.nfo")
					x.contents(t, "New.nfo", "")
				}
			}
			if scenario != "all" && scenario != "media" && x.commands.Load() != 0 {
				t.Fatal("rescan after failed/preview rename")
			}
		})
	}
}
func TestRenameNoReplaceFallbacks(t *testing.T) {
	for _, scenario := range []string{"link", "renameat2", "legacy", "remove-failed", "cleanup-failed", "collision-race"} {
		t.Run(scenario, func(t *testing.T) {
			dir := t.TempDir()
			src, dst := filepath.Join(dir, "Old"), filepath.Join(dir, "New")
			os.WriteFile(src, []byte("original"), 0600)
			fs := defaultRenameFS()
			if scenario == "link" {
				if e := defaultRenameFS().moveOnDevice(src, dst, false); e != nil {
					t.Fatal(e)
				}
				return
			}
			fs.link = func(string, string) error { return syscall.EXDEV }
			called := false
			fs.noReplace = func(a, b string) error {
				called = true
				if scenario == "legacy" {
					return syscall.ENOSYS
				}
				if scenario == "collision-race" {
					os.WriteFile(b, []byte("keep"), 0600)
					return syscall.EINVAL
				}
				return os.Rename(a, b)
			}
			if strings.Contains(scenario, "failed") {
				fs.link = os.Link
				fs.remove = func(p string) error {
					if p == src || scenario == "cleanup-failed" {
						return syscall.EACCES
					}
					return os.Remove(p)
				}
			}
			e := fs.moveOnDevice(src, dst, false)
			if strings.Contains(scenario, "failed") || scenario == "collision-race" {
				if e == nil {
					t.Fatal("failure ignored")
				}
				b, _ := os.ReadFile(src)
				if string(b) != "original" {
					t.Fatal("original lost")
				}
				if scenario == "remove-failed" {
					if _, e := os.Stat(dst); !os.IsNotExist(e) {
						t.Fatal("link not rolled back")
					}
				}
				if scenario == "cleanup-failed" {
					var incomplete *renameIncomplete
					if !errors.As(e, &incomplete) {
						t.Fatal(e)
					}
				}
				if scenario == "collision-race" {
					b, _ := os.ReadFile(dst)
					if string(b) != "keep" {
						t.Fatal("collision overwritten")
					}
				}
				return
			}
			if e != nil || !called {
				t.Fatal(e, called)
			}
			if _, e := os.Stat(src); !os.IsNotExist(e) {
				t.Fatal("source retained")
			}
		})
	}
}

func TestFileRenamePendingRefreshWaitsForArr(t *testing.T) {
	x := newRenameFixture(t, "radarr")
	x.state = "started"
	x.s.Mux.testRescanTimeout = 250 * time.Millisecond
	w := x.request(t, false, renameRequest{Name: "New"})
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var job WebhookJob
	key := jobKey(WebhookJob{Service: "radarr", MediaID: 10})
	x.s.Store.Get(key, &job)
	if job.WaitCommandID != 3 {
		t.Fatal("rescan identity not persisted", job)
	}
	// A concurrent ordinary webhook must retain the outstanding Arr command.
	if e := x.s.Webhooks.Enqueue(WebhookJob{Service: "radarr", MediaID: 10, All: true, Source: job.Source}); e != nil {
		t.Fatal(e)
	}
	x.s.Store.Get(key, &job)
	if job.WaitCommandID != 3 || !job.InternalMux {
		t.Fatal(job)
	}
	job.Next = time.Time{}
	x.s.Store.Put(key, job)
	x.s.Webhooks.processOne(context.Background())
	if e := x.s.Store.Get(key, &job); e != nil || job.Attempts != 1 || !job.Next.After(time.Now()) {
		t.Fatal("pending delta consumed early", job, e)
	}
	x.contents(t, "New.mkv", "original")
	f, e := x.s.Store.muxFile("radarr", 1)
	if e != nil || f.Filename != "Old.mkv" {
		t.Fatal("cache read before Arr completed", f, e)
	}
	x.state = "completed"
	job.Next = time.Time{}
	x.s.Store.Put(key, job)
	x.s.Webhooks.processOne(context.Background())
	if e := x.s.Store.Get(key, &job); e == nil {
		t.Fatal("finished delta not removed", job)
	}
	f, e = x.s.Store.muxFile("radarr", 2)
	if e != nil || f.Filename != "New.mkv" {
		t.Fatal("completed Arr rescan not reflected in cache", f, e)
	}
}
func TestFileRenameRouteGuardsAndMuxInterlock(t *testing.T) {
	x := newRenameFixture(t, "radarr")
	x.s.Store.DB.Exec("INSERT INTO sessions(token,csrf,expires) VALUES(?,?,?)", tokenHash("rename-session"), "rename-csrf", time.Now().Add(time.Hour).Unix())
	for _, route := range []string{"/api/files/rename", "/api/files/rename/preview"} {
		for _, scenario := range []string{"anonymous", "csrf", "origin", "valid", "method"} {
			method := "POST"
			if scenario == "method" {
				method = "GET"
			}
			r := httptest.NewRequest(method, route, strings.NewReader(`{"service":"radarr","fileId":1,"name":"New"}`))
			if scenario != "anonymous" {
				r.AddCookie(&http.Cookie{Name: "scopearr_session", Value: "rename-session"})
			}
			if scenario != "csrf" {
				r.Header.Set("X-CSRF-Token", "rename-csrf")
			}
			if scenario == "origin" {
				r.Header.Set("Origin", "https://evil.invalid")
			}
			w := httptest.NewRecorder()
			if scenario == "valid" {
				x.s.renameMu.Lock()
			}
			x.s.Handler().ServeHTTP(w, r)
			if scenario == "valid" {
				x.s.renameMu.Unlock()
			}
			want := 403
			switch scenario {
			case "anonymous":
				want = 401
			case "valid":
				want = 409
			case "method":
				want = 405
			}
			if w.Code != want {
				t.Fatal(route, scenario, w.Code, w.Body.String())
			}
		}
	}
	x.s.renameMu.Lock()
	w := httptest.NewRecorder()
	x.s.muxHTTP(w, httptest.NewRequest("POST", "/api/mux/jobs", strings.NewReader(`{"service":"radarr","fileId":1}`)))
	x.s.renameMu.Unlock()
	if w.Code != 409 || !strings.Contains(w.Body.String(), "Another rename is in progress") {
		t.Fatal("mux job created during rename", w.Code, w.Body.String())
	}
	x.contents(t, "Old.mkv", "original")
}
