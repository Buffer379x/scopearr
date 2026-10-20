package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

type tagFixture struct {
	auto        map[int][]int
	failDetails bool
	nullDetails bool
	failRules   bool

	mu                     sync.Mutex
	tags                   map[int]string
	media                  map[int][]int
	creates, writes, reads int
	failWrite              bool
	protected              map[int]bool
	service                string
}

func newTagFixture(t *testing.T, service string) (*tagFixture, *httptest.Server) {
	f := &tagFixture{tags: map[int]string{1: "manual", 2: "X264", 3: "obsolete", 4: "favorite"}, media: map[int][]int{10: {1, 2, 3, 4}, 20: {1}}, service: service, protected: map[int]bool{}}
	h := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if r.Header.Get("X-Api-Key") != "synthetic" {
			t.Error("missing tag authentication")
			w.WriteHeader(401)
			return
		}
		catalog, editor := "movie", "movie/editor"
		if service == "sonarr" {
			catalog, editor = "series", "series/editor"
		}
		if r.Method == "GET" {
			f.reads++
			if positiveTagPath(strings.TrimPrefix(r.URL.Path, "/api/v3/"), "tag/detail/") {
				var id int
				fmt.Sscanf(r.URL.Path, "/api/v3/tag/detail/%d", &id)
				label, ok := f.tags[id]
				if !ok {
					w.WriteHeader(404)
					return
				}
				refs := []int{}
				for mid, tags := range f.media {
					for _, tid := range tags {
						if tid == id {
							refs = append(refs, mid)
							break
						}
					}
				}
				key := "movieIds"
				if service == "sonarr" {
					key = "seriesIds"
				}
				extra := []int{}
				if f.protected[id] {
					extra = []int{42}
				}
				json.NewEncoder(w).Encode(map[string]any{"id": id, "label": label, key: refs, "importListIds": extra})
				return
			}
			if r.URL.Path == "/api/v3/tag/detail" {
				if f.nullDetails {
					json.NewEncoder(w).Encode(nil)
					return
				}
				if f.failDetails {
					w.WriteHeader(503)
					return
				}
				out := []map[string]any{}
				for id, label := range f.tags {
					refs := []int{}
					for mid, ids := range f.media {
						for _, tid := range ids {
							if tid == id {
								refs = append(refs, mid)
								break
							}
						}
					}
					autos := f.auto[id]
					if autos == nil {
						autos = []int{}
					}
					key := "movieIds"
					if service == "sonarr" {
						key = "seriesIds"
					}
					out = append(out, map[string]any{"id": id, "label": label, key: refs, "autoTagIds": autos})
				}
				json.NewEncoder(w).Encode(out)
				return
			}
			if r.URL.Path == "/api/v3/autotagging" {
				if f.failRules {
					w.WriteHeader(503)
					return
				}
				out := []map[string]any{}
				seen := map[int]bool{}
				for _, ids := range f.auto {
					for _, id := range ids {
						if !seen[id] {
							seen[id] = true
							out = append(out, map[string]any{"id": id, "name": fmt.Sprint("Auto rule ", id)})
						}
					}
				}
				json.NewEncoder(w).Encode(out)
				return
			}

			if positiveTagPath(strings.TrimPrefix(r.URL.Path, "/api/v3/"), catalog+"/") {
				var id int
				fmt.Sscanf(strings.TrimPrefix(r.URL.Path, "/api/v3/"+catalog+"/"), "%d", &id)
				tags, ok := f.media[id]
				if !ok {
					w.WriteHeader(404)
					return
				}
				json.NewEncoder(w).Encode(map[string]any{"id": id, "title": fmt.Sprint("Title", id), "tags": tags})
				return
			}

			switch r.URL.Path {
			case "/api/v3/tag":
				out := []arrTag{}
				for id, label := range f.tags {
					out = append(out, arrTag{id, label})
				}
				json.NewEncoder(w).Encode(out)
			case "/api/v3/" + catalog:
				out := []map[string]any{}
				for id, tags := range f.media {
					out = append(out, map[string]any{"id": id, "title": fmt.Sprint("Title", id), "year": 2020, "tags": tags})
				}
				json.NewEncoder(w).Encode(out)
			case "/api/v3/moviefile":
				out := []map[string]any{}
				for _, id := range r.URL.Query()["movieId"] {
					if id == "10" {
						out = append(out, map[string]any{"id": 1, "movieId": 10, "relativePath": "Movie.1080p.x264.BluRay.mkv", "size": 4000000000})
					}
				}
				json.NewEncoder(w).Encode(out)
			default:
				t.Errorf("unexpected GET %s", r.URL.Path)
				w.WriteHeader(400)
			}
			return
		}
		if r.Method == "DELETE" && positiveTagPath(strings.TrimPrefix(r.URL.Path, "/api/v3/"), "tag/") {
			var id int
			fmt.Sscanf(r.URL.Path, "/api/v3/tag/%d", &id)
			if f.protected[id] {
				w.WriteHeader(409)
				return
			}
			for _, tags := range f.media {
				for _, tid := range tags {
					if tid == id {
						t.Error("deleted used tag")
						w.WriteHeader(409)
						return
					}
				}
			}
			delete(f.tags, id)
			w.WriteHeader(200)
			return
		}
		if r.Method == "POST" && r.URL.Path == "/api/v3/tag" {
			var tag arrTag
			json.NewDecoder(r.Body).Decode(&tag)
			for _, label := range f.tags {
				if strings.EqualFold(label, tag.Label) {
					t.Error("duplicate tag created")
				}
			}
			tag.ID = 100 + f.creates
			f.creates++
			f.tags[tag.ID] = tag.Label
			w.WriteHeader(201)
			json.NewEncoder(w).Encode(tag)
			return
		}
		if r.Method == "PUT" && r.URL.Path == "/api/v3/"+editor {
			var body map[string]json.RawMessage
			json.NewDecoder(r.Body).Decode(&body)
			key := "movieIds"
			if service == "sonarr" {
				key = "seriesIds"
			}
			if len(body) != 4 || (string(body["applyTags"]) != `"replace"` && string(body["applyTags"]) != `"add"` && string(body["applyTags"]) != `"remove"`) || string(body["moveFiles"]) != "false" {
				t.Errorf("unsafe edit payload %s", body)
				w.WriteHeader(400)
				return
			}
			var ids, tags []int
			json.Unmarshal(body[key], &ids)
			json.Unmarshal(body["tags"], &tags)
			if body[key] == nil || len(ids) > 100 || body["tags"] == nil || string(body["tags"]) == "null" {
				t.Error("invalid tag batch")
			}
			for _, id := range ids {
				switch string(body["applyTags"]) {
				case `"replace"`:
					f.media[id] = append([]int{}, tags...)
				case `"add"`:
					for _, tag := range tags {
						found := false
						for _, old := range f.media[id] {
							found = found || old == tag
						}
						if !found {
							f.media[id] = append(f.media[id], tag)
						}
					}
				case `"remove"`:
					next := []int{}
					for _, old := range f.media[id] {
						drop := false
						for _, tag := range tags {
							drop = drop || old == tag
						}
						if !drop {
							next = append(next, old)
						}
					}
					f.media[id] = next
				}
			}
			f.writes++
			if f.failWrite {
				w.WriteHeader(503)
				return
			}
			w.WriteHeader(202)
			out := []taggedMedia{}
			for _, id := range ids {
				out = append(out, taggedMedia{ID: id, Tags: f.media[id]})
			}
			json.NewEncoder(w).Encode(out)
			return
		}
		t.Errorf("forbidden upstream mutation %s %s", r.Method, r.URL.Path)
		w.WriteHeader(400)
	}))
	t.Cleanup(h.Close)
	return f, h
}
func (f *tagFixture) names(id int) []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := []string{}
	for _, tag := range f.media[id] {
		out = append(out, strings.ToLower(f.tags[tag]))
	}
	sort.Strings(out)
	return out
}
func tagConfig(h *httptest.Server) ServiceConfig {
	return ServiceConfig{Enabled: true, URL: h.URL, APIKey: "synthetic", TagSync: TagGroups{Resolution: true, Codec: true, Custom: true}}
}
func seedTags(t *testing.T, s *Store, service string, c ServiceConfig, files []File) {
	t.Helper()
	now := time.Now()
	if err := s.Replace(service, files, SyncStatus{LastSuccess: &now, Source: tagEndpoint(c)}); err != nil {
		t.Fatal(err)
	}
}
func approveFixturePlan(t *testing.T, s *Store, service string, c ServiceConfig) {
	t.Helper()
	p, e := s.BuildTagPlan(context.Background(), service, c, nil)
	if e != nil {
		t.Fatal(e)
	}
	if p.Preview.ApprovalRequired {
		if e = s.ApproveTagPlan(context.Background(), p); e != nil {
			t.Fatal(e)
		}
	}
}
func reconcile(t *testing.T, s *Store, service string, c ServiceConfig) {
	t.Helper()
	approveFixturePlan(t, s, service, c)
	if _, wait, err := s.ReconcileTags(context.Background(), service, c, func() bool { return true }); err != nil || wait {
		t.Fatal(wait, err)
	}
}
func TestOutboundTagsAuthorityReuseCustomRemovalAndOptOut(t *testing.T) {
	s := testStore(t)
	f, h := newTagFixture(t, "radarr")
	c := tagConfig(h)
	file := sample(1, "Movie.1080p.x264.BluRay.mkv")
	file.MediaID = 10
	seedTags(t, s, "radarr", c, []File{file})
	tag, _ := s.SaveCustomTag(context.Background(), CustomTag{Name: "Favorite"})
	q := url.Values{"service": {"radarr"}}
	if _, err := s.ApplyCustom(context.Background(), q, map[string]bool{fmt.Sprint(tag.ID): true}); err != nil {
		t.Fatal(err)
	}
	reconcile(t, s, "radarr", c)
	if got := fmt.Sprint(f.names(10)); got != "[1080p favorite x264]" {
		t.Fatal(got)
	}
	if len(f.names(20)) != 0 {
		t.Fatal("pre-existing assignments retained")
	}
	creates, writes := f.creates, f.writes
	reconcile(t, s, "radarr", c)
	if f.creates != creates || f.writes != writes {
		t.Fatal("unchanged tags written again")
	}
	if _, err := s.ApplyCustom(context.Background(), q, map[string]bool{fmt.Sprint(tag.ID): false}); err != nil {
		t.Fatal(err)
	}
	reconcile(t, s, "radarr", c)
	if fmt.Sprint(f.names(10)) != "[1080p x264]" {
		t.Fatal(f.names(10))
	}
	c.TagSync.Codec = false
	reconcile(t, s, "radarr", c)
	if fmt.Sprint(f.names(10)) != "[1080p]" {
		t.Fatal(f.names(10))
	}
	c.TagSync = TagGroups{}
	reconcile(t, s, "radarr", c)
	if len(f.names(10)) != 0 {
		t.Fatal("opt-out did not clear adopted tags")
	}
	before := f.reads
	reconcile(t, s, "radarr", c)
	if f.reads != before {
		t.Fatal("disabled sync called upstream")
	}
	if len(f.tags) != 0 {
		t.Fatal("unused definitions were retained")
	}
}
func TestOutboundSeriesTagsUnionAndEndpointIsolation(t *testing.T) {
	s := testStore(t)
	f, h := newTagFixture(t, "sonarr")
	c := tagConfig(h)
	c.TagSync.Source = true
	a := sample(1, "Episode.1080p.x264.BluRay.Remux.mkv")
	b := sample(2, "Episode.2160p.x265.WEB-DL.mkv")
	a.MediaID = 10
	b.MediaID = 10
	a.Service = "sonarr"
	b.Service = "sonarr"
	seedTags(t, s, "sonarr", c, []File{a, b})
	reconcile(t, s, "sonarr", c)
	if got := fmt.Sprint(f.names(10)); got != "[1080p 2160p bluray remux web-dl x264 x265]" {
		t.Fatal(got)
	}
	f2, h2 := newTagFixture(t, "sonarr")
	c2 := tagConfig(h2)
	if _, wait, err := s.ReconcileTags(context.Background(), "sonarr", c2, func() bool { return true }); err != nil || !wait {
		t.Fatal(wait, err)
	}
	if f2.reads != 0 {
		t.Fatal("stale cache used against another endpoint")
	}
	c2.TagSync = TagGroups{}
	reconcile(t, s, "sonarr", c2)
	if f2.reads != 0 {
		t.Fatal("another endpoint's tags cleared")
	}
}
func TestOutboundIntentSurvivesAmbiguousResponseAndRestart(t *testing.T) {
	s := testStore(t)
	f, h := newTagFixture(t, "radarr")
	c := tagConfig(h)
	a := sample(1, "Movie.1080p.x264.mkv")
	a.MediaID = 10
	seedTags(t, s, "radarr", c, []File{a})
	approveFixturePlan(t, s, "radarr", c)
	f.failWrite = true
	if _, _, err := s.ReconcileTags(context.Background(), "radarr", c, func() bool { return true }); err == nil {
		t.Fatal("write failure ignored")
	}
	dir := s.Dir
	s.DB.Close()
	restored, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.DB.Close()
	f.failWrite = false
	c.TagSync = TagGroups{}
	reconcile(t, restored, "radarr", c)
	if len(f.names(10)) != 0 || len(f.names(20)) != 0 {
		t.Fatal("durable cleanup intent lost")
	}
}
func TestOutboundAfterFileSyncAndFailedWritesKeepCache(t *testing.T) {
	store := testStore(t)
	f, h := newTagFixture(t, "radarr")
	c := tagConfig(h)
	f.failWrite = true
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, err := NewServer(ctx, store, nil, "0.5.1")
	if err != nil {
		t.Fatal(err)
	}
	defer server.Sync.Shutdown()
	server.mu.Lock()
	server.settings.Radarr = c
	server.mu.Unlock()
	server.Tags.Queue("radarr")
	time.Sleep(40 * time.Millisecond)
	if f.reads != 0 {
		t.Fatal("tag sync ran before the first complete snapshot")
	}
	if err = server.Sync.Start(ctx, "radarr", c); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if server.Tags.Statuses()["radarr"].ApprovalRequired {
			approveFixturePlan(t, store, "radarr", c)
			server.Tags.Queue("radarr")
		}
		if server.Tags.Statuses()["radarr"].Error != "" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if server.Tags.Statuses()["radarr"].Error == "" {
		t.Fatal("failed tag sync not reported")
	}
	state := server.Sync.Statuses()["radarr"]
	if state.Error != "" || state.Count != 1 || state.LastSuccess == nil {
		t.Fatal("tag failure destroyed file sync", state)
	}
	out, err := store.Query(url.Values{"service": {"radarr"}}, "matches", true)
	if err != nil || out.Total != 1 {
		t.Fatal(out.Total, err)
	}
	f.mu.Lock()
	f.failWrite = false
	f.mu.Unlock()
	server.Tags.Queue("radarr")
	for time.Now().Before(deadline) {
		state := server.Tags.Statuses()["radarr"]
		if !state.Pending && state.LastSuccess != nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if server.Tags.Statuses()["radarr"].Pending {
		t.Fatal("retry did not finish")
	}
	if err = NewArr(c).writeTags(ctx, "command", "POST", map[string]any{}, nil); err == nil {
		t.Fatal("command write allowed")
	}
}
