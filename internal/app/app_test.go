package app

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"sort"
	"strings"
	"testing"
	"time"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	s, e := OpenStore(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { s.DB.Close() })
	return s
}
func sample(id int, name string) File {
	f := File{ID: id, MediaID: 1, Title: "Film " + name, Filename: name, Years: []int{2020}, Episodes: []Episode{}}
	Enrich(&f, APIInfo{})
	return f
}
func TestFilenameAndAPI(t *testing.T) {
	cases := []struct {
		name         string
		api          APIInfo
		r, c, src, p string
		apiDiffers   bool
	}{
		{"Movie.2020.1080p.WEB-DL.x264.mkv", APIInfo{Quality: "WEBDL-1080p", VideoCodec: "AVC"}, "1080p", "x264", "WEB-DL", "", false},
		{"Movie.4K.BluRay.Remux.x265.10bit.HDR10.mkv", APIInfo{}, "2160p", "x265", "BluRay", "Remux", false},
		{"Movie.1080p.x264.mkv", APIInfo{Quality: "Bluray-2160p", VideoCodec: "HEVC"}, "1080p", "x264", "BluRay", "", true},
		{"Movie.mkv", APIInfo{Quality: "Bluray-1080p", VideoCodec: "HEVC"}, "1080p", "HEVC", "BluRay", "", false},
		{"Movie.mkv", APIInfo{}, "", "", "", "", false},
		{"Movie.AVC.1080i.HDTV.mkv", APIInfo{}, "1080i", "AVC", "HDTV", "", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := File{Filename: c.name}
			Enrich(&f, c.api)
			if f.Resolution != c.r || f.Codec != c.c || f.Source != c.src || f.Processing != c.p || f.Conflict || f.Evidence["resolution"].APIDiffers != c.apiDiffers || f.Evidence["codec"].APIDiffers != c.apiDiffers {
				t.Fatalf("unexpected: %+v", f)
			}
			if c.name == "Movie.mkv" && c.api.VideoCodec == "" && (f.HDR != "" || f.BitDepth != "" || f.Language != "") {
				t.Fatal("missing information inferred")
			}
		})
	}
}
func TestExtraMetadata(t *testing.T) {
	f := File{Filename: "Test.2160p.DV.HDR10Plus.10bit.DDP.5.1.German.mkv"}
	Enrich(&f, APIInfo{})
	if f.HDR != "Dolby Vision + HDR10+" || f.BitDepth != "10" || f.Audio != "E-AC-3" || f.Channels != "5.1" || f.Language != "Deutsch" {
		t.Fatalf("%+v", f)
	}
}
func TestFiltersGroupsAndAtomicCache(t *testing.T) {
	s := testStore(t)
	a := sample(1, "A.1080p.x264.mkv")
	b := sample(2, "B.2160p.x265.mkv")
	c := sample(3, "C.720p.AVC.mkv")
	for _, f := range []*File{&a, &b, &c} {
		f.Series = "Test Show"
		f.Season = 1
	}
	if e := s.Replace("sonarr", []File{a, b, c}, SyncStatus{}); e != nil {
		t.Fatal(e)
	}
	q := url.Values{"service": {"sonarr"}, "resolution": {"1080p"}, "codec": {"x264"}}
	r, e := s.Query(q, "matches", false)
	if e != nil || r.Total != 1 || len(r.Files) != 1 {
		t.Fatalf("%+v %v", r, e)
	}
	r, e = s.Query(q, "season", false)
	if e != nil || r.Total != 1 || r.DisplayTotal != 3 || len(r.Files) != 3 {
		t.Fatalf("%+v %v", r, e)
	}
	matches := 0
	for _, f := range r.Files {
		if f.Matched {
			matches++
		}
	}
	if matches != 1 {
		t.Fatal("context marked as matching")
	}
	q.Set("codec", "x265")
	r, e = s.Query(q, "matches", false)
	if e != nil || r.Total != 0 {
		t.Fatal("AND condition failed")
	}
	q.Del("codec")
	q.Add("resolution", "720p")
	r, e = s.Query(q, "matches", false)
	if e != nil || r.Total != 2 {
		t.Fatal("OR condition failed")
	}
	q = url.Values{"service": {"sonarr"}, "family": {"H.264/AVC"}}
	r, e = s.Query(q, "matches", false)
	if e != nil || r.Total != 2 {
		t.Fatal("family filter failed")
	}
	// Duplicate IDs must roll back deletion and all inserts.
	if e = s.Replace("sonarr", []File{a, a}, SyncStatus{}); e == nil {
		t.Fatal("expected unique constraint failure")
	}
	r, e = s.Query(url.Values{"service": {"sonarr"}}, "matches", false)
	if e != nil || r.Total != 3 {
		t.Fatal("cache destroyed on partial write")
	}
}
func TestSearchUnknownYearsAndInjection(t *testing.T) {
	s := testStore(t)
	a := sample(1, "Übersicht.1080p.x264.mkv")
	a.Title = "Äpfel im Schnee"
	a.Years = []int{2011, 2012}
	b := sample(2, "No.metadata.mkv")
	b.Years = []int{}
	s.Replace("radarr", []File{a, b}, SyncStatus{})
	for _, tc := range []struct {
		q     url.Values
		total int
	}{{url.Values{"q": {"apfel"}}, 1}, {url.Values{"yearMin": {"2012"}, "yearMax": {"2012"}}, 1}, {url.Values{"unknownYear": {"true"}}, 1}, {url.Values{"codec": {"__unknown__"}}, 1}, {url.Values{"codec": {"x264') OR 1=1 --"}}, 0}} {
		tc.q.Set("service", "radarr")
		r, e := s.Query(tc.q, "matches", false)
		if e != nil || r.Total != tc.total {
			t.Fatalf("%v => %v, %v", tc.q, r, e)
		}
	}
	if _, e := s.Query(url.Values{"service": {"radarr"}, "sort": {"size;DROP TABLE files"}}, "matches", false); e == nil {
		t.Fatal("sort injection accepted")
	}
}
func TestArrReadOnlyAndMultiEpisodes(t *testing.T) {
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("upstream mutation: %s", r.Method)
		}
		if r.Header.Get("X-Api-Key") != "test-secret" {
			t.Error("missing auth header")
		}
		if r.URL.Query().Has("apikey") {
			t.Error("key in URL")
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/base/api/v3/system/status":
			io.WriteString(w, `{"version":"4.0.0"}`)
		case "/base/api/v3/series":
			io.WriteString(w, `[{"id":1,"title":"Series"}]`)
		case "/base/api/v3/episodefile":
			if r.URL.Query().Get("seriesId") != "1" {
				t.Error("missing series id")
			}
			io.WriteString(w, `[{"id":10,"seriesId":1,"seasonNumber":0,"relativePath":"Series.S00E01E02.1080p.x264.mkv","size":42,"mediaInfo":{"videoCodec":"AVC","audioStreamCount":2,"audioLanguages":"ger / eng","audioCodec":"DTS"}}]`)
		case "/base/api/v3/episode":
			io.WriteString(w, `[{"id":1,"episodeFileId":10,"episodeNumber":1,"title":"One","airDate":"2011-01-01"},{"id":2,"episodeFileId":10,"episodeNumber":2,"title":"Two","airDate":"2012-01-01"}]`)
		case "/base/api/v3/movie":
			io.WriteString(w, `[{"id":3,"title":"Movie","year":2020}]`)
		case "/base/api/v3/moviefile":
			if r.URL.Query().Get("movieId") != "3" {
				t.Error("missing movie id")
			}
			io.WriteString(w, `[{"id":30,"movieId":3,"relativePath":"Folder/Movie.1080p.WEBRip.x264.mkv","quality":{"quality":{"name":"WEBRip-1080p"}}}]`)
		default:
			t.Errorf("unexpected API path: %s", r.URL.Path)
			http.Error(w, "unexpected", 500)
		}
	}))
	defer mock.Close()
	client := NewArr(ServiceConfig{URL: mock.URL + "/base", APIKey: "test-secret"})
	if _, e := client.Test(context.Background()); e != nil {
		t.Fatal(e)
	}
	files, e := client.Fetch(context.Background(), "sonarr")
	if e != nil || len(files) != 1 {
		t.Fatalf("%v %v", files, e)
	}
	if files[0].AudioStreamCount != 2 || files[0].Language != "Deutsch, Englisch" || len(files[0].Episodes) != 2 || len(files[0].Years) != 2 || files[0].Season != 0 {
		t.Fatal("multi-episode or specials mapping")
	}
	movies, e := client.Fetch(context.Background(), "radarr")
	if e != nil || len(movies) != 1 || movies[0].Title != "Movie" || movies[0].Filename != "Movie.1080p.WEBRip.x264.mkv" {
		t.Fatalf("%v %v", movies, e)
	}
	if e = client.get(context.Background(), "command", nil, &files); e == nil {
		t.Fatal("command endpoint accepted")
	}
}
func TestFailedAndCancelledSyncPreservesCache(t *testing.T) {
	for _, code := range []int{401, 500} {
		t.Run(fmt.Sprint(code), func(t *testing.T) {
			s := testStore(t)
			s.Replace("radarr", []File{sample(1, "Good.1080p.x264.mkv")}, SyncStatus{Count: 1})
			mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Error(w, "sensitive response", code) }))
			defer mock.Close()
			m := NewSyncer(s)
			defer m.Shutdown()
			if e := m.Start(context.Background(), "radarr", ServiceConfig{Enabled: true, URL: mock.URL, APIKey: "secret"}); e != nil {
				t.Fatal(e)
			}
			deadline := time.Now().Add(5 * time.Second)
			for m.Statuses()["radarr"].Running && time.Now().Before(deadline) {
				time.Sleep(10 * time.Millisecond)
			}
			st := m.Statuses()["radarr"]
			if st.Running || st.Error == "" || strings.Contains(st.Error, "sensitive") {
				t.Fatalf("%+v", st)
			}
			r, _ := s.Query(url.Values{"service": {"radarr"}}, "matches", false)
			if r.Total != 1 {
				t.Fatal("cache deleted on failure")
			}
		})
	}
	s := testStore(t)
	s.Replace("radarr", []File{sample(1, "Good.1080p.x264.mkv")}, SyncStatus{})
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	defer mock.Close()
	ctx, cancel := context.WithCancel(context.Background())
	m := NewSyncer(s)
	m.Start(ctx, "radarr", ServiceConfig{Enabled: true, URL: mock.URL})
	cancel()
	m.Shutdown()
	r, _ := s.Query(url.Values{"service": {"radarr"}}, "matches", false)
	if r.Total != 1 {
		t.Fatal("cache deleted on cancellation")
	}
}
func TestRedirectDoesNotLeakKey(t *testing.T) {
	called := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true }))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, 302) }))
	defer source.Close()
	_, e := NewArr(ServiceConfig{URL: source.URL, APIKey: "secret"}).Test(context.Background())
	if e == nil || called {
		t.Fatal("redirect leaked credentials")
	}
}
func TestSecurityPersistenceAndBackup(t *testing.T) {
	s := testStore(t)
	sec, e := NewSecurity(s)
	if e != nil {
		t.Fatal(e)
	}
	sealed := sec.Seal("private-key")
	if strings.Contains(sealed, "private-key") {
		t.Fatal("plaintext")
	}
	again, _ := NewSecurity(s)
	v, e := again.Open(sealed)
	if e != nil || v != "private-key" {
		t.Fatal("encryption persistence")
	}
	if e = sec.Setup("admin", "a-long-password!", sec.setupToken); e != nil {
		t.Fatal(e)
	}
	for i := 0; i < 6; i++ {
		if sec.Login("admin", "wrong", "one-ip") {
			t.Fatal("wrong login accepted")
		}
	}
	if sec.Login("admin", "a-long-password!", "one-ip") {
		t.Fatal("rate limit missing")
	}
	if !sec.Login("admin", "a-long-password!", "other-ip") {
		t.Fatal("valid login rejected")
	}
	for i := 0; i < 4; i++ {
		if e = s.Backup(); e != nil {
			t.Fatal(e)
		}
	}
	files, _ := filepath.Glob(filepath.Join(s.Dir, "backups", "*.db"))
	if len(files) != 3 {
		t.Fatal("backup retention")
	}
	if e = sec.Reset("a-new-password!!"); e != nil {
		t.Fatal(e)
	}
	if !sec.Login("admin", "a-new-password!!", "third-ip") {
		t.Fatal("reset failed")
	}
}
func TestHTTPAuthCSRFSettingsPresetsCSV(t *testing.T) {
	s := testStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, e := NewServer(ctx, s, nil, "test")
	if e != nil {
		t.Fatal(e)
	}
	defer server.Sync.Shutdown()
	mock := httptest.NewServer(server.Handler())
	defer mock.Close()
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	csrf := ""
	request := func(path, method, body string, token bool) *http.Response {
		t.Helper()
		r, _ := http.NewRequest(method, mock.URL+path, strings.NewReader(body))
		if token {
			r.Header.Set("X-CSRF-Token", csrf)
		}
		resp, e := client.Do(r)
		if e != nil {
			t.Fatal(e)
		}
		return resp
	}
	check := func(r *http.Response, want int) string {
		t.Helper()
		defer r.Body.Close()
		b, _ := io.ReadAll(r.Body)
		if r.StatusCode != want {
			t.Fatalf("got %d want %d: %s", r.StatusCode, want, b)
		}
		return string(b)
	}
	check(request("/api/files?service=radarr", "GET", "", false), 401)
	check(request("/api/statistics", "GET", "", false), 401)
	check(request("/api/setup", "POST", `{"username":"admin","password":"a-long-password!","token":"bad"}`, false), 400)
	b, _ := json.Marshal(map[string]string{"username": "admin", "password": "a-long-password!", "token": server.Security.setupToken})
	check(request("/api/setup", "POST", string(b), false), 200)
	var st struct {
		CSRF string `json:"csrf"`
	}
	json.Unmarshal([]byte(check(request("/api/status", "GET", "", false), 200)), &st)
	csrf = st.CSRF
	if csrf == "" {
		t.Fatal("missing csrf")
	}
	check(request("/api/settings", "PUT", `{}`, false), 403)
	check(request("/api/statistics", "GET", "", false), 200)
	cfg := DefaultSettings()
	cfg.InterfaceTheme = "catppuccin"
	cfg.Radarr.APIKey = "keep-this-secret"
	cfg.Emby.APIKey = "emby-fake-secret"
	cfg.Emby.URL = "http://emby.example"
	cfg.VisibleColumns["radarr"] = []string{"title", "size"}
	sizeColumn := slices.Index(cfg.ColumnOrder["radarr"], "size")
	cfg.ColumnOrder["radarr"][0], cfg.ColumnOrder["radarr"][sizeColumn] = cfg.ColumnOrder["radarr"][sizeColumn], cfg.ColumnOrder["radarr"][0]
	cfg.TagTextColors = map[string]string{"codec:x264": "#ffffff"}
	b, _ = json.Marshal(cfg)
	check(request("/api/settings", "PUT", string(b), true), 200)
	raw := check(request("/api/settings", "GET", "", false), 200)
	if strings.Contains(raw, "keep-this-secret") || strings.Contains(raw, "emby-fake-secret") || !strings.Contains(raw, `"hasKey":true`) {
		t.Fatal("key disclosed or missing key indicator")
	}
	var stored Settings
	s.Get("settings", &stored)
	if stored.InterfaceTheme != "catppuccin" || !strings.Contains(raw, `"interfaceTheme":"catppuccin"`) {
		t.Fatal("interface theme not persisted or returned")
	}
	invalidTheme := cfg
	invalidTheme.InterfaceTheme = "external-theme"
	b, _ = json.Marshal(invalidTheme)
	check(request("/api/settings", "PUT", string(b), true), 400)
	if server.Config().InterfaceTheme != "catppuccin" {
		t.Fatal("invalid palette altered configuration")
	}
	if stored.TagTextColors["codec:x264"] != "#ffffff" || !strings.Contains(raw, `"tagTextColors":{"codec:x264":"#ffffff"}`) {
		t.Fatal("tag text color not saved or returned")
	}
	invalidText := cfg
	invalidText.TagTextColors = map[string]string{"codec:x264": "#123456"}
	b, _ = json.Marshal(invalidText)
	check(request("/api/settings", "PUT", string(b), true), 400)
	if server.Config().TagTextColors["codec:x264"] != "#ffffff" {
		t.Fatal("invalid text color changed settings")
	}
	if strings.Join(stored.VisibleColumns["radarr"], ",") != "title,size" || !strings.Contains(raw, `"visibleColumns"`) {
		t.Fatal("column selection not saved or returned")
	}
	if stored.ColumnOrder["radarr"][0] != "size" || !strings.Contains(raw, `"columnOrder"`) {
		t.Fatal("column order not saved or returned")
	}
	invalidOrder := cfg
	invalidOrder.ColumnOrder = map[string][]string{"radarr": {"title"}}
	b, _ = json.Marshal(invalidOrder)
	check(request("/api/settings", "PUT", string(b), true), 400)
	if server.Config().ColumnOrder["radarr"][0] != "size" {
		t.Fatal("invalid order changed settings")
	}
	invalid := cfg
	invalid.VisibleColumns = map[string][]string{"radarr": {"size"}}
	b, _ = json.Marshal(invalid)
	check(request("/api/settings", "PUT", string(b), true), 400)
	if strings.Join(server.Config().VisibleColumns["radarr"], ",") != "title,size" {
		t.Fatal("invalid choice changed settings")
	}
	if strings.Contains(stored.Radarr.APIKey, "keep-this-secret") || strings.Contains(stored.Emby.APIKey, "emby-fake-secret") {
		t.Fatal("key stored as plaintext")
	}
	cfg.Radarr.APIKey = ""
	cfg.Emby.APIKey = ""
	b, _ = json.Marshal(cfg)
	check(request("/api/settings", "PUT", string(b), true), 200)
	if server.Config().Radarr.APIKey != "keep-this-secret" || server.Config().Emby.APIKey != "emby-fake-secret" {
		t.Fatal("blank input removed key")
	}
	a := sample(1, "=SUM(1).1080p.x264.DTS.AC3.DV.HDR10.mkv")
	a.Title = "=DANGEROUS"
	bfile := sample(2, "Other.2160p.x265.DTS.HDR10.mkv")
	a.Series = "Show"
	bfile.Series = "Show"
	a.Season = 1
	bfile.Season = 1
	s.Replace("sonarr", []File{a, bfile}, SyncStatus{})
	check(request("/api/presets", "POST", `{"name":"1080 x264","service":"sonarr","query":"resolution=1080p&codec=x264"}`, true), 201)
	duplicate := check(request("/api/presets", "POST", `{"name":"another name","service":"sonarr","query":"codec=x264&resolution=1080p&resolutionOp=eq&page=8"}`, true), 409)
	if !strings.Contains(duplicate, "1080 x264") {
		t.Fatal("duplicate does not identify existing preset")
	}
	check(request("/api/sync", "POST", `{"service":"emby"}`, false), 403)
	check(request("/api/sync", "POST", `{"service":"emby"}`, true), 409)

	raw = check(request("/api/presets", "GET", "", false), 200)
	if !strings.Contains(raw, "1080 x264") {
		t.Fatal("preset missing")
	}
	raw = check(request("/api/export?service=sonarr&resolution=1080p&mode=season", "GET", "", false), 200)
	csvr := csv.NewReader(strings.NewReader(strings.TrimPrefix(raw, "\ufeff")))
	csvr.Comma = ';'
	records, e := csvr.ReadAll()
	if e != nil || len(records) != 2 || records[1][0] != "'=DANGEROUS" {
		t.Fatalf("csv count / safety: %v %v", records, e)
	}

	negativeQuery := "codec=x264&codecOp=not"
	negativeBody, _ := json.Marshal(Preset{Name: "without x264", Service: "sonarr", Query: negativeQuery})
	raw = check(request("/api/presets", "POST", string(negativeBody), true), 201)
	var negativePreset Preset
	if err := json.Unmarshal([]byte(raw), &negativePreset); err != nil {
		t.Fatal(err)
	}
	negativeValues, err := url.ParseQuery(negativePreset.Query)
	if err != nil || negativeValues.Get("codecOp") != "not" {
		t.Fatal("preset lost operator", err)
	}
	var negativeResults Results
	raw = check(request("/api/files?"+negativeValues.Encode(), "GET", "", false), 200)
	if err := json.Unmarshal([]byte(raw), &negativeResults); err != nil || negativeResults.Total != 1 || !negativeResults.Files[0].Matched || negativeResults.Files[0].ID != bfile.ID {
		t.Fatal("negative preset list", raw, err)
	}
	raw = check(request("/api/export?"+negativeValues.Encode()+"&mode=season", "GET", "", false), 200)
	csvr = csv.NewReader(strings.NewReader(strings.TrimPrefix(raw, "\ufeff")))
	csvr.Comma = ';'
	records, e = csvr.ReadAll()
	if e != nil || len(records) != 2 || records[1][0] != bfile.Title {
		t.Fatal("negative CSV differs from list", records, e)
	}
	for _, op := range []string{"all", "notAll"} {
		query := "hdr=HDR10&hdr=Dolby+Vision&hdrOp=" + op + "&audio=DTS"
		body, _ := json.Marshal(Preset{Name: "compound " + op, Service: "sonarr", Query: query})
		raw = check(request("/api/presets", "POST", string(body), true), 201)
		var preset Preset
		if err := json.Unmarshal([]byte(raw), &preset); err != nil {
			t.Fatal(err)
		}
		values, err := url.ParseQuery(preset.Query)
		if err != nil || values.Get("hdrOp") != op {
			t.Fatal("compound preset operator", err)
		}
		raw = check(request("/api/files?"+values.Encode(), "GET", "", false), 200)
		var result Results
		if err := json.Unmarshal([]byte(raw), &result); err != nil || result.Total != 1 {
			t.Fatal("compound list", raw, err)
		}
		want := a.ID
		if op == "notAll" {
			want = bfile.ID
		}
		if result.Files[0].ID != want {
			t.Fatal("compound wrong match", result)
		}
		raw = check(request("/api/export?"+values.Encode()+"&mode=season", "GET", "", false), 200)
		reader := csv.NewReader(strings.NewReader(strings.TrimPrefix(raw, "\ufeff")))
		reader.Comma = ';'
		records, err := reader.ReadAll()
		if err != nil || len(records) != 2 {
			t.Fatal("compound export count", records, err)
		}
		wantTitle := bfile.Title
		if op == "all" {
			wantTitle = "'=DANGEROUS"
		}
		if records[1][0] != wantTitle {
			t.Fatal("compound CSV differs", records)
		}
	}
	check(request("/api/files?service=radarr&sourceOp=invalid", "GET", "", false), 400)
	check(request("/api/export?service=radarr&sourceOp=invalid", "GET", "", false), 400)
	check(request("/api/presets", "POST", `{"name":"invalid","service":"radarr","query":"sourceOp=invalid"}`, true), 400)
	embyMock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || r.URL.Path != "/emby/System/Info" || r.Header.Get("X-Emby-Token") != "emby-fake-secret" {
			t.Error("unexpected Emby connection test")
		}
		w.Write([]byte(`{"Version":"4.10.1.0"}`))
	}))
	defer embyMock.Close()
	testBody, _ := json.Marshal(map[string]string{"service": "emby", "url": embyMock.URL, "apiKey": ""})
	raw = check(request("/api/test", "POST", string(testBody), true), 200)
	if !strings.Contains(raw, "4.10.1.0") {
		t.Fatal("Emby connection test", raw)
	}
	reopened, err := NewServer(ctx, s, nil, "restart-test")
	if err != nil {
		t.Fatal(err)
	}
	if reopened.Config().Emby.APIKey != "emby-fake-secret" {
		t.Fatal("Emby key not decrypted after restart")
	}
	reopened.Sync.Shutdown()
	cfg.Radarr.ClearKey = true
	cfg.Emby.ClearKey = true
	b, _ = json.Marshal(cfg)
	check(request("/api/settings", "PUT", string(b), true), 200)
	if server.Config().Radarr.APIKey != "" || server.Config().Emby.APIKey != "" {
		t.Fatal("explicit key deletion failed")
	}
	stored = Settings{}
	s.Get("settings", &stored)
	if stored.Radarr.APIKey != "" || stored.Emby.APIKey != "" || stored.Radarr.ClearKey {
		t.Fatal("deleted key retained in storage")
	}
	raw = check(request("/api/settings", "GET", "", false), 200)
	if strings.Contains(raw, `"hasKey":true`) {
		t.Fatal("key indicator retained")
	}
	check(request("/api/logout", "POST", "", true), 200)
	check(request("/api/files?service=radarr", "GET", "", false), 401)
}
func TestPaginationAndRestart(t *testing.T) {
	s := testStore(t)
	fs := []File{}
	for i := 1; i <= 105; i++ {
		fs = append(fs, sample(i, fmt.Sprintf("%03d.1080p.x264.mkv", i)))
	}
	s.Replace("radarr", fs, SyncStatus{})
	r, e := s.Query(url.Values{"service": {"radarr"}, "page": {"2"}}, "matches", false)
	if e != nil || r.Total != 105 || len(r.Files) != 5 {
		t.Fatal("pagination")
	}
	dir := s.Dir
	s.DB.Close()
	again, e := OpenStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer again.DB.Close()
	r, e = again.Query(url.Values{"service": {"radarr"}}, "matches", false)
	if e != nil || r.Total != 105 {
		t.Fatal("restart persistence")
	}
}
func TestPerformance50K(t *testing.T) {
	if os.Getenv("SCOPEARR_PERF") != "1" {
		t.Skip("opt-in 50,000 file benchmark")
	}
	s := testStore(t)
	files := make([]File, 50000)
	for i := range files {
		files[i] = sample(i+1, fmt.Sprintf("Film.%05d.1080p.x264.mkv", i))
		files[i].Title = fmt.Sprintf("Movie %05d", i)
		files[i].Source = []string{"BluRay", "WEB-DL", "WEBRip", ""}[i%4]
		files[i].HDR = []string{"Dolby Vision + HDR10", "HDR10", "Dolby Vision", ""}[i%4]
		files[i].Audio = []string{"AC-3 + DTS", "DTS", "AAC", ""}[i%4]
		files[i].Language = []string{"Deutsch, Englisch", "Deutsch", "Englisch", ""}[i%4]
		if i%3 == 0 {
			files[i].Resolution = "2160p"
			files[i].Codec = "x265"
			files[i].Family = "H.265/HEVC"
		}
		files[i].MediaID = i / 12
		files[i].Season = 1
		files[i].Series = fmt.Sprintf("Series %05d", i/12)
	}
	start := time.Now()
	if e := s.Replace("radarr", files, SyncStatus{Count: 50000}); e != nil {
		t.Fatal(e)
	}
	insert := time.Since(start)
	if e := s.Replace("sonarr", files, SyncStatus{Count: 50000}); e != nil {
		t.Fatal(e)
	}
	files = nil
	runtime.GC()
	qs := []url.Values{{"service": {"radarr"}, "resolution": {"1080p"}, "codec": {"x264"}}, {"service": {"radarr"}, "q": {"Movie 012"}}, {"service": {"radarr"}, "yearMin": {"2019"}, "yearMax": {"2021"}}}
	qs = append(qs, url.Values{"service": {"sonarr"}, "resolution": {"1080p"}, "codec": {"x264"}}, url.Values{"service": {"sonarr"}, "q": {"Series 012"}}, url.Values{"service": {"sonarr"}, "yearMin": {"2019"}, "yearMax": {"2021"}})
	qs = append(qs, url.Values{"service": {"radarr"}, "sort": {"resolution"}, "dir": {"desc"}}, url.Values{"service": {"radarr"}, "sort": {"year"}, "dir": {"desc"}}, url.Values{"service": {"radarr"}, "codec": {"x264"}, "sort": {"codec"}, "dir": {"asc"}})
	qs = append(qs, url.Values{"service": {"radarr"}, "resolution": {"1080p"}, "codec": {"x264"}, "source": {"BluRay", "WEB-DL"}, "sourceOp": {"not"}}, url.Values{"service": {"sonarr"}, "codec": {"x265"}, "codecOp": {"not"}, "source": {"__unknown__"}, "sourceOp": {"not"}})
	qs = append(qs, url.Values{"service": {"radarr"}, "hdr": {"HDR10", "Dolby Vision"}, "hdrOp": {"all"}}, url.Values{"service": {"sonarr"}, "hdr": {"HDR10", "Dolby Vision"}, "hdrOp": {"notAll"}}, url.Values{"service": {"radarr"}, "audio": {"DTS", "AC-3"}, "audioOp": {"all"}}, url.Values{"service": {"sonarr"}, "language": {"Deutsch", "Englisch"}, "languageOp": {"notAll"}})
	qs = append(qs, url.Values{"service": {"sonarr"}, "sort": {"size"}, "dir": {"desc"}}, url.Values{"service": {"sonarr"}, "sort": {"resolution"}, "dir": {"desc"}})
	times := []time.Duration{}
	queryTimes := make([][]time.Duration, len(qs))
	for i := 0; i < 60; i++ {
		start = time.Now()
		mode := "matches"
		if i%2 == 1 {
			mode = "season"
		}
		r, e := s.Query(qs[i%len(qs)], mode, false)
		if e != nil {
			t.Fatal(e)
		}
		if len(r.Files) > 100 {
			t.Fatal("unbounded page")
		}
		duration := time.Since(start)
		times = append(times, duration)
		queryTimes[i%len(qs)] = append(queryTimes[i%len(qs)], duration)
	}
	for i, durations := range queryTimes {
		sort.Slice(durations, func(a, b int) bool { return durations[a] < durations[b] })
		t.Logf("Query %s · median %s · max %s", qs[i].Encode(), durations[len(durations)/2], durations[len(durations)-1])
	}
	sort.Slice(times, func(i, j int) bool { return times[i] < times[j] })
	t.Logf("50,000 files · insert %s · p50 %s · p95 %s · %s/%s · CPUs %d", insert, times[30], times[57], runtime.GOOS, runtime.GOARCH, runtime.NumCPU())
	start = time.Now()
	statistics, err := s.Statistics()
	if err != nil || statistics.Files != 100000 {
		t.Fatal("statistics benchmark", err, statistics.Files)
	}
	t.Logf("Statistics over 100,000 files: %s", time.Since(start))
	if times[57] > 200*time.Millisecond {
		t.Errorf("p95 above 200 ms: %s", times[57])
	}
}

