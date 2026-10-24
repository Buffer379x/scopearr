package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestPlacementDetection142(t *testing.T) {
	for _, tc := range []struct{ name, kind, grouping, share, actual, want string }{
		{"Jackass by series", "sonarr", "series", "shows", "shows", "split"},
		{"Jackass by season", "sonarr", "season", "shows", "shows", "seasons_spread"},
		{"unresolved documentaries", "radarr", "series", "documentaries", "missing", "not_found"},
		{"documentary movie", "radarr", "series", "documentaries", "documentaries", "split"},
		{"documentary series", "sonarr", "series", "documentaries", "documentaries", "split"},
		{"aliased documentaries", "radarr", "series", "documentaries", "Dokus", "split"},
		{"nested alias", "radarr", "series", "documentaries", "shows/Dokus", "split"},
		{"forbidden system share", "radarr", "series", "system", "system", "not_found"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, cfg := placementFixture130(t)
			cfg.Unraid.ShareRoot = filepath.Join(cfg.Unraid.DiskRoot, "user")
			cfg.Unraid.SeriesGrouping = tc.grouping
			root := filepath.Join(cfg.Unraid.ShareRoot, tc.share)
			if tc.actual != "missing" && tc.actual != tc.share {
				actual := filepath.Join(cfg.Unraid.ShareRoot, tc.actual)
				if e := os.MkdirAll(actual, 0755); e != nil {
					t.Fatal(e)
				}
				if e := os.Symlink(actual, root); e != nil {
					t.Fatal(e)
				}
			} else if e := os.MkdirAll(root, 0755); e != nil {
				t.Fatal(e)
			}
			title := "Jackass"
			if tc.kind == "radarr" {
				title = "Planet Earth"
			}
			arr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if filepath.Base(r.URL.Path) == "rootfolder" {
					json.NewEncoder(w).Encode([]map[string]any{{"path": "/" + tc.share}})
					return
				}
				json.NewEncoder(w).Encode([]map[string]any{{"id": 1, "title": title, "path": "/" + tc.share + "/" + title}})
			}))
			defer arr.Close()
			cfg.Instances = []ServiceConfig{{ID: tc.kind, Type: tc.kind, Name: tc.kind, Enabled: true, URL: arr.URL}}
			cfg.Mux.Mappings = "/" + tc.share + " => " + root
			s.settings = cfg
			for n, disk := range []string{"disk3", "disk6"} {
				rel := filepath.Join(tc.actual, title)
				if tc.kind == "sonarr" {
					rel = filepath.Join(rel, []string{"Season 01", "Season 02"}[n])
				}
				if tc.actual == "missing" {
					continue
				}
				path := filepath.Join(cfg.Unraid.DiskRoot, disk, rel, disk+".mkv")
				if e := os.MkdirAll(filepath.Dir(path), 0755); e != nil {
					t.Fatal(e)
				}
				if e := os.WriteFile(path, []byte("video"), 0644); e != nil {
					t.Fatal(e)
				}
				if os.Geteuid() == 0 {
					if e := os.Chown(path, 99, 100); e != nil {
						t.Fatal(e)
					}
				}
			}
			s.Placement.runScan(context.Background(), cfg)
			scan := s.Placement.scanStatus()
			if scan.Error != "" {
				t.Fatal(scan.Error)
			}
			var status string
			if e := s.Store.DB.QueryRow("SELECT scan_status FROM placement_items WHERE media_id=1 ORDER BY (season=-1) DESC LIMIT 1").Scan(&status); e != nil {
				t.Fatal(e)
			}
			if len(scan.Roots) != 1 || scan.Roots[0].Scanned == 0 {
				t.Fatal("Missing per-root decisions", scan.Roots)
			}
			if tc.actual != tc.share && tc.actual != "missing" && scan.Roots[0].PathWarning == "" {
				t.Fatal("Alias was not explained")
			}
			if tc.want == "not_found" && scan.Roots[0].NotFound != 1 {
				t.Fatal("Missing root not-found count", scan.Roots)
			}
			if status != tc.want {
				t.Fatalf("want %s, got %s", tc.want, status)
			}
		})
	}
}

func TestPlacementOneDiskRemainsFindable142(t *testing.T) {
	s, cfg := placementFixture130(t)
	placementWrite130(t, cfg, "disk3", "Film.mkv", "video")
	arr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if filepath.Base(r.URL.Path) == "rootfolder" {
			json.NewEncoder(w).Encode([]map[string]any{{"path": "/arr/movies"}})
			return
		}
		json.NewEncoder(w).Encode([]map[string]any{{"id": 1, "title": "Film", "path": "/arr/movies/Film"}})
	}))
	defer arr.Close()
	cfg.Instances[0].URL = arr.URL
	s.settings = cfg
	s.Placement.runScan(context.Background(), cfg)
	var status, files string
	if e := s.Store.DB.QueryRow("SELECT scan_status,files FROM placement_items WHERE media_id=1").Scan(&status, &files); e != nil {
		t.Fatal(e)
	}
	w := httptest.NewRecorder()
	s.placementListHTTP(w, httptest.NewRequest("GET", "/api/placement/items?q=Film", nil))
	var list struct {
		Total    int
		HiddenOK int
	}
	if e := json.Unmarshal(w.Body.Bytes(), &list); e != nil {
		t.Fatal(e)
	}
	if w.Code != 200 || list.Total != 0 || list.HiddenOK != 1 {
		t.Fatal("Missing hidden one-disk search hint", w.Body.String())
	}
	w = httptest.NewRecorder()
	s.placementListHTTP(w, httptest.NewRequest("GET", "/api/placement/items?q=Film&status=ok", nil))
	if e := json.Unmarshal(w.Body.Bytes(), &list); e != nil {
		t.Fatal(e)
	}
	if list.Total != 1 {
		t.Fatal("One disk filter", w.Body.String())
	}
	if status != "ok" || files != "[]" {
		t.Fatal(status, files)
	}
}
