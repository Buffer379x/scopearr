package app

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPlacementMediaNames145(t *testing.T) {
	s, cfg := shareFixture144(t)
	for _, name := range []string{"#amleben", "@cinema", ".arr-hidden", "#snapshot", "@Recycle", "@Recently-Snapshot", "@tmp", "@SynoResource", "lost+found", ".Trash-1000", ".hidden"} {
		shareFile144(t, cfg, "disk3", "documentaries/"+name+"/film.mkv")
	}
	arr := arrServer144(t, []string{"/documentaries"}, []arrMedia144{{41, "Hidden movie", "/documentaries/.arr-hidden"}, {42, "Hashtag movie", "/documentaries/#amleben"}})
	cfg.Instances[0].URL = arr.URL
	setTestSettings(s, cfg)
	s.Placement.runScan(context.Background(), cfg)
	if e := s.Placement.scanStatus().Error; e != "" {
		t.Fatal(e)
	}
	rows := placementRows144(t, s)
	for _, name := range []string{"#amleben", "@cinema", ".arr-hidden"} {
		if got, ok := rows["documentaries/"+name]; !ok || got.ScanStatus != "ok" {
			t.Errorf("ordinary media folder %s missing: %+v", name, got)
		}
	}
	for _, name := range []string{"#snapshot", "@Recycle", "@Recently-Snapshot", "@tmp", "@SynoResource", "lost+found", ".Trash-1000", ".hidden"} {
		if _, ok := rows["documentaries/"+name]; ok {
			t.Errorf("system folder %s included", name)
		}
	}
}

func emptyDir145(t *testing.T, cfg Settings, disk, rel string) {
	t.Helper()
	if e := os.MkdirAll(filepath.Join(cfg.Unraid.DiskRoot, disk, rel), 0755); e != nil {
		t.Fatal(e)
	}
}

func placementFixture145(t *testing.T) (*Server, Settings) {
	t.Helper()
	s, cfg := placementFixture130(t)
	cfg.Mux.Mappings = ""
	cfg.Unraid.ShareRoot = filepath.Join(cfg.Unraid.DiskRoot, "user")
	cfg.Unraid.SeriesGrouping = "season"
	for _, share := range []string{"movies", "shows", "documentaries", "Fotos"} {
		emptyDir145(t, cfg, "user", share)
	}
	for _, disk := range []string{"disk1", "disk2", "disk3", "cache"} {
		emptyDir145(t, cfg, disk, "")
	}
	for _, spec := range []struct{ disk, rel string }{
		{"disk1", "movies/A/a.mkv"}, {"disk2", "movies/A/b.mkv"},
		{"disk1", "movies/B/a.mkv"}, {"cache", "movies/C/c.mkv"},
		{"cache", "movies/D/c.mkv"}, {"disk1", "movies/D/a.mkv"}, {"cache", "movies/E/e.mkv"},
		{"disk1", "movies/#amleben/a.mkv"}, {"disk1", "movies/#amleben2/a.mkv"}, {"disk2", "movies/#amleben2/b.mkv"},
		{"disk1", "movies/J/a.mkv"}, {"disk2", "movies/J/b.mkv"},
		{"disk1", "shows/Serie K/Season 01/a.mkv"}, {"disk2", "shows/Serie K/Season 02/b.mkv"},
		{"disk1", "Fotos/V/a.jpg"}, {"disk2", "Fotos/V/b.jpg"},
	} {
		shareFile144(t, cfg, spec.disk, spec.rel)
	}
	for _, spec := range []struct{ disk, rel string }{{"disk2", "movies/B"}, {"disk1", "movies/C"}, {"disk1", "movies/F"}, {"disk1", "movies/G"}, {"disk2", "movies/G"}, {"disk1", "movies/H/empty/also-empty"}, {"disk1", "movies/I"}, {"disk1", "shows/Harry Potter"}} {
		emptyDir145(t, cfg, spec.disk, spec.rel)
	}
	if e := os.Symlink("/missing-target", filepath.Join(cfg.Unraid.DiskRoot, "disk1/movies/I/link")); e != nil {
		t.Fatal(e)
	}
	if os.Geteuid() == 0 {
		for _, rel := range []string{"disk1/movies/J/a.mkv", "disk2/movies/J/b.mkv"} {
			if e := os.Chown(filepath.Join(cfg.Unraid.DiskRoot, rel), 0, 0); e != nil {
				t.Fatal(e)
			}
		}
	}
	for _, name := range []string{"#recycle", "@eaDir", ".Recycle.Bin", "lost+found"} {
		shareFile144(t, cfg, "disk1", "movies/"+name+"/ignored")
	}
	for n := 0; n < 10; n++ {
		name := string(rune('L' + n))
		switch n % 5 {
		case 0:
			shareFile144(t, cfg, "disk1", "documentaries/"+name+"/a")
			shareFile144(t, cfg, "disk2", "documentaries/"+name+"/b")
		case 1:
			shareFile144(t, cfg, "disk1", "documentaries/"+name+"/a")
			emptyDir145(t, cfg, "disk2", "documentaries/"+name)
		case 2:
			shareFile144(t, cfg, "cache", "documentaries/"+name+"/c")
			emptyDir145(t, cfg, "disk1", "documentaries/"+name)
		case 3:
			shareFile144(t, cfg, "cache", "documentaries/"+name+"/c")
			shareFile144(t, cfg, "disk1", "documentaries/"+name+"/a")
		case 4:
			shareFile144(t, cfg, "disk1", "documentaries/"+name+"/a")
			shareFile144(t, cfg, "disk2", "documentaries/"+name+"/b")
			if os.Geteuid() == 0 {
				os.Chown(filepath.Join(cfg.Unraid.DiskRoot, "disk2/documentaries/"+name+"/b"), 0, 0)
			}
		}
	}
	movies := arrServer144(t, []string{"/movies", "/documentaries"}, []arrMedia144{{1, "#amleben", "/movies/#amleben"}, {2, "Missing", "/movies/Missing"}})
	shows := arrServer144(t, []string{"/shows", "/documentaries"}, []arrMedia144{{3, "Serie K", "/shows/Serie K"}})
	cfg.Instances = []ServiceConfig{{ID: "radarr", Type: "radarr", Name: "Movies", Enabled: true, URL: movies.URL}, {ID: "sonarr", Type: "sonarr", Name: "Shows", Enabled: true, URL: shows.URL}}
	setTestSettings(s, cfg)
	return s, cfg
}

