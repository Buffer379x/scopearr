package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"unsafe"
)

type mediaTagFixture struct {
	mu            sync.Mutex
	kind, version string
	items         map[string]map[string]any
	writes        []string
	payloads      []map[string]json.RawMessage
	batchSizes    []int
	fail          bool
	lie           bool
}

func TestMediaTagsPoolSharesOnlyRepeatedServerIdentity(t *testing.T) {
	pool := newMediaPool()
	firstServer := strings.Clone("server-shared")
	secondServer := strings.Clone("server-shared")
	first := pool.intern(MediaMatch{ServerID: firstServer, ItemID: "episode1", SourceID: "source1", Link: &MediaLink{ItemID: "series1", ServerID: firstServer}})
	second := pool.intern(MediaMatch{ServerID: secondServer, ItemID: "episode2", SourceID: "source2", Link: &MediaLink{ItemID: "series2", ServerID: secondServer}})
	if unsafe.StringData(first.ServerID) != unsafe.StringData(second.ServerID) || unsafe.StringData(first.ServerID) != unsafe.StringData(second.Link.ServerID) {
		t.Fatal("repeated server IDs retain per-item allocations")
	}
	if first.ItemID != "episode1" || second.ItemID != "episode2" || first.SourceID != "source1" || second.SourceID != "source2" || first.Link == second.Link {
		t.Fatal("different write/UI targets were aliased")
	}
	for i := 0; i < 100; i++ {
		server := fmt.Sprint("other-server-", i)
		got := pool.intern(MediaMatch{ServerID: server, ItemID: fmt.Sprint("movie", i)})
		if got.ServerID != server {
			t.Fatal("distinct server identity changed")
		}
	}
	if len(pool.serverIDs) != 64 {
		t.Fatal("identity string pool is unbounded", len(pool.serverIDs))
	}
}

func newMediaTagFixture(t *testing.T, kind string) (*mediaTagFixture, *httptest.Server, ServiceConfig) {
	t.Helper()
	f := &mediaTagFixture{kind: kind, version: "4.10.1.0", items: map[string]map[string]any{}}
	if kind == "jellyfin" {
		f.version = "10.11.0"
	}
	h := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if r.Header.Get("X-Emby-Token") != "synthetic-media-key" || r.URL.Query().Has("api_key") {
			t.Error("unsafe media tag authentication")
			w.WriteHeader(401)
			return
		}
		base := "/proxy/"
		if kind == "emby" {
			base += "emby/"
		}
		path := strings.TrimPrefix(r.URL.Path, base)
		if path == r.URL.Path {
			t.Errorf("wrong media base path %s", r.URL.Path)
			w.WriteHeader(400)
			return
		}
		if r.Method == http.MethodGet {
			switch path {
			case "System/Info":
				json.NewEncoder(w).Encode(map[string]any{"Id": "server1", "Version": f.version})
			case "Items":
				id := r.URL.Query().Get("Ids")
				if id == "" || r.URL.Query().Get("Fields") != mediaTagFields {
					t.Error("unexpected full media metadata query")
				}
				items := []map[string]any{}
				ids := strings.Split(id, ",")
				f.batchSizes = append(f.batchSizes, len(ids))
				for _, itemID := range ids {
					if item := f.items[itemID]; item != nil {
						items = append(items, item)
					}
				}
				json.NewEncoder(w).Encode(map[string]any{"Items": items, "TotalRecordCount": len(items)})
			default:
				t.Errorf("forbidden media read %s", path)
				w.WriteHeader(400)
			}
			return
		}
		if r.Method != http.MethodPost || !strings.HasPrefix(path, "Items/") {
			t.Errorf("forbidden media mutation %s %s", r.Method, path)
			w.WriteHeader(400)
			return
		}
		parts := strings.Split(path, "/")
		item := f.items[parts[1]]
		if item == nil {
			w.WriteHeader(404)
			return
		}
		var body map[string]json.RawMessage
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			w.WriteHeader(400)
			return
		}
		f.writes = append(f.writes, path)
		f.payloads = append(f.payloads, body)
		if f.fail {
			w.WriteHeader(503)
			return
		}
		if f.lie {
			w.WriteHeader(204)
			return
		}
		if kind == "jellyfin" {
			if len(parts) != 2 {
				t.Error("Jellyfin used unsupported tag subroute")
			}
			var tags []string
			if json.Unmarshal(body["Tags"], &tags) != nil {
				t.Error("missing Jellyfin tag list")
			}
			for _, field := range []string{"Name", "Overview", "OriginalTitle", "ProviderIds", "Genres", "LockData", "PreferredMetadataLanguage", "PreferredMetadataCountryCode", "ForcedSortName"} {
				if _, ok := body[field]; !ok {
					t.Errorf("unsafe partial Jellyfin body: missing %s", field)
				}
			}
			for _, field := range []string{"People", "Studios", "Taglines", "ProductionLocations", "LockedFields"} {
				if _, ok := body[field]; ok {
					t.Errorf("unrelated metadata collection rewritten: %s", field)
				}
			}
			item["Tags"] = tags
		} else {
			if len(parts) != 4 || parts[2] != "Tags" || parts[3] != "Add" && parts[3] != "Delete" {
				t.Errorf("unsupported Emby mutation %s", path)
				w.WriteHeader(400)
				return
			}
			var pairs []struct{ Name, Id string }
			if json.Unmarshal(body["Tags"], &pairs) != nil {
				t.Error("invalid Emby tag payload")
			}
			tags := map[string]string{}
			for _, tag := range item["Tags"].([]string) {
				tags[strings.ToLower(tag)] = tag
			}
			for _, pair := range pairs {
				if pair.Name == "" {
					t.Error("tag missing Name")
				}
				if parts[3] == "Add" {
					tags[strings.ToLower(pair.Name)] = pair.Name
				} else {
					delete(tags, strings.ToLower(pair.Name))
				}
			}
			item["Tags"] = mediaTagNames(tags)
		}
		w.WriteHeader(204)
	}))
	t.Cleanup(h.Close)
	c := ServiceConfig{ID: kind + "-primary", Type: kind, URL: h.URL + "/proxy", APIKey: "synthetic-media-key", Enabled: true, TagSyncMode: "add", TagSyncDisable: "delete"}
	return f, h, c
}

