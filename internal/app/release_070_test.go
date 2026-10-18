package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestClockScheduleAndDST(t *testing.T) {
	c := ServiceConfig{Enabled: true, Interval: 360, SyncStart: "12:00"}
	now := time.Date(2026, 10, 14, 13, 0, 0, 0, scheduleLocation("Europe/Berlin"))
	last := now.Add(-time.Hour)
	if syncDue(now, &last, c, "Europe/Berlin") {
		t.Fatal("12:00 slot repeated")
	}
	last = last.Add(-time.Second)
	if !syncDue(now, &last, c, "Europe/Berlin") {
		t.Fatal("slot missed")
	}
	next := nextSync(now, c, "Europe/Berlin")
	if next == nil || next.In(scheduleLocation("Europe/Berlin")).Hour() != 18 {
		t.Fatal(next)
	}
	c.Interval = 1440
	c.SyncStart = "02:30"
	spring := time.Date(2026, 3, 29, 0, 0, 0, 0, scheduleLocation("Europe/Berlin"))
	next = nextSync(spring, c, "Europe/Berlin")
	if next == nil || next.In(scheduleLocation("Europe/Berlin")).Day() != 30 {
		t.Fatal("nonexistent slot ran", next)
	}
	c.SyncStart = ""
	last = now.Add(-24 * time.Hour)
	if !syncDue(now, &last, c, "") {
		t.Fatal("legacy interval changed")
	}
	cfg := DefaultSettings()
	cfg.SyncTimezone = "wrong/zone"
	if normalizeSettings(&cfg) == nil {
		t.Fatal("bad timezone accepted")
	}
}
func TestSharedStorageAreasAndPersistence(t *testing.T) {
	cfg := DefaultSettings()
	cfg.Radarr = ServiceConfig{Enabled: true, URL: "http://r"}
	cfg.Sonarr = ServiceConfig{Enabled: true, URL: "http://s"}
	cfg.Widgets.Storage = map[string][]StorageSelection{"radarr": {{Path: "/movies", SharedGroup: ""}, {Path: "/downloads", SharedGroup: "downloads"}}, "sonarr": {{Path: "/series", SharedGroup: ""}, {Path: "/download", SharedGroup: "downloads"}}}
	now := time.Now()
	snap := map[string]StorageSnapshot{"radarr": {Disks: []DiskSpace{{Path: "/movies", Total: 100, Free: 30}, {Path: "/downloads", Total: 200, Free: 100}}, SuccessAt: &now, Source: tagEndpoint(cfg.Radarr)}, "sonarr": {Disks: []DiskSpace{{Path: "/series", Total: 300, Free: 200}, {Path: "/download", Total: 200, Free: 100}}, SuccessAt: &now, Source: tagEndpoint(cfg.Sonarr)}}
	all := storageAreas(cfg, snap, "all")
	if len(all) != 3 {
		t.Fatal(all)
	}
	for _, area := range all {
		if area.Key == "shared:downloads" && (area.Total != 200 || area.Free != 100 || len(area.Paths) != 2) {
			t.Fatal(area)
		}
	}
	if got := storageAreas(cfg, snap, "radarr"); len(got) != 2 {
		t.Fatal(got)
	}
	s := snap["sonarr"]
	s.Disks[1].Total = 201
	snap["sonarr"] = s
	for _, area := range storageAreas(cfg, snap, "all") {
		if area.Key == "shared:downloads" && (area.Error == "" || area.Total != 0) {
			t.Fatal("conflicting shared readings accepted", area)
		}
	}
	if versionNewer("0.7.0", "0.6.9") != true || versionNewer("0.6.3", "0.7.0") || versionNewer("v0.7.0-rc1", "0.6.3") {
		t.Fatal("version comparison")
	}
}
func TestInfoCountsSortBothLibraries(t *testing.T) {
	for _, service := range []string{"radarr", "sonarr"} {
		s := testStore(t)
		files := []File{sample(1, "Zulu"), sample(2, "Alpha"), sample(3, "Beta")}
		for i := range files {
			files[i].APIInfo = nil
			files[i].Evidence = nil
			files[i].Conflict = i == 0
			files[i].RuleConflict = i == 2
		}
		if e := s.Replace(service, files, SyncStatus{}); e != nil {
			t.Fatal(e)
		}
		q := url.Values{"service": {service}, "sort": {"info"}, "dir": {"desc"}, "_infoMask": {"4"}}
		got, e := s.Query(q, "matches", true)
		if e != nil || got.Files[0].ID != 1 || got.Files[1].ID != 2 {
			t.Fatal(got, e)
		}
		q.Set("_infoMask", "0")
		got, e = s.Query(q, "matches", true)
		if e != nil || got.Files[0].ID != 2 {
			t.Fatal(got, e)
		}
		q.Set("dir", "DROP TABLE")
		if _, e = s.Query(q, "matches", true); e == nil {
			t.Fatal("unsafe direction")
		}
	}
}
func TestWebhookTargetedAtomicUpdatesAndAuth(t *testing.T) {
	store := testStore(t)
	old := sample(10, "Old.1080p.x264.mkv")
	old.MediaID = 42
	other := sample(20, "Other.720p.mkv")
	other.MediaID = 99
	other.AudioTracks = []AudioTrack{{Language: "Deutsch", Codec: "AC-3"}}
	now := time.Now()
	if e := store.Replace("radarr", []File{old, other}, SyncStatus{LastSuccess: &now}); e != nil {
		t.Fatal(e)
	}
	var mu sync.Mutex
	paths := []string{}
	fail := false
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		paths = append(paths, r.Method+" "+r.URL.RequestURI())
		if r.Method != "GET" || r.Header.Get("X-Api-Key") != "synthetic" {
			t.Errorf("unsafe request %s", r.Method)
		}
		switch r.URL.Path {
		case "/api/v3/movie/42":
			json.NewEncoder(w).Encode(map[string]any{"id": 42, "title": "Changed", "year": 2025, "tmdbId": 42})
		case "/api/v3/moviefile":
			if fail {
				http.Error(w, "failure", 500)
				return
			}
			json.NewEncoder(w).Encode([]map[string]any{{"id": 11, "movieId": 42, "relativePath": "New.2160p.x265.mkv", "size": 500}})
		default:
			t.Errorf("untargeted path %s", r.URL)
			w.WriteHeader(404)
		}
	}))
	defer api.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, e := NewServer(ctx, store, nil, "0.7.0")
	if e != nil {
		t.Fatal(e)
	}
	defer server.Sync.Shutdown()
	server.mu.Lock()
	server.settings.Radarr = ServiceConfig{Enabled: true, URL: api.URL, APIKey: "synthetic", WebhookEnabled: true}
	server.mu.Unlock()
	key, e := server.Webhooks.key("radarr", true)
	if e != nil {
		t.Fatal(e)
	}
	send := func(secret, payload string) int {
		r := httptest.NewRequest("POST", "/api/webhooks/arr?service=radarr", strings.NewReader(payload))
		r.SetBasicAuth("radarr", secret)
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, r)
		return w.Code
	}
	body := `{"eventType":"Download","movie":{"id":42}}`
	if send("bad", body) != 401 {
		t.Fatal("unauthenticated webhook")
	}
	if send(key, body+" {}") != 400 {
		t.Fatal("multipart body accepted")
	}
	if send(key, `{"eventType":"Test"}`) != 200 {
		t.Fatal("test not accepted")
	}
	if send(key, body) != 202 {
		t.Fatal("valid webhook rejected")
	}
	var job WebhookJob
	store.Get("webhook-job:radarr:42", &job)
	job.Next = time.Now().Add(-time.Second)
	store.Put(jobKey(job), job)
	server.Webhooks.processOne(ctx)
	got, e := store.Query(url.Values{"service": {"radarr"}}, "matches", true)
	if e != nil || len(got.Files) != 2 || got.Files[0].Title != "Changed" {
		t.Fatal(got, e)
	}
	if !reflect.DeepEqual(got.Files[1].AudioTracks, other.AudioTracks) {
		t.Fatal("unaffected file changed")
	}
	var revision string
	if store.Get("cacheRevision", &revision) != nil || revision == "" {
		t.Fatal("no cache revision")
	}
	mu.Lock()
	fail = true
	mu.Unlock()
	job.Next = time.Now().Add(-time.Second)
	store.Put(jobKey(job), job)
	server.Webhooks.processOne(ctx)
	after, _ := store.Query(url.Values{"service": {"radarr"}}, "matches", true)
	if !reflect.DeepEqual(got, after) {
		t.Fatal("failed delta replaced cache")
	}
	var retry WebhookJob
	if store.Get(jobKey(job), &retry) != nil || retry.Attempts != 1 {
		t.Fatal("failed job not retained")
	}
	mu.Lock()
	defer mu.Unlock()
	for _, path := range paths {
		if path != "GET /api/v3/movie/42" && path != "GET /api/v3/moviefile?movieId=42" {
			t.Fatal(path)
		}
	}
}
func TestSonarrDeltaOnlyAffectedFileAndEpisodes(t *testing.T) {
	paths := []string{}
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.RequestURI())
		switch r.URL.Path {
		case "/api/v3/series/7":
			json.NewEncoder(w).Encode(map[string]any{"id": 7, "title": "Series"})
		case "/api/v3/episodefile":
			if r.URL.Query().Get("seriesId") != "" || r.URL.Query().Get("episodeFileIds") != "9" {
				t.Error("whole series requested")
			}
			json.NewEncoder(w).Encode([]map[string]any{{"id": 9, "seriesId": 7, "seasonNumber": 1, "relativePath": "Episode.mkv"}})
		case "/api/v3/episode":
			if r.URL.Query().Get("episodeFileId") != "9" || r.URL.Query().Get("seriesId") != "" {
				t.Error("whole season requested")
			}
			json.NewEncoder(w).Encode([]map[string]any{{"id": 100, "episodeFileId": 9, "episodeNumber": 1, "airDate": "2020-01-01", "title": "Pilot"}})
		default:
			t.Fatal(r.URL.Path)
		}
	}))
	defer api.Close()
	scope := &DeltaScope{MediaID: 7, FileIDs: []int{9}}
	files, e := NewArr(ServiceConfig{URL: api.URL}).FetchDelta(context.Background(), "sonarr", scope)
	if e != nil || len(files) != 1 || len(files[0].Episodes) != 1 || scope.All {
		t.Fatal(files, e)
	}
	if len(paths) != 3 {
		t.Fatal(paths)
	}
}
func TestScopedCacheRetainsManualTagsAndUnchangedEmby(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	tag, e := s.SaveCustomTag(ctx, CustomTag{Name: "Favorite"})
	if e != nil {
		t.Fatal(e)
	}
	a, b := sample(9, "Episode.German.mkv"), sample(10, "Other.mkv")
	a.MediaID = 7
	b.MediaID = 7
	a.EmbyMatch = "matched"
	a.AudioTracks = []AudioTrack{{Language: "Deutsch", Codec: "DTS"}}
	if e = s.Replace("sonarr", []File{a, b}, SyncStatus{}); e != nil {
		t.Fatal(e)
	}
	q := url.Values{"service": {"sonarr"}, "fileId": {"9"}}
	if _, e = s.ApplyCustom(ctx, q, map[string]bool{strconv.FormatInt(tag.ID, 10): true}); e != nil {
		t.Fatal(e)
	}
	fresh := []File{sample(9, a.Filename)}
	fresh[0].MediaID = 7
	if e = s.preserveDeltaEmby(ctx, "sonarr", fresh, true); e != nil {
		t.Fatal(e)
	}
	if e = s.replace("sonarr", fresh, SyncStatus{}, true, &DeltaScope{MediaID: 7, FileIDs: []int{9}}); e != nil {
		t.Fatal(e)
	}
	out, e := s.Query(q, "matches", true)
	if e != nil || len(out.Files) != 1 || len(out.Files[0].Custom) != 1 || len(out.Files[0].AudioTracks) != 1 {
		t.Fatal(out, e)
	}
	q.Del("fileId")
	out, e = s.Query(q, "matches", true)
	if e != nil || out.Total != 2 {
		t.Fatal("unaffected episode removed", out, e)
	}
	if e = s.replace("sonarr", nil, SyncStatus{}, true, &DeltaScope{MediaID: 7, FileIDs: []int{9}}); e != nil {
		t.Fatal(e)
	}
	out, _ = s.Query(q, "matches", true)
	if out.Total != 1 || out.Files[0].ID != 10 {
		t.Fatal(out)
	}
}
func TestWebhookQueueCoalescesAndCredentialsStayEncrypted(t *testing.T) {
	s := testStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, e := NewServer(ctx, s, nil, "0.7.0")
	if e != nil {
		t.Fatal(e)
	}
	defer server.Sync.Shutdown()
	key, e := server.Webhooks.key("sonarr", true)
	if e != nil {
		t.Fatal(e)
	}
	var stored string
	s.Get("webhook-key:sonarr", &stored)
	if !strings.HasPrefix(stored, "enc:") || strings.Contains(stored, key) {
		t.Fatal("secret not encrypted")
	}
	other, e := server.Webhooks.key("sonarr", true)
	if e != nil || key != other {
		t.Fatal("credentials rotated unexpectedly")
	}
	if e = server.Webhooks.Enqueue(WebhookJob{Service: "sonarr", MediaID: 7, FileIDs: []int{1, 2}, Source: "same"}); e != nil {
		t.Fatal(e)
	}
	if e = server.Webhooks.Enqueue(WebhookJob{Service: "sonarr", MediaID: 7, FileIDs: []int{2, 3}, Source: "same"}); e != nil {
		t.Fatal(e)
	}
	var job WebhookJob
	if e = s.Get("webhook-job:sonarr:7", &job); e != nil || !reflect.DeepEqual(job.FileIDs, []int{1, 2, 3}) {
		t.Fatal(job, e)
	}
	again := NewWebhookManager(server)
	other, e = again.key("sonarr", false)
	if e != nil || other != key || again.Statuses()["sonarr"].Pending != 1 {
		t.Fatal("durable credentials/queue lost")
	}
}
func TestTargetedTagPlanUsesOnlyAffectedCacheAndCatalogEntry(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	paths := []string{}
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		switch r.URL.Path {
		case "/api/v3/tag":
			json.NewEncoder(w).Encode([]map[string]any{{"id": 1, "label": "1080p"}})
		case "/api/v3/movie/42":
			json.NewEncoder(w).Encode(map[string]any{"id": 42, "title": "Affected", "tags": []int{}})
		default:
			t.Errorf("unexpected tag endpoint %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer api.Close()
	cfg := ServiceConfig{Enabled: true, URL: api.URL, APIKey: "synthetic", TagSync: TagGroups{Resolution: true}, TagSyncMode: "add"}
	a, b := sample(1, "A.1080p.mkv"), sample(2, "B.720p.mkv")
	a.MediaID = 42
	b.MediaID = 99
	now := time.Now()
	if e := s.Replace("radarr", []File{a, b}, SyncStatus{Source: tagEndpoint(cfg), LastSuccess: &now}); e != nil {
		t.Fatal(e)
	}
	p, e := s.BuildTagPlan(ctx, "radarr", cfg, nil, 42)
	if e != nil {
		t.Fatal(e)
	}
	if len(p.Snapshot.desired) != 1 || p.Snapshot.desired[99] != nil || len(p.Operations) != 1 || p.Operations[0].ID != 42 || p.Required["720p"] {
		t.Fatal("unrelated cache selected", p.Snapshot, p.Operations)
	}
	if !reflect.DeepEqual(paths, []string{"/api/v3/tag", "/api/v3/movie/42"}) {
		t.Fatal(paths)
	}
}