func TestMigrationBackupRestoreAndFutureVersion(t *testing.T) {
	dir := t.TempDir()
	s, e := OpenStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	f := sample(7, "Old.1080p.x264.mkv")
	f.Series = "A Show"
	f.Episodes = []Episode{{Number: 2, Title: "Episode"}}
	if e = s.Replace("sonarr", []File{f}, SyncStatus{}); e != nil {
		t.Fatal(e)
	}
	if e = s.Put("settings", DefaultSettings()); e != nil {
		t.Fatal(e)
	}
	// Reconstruct v1 and exercise the same upgrade path used during updates.
	if _, e = s.DB.Exec("DROP INDEX files_series_sort; ALTER TABLE files DROP COLUMN series; ALTER TABLE files DROP COLUMN episode_sort; PRAGMA user_version=1"); e != nil {
		t.Fatal(e)
	}
	s.DB.Close()
	s, e = OpenStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	r, e := s.Query(url.Values{"service": {"sonarr"}}, "matches", false)
	if e != nil || r.Total != 1 || r.Files[0].Series != "A Show" {
		t.Fatalf("migration: %+v %v", r, e)
	}
	backups, _ := filepath.Glob(filepath.Join(dir, "backups", "*.db"))
	if len(backups) != 1 {
		t.Fatalf("missing migration backup: %v", backups)
	}
	restore := t.TempDir()
	raw, e := os.ReadFile(backups[0])
	if e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(filepath.Join(restore, "scopearr.db"), raw, 0600); e != nil {
		t.Fatal(e)
	}
	restored, e := OpenStore(restore)
	if e != nil {
		t.Fatal(e)
	}
	defer restored.DB.Close()
	var cfg Settings
	if e = restored.Get("settings", &cfg); e != nil || cfg.SeasonMode != "matches" {
		t.Fatalf("settings restore: %v", e)
	}
	r, e = restored.Query(url.Values{"service": {"sonarr"}}, "matches", false)
	if e != nil || r.Total != 1 {
		t.Fatalf("restore: %+v %v", r, e)
	}
	if _, e = s.DB.Exec("PRAGMA user_version=999"); e != nil {
		t.Fatal(e)
	}
	s.DB.Close()
	if _, e = OpenStore(dir); e == nil {
		t.Fatal("future database silently accepted")
	}
}

