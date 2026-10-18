package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestRulePresentationSpelling101(t *testing.T) {
	store := testStore(t)
	cfg := store.Recognition()
	cfg.Rules = append(cfg.Rules, RecognitionRule{ID: "my-vp9", Name: "Codec / VP9", Field: "codec", Match: "token", Pattern: "vp9", Value: "VP9", Mode: "direct", Priority: 95, Enabled: true})
	if _, err := store.SaveRecognition(context.Background(), cfg.Rules, cfg.Revision); err != nil {
		t.Fatal(err)
	}
	f := sample(1, "Example.mkv")
	Enrich(&f, APIInfo{VideoCodec: "vp9"})
	if err := store.Replace("radarr", []File{f}, SyncStatus{}); err != nil {
		t.Fatal(err)
	}
	presentation, err := store.TagPresentation(context.Background())
	if err != nil || presentation.Labels["codec:vp9"] != "VP9" || !containsString(presentation.Tags["codec"], "vp9") || containsString(presentation.Tags["codec"], "VP9") {
		t.Fatal(presentation, err)
	}
	results, err := store.Query(url.Values{"service": {"radarr"}, "codec": {"vp9"}}, "matches", false)
	if err != nil || results.Total != 1 || results.Files[0].Codec != "vp9" {
		t.Fatal(results, err)
	}
	// The new read-only endpoint remains behind normal authentication.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, err := NewServer(ctx, store, nil, "test")
	if err != nil {
		t.Fatal(err)
	}
	defer server.Sync.Shutdown()
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/tag-presentation", nil))
	if w.Code != http.StatusUnauthorized {
		t.Fatal("presentation bypassed login", w.Code)
	}
}
func TestPresentationLabelPriority101(t *testing.T) {
	rules := []RecognitionRule{
		{ID: "first", Field: "codec", Value: "VP9", Mode: "direct", Enabled: true},
		{ID: "second", Field: "codec", Value: "Vp9", Mode: "direct", Enabled: true},
		{ID: "disabled", Field: "codec", Value: "vP9", Mode: "override"},
		{ID: "dynamic", Field: "codec", Value: "$1", Mode: "override", Enabled: true},
		{ID: "language", Field: "language", Value: "ger", Mode: "direct", Enabled: true},
	}
	if got := ruleDisplayLabels(rules); got["codec:vp9"] != "VP9" || len(got) != 1 {
		t.Fatal(got)
	}
	rules = append(rules, RecognitionRule{ID: "override", Field: "codec", Value: "Vp9", Mode: "override", Enabled: true})
	if got := ruleDisplayLabels(rules); got["codec:vp9"] != "Vp9" {
		t.Fatal(got)
	}
}
func TestSDPreferencesUpgrade101(t *testing.T) {
	cfg := DefaultSettings()
	if cfg.GroupSD == nil || !*cfg.GroupSD || cfg.GroupSDLists {
		t.Fatal("incorrect defaults")
	}
	cfg.GroupSD = nil
	cfg.GroupSDLists = true
	if err := normalizeSettings(&cfg); err != nil || cfg.GroupSD == nil || !*cfg.GroupSD || !cfg.GroupSDLists {
		t.Fatal(cfg, err)
	}
	off := false
	cfg.GroupSD = &off
	if err := normalizeSettings(&cfg); err != nil || cfg.GroupSDLists {
		t.Fatal("dependency not enforced", cfg, err)
	}
	raw, _ := json.Marshal(cfg)
	var restored Settings
	json.Unmarshal(raw, &restored)
	if err := normalizeSettings(&restored); err != nil || restored.GroupSD == nil || *restored.GroupSD {
		t.Fatal("explicit false lost", restored, err)
	}
	store := testStore(t)
	cfg.GroupSD = nil
	store.Put("settings", cfg)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, err := NewServer(ctx, store, nil, "test")
	if err != nil {
		t.Fatal(err)
	}
	defer server.Sync.Shutdown()
	if loaded := server.Config(); loaded.GroupSD == nil || !*loaded.GroupSD || loaded.GroupSDLists {
		t.Fatal("legacy upgrade", loaded)
	}
}
func TestSDVirtualFilterBothLibraries101(t *testing.T) {
	for _, service := range []string{"radarr", "sonarr"} {
		t.Run(service, func(t *testing.T) {
			store := testStore(t)
			resolutions := []string{"480p", "576p", "244p", "480i", "576P", "720p", "1080p", "", "4K", "bad", "0p", "576x244p"}
			files := []File{}
			for i, resolution := range resolutions {
				f := sample(i+1, "Example.mkv")
				f.Resolution = resolution
				f.APIInfo = nil
				f.Evidence = nil
				files = append(files, f)
			}
			if err := store.Replace(service, files, SyncStatus{}); err != nil {
				t.Fatal(err)
			}
			for _, tc := range []struct {
				values []string
				op     string
				want   int
			}{
				{[]string{"__sd__"}, "eq", 5},
				{[]string{"__sd__"}, "not", 7},
				{[]string{"__sd__", "720p"}, "eq", 6},
				{[]string{"__sd__", "__unknown__"}, "eq", 6},
				{[]string{"__sd__", "480p"}, "eq", 5},
				{[]string{"480p"}, "eq", 1},
				{[]string{"__sd__", "720p"}, "not", 6},
			} {
				q := url.Values{"service": {service}, "resolution": tc.values, "resolutionOp": {tc.op}}
				result, err := store.Query(q, "matches", false)
				if err != nil || result.Total != tc.want {
					t.Fatal(tc, result.Total, err)
				}
				for _, f := range result.Files {
					if f.Resolution == "__sd__" {
						t.Fatal("virtual group replaced stored data")
					}
				}
			}
		})
	}
}

