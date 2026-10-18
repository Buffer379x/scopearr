package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"unsafe"
)

func TestInstanceIdentityValidation110(t *testing.T) {
	valid := []ServiceConfig{{ID: "radarr-hd", Type: "radarr", Name: " HD "}, {ID: "radarr-uhd", Type: "radarr"}, {ID: "emby-home", Type: "emby", SourceIDs: "radarr-uhd,radarr-hd"}}
	cfg := DefaultSettings()
	cfg.Instances = valid
	if e := normalizeSettings(&cfg); e != nil {
		t.Fatal(e)
	}
	if cfg.Instances[0].Name != "HD" || cfg.Instances[2].SourceIDs != "radarr-hd,radarr-uhd" {
		t.Fatal(cfg.Instances)
	}
	cases := [][]ServiceConfig{
		{{ID: "radarr-hd", Type: "sonarr"}}, {{ID: "radarr-../x"}}, {{ID: "radarr-hd"}, {ID: "radarr-hd"}},
		{{ID: "radarr-hd"}, {ID: "emby-home", SourceIDs: "radarr-missing"}}, {{ID: "radarr-hd", SourceIDs: "radarr-hd"}},
		{{ID: "radarr-hd", Name: "bad\nname"}},
		{{ID: "emby-a", Enabled: true, URL: "http://same.test/"}, {ID: "emby-b", Enabled: true, URL: "http://same.test"}},
		{{ID: "emby-a", Enabled: true, URL: "https://same.test"}, {ID: "emby-b", Enabled: true, URL: "https://SAME.test:443/emby/"}},
		{{ID: "radarr-a", Enabled: true, URL: "http://same.test"}, {ID: "radarr-b", Enabled: true, URL: "http://SAME.test:80/"}},
	}
	for _, items := range cases {
		next := DefaultSettings()
		next.Instances = items
		if e := normalizeSettings(&next); e == nil {
			t.Fatal("accepted invalid instances", items)
		}
	}
}

func TestInstanceSeasonIsolation110(t *testing.T) {
	s := testStore(t)
	for _, id := range []string{"sonarr-hd", "sonarr-uhd"} {
		files := []File{}
		for n := 1; n <= 3; n++ {
			f := sample(n, "Episode.mkv")
			f.APIInfo = nil
			f.Evidence = nil
			f.MediaID = 4
			f.Series = "Same series"
			f.Season = 1
			f.Resolution = "1080p"
			if id == "sonarr-uhd" {
				f.Resolution = "2160p"
			}
			f.Episodes = []Episode{{ID: n, Number: n}}
			files = append(files, f)
		}
		if e := s.Replace(id, files, SyncStatus{}); e != nil {
			t.Fatal(e)
		}
	}
	q := url.Values{"service": {"sonarr"}, "resolution": {"1080p"}}
	out, e := s.Query(q, "season", false)
	if e != nil || out.Total != 3 || out.DisplayTotal != 3 || len(out.Files) != 3 {
		t.Fatal(out, e)
	}
	for _, f := range out.Files {
		if f.Service != "sonarr-hd" || f.SeasonOutlier {
			t.Fatal("season context mixed instances", f.Service)
		}
	}
	stats, e := s.StatisticsContext(context.Background())
	if e != nil || stats.Series != 2 || stats.Episodes != 6 {
		t.Fatal("counts collapsed same numeric IDs", stats, e)
	}
	q = url.Values{"service": {"sonarr"}, "instance": {"sonarr-uhd"}}
	out, e = s.Query(q, "matches", true)
	if e != nil || out.Total != 3 {
		t.Fatal(out.Total, e)
	}
}