func TestSeriesOrderAndUnknownSize(t *testing.T) {
	s := testStore(t)
	a := sample(2, "A.1080p.mkv")
	a.Series = "Z Show"
	a.Episodes = []Episode{{Number: 1}}
	b := sample(1, "B.1080p.mkv")
	b.Series = "A Show"
	b.Episodes = []Episode{{Number: 12}}
	b.Size = 100
	c := sample(3, "C.1080p.mkv")
	c.Series = "A Show"
	c.Episodes = []Episode{{Number: 2}}
	if e := s.Replace("sonarr", []File{a, b, c}, SyncStatus{}); e != nil {
		t.Fatal(e)
	}
	r, e := s.Query(url.Values{"service": {"sonarr"}}, "matches", false)
	if e != nil || len(r.Files) != 3 || r.Files[0].ID != 3 || r.Files[1].ID != 1 || r.Files[2].ID != 2 {
		t.Fatalf("order: %+v %v", r, e)
	}
	r, e = s.Query(url.Values{"service": {"sonarr"}, "unknownSize": {"true"}}, "matches", false)
	if e != nil || r.Total != 2 {
		t.Fatalf("unknown size: %+v %v", r, e)
	}
}

func TestCombinedLanguageHDRAndTokenBoundaries(t *testing.T) {
	s := testStore(t)
	a := sample(1, "Film.1080p.DV.HDR10Plus.German.English.mkv")
	b := sample(2, "AACtive.DVDrom.HLGood.mkv")
	Enrich(&b, APIInfo{AudioLanguages: "german / English / German"})
	if b.Audio != "" || b.Source != "" || b.HDR != "" {
		t.Fatalf("substring guessed a token: %+v", b)
	}
	if b.Language != "Deutsch, Englisch" {
		t.Fatalf("languages: %s", b.Language)
	}
	if e := s.Replace("radarr", []File{a, b}, SyncStatus{}); e != nil {
		t.Fatal(e)
	}
	r, e := s.Query(url.Values{"service": {"radarr"}, "language": {"Deutsch"}, "hdr": {"Dolby Vision"}}, "matches", false)
	if e != nil || r.Total != 1 {
		t.Fatalf("combined traits: %+v %v", r, e)
	}
	facets, e := s.Facets("radarr")
	if e != nil {
		t.Fatal(e)
	}
	if strings.Join(facets["language"], "/") != "Deutsch/Englisch" {
		t.Fatalf("language facets: %+v", facets)
	}
}

