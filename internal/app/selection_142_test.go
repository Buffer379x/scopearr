package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

func TestFileSelectionLimitAndExplicitTags142(t *testing.T) {
	store := testStore(t)
	files := make([]File, 10005)
	for n := range files {
		files[n] = sample(n+1, fmt.Sprintf("Film %05d.mkv", n+1))
	}
	if e := store.Replace("radarr", files, SyncStatus{}); e != nil {
		t.Fatal(e)
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