func TestDisabledInstanceHiddenAndExactReplacement110(t *testing.T) {
	s := testStore(t)
	a, b := sample(1, "A.1080p.mkv"), sample(1, "B.2160p.mkv")
	if e := s.Replace("radarr-a", []File{a}, SyncStatus{}); e != nil {
		t.Fatal(e)
	}
	if e := s.Replace("radarr-b", []File{b}, SyncStatus{}); e != nil {
		t.Fatal(e)
	}
	cfg := DefaultSettings()
	cfg.Instances = []ServiceConfig{{ID: "radarr-a", Type: "radarr", Enabled: true}, {ID: "radarr-b", Type: "radarr"}}
	if e := s.Put("settings", cfg); e != nil {
		t.Fatal(e)
	}
	out, e := s.Query(url.Values{"service": {"radarr"}}, "matches", true)
	if e != nil || out.Total != 1 || out.Files[0].Service != "radarr-a" {
		t.Fatal(out, e)
	}
	facets, e := s.FacetsContext(context.Background(), "radarr")
	if e != nil || len(facets["resolution"]) != 1 || facets["resolution"][0] != "1080p" {
		t.Fatal(facets, e)
	}
	stats, e := s.StatisticsContext(context.Background())
	if e != nil || stats.Movies != 1 {
		t.Fatal(stats, e)
	}
	var all int
	if e = s.DB.QueryRow("SELECT count(*) FROM files").Scan(&all); e != nil || all != 2 {
		t.Fatal("disabled cache deleted", all, e)
	}
}