func TestPermanentPresetsAndTagColors(t *testing.T) {
	dir := t.TempDir()
	s, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	cfg := DefaultSettings()
	cfg.TagColors = map[string]string{"codec:x264": "#e5725e", "resolution:1080p": "#3388aa"}
	cfg.TagTextColors = map[string]string{"codec:x264": "#ffffff", "resolution:1080p": "#000000"}
	cfg.VisibleColumns["radarr"] = []string{"title", "size", "audio"}
	cfg.VisibleColumns["sonarr"] = []string{"title", "codec"}
	sizeColumn := slices.Index(cfg.ColumnOrder["radarr"], "size")
	cfg.ColumnOrder["radarr"][0], cfg.ColumnOrder["radarr"][sizeColumn] = cfg.ColumnOrder["radarr"][sizeColumn], cfg.ColumnOrder["radarr"][0]
	cfg.ColumnOrder["sonarr"][0], cfg.ColumnOrder["sonarr"][4] = cfg.ColumnOrder["sonarr"][4], cfg.ColumnOrder["sonarr"][0]
	if err := validateTagColors(cfg.TagColors); err != nil {
		t.Fatal(err)
	}
	for _, colors := range []map[string]string{{"codec:x264": "red"}, {"codec:x264": "#ffffff; color:red"}, {"password:x": "#ffffff"}, {"codec:": "#ffffff"}} {
		if validateTagColors(colors) == nil {
			t.Fatal("invalid color accepted")
		}
	}
	if err = s.Put("settings", cfg); err != nil {
		t.Fatal(err)
	}
	if _, err = s.DB.Exec("INSERT INTO presets(name,service,query) VALUES(?,?,?)", "1080p x264", "radarr", "resolution=1080p&codec=x264"); err != nil {
		t.Fatal(err)
	}
	s.DB.Close()
	s, err = OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.DB.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, err := NewServer(ctx, s, nil, "test")
	if err != nil {
		t.Fatal(err)
	}
	defer server.Sync.Shutdown()
	if server.Config().TagColors["codec:x264"] != "#e5725e" {
		t.Fatal("tag color lost after restart")
	}
	if server.Config().TagTextColors["codec:x264"] != "#ffffff" || server.Config().TagTextColors["resolution:1080p"] != "#000000" {
		t.Fatal("tag text colors lost after restart")
	}
	if strings.Join(server.Config().VisibleColumns["radarr"], ",") != "title,size,audio" || strings.Join(server.Config().VisibleColumns["sonarr"], ",") != "title,codec" {
		t.Fatal("column choices lost after restart")
	}
	if server.Config().ColumnOrder["radarr"][0] != "size" || server.Config().ColumnOrder["sonarr"][0] != "codec" {
		t.Fatal("column order lost after restart")
	}
	presets, err := s.Presets()
	if err != nil || len(presets) != 1 || presets[0].Name != "1080p x264" {
		t.Fatal("preset lost after restart", presets, err)
	}
	if err = SeedDemo(s); err != nil {
		t.Fatal(err)
	}
	var after Settings
	s.Get("settings", &after)
	if strings.Join(after.VisibleColumns["radarr"], ",") != "title,size,audio" {
		t.Fatal("demo restart removed columns")
	}
	if after.ColumnOrder["radarr"][0] != "size" || after.ColumnOrder["sonarr"][0] != "codec" {
		t.Fatal("demo restart removed column order")
	}
	if after.TagColors["codec:x264"] != "#e5725e" {
		t.Fatal("demo restart removed colors")
	}
}

