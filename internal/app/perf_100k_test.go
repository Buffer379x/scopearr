package app

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"
)

// TestPerformance100K is the 2.0.0 load check (Phase 6.2): a store with
// 100 000 files (80 000 episodes in 2 000 series, 20 000 movies, audio
// tracks, custom tags) answers the library requests through the real
// handlers. Opt-in only:
//
//	SCOPEARR_PERF=1 go test ./internal/app -run TestPerformance100K -v -timeout 30m
//
// Each request runs several times; the log lists the median and the slowest
// run. A 50-entry page above 300 ms fails (the quick search's worst case,
// a search every one of the 80 000 episodes matches, has 450 ms: its cost
// grows with the matches, about 4.5 µs each), as does a CSV export that
// grows clearly faster than its row count.
func TestPerformance100K(t *testing.T) {
	if os.Getenv("SCOPEARR_PERF") != "1" {
		t.Skip("set SCOPEARR_PERF=1")
	}
	ctx := context.Background()
	s := testStore(t)
	languages := []string{"Deutsch", "Englisch", "Japanisch", "Französisch"}
	codecs := []string{"DTS-HD MA", "AC-3", "E-AC-3", "TrueHD", "AAC"}
	layouts := []struct {
		channels int
		layout   string
	}{{8, "7.1"}, {6, "5.1"}, {2, "2.0"}}
	resolutions := []string{"1080p", "2160p", "1080p", "720p", "1080p", "2160p", "480p"}
	sources := []string{"WEB-DL", "BluRay", "WEBRip", "BluRay.Remux", "HDTV"}
	videoCodecs := []string{"x264", "x265", "HEVC", "AV1"}
	tracks := func(i int) []AudioTrack {
		list := []AudioTrack{}
		for n := 0; n <= i%3; n++ {
			l := layouts[(i+n)%len(layouts)]
			list = append(list, AudioTrack{Index: n + 1, Language: languages[(i/3+n)%len(languages)], Codec: codecs[(i+2*n)%len(codecs)], Channels: l.channels, ChannelLayout: l.layout, Default: n == 0})
		}
		return list
	}
	file := func(i, id, media int, title, name string) File {
		r, src, c := resolutions[i%len(resolutions)], sources[i%len(sources)], videoCodecs[i%len(videoCodecs)]
		hdr := ""
		if r == "2160p" {
			hdr = ".HDR10.10bit"
		}
		f := File{ID: id, MediaID: media, Title: title, Years: []int{1980 + i%45}, Episodes: []Episode{}, Filename: fmt.Sprintf("%s.%s.%s.%s%s.mkv", name, r, src, c, hdr), Size: int64(1+i%40) << 28}
		at := tracks(i)
		langs := []string{}
		for _, a := range at {
			langs = append(langs, a.Language)
		}
		Enrich(&f, APIInfo{AudioStreamCount: len(at), Quality: src + "-" + r, VideoCodec: family(c), AudioCodec: at[0].Codec, AudioChannels: float64(at[0].Channels), AudioLanguages: strings.Join(langs, " / ")})
		f.AudioTracks = at
		return f
	}
	movies := make([]File, 0, 20000)
	for i := 0; i < 20000; i++ {
		title := fmt.Sprintf("Movie %05d %s", i, []string{"Dawn", "Night", "Storm", "River", "Glass"}[i%5])
		movies = append(movies, file(i, i+1, i+1, title, strings.ReplaceAll(title, " ", ".")))
	}
	episodes := make([]File, 0, 80000)
	id := 0
	for series := 1; series <= 2000; series++ {
		name := fmt.Sprintf("Series %04d %s", series, []string{"Chronicles", "Files", "Saga", "Stories"}[series%4])
		for season := 1; season <= 4; season++ {
			for ep := 1; ep <= 10; ep++ {
				id++
				f := file(series+season+ep, id, series, fmt.Sprintf("E%02d · Episode %d", ep, ep), fmt.Sprintf("%s.S%02dE%02d", strings.ReplaceAll(name, " ", "."), season, ep))
				f.Series, f.Season = name, season
				f.Episodes = []Episode{{ID: id, Number: ep, Title: fmt.Sprintf("Episode %d", ep), Year: 1990 + series%30}}
				episodes = append(episodes, f)
			}
		}
	}
	// Copies: Replace consumes nothing, but the delta below reuses a series.
	seed := func(service string, files []File) time.Duration {
		list := append([]File(nil), files...)
		start := time.Now()
		if err := s.Replace(service, list, SyncStatus{Count: len(list)}); err != nil {
			t.Fatal(err)
		}
		return time.Since(start)
	}
	report := []string{}
	log := func(format string, args ...any) {
		line := fmt.Sprintf(format, args...)
		report = append(report, line)
		t.Log(line)
	}
	log("seed radarr 20 000: %s", seed("radarr", movies).Round(time.Millisecond))
	log("seed sonarr 80 000: %s", seed("sonarr", episodes).Round(time.Millisecond))
	archive, _ := s.SaveCustomTag(ctx, CustomTag{Name: "Archive"})
	favorite, _ := s.SaveCustomTag(ctx, CustomTag{Name: "Favorites"})
	for _, c := range []struct {
		service, resolution string
		tag                 CustomTag
	}{{"radarr", "2160p", archive}, {"sonarr", "2160p", archive}, {"radarr", "720p", favorite}, {"sonarr", "1080p", favorite}} {
		start := time.Now()
		n, err := s.ApplyCustom(ctx, url.Values{"service": {c.service}, "resolution": {c.resolution}}, map[string]bool{strconv.FormatInt(c.tag.ID, 10): true})
		if err != nil {
			t.Fatal(err)
		}
		log("custom tag %s on %s %s: %d files in %s", c.tag.Name, c.service, c.resolution, n, time.Since(start).Round(time.Millisecond))
	}

	cctx, cancel := context.WithCancel(ctx)
	t.Cleanup(cancel)
	server, err := NewServer(cctx, s, nil, "test")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Sync.Shutdown)
	if _, err = s.DB.Exec("INSERT INTO sessions(token,csrf,expires) VALUES(?,?,?)", tokenHash("test-session"), "test-csrf", time.Now().Add(time.Hour).Unix()); err != nil {
		t.Fatal(err)
	}
	h := trackFilterHarness200{t, s, server}
	measure := func(runs int, target string) (time.Duration, time.Duration, int) {
		times := []time.Duration{}
		size := 0
		for i := 0; i < runs; i++ {
			start := time.Now()
			w := h.do("GET", target, "", nil)
			times = append(times, time.Since(start))
			if w.Code != http.StatusOK {
				t.Fatalf("%s: HTTP %d %s", target, w.Code, w.Body.String())
			}
			size = w.Body.Len()
		}
		sort.Slice(times, func(i, j int) bool { return times[i] < times[j] })
		return times[len(times)/2], times[len(times)-1], size
	}
	a, b := strconv.FormatInt(archive.ID, 10), strconv.FormatInt(favorite.ID, 10)
	track := url.QueryEscape("Deutsch|DTS-HD MA|")
	slow := []string{}
	files := func(label, raw string, limit int) {
		target := fmt.Sprintf("/api/files?mode=matches&limit=%d&%s", limit, raw)
		median, max, size := measure(5, target)
		log("| %s | %d | %s | %s | %d kB |", label, limit, median.Round(100*time.Microsecond), max.Round(100*time.Microsecond), size/1024)
		bound := 300 * time.Millisecond
		if strings.Contains(label, "every episode matches") {
			bound = 450 * time.Millisecond
		}
		if limit == 50 && median > bound {
			slow = append(slow, fmt.Sprintf("%s (%s)", label, median))
		}
	}
	type request struct{ label, raw string }
	library := []request{
		{"movies, title (1.7.0)", "service=radarr"},
		{"movies, title, last page", "service=radarr&page=%LAST%"},
		{"movies, size desc", "service=radarr&sort=size&dir=desc"},
		{"movies, year", "service=radarr&sort=year"},
		{"movies, audio", "service=radarr&sort=audio"},
		{"movies, custom sort", "service=radarr&sort=custom"},
		{"movies, info sort", "service=radarr&sort=info"},
		{"movies, resolution=2160p", "service=radarr&resolution=2160p"},
		{"movies, search \"storm\"", "service=radarr&q=storm"},
		{"movies, custom all (2)", "service=radarr&custom=" + a + "&custom=" + b + "&customOp=all"},
		{"movies, custom any", "service=radarr&custom=" + a + "&custom=" + b},
		{"movies, track= (2.0)", "service=radarr&track=" + track},
		{"movies, track= + 2160p + custom", "service=radarr&track=" + track + "&resolution=2160p&custom=" + a},
		{"series, grouped (1.7.0)", "service=sonarr"},
		{"series, grouped, last page", "service=sonarr&page=%LAST%"},
		{"series, size desc", "service=sonarr&sort=size&dir=desc"},
		{"series, search \"saga\"", "service=sonarr&q=saga"},
		{"series, resolution=2160p", "service=sonarr&resolution=2160p"},
		{"series, track= (2.0)", "service=sonarr&track=" + track},
		{"series, custom any", "service=sonarr&custom=" + a + "&custom=" + b},
		{"series, pageBy=series p1 (rc.4)", "service=sonarr&pageBy=series"},
		{"series, pageBy=series p20", "service=sonarr&pageBy=series&page=20"},
		{"series, pageBy=series last", "service=sonarr&pageBy=series&page=%LASTSERIES%"},
		{"series, pageBy=series + 2160p", "service=sonarr&pageBy=series&resolution=2160p"},
		{"series, pageBy=series + search", "service=sonarr&pageBy=series&q=saga&page=5"},
		{"series, pageBy=series summary p1 (D33a)", "service=sonarr&pageBy=series&summary=1"},
		{"series, pageBy=series summary p20", "service=sonarr&pageBy=series&summary=1&page=20"},
		{"series, pageBy=series summary last", "service=sonarr&pageBy=series&summary=1&page=%LASTSERIES%"},
		{"series, pageBy=series summary + 2160p", "service=sonarr&pageBy=series&summary=1&resolution=2160p"},
		{"series, pageBy=series summary + search", "service=sonarr&pageBy=series&summary=1&q=saga&page=5"},
		{"series, pageBy=series summary, 1 expanded", "service=sonarr&pageBy=series&summary=1&expand=sonarr/1"},
		{"series, distinct=series, every episode matches", "service=sonarr&distinct=series&q=series"},
		{"series, distinct=series q=saga", "service=sonarr&distinct=series&q=saga"},
		{"series, distinct=series q=0042", "service=sonarr&distinct=series&q=0042"},
	}
	log("| request | limit | median | max | body |")
	log("|---|---:|---:|---:|---:|")
	files("series, pageBy=series, 1 series", "service=sonarr&pageBy=series", 1)
	files("quick search movies (limit 6)", "service=radarr&q=storm", 6)
	files("quick search series (limit 6)", "service=sonarr&distinct=series&q=saga", 6)
	for _, limit := range []int{50, 100, 1000} {
		for _, r := range library {
			raw := r.raw
			total := 20000
			if strings.Contains(raw, "sonarr") {
				total = 80000
			}
			raw = strings.ReplaceAll(raw, "%LAST%", strconv.Itoa((total+limit-1)/limit))
			raw = strings.ReplaceAll(raw, "%LASTSERIES%", strconv.Itoa((2000+limit-1)/limit))
			files(r.label, raw, limit)
		}
	}
	if median, max, _ := measure(3, "/api/files?mode=season&limit=50&service=sonarr"); median > 0 {
		log("| series, mode=season | 50 | %s | %s | |", median.Round(100*time.Microsecond), max.Round(100*time.Microsecond))
		if median > 300*time.Millisecond {
			slow = append(slow, "mode=season")
		}
	}
	for _, r := range []request{{"statistics", "/api/statistics"}, {"facets radarr", "/api/facets?service=radarr"}, {"facets sonarr", "/api/facets?service=sonarr"}} {
		median, max, _ := measure(5, r.raw)
		log("| %s | | %s | %s | |", r.label, median.Round(100*time.Microsecond), max.Round(100*time.Microsecond))
	}
	// CSV: three sizes of the same library; the time per row must stay flat.
	perRow := []float64{}
	for _, c := range []struct {
		raw  string
		rows int
	}{{"service=radarr&resolution=2160p", 0}, {"service=radarr", 20000}, {"service=sonarr", 80000}} {
		median, max, size := measure(3, "/api/export?mode=matches&"+c.raw)
		rows := c.rows
		if rows == 0 {
			out, _ := s.Query(url.Values{"service": {"radarr"}, "resolution": {"2160p"}}, "matches", false)
			rows = out.Total
		}
		perRow = append(perRow, float64(median.Microseconds())/float64(rows))
		log("| CSV %s (%d rows) | | %s | %s | %d kB |", c.raw, rows, median.Round(time.Millisecond), max.Round(time.Millisecond), size/1024)
	}
	log("CSV µs per row: %.1f / %.1f / %.1f", perRow[0], perRow[1], perRow[2])
	if perRow[2] > 2*perRow[1]+5 {
		slow = append(slow, "CSV not linear")
	}
	// Sync: a full Replace of each service (the seed above measured the
	// first write; this one replaces existing rows with custom tags).
	log("sync replace radarr 20 000: %s", seed("radarr", movies).Round(time.Millisecond))
	log("sync replace sonarr 80 000: %s", seed("sonarr", episodes).Round(time.Millisecond))
	// Webhook delta: one series (40 episodes) written as the webhook does.
	one := append([]File(nil), episodes[40*999:40*1000]...)
	times := []time.Duration{}
	for i := 0; i < 5; i++ {
		start := time.Now()
		if err := s.replaceContext(ctx, "sonarr", append([]File(nil), one...), SyncStatus{}, false, &DeltaScope{MediaID: 1000, All: true}, nil); err != nil {
			t.Fatal(err)
		}
		times = append(times, time.Since(start))
	}
	sort.Slice(times, func(i, j int) bool { return times[i] < times[j] })
	log("webhook delta (series of 40 episodes): median %s, max %s", times[2].Round(100*time.Microsecond), times[4].Round(100*time.Microsecond))
	if os.Getenv("SCOPEARR_PERF_EXPLAIN") == "1" {
		explain100K(t, s, url.Values{"service": {"sonarr"}, "sort": {"size"}, "dir": {"desc"}})
		explain100K(t, s, url.Values{"service": {"sonarr"}, "custom": {a, b}})
	}
	if path := os.Getenv("SCOPEARR_PERF_OUT"); path != "" {
		os.WriteFile(path, []byte(strings.Join(report, "\n")+"\n"), 0o644)
	}
	if len(slow) > 0 {
		t.Fatal("over budget: ", strings.Join(slow, ", "))
	}
}

