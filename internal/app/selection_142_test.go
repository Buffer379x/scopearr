package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

func TestFileSelectionGroupsAndContext142(t *testing.T) {
	s := testStore(t)
	files := []File{}
	for n := 1; n <= 153; n++ {
		f := sample(n, fmt.Sprintf("Episode %03d.mkv", n))
		f.Service = "sonarr"
		f.Series = "Jackass"
		f.MediaID = 10
		f.Season = (n-1)/50 + 1
		f.Episodes = []Episode{{Number: (n-1)%50 + 1}}
		if n > 150 {
			f.Series = "Other"
			f.MediaID = 20
			f.Season = 1
		}
		files = append(files, f)
	}
	if e := s.Replace("sonarr", files, SyncStatus{}); e != nil {
		t.Fatal(e)
	}
	q := url.Values{"service": {"sonarr"}, "mediaId": {"10"}, "season": {"2"}}
	selected, e := s.SelectFiles(context.Background(), q, "matches")
	if e != nil || selected.Total != 50 {
		t.Fatal(selected.Total, e)
	}
	for _, k := range selected.Keys {
		if k.MediaID != 10 || k.Season == nil || *k.Season != 2 {
			t.Fatal(k)
		}
	}
	q = url.Values{"service": {"sonarr"}, "fileId": {"1"}}
	selected, e = s.SelectFiles(context.Background(), q, "season")
	if e != nil || selected.Total != 50 {
		t.Fatal("context", selected.Total, e)
	}
	selected, e = s.SelectFiles(context.Background(), q, "matches")
	if e != nil || selected.Total != 1 {
		t.Fatal("matches", selected.Total, e)
	}
	q.Set("_pageSize", "17")
	page, e := s.QueryContext(context.Background(), q, "season", false)
	if e != nil {
		t.Fatal(e)
	}
	groups := page.Groups
	if len(groups) != 2 || groups[0].Total != 50 || groups[1].Total != 50 {
		t.Fatal(groups)
	}
	q.Set("page", "2")
	page, e = s.QueryContext(context.Background(), q, "season", false)
	if e != nil {
		t.Fatal(e)
	}
	groups = page.Groups
	if e != nil || !groups[len(groups)-1].Continued {
		t.Fatal("continuation", groups, e)
	}
	q.Set("sort", "size")
	q.Set("dir", "desc")
	selected, e = s.SelectFiles(context.Background(), q, "season")
	if e != nil || selected.Total != 1 {
		t.Fatal("flat sort must not select context", selected.Total, e)
	}
	for _, query := range []url.Values{{"service": {"sonarr"}, "season": {"bad"}}, {"service": {"sonarr"}, "mediaId": {"-1"}}, {"service": {"bogus"}}} {
		if _, e := s.SelectFiles(context.Background(), query, "matches"); e == nil {
			t.Fatal("invalid group accepted", query)
		}
	}
}

