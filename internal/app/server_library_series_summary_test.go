package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
)

// newSummaryHarness is the distinct harness with seasons: the series of
// the main instance spread their five episodes over two seasons (1, 1, 2,
// 2, 2) and the third one's last episode is 2160p.
func newSummaryHarness(t *testing.T) trackFilterHarness200 {
	t.Helper()
	h := newDistinctHarness(t)
	main := []File{}
	for i, name := range []string{"Alpha", "Bravo", "Charlie"} {
		for n := 1; n <= 5; n++ {
			season := 1
			if n > 2 {
				season = 2
			}
			resolution := "1080p"
			if i == 2 && n == 5 {
				resolution = "2160p"
			}
			f := sample(100*(i+1)+10-n, fmt.Sprintf("%s.S%02dE%02d.%s.mkv", name, season, n, resolution))
			f.MediaID = i + 1
			f.Series = name
			f.Title = fmt.Sprintf("%s episode %d", name, n)
			f.Season = season
			f.Episodes = []Episode{{ID: f.ID, Number: n}}
			main = append(main, f)
		}
	}
	if err := h.store.Replace("sonarr", main, SyncStatus{Count: len(main)}); err != nil {
		t.Fatal(err)
	}
	return h
}

// summaryOf aggregates a full answer of a page of series as the collapsed
// rows of the table do: per series (instance and media ID, in the order of
// the files) its first file's name, its files, its seasons and the files'
// [id, season].
func summaryOf(out Results) []SeriesSummary {
	list := []SeriesSummary{}
	seasons := map[string]map[int]bool{}
	for _, f := range out.Files {
		key := fmt.Sprintf("%s/%d", f.Service, f.MediaID)
		last := len(list) - 1
		if last < 0 || list[last].Service != f.Service || list[last].MediaID != f.MediaID {
			list = append(list, SeriesSummary{Service: f.Service, MediaID: f.MediaID, Series: f.Series, Keys: [][2]int{}})
			last++
			seasons[key] = map[int]bool{}
		}
		list[last].Files++
		list[last].Keys = append(list[last].Keys, [2]int{f.ID, f.Season})
		if !seasons[key][f.Season] {
			seasons[key][f.Season] = true
			list[last].Seasons++
		}
	}
	return list
}

