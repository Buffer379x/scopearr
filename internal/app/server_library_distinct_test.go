package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"
)

// newDistinctHarness serves the real handlers for a TV library of three
// series with five episodes each (instance "sonarr"; within a series the
// first episode has the highest ID, so the display order, not the ID,
// decides), a second instance with the same series name in other case and
// two episodes without a series, and three movies.
func newDistinctHarness(t *testing.T) trackFilterHarness200 {
	t.Helper()
	s := testStore(t)
	episode := func(id, media int, series string, number int) File {
		f := sample(id, fmt.Sprintf("%s.S01E%02d.1080p.mkv", series, number))
		f.MediaID = media
		f.Series = series
		f.Title = fmt.Sprintf("%s episode %d", series, number)
		f.Season = 1
		f.Episodes = []Episode{{ID: id, Number: number}}
		return f
	}
	main := []File{}
	for i, name := range []string{"Alpha", "Bravo", "Charlie"} {
		for n := 1; n <= 5; n++ {
			main = append(main, episode(100*(i+1)+10-n, i+1, name, n))
		}
	}
	if err := s.Replace("sonarr", main, SyncStatus{Count: len(main)}); err != nil {
		t.Fatal(err)
	}
	other := []File{episode(901, 9, "alpha", 1), episode(902, 10, "", 1), episode(903, 11, "", 2)}
	if err := s.Replace("sonarr-two", other, SyncStatus{Count: len(other)}); err != nil {
		t.Fatal(err)
	}
	movies := []File{}
	for i := 1; i <= 3; i++ {
		f := sample(i, fmt.Sprintf("Movie.%02d.2020.1080p.mkv", i))
		f.MediaID = i
		f.Title = fmt.Sprintf("Movie %02d", i)
		movies = append(movies, f)
	}
	if err := s.Replace("radarr", movies, SyncStatus{Count: len(movies)}); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	server, err := NewServer(ctx, s, nil, "test")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Sync.Shutdown)
	if _, err = s.DB.Exec("INSERT INTO sessions(token,csrf,expires) VALUES(?,?,?)", tokenHash("test-session"), "test-csrf", time.Now().Add(time.Hour).Unix()); err != nil {
		t.Fatal(err)
	}
	return trackFilterHarness200{t, s, server}
}

func distinctPage(t *testing.T, h trackFilterHarness200, raw string) (int, Results, string) {
	t.Helper()
	w := h.do("GET", "/api/files?"+raw, "", nil)
	var out Results
	var failure struct {
		Error string `json:"error"`
	}
	if w.Code == http.StatusOK {
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatalf("%s: %v", raw, err)
		}
	} else if err := json.Unmarshal(w.Body.Bytes(), &failure); err != nil {
		t.Fatalf("%s: %v", raw, err)
	}
	return w.Code, out, failure.Error
}

func distinctKeys(out Results) []string {
	list := []string{}
	for _, f := range out.Files {
		list = append(list, fmt.Sprintf("%s:%d", f.Service, f.ID))
	}
	return list
}

// Quick search (E18, R-I) asks the TV library for each series once:
// distinct=series keeps the first file of each series in the display
// order, then pages and limits; total and displayTotal count series. The
// same name in two instances (any case) and the files without a series are
// one series each, as quick search folds its hits by label.
func TestFilesDistinctSeries(t *testing.T) {
	h := newDistinctHarness(t)
	for _, c := range []struct {
		raw   string
		keys  []string
		total int
	}{
		{"instance=sonarr&limit=6", []string{"sonarr:109", "sonarr:209", "sonarr:309"}, 3},
		{"instance=sonarr&limit=2", []string{"sonarr:109", "sonarr:209"}, 3},
		{"instance=sonarr&limit=2&page=2", []string{"sonarr:309"}, 3},
		{"instance=sonarr&q=bravo&limit=6", []string{"sonarr:209"}, 1},
		// Across instances: "alpha" of the second instance folds into
		// "Alpha", and both files without a series are one.
		{"limit=6", []string{"sonarr-two:902", "sonarr:109", "sonarr:209", "sonarr:309"}, 4},
		{"instance=sonarr-two&limit=6", []string{"sonarr-two:902", "sonarr-two:901"}, 2},
	} {
		code, out, message := distinctPage(t, h, "service=sonarr&mode=matches&distinct=series&"+c.raw)
		if code != http.StatusOK {
			t.Fatalf("%s: HTTP %d %s", c.raw, code, message)
		}
		if fmt.Sprint(distinctKeys(out)) != fmt.Sprint(c.keys) || out.Total != c.total || out.DisplayTotal != c.total {
			t.Fatalf("%s: %v total %d/%d, want %v %d", c.raw, distinctKeys(out), out.Total, out.DisplayTotal, c.keys, c.total)
		}
	}
	// Without distinct the files count as before.
	code, out, _ := distinctPage(t, h, "service=sonarr&mode=matches&instance=sonarr&limit=6")
	if code != http.StatusOK || len(out.Files) != 6 || out.Total != 15 || out.DisplayTotal != 15 {
		t.Fatalf("without distinct: HTTP %d, %d files, total %d/%d", code, len(out.Files), out.Total, out.DisplayTotal)
	}
	// A client's reserved _distinct is never read.
	code, out, _ = distinctPage(t, h, "service=sonarr&mode=matches&instance=sonarr&limit=6&_distinct=series")
	if code != http.StatusOK || len(out.Files) != 6 || out.Total != 15 {
		t.Fatalf("client _distinct: HTTP %d, %d files, total %d", code, len(out.Files), out.Total)
	}
}

// distinct takes "series" only, and only in the matches view; any other
// value, or the season view, answers 400 with the view mode's message.
func TestFilesDistinctRejectsOtherValues(t *testing.T) {
	h := newDistinctHarness(t)
	for _, raw := range []string{
		"mode=matches&distinct=x",
		"mode=matches&distinct=Series",
		"mode=matches&distinct=series&distinct=x",
		"mode=season&distinct=series",
	} {
		code, out, message := distinctPage(t, h, "service=sonarr&"+raw)
		if code != http.StatusBadRequest || message != "Invalid view mode" || len(out.Files) != 0 {
			t.Fatalf("%s: HTTP %d %q, want 400 Invalid view mode", raw, code, message)
		}
	}
	// Empty is no distinct.
	if code, out, _ := distinctPage(t, h, "service=sonarr&mode=matches&instance=sonarr&distinct="); code != http.StatusOK || out.Total != 15 {
		t.Fatalf("empty distinct: HTTP %d total %d", code, out.Total)
	}
}

// Movies have no series: distinct=series leaves their answer as it is.
func TestFilesDistinctIgnoredForMovies(t *testing.T) {
	h := newDistinctHarness(t)
	_, plain, _ := distinctPage(t, h, "service=radarr&mode=matches&limit=6")
	code, out, message := distinctPage(t, h, "service=radarr&mode=matches&limit=6&distinct=series")
	if code != http.StatusOK || fmt.Sprint(distinctKeys(out)) != fmt.Sprint(distinctKeys(plain)) || out.Total != 3 || out.DisplayTotal != 3 || len(out.Files) != 3 {
		t.Fatalf("movies: HTTP %d %s %v total %d, want %v", code, message, distinctKeys(out), out.Total, distinctKeys(plain))
	}
}
