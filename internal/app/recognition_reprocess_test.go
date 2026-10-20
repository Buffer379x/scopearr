package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func reprocessMediaFixture() File {
	f := sample(1, "Movie.2020.1080p.WEB-DL.x264.mkv")
	Enrich(&f, APIInfo{VideoCodec: "AVC", Quality: "WEBDL-1080p"})
	for _, id := range []string{"emby-home", "jellyfin-home"} {
		f.setMediaMatch(id, MediaMatch{Status: "matched", ItemID: id, SourceID: "source", ItemType: "Movie", Video: &MediaVideo{Width: 1920, Height: 800, Codec: "AVC", BitDepth: "8"}, Tracks: []AudioTrack{{Index: 1, Language: "German", Codec: "DTS", Channels: 6, ChannelLayout: "5.1"}, {Index: 2, Language: "English", Codec: "AC-3", Channels: 6, ChannelLayout: "5.1"}}})
	}
	resolveMediaServers(&f)
	return f
}

func TestRecognitionReprocessPreservesNamedMedia(t *testing.T) {
	for _, withoutAPI := range []bool{false, true} {
		t.Run(map[bool]string{false: "api", true: "legacy-evidence"}[withoutAPI], func(t *testing.T) {
			store := testStore(t)
			f := reprocessMediaFixture()
			if withoutAPI {
				f.APIInfo = nil
			}
			if err := store.Replace("radarr-home", []File{f}, SyncStatus{}); err != nil {
				t.Fatal(err)
			}
			before := store.Recognition()
			rules := append(before.Rules, customRule("override-source", "source", "WEB-DL", "UHD", "override", 1))
			after, err := store.SaveRecognition(context.Background(), rules, before.Revision)
			if err != nil {
				t.Fatal(err)
			}
			var raw string
			if err = store.DB.QueryRow("SELECT data FROM files WHERE service='radarr-home'").Scan(&raw); err != nil {
				t.Fatal(err)
			}
			var actual File
			if err = json.Unmarshal([]byte(raw), &actual); err != nil {
				t.Fatal(err)
			}
			if actual.Source != "UHD" || actual.RecognitionRevision != after.Revision || actual.EmbyMatch != "matched" || len(actual.AudioTracks) != 2 || actual.Evidence["codec"].Emby != "AVC" {
				t.Fatal(actual)
			}
			for _, id := range []string{"emby-home", "jellyfin-home"} {
				match := actual.MediaServers.get(id)
				if match == nil || match.ItemID != id || match.SourceID != "source" || match.Video.Width != 1920 {
					t.Fatal(actual.MediaServers)
				}
			}
		})
	}
}
func BenchmarkRecognitionReprocessNamedMedia(b *testing.B) {
	fixture := reprocessMediaFixture()
	engine, err := CompileRecognition(append(defaultRecognitionEngine.Config().Rules, customRule("override-source", "source", "WEB-DL", "UHD", "override", 1)))
	if err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		f := fixture
		reparseFile(&f, engine)
	}
}

func TestRecognitionHTTPDeadlinePreservesRules(t *testing.T) {
	s := &Server{Store: testStore(t), Sync: &Syncer{gate: make(chan struct{}, 1)}}
	before := s.Store.Recognition()
	conn, err := s.Store.DB.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	s.Store.DB.SetMaxOpenConns(1)
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	body, _ := json.Marshal(map[string]any{"rules": append(before.Rules, customRule("override-source", "source", "WEB-DL", "UHD", "override", 1)), "revision": before.Revision})
	request := httptest.NewRequest("PUT", "/api/recognition", bytes.NewReader(body)).WithContext(ctx)
	response := httptest.NewRecorder()
	s.recognitionHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "Previous rules and files are unchanged") {
		t.Fatal(response.Code, response.Body.String())
	}
	if s.Store.RecognitionRevision() != before.Revision {
		t.Fatal("timed-out request published rules")
	}
}