func TestFileSelectionLimitAndExplicitTags142(t *testing.T) {
	store := testStore(t)
	files := make([]File, 10005)
	for n := range files {
		files[n] = sample(n+1, fmt.Sprintf("Film %05d.mkv", n+1))
	}
	if e := store.Replace("radarr", files, SyncStatus{}); e != nil {
		t.Fatal(e)
	}
	all, e := store.SelectFiles(context.Background(), url.Values{"service": {"radarr"}}, "matches")
	if e != nil || all.Total != 10005 || len(all.Keys) != 10000 || !all.Truncated {
		t.Fatal(all.Total, len(all.Keys), all.Truncated, e)
	}
	tag, e := store.SaveCustomTag(context.Background(), CustomTag{Name: "Selected"})
	if e != nil {
		t.Fatal(e)
	}
	q, e := explicitSelection(nil, []FileKey{{Service: "radarr", ID: 1}, {Service: "radarr", ID: 3}, {Service: "radarr", ID: 1}})
	if e != nil {
		t.Fatal(e)
	}
	total, e := store.ApplyCustom(context.Background(), q, map[string]bool{strconv.FormatInt(tag.ID, 10): true})
	if e != nil || total != 2 {
		t.Fatal(total, e)
	}
	state, e := store.CustomSelection(context.Background(), q)
	if e != nil || state.Total != 2 || state.Counts[strconv.FormatInt(tag.ID, 10)] != 2 {
		t.Fatal(state, e)
	}
	var count int
	if e := store.DB.QueryRow("SELECT count(*) FROM file_custom").Scan(&count); e != nil || count != 2 {
		t.Fatal("writes escaped selection", count, e)
	}
	for _, keys := range [][]FileKey{{}, {{Service: "emby", ID: 1}}, {{Service: "radarr", ID: -1}}, make([]FileKey, 10001)} {
		if _, e := explicitSelection(nil, keys); e == nil {
			t.Fatal("invalid explicit selection accepted")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, e := NewServer(ctx, store, nil, "1.4.2-test")
	if e != nil {
		t.Fatal(e)
	}
	defer server.Sync.Shutdown()
	w := httptest.NewRecorder()
	server.customSelectionHTTP(w, httptest.NewRequest("POST", "/api/custom-selection", strings.NewReader(`{"files":[{"service":"radarr","id":1},{"service":"radarr","id":3}]}`)))
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	server.customTagsBatchHTTP(w, httptest.NewRequest("PUT", "/api/custom-tags/batch", strings.NewReader(fmt.Sprintf(`{"files":[{"service":"radarr","id":1}],"changes":{"%d":false}}`, tag.ID))))
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if e := store.DB.QueryRow("SELECT count(*) FROM file_custom").Scan(&count); e != nil || count != 1 {
		t.Fatal("selected removal", count, e)
	}
}

func TestMuxInfoLayoutRollbackStorage142(t *testing.T) {
	cfg := DefaultSettings()
	cfg.ListInfoOrder = []string{"link", "mux", "media", "details", "metadata", "recognition"}
	cfg.ListInfoVisible = []string{"link"}
	store := testStore(t)
	if e := store.Put("settings", cfg); e != nil {
		t.Fatal(e)
	}
	var raw string
	if e := store.DB.QueryRow("SELECT value FROM kv WHERE key='settings'").Scan(&raw); e != nil {
		t.Fatal(e)
	}
	var saved Settings
	if e := json.Unmarshal([]byte(raw), &saved); e != nil {
		t.Fatal(e)
	}
	// These exact legacy lists pass the 1.4.1 five-action validator.
	if !reflect.DeepEqual(saved.ListInfoOrder, []string{"link", "media", "details", "metadata", "recognition"}) || !reflect.DeepEqual(saved.ListInfoVisible, []string{"link"}) {
		t.Fatal("legacy lists changed", saved.ListInfoOrder, saved.ListInfoVisible)
	}
	if e := normalizeListInfo(&saved); e != nil {
		t.Fatal(e)
	}
	if !reflect.DeepEqual(saved.ListInfoOrder, cfg.ListInfoOrder) || !reflect.DeepEqual(saved.ListInfoVisible, cfg.ListInfoVisible) {
		t.Fatal("mux position/visibility not restored", saved.ListInfoOrder, saved.ListInfoVisible)
	}
	if e := store.saveSettingsWithAllTagPolicies(context.Background(), cfg, cfg, cfg, nil); e != nil {
		t.Fatal(e)
	}
	if e := store.Get("settings", &saved); e != nil {
		t.Fatal(e)
	}
	if len(saved.ListInfoOrder) != 5 || saved.MuxInfo == nil || saved.MuxInfo.Position != 1 || saved.MuxInfo.Visible {
		t.Fatal("transactional save broke rollback", saved.ListInfoOrder, saved.MuxInfo)
	}
	if len(cfg.ListInfoOrder) != 6 {
		t.Fatal("storage mutated live config")
	}
}
