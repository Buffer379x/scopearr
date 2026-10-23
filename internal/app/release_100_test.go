package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestReadSnapshotsRemainAvailableDuringWriter100(t *testing.T) {
	s := testStore(t)
	if err := s.Replace("radarr", []File{sample(1, "Original.1080p.x264.mkv")}, SyncStatus{}); err != nil {
		t.Fatal(err)
	}
	tx, err := s.DB.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err = tx.Exec("DELETE FROM files"); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	rows, err := s.QueryContext(ctx, url.Values{"service": {"radarr"}}, "matches", false)
	if err != nil || rows.Total != 1 || len(rows.Files) != 1 || rows.Files[0].ID != 1 {
		t.Fatal(rows, err)
	}
	stats, err := s.StatisticsContext(ctx)
	if err != nil || stats.Files != 1 {
		t.Fatal(stats, err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	s.invalidateAggregates()
	rows, err = s.QueryContext(ctx, url.Values{"service": {"radarr"}}, "matches", false)
	if err != nil || rows.Total != 0 {
		t.Fatal(rows, err)
	}
}

func TestCorruptStartupSettingsAndRulesStayIntact100(t *testing.T) {
	t.Run("settings", func(t *testing.T) {
		s := testStore(t)
		if _, err := s.DB.Exec("INSERT INTO kv VALUES('settings','{broken')"); err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		server, err := NewServer(ctx, s, nil, "test")
		if err == nil {
			server.Sync.Shutdown()
			t.Fatal("corrupt existing settings were accepted")
		}
		var raw string
		s.DB.QueryRow("SELECT value FROM kv WHERE key='settings'").Scan(&raw)
		if raw != "{broken" {
			t.Fatal("settings overwritten", raw)
		}
	})
	t.Run("migration", func(t *testing.T) {
		dir := t.TempDir()
		s, err := OpenStore(dir)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = s.DB.Exec("UPDATE kv SET value='{corrupt-user-rules' WHERE key='recognition'; PRAGMA user_version=10"); err != nil {
			t.Fatal(err)
		}
		s.DB.Close()
		reopened, err := OpenStore(dir)
		if err == nil {
			reopened.DB.Close()
			t.Fatal("corrupt rules were replaced during migration")
		}
		db, err := sql.Open("sqlite", filepath.Join(dir, "scopearr.db"))
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		var raw string
		if err = db.QueryRow("SELECT value FROM kv WHERE key='recognition'").Scan(&raw); err != nil || raw != "{corrupt-user-rules" {
			t.Fatal(raw, err)
		}
	})
}

func TestDatabasePathEscapingAndPermissions100(t *testing.T) {
	for _, name := range []string{"data?directory", "data#fragment%20"} {
		t.Run(name, func(t *testing.T) {
			dir := filepath.Join(t.TempDir(), name)
			s, err := OpenStore(dir)
			if err != nil {
				t.Fatal(err)
			}
			defer s.DB.Close()
			var number int
			var label, actual string
			if err = s.DB.QueryRow("PRAGMA database_list").Scan(&number, &label, &actual); err != nil {
				t.Fatal(err)
			}
			expected := filepath.Join(dir, "scopearr.db")
			if actual != expected {
				t.Fatalf("database at %q, want %q", actual, expected)
			}
			st, err := os.Stat(expected)
			if err != nil || st.Mode().Perm() != 0600 {
				t.Fatal(st, err)
			}
		})
	}
}

func TestLogoutFailureDoesNotClaimRevocation100(t *testing.T) {
	s := testStore(t)
	sec, err := NewSecurity(s)
	if err != nil {
		t.Fatal(err)
	}
	if err = sec.Setup("audit", "synthetic-audit-password", sec.setupToken); err != nil {
		t.Fatal(err)
	}
	login := httptest.NewRecorder()
	if err = sec.CreateSession(login, httptest.NewRequest("POST", "/api/login", nil)); err != nil {
		t.Fatal(err)
	}
	cookie := login.Result().Cookies()[0]
	request := func() *http.Request {
		r := httptest.NewRequest("POST", "/api/logout", nil)
		r.AddCookie(cookie)
		_, csrf, _, _ := sec.Session(r)
		r.Header.Set("X-CSRF-Token", csrf)
		return r
	}
	if _, err = s.DB.Exec("CREATE TRIGGER deny_logout BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT,'synthetic failure'); END"); err != nil {
		t.Fatal(err)
	}
	server := &Server{Store: s, Security: sec}
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request())
	if response.Code != 500 || len(response.Result().Cookies()) != 0 {
		t.Fatal(response.Code, response.Body.String())
	}
	if _, _, valid, _ := sec.Session(request()); !valid {
		t.Fatal("unexpected session state")
	}
	if _, err = s.DB.Exec("DROP TRIGGER deny_logout"); err != nil {
		t.Fatal(err)
	}
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request())
	if response.Code != 200 {
		t.Fatal(response.Code, response.Body.String())
	}
	if _, _, valid, _ := sec.Session(request()); valid {
		t.Fatal("successful logout left session valid")
	}
}

