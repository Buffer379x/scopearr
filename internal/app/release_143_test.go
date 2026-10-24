package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSharedScanRootIdentity143(t *testing.T) {
	for _, tc := range []struct {
		name, radarrName, sonarrName, sonarrRoot string
		selected                                 bool
	}{
		{"unnamed Sonarr", "Movies", "", "/documentaries", false},
		{"both unnamed", "", "", "/documentaries", false},
		{"trailing slash", "Movies", "", "/documentaries/", false},
		{"repeated slash", "Movies", "", "//documentaries//", false},
		{"unselected Sonarr", "Movies", "", "/documentaries", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, cfg := placementFixture130(t)
			cfg.Unraid.ShareRoot = filepath.Join(cfg.Unraid.DiskRoot, "user")
			local := filepath.Join(cfg.Unraid.ShareRoot, "documentaries")
			if e := os.MkdirAll(local, 0755); e != nil {
				t.Fatal(e)
			}
			upstream := func(root, title string) *httptest.Server {
				return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if filepath.Base(r.URL.Path) == "rootfolder" {
						json.NewEncoder(w).Encode([]map[string]any{{"path": root}})
						return
					}
					json.NewEncoder(w).Encode([]map[string]any{{"id": 1, "title": title, "path": "/documentaries/" + title}})
				}))
			}
			movies, shows := upstream("/documentaries", "Film A"), upstream(tc.sonarrRoot, "Series B")
			defer movies.Close()
			defer shows.Close()
			cfg.Instances = []ServiceConfig{{ID: "radarr-a", Type: "radarr", Name: tc.radarrName, Enabled: true, URL: movies.URL}, {ID: "sonarr-b", Type: "sonarr", Name: tc.sonarrName, Enabled: true, URL: shows.URL}}
			cfg.Mux.Mappings = "/documentaries => " + local
			cfg.Unraid.SeriesGrouping = "series"
			if tc.selected {
				cfg.Unraid.Libraries = []string{"radarr-a"}
			}
			cfg.FileCheck.Libraries = cfg.Unraid.Libraries
			cfg.FileCheck.Kinds = []string{"junk"}
			for _, title := range []string{"Film A", "Series B"} {
				for _, disk := range []string{"disk1", "disk3"} {
					path := filepath.Join(cfg.Unraid.DiskRoot, disk, "documentaries", title, disk+".mkv")
					if e := os.MkdirAll(filepath.Dir(path), 0755); e != nil {
						t.Fatal(e)
					}
					if e := os.WriteFile(path, []byte("fixture"), 0644); e != nil {
						t.Fatal(e)
					}
					if os.Geteuid() == 0 {
						if e := os.Chown(path, 99, 100); e != nil {
							t.Fatal(e)
						}
					}
				}
				path := filepath.Join(local, title, ".DS_Store")
				_ = os.MkdirAll(filepath.Dir(path), 0755)
				_ = os.WriteFile(path, []byte("junk"), 0644)
			}
			s.mu.Lock()
			s.settings = cfg
			s.mu.Unlock()
			s.Placement.runScan(context.Background(), cfg)
			scan := s.Placement.scanStatus()
			if scan.Error != "" {
				t.Fatal(scan.Error)
			}
			if len(scan.Roots) != 1 {
				t.Fatalf("expected one shared root: %+v", scan.Roots)
			}
			want := 2
			if tc.selected {
				want = 1
			}
			root := scan.Roots[0]
			if root.Items != 2 || root.Scanned != want || root.SeveralDisks != want {
				t.Fatalf("From Arr=%d Scanned=%d Several=%d, want 2/%d/%d", root.Items, root.Scanned, root.SeveralDisks, want, want)
			}
			var n int
			if e := s.Store.DB.QueryRow("SELECT count(*) FROM placement_items WHERE rel LIKE 'documentaries/%' AND scan_status='split'").Scan(&n); e != nil || n != want {
				t.Fatal("missing shared-root items", n, e)
			}
			s.FileCheck.runScan(context.Background(), cfg)
			checked := s.FileCheck.scanStatus()
			if checked.Error != "" || len(checked.Roots) != 1 || checked.Roots[0].Items != 2 || checked.Roots[0].Scanned != want {
				t.Fatalf("file checks lost shared-root provenance: %+v", checked)
			}
		})
	}
}

func TestScanRootProvenance143(t *testing.T) {
	roots := []ScanRoot{
		{muxRootFolder: muxRootFolder{ArrPath: "/media", InstanceIDs: []string{"a"}}},
		{muxRootFolder: muxRootFolder{ArrPath: "/media/nested", InstanceIDs: []string{"b"}}},
	}
	for _, tc := range []struct{ service, want string }{{"a", "/media"}, {"b", "/media/nested"}, {"unknown", ""}} {
		if got := scanRootKey(roots, arrFolder{Service: tc.service, Source: "/media/nested/Film"}); got != tc.want {
			t.Fatalf("%s: %s != %s", tc.service, got, tc.want)
		}
	}
	clone := cloneScanRoots(roots)
	clone[0].InstanceIDs[0] = "changed"
	if roots[0].InstanceIDs[0] != "a" {
		t.Fatal("shared ID storage")
	}
	data, err := json.Marshal(PlacementItem{rootKey: "private"})
	if err != nil || strings.Contains(string(data), "private") {
		t.Fatal("root provenance must not persist", string(data), err)
	}
}