func TestTagCatalogMediaServerProvenance101(t *testing.T) {
	ctx := context.Background()
	store := testStore(t)
	rules := store.Recognition()
	rules.Rules = append(rules.Rules, RecognitionRule{ID: "my-vp9", Name: "Codec / VP9", Field: "codec", Match: "token", Pattern: "vp9", Value: "VP9", Mode: "direct", Priority: 95, Enabled: true})
	if _, err := store.SaveRecognition(ctx, rules.Rules, rules.Revision); err != nil {
		t.Fatal(err)
	}
	f := sample(1, "Metadata.mkv")
	f.RecognitionRevision = store.Recognition().Revision
	f.APIInfo = nil
	f.Codec = "vp9"
	f.Audio = "DTS + AC-3"
	f.HDR = "HDR10 + Dolby Vision"
	f.Evidence = map[string]Evidence{
		"codec":  {Emby: "vp9", Origin: "mediaServer"},
		"audio":  {Emby: "DTS + AC-3", Origin: "mediaServer"},
		"hdr":    {Emby: "HDR10", Origin: "combined"},
		"source": {Emby: "BluRay", Origin: "filename"},
	}
	if err := store.Replace("radarr", []File{f}, SyncStatus{}); err != nil {
		t.Fatal(err)
	}
	rows, err := store.TagCatalog(ctx)
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]CatalogTag{}
	for _, row := range rows {
		found[row.Field+":"+row.Value] = row
	}
	for _, key := range []string{"codec:vp9", "audio:DTS", "audio:AC-3", "hdr:HDR10"} {
		if !found[key].MediaServer {
			t.Fatal("missing metadata provenance", key, found[key])
		}
	}
	for _, key := range []string{"source:BluRay", "codec:x264", "codec:__unknown__"} {
		if found[key].MediaServer {
			t.Fatal("false metadata provenance", key, found[key])
		}
	}
	// A later snapshot must invalidate provenance along with the counts.
	f.Evidence["codec"] = Evidence{API: "vp9", Origin: "api"}
	if err := store.Replace("radarr", []File{f}, SyncStatus{}); err != nil {
		t.Fatal(err)
	}
	rows, err = store.TagCatalog(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		if row.Field == "codec" && row.Value == "vp9" && row.MediaServer {
			t.Fatal("stale metadata provenance")
		}
	}
}