func mediaFixtureDocument(id, itemType string, sources ...map[string]any) map[string]any {
	return map[string]any{"Id": id, "ServerId": "server1", "Type": itemType, "Name": "Synthetic title", "Overview": "Keep this description", "OriginalTitle": "Original title", "Tags": []string{"Manual"}, "Genres": []string{"Drama"}, "ProviderIds": map[string]string{"Tmdb": "123"}, "LockData": true, "LockedFields": []string{"Overview"}, "People": []map[string]any{{"Name": "Person", "Type": "Actor", "SortOrder": 9}}, "Studios": []map[string]string{{"Name": "Studio"}}, "Taglines": []string{"Tagline"}, "ProductionLocations": []string{"GB"}, "PreferredMetadataLanguage": "en", "PreferredMetadataCountryCode": "GB", "ForcedSortName": "Custom sort", "MediaSources": sources}
}

func mediaFixtureFile(t *testing.T, s *Store, arr, media ServiceConfig, fileID int, itemID, sourceID, filename string, size int64) File {
	t.Helper()
	f := sample(fileID, filename)
	f.Size = size
	typ := "Movie"
	if serviceKind(arr.ID) == "sonarr" {
		typ = "Episode"
	}
	f.setMediaMatch(media.ID, MediaMatch{ItemID: itemID, SourceID: sourceID, ItemType: typ, ServerID: "server1", Endpoint: tagEndpoint(media), Status: "matched", Link: &MediaLink{ItemID: "series-ui-only", ServerID: "server1"}})
	return f
}

func replaceMediaFixture(t *testing.T, s *Store, arr ServiceConfig, files ...File) {
	t.Helper()
	if e := s.Replace(arr.ID, files, SyncStatus{Source: tagEndpoint(arr)}); e != nil {
		t.Fatal(e)
	}
}
func mediaFixtureSettings(arrs []ServiceConfig, media ServiceConfig) Settings {
	cfg := DefaultSettings()
	cfg.Instances = append(append([]ServiceConfig{}, arrs...), media)
	return cfg
}
func mediaFixtureArr(id string) ServiceConfig {
	return ServiceConfig{ID: id, Type: serviceKind(id), Enabled: true, URL: "http://synthetic.invalid/" + id, APIKey: "synthetic"}
}
func mediaFixtureSource(id, name string, size int64) map[string]any {
	return map[string]any{"Id": id, "Path": "/library/" + name, "Size": size}
}

func TestMediaTagsDefaultOffAndVersionAllowlist(t *testing.T) {
	s := testStore(t)
	cfg := DefaultSettings()
	c := ServiceConfig{ID: "emby-main", Type: "emby", Enabled: true, URL: "http://unreachable.invalid", APIKey: "synthetic"}
	p, e := s.BuildMediaTagPlan(context.Background(), c.ID, c, nil, cfg)
	if e != nil || len(p.Operations) != 0 {
		t.Fatal("disabled sync attempted reads", e)
	}
	for _, row := range []struct {
		kind, version string
		ok            bool
	}{{"emby", "4.10.1.0", true}, {"emby", "4.8.11.0", true}, {"emby", "5.0.0", false}, {"jellyfin", "10.11.0", true}, {"jellyfin", "12.2.0", true}, {"jellyfin", "13.0.0", false}, {"jellyfin", "nonsense", false}} {
		if mediaTagVersionSupported(row.kind, row.version) != row.ok {
			t.Fatal(row)
		}
	}
}

