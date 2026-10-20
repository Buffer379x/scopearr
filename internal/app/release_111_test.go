package app

import (
	"context"
	"fmt"
	"reflect"
	"testing"
)

func backgroundReconcile111(t *testing.T, s *Store, service string, c ServiceConfig, target ...int) {
	t.Helper()
	ctx := context.Background()
	p, err := s.BuildTagPlan(ctx, service, c, nil, target...)
	if err != nil {
		t.Fatal(err)
	}
	if p.Preview.ApprovalRequired {
		t.Fatal("background refresh requires approval", p.Preview)
	}
	if _, wait, err := s.ReconcileTags(ctx, service, c, func() bool { return true }, target...); err != nil || wait {
		t.Fatal(wait, err)
	}
}

func TestAdditiveRadarrUpgradeReplacesManagedTechnicalTags111(t *testing.T) {
	for _, targeted := range []bool{false, true} {
		t.Run(fmt.Sprint("targeted=", targeted), func(t *testing.T) {
			s := testStore(t)
			f, h := newTagFixture(t, "radarr")
			f.tags, f.media = map[int]string{1: "manual"}, map[int][]int{10: {1}}
			c := tagConfig(h)
			c.TagSync = TagGroups{Resolution: true, Codec: true}
			c.TagSyncMode = "add"
			file := sample(1, "Movie.mkv")
			file.MediaID = 10
			seedTags(t, s, "radarr", c, []File{file})
			reconcile(t, s, "radarr", c)
			if got := fmt.Sprint(f.names(10)); got != "[codec-unknown manual resolution-unknown]" {
				t.Fatal(got)
			}
			file = sample(2, "Movie.2160p.x265.mkv")
			file.MediaID = 10
			seedTags(t, s, "radarr", c, []File{file})
			if targeted {
				backgroundReconcile111(t, s, "radarr", c, 10)
			} else {
				backgroundReconcile111(t, s, "radarr", c)
			}
			if got := fmt.Sprint(f.names(10)); got != "[2160p manual x265]" {
				t.Fatal(got)
			}
			for _, label := range f.tags {
				if label == "codec-unknown" || label == "resolution-unknown" {
					t.Fatal("unused definition retained", f.tags)
				}
			}
		})
	}
}

func TestAdditiveKeepsForeignAndKeptGroups111(t *testing.T) {
	s := testStore(t)
	f, h := newTagFixture(t, "radarr")
	f.tags, f.media = map[int]string{1: "manual"}, map[int][]int{10: {1}}
	c := tagConfig(h)
	c.TagSync = TagGroups{Resolution: true, Codec: true}
	c.TagSyncMode = "add"
	file := sample(1, "Movie.1080p.x264.mkv")
	file.MediaID = 10
	seedTags(t, s, "radarr", c, []File{file})
	reconcile(t, s, "radarr", c)
	old := c
	c.TagSync.Resolution = false
	c.TagSyncDisable = "keep"
	stagePolicy(t, s, old, c)
	file = sample(2, "Movie.2160p.x265.mkv")
	file.MediaID = 10
	seedTags(t, s, "radarr", c, []File{file})
	backgroundReconcile111(t, s, "radarr", c)
	if got := fmt.Sprint(f.names(10)); got != "[1080p manual x265]" {
		t.Fatal(got)
	}
}

func TestAdditiveNoFilesKeepsTags111(t *testing.T) {
	s := testStore(t)
	f, h := newTagFixture(t, "radarr")
	c := tagConfig(h)
	c.TagSync = TagGroups{Codec: true}
	c.TagSyncMode = "add"
	file := sample(1, "Movie.x264.mkv")
	file.MediaID = 10
	seedTags(t, s, "radarr", c, []File{file})
	reconcile(t, s, "radarr", c)
	before := f.names(10)
	seedTags(t, s, "radarr", c, nil)
	backgroundReconcile111(t, s, "radarr", c)
	if !reflect.DeepEqual(before, f.names(10)) {
		t.Fatal(before, f.names(10))
	}
}

func TestAdditiveSonarrUnionRemovesOnlyUnusedValues111(t *testing.T) {
	s := testStore(t)
	f, h := newTagFixture(t, "sonarr")
	f.tags, f.media = map[int]string{1: "manual"}, map[int][]int{10: {1}}
	c := tagConfig(h)
	c.TagSync = TagGroups{Codec: true}
	c.TagSyncMode = "add"
	a, b := sample(1, "Series.S01E01.x264.mkv"), sample(2, "Series.S01E02.mkv")
	a.MediaID, b.MediaID = 10, 10
	seedTags(t, s, "sonarr", c, []File{a, b})
	reconcile(t, s, "sonarr", c)
	b = sample(3, "Series.S01E02.x265.mkv")
	b.MediaID = 10
	seedTags(t, s, "sonarr", c, []File{a, b})
	backgroundReconcile111(t, s, "sonarr", c)
	if got := fmt.Sprint(f.names(10)); got != "[manual x264 x265]" {
		t.Fatal(got)
	}
	a = sample(4, "Series.S01E01.x265.mkv")
	a.MediaID = 10
	seedTags(t, s, "sonarr", c, []File{a, b})
	backgroundReconcile111(t, s, "sonarr", c)
	if got := fmt.Sprint(f.names(10)); got != "[manual x265]" {
		t.Fatal(got)
	}
}