func TestCatalogWaitDoesNotBlockConfig100(t *testing.T) {
	s := testStore(t)
	server := &Server{Store: s, settings: DefaultSettings()}
	s.recognitionMu.Lock()
	done := make(chan struct{})
	go func() {
		defer close(done)
		server.tagCatalogHTTP(httptest.NewRecorder(), httptest.NewRequest("DELETE", "/api/tag-catalog", strings.NewReader(`{"field":"codec","value":"x265"}`)))
	}()
	deadline := time.Now().Add(time.Second)
	for server.settingsMu.TryLock() {
		server.settingsMu.Unlock()
		if time.Now().After(deadline) {
			s.recognitionMu.Unlock()
			<-done
			t.Fatal("catalog handler did not start")
		}
		time.Sleep(time.Millisecond)
	}
	config := make(chan struct{})
	go func() { server.Config(); close(config) }()
	blocked := false
	select {
	case <-config:
	case <-time.After(time.Second):
		blocked = true
	}
	s.recognitionMu.Unlock()
	<-done
	<-config
	if blocked {
		t.Fatal("Config blocked behind a recognition writer")
	}
}

func TestLegacyMediaMatchCannotBypassEmbyFilter100(t *testing.T) {
	q := url.Values{"service": {"radarr"}, "embyMatch": {"invalid"}, "mediaMatch": {"1"}}
	if _, _, err := where(q); err == nil {
		t.Fatal("legacy parameter bypassed validation")
	}
	q.Set("embyMatch", "matched")
	filter, args, err := where(q)
	if err != nil || !strings.Contains(filter, "f.emby_match=?") || len(args) != 2 || args[1] != "matched" {
		t.Fatal(filter, args, err)
	}
}