func TestMediaTagsBatchedPreviewAndResumableWrites(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	fixture, _, c := newMediaTagFixture(t, "emby")
	a := mediaFixtureArr("radarr")
	c.TagSync = TagGroups{Resolution: true}
	cfg := mediaFixtureSettings([]ServiceConfig{a}, c)
	files := []File{}
	for i := 0; i < 270; i++ {
		id := fmt.Sprintf("movie%04d", i)
		name := fmt.Sprintf("Film.%04d.1080p.mkv", i)
		size := int64(100 + i)
		fixture.items[id] = mediaFixtureDocument(id, "Movie", mediaFixtureSource("source", name, size))
		files = append(files, mediaFixtureFile(t, s, a, c, i+1, id, "source", name, size))
	}
	replaceMediaFixture(t, s, a, files...)
	p, e := s.BuildMediaTagPlan(ctx, c.ID, c, nil, cfg)
	if e != nil || len(p.Operations) != 270 {
		t.Fatal("full preview lost targets", p, e)
	}
	if !reflect.DeepEqual(fixture.batchSizes, []int{100, 100, 70}) {
		t.Fatal("preview did not batch metadata", fixture.batchSizes)
	}
	fixture.batchSizes = nil
	changed, pending, e := s.ReconcileMediaTags(ctx, cfg, c.ID, c, nil)
	if e != nil || !pending || changed != 250 || len(fixture.writes) != 250 {
		t.Fatal("first chunk not bounded", changed, pending, e, len(fixture.writes))
	}
	var cursor mediaTagCursor
	if e = s.Get("mediaTagCursor:"+c.ID, &cursor); e != nil || cursor.After != "movie0249" {
		t.Fatal("cursor did not checkpoint committed targets", cursor, e)
	}
	firstReads := len(fixture.batchSizes)
	changed, pending, e = s.ReconcileMediaTags(ctx, cfg, c.ID, c, nil)
	if e != nil || pending || changed != 20 || len(fixture.writes) != 270 {
		t.Fatal("continuation failed", changed, pending, e, len(fixture.writes))
	}
	if fixture.batchSizes[firstReads] != 20 {
		t.Fatal("continuation re-read completed targets", fixture.batchSizes[firstReads:])
	}
	if e = s.Get("mediaTagCursor:"+c.ID, &cursor); e != nil || cursor.After != "" {
		t.Fatal("completed cursor was retained", cursor, e)
	}
	var owned int
	if e = s.DB.QueryRow(`SELECT count(*) FROM media_tag_history WHERE owned=1`).Scan(&owned); e != nil || owned != 270 {
		t.Fatal("per-target ownership checkpoint failed", owned, e)
	}
	for id, item := range fixture.items {
		if !reflect.DeepEqual(item["Tags"], []string{"1080p", "Manual"}) {
			t.Fatal("wrong resumed item tags", id, item["Tags"])
		}
	}
	before, e := s.mediaTagCursorSignature(ctx, cfg, c.ID, c)
	if e != nil {
		t.Fatal(e)
	}
	changedCfg := cfg
	changedCfg.Instances = append([]ServiceConfig{}, cfg.Instances...)
	changedCfg.Instances[0].Enabled = false
	after, e := s.mediaTagCursorSignature(ctx, changedCfg, c.ID, c)
	if e != nil || before == after {
		t.Fatal("source enablement did not invalidate cursor", e)
	}
	changedCfg = cfg
	changedCfg.Instances = append([]ServiceConfig{}, cfg.Instances...)
	changedCfg.Instances[0].URL += "/changed"
	after, e = s.mediaTagCursorSignature(ctx, changedCfg, c.ID, c)
	if e != nil || before == after {
		t.Fatal("source endpoint did not invalidate cursor", e)
	}
	softBefore := s.mediaTagContentRevision()
	if e = s.Put("cacheRevision", "changed-for-test"); e != nil {
		t.Fatal(e)
	}
	after, e = s.mediaTagCursorSignature(ctx, cfg, c.ID, c)
	if e != nil || before != after || softBefore == s.mediaTagContentRevision() {
		t.Fatal("file/custom cache changes must dirty the next pass without resetting its cursor", e)
	}
}

func TestMediaTagsAllDisabledCleanupResumes(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	fixture, _, c := newMediaTagFixture(t, "emby")
	a := mediaFixtureArr("radarr")
	c.TagSync = TagGroups{Resolution: true}
	cfg := mediaFixtureSettings([]ServiceConfig{a}, c)
	files := []File{}
	for i := 0; i < 270; i++ {
		id := fmt.Sprintf("movie%04d", i)
		name := fmt.Sprintf("Film.%04d.1080p.mkv", i)
		size := int64(100 + i)
		fixture.items[id] = mediaFixtureDocument(id, "Movie", mediaFixtureSource("source", name, size))
		files = append(files, mediaFixtureFile(t, s, a, c, i+1, id, "source", name, size))
	}
	replaceMediaFixture(t, s, a, files...)
	for i := 0; i < 2; i++ {
		if _, _, e := s.ReconcileMediaTags(ctx, cfg, c.ID, c, nil); e != nil {
			t.Fatal(e)
		}
	}
	c.TagSync = TagGroups{}
	c.TagSyncDisable = "delete"
	cfg = mediaFixtureSettings([]ServiceConfig{a}, c)
	changed, pending, e := s.ReconcileMediaTags(ctx, cfg, c.ID, c, nil)
	if e != nil || !pending || changed != 250 {
		t.Fatal("all-disabled cleanup not bounded", changed, pending, e)
	}
	var cursor mediaTagCursor
	if e = s.Get("mediaTagCursor:"+c.ID, &cursor); e != nil || cursor.After != "movie0249" {
		t.Fatal("cleanup cursor missing", cursor, e)
	}
	firstReads := len(fixture.batchSizes)
	changed, pending, e = s.ReconcileMediaTags(ctx, cfg, c.ID, c, nil)
	if e != nil || pending || changed != 20 {
		t.Fatal("all-disabled cleanup did not reach tail", changed, pending, e)
	}
	if fixture.batchSizes[firstReads] != 20 {
		t.Fatal("cleanup restarted its completed prefix", fixture.batchSizes[firstReads:])
	}
	for id, item := range fixture.items {
		if !reflect.DeepEqual(item["Tags"], []string{"Manual"}) {
			t.Fatal("cleanup missed target", id, item["Tags"])
		}
	}
	beforeReads := len(fixture.batchSizes)
	if changed, pending, e = s.ReconcileMediaTags(ctx, cfg, c.ID, c, nil); e != nil || pending || changed != 0 || len(fixture.batchSizes) != beforeReads {
		t.Fatal("completed disabled cleanup contacted server", changed, pending, e)
	}
}

