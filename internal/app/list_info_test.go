package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestInfoLayoutUpgradeAndPersistence(t *testing.T) {
	cfg := DefaultSettings()
	cfg.ListInfoOrder = nil
	cfg.ListInfoVisible = nil
	cfg.ColumnOrder["radarr"] = []string{"size", "title", "year", "resolution", "codec", "source", "hdr", "bitDepth", "audio", "channels", "custom"}
	cfg.VisibleColumns["radarr"] = []string{"size", "title"}
	if err := normalizeVisibleColumns(&cfg); err != nil {
		t.Fatal(err)
	}
	if strings.Join(cfg.ColumnOrder["radarr"], ",") != "info,size,title,year,resolution,codec,source,processing,hdr,bitDepth,audio,channels,custom" || strings.Join(cfg.VisibleColumns["radarr"], ",") != "info,size,title" {
		t.Fatal("old layout changed", cfg)
	}
	cfg.ListInfoOrder = []string{"recognition", "metadata", "details", "link"}
	cfg.ListInfoVisible = []string{}
	cfg.VisibleColumns["radarr"] = []string{"title", "size"}
	store := testStore(t)
	if err := store.Put("settings", cfg); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, err := NewServer(ctx, store, nil, "test")
	if err != nil {
		t.Fatal(err)
	}
	defer server.Sync.Shutdown()
	got := server.Config()
	if !reflect.DeepEqual(got.ListInfoOrder, []string{"recognition", "metadata", "details", "link", "media", "mux"}) || !reflect.DeepEqual(got.ListInfoVisible, []string{"mux"}) || containsColumn(got.VisibleColumns["radarr"], "info") {
		t.Fatal("explicit hidden choices lost", got)
	}
	for _, bad := range [][]string{{"link", "link", "metadata", "recognition"}, {"link"}, {"link", "details", "metadata", "command"}} {
		invalid := DefaultSettings()
		invalid.ListInfoOrder = bad
		if normalizeVisibleColumns(&invalid) == nil {
			t.Fatal("invalid action order accepted")
		}
	}
	cfg.ListInfoVisible = []string{"unknown"}
	if normalizeVisibleColumns(&cfg) == nil {
		t.Fatal("invalid action visibility accepted")
	}
}
func TestEntryLinksReadOnlyAndBoundToCachedMedia(t *testing.T) {
	store := testStore(t)
	f := sample(1, "Movie.mkv")
	f.MediaID = 10
	if err := store.Replace("radarr", []File{f}, SyncStatus{}); err != nil {
		t.Fatal(err)
	}
	series := sample(2, "Series.S01E01.mkv")
	series.MediaID = 30
	if err := store.Replace("sonarr", []File{series}, SyncStatus{}); err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	calls := []string{}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		calls = append(calls, r.Method+" "+r.URL.Path)
		mu.Unlock()
		if r.Method != "GET" || r.Header.Get("X-Api-Key") != "synthetic" {
			t.Error("unsafe request")
			http.Error(w, "unsafe", 405)
			return
		}
		switch r.URL.Path {
		case "/radarr/api/v3/movie/10":
			w.Write([]byte(`{"id":10,"titleSlug":"603"}`))
		case "/sonarr/api/v3/series/30":
			w.Write([]byte(`{"id":30,"titleSlug":"breaking-bad"}`))
		default:
			t.Error("unexpected endpoint", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, err := NewServer(ctx, store, nil, "test")
	if err != nil {
		t.Fatal(err)
	}
	defer server.Sync.Shutdown()
	server.mu.Lock()
	server.settings.Radarr = ServiceConfig{Enabled: true, URL: upstream.URL + "/radarr/", APIKey: "synthetic", Interval: 0}
	server.settings.Sonarr = ServiceConfig{Enabled: true, URL: upstream.URL + "/sonarr", APIKey: "synthetic", Interval: 0}
	server.mu.Unlock()
	store.DB.Exec("INSERT INTO sessions(token,csrf,expires) VALUES(?,?,?)", tokenHash("entry-test"), "csrf", time.Now().Add(time.Hour).Unix())
	request := func(path string, authenticated bool) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", path, nil)
		if authenticated {
			r.AddCookie(&http.Cookie{Name: "scopearr_session", Value: "entry-test"})
		}
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, r)
		return w
	}
	if w := request("/api/open-entry?service=radarr&mediaId=10", false); w.Code != 401 {
		t.Fatal("link bypassed login", w.Code)
	}
	for _, tc := range []struct{ service, id, target string }{{"radarr", "10", "/radarr/movie/603"}, {"sonarr", "30", "/sonarr/series/breaking-bad"}} {
		w := request("/api/open-entry?service="+tc.service+"&mediaId="+tc.id, true)
		if w.Code != 302 || w.Header().Get("Location") != upstream.URL+tc.target || strings.Contains(w.Body.String(), "synthetic") {
			t.Fatal("wrong link", w.Code, w.Header())
		}
	}
	if w := request("/api/open-entry?service=radarr&mediaId=999", true); w.Code != 404 {
		t.Fatal(w.Code)
	}
	if w := request("/api/open-entry?service=emby&mediaId=10", true); w.Code != 400 {
		t.Fatal(w.Code)
	}
	if len(calls) != 2 {
		t.Fatal("non-cached ID triggered API request", calls)
	}
	f.TitleSlug = "603"
	store.Replace("radarr", []File{f}, SyncStatus{})
	if w := request("/api/open-entry?service=radarr&mediaId=10", true); w.Code != 302 || len(calls) != 2 {
		t.Fatal("cached slug not used")
	}
	for _, base := range []string{"javascript:alert(1)", "https://secret:password@example.test", "https://example.test/?apikey=secret", "https://example.test/#fragment"} {
		if _, err := entryURL(base, "radarr", "603"); err == nil {
			t.Fatal("unsafe URL accepted", base)
		}
	}
	if _, err := entryURL(upstream.URL, "sonarr", "../settings"); err == nil {
		t.Fatal("unsafe slug accepted")
	}
	if movieSlug("", 603) != "603" || movieSlug("", 0) != "" {
		t.Fatal("Radarr fallback used internal ID")
	}
	// Local filename reprocessing must preserve the upstream UI identity.
	cfg := store.recognition.Load().Config()
	cfg.Rules[0].Name += " QA"
	if _, err := store.SaveRecognition(context.Background(), cfg.Rules, cfg.Revision); err != nil {
		t.Fatal(err)
	}
	var raw string
	store.DB.QueryRow("SELECT data FROM files WHERE service='radarr' AND id=1").Scan(&raw)
	var restored File
	json.Unmarshal([]byte(raw), &restored)
	if restored.TitleSlug != "603" {
		t.Fatal("reprocessing lost the UI slug")
	}
}

