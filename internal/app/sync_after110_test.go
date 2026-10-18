package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestMediaTagsAfterManualImportLibrarySync110(t *testing.T) {
	for _, outbound := range []bool{false, true} {
		store := testStore(t)
		cfg := DefaultSettings()
		cfg.Instances = []ServiceConfig{
			{ID: "radarr-hd", Type: "radarr", Enabled: true, TagImport: true, TagImportInterval: 0, TagSync: TagGroups{Codec: outbound}},
			{ID: "emby-home", Type: "emby", Enabled: true, TagSync: TagGroups{Codec: true}},
			{ID: "jellyfin-off", Type: "jellyfin", Enabled: false, TagSync: TagGroups{Codec: true}},
		}
		writer := &TagWriter{store: store, config: func() Settings { return cfg }, ctx: context.Background(), events: make(chan string, 8), generations: map[string]int{}, status: map[string]TagSyncStatus{}}
		server := &Server{Store: store, settings: cfg, Tags: writer}
		server.afterLibrarySync("radarr-hd")
		states := writer.Statuses()
		if !states["emby-home"].Pending || states["jellyfin-off"].Pending {
			t.Fatalf("media delivery: %+v", states)
		}
		if states["radarr-hd"].Pending != outbound {
			t.Fatalf("manual import must remain manual unless outbound groups are active: %+v", states)
		}
	}
}

func TestSuccessfulManualImportSyncCallsAfterSync110(t *testing.T) {
	store := testStore(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/v3/movie" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
			http.Error(w, "unexpected", 500)
			return
		}
		_, _ = w.Write([]byte("[]"))
	}))
	defer upstream.Close()
	syncer := NewSyncer(store)
	defer syncer.Shutdown()
	completed := make(chan string, 1)
	syncer.AfterSync = func(id string) { completed <- id }
	if err := syncer.Start(context.Background(), "radarr-hd", ServiceConfig{ID: "radarr-hd", Type: "radarr", Enabled: true, URL: upstream.URL, TagImport: true, TagImportInterval: 0}); err != nil {
		t.Fatal(err)
	}
	select {
	case id := <-completed:
		if id != "radarr-hd" {
			t.Fatal(id)
		}
	case <-time.After(3 * time.Second):
		t.Fatalf("successful snapshot skipped callback: %+v", syncer.Statuses())
	}
}
