package app

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func eventLogFixture(t *testing.T) (*EventLog, *time.Time) {
	t.Helper()
	s, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.DB.Close() })
	now := time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)
	s.Events.now = func() time.Time { return now }
	return s.Events, &now
}

func eventQueryAll(t *testing.T, l *EventLog, q eventQuery) eventPage {
	t.Helper()
	page, err := l.query(context.Background(), q)
	if err != nil {
		t.Fatal(err)
	}
	return page
}

func TestEventLogFiltersSortAndCounts144(t *testing.T) {
	l, now := eventLogFixture(t)
	l.Info("sync", "radarr", "Sync completed · {count} files in {seconds} s", map[string]any{"count": 3, "seconds": 1}, "")
	*now = now.Add(time.Second)
	l.Warning("tags", "sonarr", "Tag removals need approval", nil, "", "")
	*now = now.Add(time.Second)
	l.Error("mux", "radarr", "Mux job failed", map[string]any{"job": 7}, "Dune.mkv", "exit status 2")
	page := eventQueryAll(t, l, eventQuery{})
	if page.Total != 3 || page.Events[0].Level != "error" || page.Events[2].Level != "info" {
		t.Fatalf("default order is newest first: %+v", page.Events)
	}
	page = eventQueryAll(t, l, eventQuery{Sort: "ts", Dir: "asc"})
	if page.Events[0].Source != "sync" {
		t.Fatal("ascending order", page.Events)
	}
	page = eventQueryAll(t, l, eventQuery{Sort: "level", Dir: "desc"})
	if page.Events[0].Level != "error" || page.Events[1].Level != "warning" {
		t.Fatal("level order", page.Events)
	}
	page = eventQueryAll(t, l, eventQuery{Levels: []string{"error", "warning"}, Instances: []string{"radarr"}})
	if page.Total != 1 || page.Events[0].Message != "Mux job failed" {
		t.Fatal("level and instance filters combine", page.Events)
	}
	// Counts ignore their own filter so the menu still offers the other values.
	if page.Counts["level"]["info"] != 1 || page.Counts["level"]["error"] != 1 || page.Counts["instance"]["sonarr"] != 1 {
		t.Fatal("counts", page.Counts)
	}
	for _, term := range []string{"dune", "EXIT STATUS", "files in"} {
		if got := eventQueryAll(t, l, eventQuery{Q: term}); got.Total != 1 {
			t.Fatalf("search %q: %d", term, got.Total)
		}
	}
	if got := eventQueryAll(t, l, eventQuery{Limit: 1, Offset: 1}); len(got.Events) != 1 || got.Total != 3 || got.Events[0].Source != "tags" {
		t.Fatal("pagination", got)
	}
	if got := eventQueryAll(t, l, eventQuery{Q: "7"}); got.Total != 1 || got.Events[0].Params["job"] != float64(7) {
		t.Fatal("params are searchable and returned", got.Events)
	}

}

func TestEventLogMergeRotationAndLimit144(t *testing.T) {
	l, now := eventLogFixture(t)
	for n := 0; n < 3; n++ {
		l.Warning("webhook", "radarr", "Webhook request rejected from {ip}", map[string]any{"ip": "10.0.0.2"}, "", "")
		*now = now.Add(time.Minute)
	}
	page := eventQueryAll(t, l, eventQuery{})
	if page.Total != 1 || page.Events[0].Repeat != 3 {
		t.Fatal("repeats within ten minutes merge", page.Events)
	}
	*now = now.Add(11 * time.Minute)
	l.Warning("webhook", "radarr", "Webhook request rejected from {ip}", map[string]any{"ip": "10.0.0.2"}, "", "")
	if got := eventQueryAll(t, l, eventQuery{}); got.Total != 2 {
		t.Fatal("a repeat after ten minutes is a new row", got.Total)
	}
	l.Flush()
	*now = now.Add(25 * time.Hour)
	if got := eventQueryAll(t, l, eventQuery{}); got.Total != 0 {
		t.Fatal("entries older than 24 hours are hidden", got.Total)
	}
	l.prune()
	var rows int
	if err := l.db.QueryRow("SELECT count(*) FROM event_log").Scan(&rows); err != nil || rows != 0 {
		t.Fatal("prune removes expired rows", rows, err)
	}
	batch := make([]Event, 0, eventLimit+10)
	ts := now.UnixMilli()
	for n := 0; n < eventLimit+5; n++ {
		batch = append(batch, Event{TS: ts + int64(n), Level: "info", Source: "system", Message: "Info", Params: map[string]any{"n": n}, Repeat: 1})
	}
	for n := 0; n < 5; n++ {
		batch = append(batch, Event{TS: ts - int64(n) - 1, Level: "error", Source: "system", Message: "Old error", Params: map[string]any{"n": n}, Repeat: 1})
	}
	l.write(batch)
	l.prune()
	var errors, total int
	_ = l.db.QueryRow("SELECT count(*) FROM event_log").Scan(&total)
	_ = l.db.QueryRow("SELECT count(*) FROM event_log WHERE level='error'").Scan(&errors)
	if total != eventLimit || errors != 5 {
		t.Fatal("limit removes the oldest info entries first", total, errors)
	}
}