func TestMediaTagsFrequentCacheChangesDoNotStarveTail(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	fixture, _, c := newMediaTagFixture(t, "emby")
	a := mediaFixtureArr("radarr")
	c.TagSync = TagGroups{Resolution: true}
	cfg := mediaFixtureSettings([]ServiceConfig{a}, c)
	files := []File{}
	for i := 0; i < 1020; i++ {
		id := fmt.Sprintf("movie%04d", i)
		name := fmt.Sprintf("Film.%04d.1080p.mkv", i)
		size := int64(100 + i)
		item := mediaFixtureDocument(id, "Movie", mediaFixtureSource("source", name, size))
		if i < 1000 {
			item["Tags"] = []string{"1080p", "Manual"}
		}
		fixture.items[id] = item
		files = append(files, mediaFixtureFile(t, s, a, c, i+1, id, "source", name, size))
	}
	replaceMediaFixture(t, s, a, files...)
	for tick := 0; tick < 4; tick++ {
		if e := s.Put("cacheRevision", fmt.Sprint("frequent-", tick)); e != nil {
			t.Fatal(e)
		}
		beforeReads := len(fixture.batchSizes)
		changed, pending, e := s.ReconcileMediaTags(ctx, cfg, c.ID, c, nil)
		if e != nil || !pending {
			t.Fatal("dirty pass was incorrectly completed", tick, changed, pending, e)
		}
		var cursor mediaTagCursor
		if e = s.Get("mediaTagCursor:"+c.ID, &cursor); e != nil {
			t.Fatal(e)
		}
		if tick%2 == 0 {
			if changed != 0 || cursor.After != "movie0999" {
				t.Fatal("prefix did not checkpoint", tick, changed, cursor)
			}
		} else {
			expected := 0
			if tick == 1 {
				expected = 20
			}
			if changed != expected || fixture.batchSizes[beforeReads] != 20 || cursor.After != "" {
				t.Fatal("soft revision restarted prefix or lost follow-up", tick, changed, cursor, fixture.batchSizes[beforeReads:])
			}
		}
	}
	for i := 1000; i < 1020; i++ {
		id := fmt.Sprintf("movie%04d", i)
		if !reflect.DeepEqual(fixture.items[id]["Tags"], []string{"1080p", "Manual"}) {
			t.Fatal("frequent refresh starved tail", id)
		}
	}
}

func TestMediaTagsRejectsMalformedBatchIdentity(t *testing.T) {
	for _, kind := range []string{"duplicate", "unexpected", "partial-count", "null", "series"} {
		t.Run(kind, func(t *testing.T) {
			mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "GET" || r.URL.Query().Get("Ids") != "movie1,movie2" || r.URL.Query().Get("Limit") != "2" {
					t.Error("invalid batch request")
				}
				one := mediaFixtureDocument("movie1", "Movie")
				two := mediaFixtureDocument("movie2", "Movie")
				items := []map[string]any{one, two}
				count := 2
				switch kind {
				case "duplicate":
					items[1] = one
				case "unexpected":
					items[1] = mediaFixtureDocument("movie3", "Movie")
				case "partial-count":
					count = 3
				case "null":
					items = nil
					count = 0
				case "series":
					one["Type"] = "Series"
				}
				json.NewEncoder(w).Encode(map[string]any{"Items": items, "TotalRecordCount": count})
			}))
			defer mock.Close()
			client := newMediaTagClient(ServiceConfig{ID: "emby", URL: mock.URL, APIKey: "synthetic"})
			if _, e := client.readItems(context.Background(), []string{"movie1", "movie2"}); e == nil {
				t.Fatal("malformed batch accepted")
			}
		})
	}
}