func TestSyncCapturesUpstreamUISlugs(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			t.Error("unexpected mutation")
			http.Error(w, "method", 405)
			return
		}
		switch r.URL.Path {
		case "/api/v3/movie":
			w.Write([]byte(`[{"id":42,"title":"Movie","year":2020,"tmdbId":603}]`))
		case "/api/v3/moviefile":
			w.Write([]byte(`[{"id":1,"movieId":42,"relativePath":"Movie.mkv","size":100}]`))
		case "/api/v3/series":
			w.Write([]byte(`[{"id":30,"title":"Breaking Bad","titleSlug":"breaking-bad"}]`))
		case "/api/v3/episodefile":
			w.Write([]byte(`[{"id":2,"seriesId":30,"seasonNumber":1,"relativePath":"S01E01.mkv","size":100}]`))
		case "/api/v3/episode":
			w.Write([]byte(`[{"id":99,"episodeFileId":2,"episodeNumber":1,"title":"Pilot","airDate":"2008-01-01"}]`))
		default:
			t.Error("unexpected endpoint", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	client := NewArr(ServiceConfig{URL: upstream.URL})
	for _, tc := range []struct {
		service, slug string
		mediaID       int
	}{{"radarr", "603", 42}, {"sonarr", "breaking-bad", 30}} {
		files, err := client.Fetch(context.Background(), tc.service)
		if err != nil || len(files) != 1 || files[0].TitleSlug != tc.slug || files[0].MediaID != tc.mediaID {
			t.Fatal("wrong UI identity", files, err)
		}
	}
}

func TestInfoSettingsUpgradeBacksUpAndPersistsOnce(t *testing.T) {
	store := testStore(t)
	security, err := NewSecurity(store)
	if err != nil {
		t.Fatal(err)
	}
	cfg := DefaultSettings()
	cfg.ListInfoOrder = nil
	cfg.ListInfoVisible = nil
	cfg.ColumnOrder = map[string][]string{"radarr": {"title", "year", "resolution", "codec", "source", "size", "hdr", "bitDepth", "audio", "channels", "custom"}, "sonarr": {"title", "year", "resolution", "codec", "source", "size", "hdr", "bitDepth", "audio", "channels", "custom"}}
	cfg.VisibleColumns = map[string][]string{"radarr": {"title", "year"}, "sonarr": {"title", "source"}}
	cfg.Radarr.APIKey = security.Seal("migration-test-key")
	if err := store.Put("settings", cfg); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, err := NewServer(ctx, store, nil, "test")
	if err != nil {
		t.Fatal(err)
	}
	defer server.Sync.Shutdown()
	var persisted Settings
	if err := store.Get("settings", &persisted); err != nil {
		t.Fatal(err)
	}
	if persisted.ListInfoOrder == nil || persisted.ColumnOrder["radarr"][0] != "info" || strings.Join(persisted.VisibleColumns["radarr"], ",") != "info,title,year" {
		t.Fatal("migration not retained")
	}
	if persisted.Radarr.APIKey != cfg.Radarr.APIKey || server.Config().Radarr.APIKey != "migration-test-key" {
		t.Fatal("encrypted credential changed during settings upgrade")
	}
	second, err := NewServer(ctx, store, nil, "test")
	if err != nil {
		t.Fatal(err)
	}
	defer second.Sync.Shutdown()
	entries, err := os.ReadDir(filepath.Join(store.Dir, "backups"))
	if err != nil || len(entries) != 1 {
		t.Fatal("pre-upgrade backup missing", err, len(entries))
	}
}
