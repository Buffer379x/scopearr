package app

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func confirmationFixture160(t *testing.T) (*Store, File) {
	t.Helper()
	s, e := OpenStore(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { s.DB.Close() })
	f := File{ID: 160, MediaID: 160, Service: "radarr", Title: "Megan 2.0", Filename: "Megan.2.0.2025.1080p.WEB-DL.mkv", Size: 1234, SourcePath: "/movies/Megan/Megan.2.0.2025.1080p.WEB-DL.mkv"}
	Enrich(&f, APIInfo{AudioCodec: "AC3", AudioChannels: 6})
	f.setMediaMatch("emby", MediaMatch{Status: "matched", Tracks: []AudioTrack{{Index: 1, Codec: "AC3", Channels: 6, ChannelLayout: "5.1", Language: "de"}}})
	resolveMediaServers(&f)
	if !f.Conflict {
		t.Fatal("fixture must disagree", f.Evidence)
	}
	if e = s.Replace("radarr", []File{f}, SyncStatus{}); e != nil {
		t.Fatal(e)
	}
	return s, f
}
func TestManualConfirmationSurvivesSync160(t *testing.T) {
	s, f := confirmationFixture160(t)
	srv := &Server{Store: s, settings: DefaultSettings()}
	w := httptest.NewRecorder()
	srv.confirmationHTTP(w, httptest.NewRequest("PUT", "/api/files/confirmation", strings.NewReader(`{"service":"radarr","fileId":160,"field":"channels","source":"mediaServer"}`)))
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var got File
	if e := json.Unmarshal(w.Body.Bytes(), &got); e != nil {
		t.Fatal(e)
	}
	if got.Channels != "5.1" || got.Conflict || !got.Confirmed || got.Evidence["channels"].Confirmed.Source != "mediaServer" {
		t.Fatal(got)
	}
	if e := s.Replace("radarr", []File{f}, SyncStatus{}); e != nil {
		t.Fatal(e)
	}
	got, e := s.muxFile("radarr", 160)
	if e != nil || got.Channels != "5.1" || got.Conflict || !got.Confirmed {
		t.Fatal(got, e)
	}
	page, e := s.QueryContext(context.Background(), url.Values{"service": {"radarr"}, "confirmed": {"true"}}, "all", false)
	if e != nil || page.Total != 1 {
		t.Fatal(page, e)
	}
	w = httptest.NewRecorder()
	srv.confirmationHTTP(w, httptest.NewRequest("DELETE", "/api/files/confirmation?service=radarr&fileId=160&field=channels", nil))
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	got, e = s.muxFile("radarr", 160)
	if e != nil || !got.Conflict || got.Confirmed {
		t.Fatal(got, e)
	}
}
func TestConfirmationInvalidation160(t *testing.T) {
	s, f := confirmationFixture160(t)
	if _, e := s.DB.Exec("INSERT INTO field_confirmations VALUES(?,?,?,?,?,?,?)", "radarr", 160, "channels", "mediaServer", "5.1", f.Size, 123); e != nil {
		t.Fatal(e)
	}
	f.Size++
	if e := s.Replace("radarr", []File{f}, SyncStatus{}); e != nil {
		t.Fatal(e)
	}
	values, e := s.fieldConfirmations(context.Background(), "radarr")
	if e != nil || len(values) != 0 {
		t.Fatal(values, e)
	}
}
func TestConfirmationMissingSource160(t *testing.T) {
	s, _ := confirmationFixture160(t)
	srv := &Server{Store: s, settings: DefaultSettings()}
	w := httptest.NewRecorder()
	srv.confirmationHTTP(w, httptest.NewRequest("PUT", "/api/files/confirmation", strings.NewReader(`{"service":"radarr","fileId":160,"field":"source","source":"mediaServer"}`)))
	if w.Code != 400 {
		t.Fatal(w.Code, w.Body.String())
	}
	srv.Demo = true
	w = httptest.NewRecorder()
	srv.confirmationHTTP(w, httptest.NewRequest("DELETE", "/api/files/confirmation?service=radarr&fileId=160&field=channels", nil))
	if w.Code != 403 {
		t.Fatal(w.Code)
	}
}

