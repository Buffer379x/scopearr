package app

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

func TestStrictServiceJSON(t *testing.T) {
	for _, body := range []string{"null", "[] garbage", "[] {}", "[", "[null]", "[{\"id\":0,\"title\":\"Bad\"}]", "[{\"id\":1,\"title\":\"A\"},{\"id\":1,\"title\":\"B\"}]"} {
		t.Run(body, func(t *testing.T) {
			mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, body) }))
			defer mock.Close()
			s := testStore(t)
			if err := s.Replace("radarr", []File{sample(1, "Existing.1080p.x264.mkv")}, SyncStatus{Count: 1}); err != nil {
				t.Fatal(err)
			}
			syncer := NewSyncer(s)
			defer syncer.Shutdown()
			if err := syncer.Start(context.Background(), "radarr", ServiceConfig{Enabled: true, URL: mock.URL}); err != nil {
				t.Fatal(err)
			}
			waitSync(t, syncer, "radarr")
			if syncer.Statuses()["radarr"].Error == "" {
				t.Fatal("invalid response succeeded")
			}
			results, err := s.Query(url.Values{"service": {"radarr"}}, "matches", false)
			if err != nil || results.Total != 1 {
				t.Fatal("old cache lost", results, err)
			}
		})
	}
	for _, c := range []struct {
		body  string
		limit int64
		valid bool
	}{{"[]", 2, true}, {"[] ", 2, false}, {"[]            ", 3, false}, {"[] \n", 4, true}, {"null", 100, false}, {"{} bad", 100, false}} {
		var out any
		err := decodeServiceJSON(strings.NewReader(c.body), &out, c.limit)
		if (err == nil) != c.valid {
			t.Fatalf("body=%q limit=%d err=%v", c.body, c.limit, err)
		}
	}
}
func waitSync(t *testing.T, s *Syncer, service string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for s.Statuses()[service].Running && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if s.Statuses()[service].Running {
		t.Fatal("sync stuck")
	}
}
func TestGlobalSyncQueueAndCancellation(t *testing.T) {
	var active, maxActive, calls atomic.Int32
	release := make(chan struct{})
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		current := active.Add(1)
		defer active.Add(-1)
		calls.Add(1)
		for old := maxActive.Load(); current > old && !maxActive.CompareAndSwap(old, current); old = maxActive.Load() {
		}
		select {
		case <-release:
			fmt.Fprint(w, "[]")
		case <-r.Context().Done():
		}
	}))
	defer mock.Close()
	s := NewSyncer(testStore(t))
	defer s.Shutdown()
	cfg := ServiceConfig{Enabled: true, URL: mock.URL}
	if err := s.Start(context.Background(), "radarr", cfg); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for calls.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	ctx, cancel := context.WithCancel(context.Background())
	if err := s.Start(ctx, "sonarr", cfg); err != nil {
		t.Fatal(err)
	}
	if !s.Statuses()["sonarr"].Queued {
		t.Fatal("queue status absent")
	}
	cancel()
	waitSync(t, s, "sonarr")
	if calls.Load() != 1 {
		t.Fatal("cancelled queued job sent requests")
	}
	close(release)
	waitSync(t, s, "radarr")
	if maxActive.Load() != 1 {
		t.Fatal("overlapping service requests")
	}
	if err := s.Start(context.Background(), "sonarr", cfg); err != nil {
		t.Fatal(err)
	}
	waitSync(t, s, "sonarr")
	if s.Statuses()["sonarr"].Error != "" {
		t.Fatal(s.Statuses())
	}
}
func TestMetadataCompletenessAndVideoOnlyHDR(t *testing.T) {
	f := sample(1, "Movie.2160p.WEB-DL.x265.German.mkv")
	Enrich(&f, APIInfo{AudioLanguages: "English / German"})
	if f.Language != "Deutsch, Englisch" || f.Evidence["language"].Conflict || f.Evidence["language"].Origin != "combined" {
		t.Fatal(f)
	}
	Enrich(&f, APIInfo{AudioLanguages: "German / English"})
	if f.Evidence["language"].Conflict {
		t.Fatal("order creates conflict")
	}
	applyEmby(&f, []embyStream{{Type: "Video", ExtendedVideoType: "DolbyVision", ExtendedVideoSubType: "Hdr10"}})
	if f.HDR != "Dolby Vision + HDR10" || f.EmbyMatch != "no_tracks" {
		t.Fatal(f)
	}
	applyEmby(&f, []embyStream{{Type: "Audio", Index: 1, Codec: "dts", Language: "ger"}, {Type: "Audio", Index: 2, Language: "und"}})
	if !f.MetadataIncomplete || len(f.UnknownTraits) != 2 {
		t.Fatal("partial unknown traits omitted", f)
	}
	store := testStore(t)
	if err := store.Replace("radarr", []File{f}, SyncStatus{}); err != nil {
		t.Fatal(err)
	}
	for _, q := range []url.Values{{"service": {"radarr"}, "audio": {"__unknown__"}}, {"service": {"radarr"}, "language": {"__unknown__"}}, {"service": {"radarr"}, "metadata": {"incomplete"}}} {
		out, err := store.Query(q, "matches", false)
		if err != nil || out.Total != 1 {
			t.Fatal(out, err)
		}
	}
	facets, err := store.Facets("radarr")
	if err != nil || !strings.Contains(strings.Join(facets["audio"], "/"), "__unknown__") {
		t.Fatal(facets, err)
	}
	stats, err := store.Statistics()
	if err != nil || stats.Incomplete != 1 || stats.Emby["matched"] != 1 {
		t.Fatal(stats, err)
	}
}
func TestAggregateCacheIsolationInvalidationAndContext(t *testing.T) {
	s := testStore(t)
	s.Replace("radarr", []File{sample(1, "A.1080p.x264.mkv")}, SyncStatus{})
	facets, _ := s.Facets("radarr")
	facets["resolution"][0] = "mutated"
	again, _ := s.Facets("radarr")
	if again["resolution"][0] != "1080p" {
		t.Fatal("shared facet slice")
	}
	stats, _ := s.Statistics()
	stats.Emby["unconfigured"] = 99
	stats.Distributions["all"]["codec"][0].Count = 999
	current, _ := s.Statistics()
	if current.Emby["unconfigured"] == 99 || current.Distributions["all"]["codec"][0].Count == 999 {
		t.Fatal("shared statistics")
	}
	s.Replace("radarr", []File{sample(2, "B.2160p.x265.mkv")}, SyncStatus{})
	again, _ = s.Facets("radarr")
	if again["resolution"][0] != "2160p" {
		t.Fatal("stale cache")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := s.QueryContext(ctx, url.Values{"service": {"radarr"}}, "matches", false); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if _, err := s.StatisticsContext(ctx); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}
func TestAtomicPasswordReset(t *testing.T) {
	s := testStore(t)
	sec, err := NewSecurity(s)
	if err != nil {
		t.Fatal(err)
	}
	if err = sec.Setup("admin", "Original-password-2026", sec.setupToken); err != nil {
		t.Fatal(err)
	}
	s.DB.Exec("INSERT INTO sessions(token,csrf,expires) VALUES('session','csrf',9999999999)")
	s.DB.Exec("CREATE TRIGGER prevent_revoke BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT,'fixture'); END")
	if err = sec.Reset("Replacement-password-2026"); err == nil {
		t.Fatal("reset should fail")
	}
	var credential credentials
	s.Get("admin", &credential)
	if bcrypt.CompareHashAndPassword([]byte(credential.Hash), []byte("Original-password-2026")) != nil {
		t.Fatal("password changed despite failed revocation")
	}
	s.DB.Exec("DROP TRIGGER prevent_revoke")
	if err = sec.Reset("Replacement-password-2026"); err != nil {
		t.Fatal(err)
	}
	var n int
	s.DB.QueryRow("SELECT count(*) FROM sessions").Scan(&n)
	if n != 0 {
		t.Fatal("sessions retained")
	}
}
func TestCSVOrderAndDamagedRows(t *testing.T) {
	s := testStore(t)
	a, b := sample(1, "A.mkv"), sample(2, "B.mkv")
	a.Title, b.Title = "A", "B"
	a.Size, b.Size = 1, 2
	s.Replace("radarr", []File{a, b}, SyncStatus{})
	server := &Server{Store: s}
	w := httptest.NewRecorder()
	server.export(w, httptest.NewRequest("GET", "/api/export?service=radarr&sort=size&dir=desc", nil))
	reader := csv.NewReader(strings.NewReader(strings.TrimPrefix(w.Body.String(), "\ufeff")))
	reader.Comma = ';'
	records, err := reader.ReadAll()
	if err != nil || records[1][0] != "B" {
		t.Fatal(records, err)
	}
	s.DB.Exec("UPDATE files SET data='invalid json' WHERE id=1")
	w = httptest.NewRecorder()
	server.export(w, httptest.NewRequest("GET", "/api/export?service=radarr", nil))
	if w.Code != 500 || strings.HasPrefix(w.Header().Get("Content-Type"), "text/csv") {
		t.Fatal("partial successful CSV", w.Code, w.Body.String())
	}
}
func TestClearSavedConnectionKey(t *testing.T) {
	c := ServiceConfig{URL: "http://arr", ClearKey: true}
	if err := mergeConnection(&c, ServiceConfig{APIKey: "secret"}); err != nil || c.APIKey != "" || c.ClearKey {
		t.Fatal(c, err)
	}
	c = ServiceConfig{URL: "http://arr", Enabled: true, ClearKey: true}
	if err := mergeConnection(&c, ServiceConfig{APIKey: "secret"}); err == nil {
		t.Fatal("active connection with deleted key")
	}
}
func TestMappedEmbyPaths(t *testing.T) {
	mappings, err := parsePathMappings("/movies => /library/movies\n/tv => /media/tv")
	if err != nil {
		t.Fatal(err)
	}
	if !mappedPathMatches("/movies/Title/A.mkv", "/library/movies/Title/A.mkv", mappings) || mappedPathMatches("/movies-other/A.mkv", "/library/movies/A.mkv", mappings) {
		t.Fatal("prefix boundary")
	}
	f := sample(1, "A.mkv")
	f.SourcePath = "/movies/Right/A.mkv"
	f.Size = 100
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"Items": []embyItem{{Id: "wrong", Type: "Movie", Path: "/library/movies/Wrong/A.mkv", Size: 100, MediaStreams: []embyStream{{Type: "Audio", Index: 1, Codec: "aac"}}}, {Id: "right", Type: "Movie", Path: "/library/movies/Right/A.mkv", Size: 100, MediaStreams: []embyStream{{Type: "Audio", Index: 1, Codec: "dts", Language: "ger"}}}}, "TotalRecordCount": 2})
	}))
	defer mock.Close()
	files := []File{f}
	if err := NewEmby(ServiceConfig{URL: mock.URL, PathMappings: "/movies => /library/movies"}).Enrich(context.Background(), "radarr", files); err != nil || files[0].Audio != "DTS" || files[0].EmbyMatch != "matched" {
		t.Fatal(files, err)
	}
}

