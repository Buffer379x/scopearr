package app

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http/httptest"
	"os"
	"slices"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

func TestStaticRepresentations170(t *testing.T) {
	body := strings.Repeat("const value = 'compressed';\n", 100)
	s := &Server{Static: fstest.MapFS{"index.html": {Data: []byte(body)}, "assets/app-abc123.js": {Data: []byte(body)}, "icon.svg": {Data: []byte("<svg/>")}}}
	h := s.Handler()
	get := func(path, method, encoding, etag string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, nil)
		r.Header.Set("Accept-Encoding", encoding)
		r.Header.Set("If-None-Match", etag)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	raw := get("/assets/app-abc123.js", "GET", "", "")
	zipped := get("/assets/app-abc123.js", "GET", "gzip", "")
	if raw.Header().Get("Cache-Control") != "public, max-age=31536000, immutable" || raw.Header().Get("ETag") == "" {
		t.Fatal("asset cache missing", raw.Header())
	}
	if zipped.Header().Get("Content-Encoding") != "gzip" || zipped.Header().Get("ETag") == raw.Header().Get("ETag") || zipped.Header().Get("Vary") != "Accept-Encoding" {
		t.Fatal("gzip representation missing", zipped.Header())
	}
	z, e := gzip.NewReader(zipped.Body)
	if e != nil {
		t.Fatal(e)
	}
	unpacked, _ := io.ReadAll(z)
	z.Close()
	if string(unpacked) != body {
		t.Fatal("gzip changes contents")
	}
	for _, encoding := range []string{"gzip;q=0", "br, gzip;q=0", "*;q=0", "gzip;q=invalid", "gzip;q=0, *;q=1"} {
		if w := get("/assets/app-abc123.js", "GET", encoding, ""); w.Header().Get("Content-Encoding") != "" {
			t.Fatal("unaccepted gzip", encoding)
		}
	}
	if w := get("/assets/app-abc123.js", "GET", "gzip", zipped.Header().Get("ETag")); w.Code != 304 || w.Body.Len() != 0 {
		t.Fatal("gzip revalidation", w.Code)
	}
	if w := get("/assets/app-abc123.js", "GET", "", "\"unrelated\", W/"+raw.Header().Get("ETag")); w.Code != 304 {
		t.Fatal("etag list/weak revalidation", w.Code)
	}
	if w := get("/assets/app-abc123.js", "HEAD", "gzip", ""); w.Body.Len() != 0 || w.Header().Get("Content-Encoding") != "gzip" {
		t.Fatal("head", w.Header())
	}
	if w := get("/", "GET", "", ""); w.Header().Get("Cache-Control") != "no-cache" {
		t.Fatal("index must revalidate", w.Header())
	}
	if w := get("/icon.svg", "GET", "", ""); w.Header().Get("Cache-Control") != "public, max-age=86400" {
		t.Fatal("icon cache", w.Header())
	}
	for _, path := range []string{"/assets/", "/missing"} {
		if w := get(path, "GET", "", ""); w.Code != 404 {
			t.Fatal("unexpected listing/fallback", path, w.Code)
		}
	}
	if w := get("/index.html", "GET", "", ""); w.Code != 301 || w.Header().Get("Location") != "./" {
		t.Fatal("index redirect", w.Code, w.Header())
	}
}

