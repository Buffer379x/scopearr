package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestReviewRuntimeSharePolicy146(t *testing.T) {
	for _, policy := range []string{"prefer", "only"} {
		t.Run(policy, func(t *testing.T) {
			s, cfg := placementFixture130(t)
			cfg.Unraid.StateDir = t.TempDir()
			setTestSettings(s, cfg)
			placementWrite130(t, cfg, "cache", "source.nfo", "x")
			placementWrite130(t, cfg, "disk6", "film.mkv", "larger video")
			i := placementPlan130(t, s, cfg)
			os.WriteFile(filepath.Join(cfg.Unraid.StateDir, "shares.ini"), []byte("[movies]\nuseCache=\""+policy+"\"\ncachePool=\"fast\"\ncachePool2=\"secondary\"\n"), 0644)
			p := readShareCache(cfg.Unraid).policy("movies/documentaries/Film")
			if p.UseCache != policy || p.Pool != "fast" || p.SecondaryPool != "secondary" {
				t.Fatalf("runtime policy ignored: %+v", p)
			}
			disks, _ := discoverDisks(cfg.Unraid.DiskRoot)
			nested := i
			nested.Rel = "movies/documentaries/Film"
			nested = planPlacement(nested, cfg.Unraid, disks, map[string]int64{}, "")
			if nested.Target != "" || nested.startable() {
				t.Fatal("nested share bypassed pool policy")
			}
			check, _, e := s.Placement.checkItem(context.Background(), cfg, i)
			if e == nil && check.NoConflict {
				t.Fatal("policy changed after scan but preflight still accepts move")
			}
		})
	}
}
func TestReviewTargetlessDetails146(t *testing.T) {
	s, cfg := placementFixture130(t)
	placementWrite130(t, cfg, "disk3", "source.nfo", "x")
	placementWrite130(t, cfg, "disk6", "film.mkv", "bigger video")
	os.Symlink("/missing", filepath.Join(cfg.Unraid.DiskRoot, "disk3/movies/Film/link"))
	i := placementPlan130(t, s, cfg)
	if i.Target != "" {
		t.Fatal("fixture must be targetless")
	}
	w := httptest.NewRecorder()
	s.placementRecheck(w, httptest.NewRequest("POST", "/api/placement/items/1/recheck", nil), i)
	saved, _ := s.Store.placementItem(i.ID)
	if saved.Check == nil {
		t.Fatal("missing check")
	}
	found := false
	for _, f := range saved.Check.Files {
		if f.Rel == "link" && f.Reason == "special" {
			found = true
		}
	}
	if !found || !saved.Check.Readable || !saved.Check.Removable {
		t.Fatalf("missing concrete special details or false access failures: %+v", saved.Check)
	}
}

type failedInspect146 struct{ placementOSMetadata }

