package app

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestPlacementMultiFilters132(t *testing.T) {
	s, cfg := placementFixture130(t)
	placementWrite130(t, cfg, "disk3", "Film.nfo", "nfo")
	placementWrite130(t, cfg, "disk6", "Film.mkv", "video")
	base := placementPlan130(t, s, cfg)
	for n, row := range []struct{ status, job, target string }{
		{"split", "", "disk3"}, {"waiting_for_mover", "", "disk6"}, {"conflict", "", "disk1"}, {"split", "succeeded", "disk6"}, {"no_space", "failed", "disk3"},
	} {
		item := base
		item.ID = 0
		item.MediaID = n + 10
		item.Rel += jsonNumber130(int64(n))
		item.Key += jsonNumber130(int64(n))
		item.ScanStatus = row.status
		item.JobStatus = row.job
		item.Target = row.target
		if e := insertPlacement(context.Background(), s.Store.DB, "placement_items", &item); e != nil {
			t.Fatal(e)
		}
	}
	if _, e := s.Store.DB.Exec("DELETE FROM placement_items WHERE id=?", base.ID); e != nil {
		t.Fatal(e)
	}
	for _, tc := range []struct {
		query       string
		total, code int
	}{
		{"status=waiting_for_mover", 1, 200},
		{"status=waiting_for_mover&status=conflict", 2, 200},
		{"target=disk3&target=disk6", 4, 200},
		{"status=waiting_for_mover&status=conflict&target=disk3&target=disk6", 1, 200},
		{"status=several&status=moved", 5, 200},
		{"status=errors&status=moved", 3, 200},
		{"status=split&status=split", 2, 200},
		{"target=disk3%27%20OR%201=1--&target=disk1", 1, 200},
		{"status=conflict&status=unknown", 0, 400},
		{"status=unknown", 0, 400},
		{"", 5, 200},
	} {
		w := httptest.NewRecorder()
		s.placementHTTP(w, httptest.NewRequest("GET", "/api/placement/items?"+tc.query, nil))
		if w.Code != tc.code {
			t.Fatalf("%s: %d %s", tc.query, w.Code, w.Body.String())
		}
		if w.Code != 200 {
			continue
		}
		var got struct{ Total int }
		if e := json.Unmarshal(w.Body.Bytes(), &got); e != nil {
			t.Fatal(e)
		}
		if got.Total != tc.total {
			t.Fatalf("%s: got %d want %d", tc.query, got.Total, tc.total)
		}
	}
}

func TestFileCheckMultiFiltersAndFixAll132(t *testing.T) {
	s, cfg := placementFixture130(t)
	root := filepath.Join(cfg.Unraid.ShareRoot, "movies", "Film")
	ids := []int64{}
	for n, row := range []struct{ kind, fix, status string }{
		{"orphan", "delete", ""}, {"junk", "delete", ""}, {"permissions", "chmod", ""}, {"untracked_media", "delete", ""}, {"orphan", "manual", ""}, {"junk", "delete", "succeeded"}, {"orphan", "delete", "failed"},
	} {
		rel := jsonNumber130(int64(n)) + ".txt"
		fileCheckWrite131(t, root, rel, "x")
		item := fileCheckRow131(t, s, root, rel, row.kind, row.fix)
		ids = append(ids, item.ID)
		if _, e := s.Store.DB.Exec("UPDATE filecheck_items SET job_status=? WHERE id=?", row.status, item.ID); e != nil {
			t.Fatal(e)
		}
	}
	for _, tc := range []struct {
		query       string
		total, code int
	}{
		{"kind=orphan&kind=junk", 5, 200},
		{"status=open&status=manual", 5, 200},
		{"kind=orphan&kind=junk&status=open&status=manual", 3, 200},
		{"kind=orphan&kind=junk&status=open", 2, 200},
		{"kind=junk&status=fixed", 1, 200},
		{"status=failed", 1, 200},
		{"status=open&status=unknown", 0, 400},
		{"kind=junk&kind=unknown", 0, 400},
	} {
		w := httptest.NewRecorder()
		s.fileCheckHTTP(w, httptest.NewRequest("GET", "/api/filecheck/items?"+tc.query, nil))
		if w.Code != tc.code {
			t.Fatalf("%s: %d %s", tc.query, w.Code, w.Body.String())
		}
		if w.Code != 200 {
			continue
		}
		var got struct {
			Total         int
			SelectableIDs []int64 `json:"selectableIds"`
		}
		if e := json.Unmarshal(w.Body.Bytes(), &got); e != nil {
			t.Fatal(e)
		}
		if got.Total != tc.total {
			t.Fatalf("%s: got %d want %d", tc.query, got.Total, tc.total)
		}
		if tc.query == "kind=orphan&kind=junk&status=open" && !slices.Equal(got.SelectableIDs, ids[:2]) {
			t.Fatal(got.SelectableIDs)
		}
	}
	for _, query := range []string{"kind=orphan&kind=junk&status=open", "kind=orphan&kind=junk&kind=untracked_media&status=open"} {
		body, _ := json.Marshal(map[string]any{"all": true, "query": query})
		w := httptest.NewRecorder()
		s.fileCheckStartFix(w, httptest.NewRequest("POST", "/api/filecheck/fix", strings.NewReader(string(body))))
		if w.Code != 202 {
			t.Fatal(w.Code, w.Body.String())
		}
		queued := []int64{}
		rows, e := s.Store.DB.Query("SELECT id FROM filecheck_items WHERE job_status='queued' ORDER BY id")
		if e != nil {
			t.Fatal(e)
		}
		for rows.Next() {
			var id int64
			if e = rows.Scan(&id); e != nil {
				t.Fatal(e)
			}
			queued = append(queued, id)
		}
		rows.Close()
		if !slices.Equal(queued, ids[:2]) {
			t.Fatal(queued)
		}
		if _, e = s.Store.DB.Exec("UPDATE filecheck_items SET job_status='' WHERE job_status='queued'"); e != nil {
			t.Fatal(e)
		}
	}
	w := httptest.NewRecorder()
	s.fileCheckStartFix(w, httptest.NewRequest("POST", "/api/filecheck/fix", strings.NewReader(`{"all":true,"query":"status=unknown"}`)))
	if w.Code != 400 {
		t.Fatal(w.Code, w.Body.String())
	}
	counts := s.fileCheckActivity()["counts"].(map[string]int)
	if counts["kind:junk"] != 2 || counts["fixed"] != 1 {
		t.Fatal(counts)
	}
}
