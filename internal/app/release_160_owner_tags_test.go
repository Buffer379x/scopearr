package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
)

func TestOwnerDefaultsMigration160(t *testing.T) {
	var cfg Settings
	raw := `{"unraid":{"diskRoot":"/unraid","shareRoot":"/media"},"fileCheck":{"ownerUid":1000,"ownerGid":101,"fileMode":"0666","dirMode":"0777","kinds":["owner"]}}`
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		t.Fatal(err)
	}
	if err := normalizeUnraid(&cfg); err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(cfg.Unraid)
	var owners map[string]any
	_ = json.Unmarshal(data, &owners)
	if owners["ownerUid"] != float64(1000) || owners["ownerGid"] != float64(101) {
		t.Fatalf("legacy owners not migrated: %s", data)
	}
	cfg.FileCheck.OwnerUID, cfg.FileCheck.OwnerGID = 2000, 202
	if err := normalizeUnraid(&cfg); err != nil {
		t.Fatal(err)
	}
	data, _ = json.Marshal(cfg.Unraid)
	_ = json.Unmarshal(data, &owners)
	if owners["ownerUid"] != float64(1000) || owners["ownerGid"] != float64(101) {
		t.Fatalf("scan changed owner defaults: %s", data)
	}
	for _, owner := range []string{`"ownerUid":-1,"ownerGid":100`, `"ownerUid":99,"ownerGid":65536`} {
		next := DefaultSettings()
		if err := json.Unmarshal([]byte(`{"diskRoot":"/unraid",`+owner+`}`), &next.Unraid); err != nil {
			t.Fatal(err)
		}
		if normalizeUnraid(&next) == nil {
			t.Fatalf("accepted invalid owner %s", owner)
		}
	}
	for _, owner := range []string{`"ownerUid":0,"ownerGid":0`, `"ownerUid":65535,"ownerGid":65535`} {
		next := DefaultSettings()
		if err := json.Unmarshal([]byte(`{"diskRoot":"/unraid",`+owner+`}`), &next.Unraid); err != nil {
			t.Fatal(err)
		}
		if err := normalizeUnraid(&next); err != nil {
			t.Fatal(err)
		}
		data, _ := json.Marshal(next.Unraid)
		if !strings.Contains(string(data), owner[:strings.Index(owner, ",")]) {
			t.Fatalf("explicit owner lost: %s", data)
		}
	}
}

func TestOwnerDifferentFromContainerManual160(t *testing.T) {
	root := t.TempDir()
	fileCheckWrite131(t, root, "Film.nfo", "metadata")
	cfg := DefaultSettings()
	cfg.Unraid.Enabled, cfg.Mux.Enabled, cfg.Mux.Mappings = true, true, "/movies => /media"
	cfg.FileCheck.Kinds = []string{"owner"}
	original := placementOwner
	t.Cleanup(func() { placementOwner = original })
	placementOwner = func(os.FileInfo) (uint32, uint32) { return uint32((os.Geteuid() + 1) % 65536), uint32(os.Getegid()) }
	for _, test := range []struct {
		name     string
		uid, gid int
		fix      string
	}{
		{"other uid", (os.Geteuid() + 2) % 65536, os.Getegid(), "manual"},
		{"other gid", os.Geteuid(), (os.Getegid() + 1) % 65536, "manual"},
		{"container owner", os.Geteuid(), os.Getegid(), "take_ownership"},
	} {
		t.Run(test.name, func(t *testing.T) {
			cfg.FileCheck.OwnerUID, cfg.FileCheck.OwnerGID = test.uid, test.gid
			n := 0
			_, err := fileCheckInspect(cfg, arrFolder{Local: root}, nil, func(item FileCheckItem) error {
				n++
				if item.Fix != test.fix || test.fix == "manual" && !strings.Contains(item.Note, "cannot assign") {
					t.Errorf("incorrect owner fix: %#v", item)
				}
				if !strings.Contains(fileCheckCommands(cfg, []FileCheckItem{item}), fmt.Sprintf("chown %d:%d", test.uid, test.gid)) {
					t.Error("export lost requested owner")
				}
				return nil
			})
			if err != nil || n != 1 {
				t.Fatal(n, err)
			}
		})
	}
}

