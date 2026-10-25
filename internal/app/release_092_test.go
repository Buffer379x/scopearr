package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestMediaVideoFallback092(t *testing.T) {
	// Reconstructed from the metadata visible in Emby for the reported AVI.
	var streams []embyStream
	if err := json.Unmarshal([]byte(`[{"Type":"Video","Index":0,"Width":576,"Height":244,"Codec":"mpeg4","CodecTag":"XVID","BitDepth":8},{"Type":"Audio","Index":1,"Codec":"mp3","Channels":2,"ChannelLayout":"stereo"}]`), &streams); err != nil {
		t.Fatal(err)
	}
	f := File{Filename: "Sechs Tage, Sieben Nächte.avi"}
	Enrich(&f, APIInfo{})
	parsed := parseEmbyMetadata(streams)
	f.setMediaMatch("emby", MediaMatch{Status: "matched", Tracks: parsed.tracks, Video: parsed.video})
	resolveMediaServers(&f)
	if f.Resolution != "244p" || f.Codec != "XviD" || f.Family != "MPEG-4 Part 2" || f.BitDepth != "8" || f.Audio != "MP3" || f.Channels != "2.0" || f.Source != "" || f.Language != "" {
		t.Fatalf("%+v", f)
	}
	for _, field := range []string{"resolution", "codec", "bitDepth", "channels"} {
		if f.Evidence[field].Origin != "mediaServer" || f.Evidence[field].Emby == "" {
			t.Fatal(field, f.Evidence)
		}
	}
	if f.MediaServers.Emby.Video.Width != 576 || f.MediaServers.Emby.Video.Height != 244 {
		t.Fatal(f.MediaServers)
	}
	engine, err := CompileRecognition(append(defaultRecognitionEngine.Config().Rules, RecognitionRule{ID: "test-rule", Name: "test", Field: "source", Match: "token", Pattern: "missing-token", Value: "DVD", Mode: "direct", Enabled: true}))
	if err != nil {
		t.Fatal(err)
	}
	reparseFile(&f, engine)
	if f.Resolution != "244p" || f.Codec != "XviD" || f.Evidence["codec"].API != "" || f.Evidence["codec"].Origin != "mediaServer" {
		t.Fatal(f)
	}
}

func TestMediaVideoResolutionAndPriority092(t *testing.T) {
	for _, tc := range []struct {
		w, h int
		i    bool
		want string
	}{{1920, 800, false, "1080p"}, {3840, 1600, false, "2160p"}, {1440, 1080, true, "1080i"}, {720, 576, false, "576p"}, {720, 544, false, "544p"}, {640, 480, false, "480p"}, {1280, 536, false, "720p"}, {0, 1080, false, ""}, {1920, 0, false, ""}, {576, 244, false, "244p"}} {
		if got := mediaResolution(tc.w, tc.h, tc.i); got != tc.want {
			t.Fatalf("%+v: %s", tc, got)
		}
	}
	f := File{Filename: "Movie.1080p.x264.mkv"}
	Enrich(&f, APIInfo{VideoCodec: "AVC"})
	applyEmby(&f, []embyStream{{Type: "Video", Width: 1920, Height: 800, Codec: "h264", BitDepth: 8}})
	if f.Codec != "x264" || f.Conflict || f.Evidence["codec"].Origin != "filename" {
		t.Fatal(f)
	}
	applyEmby(&f, []embyStream{{Type: "Video", Width: 3840, Height: 1600, Codec: "hevc", BitDepth: 10}})
	if f.Codec != "x264" || f.Resolution != "1080p" || !f.Conflict {
		t.Fatal(f)
	}
	f = File{Filename: "Movie.480p.XviD.mkv"}
	Enrich(&f, APIInfo{})
	applyEmby(&f, []embyStream{{Type: "Video", Width: 576, Height: 244, Codec: "mpeg4", CodecTag: "XVID"}})
	if f.Resolution != "480p" || f.Conflict || f.Evidence["resolution"].Emby != "244p" {
		t.Fatal("cropped SD produced a false conflict", f)
	}
	f = File{Filename: "Movie.mkv"}
	Enrich(&f, APIInfo{Quality: "Bluray-720p", VideoCodec: "AVC"})
	applyEmby(&f, []embyStream{{Type: "Video", Width: 1920, Height: 1080, Codec: "h264"}})
	if f.Resolution != "1080p" || f.Evidence["resolution"].Origin != "emby" || f.Evidence["resolution"].Conflict || f.Conflict || !f.Evidence["resolution"].APIDiffers {
		t.Fatal(f)
	}
}