func TestMediaTagsAllLiveIdentityMismatchesRemainPending(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	fixture, _, c := newMediaTagFixture(t, "emby")
	a := mediaFixtureArr("radarr")
	c.TagSync = TagGroups{Resolution: true}
	name := "Film.1080p.mkv"
	fixture.items["movie1"] = mediaFixtureDocument("movie1", "Movie", mediaFixtureSource("source", name, 999))
	replaceMediaFixture(t, s, a, mediaFixtureFile(t, s, a, c, 1, "movie1", "source", name, 100))
	cfg := mediaFixtureSettings([]ServiceConfig{a}, c)
	p, e := s.BuildMediaTagPlan(ctx, c.ID, c, nil, cfg)
	if e != nil || !p.Waiting || p.Skipped != 1 || len(p.Operations) != 0 {
		t.Fatal("all mismatches were treated as success", p, e)
	}
	if changed, pending, e := s.ReconcileMediaTags(ctx, cfg, c.ID, c, nil); e != nil || changed != 0 || !pending || len(fixture.writes) != 0 {
		t.Fatal(changed, pending, e)
	}
}

func TestMediaTagsAddModeRetainsEarlierTechnicalValues(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	fixture, _, c := newMediaTagFixture(t, "emby")
	a := mediaFixtureArr("radarr")
	c.TagSync = TagGroups{Codec: true}
	cfg := mediaFixtureSettings([]ServiceConfig{a}, c)
	first := "Film.1080p.x264.mkv"
	fixture.items["movie1"] = mediaFixtureDocument("movie1", "Movie", mediaFixtureSource("source1", first, 100))
	replaceMediaFixture(t, s, a, mediaFixtureFile(t, s, a, c, 1, "movie1", "source1", first, 100))
	if _, _, e := s.ReconcileMediaTags(ctx, cfg, c.ID, c, nil); e != nil {
		t.Fatal(e)
	}
	upgraded := "Film.1080p.x265.mkv"
	fixture.items["movie1"]["MediaSources"] = []map[string]any{mediaFixtureSource("source1", upgraded, 200)}
	replaceMediaFixture(t, s, a, mediaFixtureFile(t, s, a, c, 1, "movie1", "source1", upgraded, 200))
	p, e := s.BuildMediaTagPlan(ctx, c.ID, c, nil, cfg)
	if e != nil {
		t.Fatal(e)
	}
	if p.Preview.ApprovalRequired || len(p.Preview.Rows) != 0 {
		t.Fatal("add-only mode planned technical removals", p.Preview)
	}
	if _, _, e = s.ExecuteMediaTagPlan(ctx, p, nil); e != nil {
		t.Fatal(e)
	}
	if !reflect.DeepEqual(fixture.items["movie1"]["Tags"], []string{"Manual", "x264", "x265"}) {
		t.Fatal("earlier technical tag was removed", fixture.items["movie1"]["Tags"])
	}
}

func TestMediaTagsUnionPerItemAcrossInstancesAndDisableGroup(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	fixture, _, c := newMediaTagFixture(t, "emby")
	a, b := mediaFixtureArr("radarr-hd"), mediaFixtureArr("radarr-uhd")
	c.TagSync = TagGroups{Resolution: true, Codec: true}
	name1, name2 := "Film.1080p.x264.mkv", "Film.2160p.x265.mkv"
	fixture.items["movie1"] = mediaFixtureDocument("movie1", "Movie", mediaFixtureSource("hd", name1, 100), mediaFixtureSource("uhd", name2, 200))
	replaceMediaFixture(t, s, a, mediaFixtureFile(t, s, a, c, 1, "movie1", "hd", name1, 100))
	replaceMediaFixture(t, s, b, mediaFixtureFile(t, s, b, c, 1, "movie1", "uhd", name2, 200))
	cfg := mediaFixtureSettings([]ServiceConfig{a, b}, c)
	changed, waiting, e := s.ReconcileMediaTags(ctx, cfg, c.ID, c, nil)
	if e != nil || waiting || changed != 1 {
		t.Fatal(changed, waiting, e)
	}
	got := fixture.items["movie1"]["Tags"].([]string)
	sort.Strings(got)
	if !reflect.DeepEqual(got, []string{"1080p", "2160p", "Manual", "x264", "x265"}) {
		t.Fatal("wrong union", got)
	}
	if len(fixture.writes) != 1 {
		t.Fatal(fixture.writes)
	}
	if n, wait, e := s.ReconcileMediaTags(ctx, cfg, c.ID, c, nil); e != nil || wait || n != 0 || len(fixture.writes) != 1 {
		t.Fatal("non-idempotent", n, wait, e)
	}
	before := c
	c.TagSync.Codec = false
	cfg = mediaFixtureSettings([]ServiceConfig{a, b}, c)
	p, e := s.BuildMediaTagPlan(ctx, c.ID, c, &before, cfg)
	if e != nil || p.Preview.ApprovalRequired || len(p.Preview.Rows) != 2 {
		t.Fatal("owned cleanup preview", p, e)
	}
	if _, _, e = s.ExecuteMediaTagPlan(ctx, p, nil); e != nil {
		t.Fatal(e)
	}
	got = fixture.items["movie1"]["Tags"].([]string)
	if !reflect.DeepEqual(got, []string{"1080p", "2160p", "Manual"}) {
		t.Fatal(got)
	}
}