func TestVersion3MigrationRetainsEmbyMetadata(t *testing.T) {
	dir := t.TempDir()
	s, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	f := sample(1, "Film.2160p.x265.mkv")
	applyEmby(&f, []embyStream{{Type: "Video", ExtendedVideoType: "DolbyVision", ExtendedVideoSubType: "Hdr10"}, {Type: "Audio", Index: 1, Codec: "dts", Language: "ger"}, {Type: "Audio", Index: 2, Codec: "ac3", Language: "eng"}})
	if err = s.Replace("radarr", []File{f}, SyncStatus{Count: 1}); err != nil {
		t.Fatal(err)
	}
	cfg := DefaultSettings()
	cfg.TagColors = map[string]string{"audio:DTS": "#777777"}
	cfg.VisibleColumns["radarr"] = []string{"title", "audio"}
	cfg.ColumnOrder["radarr"][0], cfg.ColumnOrder["radarr"][6] = cfg.ColumnOrder["radarr"][6], cfg.ColumnOrder["radarr"][0]
	if err = s.Put("settings", cfg); err != nil {
		t.Fatal(err)
	}
	if _, err = s.DB.Exec("INSERT INTO presets(name,service,query) VALUES('Both','radarr','audio=DTS&audio=AC-3&audioOp=all'); PRAGMA user_version=3"); err != nil {
		t.Fatal(err)
	}
	s.DB.Close()
	s, err = OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.DB.Close()
	results, err := s.Query(url.Values{"service": {"radarr"}, "audio": {"DTS", "AC-3"}, "audioOp": {"all"}, "hdr": {"Dolby Vision", "HDR10"}, "hdrOp": {"all"}}, "matches", false)
	if err != nil || results.Total != 1 || len(results.Files[0].AudioTracks) != 2 || results.Files[0].EmbyMatch != "matched" {
		t.Fatal(results, err)
	}
	for service, columns := range cfg.VisibleColumns {
		if !containsColumn(columns, "custom") {
			cfg.VisibleColumns[service] = append(columns, "custom")
		}
	}
	var after Settings
	if err = s.Get("settings", &after); err != nil || !reflect.DeepEqual(after, settingsForStorage(cfg)) {
		t.Fatal(after, err)
	}
	presets, err := s.Presets()
	if err != nil || len(presets) != 1 {
		t.Fatal(presets, err)
	}
	backups, _ := filepath.Glob(filepath.Join(dir, "backups", "*.db"))
	if len(backups) != 1 {
		t.Fatal(backups)
	}
}