func (failedInspect146) WalkDir(string, fs.WalkDirFunc) error {
	return errPlacementLimit
}
func TestReviewFailedRecheck146(t *testing.T) {
	for _, phase := range []string{"discovery", "inspection"} {
		t.Run(phase, func(t *testing.T) {
			s, cfg := placementFixture130(t)
			placementWrite130(t, cfg, "disk3", "a.nfo", "x")
			placementWrite130(t, cfg, "disk6", "film.mkv", "larger video")
			i := placementPlan130(t, s, cfg)
			i.Check = &PlacementCheck{CheckedAt: "2026-01-01T00:00:00Z", Reachable: true, Writable: true, FreeSpace: true, Unchanged: true, NoConflict: true, Owner: true, Readable: true, Removable: true}
			s.Store.placementSave(&i)
			if phase == "discovery" {
				if e := os.Rename(cfg.Unraid.DiskRoot, cfg.Unraid.DiskRoot+"-offline"); e != nil {
					t.Fatal(e)
				}
			} else {
				s.Placement.metadata = failedInspect146{}
			}
			w := httptest.NewRecorder()
			s.placementRecheck(w, httptest.NewRequest("POST", "/api/placement/items/1/recheck", nil), i)
			var response PlacementItem
			if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &response) != nil || response.Check == nil {
				t.Errorf("failed diagnostic not returned for immediate dialog refresh: HTTP%d %s", w.Code, w.Body.String())
			}
			saved, _ := s.Store.placementItem(i.ID)
			if saved.Check == nil || saved.Check.CheckedAt == i.Check.CheckedAt {
				t.Fatalf("old green check retained: HTTP%d %+v", w.Code, saved.Check)
			}
			if _, e := time.Parse(time.RFC3339, saved.Check.CheckedAt); e != nil {
				t.Fatal(e)
			}
			if phase == "discovery" && saved.Check.Reachable {
				t.Fatal("unreachable disk kept green reachable flag")
			}
			if phase == "inspection" && saved.Check.NoConflict {
				t.Fatal("failed inspection kept green metadata flag")
			}
		})
	}
}
func TestReviewDistinctFiles146(t *testing.T) {
	s, cfg := placementFixture130(t)
	placementWrite130(t, cfg, "disk6", "film.mkv", strings.Repeat("x", 1000))
	for n := 0; n < 60; n++ {
		placementWrite130(t, cfg, "disk3", string(rune('a'+n))+".nfo", "x")
	}
	own, access := placementOwner, placementAccess
	placementOwner = func(st os.FileInfo) (uint32, uint32) {
		if strings.HasSuffix(st.Name(), ".nfo") {
			return 0, 0
		}
		return own(st)
	}
	placementAccess = func(_ string, mode uint32) error {
		if mode == 4 {
			return os.ErrPermission
		}
		return nil
	}
	defer func() { placementOwner, placementAccess = own, access }()
	i := placementPlan130(t, s, cfg)
	c := placementSourceCheck(&i, cfg.Unraid)
	seen := map[string]bool{}
	for _, f := range c.Files {
		key := f.Disk + "/" + f.Rel
		if seen[key] {
			t.Fatalf("duplicate file details: %s", key)
		}
		seen[key] = true
		if f.Reason != "unreadable" {
			t.Fatal("blocking reason lost")
		}
	}
	if len(c.Files) != 50 || c.MoreFiles != 10 || c.OwnerChanges != 60 {
		t.Fatalf("wrong distinct-file accounting: rows%d more%d owners%d", len(c.Files), c.MoreFiles, c.OwnerChanges)
	}
}

func TestReviewDistinctFilesByteLimit146(t *testing.T) {
	access := placementAccess
	placementAccess = func(_ string, mode uint32) error {
		if mode == 4 {
			return os.ErrPermission
		}
		return nil
	}
	defer func() { placementAccess = access }()
	deep := strings.Repeat("nested/", 200)
	item := PlacementItem{Rel: "movies/Film", Target: "disk6", Disks: map[string]PlacementDisk{"disk3": {}}, Files: []PlacementFile{{Disk: "disk3", Rel: strings.TrimSuffix(deep, "/"), Dir: true, UID: 99, Mode: uint32(os.ModeDir | 0777)}}}
	for n := 0; n < 60; n++ {
		item.Files = append(item.Files, PlacementFile{Disk: "disk3", Rel: deep + fmt.Sprintf("companion-%d.nfo", n), UID: 0, GID: 0, Mode: 0644})
	}
	c := placementSourceCheck(&item, defaultUnraidSettings())
	raw := placementCheckJSON(&c)
	var stored PlacementCheck
	if e := json.Unmarshal([]byte(raw), &stored); e != nil {
		t.Fatal(e)
	}
	if len(raw) > 16*1024 || len(stored.Files)+stored.MoreFiles != 60 {
		t.Fatalf("byte truncation lost distinct file count: bytes%d rows%d more%d", len(raw), len(stored.Files), stored.MoreFiles)
	}
	seen := map[string]bool{}
	for _, f := range stored.Files {
		if seen[f.Rel] {
			t.Fatal("duplicate path after byte truncation")
		}
		seen[f.Rel] = true
	}
}
