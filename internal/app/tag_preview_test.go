package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestTagPreviewReadOnlyConsentAndNewForeignAssignments(t *testing.T) {
	s := testStore(t)
	f, h := newTagFixture(t, "radarr")
	c := tagConfig(h)
	c.TagSync = TagGroups{Resolution: true}
	c.TagSyncMode = "replace"
	file := sample(1, "Movie.1080p.mkv")
	file.MediaID = 10
	seedTags(t, s, "radarr", c, []File{file})
	p, e := s.BuildTagPlan(context.Background(), "radarr", c, nil)
	if e != nil || !p.Preview.ApprovalRequired || len(p.Preview.Rows) == 0 {
		t.Fatal(p, e)
	}
	if f.creates != 0 || f.writes != 0 {
		t.Fatal("preview mutated remote data")
	}
	if _, _, e = s.ReconcileTags(context.Background(), "radarr", c, func() bool { return true }); !errors.Is(e, ErrTagApproval) {
		t.Fatal(e)
	}
	if f.creates != 0 || f.writes != 0 {
		t.Fatal("unapproved reconciliation wrote data")
	}
	if e = s.ApproveTagPlan(context.Background(), p); e != nil {
		t.Fatal(e)
	}
	if _, waiting, e := s.ReconcileTags(context.Background(), "radarr", c, func() bool { return true }); e != nil || waiting {
		t.Fatal(waiting, e)
	}
	file.Filename = "Movie.2160p.mkv"
	Enrich(&file, APIInfo{})
	seedTags(t, s, "radarr", c, []File{file})
	if _, waiting, e := s.ReconcileTags(context.Background(), "radarr", c, func() bool { return true }); e != nil || waiting {
		t.Fatal("managed resolution change needs redundant approval", waiting, e)
	}
	f.mu.Lock()
	f.tags[37] = "archive"
	f.media[10] = append(f.media[10], 37)
	f.mu.Unlock()
	p, e = s.BuildTagPlan(context.Background(), "radarr", c, nil)
	if e != nil || !p.Preview.ApprovalRequired {
		t.Fatal(p, e)
	}
	if _, _, e = s.ReconcileTags(context.Background(), "radarr", c, func() bool { return true }); !errors.Is(e, ErrTagApproval) {
		t.Fatal("new foreign assignment not protected", e)
	}
	if got := fmt.Sprint(f.names(10)); got != "[2160p archive]" {
		t.Fatal(got)
	}
	if e = s.ApproveTagPlan(context.Background(), p); e != nil {
		t.Fatal(e)
	}
	if _, _, e = s.ReconcileTags(context.Background(), "radarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	// A recreated manual definition/assignment must not inherit consumed consent.
	f.mu.Lock()
	f.tags[37] = "archive"
	f.media[10] = append(f.media[10], 37)
	f.mu.Unlock()
	p, e = s.BuildTagPlan(context.Background(), "radarr", c, nil)
	if e != nil || !p.Preview.ApprovalRequired {
		t.Fatal("consent reused", p, e)
	}
}
func TestTagPreviewAPIRejectsMissingCSRFAndStaleRemoteState(t *testing.T) {
	store := testStore(t)
	f, h := newTagFixture(t, "radarr")
	c := tagConfig(h)
	c.TagSync = TagGroups{Resolution: true}
	c.TagSyncMode = "replace"
	file := sample(1, "Movie.1080p.mkv")
	file.MediaID = 10
	seedTags(t, store, "radarr", c, []File{file})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, e := NewServer(ctx, store, nil, "0.5.3")
	if e != nil {
		t.Fatal(e)
	}
	defer server.Sync.Shutdown()
	server.mu.Lock()
	server.settings.Radarr = c
	server.mu.Unlock()
	store.DB.Exec("INSERT INTO sessions(token,csrf,expires) VALUES(?,?,?)", tokenHash("review-session"), "review-csrf", time.Now().Add(time.Hour).Unix())
	call := func(path string, body any, auth, csrf bool) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(body)
		r := httptest.NewRequest("POST", path, strings.NewReader(string(raw)))
		if auth {
			r.AddCookie(&http.Cookie{Name: "scopearr_session", Value: "review-session"})
		}
		if csrf {
			r.Header.Set("X-CSRF-Token", "review-csrf")
		}
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, r)
		return w
	}
	input := map[string]any{"service": "radarr", "config": c}
	if w := call("/api/tag-preview", input, false, false); w.Code != 401 {
		t.Fatal(w.Code)
	}
	if w := call("/api/tag-preview", input, true, false); w.Code != 403 {
		t.Fatal(w.Code)
	}
	w := call("/api/tag-preview", input, true, true)
	if w.Code != 200 || strings.Contains(w.Body.String(), "synthetic") {
		t.Fatal(w.Code, w.Body.String())
	}
	var preview TagPreview
	json.Unmarshal(w.Body.Bytes(), &preview)
	f.mu.Lock()
	f.tags[99] = "new-manual"
	f.media[10] = append(f.media[10], 99)
	f.mu.Unlock()
	w = call("/api/tag-approval", map[string]any{"service": "radarr", "token": preview.Token}, true, true)
	if w.Code != 409 {
		t.Fatal("stale preview accepted", w.Code, w.Body.String())
	}
	if f.creates != 0 || f.writes != 0 {
		t.Fatal("stale approval wrote data")
	}
}
func TestUnknownTagsAreCategoryScopedAndSeriesUnionRetainsMissingValues(t *testing.T) {
	s := testStore(t)
	_, h := newTagFixture(t, "sonarr")
	c := tagConfig(h)
	c.TagSync = TagGroups{Resolution: true, Codec: true, Source: true, Audio: true, Language: true, HDR: true, BitDepth: true, Channels: true}
	a := sample(1, "Show.S01E01.1080p.x264.mkv")
	a.MediaID = 10
	b := sample(2, "Show.S01E02.mkv")
	b.MediaID = 10
	seedTags(t, s, "sonarr", c, []File{a, b})
	desired, e := s.desiredTags(context.Background(), "sonarr", c.TagSync)
	if e != nil {
		t.Fatal(e)
	}
	for _, label := range []string{"1080p", "x264", "resolution-unknown", "codec-unknown", "source-unknown", "audio-codec-unknown", "language-unknown", "hdr-unknown", "bit-depth-unknown", "channels-unknown"} {
		if !desired[10][label] {
			t.Fatal("missing category-scoped value", label, desired)
		}
	}
	if desired[10]["unknown"] || desired[10]["custom-unknown"] {
		t.Fatal(desired)
	}
}
func TestExactFileCustomAssignmentDoesNotChangeSameTitleOrFilterPeers(t *testing.T) {
	s := testStore(t)
	a := sample(1, "Same.1080p.mkv")
	b := sample(2, "Same.2160p.mkv")
	a.Title = "Same"
	b.Title = "Same"
	if e := s.Replace("radarr", []File{a, b}, SyncStatus{}); e != nil {
		t.Fatal(e)
	}
	tag, e := s.SaveCustomTag(context.Background(), CustomTag{Name: "Personal"})
	if e != nil {
		t.Fatal(e)
	}
	q := url.Values{"service": {"radarr"}, "fileId": {"1"}}
	if n, e := s.ApplyCustom(context.Background(), q, map[string]bool{fmt.Sprint(tag.ID): true}); e != nil || n != 1 {
		t.Fatal(n, e)
	}
	result, e := s.Query(url.Values{"service": {"radarr"}, "custom": {fmt.Sprint(tag.ID)}}, "matches", false)
	if e != nil || result.Total != 1 || result.Files[0].ID != 1 {
		t.Fatal(result, e)
	}
	if _, _, e := where(url.Values{"service": {"radarr"}, "fileId": {"1 OR 1=1"}}); e == nil {
		t.Fatal("invalid exact target accepted")
	}
}
func TestUHDPairPresentationFlagsAndStandardNames(t *testing.T) {
	for _, name := range []string{"Film.UHD.BluRay.mkv", "Film.UHD-BluRay.mkv", "Film.UHD BluRay.mkv"} {
		if got := defaultRecognitionEngine.Recognize(name); got.Values["source"] != "UHD" || len(got.Conflicts) != 0 {
			t.Fatal(name, got)
		}
	}
	if defaultRecognitionEngine.Recognize("Film.BluRay.mkv").Values["source"] != "BluRay" {
		t.Fatal("generic BluRay changed")
	}
	s := testStore(t)
	rules := s.Recognition().Rules
	off := false
	for i, r := range rules {
		if r.Field == "source" && r.Value == "BDRip" {
			rules[i].Tag = &off
		}
	}
	if _, e := s.SaveRecognition(context.Background(), rules, s.Recognition().Revision); e != nil {
		t.Fatal(e)
	}
	values, e := s.DisplayTags(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	for _, v := range values["source"] {
		if v == "BDRip" {
			t.Fatal("info-only value still has color setting")
		}
	}
	for _, r := range DefaultRecognitionRules() {
		if strings.Contains(r.Name, " · ") {
			t.Fatal(r.Name)
		}
	}
}

func TestInformationFlagFollowsWinningRuleAndRemovesUnusedColorChoice(t *testing.T) {
	s := testStore(t)
	file := sample(1, "Movie.UHD.BluRay.mkv")
	if e := s.Replace("radarr", []File{file}, SyncStatus{}); e != nil {
		t.Fatal(e)
	}
	rules := s.Recognition().Rules
	off := false
	for i, r := range rules {
		if r.ID == "default-source-uhd-bluray" {
			rules[i].Tag = &off
		}
	}
	if _, e := s.SaveRecognition(context.Background(), rules, s.Recognition().Revision); e != nil {
		t.Fatal(e)
	}
	result, e := s.Query(url.Values{"service": {"radarr"}, "source": {"UHD"}}, "matches", false)
	if e != nil || result.Total != 1 || fmt.Sprint(result.Files[0].InformationOnly["source"]) != "[UHD]" {
		t.Fatal(result, e)
	}
	registry, e := s.DisplayTags(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	for _, v := range registry["source"] {
		if v == "UHD" {
			t.Fatal("unmatched UHDBD rule restored the color choice")
		}
	}
}

func TestAdoptedDefinitionKeepsItsOriginAndAllowsNormalAutomaticUpdates(t *testing.T) {
	s := testStore(t)
	_, h := newTagFixture(t, "radarr")
	c := tagConfig(h)
	c.TagSync = TagGroups{Codec: true}
	file := sample(1, "Movie.1080p.x264.mkv")
	file.MediaID = 10
	seedTags(t, s, "radarr", c, []File{file})
	reconcile(t, s, "radarr", c)
	file.Filename = "Movie.1080p.x265.mkv"
	Enrich(&file, APIInfo{})
	seedTags(t, s, "radarr", c, []File{file})
	p, e := s.BuildTagPlan(context.Background(), "radarr", c, nil)
	if e != nil || p.Preview.ApprovalRequired {
		t.Fatal("previously adopted codec needs redundant approval", p, e)
	}
	found := false
	for _, row := range p.Preview.Rows {
		if row.Label == "x264" {
			found = true
			if row.Origin != "existing" {
				t.Fatal("reused definition falsely claimed as created", row)
			}
		}
	}
	if !found {
		t.Fatal(p.Preview.Rows)
	}
	if _, waiting, e := s.ReconcileTags(context.Background(), "radarr", c, func() bool { return true }); e != nil || waiting {
		t.Fatal(waiting, e)
	}
}

func TestSchemaNinePreservesCredentialsRulesAndQueuesActiveTags(t *testing.T) {
	s := testStore(t)
	sec, e := NewSecurity(s)
	if e != nil {
		t.Fatal(e)
	}
	if e = sec.Setup("admin", "Synthetic-migration-2026", sec.setupToken); e != nil {
		t.Fatal(e)
	}
	cfg := DefaultSettings()
	cfg.Radarr = ServiceConfig{Enabled: true, URL: "http://example.invalid", APIKey: sec.Seal("synthetic-migration-key"), TagSync: TagGroups{Source: true}, TagSyncMode: "add"}
	s.Put("settings", cfg)
	rules := DefaultRecognitionRules()
	old := []RecognitionRule{}
	for _, r := range rules {
		if r.ID == "default-source-uhd-bluray" {
			continue
		}
		r.Name = r.Field + " · " + strings.TrimPrefix(r.Name, ruleFieldName(r.Field)+" / ")
		if r.Field == "audio" && r.Value == "TrueHD" {
			r.Name = "My custom audio name"
		}
		old = append(old, r)
	}
	engine, e := CompileRecognition(old)
	if e != nil {
		t.Fatal(e)
	}
	s.Put("recognition", engine.Config())
	s.DB.Exec("PRAGMA user_version=8")
	dir := s.Dir
	s.DB.Close()
	restored, e := OpenStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer restored.DB.Close()
	sec2, e := NewSecurity(restored)
	if e != nil || !sec2.Initialized() {
		t.Fatal(e)
	}
	var saved Settings
	if e = restored.Get("settings", &saved); e != nil {
		t.Fatal(e)
	}
	key, e := sec2.Open(saved.Radarr.APIKey)
	if e != nil || key != "synthetic-migration-key" {
		t.Fatal("credential migration failed", e)
	}
	var dirty bool
	restored.Get("tagSyncDirty:radarr", &dirty)
	if !dirty {
		t.Fatal("active output was not queued")
	}
	found := false
	for _, r := range restored.Recognition().Rules {
		if r.ID == "default-source-uhd-bluray" {
			found = true
		}
		if r.Field == "audio" && r.Value == "TrueHD" && r.Name != "My custom audio name" {
			t.Fatal("custom name changed")
		}
	}
	if !found {
		t.Fatal("new default missing")
	}
}