func TestSonarrEpisodeIdentityAndSnapshotValidation100(t *testing.T) {
	for _, tc := range []struct {
		name, episodes string
		valid          bool
	}{
		{"negative", `[{"id":-7,"episodeFileId":10}]`, false},
		{"duplicate", `[{"id":7,"episodeFileId":10},{"id":7,"episodeFileId":10}]`, false},
		{"wrong series", `[{"id":7,"seriesId":999,"episodeFileId":10}]`, false},
		{"wrong file", `[{"id":7,"seriesId":1,"episodeFileId":999}]`, false},
		{"valid optional series and multi episode", `[{"id":7,"episodeFileId":10,"episodeNumber":1},{"id":8,"seriesId":1,"episodeFileId":10,"episodeNumber":2}]`, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/api/v3/series":
					w.Write([]byte(`[{"id":1,"title":"Synthetic series"}]`))
				case "/api/v3/series/1":
					w.Write([]byte(`{"id":1,"title":"Synthetic series"}`))
				case "/api/v3/episodefile":
					w.Write([]byte(`[{"id":10,"seriesId":1,"seasonNumber":1,"relativePath":"Example.S01E01.mkv","size":1000}]`))
				case "/api/v3/episode":
					w.Write([]byte(tc.episodes))
				default:
					http.NotFound(w, r)
				}
			}))
			defer upstream.Close()
			c := ServiceConfig{Enabled: true, URL: upstream.URL}
			for _, delta := range []bool{false, true} {
				var files []File
				var err error
				if delta {
					files, err = NewArr(c).FetchDelta(context.Background(), "sonarr", &DeltaScope{MediaID: 1, All: true})
				} else {
					files, err = NewArr(c).Fetch(context.Background(), "sonarr")
				}
				if tc.valid {
					if err != nil || len(files) != 1 || len(files[0].Episodes) != 2 {
						t.Fatal(delta, files, err)
					}
				} else if err == nil {
					t.Fatal("invalid episode response accepted", delta, files)
				}
			}
			if !tc.valid {
				s := testStore(t)
				if err := s.Replace("sonarr", []File{sample(77, "Previous.mkv")}, SyncStatus{}); err != nil {
					t.Fatal(err)
				}
				syncer := NewSyncer(s)
				defer syncer.Shutdown()
				if err := syncer.Start(context.Background(), "sonarr", c); err != nil {
					t.Fatal(err)
				}
				waitSync(t, syncer, "sonarr")
				result, err := s.Query(url.Values{"service": {"sonarr"}}, "matches", false)
				if err != nil || len(result.Files) != 1 || result.Files[0].ID != 77 {
					t.Fatal(result, err)
				}
			}
		})
	}
}

func TestCatalogReadsArePureCachedAndIsolated100(t *testing.T) {
	s := testStore(t)
	if err := s.Replace("radarr", []File{sample(1, "Example.1080p.x264.mkv")}, SyncStatus{}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec("CREATE TRIGGER deny_catalog_insert BEFORE INSERT ON display_tag_catalog BEGIN SELECT RAISE(ABORT,'unexpected GET write'); END; CREATE TRIGGER deny_catalog_update BEFORE UPDATE ON display_tag_catalog BEGIN SELECT RAISE(ABORT,'unexpected GET write'); END"); err != nil {
		t.Fatal(err)
	}
	first, err := s.TagCatalog(context.Background())
	if err != nil || len(first) == 0 {
		t.Fatal(first, err)
	}
	first[0].Value = "mutated"
	second, err := s.TagCatalog(context.Background())
	if err != nil || second[0].Value == "mutated" {
		t.Fatal(second, err)
	}
}

func TestSyncStatusAndCancellationDuringSnapshotWait100(t *testing.T) {
	s := testStore(t)
	if err := s.Replace("radarr", []File{sample(77, "Previous.mkv")}, SyncStatus{}); err != nil {
		t.Fatal(err)
	}
	fetching, release := make(chan struct{}), make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "/movie") {
			close(fetching)
			<-release
			w.Write([]byte(`[{"id":1,"title":"Replacement"}]`))
			return
		}
		w.Write([]byte(`[{"id":1,"movieId":1,"relativePath":"Replacement.mkv","size":1}]`))
	}))
	defer upstream.Close()
	syncer := NewSyncer(s)
	if err := syncer.Start(context.Background(), "radarr", ServiceConfig{Enabled: true, URL: upstream.URL}); err != nil {
		t.Fatal(err)
	}
	<-fetching
	tx, err := s.DB.Begin()
	if err != nil {
		close(release)
		syncer.Shutdown()
		t.Fatal(err)
	}
	close(release)
	deadline := time.Now().Add(time.Second)
	for s.recognitionMu.TryLock() {
		s.recognitionMu.Unlock()
		if time.Now().After(deadline) {
			tx.Rollback()
			syncer.Shutdown()
			t.Fatal("snapshot writer did not start")
		}
		time.Sleep(time.Millisecond)
	}
	responsive := make(chan struct{})
	go func() { syncer.Statuses(); syncer.Invalidate("radarr"); close(responsive) }()
	blocked := false
	select {
	case <-responsive:
	case <-time.After(time.Second):
		blocked = true
	}
	tx.Rollback()
	<-responsive
	syncer.Shutdown()
	if blocked {
		t.Fatal("status/invalidation waited for the database writer")
	}
	result, err := s.Query(url.Values{"service": {"radarr"}}, "matches", false)
	if err != nil || len(result.Files) != 1 || result.Files[0].ID != 77 {
		t.Fatal(result, err)
	}
}

