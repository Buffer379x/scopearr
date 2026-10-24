package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestMediaSyncMatchStatus142(t *testing.T) {
	store := testStore(t)
	arr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v3/moviefile" {
			w.Write([]byte(`[{"id":1,"movieId":1,"relativePath":"Match.mkv","size":100}]`))
		} else {
			w.Write([]byte(`[{"id":1,"title":"Match","year":2026}]`))
		}
	}))
	defer arr.Close()
	var fail atomic.Bool
	entered := make(chan struct{}, 4)
	gate := make(chan struct{}, 4)
	media := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			t.Error("media enrichment wrote upstream")
		}
		entered <- struct{}{}
		select {
		case <-gate:
		case <-r.Context().Done():
			return
		}
		if fail.Load() {
			http.Error(w, "failure", 500)
			return
		}
		w.Write([]byte(`{"TotalRecordCount":1,"Items":[{"Id":"m1","Type":"Movie","Path":"/library/Match.mkv","MediaSources":[{"Id":"s1","Path":"/library/Match.mkv","Size":100,"MediaStreams":[{"Type":"Audio","Index":1,"Codec":"aac","Language":"eng"}]}]}]}`))
	}))
	defer media.Close()
	cfg := DefaultSettings()
	cfg.Instances = []ServiceConfig{{ID: "radarr", Type: "radarr", Enabled: true, URL: arr.URL}, {ID: "radarr-4k", Type: "radarr", Enabled: true, URL: arr.URL}, {ID: "emby", Type: "emby", Enabled: true, URL: media.URL}}
	if e := store.Put("settings", cfg); e != nil {
		t.Fatal(e)
	}
	syncer := NewSyncer(store)
	defer syncer.Shutdown()
	for _, id := range []string{"radarr", "radarr-4k"} {
		if e := syncer.Start(context.Background(), id, cfg.GetService(id), cfg.MediaInstancesFor(id)...); e != nil {
			t.Fatal(e)
		}
	}
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("enrichment did not start")
	}
	if !syncer.Statuses()["emby"].Running {
		t.Fatal("media card is not running while a source enriches")
	}
	gate <- struct{}{}
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("second source did not start")
	}
	if !syncer.Statuses()["emby"].Running {
		t.Fatal("media running ended before last source")
	}
	gate <- struct{}{}
	syncer.wg.Wait()
	status := syncer.Statuses()["emby"]
	if status.Running || status.LastSuccess == nil || status.Count != 2 || status.Error != "" {
		t.Fatal("successful match status", status)
	}
	last := *status.LastSuccess
	persisted := NewSyncer(store)
	if st := persisted.Statuses()["emby"]; st.LastSuccess == nil || !st.LastSuccess.Equal(last) || st.Count != 2 {
		t.Fatal("match status not durable", st)
	}
	persisted.Shutdown()
	fail.Store(true)
	if e := syncer.Start(context.Background(), "radarr", cfg.GetService("radarr"), cfg.MediaInstancesFor("radarr")...); e != nil {
		t.Fatal(e)
	}
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("failed enrichment did not start")
	}
	gate <- struct{}{}
	syncer.wg.Wait()
	status = syncer.Statuses()["emby"]
	if status.Running || status.Error == "" || status.Count != 2 || status.LastSuccess == nil || !status.LastSuccess.Equal(last) {
		t.Fatal("failed match destroyed previous success", status)
	}
}

func TestMediaSyncSourceRemoval142(t *testing.T) {
	m := NewSyncer(testStore(t))
	defer m.Shutdown()
	m.mediaCounts["emby"] = map[string]int{"radarr": 2, "radarr-4k": 3}
	m.status["radarr-4k"] = SyncStatus{Running: true}
	cfg := DefaultSettings()
	cfg.Instances = []ServiceConfig{{ID: "radarr", Type: "radarr", Enabled: true}, {ID: "emby", Type: "emby", Enabled: true}}
	m.ConfigureMedia(cfg)
	if st := m.Statuses()["emby"]; st.Running || st.Count != 2 {
		t.Fatal("removed source still affects provider", st)
	}
}