func TestAPIErrorsJSON170(t *testing.T) {
	s, _ := muxServer120(t)
	if err := s.Security.Setup("admin", "a-long-password!", s.Security.setupToken); err != nil {
		t.Fatal(err)
	}
	login := httptest.NewRecorder()
	if err := s.Security.CreateSession(login, httptest.NewRequest("POST", "/api/login", nil)); err != nil {
		t.Fatal(err)
	}
	cookie := login.Result().Cookies()[0]
	sessionRequest := httptest.NewRequest("GET", "/api/status", nil)
	sessionRequest.AddCookie(cookie)
	session, err := s.Security.readSession(sessionRequest)
	if err != nil {
		t.Fatal(err)
	}
	h := s.Handler()
	routes := []struct {
		method, path string
		status       int
	}{
		{"GET", "/api/mux/jobs?id=999999", 404},
		{"GET", "/api/mux/jobs/log?id=999999", 404},
		{"POST", "/api/mux/cancel?id=999999", 404},
		{"GET", "/api/mediainfo/check-paths", 404},
		{"GET", "/api/placement/items/invalid", 404},
		{"GET", "/api/placement/items/999999", 404},
		{"GET", "/api/filecheck/items/invalid", 404},
		{"GET", "/api/filecheck/items/999999", 404},
		{"POST", "/api/storage", 405},
		{"GET", "/api/storage/refresh", 405},
		{"GET", "/api/webhook-credentials", 405},
		{"GET", "/api/tag-preview", 405},
	}
	for _, route := range routes {
		t.Run(route.method+route.path, func(t *testing.T) {
			r := httptest.NewRequest(route.method, route.path, nil)
			r.AddCookie(cookie)
			r.Header.Set("X-CSRF-Token", session.csrf)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != route.status || !strings.HasPrefix(w.Header().Get("Content-Type"), "application/json") || !json.Valid(w.Body.Bytes()) {
				t.Fatalf("unexpected API failure: %d %s", w.Code, w.Body)
			}
			if w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("API response cacheable")
			}
		})
	}
	cfg := s.Config()
	cfg.Mux.Enabled = false
	setTestSettings(s, cfg)
	r := httptest.NewRequest("GET", "/api/mux/jobs", nil)
	r.AddCookie(cookie)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 404 || !json.Valid(w.Body.Bytes()) {
		t.Fatal("disabled mux error", w.Code, w.Body)
	}
}

func TestDemoSettingsRemainVisible170(t *testing.T) {
	store := testStore(t)
	if e := SeedDemo(store); e != nil {
		t.Fatal(e)
	}
	cfg := DefaultSettings()
	cfg.Instances = cfg.AllInstances()
	if e := store.Put("settings", cfg); e != nil {
		t.Fatal(e)
	}
	if got := store.activePredicate(""); got != "1" {
		t.Fatal("demo library hidden after save", got)
	}
}

func TestUnchangedInitialSettings170(t *testing.T) {
	s, _ := muxServer120(t)
	s.Placement.scan.Running = true
	before := httptest.NewRecorder()
	s.settingsHTTP(before, httptest.NewRequest("GET", "/api/settings", nil))
	after := httptest.NewRecorder()
	s.settingsHTTP(after, httptest.NewRequest("PUT", "/api/settings", bytes.NewReader(before.Body.Bytes())))
	if after.Code != 200 {
		t.Fatalf("unchanged first save rejected: %d %s", after.Code, after.Body)
	}
	page := eventQueryAll(t, s.Store.Events, eventQuery{Sources: []string{"settings"}})
	if page.Total != 0 {
		t.Fatalf("unchanged settings logged a change: %+v", page.Events)
	}
}

func TestFailedLoginRedactsUnknownName170(t *testing.T) {
	s, _ := muxServer120(t)
	if e := s.Security.Setup("admin", "a-long-password!", s.Security.setupToken); e != nil {
		t.Fatal(e)
	}
	for _, name := range []string{"password-in-name-field", "admin"} {
		body, _ := json.Marshal(map[string]string{"username": name, "password": "wrong"})
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, httptest.NewRequest("POST", "/api/login", bytes.NewReader(body)))
		if w.Code != 401 {
			t.Fatal(w.Code, w.Body)
		}
	}
	page := eventQueryAll(t, s.Store.Events, eventQuery{Sources: []string{"auth"}})
	if page.Total != 2 {
		t.Fatal(page)
	}
	for _, event := range page.Events {
		if strings.Contains(event.Subject, "password-in-name-field") || strings.Contains(event.Detail, "password-in-name-field") {
			t.Fatal("unknown username leaked", event)
		}
	}
}

func TestCSVSafety170(t *testing.T) {
	for _, row := range []struct{ in, want string }{{"=a", "'=a"}, {"+a", "'+a"}, {"-a", "'-a"}, {"@a", "'@a"}, {" \t=a", "' \t=a"}, {"\r\n@a", "'\r\n@a"}, {"\t safe", "\t safe"}, {"", ""}, {"film", "film"}} {
		if got := csvSafeCell(row.in); got != row.want {
			t.Errorf("%q: %q", row.in, got)
		}
	}
}

