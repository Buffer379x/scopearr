package app

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestPlacementCSVMatchesFilteredSortedList163(t *testing.T) {
	s, _ := muxServer120(t)
	s.Placement.mu.Lock()
	s.Placement.scan.Shares = []PlacementShare{{ShareDir: "movies", Folders: 4}, {ShareDir: "shows", Folders: 2}}
	s.Placement.mu.Unlock()
	for _, row := range []struct {
		title, share, kind, status, job, target string
		devices                                 int
	}{
		{"Alpha", "movies", "small_files", "split", "", "disk1", 2},
		{"Bravo", "shows", "media_files", "split", "", "disk2", 2},
		{"Charlie", "movies", "small_files", "ok", "", "disk1", 1},
		{"Delta", "movies", "small_files", "split", "failed", "disk2", 2},
		{"Echo", "movies", "media_files", "conflict", "", "", 2},
		{"Foxtrot", "shows", "media_files", "split", "", "disk1", 2},
	} {
		disks := map[string]PlacementDisk{"disk1": {Bytes: 1}}
		if row.devices == 2 {
			disks["disk2"] = PlacementDisk{Bytes: 1}
		}
		item := PlacementItem{Key: row.title, Title: row.title, Share: row.share, Rel: row.share + "/" + row.title, Kind: row.kind, ScanStatus: row.status, JobStatus: row.job, Target: row.target, Disks: disks, MoveBytes: 1}
		if err := insertPlacement(context.Background(), s.Store.DB, "placement_items", &item); err != nil {
			t.Fatal(err)
		}
	}
	for _, tc := range []struct {
		query string
		want  []string
	}{
		{"", []string{"Alpha", "Delta", "Bravo", "Foxtrot", "Echo"}},
		{"share=shows&sort=title&dir=desc", []string{"Foxtrot", "Bravo"}},
		{"kind=small_files&sort=title&dir=desc", []string{"Delta", "Alpha"}},
		{"status=one_disk", []string{"Charlie"}},
		{"status=failed&share=movies", []string{"Delta"}},
		{"q=bravo&status=all", []string{"Bravo"}},
		{"target=disk1&status=all&sort=title&dir=desc", []string{"Foxtrot", "Charlie", "Alpha"}},
		{"status=several&kind=media_files&share=shows&sort=title&dir=asc", []string{"Bravo", "Foxtrot"}},
		{"status=all&sort=title&dir=asc&limit=1&offset=1", []string{"Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"}},
	} {
		t.Run(tc.query, func(t *testing.T) {
			request := httptest.NewRequest("GET", "/api/placement/export.csv?"+tc.query, nil)
			w := httptest.NewRecorder()
			s.placementCSV(w, request)
			if w.Code != 200 {
				t.Fatal(w.Code, w.Body)
			}
			rows, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(w.Body.String(), "\ufeff"))).ReadAll()
			if err != nil {
				t.Fatal(err)
			}
			got := []string{}
			for _, row := range rows[1:] {
				got = append(got, row[4])
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("CSV titles=%v want%v", got, tc.want)
			}
			query := request.URL.Query()
			query.Set("limit", "500")
			query.Set("offset", "0")
			listW := httptest.NewRecorder()
			s.placementListHTTP(listW, httptest.NewRequest("GET", "/api/placement/items?"+query.Encode(), nil))
			var list struct{ Items []PlacementItem }
			if listW.Code != 200 || json.Unmarshal(listW.Body.Bytes(), &list) != nil {
				t.Fatal(listW.Code, listW.Body)
			}
			listed := []string{}
			for _, item := range list.Items {
				listed = append(listed, item.Title)
			}
			if !reflect.DeepEqual(listed, tc.want) {
				t.Errorf("list titles=%v want%v", listed, tc.want)
			}
		})
	}
	for _, query := range []string{"share=invented", "status=invented", "sort=invented&dir=asc", "sort=title&dir=sideways"} {
		w := httptest.NewRecorder()
		s.placementCSV(w, httptest.NewRequest("GET", "/api/placement/export.csv?"+query, nil))
		if w.Code != 400 {
			t.Errorf("CSV invalid query %q: status%d", query, w.Code)
		}
	}
}
