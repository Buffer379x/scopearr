package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"runtime/debug"
	"strings"
	"testing"
	"time"
)

func TestUHDStandaloneAndRegionalSourceOverride(t *testing.T) {
	e := defaultRecognitionEngine
	for _, name := range []string{"Film.UHD.mkv", "Film.UHD.JAP.BluRay.mkv", "Film.UHD.US.BluRay.mkv", "Film.1080p.UHD.BluRay.mkv", "Film.uhd.it.bluray.mkv"} {
		r := e.Recognize(name)
		if r.Values["source"] != "UHD" || len(r.Conflicts) > 0 {
			t.Fatal(name, r)
		}
	}
	for name, want := range map[string]string{"Film.UHD.WEB-DL.mkv": "WEB-DL", "Film.UHD.WebRip.mkv": "WEBRip", "Film.UHD.DVD.mkv": "DVD"} {
		if got := e.Recognize(name).Values["source"]; got != want {
			t.Fatal(name, got)
		}
	}
	if got := e.Recognize("Film.BluRay.mkv").Values["source"]; got != "BluRay" {
		t.Fatal(got)
	}
	if got := e.Recognize("Film.MyUHDCollection.BluRay.mkv").Values["source"]; got != "BluRay" {
		t.Fatal(got)
	}
	if got := e.Recognize("Film.UHD.mkv").Values["resolution"]; got != "" {
		t.Fatal("source inferred resolution", got)
	}
}
func TestUHDUpgradePreservesUserRuleChoices(t *testing.T) {
	old := uhdBluRayDefaultRule()
	old.Pattern = `(?:^|[ ._\[\]()-])UHD[ ._-]+BluRay(?:$|[ ._\[\]()-])`
	old.Name = "My disc rule"
	old.Enabled = false
	flag := false
	old.Tag = &flag
	old.Priority = 77
	next, changed := upgradeRules054([]RecognitionRule{old})
	if !changed || next[0].Enabled || *next[0].Tag || next[0].Name != old.Name || next[0].Priority != 77 || next[0].ID != old.ID {
		t.Fatal(next, changed)
	}
	old.Pattern = "CUSTOM"
	next, changed = upgradeRules054([]RecognitionRule{old})
	if changed || next[0].Pattern != "CUSTOM" {
		t.Fatal(next)
	}
}
func TestSchemaTenReprocessesUHDAndPreservesTagFlags(t *testing.T) {
	s := testStore(t)
	rules := s.Recognition().Rules
	for i, r := range rules {
		if r.ID == "default-source-uhd-bluray" {
			rules[i].Pattern = `(?:^|[ ._\[\]()-])UHD[ ._-]+BluRay(?:$|[ ._\[\]()-])`
			rules[i].Name = "Source / UHD BluRay"
		}
	}
	engine, e := CompileRecognition(rules)
	if e != nil {
		t.Fatal(e)
	}
	s.recognition.Store(engine)
	s.Put("recognition", engine.Config())
	f := sample(1, "Film.UHD.JAP.BluRay.mkv")
	EnrichWithRules(&f, APIInfo{}, engine)
	if e = s.Replace("radarr", []File{f}, SyncStatus{}); e != nil {
		t.Fatal(e)
	}
	s.DB.Exec("PRAGMA user_version=9")
	dir := s.Dir
	s.DB.Close()
	restored, e := OpenStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer restored.DB.Close()
	var version int
	restored.DB.QueryRow("PRAGMA user_version").Scan(&version)
	if version != 16 {
		t.Fatal(version)
	}
	var source string
	restored.DB.QueryRow("SELECT source FROM files").Scan(&source)
	if source != "UHD" {
		t.Fatal(source)
	}
}
func TestRecognitionUpdateWaitsForSyncGate(t *testing.T) {
	s := testStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, e := NewServer(ctx, s, nil, "0.5.4")
	if e != nil {
		t.Fatal(e)
	}
	defer server.Sync.Shutdown()
	s.DB.Exec("INSERT INTO sessions VALUES(?,?,?)", tokenHash("rules-session"), "rules-csrf", time.Now().Add(time.Hour).Unix())
	cfg := s.Recognition()
	rules := append(cfg.Rules, RecognitionRule{ID: "test-054", Name: "Test", Field: "source", Match: "token", Pattern: "QATOKEN", Value: "DVD", Mode: "direct", Enabled: true})
	raw, _ := json.Marshal(map[string]any{"rules": rules, "revision": cfg.Revision})
	request := httptest.NewRequest("PUT", "/api/recognition", strings.NewReader(string(raw)))
	request.AddCookie(&http.Cookie{Name: "scopearr_session", Value: "rules-session"})
	request.Header.Set("X-CSRF-Token", "rules-csrf")
	server.Sync.gate <- struct{}{}
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() { w := httptest.NewRecorder(); server.Handler().ServeHTTP(w, request); done <- w }()
	select {
	case <-done:
		t.Fatal("write bypassed sync gate")
	case <-time.After(50 * time.Millisecond):
	}
	if s.Recognition().Revision != cfg.Revision {
		t.Fatal("rules changed while gate held")
	}
	<-server.Sync.gate
	select {
	case w := <-done:
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
	case <-time.After(5 * time.Second):
		t.Fatal("write never resumed")
	}
}

func TestRecognitionMemoryTargetRestoredAfterSuccessAndCancellation(t *testing.T) {
	old := debug.SetMemoryLimit(40 << 20)
	defer debug.SetMemoryLimit(old)
	s := testStore(t)
	cfg := s.Recognition()
	rules := append([]RecognitionRule{}, cfg.Rules...)
	rules[0].Enabled = !rules[0].Enabled
	saved, e := s.SaveRecognition(context.Background(), rules, cfg.Revision)
	if e != nil {
		t.Fatal(e)
	}
	if got := debug.SetMemoryLimit(-1); got != 40<<20 {
		t.Fatal("caller target not restored", got)
	}
	rules[0].Enabled = !rules[0].Enabled
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e = s.SaveRecognition(ctx, rules, saved.Revision); e == nil {
		t.Fatal("canceled save accepted")
	}
	if got := debug.SetMemoryLimit(-1); got != 40<<20 {
		t.Fatal("failed save changed caller target", got)
	}
}