func TestMuxStatusDoesNotDecodeJobs170(t *testing.T) {
	s, _ := muxServer120(t)
	for i, status := range []string{"draft", "ready", "queued", "running", "failed", "needs_attention", "needs_review", "succeeded", "cancelled"} {
		j := MuxJob{Service: "radarr", FileID: i + 1, Status: status}
		if e := s.Store.muxSave(&j); e != nil {
			t.Fatal(e)
		}
	}
	if _, e := s.Store.DB.ExecContext(context.Background(), "UPDATE mux_jobs SET source='malformed'"); e != nil {
		t.Fatal(e)
	}
	got := s.Mux.status()
	if got["pending"] != 3 || got["running"] != 1 || got["failed"] != 3 {
		t.Fatal("status depends on decoding payloads", got)
	}
}

func TestMuxPollingDoesNotReadMedia170(t *testing.T) {
	x := newRenameFixture(t, "radarr")
	var ready int64
	for i, status := range []string{"succeeded", "running", "ready"} {
		j := MuxJob{Service: "radarr", FileID: i + 1, Status: status}
		if e := x.s.Store.muxSave(&j); e != nil {
			t.Fatal(e)
		}
		if status == "ready" {
			ready = j.ID
		}
	}
	// Give each job its own cached file entry so a regression really opens all three.
	f, _ := x.s.Store.muxFile("radarr", 1)
	files := []File{}
	for i := 1; i <= 3; i++ {
		copy := f
		copy.ID = i
		files = append(files, copy)
	}
	if e := x.s.Store.Replace("radarr", files, SyncStatus{}); e != nil {
		t.Fatal(e)
	}
	old := muxOpenFile
	opens := 0
	muxOpenFile = func(path string) (*os.File, error) { opens++; return old(path) }
	t.Cleanup(func() { muxOpenFile = old })
	w := httptest.NewRecorder()
	x.s.muxHTTP(w, httptest.NewRequest("GET", "/api/mux/jobs", nil))
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body)
	}
	if opens != 0 {
		t.Fatalf("polling read media %d times", opens)
	}
	var jobs []MuxJob
	if e := json.Unmarshal(w.Body.Bytes(), &jobs); e != nil {
		t.Fatal(e)
	}
	if len(jobs) != 3 || jobs[0].Check != (MuxCheck{}) || jobs[1].Check != (MuxCheck{}) || !jobs[2].Check.Readable {
		t.Fatal("list check eligibility", jobs)
	}
	w = httptest.NewRecorder()
	x.s.muxHTTP(w, httptest.NewRequest("GET", fmt.Sprintf("/api/mux/jobs?id=%d&fresh=1", ready), nil))
	if w.Code != 200 || opens != 1 {
		t.Fatal("fresh must read once", w.Code, opens, w.Body)
	}
	// A cached detail of the completed job still provides metadata for the dialog.
	opens = 0
	w = httptest.NewRecorder()
	x.s.muxHTTP(w, httptest.NewRequest("GET", "/api/mux/jobs?id=1", nil))
	var detail MuxJob
	_ = json.Unmarshal(w.Body.Bytes(), &detail)
	if opens != 0 || !detail.Check.Readable {
		t.Fatal("detail must use metadata", opens, detail.Check)
	}
}

func TestMuxSQLFiltersIgnoreUnrelatedMalformedJob170(t *testing.T) {
	s, _ := muxServer120(t)
	for i, service := range []string{"radarr", "sonarr"} {
		j := MuxJob{Service: service, FileID: i + 1, Status: "succeeded"}
		if e := s.Store.muxSave(&j); e != nil {
			t.Fatal(e)
		}
	}
	_, _ = s.Store.DB.Exec("UPDATE mux_jobs SET source='malformed' WHERE service='sonarr'")
	w := httptest.NewRecorder()
	s.muxHTTP(w, httptest.NewRequest("GET", "/api/mux/jobs?service=radarr&fileId=1", nil))
	if w.Code != 200 {
		t.Fatal("unrelated job decoded", w.Code, w.Body)
	}
	var jobs []MuxJob
	_ = json.Unmarshal(w.Body.Bytes(), &jobs)
	if len(jobs) != 1 || jobs[0].Service != "radarr" {
		t.Fatal(jobs)
	}
}