func TestMediaTagsForeignReviewStalePreviewAndApprovalRollback(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	fixture, _, c := newMediaTagFixture(t, "emby")
	a := mediaFixtureArr("radarr")
	c.TagSync = TagGroups{Resolution: true}
	c.TagSyncMode = "replace"
	name := "Film.1080p.mkv"
	fixture.items["movie1"] = mediaFixtureDocument("movie1", "Movie", mediaFixtureSource("source1", name, 100))
	replaceMediaFixture(t, s, a, mediaFixtureFile(t, s, a, c, 1, "movie1", "source1", name, 100))
	cfg := mediaFixtureSettings([]ServiceConfig{a}, c)
	p, e := s.BuildMediaTagPlan(ctx, c.ID, c, nil, cfg)
	if e != nil || !p.Preview.ApprovalRequired || len(fixture.writes) != 0 {
		t.Fatal(p, e)
	}
	if n, _, e := s.ExecuteMediaTagPlan(ctx, p, nil); n != 0 || !errors.Is(e, ErrTagApproval) {
		t.Fatal(n, e)
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		t.Fatal(e)
	}
	if e = approveMediaTagPlan(ctx, tx, p); e != nil {
		t.Fatal(e)
	}
	tx.Rollback()
	var grants int
	s.DB.QueryRow("SELECT count(*) FROM media_tag_approvals").Scan(&grants)
	if grants != 0 {
		t.Fatal("approval escaped rollback")
	}
	if e = s.ApproveMediaTagPlan(ctx, p); e != nil {
		t.Fatal(e)
	}
	fixture.items["movie1"]["Tags"] = []string{"Manual", "newly-added"}
	if n, _, e := s.ExecuteMediaTagPlan(ctx, p, nil); n != 0 || !errors.Is(e, ErrTagPreviewChanged) || len(fixture.writes) != 0 {
		t.Fatal("stale preview wrote", n, e)
	}
	p, e = s.BuildMediaTagPlan(ctx, c.ID, c, nil, cfg)
	if e != nil || !p.Preview.ApprovalRequired {
		t.Fatal("new foreign tag escaped review", p, e)
	}
	if preview := p.TagTargets(1, 1); preview.TargetTotal != 1 || preview.Targets[0].Title != "Synthetic title" {
		t.Fatal(preview)
	}
	if e = s.ApproveMediaTagPlan(ctx, p); e != nil {
		t.Fatal(e)
	}
	if _, _, e = s.ExecuteMediaTagPlan(ctx, p, nil); e != nil {
		t.Fatal(e)
	}
	if !reflect.DeepEqual(fixture.items["movie1"]["Tags"], []string{"1080p"}) {
		t.Fatal(fixture.items["movie1"])
	}
}

func TestMediaTagsJellyfinPreservesMetadataAndUsesActualEpisode(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	fixture, _, c := newMediaTagFixture(t, "jellyfin")
	a := mediaFixtureArr("sonarr-anime")
	c.TagSync = TagGroups{Codec: true}
	name := "Show.S01E01.1080p.x265.mkv"
	item := mediaFixtureDocument("episode1", "Episode", mediaFixtureSource("episode-source", name, 500))
	delete(item, "ProductionLocations")
	fixture.items["episode1"] = item
	beforeBytes, _ := json.Marshal(item)
	var before map[string]any
	json.Unmarshal(beforeBytes, &before)
	replaceMediaFixture(t, s, a, mediaFixtureFile(t, s, a, c, 1, "episode1", "episode-source", name, 500))
	cfg := mediaFixtureSettings([]ServiceConfig{a}, c)
	if changed, waiting, e := s.ReconcileMediaTags(ctx, cfg, c.ID, c, nil); e != nil || waiting || changed != 1 {
		t.Fatal(changed, waiting, e)
	}
	if len(fixture.writes) != 1 || fixture.writes[0] != "Items/episode1" {
		t.Fatal("UI series identity used for write", fixture.writes)
	}
	afterBytes, _ := json.Marshal(item)
	var after map[string]any
	json.Unmarshal(afterBytes, &after)
	delete(before, "Tags")
	delete(after, "Tags")
	if !reflect.DeepEqual(before, after) {
		t.Fatal("metadata was changed")
	}
	delete(item, "ProviderIds")
	if _, _, e := s.ReconcileMediaTags(ctx, cfg, c.ID, c, nil); e == nil || len(fixture.writes) != 1 {
		t.Fatal("incomplete metadata accepted", e)
	}
}