func TestEventLogBufferAndRedaction144(t *testing.T) {
	l, _ := eventLogFixture(t)
	for n := 0; n < eventBuffer; n++ {
		l.Info("system", "", "Filler {n}", map[string]any{"n": n}, "")
	}
	l.Info("system", "", "Dropped info", nil, "")
	l.Error("system", "", "Kept error", nil, "", "")
	if l.dropped.Load() != 1 {
		t.Fatal("a full buffer drops info", l.dropped.Load())
	}
	var kept int
	_ = l.db.QueryRow("SELECT count(*) FROM event_log WHERE message='Kept error'").Scan(&kept)
	if kept != 1 {
		t.Fatal("errors are written directly when the buffer is full")
	}
	l.Flush()
	l.Error("sync", "radarr", "Sync failed", map[string]any{"url": "http://user:secret@radarr:7878/api?apikey=abc123"}, "token=xyz", `Get "http://radarr/api/v3?apikey=abc123": X-Api-Key: abc123; password="hunter2" Authorization: Bearer abc.def`)
	page := eventQueryAll(t, l, eventQuery{Sources: []string{"sync"}})
	raw, _ := json.Marshal(page.Events)
	for _, secret := range []string{"secret@", "abc123", "xyz", "hunter2", "abc.def"} {
		if strings.Contains(string(raw), secret) {
			t.Fatalf("secret %q stored: %s", secret, raw)
		}
	}
	if !strings.Contains(string(raw), "[redacted]") || !strings.Contains(string(raw), "radarr:7878") {
		t.Fatal("redaction keeps context", string(raw))
	}
}

func TestEventLogHTTP144(t *testing.T) {
	s, _ := placementFixture130(t)
	s.Store.Events.Error("mux", "radarr", "Mux job failed", map[string]any{"job": 4}, "Dune.mkv", "exit status 2")
	s.Store.Events.Info("auth", "", "Signed in from {ip}", map[string]any{"ip": "10.0.0.5"}, "admin")
	call := func(method, target string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		s.eventsHTTP(w, httptest.NewRequest(method, target, nil))
		return w
	}
	w := call("GET", "/api/events?level=error&sort=level&dir=asc")
	var page eventPage
	if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil || w.Code != 200 || page.Total != 1 {
		t.Fatal(w.Code, w.Body.String())
	}
	for _, bad := range []string{"/api/events?level=debug", "/api/events?source=shell", "/api/events?sort=message"} {
		if w := call("GET", bad); w.Code != 400 {
			t.Fatal(bad, w.Code)
		}
	}
	w = call("GET", "/api/events/export?format=txt")
	text := w.Body.String()
	if w.Code != 200 || !strings.Contains(w.Header().Get("Content-Disposition"), ".txt") || !strings.Contains(text, "ERROR [mux/") || !strings.Contains(text, "Signed in from 10.0.0.5 · admin") {
		t.Fatal(w.Code, text)
	}
	w = call("GET", "/api/events/export?format=json&source=auth")
	var exported []Event
	if err := json.Unmarshal(w.Body.Bytes(), &exported); err != nil || len(exported) != 1 || exported[0].Source != "auth" {
		t.Fatal("json export follows filters", w.Body.String())
	}
	s.Demo = true
	if w := call("DELETE", "/api/events"); w.Code != 403 {
		t.Fatal("demo clear", w.Code)
	}
	s.Demo = false
	if w := call("DELETE", "/api/events"); w.Code != 200 {
		t.Fatal("clear", w.Code)
	}
	w = call("GET", "/api/events")
	_ = json.Unmarshal(w.Body.Bytes(), &page)
	if page.Total != 1 || page.Events[0].Message != "Log cleared" {
		t.Fatal("clear leaves one note", w.Body.String())
	}
	if w := call("POST", "/api/events"); w.Code != 405 {
		t.Fatal("method", w.Code)
	}
}
