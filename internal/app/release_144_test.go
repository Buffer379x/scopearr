package app

import (
	"context"
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

type arrMedia144 struct {
	id          int
	title, path string
}

func arrServer144(t *testing.T, roots []string, media []arrMedia144) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if filepath.Base(r.URL.Path) == "rootfolder" {
			out := []map[string]any{}
			for _, root := range roots {
				out = append(out, map[string]any{"path": root})
			}
			json.NewEncoder(w).Encode(out)
			return
		}
		out := []map[string]any{}
		for _, m := range media {
			out = append(out, map[string]any{"id": m.id, "title": m.title, "path": m.path})
		}
		json.NewEncoder(w).Encode(out)
	}))
	t.Cleanup(server.Close)
	return server
}

func shareFile144(t *testing.T, cfg Settings, disk, rel string) {
	t.Helper()
	path := filepath.Join(cfg.Unraid.DiskRoot, disk, rel)
	if e := os.MkdirAll(filepath.Dir(path), 0755); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(path, []byte(disk+rel), 0644); e != nil {
		t.Fatal(e)
	}
	if os.Geteuid() == 0 {
		if e := os.Chown(path, 99, 100); e != nil {
			t.Fatal(e)
		}
	}
}

// Share-first fixture: no Mux mapping at all, documentaries shared by Radarr
// (named) and Sonarr (unnamed), folders discovered directly on the devices.
func shareFixture144(t *testing.T) (*Server, Settings) {
	t.Helper()
	s, cfg := placementFixture130(t)
	cfg.Unraid.ShareRoot = filepath.Join(cfg.Unraid.DiskRoot, "user")
	cfg.Mux.Mappings = ""
	for _, dir := range []string{"documentaries", "Fotos", "media/documentaries"} {
		if e := os.MkdirAll(filepath.Join(cfg.Unraid.DiskRoot, "user", dir), 0755); e != nil {
			t.Fatal(e)
		}
	}
	for _, disk := range []string{"disk3", "disk6"} {
		shareFile144(t, cfg, disk, "documentaries/Film A/"+disk+".mkv")
		shareFile144(t, cfg, disk, "documentaries/Serie B/Season 0"+strings.TrimPrefix(disk, "disk")+"/episode.mkv")
		shareFile144(t, cfg, disk, "documentaries/Alt D/"+disk+".nfo")
		shareFile144(t, cfg, disk, "Fotos/Urlaub/"+disk+".jpg")
	}
	shareFile144(t, cfg, "disk3", "documentaries/Film C/film.mkv")
	for _, hidden := range []string{".Recycle.Bin", "@eaDir", "#recycle"} {
		for _, disk := range []string{"disk3", "disk6"} {
			shareFile144(t, cfg, disk, "documentaries/"+hidden+"/x")
		}
	}
	if e := os.Symlink(filepath.Join(cfg.Unraid.DiskRoot, "disk3", "documentaries", "Film C"), filepath.Join(cfg.Unraid.DiskRoot, "disk6", "documentaries", "Link E")); e != nil {
		t.Fatal(e)
	}
	movies := arrServer144(t, []string{"/documentaries"}, []arrMedia144{{1, "Film A", "/documentaries/Film A"}, {3, "Film C", "/documentaries/Film C"}, {5, "Film E", "/documentaries/Film E"}})
	shows := arrServer144(t, []string{"/documentaries/"}, []arrMedia144{{2, "Serie B", "/documentaries/Serie B"}})
	cfg.Instances = []ServiceConfig{{ID: "radarr", Type: "radarr", Name: "Movies", Enabled: true, URL: movies.URL}, {ID: "sonarr", Type: "sonarr", Enabled: true, URL: shows.URL}}
	s.mu.Lock()
	s.settings = cfg
	s.mu.Unlock()
	return s, cfg
}

func placementRows144(t *testing.T, s *Server) map[string]PlacementItem {
	t.Helper()
	rows, e := s.Store.DB.Query("SELECT " + placementColumns + " FROM placement_items")
	if e != nil {
		t.Fatal(e)
	}
	defer rows.Close()
	out := map[string]PlacementItem{}
	for rows.Next() {
		item, e := scanPlacement(rows)
		if e != nil {
			t.Fatal(e)
		}
		out[item.Rel] = item
	}
	return out
}

