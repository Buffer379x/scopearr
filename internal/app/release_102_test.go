package app

import (
	"context"
	"net/url"
	"testing"
)

func TestSDColorCatalog102(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	files := []File{}
	for i, resolution := range []string{"480p", "576p", "244p", "480i", "576P", "000480p", "720p", "1080p", "", "0p", "SD", "576x244p"} {
		f := sample(i+1, "Example.mkv")
		f.APIInfo = nil
		f.Evidence = nil
		f.Resolution = resolution
		files = append(files, f)
	}
	if err := s.Replace("radarr", files, SyncStatus{}); err != nil {
		t.Fatal(err)
	}
	rows, err := s.TagCatalog(ctx)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, row := range rows {
		if row.Field == "resolution" && row.Value == sdResolutionValue {
			found = true
			if row.Count != 6 {
				t.Fatal(row)
			}
		}
	}
	if !found {
		t.Fatal("SD color row missing")
	}
	result, err := s.Query(url.Values{"service": {"radarr"}, "resolution": {sdResolutionValue}}, "matches", false)
	if err != nil || result.Total != 6 {
		t.Fatal("SD count differs from actual filter", result.Total, err)
	}
	if err = s.DeleteCatalogTag(ctx, "resolution", sdResolutionValue); err == nil {
		t.Fatal("virtual group was deletable")
	}
	if err = s.Replace("radarr", nil, SyncStatus{}); err != nil {
		t.Fatal(err)
	}
	rows, err = s.TagCatalog(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		if row.Field == "resolution" && row.Value == sdResolutionValue && row.Count != 0 {
			t.Fatal("stale SD count", row)
		}
	}
}

func TestSDColorPreferencesRetained102(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	cfg := DefaultSettings()
	cfg.TagColors["resolution:"+sdResolutionValue] = "#ad743a"
	cfg.TagTextColors = map[string]string{"resolution:" + sdResolutionValue: "#ffffff"}
	off := false
	cfg.GroupSD = &off
	if err := normalizeSettings(&cfg); err != nil {
		t.Fatal(err)
	}
	if err := s.Put("settings", cfg); err != nil {
		t.Fatal(err)
	}
	if err := s.seedTagCatalog(ctx); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := s.DB.QueryRow("SELECT count(*) FROM display_tag_catalog WHERE field='resolution' AND value=?", sdResolutionValue).Scan(&n); err != nil || n != 0 {
		t.Fatal("virtual group persisted as a real tag", n, err)
	}
	var saved Settings
	if err := s.Get("settings", &saved); err != nil {
		t.Fatal(err)
	}
	if saved.GroupSD == nil || *saved.GroupSD || saved.TagColors["resolution:"+sdResolutionValue] != "#ad743a" || saved.TagTextColors["resolution:"+sdResolutionValue] != "#ffffff" {
		t.Fatal("disabled SD lost its color preferences")
	}
	on := true
	saved.GroupSD = &on
	if err := normalizeSettings(&saved); err != nil {
		t.Fatal(err)
	}
	if saved.TagColors["resolution:"+sdResolutionValue] != "#ad743a" {
		t.Fatal("reactivation reset SD color")
	}
}
