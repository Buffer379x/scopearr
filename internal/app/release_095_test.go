package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestMediaLinkIdentity095(t *testing.T) {
	for _, service := range []string{"radarr", "sonarr"} {
		for _, provider := range []string{"emby", "jellyfin"} {
			t.Run(service+"/"+provider, func(t *testing.T) {
				item := embyItem{Id: "movie123", ServerId: "server456", SeriesId: "series789", Type: "Movie", MediaSources: []embySource{{Path: "/media/Example.mkv", Size: 1234, MediaStreams: []embyStream{{Type: "Audio", Index: 1, Language: "eng", Codec: "aac", Channels: 2, ChannelLayout: "stereo"}}}}}
				if service == "sonarr" {
					item.Type = "Episode"
				}
				duplicate := 0
				upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.Method != "GET" || (r.URL.Path != "/Items" && r.URL.Path != "/emby/Items") || r.Header.Get("X-Emby-Token") != "synthetic" {
						t.Error("unexpected request", r.Method, r.URL.Path)
						http.Error(w, "unsafe", 405)
						return
					}
					items := []embyItem{item}
					if duplicate > 0 {
						other := item
						other.Id = "other"
						other.SeriesId = "different-series"
						other.MediaSources = append([]embySource{}, item.MediaSources...)
						if duplicate == 2 {
							other.MediaSources[0].Path = "/other/Example.mkv"
						}
						items = append(items, other)
					}
					json.NewEncoder(w).Encode(map[string]any{"Items": items, "TotalRecordCount": len(items)})
				}))
				defer upstream.Close()
				client := NewEmby(ServiceConfig{URL: upstream.URL, APIKey: "synthetic"})
				if provider == "jellyfin" {
					client = NewJellyfin(ServiceConfig{URL: upstream.URL, APIKey: "synthetic"})
				}
				files := []File{sample(1, "Example.mkv")}
				files[0].Size = 1234
				if err := client.Enrich(context.Background(), service, files); err != nil {
					t.Fatal(err)
				}
				link := files[0].MediaServers.get(provider).Link
				want := "movie123"
				if service == "sonarr" {
					want = "series789"
				}
				if link == nil || link.ItemID != want || link.ServerID != "server456" {
					t.Fatal(link)
				}
				store := testStore(t)
				if err := store.Replace(service, files, SyncStatus{}); err != nil {
					t.Fatal(err)
				}
				cfg := store.recognition.Load().Config()
				cfg.Rules[0].Name += " changed"
				if _, err := store.SaveRecognition(context.Background(), cfg.Rules, cfg.Revision); err != nil {
					t.Fatal(err)
				}
				var raw string
				store.DB.QueryRow("SELECT data FROM files LIMIT 1").Scan(&raw)
				var restored File
				json.Unmarshal([]byte(raw), &restored)
				if !reflect.DeepEqual(restored.MediaServers.get(provider).Link, link) {
					t.Fatal("reprocessing lost link", restored)
				}
				duplicate = 1
				if err := client.Enrich(context.Background(), service, files); err != nil {
					t.Fatal(err)
				}
				if got := files[0].MediaServers.get(provider); got.Link != nil || got.Status != "matched" {
					t.Fatal("ambiguous route got link", got)
				}
				duplicate = 2
				if err := client.Enrich(context.Background(), service, files); err != nil {
					t.Fatal(err)
				}
				if got := files[0].MediaServers.get(provider); got.Link != nil || got.Status != "ambiguous" {
					t.Fatal("ambiguous identity got link", got)
				}
			})
		}
	}
}
func TestMediaLinkSafetyAndPool095(t *testing.T) {
	for _, id := range []string{"../movie", "x?id=1", "", "a b"} {
		if safeMediaID(id) {
			t.Fatal(id)
		}
	}
	if mediaLinkForItem(embyItem{Id: "movie1", ServerId: "server1"}, "sonarr") != nil {
		t.Fatal("episode ID used as series ID")
	}
	pool := newMediaPool()
	a := pool.intern(MediaMatch{Link: &MediaLink{ItemID: "one", ServerID: "server"}})
	b := pool.intern(MediaMatch{Link: &MediaLink{ItemID: "two", ServerID: "server"}})
	c := pool.intern(MediaMatch{Link: &MediaLink{ItemID: "one", ServerID: "server"}})
	if a.Link == b.Link || a.Link != c.Link {
		t.Fatal("link identities incorrectly pooled")
	}
	cfg := DefaultSettings()
	cfg.ListInfoOrder = []string{"metadata", "link", "recognition", "details"}
	cfg.ListInfoVisible = []string{"link", "details"}
	if err := normalizeListInfo(&cfg); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(cfg.ListInfoOrder, []string{"metadata", "link", "media", "recognition", "details", "mux"}) || !containsColumn(cfg.ListInfoVisible, "media") {
		t.Fatal(cfg)
	}
	cfg.Emby.Enabled = true
	if infoMask(cfg)&16 == 0 {
		t.Fatal("visible media icon omitted from sort")
	}
	cfg.Emby.Enabled = false
	if infoMask(cfg)&16 != 0 {
		t.Fatal("disabled provider affects sort")
	}
}