func TestSnapshotGuardRollsBackAndReleasesInputs100(t *testing.T) {
	s := testStore(t)
	files := []File{sample(1, "Uncommitted.mkv")}
	err := s.replaceContext(context.Background(), "radarr", files, SyncStatus{}, true, nil, func(*sql.Tx) error { return context.Canceled })
	if !errors.Is(err, context.Canceled) || files[0].Filename != "" {
		t.Fatal(files, err)
	}
	result, err := s.Query(url.Values{"service": {"radarr"}}, "matches", false)
	if err != nil || result.Total != 0 {
		t.Fatal(result, err)
	}
}

func TestConcurrentRecognitionSnapshotDuringTagReconciliation100(t *testing.T) {
	s := testStore(t)
	fixture, upstream := newTagFixture(t, "radarr")
	fixture.mu.Lock()
	fixture.tags = map[int]string{}
	fixture.media = map[int][]int{10: {}}
	fixture.mu.Unlock()
	cfg := tagConfig(upstream)
	cfg.TagSyncMode = "add"
	f := sample(1, "Movie.1080p.x264.BluRay.mkv")
	f.MediaID = 10
	seedTags(t, s, "radarr", cfg, []File{f})
	var wg sync.WaitGroup
	for _, run := range []func() error{
		func() error {
			_, _, err := s.ReconcileTags(context.Background(), "radarr", cfg, func() bool { return true })
			return err
		},
		func() error {
			_, err := s.SaveCustomTags(context.Background(), []CustomTag{}, []CustomTag{})
			return err
		},
	} {
		wg.Add(1)
		go func(run func() error) {
			defer wg.Done()
			for i := 0; i < 30; i++ {
				if err := run(); err != nil {
					t.Error(err)
					return
				}
			}
		}(run)
	}
	wg.Wait()
}

func TestDisplaySettingsSaveDoesNotWaitForSyncGate100(t *testing.T) {
	s := testStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, err := NewServer(ctx, s, nil, "test")
	if err != nil {
		t.Fatal(err)
	}
	defer server.Sync.Shutdown()
	server.Sync.gate <- struct{}{}
	defer func() { <-server.Sync.gate }()
	cfg := server.Config()
	cfg.PageSize = 250
	body, _ := json.Marshal(cfg)
	request := httptest.NewRequest("PUT", "/api/settings", strings.NewReader(string(body)))
	response := httptest.NewRecorder()
	done := make(chan struct{})
	go func() { server.settingsHTTP(response, request); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("display save waited for a file/tag operation")
	}
	if response.Code != 200 || server.Config().PageSize != 250 {
		t.Fatal(response.Code, response.Body.String())
	}
}

func TestPasswordCheckCapacityRejectsExcessWork100(t *testing.T) {
	s := testStore(t)
	sec, err := NewSecurity(s)
	if err != nil {
		t.Fatal(err)
	}
	sec.passwordChecks <- struct{}{}
	sec.passwordChecks <- struct{}{}
	if hash := sec.loginHash("admin", "password", "excess"); hash != "" {
		t.Fatal(hash)
	}
	if len(sec.attempts) != 0 {
		t.Fatal("capacity rejection queued or consumed a password attempt")
	}
}