func TestAdditiveUncontrolledDefinitionNotQueuedForCleanup111(t *testing.T) {
	s := testStore(t)
	f, h := newTagFixture(t, "radarr")
	f.tags, f.media = map[int]string{1: "manual", 2: "x264"}, map[int][]int{10: {1, 2}}
	c := tagConfig(h)
	c.TagSync = TagGroups{Codec: true}
	c.TagSyncMode = "add"
	file := sample(1, "Movie.x264.mkv")
	file.MediaID = 10
	seedTags(t, s, "radarr", c, []File{file})
	reconcile(t, s, "radarr", c)
	if _, err := s.DB.Exec("DELETE FROM tag_sync_ownership WHERE media_id=0"); err != nil {
		t.Fatal(err)
	}
	file = sample(2, "Movie.x265.mkv")
	file.MediaID = 10
	seedTags(t, s, "radarr", c, []File{file})
	backgroundReconcile111(t, s, "radarr", c)
	if got := fmt.Sprint(f.names(10)); got != "[manual x265]" || f.tags[2] != "x264" {
		t.Fatal(got, f.tags)
	}
}

func TestMediaTagsAddModeOwnership111(t *testing.T) {
	for _, kind := range []string{"emby", "jellyfin"} {
		for _, preexisting := range []bool{false, true} {
			t.Run(fmt.Sprint(kind, "/preexisting=", preexisting), func(t *testing.T) {
				ctx := context.Background()
				s := testStore(t)
				f, _, c := newMediaTagFixture(t, kind)
				a := mediaFixtureArr("radarr")
				c.TagSync = TagGroups{Codec: true}
				cfg := mediaFixtureSettings([]ServiceConfig{a}, c)
				first := "Film.x264.mkv"
				f.items["movie1"] = mediaFixtureDocument("movie1", "Movie", mediaFixtureSource("source", first, 100))
				if preexisting {
					f.items["movie1"]["Tags"] = []string{"Manual", "x264"}
				}
				replaceMediaFixture(t, s, a, mediaFixtureFile(t, s, a, c, 1, "movie1", "source", first, 100))
				if _, wait, err := s.ReconcileMediaTags(ctx, cfg, c.ID, c, nil); err != nil || wait {
					t.Fatal(wait, err)
				}
				if preexisting && len(f.writes) != 0 {
					t.Fatal("wrote preexisting tag", f.writes)
				}
				next := "Film.x265.mkv"
				f.items["movie1"]["MediaSources"] = []map[string]any{mediaFixtureSource("source", next, 200)}
				replaceMediaFixture(t, s, a, mediaFixtureFile(t, s, a, c, 1, "movie1", "source", next, 200))
				p, err := s.BuildMediaTagPlan(ctx, c.ID, c, nil, cfg)
				if err != nil {
					t.Fatal(err)
				}
				if p.Preview.ApprovalRequired {
					t.Fatal(p.Preview)
				}
				if _, wait, err := s.ExecuteMediaTagPlan(ctx, p, nil); err != nil || wait {
					t.Fatal(wait, err)
				}
				want := []string{"Manual", "x265"}
				if preexisting {
					want = []string{"Manual", "x264", "x265"}
				}
				if !reflect.DeepEqual(f.items["movie1"]["Tags"], want) {
					t.Fatal(f.items["movie1"]["Tags"], want)
				}
			})
		}
	}
}

