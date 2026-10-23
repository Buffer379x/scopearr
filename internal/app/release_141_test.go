package app

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestSeriesColumnSorting141(t *testing.T) {
	s := testStore(t)
	files := []File{}
	for n, series := range []string{"Zulu", "Alpha", "Alpha", "Zulu"} {
		f := sample(n+1, "Episode.mkv")
		f.Series = series
		f.Title = "Episode"
		f.MediaID = map[string]int{"Alpha": 10, "Zulu": 20}[series]
		f.Season = 1
		f.Episodes = []Episode{{ID: n + 1, Number: n%2 + 1}}
		f.Size = int64([]int{40, 20, 30, 10}[n])
		f.Resolution = []string{"2160p", "720p", "1080p", "480p"}[n]
		files = append(files, f)
	}
	if err := s.Replace("sonarr", files, SyncStatus{}); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		field, dir string
		ids        []int
		group      bool
	}{
		{"", "", []int{3, 2, 1, 4}, true}, {"title", "desc", []int{1, 4, 3, 2}, true}, {"size", "asc", []int{4, 2, 3, 1}, false}, {"size", "desc", []int{1, 3, 2, 4}, false}, {"resolution", "desc", []int{1, 3, 2, 4}, false},
	} {
		q := url.Values{"service": {"sonarr"}, "sort": {tc.field}, "dir": {tc.dir}}
		got, e := s.Query(q, "season", false)
		if e != nil {
			t.Fatal(e)
		}
		ids := []int{}
		for _, f := range got.Files {
			ids = append(ids, f.ID)
		}
		if !slices.Equal(ids, tc.ids) {
			t.Fatalf("%s/%s: %v want %v", tc.field, tc.dir, ids, tc.ids)
		}
		if groupedSeries(q) != tc.group {
			t.Fatal("grouping mismatch")
		}
		all, e := s.Query(q, "season", true)
		if e != nil || len(all.Files) != len(got.Files) {
			t.Fatal("CSV order query", e)
		}
		for i, f := range got.Files {
			if all.Files[i].ID != f.ID {
				t.Fatal("CSV order differs")
			}
		}
	}
	for _, field := range []string{"year", "codec", "source", "processing", "hdr", "bitDepth", "audio", "channels", "custom", "info"} {
		for _, dir := range []string{"asc", "desc"} {
			if _, e := s.Query(url.Values{"service": {"sonarr"}, "sort": {field}, "dir": {dir}}, "season", false); e != nil {
				t.Fatal(field, e)
			}
		}
	}
}

func TestToolPresets141(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	for _, tc := range []struct{ service, query string }{
		{"tool:placement", "status=split&share=Filme+%C3%84&target=disk3&kind=media_files&q=FOO+foo+bar"},
		{"tool:filecheck", "status=open&kind=junk&share=Movies"},
		{"tool:mux", "status=ready&status=failed&q=Film"},
	} {
		p, dup, e := s.SavePreset(ctx, Preset{Name: "Tool filters", Service: tc.service, Query: tc.query + "&page=8&sort=size&libraries=radarr&enabled=true"})
		if e != nil || dup != nil || p.ID == 0 {
			t.Fatal(p, dup, e)
		}
		q, _ := url.ParseQuery(p.Query)
		if q.Has("page") || q.Has("sort") || q.Has("libraries") || q.Has("enabled") {
			t.Fatal("scan/display options persisted", p.Query)
		}
		_, dup, e = s.SavePreset(ctx, Preset{Name: "Duplicate", Service: tc.service, Query: tc.query})
		if e != nil || dup == nil || dup.ID != p.ID {
			t.Fatal("duplicate not detected", e)
		}
	}
	for _, tc := range []struct{ service, query string }{{"tool:unknown", ""}, {"tool:placement", "status=bogus"}, {"tool:placement", "target=disk0"}, {"tool:filecheck", "kind=bogus"}, {"tool:filecheck", "share=../Movies"}, {"tool:filecheck", "share=a%5Cb"}, {"tool:filecheck", "share=%00"}, {"tool:mux", "status=bogus"}} {
		if _, e := canonicalPresetQuery(tc.query, tc.service); e == nil {
			t.Fatal("invalid preset accepted", tc)
		}
	}
	if key, e := canonicalPresetQuery("resolution=1080p&page=2", "radarr"); e != nil || key != "resolution=1080p" {
		t.Fatal("library canonicalization changed", key, e)
	}
}

func TestFileCheckSharesAndBulk141(t *testing.T) {
	s, cfg := placementFixture130(t)
	roots := []ScanRoot{}
	for _, share := range []string{"movies", "movies-extra"} {
		root := filepath.Join(cfg.Unraid.ShareRoot, share)
		roots = append(roots, ScanRoot{muxRootFolder: muxRootFolder{LocalPath: root, Mapped: true}, Share: share})
		for _, rel := range []string{"Folder/a.txt", "Folder/b.txt"} {
			fileCheckWrite131(t, root, rel, "x")
			fileCheckRow131(t, s, filepath.Join(root, "Folder"), filepath.Base(rel), "junk", "delete")
		}
	}
	s.FileCheck.mu.Lock()
	s.FileCheck.scan.Roots = roots
	s.FileCheck.mu.Unlock()
	for _, q := range []string{"share=movies", "share=movies-extra", "share=movies&share=movies-extra", "share=unknown"} {
		w := httptest.NewRecorder()
		s.fileCheckHTTP(w, httptest.NewRequest("GET", "/api/filecheck/items?"+q, nil))
		if strings.Contains(q, "unknown") {
			if w.Code != 400 {
				t.Fatal(w.Code)
			}
			continue
		}
		var got struct {
			Total         int
			SelectableIDs []int64 `json:"selectableIds"`
			Shares        map[string]int
		}
		if e := json.Unmarshal(w.Body.Bytes(), &got); e != nil {
			t.Fatal(e, w.Body.String())
		}
		want := 2
		if strings.Contains(q, "&") {
			want = 4
		}
		if got.Total != want || len(got.SelectableIDs) != want || got.Shares["movies"] != 2 || got.Shares["movies-extra"] != 2 {
			t.Fatal(q, got)
		}
	}
	w := httptest.NewRecorder()
	s.fileCheckStartFix(w, httptest.NewRequest("POST", "/api/filecheck/fix", strings.NewReader(`{"all":true,"query":"share=movies&status=open"}`)))
	if w.Code != 202 {
		t.Fatal(w.Code, w.Body.String())
	}
	var count int
	s.Store.DB.QueryRow("SELECT count(*) FROM filecheck_items WHERE job_status='queued'").Scan(&count)
	if count != 2 {
		t.Fatal("bulk crossed share filter", count)
	}
}