func TestInlineCustomTags160(t *testing.T) {
	store := testStore(t)
	if err := store.Replace("radarr", []File{sample(1, "Film.mkv"), sample(2, "Other.mkv")}, SyncStatus{}); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, err := NewServer(ctx, store, nil, "1.6.0-test")
	if err != nil {
		t.Fatal(err)
	}
	defer server.Sync.Shutdown()
	put := func(body string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		server.customSelectionHTTP(w, httptest.NewRequest("PUT", "/api/custom-selection", strings.NewReader(body)))
		return w
	}
	body := `{"files":[{"service":"radarr","id":1}],"changes":{"new:1":true},"create":[{"key":"new:1","name":"Review"}]}`
	for range 2 {
		w := put(body)
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	w := put(strings.ReplaceAll(body, "Review", "REVIEW"))
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	tags, err := store.CustomTags(ctx)
	if err != nil || len(tags) != 1 {
		t.Fatal(tags, err)
	}
	reviewID := tags[0].ID
	state, err := store.CustomSelection(ctx, url.Values{"service": {"radarr"}})
	if err != nil || state.Counts[strconv.FormatInt(reviewID, 10)] != 1 {
		t.Fatal(state, err)
	}
	for _, name := range []string{"", strings.Repeat("x", 81)} {
		raw, _ := json.Marshal(name)
		w = put(`{"query":"","changes":{"new:1":true},"create":[{"key":"new:1","name":` + string(raw) + `}]}`)
		if w.Code != 400 {
			t.Fatal("invalid name", w.Code, w.Body.String())
		}
	}
	w = put(`{"query":"","changes":{"new:1":false},"create":[{"key":"new:1","name":"Unchecked"}]}`)
	if w.Code != 400 {
		t.Fatal(w.Code, w.Body.String())
	}
	tags, _ = store.CustomTags(ctx)
	if len(tags) != 1 {
		t.Fatal(tags)
	}
	// Failed assignment retains newly created definitions and tells the caller.
	w = put(`{"query":"service=invalid","changes":{"new:1":true},"create":[{"key":"new:1","name":"Retained"}]}`)
	if w.Code != 400 || !strings.Contains(w.Body.String(), "The tag was created, but could not be applied:") {
		t.Fatal(w.Code, w.Body.String())
	}
	tags, _ = store.CustomTags(ctx)
	if len(tags) != 2 {
		t.Fatal("created definition lost on application failure", tags)
	}
	// Concurrent query-based submissions create one definition and tag both rows.
	var wg sync.WaitGroup
	results := make(chan *httptest.ResponseRecorder, 4)
	for range 4 {
		wg.Go(func() {
			results <- put(`{"query":"service=radarr","changes":{"new:1":true},"create":[{"key":"new:1","name":"Across pages"}]}`)
		})
	}
	wg.Wait()
	close(results)
	for response := range results {
		if response.Code != 200 {
			t.Fatal(response.Code, response.Body.String())
		}
	}
	tags, _ = store.CustomTags(ctx)
	if len(tags) != 3 {
		t.Fatal("duplicate created definitions", tags)
	}
	state, err = store.CustomSelection(ctx, url.Values{"service": {"radarr"}})
	if err != nil {
		t.Fatal(err)
	}
	for _, tag := range tags {
		if tag.Name == "Across pages" && state.Counts[strconv.FormatInt(tag.ID, 10)] != 2 {
			t.Fatal("query selection lost matches", state)
		}
	}
	for n := len(tags); n < 127; n++ {
		if _, err := store.SaveCustomTag(ctx, CustomTag{Name: fmt.Sprintf("Tag %03d", n)}); err != nil {
			t.Fatal(err)
		}
	}
	w = put(`{"changes":{"new:1":true,"new:2":true},"create":[{"key":"new:1","name":"Overflow one"},{"key":"new:2","name":"Overflow two"}]}`)
	if w.Code != 400 {
		t.Fatal(w.Code, w.Body.String())
	}
	tags, _ = store.CustomTags(ctx)
	if len(tags) != 127 {
		t.Fatal("capacity validation created a partial batch", len(tags))
	}
	if _, err = store.SaveCustomTag(ctx, CustomTag{Name: "Last allowed"}); err != nil {
		t.Fatal(err)
	}
	w = put(`{"changes":{"new:1":true},"create":[{"key":"new:1","name":"Overflow"}]}`)
	if w.Code != 400 {
		t.Fatal(w.Code, w.Body.String())
	}
	state, err = store.CustomSelection(ctx, url.Values{"service": {"radarr"}})
	if err != nil || len(state.Tags) != 128 || state.Counts[strconv.FormatInt(reviewID, 10)] != 1 {
		t.Fatal(state, err)
	}
}