func TestStaleTagRefreshMarksAdditiveInstancesOnce111(t *testing.T) {
	for _, legacy := range []bool{false, true} {
		t.Run(fmt.Sprint("legacy=", legacy), func(t *testing.T) {
			dir := t.TempDir()
			s, err := OpenStore(dir)
			if err != nil {
				t.Fatal(err)
			}
			cfg := Settings{Instances: []ServiceConfig{{ID: "radarr-hd", TagSyncMode: "add", TagSync: TagGroups{Codec: true}}, {ID: "jellyfin", TagSyncMode: "add", TagSync: TagGroups{Codec: true}}, {ID: "sonarr", TagSyncMode: "replace", TagSync: TagGroups{Codec: true}}, {ID: "emby", TagSyncMode: "add"}}}
			addID := "radarr-hd"
			if legacy {
				cfg = Settings{Radarr: cfg.Instances[0], Sonarr: cfg.Instances[2], Jellyfin: cfg.Instances[1]}
				addID = "radarr"
			}
			if err = s.Put("settings", cfg); err != nil {
				t.Fatal(err)
			}
			if _, err = s.DB.Exec("DELETE FROM kv WHERE key='tagStaleRefresh:1.1.1'"); err != nil {
				t.Fatal(err)
			}
			if err = s.DB.Close(); err != nil {
				t.Fatal(err)
			}
			s, err = OpenStore(dir)
			if err != nil {
				t.Fatal(err)
			}
			for _, id := range []string{addID, "jellyfin"} {
				var dirty bool
				if err = s.Get("tagSyncDirty:"+id, &dirty); err != nil || !dirty {
					t.Fatal(id, dirty, err)
				}
			}
			for _, id := range []string{"sonarr", "emby"} {
				var dirty bool
				_ = s.Get("tagSyncDirty:"+id, &dirty)
				if dirty {
					t.Fatal(id, "incorrectly queued")
				}
			}
			var marker bool
			if err = s.Get("tagStaleRefresh:1.1.1", &marker); err != nil || !marker {
				t.Fatal(marker, err)
			}
			if err = s.Put("tagSyncDirty:"+addID, false); err != nil {
				t.Fatal(err)
			}
			s.DB.Close()
			s, err = OpenStore(dir)
			if err != nil {
				t.Fatal(err)
			}
			defer s.DB.Close()
			var dirty bool
			if err = s.Get("tagSyncDirty:"+addID, &dirty); err != nil || dirty {
				t.Fatal("migration repeated", dirty, err)
			}
		})
	}
}

func TestAdditiveForeignTechnicalAndAutoProtectedTags111(t *testing.T) {
	for _, protected := range []bool{false, true} {
		t.Run(fmt.Sprint("protected=", protected), func(t *testing.T) {
			s := testStore(t)
			f, h := newTagFixture(t, "radarr")
			f.tags, f.media = map[int]string{1: "manual", 2: "x264"}, map[int][]int{10: {1, 2}}
			c := tagConfig(h)
			c.TagSync = TagGroups{Codec: true}
			c.TagSyncMode = "add"
			file := sample(1, "Movie.x265.mkv")
			file.MediaID = 10
			if protected {
				file = sample(1, "Movie.x264.mkv")
				file.MediaID = 10
				seedTags(t, s, "radarr", c, []File{file})
				reconcile(t, s, "radarr", c)
				f.auto = map[int][]int{2: {42}}
				c.TagImport = true
				file = sample(2, "Movie.x265.mkv")
				file.MediaID = 10
			}
			seedTags(t, s, "radarr", c, []File{file})
			backgroundReconcile111(t, s, "radarr", c)
			if got := fmt.Sprint(f.names(10)); got != "[manual x264 x265]" {
				t.Fatal(got)
			}
		})
	}
}

func TestMediaTagsAddModeKeepsDisabledTechnicalGroups111(t *testing.T) {
	for _, kind := range []string{"emby", "jellyfin"} {
		t.Run(kind, func(t *testing.T) {
			ctx := context.Background()
			s := testStore(t)
			f, _, c := newMediaTagFixture(t, kind)
			a := mediaFixtureArr("radarr")
			c.TagSync = TagGroups{Resolution: true, Codec: true}
			cfg := mediaFixtureSettings([]ServiceConfig{a}, c)
			first := "Film.1080p.x264.mkv"
			f.items["movie1"] = mediaFixtureDocument("movie1", "Movie", mediaFixtureSource("source", first, 100))
			replaceMediaFixture(t, s, a, mediaFixtureFile(t, s, a, c, 1, "movie1", "source", first, 100))
			if _, wait, err := s.ReconcileMediaTags(ctx, cfg, c.ID, c, nil); err != nil || wait {
				t.Fatal(wait, err)
			}
			before := c
			c.TagSync.Resolution = false
			c.TagSyncDisable = "keep"
			cfg = mediaFixtureSettings([]ServiceConfig{a}, c)
			next := "Film.2160p.x265.mkv"
			f.items["movie1"]["MediaSources"] = []map[string]any{mediaFixtureSource("source", next, 200)}
			replaceMediaFixture(t, s, a, mediaFixtureFile(t, s, a, c, 1, "movie1", "source", next, 200))
			p, err := s.BuildMediaTagPlan(ctx, c.ID, c, &before, cfg)
			if err != nil {
				t.Fatal(err)
			}
			if p.Preview.ApprovalRequired {
				t.Fatal(p.Preview)
			}
			if _, wait, err := s.ExecuteMediaTagPlan(ctx, p, nil); err != nil || wait {
				t.Fatal(wait, err)
			}
			if got := f.items["movie1"]["Tags"]; !reflect.DeepEqual(got, []string{"1080p", "Manual", "x265"}) {
				t.Fatal(got)
			}
		})
	}
}
