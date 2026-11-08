package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"
)

// newQuickSearchHarness200 serves the real handlers for five movies with a
// configured page size of 3, so the configured size, the default (100) and
// a limit tell apart.
func newQuickSearchHarness200(t *testing.T) trackFilterHarness200 {
	t.Helper()
	s := testStore(t)
	cfg := DefaultSettings()
	cfg.PageSize = 3
	cfg.Radarr.Enabled = true
	cfg.Radarr.URL = "http://radarr.test"
	if err := s.Put("settings", cfg); err != nil {
		t.Fatal(err)
	}
	files := []File{}
	for i := 1; i <= 5; i++ {
		f := sample(i, fmt.Sprintf("Movie.%02d.2020.1080p.mkv", i))
		f.MediaID = i
		f.Title = fmt.Sprintf("Movie %02d", i)
		files = append(files, f)
	}
	if err := s.Replace("radarr", files, SyncStatus{Count: len(files)}); err != nil {
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

// Quick search (E18) asks /api/files for its first few titles with the
// optional limit: set, it is the page size of this one request, checked
// like the page size with its message; absent, the configured page size
// applies as in 1.7.0. It reads only and stores nothing.
func TestQuickSearchLimit200(t *testing.T) {
	h := newQuickSearchHarness200(t)
	page := func(raw, locale string) (int, Results, string) {
		t.Helper()
		w := h.do("GET", "/api/files?service=radarr&mode=matches&"+raw, locale, nil)
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
	ids := func(out Results) []int {
		list := []int{}
		for _, f := range out.Files {
			list = append(list, f.ID)
		}
		return list
	}

	// A limit is the page size of the request; the total stays the count of
	// every match, and pages step by the limit.
	for _, c := range []struct {
		raw   string
		ids   []int
		size  int
		total int
	}{
		{"limit=2", []int{1, 2}, 2, 5},
		{"q=movie&limit=2", []int{1, 2}, 2, 5},
		{"q=movie&limit=2&page=2", []int{3, 4}, 2, 5},
		{"limit=1", []int{1}, 1, 5},
		{"limit=1000", []int{1, 2, 3, 4, 5}, 1000, 5},
		{"q=movie+05&limit=6", []int{5}, 6, 1},
		// A client's _pageSize never wins over the limit.
		{"limit=2&_pageSize=5", []int{1, 2}, 2, 5},
	} {
		code, out, message := page(c.raw, "")
		if code != http.StatusOK {
			t.Fatalf("%s: HTTP %d %s", c.raw, code, message)
		}
		if fmt.Sprint(ids(out)) != fmt.Sprint(c.ids) || out.PageSize != c.size || out.Total != c.total {
			t.Fatalf("%s: ids %v pageSize %d total %d, want %v %d %d", c.raw, ids(out), out.PageSize, out.Total, c.ids, c.size, c.total)
		}
	}

	// Without a limit: the configured page size, as in 1.7.0, also against
	// a client's _pageSize.
	for _, raw := range []string{"", "q=movie", "_pageSize=5", "page=2"} {
		code, out, message := page(raw, "")
		want := []int{1, 2, 3}
		if raw == "page=2" {
			want = []int{4, 5}
		}
		if code != http.StatusOK || out.PageSize != 3 || fmt.Sprint(ids(out)) != fmt.Sprint(want) {
			t.Fatalf("%q: HTTP %d %s pageSize %d ids %v, want 3 %v", raw, code, message, out.PageSize, ids(out), want)
		}
	}

	// Outside 1 to 1000, not a number or empty: 400 with the page size's
	// message, in the request's language.
	for _, raw := range []string{"limit=0", "limit=1001", "limit=x", "limit=-1", "limit=", "limit=2.5", "limit=%202"} {
		for locale, want := range map[string]string{
			"":   "Entries per page must be between 1 and 1000",
			"en": "Entries per page must be between 1 and 1000",
			"de": "Einträge pro Seite müssen zwischen 1 und 1000 liegen",
		} {
			code, out, message := page(raw, locale)
			if code != http.StatusBadRequest || message != want || len(out.Files) != 0 {
				t.Fatalf("%s (%s): HTTP %d %q %v, want 400 %q", raw, locale, code, message, ids(out), want)
			}
		}
	}

	// The configured page size is left alone.
	if got := h.server.Config().PageSize; got != 3 {
		t.Fatalf("configured page size changed to %d", got)
	}
}
