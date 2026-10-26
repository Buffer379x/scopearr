package app

import (
	"context"
	"fmt"
	"net/http/httptest"
	"net/url"
	"os"
	"sort"
	"strings"
	"testing"
	"time"
)

// A dropped state filter silently changes the meaning of a saved preset.
func TestPresetStateFilters161(t *testing.T) {
	s := testStore(t)
	for _, service := range []string{"radarr", "sonarr"} {
		p, duplicate, err := s.SavePreset(context.Background(), Preset{Name: "Measured " + service, Service: service, Query: "confirmed=true&mediaInfo=false"})
		if err != nil || duplicate != nil {
			t.Fatalf("save: %+v %v", duplicate, err)
		}
		got, _ := url.ParseQuery(p.Query)
		if got.Get("confirmed") != "true" || got.Get("mediaInfo") != "false" {
			t.Fatalf("lost state filters: %q", p.Query)
		}
	}
	presets, err := s.Presets()
	if err != nil || len(presets) != 2 {
		t.Fatalf("load: %+v %v", presets, err)
	}
	for _, p := range presets {
		if !strings.Contains(p.Query, "confirmed=true") || !strings.Contains(p.Query, "mediaInfo=false") {
			t.Fatalf("load lost filters: %q", p.Query)
		}
	}
	got, err := canonicalPresetQuery("confirmed=x&mediaInfo=x&codec=x264", "radarr")
	if err != nil || got != "codec=x264" {
		t.Fatalf("invalid preset states not discarded: %q %v", got, err)
	}
	if _, err = s.DB.Exec("INSERT INTO presets(name,service,query) VALUES('Legacy','radarr','codec=x265')"); err != nil {
		t.Fatal(err)
	}
	presets, err = s.Presets()
	if err != nil || len(presets) != 3 {
		t.Fatalf("legacy preset rejected: %+v %v", presets, err)
	}
}

func TestMediaInfoFilter161(t *testing.T) {
	s := testStore(t)
	for _, service := range []string{"radarr-test", "sonarr-test"} {
		files := make([]File, 5)
		for i := range files {
			f := metadataLifecycleFile160(i + 1)
			f.Service = service
			if strings.HasPrefix(service, "sonarr") {
				f.Series = "Synthetic series"
			}
			files[i] = f
		}
		if err := s.Replace(service, files, SyncStatus{Count: len(files)}); err != nil {
			t.Fatal(err)
		}
		for id := 1; id <= 4; id++ {
			f := files[id-1]
			path, size := f.SourcePath, f.Size
			if id == 2 {
				size++
			}
			if id == 3 {
				path += ".old"
			}
			instance := service
			if id == 4 {
				instance = service + "-other"
			}
			if _, err := s.DB.Exec("INSERT INTO mediainfo_results VALUES(?,?,?,?,?,?,?)", instance, id, path, size, 1, "25.09", "{}"); err != nil {
				t.Fatal(err)
			}
		}
		for _, tc := range []struct {
			state string
			want  []int
		}{{"true", []int{1}}, {"false", []int{2, 3, 4, 5}}} {
			q := url.Values{"service": {service}, "mediaInfo": {tc.state}}
			got, err := s.Query(q, "matches", false)
			if err != nil {
				t.Fatal(err)
			}
			ids := []int{}
			for _, f := range got.Files {
				ids = append(ids, f.ID)
			}
			sort.Ints(ids)
			if fmt.Sprint(ids) != fmt.Sprint(tc.want) || got.Total != len(tc.want) {
				t.Fatalf("%s %s: ids=%v total=%d", service, tc.state, ids, got.Total)
			}
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, err := NewServer(ctx, s, nil, "test")
	if err != nil {
		t.Fatal(err)
	}
	defer server.Sync.Shutdown()
	response := httptest.NewRecorder()
	server.filesHTTP(response, httptest.NewRequest("GET", "/api/files?service=radarr&mediaInfo=x", nil))
	if response.Code != 400 || !strings.Contains(response.Body.String(), "Invalid MediaInfo filter") {
		t.Fatalf("invalid query: %d %s", response.Code, response.Body.String())
	}
	w, args, err := s.scopedWhere(url.Values{"service": {"radarr"}, "mediaInfo": {"true"}})
	if err != nil {
		t.Fatal(err)
	}
	rows, err := s.DB.Query("EXPLAIN QUERY PLAN SELECT count(*) FROM files f WHERE "+w, args...)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	indexed := false
	for rows.Next() {
		var id, parent, unused int
		var detail string
		if err = rows.Scan(&id, &parent, &unused, &detail); err != nil {
			t.Fatal(err)
		}
		t.Log(detail)
		if strings.Contains(detail, "SEARCH m USING INDEX sqlite_autoindex_mediainfo_results_1") {
			indexed = true
		}
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	if !indexed {
		t.Fatal("MediaInfo filter did not use the result primary key")
	}
}

func TestPerformance50KMediaInfoFilter161(t *testing.T) {
	if os.Getenv("SCOPEARR_PERF") != "1" {
		t.Skip("set SCOPEARR_PERF=1")
	}
	s := testStore(t)
	files := make([]File, 50000)
	for i := range files {
		files[i] = metadataLifecycleFile160(i + 1)
	}
	if err := s.Replace("radarr", files, SyncStatus{Count: len(files)}); err != nil {
		t.Fatal(err)
	}
	seedLifecycleMetadata160(t, s, 500)
	for _, state := range []string{"true", "false"} {
		durations := make([]time.Duration, 20)
		for i := range durations {
			start := time.Now()
			out, err := s.Query(url.Values{"service": {"radarr"}, "mediaInfo": {state}}, "matches", false)
			durations[i] = time.Since(start)
			want := 500
			if state == "false" {
				want = 49500
			}
			if err != nil || out.Total != want {
				t.Fatalf("%s count %d: %v", state, out.Total, err)
			}
		}
		sort.Slice(durations, func(i, j int) bool { return durations[i] < durations[j] })
		t.Logf("50k MediaInfo=%s, 500 results: p50=%s p95=%s", state, durations[10], durations[19])
	}
}