func TestLegacyInstanceMigration110(t *testing.T) {
	s := testStore(t)
	sec, e := NewSecurity(s)
	if e != nil {
		t.Fatal(e)
	}
	cfg := DefaultSettings()
	sealed := sec.Seal("synthetic-key")
	cfg.Radarr.APIKey = sealed
	cfg.Radarr.URL = "https://arr.example.test/radarr"
	cfg.TagColors["codec:x264"] = "#aabbcc"
	if e = s.Put("settings", cfg); e != nil {
		t.Fatal(e)
	}
	if e = s.Put("webhook-key:radarr", sec.Seal("synthetic-hook")); e != nil {
		t.Fatal(e)
	}
	if e = s.Replace("radarr", []File{sample(1, "Legacy.mkv")}, SyncStatus{}); e != nil {
		t.Fatal(e)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, e := NewServer(ctx, s, nil, "1.1.0-test")
	if e != nil {
		t.Fatal(e)
	}
	defer server.Sync.Shutdown()
	var persisted Settings
	if e = s.Get("settings", &persisted); e != nil {
		t.Fatal(e)
	}
	if persisted.Instances == nil || persisted.GetService("radarr").APIKey != sealed || server.Config().GetService("radarr").APIKey != "synthetic-key" {
		t.Fatal("migration failed to preserve sealed key")
	}
	if persisted.TagColors["codec:x264"] != "#aabbcc" {
		t.Fatal("lost colors")
	}
	var hook string
	if e = s.Get("webhook-key:radarr", &hook); e != nil {
		t.Fatal(e)
	}
	if value, e := sec.Open(hook); e != nil || value != "synthetic-hook" {
		t.Fatal("lost webhook identity", e)
	}
	backups, e := os.ReadDir(filepath.Join(s.Dir, "backups"))
	if e != nil || len(backups) != 1 {
		t.Fatal("no consistent migration backup", e)
	}
	var count int
	s.DB.QueryRow("SELECT count(*) FROM files WHERE service='radarr'").Scan(&count)
	if count != 1 {
		t.Fatal("legacy namespace changed")
	}
}

func TestMultipleMediaMatchesRoundTrip110(t *testing.T) {
	f := File{}
	f.setMediaMatch("emby", MediaMatch{Status: "matched", ItemID: "1"})
	f.setMediaMatch("emby-home", MediaMatch{Status: "matched", ItemID: "2"})
	f.setMediaMatch("jellyfin-home", MediaMatch{Status: "missing"})
	raw, e := json.Marshal(f)
	if e != nil {
		t.Fatal(e)
	}
	var out File
	if e = json.Unmarshal(raw, &out); e != nil {
		t.Fatal(e)
	}
	if out.MediaServers.count() != 3 || out.MediaServers.Emby == nil || out.MediaServers.get("emby-home").ItemID != "2" {
		t.Fatal("provider instance overwritten", string(raw))
	}
}

func TestInstancePreviewCredentialsAndLegacyWriteGuard110(t *testing.T) {
	store := testStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, e := NewServer(ctx, store, nil, "test")
	if e != nil {
		t.Fatal(e)
	}
	defer server.Sync.Shutdown()
	cfg := DefaultSettings()
	cfg.Instances = []ServiceConfig{{ID: "radarr-hd", Type: "radarr", Name: "HD", URL: "https://hd.example.test", APIKey: "synthetic"}}
	server.mu.Lock()
	server.settings = cfg
	server.mu.Unlock()
	legacy := DefaultSettings()
	raw, _ := json.Marshal(legacy)
	response := httptest.NewRecorder()
	server.settingsHTTP(response, httptest.NewRequest("PUT", "/api/settings", bytes.NewReader(raw)))
	if response.Code != 409 || server.Config().GetService("radarr-hd").APIKey != "synthetic" {
		t.Fatal("stale frontend removed named instance", response.Code)
	}
}

func TestInstanceAutoTagSelectionProtection110(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	for _, id := range []string{"radarr-hd", "radarr-uhd"} {
		if e := s.Replace(id, []File{sample(1, "Movie.mkv")}, SyncStatus{}); e != nil {
			t.Fatal(e)
		}
	}
	tag, e := s.SaveCustomTag(ctx, CustomTag{Name: "Auto"})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.DB.Exec("INSERT INTO external_tag_defs VALUES(?,?,?,?,?,?)", "radarr-uhd", "endpoint", 3, tag.ID, "auto", `["UHD rule"]`); e != nil {
		t.Fatal(e)
	}
	for _, tc := range []struct {
		instance  string
		protected bool
	}{{"", true}, {"radarr-hd", false}, {"radarr-uhd", true}} {
		q := url.Values{"service": {"radarr"}}
		if tc.instance != "" {
			q.Set("instance", tc.instance)
		}
		out, e := s.CustomSelection(ctx, q)
		if e != nil {
			t.Fatal(e)
		}
		if len(out.Tags) != 1 || out.Tags[0].Protected != tc.protected {
			t.Fatal("auto tag protection escaped scope", tc.instance, out.Tags)
		}
	}
}

func TestDisabledInstanceTagWriterPreservesIntent110(t *testing.T) {
	s := testStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	cfg := DefaultSettings()
	cfg.Instances = []ServiceConfig{{ID: "emby-disabled", Type: "emby", URL: "http://unreachable.invalid", TagSync: TagGroups{Resolution: true}}}
	w := NewTagWriter(ctx, s, func() Settings { return cfg }, make(chan struct{}, 1))
	defer w.Close()
	if e := s.Put("tagSyncDirty:emby-disabled", true); e != nil {
		t.Fatal(e)
	}
	w.apply("emby-disabled")
	var dirty bool
	s.Get("tagSyncDirty:emby-disabled", &dirty)
	st := w.Statuses()["emby-disabled"]
	if !dirty || st.Running || st.Pending || st.Error != "" {
		t.Fatal("disabled writer lost intent or attempted a connection", dirty, st)
	}
}

func TestInstanceDisableThenRemoveLocalCache110(t *testing.T) {
	store := testStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, e := NewServer(ctx, store, nil, "test")
	if e != nil {
		t.Fatal(e)
	}
	defer server.Sync.Shutdown()
	const first, second = "radarr-hd", "radarr-uhd"
	cfg := DefaultSettings()
	cfg.Instances = []ServiceConfig{{ID: first, Type: "radarr", Enabled: true, URL: "https://hd.example.test", APIKey: "synthetic", TagSyncDisable: "delete"}, {ID: second, Type: "radarr", Enabled: true, URL: "https://uhd.example.test", APIKey: "synthetic"}}
	server.mu.Lock()
	server.settings = cfg
	server.mu.Unlock()
	for _, id := range []string{first, second} {
		if e = store.Replace(id, []File{sample(1, "Movie.1080p.mkv")}, SyncStatus{}); e != nil {
			t.Fatal(e)
		}
	}
	tag, e := store.SaveCustomTag(ctx, CustomTag{Name: "Keep definition"})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = store.ApplyCustom(ctx, url.Values{"service": {"radarr"}}, map[string]bool{strconv.FormatInt(tag.ID, 10): true}); e != nil {
		t.Fatal(e)
	}
	if e = store.Put("tagSyncDirty:"+first, false); e != nil {
		t.Fatal(e)
	}
	save := func(next Settings) {
		t.Helper()
		raw, _ := json.Marshal(next)
		w := httptest.NewRecorder()
		server.settingsHTTP(w, httptest.NewRequest("PUT", "/api/settings", bytes.NewReader(raw)))
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	next := server.Config()
	next.Instances[0].Enabled = false
	save(next)
	var dirty bool
	store.Get("tagSyncDirty:"+first, &dirty)
	if dirty {
		t.Fatal("disabling a cleaned service recreated pending cleanup")
	}
	// General custom/rule edits must not make disabled connections dirty again.
	server.queueTagSync()
	store.Get("tagSyncDirty:"+first, &dirty)
	if dirty {
		t.Fatal("unrelated edits dirtied disabled service")
	}
	next = server.Config()
	next.Instances = next.Instances[1:]
	save(next)
	var n int
	store.DB.QueryRow("SELECT count(*) FROM files WHERE service=?", first).Scan(&n)
	if n != 0 {
		t.Fatal("orphan cache survived removal")
	}
	store.DB.QueryRow("SELECT count(*) FROM custom_overrides WHERE service=?", first).Scan(&n)
	if n != 0 {
		t.Fatal("orphan overrides survived removal")
	}
	store.DB.QueryRow("SELECT count(*) FROM files WHERE service=?", second).Scan(&n)
	if n != 1 {
		t.Fatal("another instance cache was deleted")
	}
	store.DB.QueryRow("SELECT count(*) FROM custom_tags WHERE id=?", tag.ID).Scan(&n)
	if n != 1 {
		t.Fatal("global tag definition was deleted")
	}
}

func TestCompactMediaMatchesWireAndReplacement110(t *testing.T) {
	f := File{}
	f.setMediaMatch("emby-home", MediaMatch{Status: "matched", ItemID: "first"})
	f.setMediaMatch("jellyfin-home", MediaMatch{Status: "matched", ItemID: "second"})
	f.setMediaMatch("emby", MediaMatch{Status: "matched", ItemID: "legacy"})
	before := f.MediaServers.get("jellyfin-home")
	f.setMediaMatch("emby-home", MediaMatch{Status: "pending", ItemID: "replacement"})
	if len(f.MediaServers.Instances) != 2 || f.MediaServers.count() != 3 || f.MediaServers.get("jellyfin-home") != before {
		t.Fatal("replacement duplicated or invalidated another match")
	}
	raw, e := json.Marshal(f.MediaServers)
	if e != nil {
		t.Fatal(e)
	}
	var wire map[string]MediaMatch
	if e = json.Unmarshal(raw, &wire); e != nil {
		t.Fatal(e)
	}
	if len(wire) != 3 || wire["emby-home"].ItemID != "replacement" || wire["emby"].ItemID != "legacy" {
		t.Fatal(string(raw))
	}
	var restored MediaMatches
	if e = json.Unmarshal(raw, &restored); e != nil {
		t.Fatal(e)
	}
	again, e := json.Marshal(&restored)
	if e != nil || string(again) != string(raw) {
		t.Fatal("wire shape or ordering changed", string(raw), string(again), e)
	}
	if e = json.Unmarshal([]byte(`{"emby-home":{"status":"old"},"unknown-provider":{},"emby-home":{"status":"new"}}`), &restored); e != nil || restored.count() != 1 || restored.get("emby-home").Status != "new" {
		t.Fatal("duplicate replacement or unknown instance handling changed", restored, e)
	}
}

func TestCompactMediaIdentityStorage110(t *testing.T) {
	item, source := strings.Clone("00000000000000000000000000000123"), strings.Clone("00000000000000000000000000000124")
	secondItem, secondSource := strings.Clone(item), strings.Clone(source)
	if unsafe.StringData(item) == unsafe.StringData(secondItem) || unsafe.StringData(source) == unsafe.StringData(secondSource) {
		t.Fatal("fixture strings were already shared")
	}
	f := File{}
	f.setMediaMatch("emby-home", MediaMatch{Status: "matched", ItemID: item, SourceID: source, Link: &MediaLink{ItemID: item, ServerID: "server"}})
	f.setMediaMatch("jellyfin-home", MediaMatch{Status: "matched", ItemID: secondItem, SourceID: secondSource, Link: &MediaLink{ItemID: secondItem, ServerID: "other-server"}})
	first, second := f.MediaServers.get("emby-home"), f.MediaServers.get("jellyfin-home")
	if unsafe.StringData(first.ItemID) != unsafe.StringData(second.ItemID) || unsafe.StringData(first.SourceID) != unsafe.StringData(second.SourceID) || unsafe.StringData(second.ItemID) != unsafe.StringData(second.Link.ItemID) {
		t.Fatal("identical targets retained duplicate string data")
	}
	if first.Link.ServerID == second.Link.ServerID || first.ItemID != item || first.SourceID != source {
		t.Fatal("independent target identities were changed")
	}
}