func TestPlacementShareFirst144(t *testing.T) {
	s, cfg := shareFixture144(t)
	s.Placement.runScan(context.Background(), cfg)
	scan := s.Placement.scanStatus()
	if scan.Error != "" {
		t.Fatal(scan.Error)
	}
	events, err := s.Store.Events.query(context.Background(), eventQuery{Sources: []string{"placement"}})
	if err != nil || events.Total != 1 || events.Events[0].Params["count"] != float64(scan.Total) {
		t.Fatalf("a finished scan is logged once with its folder count: %+v %v", events.Events, err)
	}
	if len(scan.Shares) != 1 || scan.Shares[0].ShareDir != "documentaries" {
		t.Fatalf("only the Arr share is scanned: %+v", scan.Shares)
	}
	share := scan.Shares[0]
	if share.Folders != 4 || share.Several != 3 || share.OneDisk != 1 || share.WithArr != 3 || share.WithoutArr != 1 || share.ArrMissing != 1 {
		t.Fatalf("unexpected share counts: %+v", share)
	}
	if strings.Join(share.Instances, ",") != "Movies,Sonarr" {
		t.Fatalf("shared root instances: %v", share.Instances)
	}
	rows := placementRows144(t, s)
	for rel, want := range map[string]struct{ status, service, title string }{
		"documentaries/Film A":  {"split", "radarr", "Film A"},
		"documentaries/Serie B": {"split", "sonarr", "Serie B"},
		"documentaries/Alt D":   {"split", "", "Alt D"},
		"documentaries/Film C":  {"ok", "radarr", "Film C"},
		"documentaries/Film E":  {"not_found", "radarr", "Film E"},
	} {
		got, ok := rows[rel]
		if !ok || got.ScanStatus != want.status || got.Service != want.service || got.Title != want.title {
			t.Fatalf("%s: %+v", rel, got)
		}
	}
	if rows["documentaries/Alt D"].Key != "folder:documentaries/Alt D" || rows["documentaries/Alt D"].Target == "" {
		t.Fatalf("folder without Arr entry must be planned: %+v", rows["documentaries/Alt D"])
	}
	if one := rows["documentaries/Film C"]; len(one.Disks) != 1 || one.TotalBytes != 0 {
		t.Fatalf("one-device rows are not walked: %+v", one)
	}
	for rel := range rows {
		if strings.Contains(rel, "Fotos") || strings.Contains(rel, "Recycle") || strings.Contains(rel, "@") || strings.Contains(rel, "#") || strings.Contains(rel, "Link E") {
			t.Fatalf("foreign, hidden or linked folder scanned: %s", rel)
		}
	}
	w := httptest.NewRecorder()
	s.placementListHTTP(w, httptest.NewRequest("GET", "/api/placement/items?share=documentaries", nil))
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
}

func TestPlacementShareChoices144(t *testing.T) {
	for _, tc := range []struct {
		name, choice string
		shares       int
	}{
		{"disabled", "-", 0},
		{"nested choice", "media/documentaries", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, cfg := shareFixture144(t)
			shareFile144(t, cfg, "disk3", "media/documentaries/Nested/a.mkv")
			shareFile144(t, cfg, "disk6", "media/documentaries/Nested/b.nfo")
			cfg.Unraid.ShareDirs = map[string]string{"/documentaries": tc.choice}
			s.mu.Lock()
			s.settings = cfg
			s.mu.Unlock()
			s.Placement.runScan(context.Background(), cfg)
			scan := s.Placement.scanStatus()
			if scan.Error != "" || len(scan.Shares) != tc.shares {
				t.Fatalf("%s %+v", scan.Error, scan.Shares)
			}
			if tc.shares == 1 && (scan.Shares[0].ShareDir != tc.choice || scan.Shares[0].Several != 1 || scan.Shares[0].ArrMissing != 4) {
				t.Fatalf("saved choice ignored: %+v", scan.Shares[0])
			}
		})
	}
}

func TestPlacementShareSeasons144(t *testing.T) {
	s, cfg := shareFixture144(t)
	cfg.Unraid.SeriesGrouping = "season"
	s.mu.Lock()
	s.settings = cfg
	s.mu.Unlock()
	s.Placement.runScan(context.Background(), cfg)
	if e := s.Placement.scanStatus().Error; e != "" {
		t.Fatal(e)
	}
	rows := placementRows144(t, s)
	if rows["documentaries/Serie B"].ScanStatus != "seasons_spread" || rows["documentaries/Serie B/Season 03"].ScanStatus != "ok" {
		t.Fatalf("season grouping lost: %+v", rows)
	}
}

type countingMetadata144 struct {
	placementOSMetadata
	mu    sync.Mutex
	reads []string
	walks []string
}

func (m *countingMetadata144) ReadDir(p string) ([]os.DirEntry, error) {
	m.mu.Lock()
	m.reads = append(m.reads, p)
	m.mu.Unlock()
	return os.ReadDir(p)
}
func (m *countingMetadata144) WalkDir(p string, f fs.WalkDirFunc) error {
	m.mu.Lock()
	m.walks = append(m.walks, p)
	m.mu.Unlock()
	return filepath.WalkDir(p, f)
}

func TestPlacementShareReadBoundaries144(t *testing.T) {
	s, cfg := shareFixture144(t)
	metadata := &countingMetadata144{}
	s.Placement.metadata = metadata
	s.Placement.runScan(context.Background(), cfg)
	if e := s.Placement.scanStatus().Error; e != "" {
		t.Fatal(e)
	}
	for _, path := range append(append([]string{}, metadata.reads...), metadata.walks...) {
		if strings.Contains(path, "Fotos") {
			t.Fatalf("foreign share touched: %s", path)
		}
	}
	// Film A, Serie B and Alt D each exist on two devices: 3 folders × 2 walks.
	if len(metadata.walks) != 6 {
		t.Fatalf("walks only folders on several devices: %v", metadata.walks)
	}
}
