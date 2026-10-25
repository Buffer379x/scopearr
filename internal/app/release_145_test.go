package app

import (
	"context"
	"os"
	"path/filepath"
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
