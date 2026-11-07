package app

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"
)

// trackFilterHarness200 serves the real handlers for one store with a session.
type trackFilterHarness200 struct {
	t      *testing.T
	store  *Store
	server *Server
}

func newTrackFilterHarness200(t *testing.T, files []File) trackFilterHarness200 {
	t.Helper()
	s := testStore(t)
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

func (h trackFilterHarness200) do(method, target, locale string, body any) *httptest.ResponseRecorder {
	h.t.Helper()
	var r *http.Request
	if body != nil {
		raw, _ := json.Marshal(body)
		r = httptest.NewRequest(method, target, strings.NewReader(string(raw)))
		r.Header.Set("Content-Type", "application/json")
	} else {
		r = httptest.NewRequest(method, target, nil)
	}
	r.AddCookie(&http.Cookie{Name: "scopearr_session", Value: "test-session"})
	r.Header.Set("X-CSRF-Token", "test-csrf")
	if locale != "" {
		r.Header.Set("Accept-Language", locale)
	}
	w := httptest.NewRecorder()
	h.server.Handler().ServeHTTP(w, r)
	return w
}

// ids returns the sorted file IDs /api/files lists for the raw query.
func (h trackFilterHarness200) ids(raw string) []int {
	h.t.Helper()
	w := h.do("GET", "/api/files?service=radarr&"+raw, "", nil)
	if w.Code != http.StatusOK {
		h.t.Fatalf("%s: HTTP %d %s", raw, w.Code, w.Body.String())
	}
	var page struct {
		Files []File `json:"files"`
		Total int    `json:"total"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil {
		h.t.Fatal(err)
	}
	ids := []int{}
	for _, f := range page.Files {
		ids = append(ids, f.ID)
	}
	sort.Ints(ids)
	if page.Total != len(ids) {
		h.t.Fatalf("%s: total %d for %v", raw, page.Total, ids)
	}
	return ids
}

func (h trackFilterHarness200) expect(raw string, want ...int) {
	h.t.Helper()
	if want == nil {
		want = []int{}
	}
	if got := h.ids(raw); !reflect.DeepEqual(got, want) {
		h.t.Fatalf("%s: got %v, want %v", raw, got, want)
	}
}

func trackQuery200(op string, values ...string) string {
	q := url.Values{"track": values}
	if op != "" {
		q.Set("trackOp", op)
	}
	return q.Encode()
}

func trackFilterFile200(id int, title, filename string, tracks ...AudioTrack) File {
	f := File{ID: id, MediaID: id, Title: title, Filename: filename, Size: int64(id) << 30, Years: []int{2020}, Episodes: []Episode{}}
	Enrich(&f, APIInfo{})
	f.AudioTracks = tracks
	return f
}

// Fixture A–D from the task brief: A and B carry the same languages and
// codecs at file level but pair them differently per track.
func trackFilterFixture200() []File {
	return []File{
		trackFilterFile200(1, "Film A", "Film.A.2020.2160p.BluRay.German.English.DTS-HD.MA.7.1.AC3.x265.mkv",
			AudioTrack{Index: 1, Language: "Deutsch", Codec: "DTS-HD MA", Channels: 8, ChannelLayout: "7.1"},
			AudioTrack{Index: 2, Language: "Englisch", Codec: "AC-3", Channels: 6, ChannelLayout: "5.1"}),
		trackFilterFile200(2, "Film B", "Film.B.2020.1080p.BluRay.German.English.AC3.DTS-HD.MA.x264.mkv",
			AudioTrack{Index: 1, Language: "Deutsch", Codec: "AC-3", Channels: 6, ChannelLayout: "5.1"},
			AudioTrack{Index: 2, Language: "Englisch", Codec: "DTS-HD MA", Channels: 8, ChannelLayout: "7.1"}),
		trackFilterFile200(3, "Film C", "Film.C.2020.1080p.BluRay.DTS.x264.mkv",
			AudioTrack{Index: 1, Language: "", Codec: "DTS", Channels: 6}),
		trackFilterFile200(4, "Film D", "Film.D.2020.1080p.BluRay.German.DTS-HD.MA.x264.mkv"),
	}
}

func TestTrackFilter200(t *testing.T) {
	h := newTrackFilterHarness200(t, trackFilterFixture200())

	t.Run("matches one track, not the whole file", func(t *testing.T) {
		h.t = t
		h.expect(trackQuery200("", "Deutsch|DTS-HD MA|"), 1)
		// The file-level filters cannot tell A and B apart, and D matches by filename.
		h.expect("language=Deutsch&audio=DTS-HD+MA", 1, 2, 4)
		h.expect(trackQuery200("", "Deutsch|DTS-HD MA|7.1"), 1)
		h.expect(trackQuery200("", "Deutsch|DTS-HD MA|5.1"))
		h.expect(trackQuery200("", "german|DTS-HD MA|"), 1)
		h.expect(trackQuery200("", " Deutsch | DTS-HD MA | "), 1)
		h.expect(trackQuery200("", "__unknown__|DTS|"), 3)
		h.expect(trackQuery200("", "||6 ch"), 3)
		h.expect(trackQuery200("", "|DTS|"), 3)
		h.expect(trackQuery200("", "Englisch||"), 1, 2)
		h.expect(trackQuery200("", "Englisch||")+"&resolution=2160p", 1)
		h.expect(trackQuery200("", "Englisch||")+"&resolution=1080p", 2)
		// D has no measured tracks and never matches positively.
		h.expect(trackQuery200("", "Deutsch||"), 1, 2)
		h.expect(trackQuery200("", "__unknown__||"), 3)
		h.expect(trackQuery200("all", "Deutsch||"), 1, 2)
	})

	t.Run("negative and all operators", func(t *testing.T) {
		h.t = t
		h.expect(trackQuery200("", "Deutsch|AC-3|", "Englisch|AC-3|"), 1, 2)
		h.expect(trackQuery200("eq", "Deutsch|AC-3|", "Englisch|AC-3|"), 1, 2)
		h.expect(trackQuery200("all", "Deutsch|DTS-HD MA|", "Englisch|AC-3|"), 1)
		h.expect(trackQuery200("not", "Deutsch|DTS-HD MA|"), 2, 3, 4)
		h.expect(trackQuery200("notAll", "Deutsch|DTS-HD MA|", "Englisch|AC-3|"), 2, 3, 4)
		h.expect(trackQuery200("not", "Deutsch|AC-3|", "Englisch|AC-3|"), 3, 4)
		// An operator without values has no effect, as for the other fields.
		h.expect("trackOp=not", 1, 2, 3, 4)
	})

	t.Run("rejects malformed combinations", func(t *testing.T) {
		h.t = t
		const invalid = "Ungültige Tonspur-Kombination"
		seventeen := []string{}
		for i := 0; i < 17; i++ {
			seventeen = append(seventeen, fmt.Sprintf("|C%d|", i))
		}
		sixteen := seventeen[:16]
		cases := []struct {
			name, query, want string
		}{
			{"two parts", trackQuery200("", "Deutsch|DTS"), invalid},
			{"four parts", trackQuery200("", "Deutsch|DTS||"), invalid},
			{"one part", trackQuery200("", "Deutsch"), invalid},
			{"empty value", "track=", invalid},
			{"all parts empty", trackQuery200("", "||"), invalid},
			{"all parts blank", trackQuery200("", " | \t| "), invalid},
			{"two languages", trackQuery200("", "Deutsch, Englisch|DTS|"), invalid},
			{"two languages with slash", trackQuery200("", "Deutsch/Englisch||"), invalid},
			{"separators only", trackQuery200("", ",||5.1"), invalid},
			{"long codec", trackQuery200("", "|"+strings.Repeat("x", 81)+"|"), invalid},
			{"long channels", trackQuery200("", "||"+strings.Repeat("ä", 81)), invalid},
			{"one invalid among valid", trackQuery200("", "Deutsch||", "||"), invalid},
			{"17 values", trackQuery200("", seventeen...), "Maximal 16 Tonspur-Kombinationen sind erlaubt"},
			{"unknown operator", trackQuery200("any", "Deutsch||"), "Ungültiger Filteroperator für track"},
			{"unknown operator without values", "trackOp=any", "Ungültiger Filteroperator für track"},
			{"repeated operator", trackQuery200("", "Deutsch||") + "&trackOp=eq&trackOp=eq", "Ungültiger Filteroperator für track"},
		}
		for _, c := range cases {
			w := h.do("GET", "/api/files?service=radarr&"+c.query, "de", nil)
			var body struct {
				Error string `json:"error"`
			}
			_ = json.Unmarshal(w.Body.Bytes(), &body)
			if w.Code != http.StatusBadRequest || body.Error != c.want {
				t.Fatalf("%s: HTTP %d %q, want 400 %q", c.name, w.Code, body.Error, c.want)
			}
		}
		w := h.do("GET", "/api/files?service=radarr&"+trackQuery200("", "Deutsch|DTS"), "en", nil)
		if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "Invalid audio track combination") {
			t.Fatalf("English message: %d %s", w.Code, w.Body.String())
		}
		// The limit is 16, and exactly 80 characters stay valid.
		h.expect(trackQuery200("", sixteen...))
		h.expect(trackQuery200("", "|"+strings.Repeat("x", 80)+"|"))
		h.expect(trackQuery200("", "||"+strings.Repeat("ä", 80)))
	})

	t.Run("encoded values parse the same", func(t *testing.T) {
		h.t = t
		h.expect("track=Deutsch%7CDTS-HD+MA%7C", 1)
		h.expect("track=Deutsch%7CDTS-HD%20MA%7C7.1", 1)
		h.expect("track=__unknown__%7CDTS%7C", 3)
		h.expect("track=%7C%7C6+ch", 3)
	})

	t.Run("export and presets share the filter", func(t *testing.T) {
		h.t = t
		readCSV := func(raw string) [][]string {
			t.Helper()
			w := h.do("GET", "/api/export?service=radarr&"+raw, "", nil)
			if w.Code != http.StatusOK {
				t.Fatalf("export %s: HTTP %d %s", raw, w.Code, w.Body.String())
			}
			reader := csv.NewReader(strings.NewReader(strings.TrimPrefix(w.Body.String(), "\ufeff")))
			reader.Comma = ';'
			records, err := reader.ReadAll()
			if err != nil {
				t.Fatal(err)
			}
			return records
		}
		all := readCSV("")
		filtered := readCSV("track=Deutsch%7CDTS-HD+MA%7C")
		if len(all) != 5 || len(filtered) != 2 || !reflect.DeepEqual(filtered[0], all[0]) || !strings.Contains(strings.Join(filtered[1], ","), "Film A") {
			t.Fatalf("CSV rows: all=%d filtered=%v", len(all), filtered)
		}
		if negative := readCSV(trackQuery200("not", "Deutsch|DTS-HD MA|")); len(negative) != 4 {
			t.Fatalf("negative CSV rows: %v", negative)
		}
		if w := h.do("GET", "/api/export?service=radarr&track=%7C%7C", "", nil); w.Code != http.StatusBadRequest {
			t.Fatalf("invalid CSV filter: HTTP %d", w.Code)
		}

		// Selection (custom tags) counts the same matches.
		selection := func(raw string) (int, int) {
			w := h.do("GET", "/api/custom-selection?service=radarr&"+raw, "", nil)
			var out CustomSelection
			_ = json.Unmarshal(w.Body.Bytes(), &out)
			return w.Code, out.Total
		}
		if code, total := selection("track=Deutsch%7CDTS-HD+MA%7C"); code != 200 || total != 1 {
			t.Fatalf("selection: %d %d", code, total)
		}
		if code, total := selection(trackQuery200("notAll", "Deutsch|DTS-HD MA|", "Englisch|AC-3|")); code != 200 || total != 3 {
			t.Fatalf("negative selection: %d %d", code, total)
		}
		if code, _ := selection("track=%7C%7C"); code != http.StatusBadRequest {
			t.Fatalf("invalid selection filter: HTTP %d", code)
		}

		// Presets keep the combination, normalized, and compare it like other filters.
		save := func(name, raw string) (int, Preset) {
			w := h.do("POST", "/api/presets", "", map[string]string{"name": name, "service": "radarr", "query": raw})
			var p Preset
			if w.Code == http.StatusConflict {
				var dup struct {
					Preset Preset `json:"preset"`
				}
				_ = json.Unmarshal(w.Body.Bytes(), &dup)
				p = dup.Preset
			} else {
				_ = json.Unmarshal(w.Body.Bytes(), &p)
			}
			return w.Code, p
		}
		code, preset := save("Tracks", trackQuery200("", "german| DTS-HD MA |"))
		if code != http.StatusCreated {
			t.Fatalf("preset: HTTP %d", code)
		}
		stored, err := url.ParseQuery(preset.Query)
		if err != nil || !reflect.DeepEqual(stored["track"], []string{"Deutsch|DTS-HD MA|"}) || stored.Get("trackOp") != "" {
			t.Fatalf("stored preset query %q", preset.Query)
		}
		stored.Del("service")
		h.expect(stored.Encode(), 1)
		for _, raw := range []string{trackQuery200("", "Deutsch|DTS-HD MA|"), trackQuery200("all", "Deutsch|DTS-HD MA|"), trackQuery200("", "Deutsch|DTS-HD MA|", "deu|DTS-HD MA|")} {
			if code, duplicate := save("Again", raw); code != http.StatusConflict || duplicate.ID != preset.ID {
				t.Fatalf("duplicate preset %s: HTTP %d %+v", raw, code, duplicate)
			}
		}
		code, negative := save("Not tracks", trackQuery200("notAll", "Englisch|AC-3|", "__unknown__|DTS|"))
		if code != http.StatusCreated {
			t.Fatalf("negative preset: HTTP %d", code)
		}
		stored, _ = url.ParseQuery(negative.Query)
		if !reflect.DeepEqual(stored["track"], []string{"Englisch|AC-3|", "__unknown__|DTS|"}) || stored.Get("trackOp") != "notAll" {
			t.Fatalf("stored negative preset query %q", negative.Query)
		}
		stored.Del("service")
		h.expect(stored.Encode(), 1, 2, 3, 4)
		if code, _ = save("Other op", trackQuery200("not", "Deutsch|DTS-HD MA|")); code != http.StatusCreated {
			t.Fatalf("operator distinguishes presets: HTTP %d", code)
		}
		for _, raw := range []string{trackQuery200("", "||"), trackQuery200("bad", "Deutsch||"), trackQuery200("", "Deutsch|DTS")} {
			if code, _ = save("Invalid", raw); code != http.StatusBadRequest {
				t.Fatalf("invalid preset %s: HTTP %d", raw, code)
			}
		}
	})

	t.Run("the filter uses an index", func(t *testing.T) {
		h.t = t
		// Language-led combinations seek the combination index.
		for _, q := range []url.Values{
			{"service": {"radarr"}, "track": {"Deutsch|DTS-HD MA|"}},
			{"service": {"radarr"}, "track": {"Deutsch||7.1"}},
			{"service": {"radarr"}, "track": {"Deutsch|DTS-HD MA|", "Englisch|AC-3|"}, "trackOp": {"notAll"}},
		} {
			if plan := trackPlan200(t, h.store, q); !strings.Contains(plan, "SEARCH t USING COVERING INDEX file_audio_tracks_combination (language=?") {
				t.Fatalf("%s does not seek the combination index:\n%s", q.Encode(), plan)
			}
		}
		// Without a language the subquery reads the covering index once.
		for _, q := range []url.Values{
			{"service": {"radarr"}, "track": {"||7.1"}},
			{"service": {"radarr"}, "track": {"|AC-3|"}, "trackOp": {"not"}},
		} {
			if plan := trackPlan200(t, h.store, q); !strings.Contains(plan, " t USING COVERING INDEX file_audio_tracks_combination") {
				t.Fatalf("%s does not use the covering index:\n%s", q.Encode(), plan)
			}
		}
	})
}

// trackPlan200 returns the query plan of a track filter and fails when the
// index table is read without an index or once per file (a correlated
// subquery searched the combination index for every file: quadratic).
func trackPlan200(t *testing.T, s *Store, q url.Values) string {
	t.Helper()
	filter, args, err := where(q)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := s.DB.Query("EXPLAIN QUERY PLAN SELECT f.rowid FROM files f WHERE "+filter, args...)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	plan := []string{}
	for rows.Next() {
		var id, parent, unused int
		var detail string
		if err = rows.Scan(&id, &parent, &unused, &detail); err != nil {
			t.Fatal(err)
		}
		plan = append(plan, detail)
	}
	text := strings.Join(plan, "\n")
	t.Logf("plan for %s:\n%s", q.Encode(), text)
	for _, line := range plan {
		if strings.HasPrefix(line, "CORRELATED") || line == "SCAN t" || strings.HasPrefix(line, "SCAN file_audio_tracks") {
			t.Fatalf("track filter reads the index table per file or without an index:\n%s", text)
		}
	}
	return text
}

// The four operators follow the compound field filters: with file values that
// mirror the measured tracks, track filters on one part select the same files
// as the language and audio filters, including files without tracks.
func TestTrackFilterOperatorsMirrorCompoundFields200(t *testing.T) {
	h := newTrackFilterHarness200(t, []File{
		trackFilterFile200(1, "Film P1", "Film.P1.2020.1080p.BluRay.German.English.AC3.DTS.x264.mkv",
			AudioTrack{Index: 1, Language: "Deutsch", Codec: "AC-3", Channels: 6, ChannelLayout: "5.1"},
			AudioTrack{Index: 2, Language: "Englisch", Codec: "DTS", Channels: 6, ChannelLayout: "5.1"}),
		trackFilterFile200(2, "Film P2", "Film.P2.2020.1080p.BluRay.English.DTS.x264.mkv",
			AudioTrack{Index: 1, Language: "Englisch", Codec: "DTS", Channels: 6, ChannelLayout: "5.1"}),
		trackFilterFile200(3, "Film P3", "Film.P3.2020.1080p.BluRay.x264.mkv"),
		trackFilterFile200(4, "Film P4", "Film.P4.2020.1080p.BluRay.German.AC3.x264.mkv",
			AudioTrack{Index: 1, Language: "Deutsch", Codec: "AC-3", Channels: 6, ChannelLayout: "5.1"}),
	})
	files, err := h.store.Query(url.Values{"service": {"radarr"}}, "matches", false)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range files.Files {
		t.Logf("%s: language=%q audio=%q", f.Title, f.Language, f.Audio)
	}
	type mirror struct {
		field  string
		values []string
		track  func(string) string
	}
	cases := []mirror{
		{"language", []string{"Deutsch"}, func(v string) string { return v + "||" }},
		{"language", []string{"Englisch"}, func(v string) string { return v + "||" }},
		{"language", []string{"Deutsch", "Englisch"}, func(v string) string { return v + "||" }},
		{"audio", []string{"AC-3"}, func(v string) string { return "|" + v + "|" }},
		{"audio", []string{"DTS"}, func(v string) string { return "|" + v + "|" }},
		{"audio", []string{"AC-3", "DTS"}, func(v string) string { return "|" + v + "|" }},
	}
	for _, c := range cases {
		for _, op := range []string{"", "eq", "not", "all", "notAll"} {
			field := url.Values{c.field: c.values}
			if op != "" {
				field.Set(c.field+"Op", op)
			}
			tracks := []string{}
			for _, v := range c.values {
				tracks = append(tracks, c.track(v))
			}
			want := h.ids(field.Encode())
			if got := h.ids(trackQuery200(op, tracks...)); !reflect.DeepEqual(got, want) {
				t.Fatalf("%s %v op %q: track %v, field %v", c.field, c.values, op, got, want)
			}
		}
	}
	// Negations include files without measured tracks, like files without a value.
	h.expect(trackQuery200("not", "Deutsch||"), 2, 3)
	h.expect(trackQuery200("notAll", "Deutsch||", "Englisch||"), 2, 3, 4)
}

func TestParseTrackCombination200(t *testing.T) {
	text := func(p *string) string {
		if p == nil {
			return "<any>"
		}
		return fmt.Sprintf("%q", *p)
	}
	for _, c := range []struct{ in, language, codec, channels string }{
		{"Deutsch|DTS-HD MA|", `"Deutsch"`, `"DTS-HD MA"`, "<any>"},
		{"ger||7.1", `"Deutsch"`, "<any>", `"7.1"`},
		{"__unknown__|  |__unknown__", `""`, "<any>", `""`},
		{"und|AAC|", `""`, `"AAC"`, "<any>"},
		{"||6 ch", "<any>", "<any>", `"6 ch"`},
	} {
		got, err := parseTrackCombination(c.in)
		if err != nil {
			t.Fatalf("%q: %v", c.in, err)
		}
		if text(got.language) != c.language || text(got.codec) != c.codec || text(got.channels) != c.channels {
			t.Fatalf("%q: %s %s %s", c.in, text(got.language), text(got.codec), text(got.channels))
		}
	}
	if _, err := parseTrackCombination("a|b"); err == nil || err.Error() != "Invalid audio track combination" {
		t.Fatalf("error: %v", err)
	}
}
