package app

import (
	"encoding/json"
	"fmt"
	"testing"
)

func TestMediaResolutionTolerance150(t *testing.T) {
	for _, tc := range []struct {
		w, h int
		i    bool
		want string
	}{
		{1912, 796, false, "1080p"}, {1916, 800, false, "1080p"}, {1904, 1036, false, "1080p"},
		{3832, 1600, false, "2160p"}, {3836, 2072, false, "2160p"}, {3816, 1592, false, "2160p"},
		{2556, 1066, false, "1440p"}, {1272, 532, false, "720p"}, {1276, 688, false, "720p"},
		{1920, 800, false, "1080p"}, {3840, 1600, false, "2160p"}, {1440, 1080, true, "1080i"},
		{720, 576, false, "576p"}, {720, 544, false, "544p"}, {640, 480, false, "480p"},
		{1280, 536, false, "720p"}, {576, 244, false, "244p"}, {0, 1080, false, ""}, {1920, 0, false, ""},
		{-1, 1080, false, ""}, {1920, -1, true, ""}, {0, 0, false, ""},
		{2048, 858, false, "1080p"}, {4096, 1716, false, "2160p"}, {1912, 796, true, "1080i"},
		{7680, 3200, false, "4320p"},
		// Both axes classify independently, and the first matching tier wins.
		{7599, 1, false, "2160p"}, {7600, 1, false, "4320p"}, {7601, 1, false, "4320p"},
		{1, 4199, false, "2160p"}, {1, 4200, false, "4320p"}, {1, 4201, false, "4320p"},
		{3799, 1, false, "1440p"}, {3800, 1, false, "2160p"}, {3801, 1, false, "2160p"},
		{1, 1999, false, "1440p"}, {1, 2000, false, "2160p"}, {1, 2001, false, "2160p"},
		{2499, 1, false, "1080p"}, {2500, 1, false, "1440p"}, {2501, 1, false, "1440p"},
		{1, 1399, false, "1080p"}, {1, 1400, false, "1440p"}, {1, 1401, false, "1440p"},
		{1899, 1, false, "720p"}, {1900, 1, false, "1080p"}, {1901, 1, false, "1080p"},
		{1, 999, false, "720p"}, {1, 1000, false, "1080p"}, {1, 1001, false, "1080p"},
		{1259, 1, false, "1p"}, {1260, 1, false, "720p"}, {1261, 1, false, "720p"},
		{1, 699, false, "699p"}, {1, 700, false, "720p"}, {1, 701, false, "720p"},
		{7600, 2000, true, "4320i"}, {1900, 2000, false, "2160p"},
	} {
		t.Run(fmt.Sprintf("%dx%d_%t", tc.w, tc.h, tc.i), func(t *testing.T) {
			if got := mediaResolution(tc.w, tc.h, tc.i); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestMediaChannelLayout150(t *testing.T) {
	for _, tc := range []struct {
		layout   string
		channels int
		want     string
	}{
		{"5.1(side)", 6, "5.1"}, {"7.1(wide)", 8, "7.1"}, {"6.1(back)", 7, "6.1"}, {"5.0(side)", 5, "5.0"},
		{"quad", 4, "4.0"}, {"stereo", 2, "2.0"}, {"mono", 1, "1.0"}, {" 5.1(SIDE) ", 6, "5.1"},
		{"5.1", 6, "5.1"}, {"hexagonal", 6, "6 ch"}, {"", 6, "6 ch"}, {"", 0, ""},
		{"5.1()", 6, "6 ch"}, {"5.1(side)junk", 6, "6 ch"}, {"15.1(side)", 16, "16 ch"},
	} {
		t.Run(tc.layout+fmt.Sprint(tc.channels), func(t *testing.T) {
			if got := mediaChannelLayout(AudioTrack{ChannelLayout: tc.layout, Channels: tc.channels}); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestEmby1912NoConflict150(t *testing.T) {
	f := File{Filename: "2010.The.Year.We.Make.Contact.1984.1080p.BluRay.x264.mkv"}
	Enrich(&f, APIInfo{Quality: "Bluray-1080p", VideoCodec: "AVC"})
	applyEmby(&f, []embyStream{{Type: "Video", Width: 1912, Height: 796, Codec: "h264"}})
	if f.Resolution != "1080p" || f.Evidence["resolution"].Emby != "1080p" || f.Evidence["resolution"].Conflict || f.Conflict {
		t.Fatalf("false cropped-video disagreement: %+v", f)
	}
}

func TestCroppedHDIsNotSD150(t *testing.T) {
	f := File{Filename: "Movie.576p.mkv"}
	Enrich(&f, APIInfo{})
	applyEmby(&f, []embyStream{{Type: "Video", Width: 1272, Height: 532}})
	if !f.Evidence["resolution"].Conflict || f.Evidence["resolution"].Emby != "720p" || !f.Conflict {
		t.Fatalf("cropped 720p was treated as SD: %+v", f)
	}
}

func TestTwoMediaServersAgree150(t *testing.T) {
	for _, old := range []string{"", "720p"} {
		t.Run("stored_"+old, func(t *testing.T) {
			f := File{Filename: "Movie.1080p.BluRay.x264.mkv"}
			Enrich(&f, APIInfo{Quality: "Bluray-1080p"})
			for _, id := range []string{"emby", "jellyfin", "emby-secondary"} {
				video := &MediaVideo{Width: 1912, Height: 796, Resolution: old, Codec: "AVC"}
				if id == "jellyfin" {
					video.Resolution = "1080p"
				}
				f.setMediaMatch(id, MediaMatch{Status: "matched", Video: video, Tracks: []AudioTrack{{Codec: "AC-3", Language: "Englisch", Channels: 6, ChannelLayout: "5.1(side)"}}})
			}
			resolveMediaServers(&f)
			if f.EmbyMatch != "matched" || f.Resolution != "1080p" || f.Channels != "5.1" || f.Conflict {
				t.Fatalf("providers did not agree: %+v", f)
			}
			for _, id := range []string{"emby", "jellyfin", "emby-secondary"} {
				if got := f.MediaServers.get(id).Video.Resolution; got != "1080p" {
					t.Fatalf("%s retained %q", id, got)
				}
			}
		})
	}
}

func TestStoredMediaVideoNormalization150(t *testing.T) {
	f := File{Filename: "Movie.mkv"}
	Enrich(&f, APIInfo{})
	f.setMediaMatch("emby", MediaMatch{Status: "no_tracks", Video: &MediaVideo{Width: 1912, Height: 796, Resolution: "720i"}})
	f.setMediaMatch("jellyfin", MediaMatch{Status: "missing", Video: &MediaVideo{Width: 3832, Height: 1600, Resolution: "1440p"}})
	f.setMediaMatch("emby-unknown", MediaMatch{Status: "missing", Video: &MediaVideo{Width: 0, Height: 1080, Resolution: "720p"}})
	f.setMediaMatch("emby-no-video", MediaMatch{Status: "missing"})
	// Cached matches and their video pointers can be shared with a snapshot.
	shared := f
	resolveMediaServers(&f)
	if f.Resolution != "1080i" || f.MediaServers.get("jellyfin").Video.Resolution != "2160p" || f.MediaServers.get("emby-unknown").Video.Resolution != "720p" {
		t.Fatalf("stored video normalization: %+v", f)
	}
	if shared.MediaServers.Emby.Video.Resolution != "720i" || shared.MediaServers.Jellyfin.Video.Resolution != "1440p" {
		t.Fatal("normalization mutated shared snapshot metadata")
	}
	before, err := json.Marshal(f)
	if err != nil {
		t.Fatal(err)
	}
	resolveMediaServers(&f)
	after, err := json.Marshal(f)
	if err != nil || string(before) != string(after) {
		t.Fatal("normalization was not idempotent", err)
	}
}

func TestSourceCategory150(t *testing.T) {
	for _, tc := range []struct {
		filename, quality, source string
		conflict                  bool
	}{
		{"Movie.UHD.BluRay.mkv", "Bluray-2160p", "UHD", false},
		{"Movie.BDRip.mkv", "Bluray-1080p", "BDRip", false},
		{"Movie.BRRip.mkv", "Bluray-1080p", "BRRip", false},
		{"Movie.DVDRip.mkv", "DVD", "DVDRip", false},
		{"Movie.WEB-DL.mkv", "Bluray-1080p", "WEB-DL", true},
		{"Movie.WEBRip.mkv", "WEBDL-1080p", "WEBRip", true},
		{"Movie.BluRay.mkv", "Bluray-1080p", "BluRay", false},
	} {
		t.Run(tc.source+"_"+tc.quality, func(t *testing.T) {
			f := File{Filename: tc.filename}
			Enrich(&f, APIInfo{Quality: tc.quality})
			e := f.Evidence["source"]
			origin := "filename"
			if tc.source == "UHD" {
				origin = "rule"
			}
			if f.Source != tc.source || e.Filename != tc.source || e.Origin != origin || e.Conflict != tc.conflict || f.Conflict != tc.conflict {
				t.Fatalf("source category result: %+v", f)
			}
		})
	}
}

func TestCustomSourceRemainsStrict150(t *testing.T) {
	rules := append(DefaultRecognitionRules(), RecognitionRule{ID: "custom-source", Name: "Custom source", Field: "source", Match: "token", Pattern: "CUSTOM", Value: "UHD BluRay", Mode: "override", Enabled: true})
	engine, err := CompileRecognition(rules)
	if err != nil {
		t.Fatal(err)
	}
	f := File{Filename: "Movie.CUSTOM.mkv"}
	EnrichWithRules(&f, APIInfo{Quality: "Bluray-2160p"}, engine)
	if f.Source != "UHD BluRay" || !f.Conflict || !f.Evidence["source"].Conflict {
		t.Fatalf("custom source comparison was broadened: %+v", f)
	}
	// Category compatibility must never erase conflicting filename rules.
	engine, err = CompileRecognition([]RecognitionRule{
		{ID: "source-uhd", Name: "UHD", Field: "source", Match: "token", Pattern: "DISC", Value: "UHD", Mode: "direct", Enabled: true},
		{ID: "source-bluray", Name: "BluRay", Field: "source", Match: "token", Pattern: "DISC", Value: "BluRay", Mode: "direct", Enabled: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	f = File{Filename: "Movie.DISC.mkv"}
	EnrichWithRules(&f, APIInfo{Quality: "Bluray-2160p"}, engine)
	if !f.RuleConflict || len(f.RecognitionConflicts) != 1 {
		t.Fatalf("filename rule disagreement was hidden: %+v", f)
	}
}

func TestRecognitionRulesRollback150(t *testing.T) {
	raw, err := json.Marshal(DefaultRecognitionRules())
	if err != nil {
		t.Fatal(err)
	}
	var saved []RecognitionRule
	if err := json.Unmarshal(raw, &saved); err != nil {
		t.Fatal(err)
	}
	// 1.4.6 supports comparisonPattern only on audio rules. Keep that exact
	// restriction, so these persisted rules still compile after a rollback.
	for _, rule := range saved {
		if rule.Field != "audio" && rule.ComparisonPattern != "" {
			t.Fatalf("rule %s cannot be loaded by 1.4.6", rule.ID)
		}
	}
	if _, err := CompileRecognition(saved); err != nil {
		t.Fatal("persisted rules no longer compile", err)
	}
	invalid := RecognitionRule{ID: "source-compare", Name: "Source comparison", Field: "source", Match: "token", Pattern: "UHD", Value: "UHD", Mode: "direct", Enabled: true, ComparisonPattern: "BluRay"}
	if _, err := CompileRecognition(append(saved, invalid)); err == nil {
		t.Fatal("1.4.6 audio-only comparison validation was relaxed")
	}
}
