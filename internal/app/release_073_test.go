package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"path/filepath"
	"testing"
	"time"
)

func TestRetainedTraitTagsAndDeletionGuard(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	cfg := DefaultSettings()
	cfg.TagColors["source:BluRay"] = "#123456"
	if e := s.Put("settings", cfg); e != nil {
		t.Fatal(e)
	}
	if e := s.Replace("radarr", []File{sample(1, "One.1080p.x264.BluRay.mkv")}, SyncStatus{}); e != nil {
		t.Fatal(e)
	}
	if e := s.DeleteCatalogTag(ctx, "source", "BluRay"); e == nil {
		t.Fatal("linked trait deletable")
	}
	current := s.Recognition()
	if _, e := s.SaveRecognition(ctx, []RecognitionRule{}, current.Revision); e != nil {
		t.Fatal(e)
	}
	rows, e := s.TagCatalog(ctx)
	if e != nil {
		t.Fatal(e)
	}
	found := false
	for _, r := range rows {
		if r.Field == "source" && r.Value == "BluRay" {
			found = true
			if r.Count != 0 {
				t.Fatal(r)
			}
		}
	}
	if !found {
		t.Fatal("removed rule's tag vanished")
	}
	var saved Settings
	s.Get("settings", &saved)
	if saved.TagColors["source:BluRay"] != "#123456" {
		t.Fatal("color lost")
	}
	if e = s.DeleteCatalogTag(ctx, "source", "BluRay"); e != nil {
		t.Fatal(e)
	}
	rows, e = s.TagCatalog(ctx)
	if e != nil {
		t.Fatal(e)
	}
	for _, r := range rows {
		if r.Field == "source" && r.Value == "BluRay" {
			t.Fatal("deleted catalog tag returned")
		}
	}
	saved = Settings{}
	s.Get("settings", &saved)
	if saved.TagColors["source:BluRay"] != "" {
		t.Fatal("deleted color retained")
	}
}
func TestTraitCatalogCountsCompositeUnknownAndTombstone(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	f := sample(1, "One.1080p.x264.BluRay.mkv")
	f.Audio = "DTS + AC-3"
	f.UnknownTraits = []string{"audio"}
	if e := s.Replace("radarr", []File{f}, SyncStatus{}); e != nil {
		t.Fatal(e)
	}
	s.DB.Exec(`UPDATE files SET data=json_set(data,'$.unknownTraits',json('["audio"]'))`)
	all, _, e := allTraitCounts(ctx, s.DB)
	if e != nil || all["audio"]["DTS"] != 1 || all["audio"]["AC-3"] != 1 || all["audio"]["__unknown__"] != 1 {
		t.Fatal(all, e)
	}
	for _, field := range catalogFields {
		single, e := traitCounts(ctx, s.DB, field)
		if e != nil {
			t.Fatal(e)
		}
		a, _ := json.Marshal(single)
		b, _ := json.Marshal(all[field])
		if string(a) != string(b) {
			t.Fatal(field, string(a), string(b))
		}
	}
	s.TagCatalog(ctx)
	if e = s.DeleteCatalogTag(ctx, "codec", "x265"); e != nil {
		t.Fatal(e)
	}
	rows, _ := s.TagCatalog(ctx)
	for _, r := range rows {
		if r.Field == "codec" && r.Value == "x265" {
			t.Fatal("unused active-rule tag resurrected on read")
		}
	}
	if e = s.Replace("radarr", []File{sample(2, "Two.2160p.x265.UHD.mkv")}, SyncStatus{}); e != nil {
		t.Fatal(e)
	}
	rows, _ = s.TagCatalog(ctx)
	found := false
	for _, r := range rows {
		if r.Field == "codec" && r.Value == "x265" && r.Count == 1 {
			found = true
		}
	}
	if !found {
		t.Fatal("new recognition did not restore tag")
	}
}
func TestExternalDisplayAliasPreservesIdentityAndCounts(t *testing.T) {
	ctx := context.Background()
	s, f, c := importedFixture(t, "radarr")
	f.mu.Lock()
	f.auto = map[int][]int{4: {99}}
	f.mu.Unlock()
	if e := s.ImportTags(ctx, "radarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	id := customID(t, s, "favorite")
	tags, _ := s.CustomTags(ctx)
	var original CustomTag
	for _, tag := range tags {
		if tag.ID == id {
			original = tag
		}
	}
	if original.Count != 1 {
		t.Fatal(original)
	}
	original.DisplayName = "Favorite Quality"
	alias, e := s.SaveCustomTag(ctx, original)
	if e != nil || alias.DisplayName != "Favorite Quality" {
		t.Fatal(alias, e)
	}
	if _, _, e = s.ReconcileTags(ctx, "radarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	if f.creates != 0 || f.writes != 0 {
		t.Fatal("alias changed upstream", f.creates, f.writes)
	}
	got, e := s.Query(url.Values{"service": {"radarr"}, "custom": {fmt.Sprint(id)}}, "matches", false)
	if e != nil || got.Files[0].Custom[0].DisplayName != "Favorite Quality" {
		t.Fatal(got, e)
	}
	if e = s.DeleteCustomTag(ctx, id); e == nil {
		t.Fatal("protected/linked tag deleted")
	}
	f.mu.Lock()
	f.auto = nil
	f.mu.Unlock()
	if e = s.ImportTags(ctx, "radarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	if _, e = s.ApplyCustom(ctx, url.Values{"service": {"radarr"}}, map[string]bool{fmt.Sprint(id): false}); e != nil {
		t.Fatal(e)
	}
	if _, _, e = s.ReconcileTags(ctx, "radarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	tags, _ = s.CustomTags(ctx)
	for _, tag := range tags {
		if tag.ID == id && (tag.DisplayName != "Favorite Quality" || tag.Count != 0) {
			t.Fatal(tag)
		}
	}
	f.mu.Lock()
	delete(f.tags, 4)
	f.mu.Unlock()
	if e = s.ImportTags(ctx, "radarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	tags, _ = s.CustomTags(ctx)
	for _, tag := range tags {
		if tag.ID == id && (len(tag.Sources) != 0 || tag.DisplayName != "Favorite Quality") {
			t.Fatal("manual fallback lost alias", tag)
		}
	}
	f.mu.Lock()
	f.tags[44] = "favorite"
	f.media[10] = append(f.media[10], 44)
	f.mu.Unlock()
	if e = s.ImportTags(ctx, "radarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	tags, _ = s.CustomTags(ctx)
	for _, tag := range tags {
		if tag.ID == id && (len(tag.Sources) != 1 || tag.Count != 1 || tag.DisplayName != "Favorite Quality") {
			t.Fatal("returning tag lost management or alias", tag)
		}
	}
}
func TestHourlyAnchorBackCalculatesBeforeStart(t *testing.T) {
	now := time.Date(2026, 10, 14, 16, 59, 0, 0, scheduleLocation("Europe/Berlin"))
	c := ServiceConfig{Enabled: true, Interval: 60, SyncStart: "20:00"}
	next := nextSync(now, c, "Europe/Berlin")
	if next == nil || next.In(now.Location()).Hour() != 17 || next.In(now.Location()).Minute() != 0 {
		t.Fatal(next)
	}
	last := now.Add(-59 * time.Minute)
	if syncDue(now, &last, c, "Europe/Berlin") {
		t.Fatal("premature sync")
	}
	if !syncDue(now.Add(time.Minute), &last, c, "Europe/Berlin") {
		t.Fatal("17:00 missed")
	}
}
func TestStorageAliasesDoNotAlterSharing(t *testing.T) {
	cfg := DefaultSettings()
	cfg.Radarr = ServiceConfig{Enabled: true, URL: "http://r"}
	cfg.Sonarr = ServiceConfig{Enabled: true, URL: "http://s"}
	cfg.Widgets.Storage = map[string][]StorageSelection{"radarr": {{Path: "/movies", Name: "Films"}, {Path: "/downloads", Name: "SSD cache", SharedGroup: "cache"}}, "sonarr": {{Path: "/downloads", Name: "Downloads", SharedGroup: "cache"}}}
	if e := normalizeSettings(&cfg); e != nil {
		t.Fatal(e)
	}
	now := time.Now()
	snap := map[string]StorageSnapshot{"radarr": {Disks: []DiskSpace{{Path: "/movies", Total: 100, Free: 30}, {Path: "/downloads", Total: 50, Free: 20}}, SuccessAt: &now, Source: tagEndpoint(cfg.Radarr)}, "sonarr": {Disks: []DiskSpace{{Path: "/downloads", Total: 50, Free: 20}}, SuccessAt: &now, Source: tagEndpoint(cfg.Sonarr)}}
	all := storageAreas(cfg, snap, "all")
	if len(all) != 2 {
		t.Fatal(all)
	}
	for _, area := range all {
		if area.Key == "shared:cache" && (area.Label != "SSD cache" || area.Total != 50) {
			t.Fatal(area)
		}
	}
	cfg.Widgets.Storage["radarr"][0].Name = ""
	normalizeSettings(&cfg)
	if cfg.Widgets.Storage["radarr"][0].Name != "/movies" {
		t.Fatal(cfg.Widgets)
	}
}
func TestSchema13BackupAndCatalogAliasRestart(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	tag, _ := s.SaveCustomTag(ctx, CustomTag{Name: "kept"})
	s.DB.Exec("DROP TABLE custom_tag_labels; DROP TABLE display_tag_catalog; PRAGMA user_version=12")
	dir := s.Dir
	s.DB.Close()
	reopened, e := OpenStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer reopened.DB.Close()
	var version int
	reopened.DB.QueryRow("PRAGMA user_version").Scan(&version)
	backups, _ := filepath.Glob(filepath.Join(dir, "backups", "*.db"))
	if version != 15 || len(backups) == 0 {
		t.Fatal(version, backups)
	}
	tag.DisplayName = "Kept"
	if _, e = reopened.SaveCustomTag(ctx, tag); e != nil {
		t.Fatal(e)
	}
	tags, e := reopened.CustomTags(ctx)
	if e != nil || tags[0].DisplayName != "Kept" {
		t.Fatal(tags, e)
	}
}

func TestCustomDisplayNameSortMatchesVisibleOrder(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	a, _ := s.SaveCustomTag(ctx, CustomTag{Name: "alpha", DisplayName: "Zulu"})
	b, _ := s.SaveCustomTag(ctx, CustomTag{Name: "bravo", DisplayName: "Alpha"})
	s.Replace("radarr", []File{sample(1, "One.mkv"), sample(2, "Two.mkv")}, SyncStatus{})
	s.ApplyCustom(ctx, url.Values{"service": {"radarr"}, "fileId": {"1"}}, map[string]bool{fmt.Sprint(a.ID): true})
	s.ApplyCustom(ctx, url.Values{"service": {"radarr"}, "fileId": {"2"}}, map[string]bool{fmt.Sprint(b.ID): true})
	out, e := s.Query(url.Values{"service": {"radarr"}, "sort": {"custom"}, "dir": {"asc"}}, "matches", false)
	if e != nil || len(out.Files) != 2 || out.Files[0].ID != 2 {
		t.Fatal(out, e)
	}
}