func TestPasswordResetBlocksStaleSessionAndPasswordChange(t *testing.T) {
	s := testStore(t)
	sec, err := NewSecurity(s)
	if err != nil {
		t.Fatal(err)
	}
	if err = sec.Setup("admin", "Original-password-2026", sec.setupToken); err != nil {
		t.Fatal(err)
	}
	oldHash := sec.loginHash("admin", "Original-password-2026", "local")
	if oldHash == "" {
		t.Fatal("valid password refused")
	}
	if err = sec.Reset("Replacement-password-2026"); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	if err = sec.createSession(w, httptest.NewRequest("GET", "/", nil), oldHash); !errors.Is(err, errCredentialsChanged) || len(w.Result().Cookies()) != 0 {
		t.Fatal("stale login survived reset", err)
	}
	if err = sec.reset("Stale-change-password-2026", oldHash); !errors.Is(err, errCredentialsChanged) {
		t.Fatal("stale password change succeeded", err)
	}
	if !sec.Login("admin", "Replacement-password-2026", "local") {
		t.Fatal("new password overwritten")
	}
	w = httptest.NewRecorder()
	valid, err := sec.LoginSession(w, httptest.NewRequest("GET", "/", nil), "admin", "Replacement-password-2026", "local")
	if err != nil || !valid || len(w.Result().Cookies()) != 1 {
		t.Fatal("fresh login failed", err)
	}
}