func TestColumnSorting(t *testing.T) {
	s := testStore(t)
	files := []File{sample(1, "A.720p.x265.mkv"), sample(2, "C.1080p.x264.mkv"), sample(3, "B.2160p.HEVC.mkv"), sample(4, "Unknown.mkv")}
	for i := range files {
		files[i].Title = []string{"Alpha", "Charlie", "Bravo", "Zulu"}[i]
		files[i].Size = int64(10 + i)
		files[i].Years = []int{2020 + i}
		files[i].Audio = []string{"DTS", "AAC", "FLAC", ""}[i]
		files[i].BitDepth = []string{"8", "10", "12", ""}[i]
		files[i].Channels = []string{"2.0", "5.1", "7.1", ""}[i]
	}
	files[3].Years = nil
	files[3].Size = 0
	if err := s.Replace("radarr", files, SyncStatus{}); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		field, dir string
		ids        []int
	}{{"title", "asc", []int{1, 3, 2, 4}}, {"title", "desc", []int{4, 2, 3, 1}}, {"resolution", "asc", []int{1, 2, 3, 4}}, {"resolution", "desc", []int{3, 2, 1, 4}}, {"year", "asc", []int{1, 2, 3, 4}}, {"year", "desc", []int{3, 2, 1, 4}}, {"size", "desc", []int{3, 2, 1, 4}}, {"codec", "asc", []int{3, 2, 1, 4}}, {"bitDepth", "desc", []int{3, 2, 1, 4}}, {"channels", "asc", []int{1, 2, 3, 4}}} {
		r, err := s.Query(url.Values{"service": {"radarr"}, "sort": {test.field}, "dir": {test.dir}}, "matches", false)
		if err != nil {
			t.Fatal(err)
		}
		for i, id := range test.ids {
			if r.Files[i].ID != id {
				t.Fatalf("%s %s: got %v at %d, want %d", test.field, test.dir, r.Files[i].ID, i, id)
			}
		}
	}
	for _, field := range []string{"source", "hdr", "audio", "language"} {
		for _, dir := range []string{"asc", "desc"} {
			if _, err := s.Query(url.Values{"service": {"radarr"}, "sort": {field}, "dir": {dir}}, "matches", false); err != nil {
				t.Fatal(err)
			}
		}
	}
	if _, err := s.Query(url.Values{"service": {"radarr"}, "dir": {"asc;DROP TABLE files"}}, "matches", false); err == nil {
		t.Fatal("invalid direction accepted")
	}
}