// explain100K logs the query plan of the page query /api/files runs for q
// and the time of its count and page statements.
func explain100K(t *testing.T, s *Store, q url.Values) {
	filter, args, err := s.scopedWhere(q)
	if err != nil {
		t.Fatal(err)
	}
	order, err := displayOrder(q)
	if err != nil {
		t.Fatal(err)
	}
	count := "SELECT count(*) FROM files f WHERE " + filter
	page := "SELECT f.rowid FROM files f WHERE " + filter + " ORDER BY " + order + " LIMIT 50"
	for _, query := range []string{count, page} {
		start := time.Now()
		rows, err := s.DB.Query(query, args...)
		if err != nil {
			t.Fatal(err)
		}
		for rows.Next() {
		}
		rows.Close()
		took := time.Since(start)
		plan := []string{}
		rows, err = s.DB.Query("EXPLAIN QUERY PLAN "+query, args...)
		if err != nil {
			t.Fatal(err)
		}
		for rows.Next() {
			var id, parent, unused int
			var detail string
			rows.Scan(&id, &parent, &unused, &detail)
			plan = append(plan, detail)
		}
		rows.Close()
		t.Logf("%s %s\n  %s\n  plan: %s", q.Encode(), took.Round(100*time.Microsecond), query, strings.Join(plan, " | "))
	}
}