func TestMediaTagsCustomRemovalAndHistoricalSourceCleanup(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	fixture, _, c := newMediaTagFixture(t, "emby")
	a, b := mediaFixtureArr("radarr-main"), mediaFixtureArr("radarr-other")
	c.SourceIDs = a.ID
	c.TagSync = TagGroups{Custom: true}
	name := "Film.mkv"
	fixture.items["movie1"] = mediaFixtureDocument("movie1", "Movie", mediaFixtureSource("source1", name, 100))
	replaceMediaFixture(t, s, a, mediaFixtureFile(t, s, a, c, 1, "movie1", "source1", name, 100))
	tag, e := s.SaveCustomTag(ctx, CustomTag{Name: "Favorite"})
	if e != nil {
		t.Fatal(e)
	}
	q := url.Values{"service": {a.ID}}
	if _, e = s.ApplyCustom(ctx, q, map[string]bool{strconv.FormatInt(tag.ID, 10): true}); e != nil {
		t.Fatal(e)
	}
	cfg := mediaFixtureSettings([]ServiceConfig{a, b}, c)
	if _, _, e = s.ReconcileMediaTags(ctx, cfg, c.ID, c, nil); e != nil {
		t.Fatal(e)
	}
	if _, e = s.ApplyCustom(ctx, q, map[string]bool{strconv.FormatInt(tag.ID, 10): false}); e != nil {
		t.Fatal(e)
	}
	if changed, _, e := s.ReconcileMediaTags(ctx, cfg, c.ID, c, nil); e != nil || changed != 1 {
		t.Fatal("add mode kept removed custom tag", changed, e)
	}
	if !reflect.DeepEqual(fixture.items["movie1"]["Tags"], []string{"Manual"}) {
		t.Fatal(fixture.items["movie1"]["Tags"])
	}
	if _, e = s.ApplyCustom(ctx, q, map[string]bool{strconv.FormatInt(tag.ID, 10): true}); e != nil {
		t.Fatal(e)
	}
	if _, _, e = s.ReconcileMediaTags(ctx, cfg, c.ID, c, nil); e != nil {
		t.Fatal(e)
	}
	c.SourceIDs = b.ID
	cfg = mediaFixtureSettings([]ServiceConfig{a, b}, c)
	if changed, _, e := s.ReconcileMediaTags(ctx, cfg, c.ID, c, nil); e != nil || changed != 1 {
		t.Fatal("deselected historical source was not cleaned", changed, e)
	}
	if !reflect.DeepEqual(fixture.items["movie1"]["Tags"], []string{"Manual"}) {
		t.Fatal(fixture.items["movie1"]["Tags"])
	}
}

func TestMediaTagsHistoricalDeletedFileAndKeepDisabledService(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	fixture, _, c := newMediaTagFixture(t, "emby")
	a := mediaFixtureArr("radarr")
	c.TagSync = TagGroups{Resolution: true}
	name := "Film.720p.mkv"
	fixture.items["movie1"] = mediaFixtureDocument("movie1", "Movie", mediaFixtureSource("source1", name, 100))
	f := mediaFixtureFile(t, s, a, c, 1, "movie1", "source1", name, 100)
	replaceMediaFixture(t, s, a, f)
	cfg := mediaFixtureSettings([]ServiceConfig{a}, c)
	if _, _, e := s.ReconcileMediaTags(ctx, cfg, c.ID, c, nil); e != nil {
		t.Fatal(e)
	}
	replaceMediaFixture(t, s, a)
	if changed, _, e := s.ReconcileMediaTags(ctx, cfg, c.ID, c, nil); e != nil || changed != 1 {
		t.Fatal("removed file target not cleaned", changed, e)
	}
	replaceMediaFixture(t, s, a, f)
	if _, _, e := s.ReconcileMediaTags(ctx, cfg, c.ID, c, nil); e != nil {
		t.Fatal(e)
	}
	before := c
	c.Enabled = false
	c.TagSync = TagGroups{}
	c.TagSyncDisable = "keep"
	p, e := s.BuildMediaTagPlan(ctx, c.ID, c, &before, mediaFixtureSettings([]ServiceConfig{a}, c))
	if e != nil || len(p.Operations) != 0 {
		t.Fatal("keep requires live service", p, e)
	}
	if _, _, e = s.ExecuteMediaTagPlan(ctx, p, nil); e != nil {
		t.Fatal(e)
	}
}

func TestMediaTagsStaleEndpointAndLostWriteDoNotClaimOwnership(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	fixture, _, c := newMediaTagFixture(t, "emby")
	a := mediaFixtureArr("radarr")
	c.TagSync = TagGroups{Codec: true}
	name := "Film.x264.mkv"
	fixture.items["movie1"] = mediaFixtureDocument("movie1", "Movie", mediaFixtureSource("source1", name, 100))
	f := mediaFixtureFile(t, s, a, c, 1, "movie1", "source1", name, 100)
	f.MediaServers.get(c.ID).Endpoint = "stale"
	replaceMediaFixture(t, s, a, f)
	cfg := mediaFixtureSettings([]ServiceConfig{a}, c)
	p, e := s.BuildMediaTagPlan(ctx, c.ID, c, nil, cfg)
	if e != nil || !p.Waiting || len(fixture.writes) != 0 {
		t.Fatal("stale endpoint accepted", p, e)
	}
	f.MediaServers.get(c.ID).Endpoint = tagEndpoint(c)
	replaceMediaFixture(t, s, a, f)
	fixture.fail = true
	if _, _, e = s.ReconcileMediaTags(ctx, cfg, c.ID, c, nil); e == nil {
		t.Fatal("failed mutation accepted")
	}
	var count int
	if e = s.DB.QueryRow(`SELECT count(*) FROM media_tag_history WHERE owned=1`).Scan(&count); e != nil || count != 0 {
		t.Fatal("failed write claimed ownership", count, e)
	}
	fixture.fail = false
	fixture.items["movie1"]["Tags"] = []string{"Manual", "x264"}
	if _, _, e = s.ReconcileMediaTags(ctx, cfg, c.ID, c, nil); e != nil {
		t.Fatal(e)
	}
	s.DB.QueryRow(`SELECT count(*) FROM media_tag_history WHERE owned=1`).Scan(&count)
	if count != 0 {
		t.Fatal("foreign tag was adopted after failed write")
	}
	before := c
	c.TagSync = TagGroups{}
	p, e = s.BuildMediaTagPlan(ctx, c.ID, c, &before, mediaFixtureSettings([]ServiceConfig{a}, c))
	if e != nil || !p.Preview.ApprovalRequired {
		t.Fatal("foreign cleanup escaped review", p, e)
	}
}