func TestStatisticsUniqueMediaAndEpisodes(t *testing.T) {
	s := testStore(t)
	empty, err := s.Statistics()
	if err != nil || empty.Files != 0 || len(empty.Distributions["all"]["codec"]) != 0 {
		t.Fatal("empty statistics", empty, err)
	}
	a := sample(1, "Movie.1080p.WEB-DL.x264.mkv")
	a.MediaID = 1
	b := sample(2, "Alternate.2160p.BluRay.x265.mkv")
	b.MediaID = 1
	c := sample(3, "Other.mkv")
	c.MediaID = 2
	s.Replace("radarr", []File{a, b, c}, SyncStatus{})
	a.ID = 10
	a.MediaID = 100
	a.Season = 1
	a.Episodes = []Episode{{ID: 1, Number: 1}, {ID: 2, Number: 2}}
	b.ID = 11
	b.MediaID = 100
	b.Season = 1
	b.Episodes = []Episode{{ID: 2, Number: 2}}
	c.ID = 12
	c.MediaID = 200
	c.Season = 0
	c.Episodes = []Episode{{ID: 3, Number: 1}}
	s.Replace("sonarr", []File{a, b, c}, SyncStatus{})
	result, err := s.Statistics()
	if err != nil {
		t.Fatal(err)
	}
	if result.Movies != 2 || result.Series != 2 || result.Episodes != 3 || result.Files != 6 {
		t.Fatalf("wrong statistics: %+v", result)
	}
	for _, scope := range []string{"all", "radarr", "sonarr"} {
		for _, field := range []string{"resolution", "codec", "source"} {
			sum, unknown := 0, 0
			for _, bucket := range result.Distributions[scope][field] {
				sum += bucket.Count
				if bucket.Value == "" {
					unknown = bucket.Count
				}
			}
			want := 3
			if scope == "all" {
				want = 6
			}
			if sum != want || unknown != want/3 {
				t.Fatalf("%s %s total %d unknown %d", scope, field, sum, unknown)
			}
		}
	}
}