func TestRecognitionReadKeepsMatchingDataAndRules100(t *testing.T) {
	s := testStore(t)
	original := s.Recognition()
	tx, rules, err := s.beginRecognitionRead(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err = s.SaveRecognition(context.Background(), []RecognitionRule{}, original.Revision); err != nil {
		t.Fatal(err)
	}
	var raw string
	if err = tx.QueryRow("SELECT value FROM kv WHERE key='recognition'").Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var pinned RecognitionConfig
	if err = json.Unmarshal([]byte(raw), &pinned); err != nil {
		t.Fatal(err)
	}
	if pinned.Revision != original.Revision || len(rules) != len(original.Rules) || len(s.Recognition().Rules) != 0 {
		t.Fatal("rules and data did not share a snapshot")
	}
	old, err := displayTags(context.Background(), tx, rules)
	if err != nil || !containsString(old["resolution"], "1080p") {
		t.Fatal(old, err)
	}
	current, err := s.DisplayTags(context.Background())
	if err != nil || containsString(current["resolution"], "1080p") {
		t.Fatal(current, err)
	}
}

func TestAuthenticatedStatusRemainsResponsiveDuringSnapshotWrite100(t *testing.T) {
	s := testStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, err := NewServer(ctx, s, nil, "test")
	if err != nil {
		t.Fatal(err)
	}
	defer server.Sync.Shutdown()
	sec := server.Security
	if err = sec.Setup("audit", "synthetic-audit-password", sec.setupToken); err != nil {
		t.Fatal(err)
	}
	login := httptest.NewRecorder()
	if err = sec.CreateSession(login, httptest.NewRequest("POST", "/api/login", nil)); err != nil {
		t.Fatal(err)
	}
	revision := s.Recognition().Revision
	request := httptest.NewRequest("GET", "/api/status", nil)
	request.AddCookie(login.Result().Cookies()[0])
	response := httptest.NewRecorder()
	s.recognitionMu.Lock()
	tx, err := s.DB.Begin()
	if err != nil {
		s.recognitionMu.Unlock()
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { server.Handler().ServeHTTP(response, request); close(done) }()
	blocked := false
	select {
	case <-done:
	case <-time.After(time.Second):
		blocked = true
	}
	tx.Rollback()
	s.recognitionMu.Unlock()
	<-done
	if blocked {
		t.Fatal("authenticated status waited for snapshot recognition work")
	}
	var result struct {
		Authenticated       bool   `json:"authenticated"`
		RecognitionRevision string `json:"recognitionRevision"`
	}
	if err = json.Unmarshal(response.Body.Bytes(), &result); err != nil || response.Code != 200 || !result.Authenticated || result.RecognitionRevision != revision {
		t.Fatal(result, response.Code, err)
	}
}

func TestLegacyQuestionMarkPathDoesNotInitializeEmptyAccount100(t *testing.T) {
	parent := t.TempDir()
	dir := filepath.Join(parent, "data?legacy")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "secret.key"), make([]byte, 32), 0600); err != nil {
		t.Fatal(err)
	}
	// Reproduce the pre-1.0 DSN with its actual SQLite driver, rather than
	// fabricating a differently named database inside the intended directory.
	legacy, err := sql.Open("sqlite", filepath.Join(dir, "scopearr.db")+"?_pragma=foreign_keys(1)")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = legacy.Exec("CREATE TABLE kv(key TEXT PRIMARY KEY,value TEXT); INSERT INTO kv VALUES('admin','existing-account')"); err != nil {
		legacy.Close()
		t.Fatal(err)
	}
	legacy.Close()
	store, err := OpenStore(dir)
	if err == nil {
		store.DB.Close()
		t.Fatal("legacy account was hidden by a fresh database")
	}
	if _, err = os.Stat(filepath.Join(dir, "scopearr.db")); !os.IsNotExist(err) {
		t.Fatal("a new database was created", err)
	}
	legacy, err = sql.Open("sqlite", filepath.Join(parent, "data"))
	if err != nil {
		t.Fatal(err)
	}
	defer legacy.Close()
	var account string
	if err = legacy.QueryRow("SELECT value FROM kv WHERE key='admin'").Scan(&account); err != nil || account != "existing-account" {
		t.Fatal(account, err)
	}
}