func TestWebhookPendingIsExactPrefix170(t *testing.T) {
	s, _ := muxServer120(t)
	for _, service := range []string{"radarr_one", "radarrXone"} {
		s.Webhooks.states[service] = WebhookStatus{}
	}
	if e := s.Webhooks.Enqueue(WebhookJob{Service: "radarrXone", MediaID: 1}); e != nil {
		t.Fatal(e)
	}
	got := s.Webhooks.Statuses()
	if got["radarr_one"].Pending != 0 || got["radarrXone"].Pending != 1 {
		t.Fatal("LIKE metacharacters mixed service queues", got)
	}
}

func TestIdleWebhookWorkerDoesNotQuery170(t *testing.T) {
	s, _ := muxServer120(t)
	s.Store.DB.SetMaxOpenConns(1)
	conn, err := s.Store.DB.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() { s.Webhooks.processOne(ctx); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		cancel()
		t.Fatal("idle worker tried to acquire the only database connection")
	}
}

func TestWebhookRestartKeepsExistingDisabledQueue170(t *testing.T) {
	s, _ := muxServer120(t)
	cfg := s.Config()
	cfg.Instances = []ServiceConfig{{ID: "radarr", Type: "radarr", URL: "http://synthetic.invalid", Enabled: true}}
	setTestSettings(s, cfg)
	job := WebhookJob{Service: "radarr", MediaID: 1, InternalMux: true, Source: "old-endpoint"}
	if err := s.Webhooks.Enqueue(job); err != nil {
		t.Fatal(err)
	}
	restarted := NewWebhookManager(s)
	restarted.processOne(context.Background())
	if err := s.Store.Get(jobKey(job), &WebhookJob{}); err == nil {
		t.Fatal("internal job stranded after restart with incoming webhooks disabled")
	}
	// A disabled service's ordinary job survives until that service is enabled.
	cfg.Instances[0].Enabled = false
	setTestSettings(s, cfg)
	job.InternalMux = false
	if err := s.Webhooks.Enqueue(job); err != nil {
		t.Fatal(err)
	}
	restarted = NewWebhookManager(s)
	restarted.processOne(context.Background())
	if err := s.Store.Get(jobKey(job), &WebhookJob{}); err != nil {
		t.Fatal("disabled service lost durable job", err)
	}
	cfg.Instances[0].Enabled = true
	cfg.Instances[0].WebhookEnabled = true
	setTestSettings(s, cfg)
	restarted.processOne(context.Background())
	if err := s.Store.Get(jobKey(job), &WebhookJob{}); err == nil {
		t.Fatal("existing job stranded after enabling the service")
	}
}

func TestWebhookPrefixBoundaries170(t *testing.T) {
	s := testStore(t)
	for _, key := range []string{"webhook-job", "webhook-job:", "webhook-job:radarr:1", "webhook-job:radarr_one:2", "webhook-job;", "webhook-status:radarr"} {
		if err := s.Put(key, 1); err != nil {
			t.Fatal(err)
		}
	}
	for _, row := range []struct {
		prefix, upper string
		want          int
	}{{"webhook-job:", "webhook-job;", 3}, {"webhook-job:radarr:", "webhook-job:radarr;", 1}, {"webhook-job:radarr_one:", "webhook-job:radarr_one;", 1}} {
		lower, upper := kvPrefixRange(row.prefix)
		if lower != row.prefix || upper != row.upper {
			t.Fatal("wrong interval", lower, upper)
		}
		var got int
		if err := s.DB.QueryRow("SELECT count(*) FROM kv WHERE key>=? AND key<?", lower, upper).Scan(&got); err != nil || got != row.want {
			t.Fatal("wrong boundary membership", row.prefix, got, err)
		}
		rows, err := s.DB.Query("EXPLAIN QUERY PLAN SELECT key FROM kv WHERE key>=? AND key<?", lower, upper)
		if err != nil {
			t.Fatal(err)
		}
		plan := ""
		for rows.Next() {
			var id, parent, unused int
			var detail string
			if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
				t.Fatal(err)
			}
			plan += detail
		}
		rows.Close()
		if !strings.Contains(plan, "SEARCH") || !strings.Contains(plan, "INDEX") {
			t.Fatal("prefix query scans kv", plan)
		}
	}
}