func summaryJSON(t *testing.T, value any) string {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

// summary=1 (D33a) answers a page of series with the numbers of the
// collapsed rows, the same as the full answer aggregates to, across the
// filters, sorts, pages, instances and both season views; the counts and
// offset stay those of the full answer, and files holds only the files of
// the series that expand names, in the full answer's order.
func TestFilesPageBySeriesSummary(t *testing.T) {
	h := newSummaryHarness(t)
	for _, raw := range []string{
		"mode=matches&instance=sonarr&limit=2",
		"mode=matches&instance=sonarr&limit=2&page=2",
		"mode=matches&instance=sonarr&limit=2&dir=desc",
		"mode=matches&instance=sonarr&limit=1&page=3&sort=title",
		"mode=matches&instance=sonarr&limit=2&q=bravo",
		"mode=matches&instance=sonarr&limit=2&resolution=2160p",
		"mode=matches&instance=sonarr&limit=2&page=9",
		"mode=matches&limit=3",
		"mode=matches&limit=3&page=2",
		"mode=matches&limit=1000",
		"mode=season&instance=sonarr&limit=2&fileId=208",
		"mode=season&instance=sonarr&limit=2&resolution=2160p",
		"mode=season&limit=3&page=2",
	} {
		base := "service=sonarr&pageBy=series&" + raw
		code, full, message := distinctPage(t, h, base)
		if code != http.StatusOK {
			t.Fatalf("%s: HTTP %d %s", raw, code, message)
		}
		code, sum, message := distinctPage(t, h, base+"&summary=1")
		if code != http.StatusOK {
			t.Fatalf("%s summary: HTTP %d %s", raw, code, message)
		}
		want := summaryOf(full)
		if got, wanted := summaryJSON(t, *sum.Series), summaryJSON(t, want); got != wanted {
			t.Fatalf("%s: series %s, want %s", raw, got, wanted)
		}
		if len(sum.Files) != 0 || sum.Total != full.Total || sum.DisplayTotal != full.DisplayTotal || sum.Offset != full.Offset || sum.Page != full.Page || sum.PageSize != full.PageSize || sum.PagedBy != "series" {
			t.Fatalf("%s: %d files total %d/%d offset %d page %d/%d by %q, want 0 files total %d/%d offset %d page %d/%d", raw, len(sum.Files), sum.Total, sum.DisplayTotal, sum.Offset, sum.Page, sum.PageSize, sum.PagedBy, full.Total, full.DisplayTotal, full.Offset, full.Page, full.PageSize)
		}
		// Expanding every other series: exactly their files, as in the
		// full answer (data, custom tags, matched), in its order.
		query := base + "&summary=1"
		wantFiles := []File{}
		opened := map[string]bool{}
		for i, s := range want {
			if i%2 == 0 {
				key := fmt.Sprintf("%s/%d", s.Service, s.MediaID)
				opened[key] = true
				query += "&expand=" + key
			}
		}
		query += "&expand=sonarr/999"
		for _, f := range full.Files {
			if opened[fmt.Sprintf("%s/%d", f.Service, f.MediaID)] {
				wantFiles = append(wantFiles, f)
			}
		}
		code, expanded, message := distinctPage(t, h, query)
		if code != http.StatusOK {
			t.Fatalf("%s expand: HTTP %d %s", raw, code, message)
		}
		if got, wanted := summaryJSON(t, expanded.Files), summaryJSON(t, wantFiles); got != wanted {
			t.Fatalf("%s expand: files %s, want %s", raw, got, wanted)
		}
		if summaryJSON(t, *expanded.Series) != summaryJSON(t, want) {
			t.Fatalf("%s expand: series %s", raw, summaryJSON(t, expanded.Series))
		}
	}
	// The season view lists the context of a matching season too: Charlie's
	// season 2 holds the 2160p episode and two more.
	_, out, _ := distinctPage(t, h, "service=sonarr&pageBy=series&summary=1&mode=season&instance=sonarr&resolution=2160p")
	if summaryJSON(t, out.Series) != `[{"service":"sonarr","mediaId":3,"series":"Charlie","files":3,"seasons":1,"keys":[[307,2],[306,2],[305,2]]}]` || out.Total != 1 {
		t.Fatalf("season context: %s total %d", summaryJSON(t, out.Series), out.Total)
	}
	_, out, _ = distinctPage(t, h, "service=sonarr&pageBy=series&summary=1&mode=matches&instance=sonarr&limit=1")
	if summaryJSON(t, out.Series) != `[{"service":"sonarr","mediaId":1,"series":"Alpha","files":5,"seasons":2,"keys":[[109,1],[108,1],[107,2],[106,2],[105,2]]}]` {
		t.Fatalf("first series: %s", summaryJSON(t, out.Series))
	}
}

// Without summary the answer stays as it was (no series member); summary
// takes "1" only and needs pageBy=series, expand needs summary; in another
// sort, where pageBy pages by files, summary changes nothing either.
func TestFilesPageBySeriesSummaryParameters(t *testing.T) {
	h := newSummaryHarness(t)
	w := h.do("GET", "/api/files?service=sonarr&mode=matches&pageBy=series&limit=2", "", nil)
	var members map[string]json.RawMessage
	if err := json.Unmarshal(w.Body.Bytes(), &members); err != nil {
		t.Fatal(err)
	}
	if _, ok := members["series"]; ok || w.Code != http.StatusOK {
		t.Fatalf("plain answer: HTTP %d %s", w.Code, w.Body.String())
	}
	for _, raw := range []string{
		"summary=1",
		"summary=true",
		"pageBy=series&summary=0",
		"pageBy=series&summary=1&summary=1",
		"expand=sonarr/1",
		"pageBy=series&expand=sonarr/1",
		"pageBy=series&distinct=series&summary=1",
	} {
		code, _, message := distinctPage(t, h, "service=sonarr&mode=matches&"+raw)
		if code != http.StatusBadRequest || message != "Invalid view mode" {
			t.Fatalf("%s: HTTP %d %q, want 400 Invalid view mode", raw, code, message)
		}
	}
	// Empty is no summary; a client's reserved _summary is never read.
	for _, raw := range []string{"summary=", "_summary=1&_expand=%5B%22sonarr%2F1%22%5D"} {
		code, out, message := distinctPage(t, h, "service=sonarr&mode=matches&pageBy=series&instance=sonarr&limit=2&"+raw)
		if code != http.StatusOK || out.Series != nil || len(out.Files) != 10 {
			t.Fatalf("%s: HTTP %d %s, series %v, %d files", raw, code, message, out.Series, len(out.Files))
		}
	}
	code, out, message := distinctPage(t, h, "service=sonarr&mode=matches&pageBy=series&summary=1&instance=sonarr&limit=2&sort=size")
	if code != http.StatusOK || out.Series != nil || len(out.Files) != 2 || out.PagedBy != "" {
		t.Fatalf("sort size: HTTP %d %s, series %v, %d files by %q", code, message, out.Series, len(out.Files), out.PagedBy)
	}
}
