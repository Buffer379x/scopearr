package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
)

func TestInstanceSecretsFollowIdentity110(t *testing.T) {
	store := testStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, err := NewServer(ctx, store, nil, "1.1.0-test")
	if err != nil {
		t.Fatal(err)
	}
	defer server.Sync.Shutdown()
	cfg := DefaultSettings()
	cfg.Instances = []ServiceConfig{
		{ID: "radarr-aabbccdd", Type: "radarr", Name: "HD", URL: "http://127.0.0.1:7878", APIKey: "synthetic-hd-key"},
		{ID: "radarr-eeff0011", Type: "radarr", Name: "UHD", URL: "http://127.0.0.1:7879", APIKey: "synthetic-uhd-key"},
	}
	server.mu.Lock()
	server.settings = cfg
	server.mu.Unlock()
	// A masked GET must operate on a copy, never clear the live slice's keys.
	get := httptest.NewRecorder()
	server.settingsHTTP(get, httptest.NewRequest("GET", "/api/settings", nil))
	if get.Code != 200 || strings.Contains(get.Body.String(), "synthetic-") {
		t.Fatal("GET leaked an API key", get.Code)
	}
	var draft Settings
	if err = json.Unmarshal(get.Body.Bytes(), &draft); err != nil {
		t.Fatal(err)
	}
	if draft.Instances[0].APIKey != "" || !draft.Instances[0].HasKey {
		t.Fatal("incorrect masked connection")
	}
	draft.Instances[0], draft.Instances[1] = draft.Instances[1], draft.Instances[0]
	draft.Instances[0].Name = "4K movies"
	raw, _ := json.Marshal(draft)
	put := httptest.NewRecorder()
	server.settingsHTTP(put, httptest.NewRequest("PUT", "/api/settings", bytes.NewReader(raw)))
	if put.Code != 200 {
		t.Fatal(put.Code, put.Body.String())
	}
	actual := server.Config()
	want := map[string]string{"radarr-aabbccdd": "synthetic-hd-key", "radarr-eeff0011": "synthetic-uhd-key"}
	for _, c := range actual.Instances {
		if c.APIKey != want[c.ID] {
			t.Fatal("key moved or changed for", c.ID)
		}
	}
	var persisted Settings
	if err = store.Get("settings", &persisted); err != nil {
		t.Fatal(err)
	}
	for _, c := range persisted.Instances {
		if c.APIKey == want[c.ID] || c.APIKey == "" {
			t.Fatal("key was not encrypted", c.ID)
		}
		opened, e := server.Security.Open(c.APIKey)
		if e != nil || opened != want[c.ID] {
			t.Fatal("encrypted key no longer belongs to instance", c.ID, e)
		}
	}
}

func TestMultiInstanceBulkAndPresetIsolation110(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	const hd, uhd = "radarr-aabbccdd", "radarr-eeff0011"
	a, b := sample(7, "Same.1080p.x264.mkv"), sample(7, "Same.2160p.x265.mkv")
	for _, entry := range []struct {
		id   string
		file File
	}{{hd, a}, {uhd, b}} {
		if err := store.Replace(entry.id, []File{entry.file}, SyncStatus{}); err != nil {
			t.Fatal(err)
		}
	}
	all := url.Values{"service": {"radarr"}}
	rows, err := store.Query(all, "matches", true)
	if err != nil || rows.Total != 2 {
		t.Fatal("same remote ID collided across instances", rows.Total, err)
	}
	tag, err := store.SaveCustomTag(ctx, CustomTag{Name: "Favorites"})
	if err != nil {
		t.Fatal(err)
	}
	key := strconv.FormatInt(tag.ID, 10)
	selected := url.Values{"service": {"radarr"}, "instance": {uhd}}
	if n, e := store.ApplyCustom(ctx, selected, map[string]bool{key: true}); e != nil || n != 1 {
		t.Fatal(n, e)
	}
	rows, err = store.Query(all, "matches", true)
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range rows.Files {
		if (len(file.Custom) == 1) != (file.Service == uhd) {
			t.Fatal("manual tag escaped its instance", file.Service)
		}
	}
	preset, _, err := store.SavePreset(ctx, Preset{Name: "4K instance", Service: "radarr", Query: selected.Encode()})
	if err != nil {
		t.Fatal(err)
	}
	parsed, _ := url.ParseQuery(preset.Query)
	if parsed.Get("instance") != uhd {
		t.Fatal("preset lost instance selection", preset.Query)
	}
	// A successful empty sync in HD must leave UHD files and assignments intact.
	if err = store.Replace(hd, nil, SyncStatus{}); err != nil {
		t.Fatal(err)
	}
	rows, err = store.Query(all, "matches", true)
	if err != nil || rows.Total != 1 || rows.Files[0].Service != uhd || len(rows.Files[0].Custom) != 1 {
		t.Fatal("instance replacement affected another cache", rows.Total, err)
	}
}

func TestOpenEntryUsesExactInstance110(t *testing.T) {
	store := testStore(t)
	const first, second = "radarr-aabbccdd", "radarr-eeff0011"
	for _, id := range []string{first, second} {
		f := sample(7, "Movie.mkv")
		f.TitleSlug = "movie-7"
		if err := store.Replace(id, []File{f}, SyncStatus{}); err != nil {
			t.Fatal(err)
		}
	}
	cfg := DefaultSettings()
	cfg.Instances = []ServiceConfig{{ID: first, Type: "radarr", Name: "HD", Enabled: true, URL: "https://hd.example.test/radarr"}, {ID: second, Type: "radarr", Name: "UHD", Enabled: true, URL: "https://uhd.example.test/arr"}}
	server := &Server{Store: store, settings: cfg}
	w := httptest.NewRecorder()
	server.openEntry(w, httptest.NewRequest("GET", "/api/open-entry?service="+second+"&mediaId=1", nil))
	if w.Code != 302 || w.Header().Get("Location") != "https://uhd.example.test/arr/movie/movie-7" {
		t.Fatal("link used another instance", w.Code, w.Header().Get("Location"))
	}
	if err := store.Put("sync:"+second, SyncStatus{Source: "a-different-endpoint"}); err != nil {
		t.Fatal(err)
	}
	w = httptest.NewRecorder()
	server.openEntry(w, httptest.NewRequest("GET", "/api/open-entry?service="+second+"&mediaId=1", nil))
	if w.Code != 409 {
		t.Fatal("stale mapping opened against another endpoint", w.Code)
	}
}