func TestPerformance100KStatus170(t *testing.T) {
	if os.Getenv("SCOPEARR_PERF") != "1" {
		t.Skip("explicit status endpoint performance measurement")
	}
	s, _ := muxServer120(t)
	if err := s.Security.Setup("admin", "a-long-password!", s.Security.setupToken); err != nil {
		t.Fatal(err)
	}
	login := httptest.NewRecorder()
	if err := s.Security.CreateSession(login, httptest.NewRequest("POST", "/api/login", nil)); err != nil {
		t.Fatal(err)
	}
	cookie := login.Result().Cookies()[0]
	_, err := s.Store.DB.Exec(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<100000)
 INSERT INTO placement_items(item_key,service,instance,media_id,title,rel,scan_status,total_bytes,move_bytes,move_files,updated_at,share,devices,job_status)
 SELECT 'folder:'||x,'','','0','Film '||x,'movies/Film '||x,'ok',0,0,0,'','movies',1,CASE x%1000 WHEN 0 THEN 'queued' WHEN 1 THEN 'running' WHEN 2 THEN 'failed' ELSE 'succeeded' END FROM n`)
	if err != nil {
		t.Fatal(err)
	}
	h := s.Handler()
	times := []time.Duration{}
	for i := 0; i < 31; i++ {
		r := httptest.NewRequest("GET", "/api/status", nil)
		r.AddCookie(cookie)
		w := httptest.NewRecorder()
		start := time.Now()
		h.ServeHTTP(w, r)
		elapsed := time.Since(start)
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body)
		}
		var body struct {
			Unraid struct{ Pending, Running, Failed int }
		}
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if body.Unraid.Pending != 100 || body.Unraid.Running != 100 || body.Unraid.Failed != 100 {
			t.Fatal("status counts changed", body)
		}
		if i > 0 {
			times = append(times, elapsed)
		}
	}
	slices.Sort(times)
	t.Logf("100k placement rows /api/status: median %s, p95 %s, max %s (5ms reference)", times[len(times)/2], times[len(times)*95/100], times[len(times)-1])
}

func TestMuxExplicitActionsRequireReadProbe170(t *testing.T) {
	for _, operation := range []string{"mark", "queue", "worker-start"} {
		t.Run(operation, func(t *testing.T) {
			x := newRenameFixture(t, "radarr")
			x.s.Mux.tool.Installed = true
			old := muxOpenFile
			opens := 0
			muxOpenFile = func(string) (*os.File, error) { opens++; return nil, os.ErrPermission }
			t.Cleanup(func() { muxOpenFile = old })
			switch operation {
			case "mark":
				w := httptest.NewRecorder()
				x.s.muxHTTP(w, httptest.NewRequest("POST", "/api/mux/jobs", strings.NewReader(`{"service":"radarr","fileId":1}`)))
				if w.Code != 400 {
					t.Fatal("mark accepted unreadable media", w.Code, w.Body)
				}
			case "queue", "worker-start":
				status := "ready"
				if operation == "worker-start" {
					status = "queued"
				}
				j := MuxJob{Service: "radarr", FileID: 1, Status: status}
				if err := x.s.Store.muxSave(&j); err != nil {
					t.Fatal(err)
				}
				if operation == "queue" {
					// A prior successful polling check must not authorize queueing.
					x.s.Mux.checks[j.ID] = muxCheckCache{at: time.Now(), check: MuxCheck{Exists: true, Readable: true, Writable: true, FreeSpace: true, SizeMatches: true, Unchanged: true, WorkWritable: true, WorkFreeSpace: true}}
					w := httptest.NewRecorder()
					x.s.muxHTTP(w, httptest.NewRequest("POST", "/api/mux/run", strings.NewReader(fmt.Sprintf(`{"ids":[%d]}`, j.ID))))
					var body struct {
						Accepted []int64
						Rejected map[string]string
					}
					if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
						t.Fatal(err)
					}
					if len(body.Accepted) != 0 || body.Rejected[fmt.Sprint(j.ID)] != "Media file is not readable" {
						t.Fatal("queue used polling cache instead of probing", w.Code, w.Body)
					}
				} else {
					x.s.Mux.processOne(context.Background())
					finished, err := x.s.Store.muxJob(j.ID)
					if err != nil || finished.Status != "failed" {
						t.Fatal("worker started unreadable media", finished, err)
					}
				}
			}
			if opens != 1 {
				t.Fatalf("%s performed %d read probes, want one", operation, opens)
			}
		})
	}
}
