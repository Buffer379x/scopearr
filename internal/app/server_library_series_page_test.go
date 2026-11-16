package app

import (
	"fmt"
	"net/http"
	"testing"
)

// seriesOf lists the series of an answer in its order, each once, by the
// table's grouping (instance and media ID).
func seriesOf(out Results) []string {
	list := []string{}
	for i, f := range out.Files {
		if i == 0 || out.Files[i-1].Service != f.Service || out.Files[i-1].MediaID != f.MediaID {
			list = append(list, fmt.Sprintf("%s/%d", f.Service, f.MediaID))
		}
	}
	return list
}

// The collapsed series view (rc.4 R2) asks for pageBy=series: a page holds
// `limit` series of the series order with all their matching files;
// displayTotal counts the series, total the matching files and offset the
// matching files of the series on the pages before. Series are grouped as
// the table groups them (instance and media ID), so "alpha" of the second
// instance and each file without a series are series of their own.
func TestFilesPageBySeries(t *testing.T) {
	h := newDistinctHarness(t)
	for _, c := range []struct {
		raw    string
		series []string
		files  int
		total  int
		shows  int
		offset int
	}{
		{"instance=sonarr&limit=2", []string{"sonarr/1", "sonarr/2"}, 10, 15, 3, 0},
		{"instance=sonarr&limit=2&page=2", []string{"sonarr/3"}, 5, 15, 3, 10},
		{"instance=sonarr&limit=2&dir=desc", []string{"sonarr/3", "sonarr/2"}, 10, 15, 3, 0},
		{"instance=sonarr&limit=1&page=3&sort=title", []string{"sonarr/3"}, 5, 15, 3, 10},
		{"instance=sonarr&limit=2&q=bravo", []string{"sonarr/2"}, 5, 5, 1, 0},
		// Past the last page: no files, the counts stay.
		{"instance=sonarr&limit=2&page=9", []string{}, 0, 15, 3, 15},
		// Both instances: the files without a series first, then "Alpha"
		// before "alpha" of the second instance.
		{"limit=3", []string{"sonarr-two/10", "sonarr-two/11", "sonarr/1"}, 7, 18, 6, 0},
		{"limit=3&page=2", []string{"sonarr-two/9", "sonarr/2", "sonarr/3"}, 11, 18, 6, 7},
	} {
		code, out, message := distinctPage(t, h, "service=sonarr&mode=matches&pageBy=series&"+c.raw)
		if code != http.StatusOK {
			t.Fatalf("%s: HTTP %d %s", c.raw, code, message)
		}
		if fmt.Sprint(seriesOf(out)) != fmt.Sprint(c.series) || len(out.Files) != c.files || out.Total != c.total || out.DisplayTotal != c.shows || out.Offset != c.offset || out.PagedBy != "series" {
			t.Fatalf("%s: %v %d files total %d/%d offset %d by %q, want %v %d files total %d/%d offset %d", c.raw, seriesOf(out), len(out.Files), out.Total, out.DisplayTotal, out.Offset, out.PagedBy, c.series, c.files, c.total, c.shows, c.offset)
		}
	}
	// Within a series the files keep the display order (season, episode).
	_, out, _ := distinctPage(t, h, "service=sonarr&mode=matches&pageBy=series&instance=sonarr&limit=1")
	if fmt.Sprint(distinctKeys(out)) != "[sonarr:109 sonarr:108 sonarr:107 sonarr:106 sonarr:105]" {
		t.Fatalf("order: %v", distinctKeys(out))
	}
	// Another sort pages by files as before.
	code, out, _ := distinctPage(t, h, "service=sonarr&mode=matches&pageBy=series&instance=sonarr&limit=2&sort=size")
	if code != http.StatusOK || len(out.Files) != 2 || out.Total != 15 || out.DisplayTotal != 15 || out.PagedBy != "" {
		t.Fatalf("sort size: HTTP %d, %d files, total %d/%d by %q", code, len(out.Files), out.Total, out.DisplayTotal, out.PagedBy)
	}
	// A client's reserved _pageBy is never read.
	code, out, _ = distinctPage(t, h, "service=sonarr&mode=matches&instance=sonarr&limit=2&_pageBy=series")
	if code != http.StatusOK || len(out.Files) != 2 || out.DisplayTotal != 15 || out.PagedBy != "" {
		t.Fatalf("client _pageBy: HTTP %d, %d files, total %d by %q", code, len(out.Files), out.DisplayTotal, out.PagedBy)
	}
	// Empty is no pageBy.
	if code, out, _ := distinctPage(t, h, "service=sonarr&mode=matches&instance=sonarr&limit=2&pageBy="); code != http.StatusOK || len(out.Files) != 2 || out.PagedBy != "" {
		t.Fatalf("empty pageBy: HTTP %d, %d files by %q", code, len(out.Files), out.PagedBy)
	}
}

// In the season view (whole seasons) a series page lists every season
// with a match as context; only the matching files are marked, total
// counts them and displayTotal the series.
func TestFilesPageBySeriesSeasonView(t *testing.T) {
	h := newDistinctHarness(t)
	code, out, message := distinctPage(t, h, "service=sonarr&mode=season&pageBy=series&instance=sonarr&limit=2&fileId=208")
	if code != http.StatusOK {
		t.Fatalf("HTTP %d %s", code, message)
	}
	matched := 0
	for _, f := range out.Files {
		if f.Matched {
			matched++
		}
	}
	if fmt.Sprint(seriesOf(out)) != "[sonarr/2]" || len(out.Files) != 5 || matched != 1 || out.Total != 1 || out.DisplayTotal != 1 || out.PagedBy != "series" {
		t.Fatalf("season view: %v %d files, %d matched, total %d/%d by %q", seriesOf(out), len(out.Files), matched, out.Total, out.DisplayTotal, out.PagedBy)
	}
	// Without a filter, two series of five files each.
	_, out, _ = distinctPage(t, h, "service=sonarr&mode=season&pageBy=series&instance=sonarr&limit=2&page=2")
	if fmt.Sprint(seriesOf(out)) != "[sonarr/3]" || len(out.Files) != 5 || out.Total != 15 || out.DisplayTotal != 3 || out.Offset != 10 {
		t.Fatalf("season view page 2: %v %d files total %d/%d offset %d", seriesOf(out), len(out.Files), out.Total, out.DisplayTotal, out.Offset)
	}
}

// pageBy takes "series" only, once, and not with distinct; movies have no
// series, so their answer stays as it is.
func TestFilesPageByRejectsOtherValues(t *testing.T) {
	h := newDistinctHarness(t)
	for _, raw := range []string{
		"pageBy=x",
		"pageBy=Series",
		"pageBy=series&pageBy=series",
		"pageBy=series&distinct=series",
	} {
		code, out, message := distinctPage(t, h, "service=sonarr&mode=matches&"+raw)
		if code != http.StatusBadRequest || message != "Invalid view mode" || len(out.Files) != 0 {
			t.Fatalf("%s: HTTP %d %q, want 400 Invalid view mode", raw, code, message)
		}
	}
	_, plain, _ := distinctPage(t, h, "service=radarr&mode=matches&limit=2")
	code, out, message := distinctPage(t, h, "service=radarr&mode=matches&limit=2&pageBy=series")
	if code != http.StatusOK || fmt.Sprint(distinctKeys(out)) != fmt.Sprint(distinctKeys(plain)) || out.DisplayTotal != 3 || out.PagedBy != "" {
		t.Fatalf("movies: HTTP %d %s %v total %d by %q", code, message, distinctKeys(out), out.DisplayTotal, out.PagedBy)
	}
}
