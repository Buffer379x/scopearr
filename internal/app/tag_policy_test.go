package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"testing"
)

func stagePolicy(t *testing.T, s *Store, old, next ServiceConfig) {
	t.Helper()
	if e := validateTagPolicy(old, next); e != nil {
		t.Fatal(e)
	}
	a, b := DefaultSettings(), DefaultSettings()
	a.Radarr = old
	b.Radarr = next
	if e := s.saveSettingsWithAllTagPolicies(context.Background(), b, a, b, nil); e != nil {
		t.Fatal(e)
	}
}
func TestTagPoliciesAddKeepReplaceDeleteAndSharedValues(t *testing.T) {
	s := testStore(t)
	f, h := newTagFixture(t, "radarr")
	c := tagConfig(h)
	c.TagSync = TagGroups{Resolution: true, Codec: true}
	c.TagSyncMode = "add"
	file := sample(1, "Movie.1080p.x264.UHDBD.mkv")
	file.MediaID = 10
	seedTags(t, s, "radarr", c, []File{file})
	off := c
	off.TagSync = TagGroups{}
	stagePolicy(t, s, off, c)
	reconcile(t, s, "radarr", c)
	if got := fmt.Sprint(f.names(10)); got != "[1080p favorite manual obsolete x264]" {
		t.Fatal(got)
	}
	old := c
	c.TagSync.Resolution = false
	c.TagSyncDisable = "keep"
	stagePolicy(t, s, old, c)
	reconcile(t, s, "radarr", c)
	// Kept groups survive later replacement syncs as well as changed file values.
	c.TagSyncMode = "replace" // Same persistent policy, no fresh overwrite decision.
	file.Filename = "Movie.2160p.x265.mkv"
	Enrich(&file, APIInfo{})
	seedTags(t, s, "radarr", c, []File{file})
	reconcile(t, s, "radarr", c)
	if got := fmt.Sprint(f.names(10)); got != "[1080p x265]" {
		t.Fatal("kept group lost", got)
	}
	old = c
	c.TagSync.Resolution = true
	c.TagSyncMode = "replace"
	stagePolicy(t, s, old, c)
	reconcile(t, s, "radarr", c)
	if got := fmt.Sprint(f.names(10)); got != "[2160p x265]" {
		t.Fatal("explicit overwrite did not clear kept group", got)
	}
	// A custom tag shares the resolution label; disabling resolution must keep it.
	tag, e := s.SaveCustomTag(context.Background(), CustomTag{Name: "2160p"})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.ApplyCustom(context.Background(), mapQuery("radarr"), map[string]bool{fmt.Sprint(tag.ID): true}); e != nil {
		t.Fatal(e)
	}
	old = c
	c.TagSync.Custom = true
	stagePolicy(t, s, old, c)
	reconcile(t, s, "radarr", c)
	old = c
	c.TagSync.Resolution = false
	c.TagSyncDisable = "delete"
	stagePolicy(t, s, old, c)
	reconcile(t, s, "radarr", c)
	if got := fmt.Sprint(f.names(10)); got != "[2160p x265]" {
		t.Fatal("shared tag removed", got)
	}
	old = c
	c.TagSync = TagGroups{}
	c.TagSyncDisable = "delete"
	stagePolicy(t, s, old, c)
	reconcile(t, s, "radarr", c)
	if len(f.media[10]) > 0 || len(f.tags) > 0 {
		t.Fatal("delete left empty definitions", f.tags, f.media)
	}
}
func TestTagKeepAllStopsWritesAndSurvivesRestart(t *testing.T) {
	s := testStore(t)
	f, h := newTagFixture(t, "radarr")
	c := tagConfig(h)
	c.TagSyncMode = "add"
	file := sample(1, "Movie.1080p.x264.mkv")
	file.MediaID = 10
	seedTags(t, s, "radarr", c, []File{file})
	reconcile(t, s, "radarr", c)
	old := c
	c.TagSync = TagGroups{}
	c.TagSyncDisable = "keep"
	stagePolicy(t, s, old, c)
	before := f.reads
	reconcile(t, s, "radarr", c)
	if f.reads != before || fmt.Sprint(f.names(10)) != "[1080p favorite manual obsolete x264]" {
		t.Fatal("keep contacted service or changed assignments")
	}
	dir := s.Dir
	s.DB.Close()
	restored, e := OpenStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer restored.DB.Close()
	reconcile(t, restored, "radarr", c)
	if f.reads != before {
		t.Fatal("restart forgot keep choice")
	}
}
func TestTagDefinitionUsageGuardAndRetry(t *testing.T) {
	s := testStore(t)
	f, h := newTagFixture(t, "radarr")
	f.protected[1] = true
	c := tagConfig(h)
	c.TagSyncMode = "replace"
	file := sample(1, "Movie.1080p.x264.mkv")
	file.MediaID = 10
	seedTags(t, s, "radarr", c, []File{file})
	reconcile(t, s, "radarr", c)
	if f.tags[1] != "manual" {
		t.Fatal("deleted import-list tag")
	}
	var retained int
	if e := s.Get("tagSyncRetained:radarr", &retained); e != nil || retained != 1 {
		t.Fatal(retained, e)
	}
	f.protected[1] = false
	reconcile(t, s, "radarr", c)
	if _, ok := f.tags[1]; ok {
		t.Fatal("pending cleanup was lost")
	}
	for _, raw := range []string{`{"id":2,"label":"x264"}`, `{"id":2,"label":"x264","movieIds":null}`, `{"id":2,"label":"x264","movieIds":[],"futureUsage":true}`} {
		var detail map[string]json.RawMessage
		json.Unmarshal([]byte(raw), &detail)
		if unused, e := tagUnused(detail, "radarr", 2, "x264"); unused || e == nil {
			t.Fatal("unsafe usage accepted", raw)
		}
	}
}
func TestAdditiveCustomRemovalKeepsPreexistingUnownedAssignments(t *testing.T) {
	s := testStore(t)
	f, h := newTagFixture(t, "radarr")
	c := tagConfig(h)
	c.TagSyncMode = "add"
	file := sample(1, "Movie.1080p.x264.mkv")
	file.MediaID = 10
	seedTags(t, s, "radarr", c, []File{file})
	tag, _ := s.SaveCustomTag(context.Background(), CustomTag{Name: "Favorite"})
	reconcile(t, s, "radarr", c)
	if got := fmt.Sprint(f.names(10)); got != "[1080p favorite manual obsolete x264]" {
		t.Fatal(got)
	}
	s.ApplyCustom(context.Background(), mapQuery("radarr"), map[string]bool{fmt.Sprint(tag.ID): true})
	reconcile(t, s, "radarr", c)
	s.ApplyCustom(context.Background(), mapQuery("radarr"), map[string]bool{fmt.Sprint(tag.ID): false})
	reconcile(t, s, "radarr", c)
	if got := fmt.Sprint(f.names(10)); got != "[1080p manual obsolete x264]" {
		t.Fatal("owned custom removal or foreign retention failed", got)
	}
}
func TestTagChoicesValidatedAndUHDBDDefault(t *testing.T) {
	old := ServiceConfig{Enabled: true, URL: "http://example"}
	next := old
	next.TagSync.Source = true
	if validateTagPolicy(old, next) == nil {
		t.Fatal("missing activation choice accepted")
	}
	next.TagSyncMode = "add"
	if e := validateTagPolicy(old, next); e != nil {
		t.Fatal(e)
	}
	old = next
	next.TagSync.Source = false
	if validateTagPolicy(old, next) == nil {
		t.Fatal("missing disable choice accepted")
	}
	next.TagSyncDisable = "delete"
	next.Enabled = false
	if validateTagPolicy(old, next) == nil {
		t.Fatal("unreachable cleanup accepted")
	}
	result := defaultRecognitionEngine.Recognize("Movie.UHDBD.x265.mkv")
	if result.Values["source"] != "UHD" {
		t.Fatal(result)
	}
	legacy := DefaultRecognitionRules()
	filtered := []RecognitionRule{}
	for _, r := range legacy {
		if r.ID != "default-source-uhdbd" {
			filtered = append(filtered, r)
		}
	}
	legacy = filtered
	with, changed := addUHDBDDefault(legacy)
	if !changed || len(with) != len(legacy)+1 {
		t.Fatal("missing upgrade default")
	}
	if _, changed = addUHDBDDefault(with); changed {
		t.Fatal("duplicate default")
	}
	custom := append(legacy, RecognitionRule{ID: "custom-uhd", Field: "source", Match: "token", Pattern: "UHDBD", Value: "UHD", Enabled: false})
	if _, changed = addUHDBDDefault(custom); changed {
		t.Fatal("disabled custom rule overridden")
	}
}

func mapQuery(service string) url.Values { return url.Values{"service": {service}} }

func TestUHDBDSpecificSourceAndCustomizedEquivalent(t *testing.T) {
	result := defaultRecognitionEngine.Recognize("Movie.UHDBD.BluRay.Remux.mkv")
	if result.Values["source"] != "UHD" || len(result.Conflicts) != 0 {
		t.Fatal(result)
	}
	rules := DefaultRecognitionRules()
	rules = rules[:len(rules)-1]
	rules = append(rules, RecognitionRule{ID: "user-uhd", Name: "Custom conditional UHD", Field: "source", Match: "regex", Pattern: "(?i)uhdbd", Value: "UHD", Mode: "fallback", Priority: 10, Enabled: false})
	if _, changed := addUHDBDDefault(rules); changed {
		t.Fatal("existing disabled custom recognition bypassed")
	}
}
