package app

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
)

func customRule(id, field, pattern, value, mode string, priority int) RecognitionRule {
	return RecognitionRule{ID: id, Name: id, Field: field, Pattern: pattern, Value: value, Mode: mode, Priority: priority, Match: "token", Enabled: true}
}
func TestRecognitionFallbackOverrideAndConflicts(t *testing.T) {
	rules := append(DefaultRecognitionRules(), customRule("uhdbd", "resolution", "UHDBD", "2160p", "fallback", 10))
	engine, err := CompileRecognition(rules)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		name, resolution string
		conflicts        int
	}{{"Movie.UHDBD.x265.mkv", "2160p", 0}, {"Movie.1080p.UHDBD.mkv", "1080p", 0}, {"Movie.1080p.2160p.mkv", "1080p", 1}, {"Movie.4K.2160p.mkv", "2160p", 0}, {"Movie.x264.AVC.mkv", "", 0}, {"Movie.DV.HDR10.DTS-HD.AC3.German.English.mkv", "", 0}} {
		result := engine.Recognize(c.name)
		if result.Values["resolution"] != c.resolution || len(result.Conflicts) != c.conflicts {
			t.Fatalf("%s: %+v", c.name, result)
		}
	}
	both := engine.Recognize("Movie.DV.HDR10.DTS-HD.AC3.German.English.mkv")
	if both.Values["hdr"] != "Dolby Vision + HDR10" || both.Values["audio"] != "DTS-HD + AC-3" || both.Values["language"] != "Deutsch, Englisch" {
		t.Fatal(both)
	}
	if got := engine.Recognize("Movie.DTS-HD.DTS-HD.mkv").Values["audio"]; got != "DTS-HD" {
		t.Fatal(got)
	}
	rules = append(rules, customRule("uhd-override", "resolution", "UHDBD", "2160p", "override", 5))
	engine, _ = CompileRecognition(rules)
	result := engine.Recognize("Movie.1080p.720p.UHDBD.mkv")
	if result.Values["resolution"] != "2160p" || len(result.Conflicts) != 0 || result.Origins["resolution"] != "rule" {
		t.Fatal(result)
	}
	rules = append(rules, customRule("contradiction", "resolution", "UHDBD", "4320p", "override", 6))
	engine, _ = CompileRecognition(rules)
	result = engine.Recognize("Movie.UHDBD.mkv")
	if len(result.Conflicts) != 1 || len(result.Conflicts[0].RuleNames) != 2 {
		t.Fatal(result)
	}
}
func TestRecognitionBoundariesValidationAndCapture(t *testing.T) {
	rule := customRule("capture", "resolution", `[._](\d{4})P[._]`, "${1}p", "direct", 1)
	rule.Match = "regex"
	engine, err := CompileRecognition([]RecognitionRule{rule})
	if err != nil || engine.Recognize("Movie.2160P.x265.mkv").Values["resolution"] != "2160p" {
		t.Fatal(err)
	}
	token := customRule("uhd", "source", "UHD", "UHD", "direct", 1)
	engine, _ = CompileRecognition([]RecognitionRule{token})
	if engine.Recognize("CUHDmovie.mkv").Values["source"] != "" || engine.Recognize("Movie.uhd.mkv").Values["source"] != "UHD" {
		t.Fatal("token boundaries")
	}
	for _, pattern := range []string{"(", ".*", "(?<=x)y", `(a)\1`} {
		bad := rule
		bad.Pattern = pattern
		if _, err = CompileRecognition([]RecognitionRule{bad}); err == nil {
			t.Fatal("invalid regex", pattern)
		}
	}
	zero := rule
	zero.Pattern = `\b`
	zero.Value = "1080p"
	engine, err = CompileRecognition([]RecognitionRule{zero})
	if err != nil {
		t.Fatal(err)
	}
	if len(engine.Recognize("Movie.mkv").Values) != 0 {
		t.Fatal("zero-width inferred value")
	}
	if _, err = CompileRecognition([]RecognitionRule{token, token}); err == nil {
		t.Fatal("duplicate IDs")
	}
	for _, bad := range []RecognitionRule{func() RecognitionRule { r := token; r.Field = "sql"; return r }(), func() RecognitionRule { r := token; r.Priority = -1; return r }(), func() RecognitionRule { r := token; r.Unless = "("; return r }()} {
		if _, err = CompileRecognition([]RecognitionRule{bad}); err == nil {
			t.Fatal(bad)
		}
	}
	if _, err = CompileRecognition(make([]RecognitionRule, 257)); err == nil {
		t.Fatal("unbounded rule count")
	}
}
func TestRecognitionReparsePreservesEmbyAndAtomicState(t *testing.T) {
	store := testStore(t)
	file := sample(1, "Movie.UHDBD.DV.x265.German.mkv")
	Enrich(&file, APIInfo{Quality: "Bluray-1080p", VideoCodec: "HEVC"})
	applyEmby(&file, []embyStream{{Type: "Video", ExtendedVideoType: "Hdr10"}, {Type: "Audio", Index: 1, Language: "ger", Codec: "dts"}, {Type: "Audio", Index: 2, Language: "eng", Codec: "ac3"}})
	if err := store.Replace("radarr", []File{file}, SyncStatus{}); err != nil {
		t.Fatal(err)
	}
	before := store.Recognition()
	rules := append(before.Rules, customRule("infer-uhd", "resolution", "UHDBD", "2160p", "fallback", 10))
	current, err := store.SaveRecognition(context.Background(), rules, before.Revision)
	if err != nil {
		t.Fatal(err)
	}
	out, err := store.Query(url.Values{"service": {"radarr"}}, "matches", false)
	if err != nil || out.Total != 1 {
		t.Fatal(out, err)
	}
	got := out.Files[0]
	if got.Resolution != "2160p" || got.Conflict || !got.Evidence["resolution"].APIDiffers || got.RuleConflict || got.EmbyMatch != "matched" || len(got.AudioTracks) != 2 || !strings.Contains(got.HDR, "HDR10") || got.Language != "Deutsch, Englisch" {
		t.Fatalf("enrichment lost: %+v", got)
	}
	if _, err = store.SaveRecognition(context.Background(), nil, before.Revision); !errors.Is(err, ErrRecognitionRevision) {
		t.Fatal("stale overwrite", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = store.SaveRecognition(ctx, nil, current.Revision); err == nil {
		t.Fatal("cancelled committed")
	}
	if store.Recognition().Revision != current.Revision {
		t.Fatal("cancelled rules changed")
	}
	// A sync that parsed files before the edit must commit using the current rules.
	if err = store.Replace("radarr", []File{file}, SyncStatus{}); err != nil {
		t.Fatal(err)
	}
	out, _ = store.Query(url.Values{"service": {"radarr"}}, "matches", false)
	if out.Files[0].Resolution != "2160p" {
		t.Fatal("stale sync overwrote rule result")
	}
	dir := store.Dir
	store.DB.Close()
	reopened, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.DB.Close()
	if reopened.Recognition().Revision != current.Revision {
		t.Fatal("rules lost after restart")
	}
	noRules, err := reopened.SaveRecognition(context.Background(), nil, current.Revision)
	if err != nil {
		t.Fatal(err)
	}
	out, _ = reopened.Query(url.Values{"service": {"radarr"}}, "matches", false)
	got = out.Files[0]
	if got.Resolution != "1080p" || got.Codec != "HEVC" || got.Conflict || len(got.AudioTracks) != 2 || len(noRules.Rules) != 0 {
		t.Fatal("API fallback lost", got)
	}
	backups, _ := filepath.Glob(filepath.Join(dir, "backups", "*.db"))
	if len(backups) > 3 {
		t.Fatal("backup retention")
	}
}
func TestRecognitionFiltersCSVAndLanguageTitleCounts(t *testing.T) {
	store := testStore(t)
	files := []File{sample(1, "First.1080p.x264.German.English.mkv"), sample(2, "First.alt.1080p.x264.German.mkv"), sample(3, "Second.1080p.2160p.x265.English.mkv"), sample(4, "Third.1080p.x264.mkv")}
	files[0].MediaID = 1
	files[1].MediaID = 1
	files[2].MediaID = 2
	files[3].MediaID = 3
	files[0].EmbyMatch = "matched"
	files[1].EmbyMatch = "missing"
	files[2].EmbyMatch = "ambiguous"
	Enrich(&files[3], APIInfo{VideoCodec: "HEVC"})
	if files[3].Conflict || !files[3].Evidence["codec"].APIDiffers {
		t.Fatal("Arr codec difference should be informational", files[3])
	}
	files[3].setMediaMatch("emby", MediaMatch{Status: "no_tracks", Video: &MediaVideo{Codec: "HEVC"}})
	resolveMediaServers(&files[3])
	if err := store.Replace("radarr", files, SyncStatus{}); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		key, value string
		total      int
	}{{"conflict", "true", 1}, {"ruleConflict", "true", 1}, {"embyMatch", "unmatched", 3}, {"embyMatch", "no_tracks", 1}, {"embyMatch", "unconfigured", 0}, {"language", "Deutsch", 2}, {"language", "Englisch", 2}} {
		q := url.Values{"service": {"radarr"}, c.key: {c.value}}
		out, err := store.Query(q, "matches", false)
		if err != nil || out.Total != c.total {
			t.Fatal(c, out, err)
		}
		server := &Server{Store: store}
		response := httptest.NewRecorder()
		server.export(response, httptest.NewRequest("GET", "/api/export?"+q.Encode(), nil))
		if response.Code != 200 {
			t.Fatal(response.Code, response.Body.String())
		}
		reader := csv.NewReader(strings.NewReader(strings.TrimPrefix(response.Body.String(), "\xef\xbb\xbf")))
		reader.Comma = ';'
		records, err := reader.ReadAll()
		if err != nil || len(records) != c.total+1 {
			t.Fatal("CSV disagreement", c, err)
		}
	}
	stats, err := store.Statistics()
	if err != nil {
		t.Fatal(err)
	}
	buckets := map[string]int{}
	for _, b := range stats.Distributions["radarr"]["language"] {
		buckets[b.Value] = b.Count
	}
	if stats.LanguageTotals["radarr"] != 3 || buckets["Deutsch"] != 1 || buckets["Englisch"] != 2 || buckets[""] != 1 {
		t.Fatal(stats)
	}
	episodes := []File{sample(10, "Series.German.English.mkv"), sample(11, "Series.English.mkv")}
	for i := range episodes {
		episodes[i].MediaID = 8
		episodes[i].Season = 0
	}
	episodes[0].Episodes = []Episode{{Number: 1}, {Number: 2}}
	episodes[1].Episodes = []Episode{{Number: 2}}
	if err = store.Replace("sonarr", episodes, SyncStatus{}); err != nil {
		t.Fatal(err)
	}
	stats, err = store.Statistics()
	if err != nil {
		t.Fatal(err)
	}
	buckets = map[string]int{}
	for _, b := range stats.Distributions["sonarr"]["language"] {
		buckets[b.Value] = b.Count
	}
	if stats.LanguageTotals["all"] != 5 || stats.LanguageTotals["sonarr"] != 2 || buckets["Englisch"] != 2 || buckets["Deutsch"] != 2 {
		t.Fatal(stats)
	}
	// Aggregate callers cannot corrupt the cached denominator.
	stats.LanguageTotals["all"] = 999
	again, _ := store.Statistics()
	if again.LanguageTotals["all"] != 5 {
		t.Fatal("cache leaked")
	}
	for _, bad := range []url.Values{{"ruleConflict": {"invalid"}}, {"embyMatch": {"arbitrary"}}} {
		if _, _, err = where(bad); err == nil {
			t.Fatal("invalid filter", bad)
		}
	}
}
func TestRecognitionEndpointsRequireLoginCSRFAndRevision(t *testing.T) {
	store := testStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, err := NewServer(ctx, store, nil, "0.3.0")
	if err != nil {
		t.Fatal(err)
	}
	defer server.Sync.Shutdown()
	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	csrf := ""
	request := func(path, method string, body any, token bool, want int) []byte {
		t.Helper()
		raw, _ := json.Marshal(body)
		req, _ := http.NewRequest(method, httpServer.URL+path, strings.NewReader(string(raw)))
		if token {
			req.Header.Set("X-CSRF-Token", csrf)
		}
		response, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		data, _ := io.ReadAll(response.Body)
		if response.StatusCode != want {
			t.Fatalf("%s: %d: %s", path, response.StatusCode, data)
		}
		return data
	}
	for _, path := range []string{"/api/recognition", "/api/recognition/defaults"} {
		request(path, "GET", nil, false, 401)
	}
	request("/api/recognition/preview", "POST", map[string]any{}, false, 401)
	request("/api/setup", "POST", map[string]string{"username": "admin", "password": "long-test-password-123!", "token": server.Security.setupToken}, false, 200)
	var status struct {
		CSRF string `json:"csrf"`
	}
	json.Unmarshal(request("/api/status", "GET", nil, false, 200), &status)
	csrf = status.CSRF
	cfg := DefaultSettings()
	cfg.WarningColors = map[string]string{"metadata": "#aa5522", "recognition": "#8866cc"}
	request("/api/settings", "PUT", cfg, true, 200)
	var savedSettings Settings
	json.Unmarshal(request("/api/settings", "GET", nil, false, 200), &savedSettings)
	if savedSettings.WarningColors["metadata"] != "#aa5522" || savedSettings.WarningColors["recognition"] != "#8866cc" {
		t.Fatal("warning colors not persisted")
	}
	current := store.Recognition()
	body := map[string]any{"rules": current.Rules, "revision": current.Revision, "filename": "Movie.1080p.x264.mkv"}
	request("/api/recognition/preview", "POST", body, false, 403)
	request("/api/recognition", "PUT", body, false, 403)
	request("/api/recognition/preview", "POST", body, true, 200)
	if store.Recognition().Revision != current.Revision {
		t.Fatal("preview changed rules")
	}
	body["revision"] = "outdated"
	request("/api/recognition", "PUT", body, true, 409)
	body["rules"] = []RecognitionRule{customRule("bad", "invalid", "word", "1080p", "direct", 1)}
	request("/api/recognition/preview", "POST", body, true, 400)
	body["rules"] = current.Rules
	body["revision"] = current.Revision
	request("/api/recognition", "PUT", body, true, 200)
}
func TestAudioColumnMigrationAndWarningColors(t *testing.T) {
	cfg := DefaultSettings()
	cfg.VisibleColumns = map[string][]string{"radarr": {"title", "audio", "language", "resolution"}}
	cfg.ColumnOrder = defaultColumnOrder()
	cfg.ColumnOrder["radarr"] = []string{"title", "audio", "resolution", "codec", "source", "year", "size", "hdr", "bitDepth", "channels", "language"}
	if err := normalizeVisibleColumns(&cfg); err != nil {
		t.Fatal(err)
	}
	if strings.Join(cfg.VisibleColumns["radarr"], ",") != "title,audio,resolution" || cfg.ColumnOrder["radarr"][11] != "audio" {
		t.Fatal(cfg)
	}
	cfg.WarningColors = map[string]string{"metadata": "#123456"}
	if err := normalizeWarningColors(&cfg); err != nil || cfg.WarningColors["recognition"] == "" {
		t.Fatal(err, cfg)
	}
	for _, colors := range []map[string]string{{"metadata": "red"}, {"unknown": "#123456"}, {"recognition": "#000000;display:none"}} {
		cfg.WarningColors = colors
		if normalizeWarningColors(&cfg) == nil {
			t.Fatal("invalid colors", colors)
		}
	}
}

func TestRecognitionRollbackAfterPartialReprocessing(t *testing.T) {
	store := testStore(t)
	files := make([]File, 260)
	for i := range files {
		files[i] = sample(i+1, "Movie.UHDBD.x265.mkv")
	}
	if err := store.Replace("radarr", files, SyncStatus{}); err != nil {
		t.Fatal(err)
	}
	before := store.Recognition()
	if _, err := store.DB.Exec("UPDATE files SET data='{bad' WHERE id=260"); err != nil {
		t.Fatal(err)
	}
	rules := append(before.Rules, customRule("uhdbd", "resolution", "UHDBD", "2160p", "fallback", 1))
	if _, err := store.SaveRecognition(context.Background(), rules, before.Revision); err == nil {
		t.Fatal("corrupt cache committed")
	}
	var resolution, raw string
	store.DB.QueryRow("SELECT resolution,data FROM files WHERE id=1").Scan(&resolution, &raw)
	if resolution != "" || strings.Contains(raw, "2160p") || store.Recognition().Revision != before.Revision {
		t.Fatal("partial transaction survived", resolution, raw)
	}
	var persisted RecognitionConfig
	if err := store.Get("recognition", &persisted); err != nil || persisted.Revision != before.Revision {
		t.Fatal("rules persisted on failure", err)
	}
}
func TestRecognitionMigrationFromSchemaFourRetainsTracksAndPresets(t *testing.T) {
	store := testStore(t)
	file := sample(1, "Movie.1080p.x264.German.mkv")
	applyEmby(&file, []embyStream{{Type: "Audio", Index: 1, Language: "ger", Codec: "dts"}, {Type: "Audio", Index: 2, Language: "eng", Codec: "ac3"}})
	file.APIInfo = nil
	file.RecognitionRevision = ""
	file.RecognitionConflicts = nil
	if err := store.Replace("radarr", []File{file}, SyncStatus{}); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(file)
	if _, err := store.DB.Exec("UPDATE files SET data=?; DELETE FROM kv WHERE key='recognition'; DROP TABLE file_languages; DROP INDEX files_rule_conflicts; DROP INDEX files_emby_match; DROP INDEX files_traits; ALTER TABLE files DROP COLUMN rule_conflict; ALTER TABLE files DROP COLUMN emby_match; PRAGMA user_version=4", string(raw)); err != nil {
		t.Fatal(err)
	}
	if _, err := store.DB.Exec("INSERT INTO presets(name,service,query) VALUES('Languages','radarr','language=Deutsch&audio=DTS')"); err != nil {
		t.Fatal(err)
	}
	cfg := DefaultSettings()
	cfg.VisibleColumns["radarr"] = []string{"title", "language"}
	store.Put("settings", cfg)
	dir := store.Dir
	store.DB.Close()
	migrated, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer migrated.DB.Close()
	out, err := migrated.Query(url.Values{"service": {"radarr"}}, "matches", false)
	if err != nil || out.Total != 1 || len(out.Files[0].AudioTracks) != 2 || out.Files[0].Language != "Deutsch, Englisch" {
		t.Fatal(out, err)
	}
	var version, presets int
	migrated.DB.QueryRow("PRAGMA user_version").Scan(&version)
	migrated.DB.QueryRow("SELECT count(*) FROM presets").Scan(&presets)
	if version != 18 || presets != 1 {
		t.Fatal(version, presets)
	}
	backups, _ := filepath.Glob(filepath.Join(dir, "backups", "*.db"))
	if len(backups) != 1 {
		t.Fatal("pre-migration backup missing", backups)
	}
	var persisted Settings
	migrated.Get("settings", &persisted)
	if err = normalizeVisibleColumns(&persisted); err != nil || !containsColumn(persisted.VisibleColumns["radarr"], "audio") {
		t.Fatal(persisted, err)
	}
}

func TestMergedAudioKeepsUnattributedFallbackAndLanguagePresetAliases(t *testing.T) {
	file := sample(1, "Movie.1080p.x264.DTS.German.mkv")
	applyEmby(&file, []embyStream{{Type: "Audio", Index: 1, Language: "und", Codec: ""}})
	summary := combinedAudioSummary(file, "en")
	if !strings.Contains(summary, "Languages: Deutsch") || !strings.Contains(summary, "Codecs: DTS") || strings.Contains(summary, "Deutsch → DTS") {
		t.Fatal("fallback falsely attributed", summary)
	}
	if got := combinedAudioSummary(file, "es"); !strings.Contains(got, "Idiomas:") || !strings.Contains(got, "Desconocido") {
		t.Fatal(got)
	}
	store := testStore(t)
	Enrich(&file, APIInfo{AudioLanguages: "Spanish / Italian"})
	store.Replace("radarr", []File{file}, SyncStatus{})
	out, err := store.Query(url.Values{"service": {"radarr"}, "language": {"Spanish", "Italian"}, "languageOp": {"all"}}, "matches", false)
	if err != nil || out.Total != 1 {
		t.Fatal("legacy language preset aliases broke", out, err)
	}
}

func TestSeasonContextEmptyPagesAndMultiYearFilters(t *testing.T) {
	store := testStore(t)
	a := sample(1, "A.1080p.x264.mkv")
	b := sample(2, "B.2160p.x265.mkv")
	c := sample(3, "C.2160p.x265.mkv")
	a.Series, b.Series, c.Series = "Show", "Show", "Other show"
	a.Season, b.Season, c.Season = 0, 0, 1
	c.MediaID = 2
	a.Years, b.Years = []int{2019, 2021}, []int{}
	if err := store.Replace("sonarr", []File{a, b, c}, SyncStatus{}); err != nil {
		t.Fatal(err)
	}
	query := url.Values{"service": {"sonarr"}, "yearMin": {"2021"}, "yearMax": {"2021"}}
	result, err := store.Query(query, "season", false)
	if err != nil || result.Total != 1 || result.DisplayTotal != 2 || len(result.Files) != 2 || !result.Files[0].Matched || result.Files[1].Matched {
		t.Fatalf("multi-year match and Specials context: %+v, %v", result, err)
	}
	query.Set("page", "2")
	result, err = store.Query(query, "season", false)
	if err != nil || result.Total != 1 || result.DisplayTotal != 2 || len(result.Files) != 0 {
		t.Fatalf("out-of-range page must retain counts: %+v, %v", result, err)
	}
	query.Set("page", "1")
	query.Set("yearMin", "2022")
	query.Set("yearMax", "2022")
	result, err = store.Query(query, "season", false)
	if err != nil || result.Total != 0 || result.DisplayTotal != 0 || len(result.Files) != 0 {
		t.Fatalf("empty matches: %+v, %v", result, err)
	}
}

func TestCompactPaginationMatchesCompleteSortOrder(t *testing.T) {
	store := testStore(t)
	files := make([]File, 230)
	for i := range files {
		files[i] = sample(i+1, "Movie.1080p.x264.German.mkv")
		files[i].Title = "Movie " + strings.Repeat("A", i%7) + string(rune('a'+i%26))
		files[i].Years = []int{1980 + i%40}
		files[i].Size = int64(i%11) * 1024
		files[i].AudioTracks = []AudioTrack{{Index: 1, Language: "Deutsch", Codec: "DTS", Title: strings.Repeat("Large synthetic track title ", 100)}}
	}
	if err := store.Replace("radarr", files, SyncStatus{}); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"title", "year", "resolution", "codec", "source", "size", "hdr", "bitDepth", "audio", "channels", "language"} {
		for _, direction := range []string{"asc", "desc"} {
			query := url.Values{"service": {"radarr"}, "codec": {"x264"}, "sort": {field}, "dir": {direction}}
			complete, err := store.Query(query, "matches", true)
			if err != nil {
				t.Fatal(err)
			}
			for _, page := range []string{"1", "2", "3"} {
				query.Set("page", page)
				partial, err := store.Query(query, "matches", false)
				if err != nil {
					t.Fatal(field, direction, err)
				}
				start := (partial.Page - 1) * 100
				end := start + 100
				if end > len(complete.Files) {
					end = len(complete.Files)
				}
				if partial.Total != complete.Total || len(partial.Files) != end-start {
					t.Fatal("pagination count", field, direction, page)
				}
				for i, file := range partial.Files {
					if file.ID != complete.Files[start+i].ID || !file.Matched {
						t.Fatal("pagination order", field, direction, page, file.ID)
					}
				}
			}
		}
	}
}