func TestMediaTagsAmbiguousDuplicateEpisodeTargetsAreReadOnly(t *testing.T) {
	for _, seriesMode := range []string{"same", "different", "missing"} {
		t.Run(seriesMode, func(t *testing.T) {
			mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "GET" {
					t.Error("enrichment mutated service")
				}
				series2 := "series1"
				if seriesMode == "different" {
					series2 = "series2"
				}
				series1 := "series1"
				if seriesMode == "missing" {
					series1 = ""
					series2 = ""
				}
				items := []map[string]any{}
				for i, series := range []string{series1, series2} {
					items = append(items, map[string]any{"Id": fmt.Sprint("episode", i), "SeriesId": series, "ServerId": "server1", "Type": "Episode", "MediaSources": []map[string]any{{"Id": fmt.Sprint("source", i), "Path": "/show/Show.mkv", "Size": 100, "MediaStreams": []map[string]any{{"Type": "Audio", "Codec": "aac", "Language": "eng"}}}}})
				}
				json.NewEncoder(w).Encode(map[string]any{"Items": items, "TotalRecordCount": 2})
			}))
			defer mock.Close()
			f := sample(1, "Show.mkv")
			f.Size = 100
			files := []File{f}
			c := ServiceConfig{ID: "emby-test", URL: mock.URL, APIKey: "synthetic"}
			if e := NewEmby(c).Enrich(context.Background(), "sonarr-anime", files); e != nil {
				t.Fatal(e)
			}
			match := files[0].MediaServers.get(c.ID)
			if match == nil || match.ItemID != "" {
				t.Fatal("arbitrary duplicate write target survived", match)
			}
		})
	}
}

func TestMediaTagsCompactCandidatesPreserveDuplicateSemantics(t *testing.T) {
	for _, mode := range []string{"single", "same-normalized-path", "different-path", "different-streams", "local-duplicates"} {
		t.Run(mode, func(t *testing.T) {
			items := []map[string]any{}
			count := 1
			if mode == "same-normalized-path" || mode == "different-path" || mode == "different-streams" {
				count = 2
			}
			for i := 0; i < count; i++ {
				path := `C:\Movies\Film.mkv`
				codec := "aac"
				if i == 1 {
					path = "C:/Movies/Film.mkv"
					if mode == "different-path" {
						path = "D:/Other/Film.mkv"
					}
					if mode == "different-streams" {
						codec = "ac3"
					}
				}
				id := fmt.Sprint("movie", i)
				items = append(items, map[string]any{"Id": id, "ServerId": "server1", "Type": "Movie", "MediaSources": []map[string]any{{"Id": id, "Path": path, "Size": 100, "MediaStreams": []map[string]any{{"Type": "Audio", "Index": 1, "Codec": codec, "Language": "eng"}}}}})
			}
			mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "GET" {
					t.Error("read enrichment mutated service")
				}
				json.NewEncoder(w).Encode(map[string]any{"Items": items, "TotalRecordCount": len(items)})
			}))
			defer mock.Close()
			f := sample(1, "Film.mkv")
			f.Size = 100
			files := []File{f}
			if mode == "local-duplicates" {
				other := sample(2, "Film.mkv")
				other.Size = 100
				files = append(files, other)
			}
			c := ServiceConfig{ID: "emby-primary", URL: mock.URL, APIKey: "synthetic"}
			if e := NewEmby(c).Enrich(context.Background(), "radarr", files); e != nil {
				t.Fatal(e)
			}
			for _, file := range files {
				match := file.MediaServers.get(c.ID)
				expected := "matched"
				if mode == "different-path" || mode == "different-streams" || mode == "local-duplicates" {
					expected = "ambiguous"
				}
				if match == nil || match.Status != expected {
					t.Fatal("duplicate matching semantics changed", mode, match)
				}
				if mode != "single" && match.ItemID != "" {
					t.Fatal("ambiguous target ID retained", match)
				}
				if mode == "single" && (match.ItemID != "movie0" || match.SourceID != "movie0" || unsafe.StringData(match.ItemID) != unsafe.StringData(match.SourceID)) {
					t.Fatal("equal item/source identity storage not shared", match)
				}
			}
		})
	}
}