func TestMediaInfoEvidenceAndLifecycle160(t *testing.T) {
	s, f := confirmationFixture160(t)
	// A measurement that confirms the filename wins over stale media-server channels.
	measured := MediaInfoResult{mediaInfoResult: mediaInfoResult{Audio: "AC3", Language: "Deutsch", AudioTracks: []AudioTrack{{Index: 1, Codec: "AC3", Language: "Deutsch", Channels: 2, ChannelLayout: "2.0"}}}, ScannedAt: 123, Version: "26.10"}
	if err := s.saveMediaInfo(context.Background(), f, measured, false); err != nil {
		t.Fatal(err)
	}
	got, err := s.muxFile("radarr", 160)
	if err != nil || got.Conflict || got.Evidence["channels"].MediaInfo != "2.0" || !got.Evidence["channels"].MediaServerDiffers {
		t.Fatal(got, err)
	}
	if err = s.Replace("radarr", []File{f}, SyncStatus{}); err != nil {
		t.Fatal(err)
	}
	got, _ = s.muxFile("radarr", 160)
	if got.MediaInfo == nil || got.Conflict {
		t.Fatal(got)
	}
	f.SourcePath = "/movies/Megan/renamed.mkv"
	if err = s.renameMediaInfo(context.Background(), "radarr", 160, f.SourcePath); err != nil {
		t.Fatal(err)
	}
	if err = s.Replace("radarr", []File{f}, SyncStatus{}); err != nil {
		t.Fatal(err)
	}
	got, _ = s.muxFile("radarr", 160)
	if got.MediaInfo == nil {
		t.Fatal("rename discarded measurement")
	}
	f.Size++
	if err = s.Replace("radarr", []File{f}, SyncStatus{}); err != nil {
		t.Fatal(err)
	}
	var n int
	if err = s.DB.QueryRow("SELECT count(*) FROM mediainfo_results").Scan(&n); err != nil || n != 0 {
		t.Fatal(n, err)
	}
}

func TestMediaInfoCountOnlyChannels160(t *testing.T) {
	f := File{Filename: "Count.5.1.1080p.mkv"}
	Enrich(&f, APIInfo{})
	applyEmby(&f, []embyStream{{Type: "Audio", Codec: "ac3", Channels: 6, ChannelLayout: "5.1"}})
	applyMediaInfo(&f, mediaInfoResult{Audio: "AC-3", AudioTracks: []AudioTrack{{Index: 1, Codec: "AC-3", Channels: 6}}})
	if e := f.Evidence["channels"]; e.Conflict || e.MediaServerDiffers {
		t.Fatal("count-only channels must not invent an LFE disagreement", e)
	}
}

func TestMetadataCleanupWithService160(t *testing.T) {
	s, f := confirmationFixture160(t)
	if _, err := s.DB.Exec("INSERT INTO field_confirmations VALUES(?,?,?,?,?,?,?)", f.Service, f.ID, "channels", "mediaServer", "5.1", f.Size, 123); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec("INSERT INTO mediainfo_results VALUES(?,?,?,?,?,?,?)", f.Service, f.ID, f.SourcePath, f.Size, 123, "26.10", `{}`); err != nil {
		t.Fatal(err)
	}
	old := DefaultSettings()
	old.Instances = []ServiceConfig{{ID: "radarr", Type: "radarr", Enabled: true}}
	next := old
	next.Instances = []ServiceConfig{}
	if err := s.saveSettingsWithAllTagPolicies(context.Background(), next, old, next, nil); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"field_confirmations", "mediainfo_results"} {
		var n int
		if err := s.DB.QueryRow("SELECT count(*) FROM " + table).Scan(&n); err != nil || n != 0 {
			t.Fatal(table, n, err)
		}
	}
}