func TestMediaVideoSelectionAndConsensus092(t *testing.T) {
	streams := []embyStream{{Type: "Video", Width: 1920, Height: 800, Codec: "h264", IsDefault: true}, {Type: "Video", Width: 3840, Height: 2160, Codec: "hevc", VideoRangeType: "HDR10"}, {Type: "Video", Width: 7680, Height: 4320, Codec: "av1", IsExternal: true}}
	m := parseEmbyMetadata(streams)
	if m.ambiguous || m.video.Resolution != "1080p" || m.hdr != "" {
		t.Fatal(m)
	}
	streams[0].IsDefault = false
	if !parseEmbyMetadata(streams).ambiguous {
		t.Fatal("multiple video streams guessed")
	}
	f := File{Filename: "Movie.mkv"}
	Enrich(&f, APIInfo{})
	f.MediaServers = &MediaMatches{Emby: &MediaMatch{Status: "no_tracks", Video: &MediaVideo{Resolution: "1080p", Codec: "AVC"}}, Jellyfin: &MediaMatch{Status: "matched", Tracks: []AudioTrack{{Index: 1, Codec: "AAC", Language: "Englisch"}}, Video: &MediaVideo{Resolution: "1080p", Codec: "AVC", BitDepth: "8"}}}
	resolveMediaServers(&f)
	if f.EmbyMatch != "matched" || f.Codec != "AVC" || f.BitDepth != "8" || f.Audio != "AAC" {
		t.Fatal(f)
	}
	f.MediaServers.Jellyfin.Video.Codec = "HEVC"
	resolveMediaServers(&f)
	if f.EmbyMatch != "conflicting" || f.Codec != "" || len(f.AudioTracks) != 0 {
		t.Fatal("provider conflict guessed", f)
	}
	f.MediaServers.Jellyfin = &MediaMatch{Status: "missing"}
	resolveMediaServers(&f)
	if f.EmbyMatch != "no_tracks" || f.Resolution != "1080p" || f.Codec != "AVC" {
		t.Fatal("video-only metadata lost", f)
	}
}

func TestMediaVideoReadOnlyCache092(t *testing.T) {
	for _, provider := range []string{"emby", "jellyfin"} {
		t.Run(provider, func(t *testing.T) {
			calls := 0
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.Method != "GET" || (r.URL.Path != "/emby/Items" && r.URL.Path != "/Items") {
					t.Error("unexpected request", r.Method, r.URL.Path)
				}
				w.Header().Set("Content-Type", "application/json")
				w.Write([]byte(`{"TotalRecordCount":1,"Items":[{"Id":"1","Type":"Movie","Path":"/media/Movie.mkv","Size":1234,"MediaStreams":[{"Type":"Video","Width":1920,"Height":800,"Codec":"h264","BitDepth":8}]}]}`))
			}))
			defer upstream.Close()
			f := File{ID: 1, MediaID: 1, Service: "radarr", Filename: "Movie.mkv", Size: 1234}
			Enrich(&f, APIInfo{})
			client := NewEmby(ServiceConfig{URL: upstream.URL})
			if provider == "jellyfin" {
				client = NewJellyfin(ServiceConfig{URL: upstream.URL})
			}
			files := []File{f}
			if err := client.Enrich(context.Background(), "radarr", files); err != nil {
				t.Fatal(err)
			}
			store := testStore(t)
			if err := store.Replace("radarr", files, SyncStatus{}); err != nil {
				t.Fatal(err)
			}
			result, err := store.Query(url.Values{"service": {"radarr"}, "resolution": {"1080p"}, "codec": {"AVC"}}, "matches", false)
			if err != nil || result.Total != 1 || result.Files[0].EmbyMatch != "no_tracks" || result.Files[0].MediaServers.get(provider).Video.BitDepth != "8" || calls != 1 {
				t.Fatal(result, err, calls)
			}
			stats, err := store.Statistics()
			if err != nil || stats.Emby["no_tracks"] != 1 {
				t.Fatal(stats, err)
			}
		})
	}
}

func TestMediaPoolPreservesExactTrackMetadata092(t *testing.T) {
	pool := newMediaPool()
	first := pool.intern(MediaMatch{Video: &MediaVideo{Width: 1920, Height: 800, Codec: "AVC"}, Tracks: []AudioTrack{{Index: 1, Codec: "DTS", Language: "Deutsch", Title: "Main"}}})
	same := pool.intern(MediaMatch{Video: &MediaVideo{Width: 1920, Height: 800, Codec: "AVC"}, Tracks: []AudioTrack{{Index: 1, Codec: "DTS", Language: "Deutsch", Title: "Main"}}})
	if first.Video != same.Video || &first.Tracks[0] != &same.Tracks[0] {
		t.Fatal("equal immutable values duplicated")
	}
	other := pool.intern(MediaMatch{Video: &MediaVideo{Width: 3840, Height: 1600, Codec: "HEVC"}, Tracks: []AudioTrack{{Index: 1, Codec: "DTS", Language: "Deutsch", Title: "Commentary"}}})
	if first.Video == other.Video || &first.Tracks[0] == &other.Tracks[0] || first.Tracks[0].Title != "Main" {
		t.Fatal("distinct metadata aliased")
	}
}