func TestReprocessingUpdatesOnlyChangedLanguageAssociations(t *testing.T) {
	store := testStore(t)
	file := sample(1, "Movie.1080p.x264.MYLANG.mkv")
	Enrich(&file, APIInfo{})
	if err := store.Replace("radarr", []File{file}, SyncStatus{}); err != nil {
		t.Fatal(err)
	}
	before := store.Recognition()
	rules := append(before.Rules, customRule("custom-language", "language", "MYLANG", "Deutsch", "direct", 1))
	saved, err := store.SaveRecognition(context.Background(), rules, before.Revision)
	if err != nil {
		t.Fatal(err)
	}
	out, err := store.Query(url.Values{"service": {"radarr"}, "language": {"Deutsch"}}, "matches", false)
	if err != nil || out.Total != 1 {
		t.Fatal("changed language association missing", out, err)
	}
	rules = append(rules, customRule("custom-source", "source", "MYLANG", "UHD", "override", 1))
	saved, err = store.SaveRecognition(context.Background(), rules, saved.Revision)
	if err != nil {
		t.Fatal(err)
	}
	out, err = store.Query(url.Values{"service": {"radarr"}, "language": {"Deutsch"}, "source": {"UHD"}}, "matches", false)
	if err != nil || out.Total != 1 {
		t.Fatal("unchanged language association lost", out, err)
	}
	_, err = store.SaveRecognition(context.Background(), before.Rules, saved.Revision)
	if err != nil {
		t.Fatal(err)
	}
	out, err = store.Query(url.Values{"service": {"radarr"}, "language": {"Deutsch"}}, "matches", false)
	if err != nil || out.Total != 0 {
		t.Fatal("removed language association retained", out, err)
	}
}