func TestVisibleColumnsLegacyAndValidation(t *testing.T) {
	cfg := DefaultSettings()
	cfg.VisibleColumns = nil
	if err := normalizeVisibleColumns(&cfg); err != nil || strings.Join(cfg.VisibleColumns["radarr"], ",") != "info,title,year,resolution,codec,source,processing,custom" {
		t.Fatal("legacy defaults missing", err)
	}
	for _, columns := range []map[string][]string{
		{"radarr": {}}, {"radarr": {"year"}}, {"radarr": {"title", "title"}},
		{"radarr": {"title", "password"}}, {"other": {"title"}},
	} {
		cfg.VisibleColumns = columns
		if normalizeVisibleColumns(&cfg) == nil {
			t.Fatal("invalid columns accepted", columns)
		}
	}
	cfg.VisibleColumns = map[string][]string{"sonarr": {"title"}}
	if err := normalizeVisibleColumns(&cfg); err != nil || len(cfg.VisibleColumns["radarr"]) != 8 || len(cfg.VisibleColumns["sonarr"]) != 1 {
		t.Fatal("partial choices not normalized", err)
	}
	s := testStore(t)
	cfg.VisibleColumns = nil
	if err := s.Put("settings", cfg); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, err := NewServer(ctx, s, nil, "test")
	if err != nil {
		t.Fatal(err)
	}
	defer server.Sync.Shutdown()
	if len(server.Config().VisibleColumns["radarr"]) != 8 {
		t.Fatal("legacy server layout missing")
	}
}

