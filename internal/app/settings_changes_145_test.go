package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestSettingsEventDetails145(t *testing.T) {
	store := testStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s, e := NewServer(ctx, store, nil, "1.4.5-test")
	if e != nil {
		t.Fatal(e)
	}
	defer s.Sync.Shutdown()
	cfg := DefaultSettings()
	cfg.Instances = []ServiceConfig{{ID: "radarr-4k", Type: "radarr", Name: "Radarr 4K", Interval: 60, APIKey: "synthetic-old-secret"}}
	setTestSettings(s, cfg)
	next := s.Config()
	next.Instances[0].Interval = 1440
	next.Instances[0].APIKey = "synthetic-new-secret"
	next.InterfaceTheme = "nord"
	next.Mux.KeepFinished = 14
	next.Unraid.ShareDirs = map[string]string{"/documentaries": "documentaries"}
	next.PlacementVisibleColumns = []string{"select", "title", "status"}
	body, _ := json.Marshal(next)
	w := httptest.NewRecorder()
	s.settingsHTTP(w, httptest.NewRequest("PUT", "/api/settings", bytes.NewReader(body)))
	if w.Code != 200 {
		t.Fatalf("save %d %s", w.Code, w.Body.String())
	}
	page := eventQueryAll(t, store.Events, eventQuery{Sources: []string{"settings"}})
	if page.Total != 1 {
		t.Fatalf("expected one settings event: %+v", page)
	}
	event := page.Events[0]
	if event.Message != "Settings saved · {areas}" {
		t.Errorf("missing areas: %+v", event)
	}
	for _, text := range []string{"Services · Radarr 4K", "Display", "Lists & columns", "Unraid", "MKVToolNix"} {
		if !strings.Contains(event.Subject, text) {
			t.Errorf("missing area %s in %s", text, event.Subject)
		}
	}
	for _, text := range []string{"instances[radarr-4k].interval: 60 → 1440", "instances[radarr-4k].apiKey: changed", "mux.keepFinished: 7 → 14", "unraid.shareDirs[/documentaries]"} {
		if !strings.Contains(event.Detail, text) {
			t.Errorf("missing field %s in %s", text, event.Detail)
		}
	}
	if text := eventText(event, nil); strings.Contains(text, "[Services") || !strings.Contains(text, "Settings saved · ") {
		t.Errorf("bad English array export: %s", text)
	}
	raw, _ := json.Marshal(event)
	if strings.Contains(string(raw), "synthetic-") {
		t.Error("settings event leaked a secret")
	}
	// A normalized no-op must not add a row or increment its repeat count.
	body, _ = json.Marshal(s.Config())
	w = httptest.NewRecorder()
	s.settingsHTTP(w, httptest.NewRequest("PUT", "/api/settings", bytes.NewReader(body)))
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	page = eventQueryAll(t, store.Events, eventQuery{Sources: []string{"settings"}})
	if page.Total != 1 || page.Events[0].Repeat != 1 {
		t.Errorf("no-op logged: %+v", page)
	}
}

func TestSettingsChangeLimit145(t *testing.T) {
	before := DefaultSettings()
	after := DefaultSettings()
	after.Unraid.ShareDirs = map[string]string{}
	for n := 0; n < 60; n++ {
		after.Unraid.ShareDirs[fmt.Sprintf("/share-%02d", n)] = "chosen"
	}
	areas, details := settingsChanges(before, after)
	if len(areas) != 1 || areas[0] != "Unraid" || len(details) != 51 || details[50] != "… and 10 more" {
		t.Fatalf("unbounded/missing details: %v %v", areas, details)
	}
	if !strings.Contains(details[0], "(automatic) → chosen") {
		t.Fatal(details[0])
	}
}

func TestSpecificSettingsEvents145(t *testing.T) {
	store := testStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s, e := NewServer(ctx, store, nil, "1.4.5-test")
	if e != nil {
		t.Fatal(e)
	}
	defer s.Sync.Shutdown()
	send := func(method, path string, body any, handler func(http.ResponseWriter, *http.Request)) {
		t.Helper()
		raw, _ := json.Marshal(body)
		w := httptest.NewRecorder()
		handler(w, httptest.NewRequest(method, path, bytes.NewReader(raw)))
		if w.Code < 200 || w.Code >= 300 {
			t.Fatalf("%s %s: %d %s", method, path, w.Code, w.Body.String())
		}
	}
	send("POST", "/api/custom-tags", CustomTag{Name: "Synthetic tag"}, s.customTagsHTTP)
	send("POST", "/api/presets", Preset{Name: "Synthetic preset", Service: "tool:placement", Query: "status=several"}, s.presetsHTTP)
	var presetID int64
	store.DB.QueryRow("SELECT id FROM presets WHERE name='Synthetic preset'").Scan(&presetID)
	send("DELETE", fmt.Sprintf("/api/presets?id=%d", presetID), nil, s.presetsHTTP)
	config := store.Recognition()
	config.Rules[0].Name = "Synthetic rule"
	send("PUT", "/api/recognition", config, s.recognitionHTTP)
	config = store.Recognition()
	deleted := config.Rules[0].Name
	config.Rules = config.Rules[1:]
	send("PUT", "/api/recognition", config, s.recognitionHTTP)
	events := eventQueryAll(t, store.Events, eventQuery{Sources: []string{"settings"}})
	messages := []string{}
	for _, event := range events.Events {
		messages = append(messages, event.Message)
	}
	for _, want := range []string{"Custom tags saved · {count} changes", "Preset saved: {name}", "Preset deleted: {name}", "Tag rule saved: {name}", "Tag rule deleted: {name}"} {
		if !slices.Contains(messages, want) {
			t.Errorf("missing event %s in %v", want, messages)
		}
	}
	foundDeleted := false
	for _, event := range events.Events {
		if event.Message == "Tag rule deleted: {name}" && event.Params["name"] == deleted {
			foundDeleted = true
		}
	}
	if !foundDeleted {
		t.Error("deleted rule event lost its name")
	}
}

func TestSettingsSaveHistory145(t *testing.T) {
	l, now := eventLogFixture(t)
	params := map[string]any{"areas": []string{"Display"}}
	l.Add("info", "settings", "", "Settings saved · {areas}", params, "Display", "interfaceTheme: default → nord")
	*now = now.Add(time.Second)
	l.Add("info", "settings", "", "Settings saved · {areas}", params, "Display", "pageSize: 100 → 500")
	page := eventQueryAll(t, l, eventQuery{Sources: []string{"settings"}})
	if page.Total != 2 {
		t.Fatalf("distinct saves must keep both details: %+v", page.Events)
	}
	details := []string{}
	for _, event := range page.Events {
		details = append(details, event.Detail)
		if event.Repeat != 1 {
			t.Error("save was merged")
		}
	}
	for _, want := range []string{"interfaceTheme: default → nord", "pageSize: 100 → 500"} {
		if !slices.Contains(details, want) {
			t.Error("lost save detail", want)
		}
	}
}