func TestPlacementClassification145(t *testing.T) {
	s, cfg := placementFixture145(t)
	metadata := &countingMetadata144{}
	s.Placement.metadata = metadata
	s.Placement.runScan(context.Background(), cfg)
	if e := s.Placement.scanStatus().Error; e != "" {
		t.Fatal(e)
	}
	rows := placementRows144(t, s)
	for rel, want := range map[string]string{
		"movies/A": "split", "movies/B": "empty_folders", "movies/C": "waiting_for_mover", "movies/D": "waiting_for_mover", "movies/E": "ok", "movies/F": "empty", "movies/G": "empty", "movies/H": "empty", "movies/#amleben": "ok", "movies/#amleben2": "split", "movies/I": "ok", "movies/J": "foreign_owner", "shows/Harry Potter": "empty", "shows/Serie K": "seasons_spread", "shows/Serie K/Season 01": "ok", "movies/Missing": "not_found",
	} {
		if got, ok := rows[rel]; !ok || got.ScanStatus != want {
			t.Errorf("%s: want %s, got %+v", rel, want, got)
		}
	}
	for _, rel := range []string{"movies/C", "movies/F", "movies/G", "movies/H", "shows/Harry Potter"} {
		i := rows[rel]
		if i.Target != "" || i.selectable() || i.startable() {
			t.Errorf("%s must never be planned: %+v", rel, i)
		}
	}
	if rows["movies/D"].Target == "" {
		t.Error("pool and array content must retain manual target")
	}
	for _, p := range append(metadata.reads, metadata.walks...) {
		if strings.Contains(p, "/Fotos") {
			t.Errorf("unrelated share touched: %s", p)
		}
	}
	if len(rows["movies/F"].Files) > 0 || rows["movies/E"].TotalBytes != 0 {
		t.Error("single-device entries must remain compact")
	}
	t.Logf("metadata ReadDir=%d WalkDir=%d", len(metadata.reads), len(metadata.walks))
}