func TestColumnOrderLegacyAndValidation(t *testing.T) {
	cfg := DefaultSettings()
	cfg.ColumnOrder = nil
	if err := normalizeVisibleColumns(&cfg); err != nil || len(cfg.ColumnOrder["radarr"]) != 13 || cfg.ColumnOrder["radarr"][0] != "info" {
		t.Fatal("missing legacy column order", err)
	}
	duplicate := defaultColumnOrder()["radarr"]
	duplicate[1] = duplicate[0]
	unknown := defaultColumnOrder()["radarr"]
	unknown[1] = "password"
	for _, order := range []map[string][]string{
		{"radarr": {}}, {"radarr": {"title"}}, {"radarr": duplicate}, {"radarr": unknown}, {"other": defaultColumnOrder()["radarr"]},
	} {
		cfg.ColumnOrder = order
		if normalizeVisibleColumns(&cfg) == nil {
			t.Fatal("invalid order accepted", order)
		}
	}
	cfg.ColumnOrder = map[string][]string{"sonarr": defaultColumnOrder()["sonarr"]}
	cfg.ColumnOrder["sonarr"][0], cfg.ColumnOrder["sonarr"][4] = cfg.ColumnOrder["sonarr"][4], cfg.ColumnOrder["sonarr"][0]
	if err := normalizeVisibleColumns(&cfg); err != nil || cfg.ColumnOrder["sonarr"][0] != "codec" || cfg.ColumnOrder["radarr"][0] != "info" {
		t.Fatal("partial order lost", err)
	}
	store := testStore(t)
	cfg.ColumnOrder = nil
	if err := store.Put("settings", cfg); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, err := NewServer(ctx, store, nil, "test")
	if err != nil {
		t.Fatal(err)
	}
	defer server.Sync.Shutdown()
	if len(server.Config().ColumnOrder["sonarr"]) != 13 {
		t.Fatal("legacy server order missing")
	}
}
