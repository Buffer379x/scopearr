package app

import "testing"

func TestAPIDifferenceIsInformation151(t *testing.T) {
	f := File{Filename: "Red.Alert.1990.1080i.mkv"}
	Enrich(&f, APIInfo{Quality: "HDTV-1080p"})
	f.setMediaMatch("emby", MediaMatch{Status: "no_tracks", Video: &MediaVideo{Width: 1920, Height: 1080, Resolution: "1080i"}})
	resolveMediaServers(&f)
	e := f.Evidence["resolution"]
	if f.Resolution != "1080i" || e.Conflict || !e.APIDiffers || f.Conflict {
		t.Fatalf("Arr difference should be information: %+v, %+v", f, e)
	}
}

func TestMediaServerConflictWarns151(t *testing.T) {
	f := File{Filename: "Movie.x265.mkv"}
	Enrich(&f, APIInfo{VideoCodec: "HEVC"})
	applyEmby(&f, []embyStream{{Type: "Video", Codec: "h264"}})
	e := f.Evidence["codec"]
	if f.Codec != "x265" || !e.Conflict || !f.Conflict || e.APIDiffers {
		t.Fatalf("filename/media disagreement lost: %+v", f)
	}
}

func TestNoMediaServerNoConflict151(t *testing.T) {
	for _, status := range []string{"", "missing", "unconfigured", "ambiguous", "pending"} {
		t.Run(status, func(t *testing.T) {
			f := File{Filename: "Movie.WEB-DL.mkv"}
			Enrich(&f, APIInfo{Quality: "Bluray-1080p"})
			if status != "" {
				f.setMediaMatch("emby", MediaMatch{Status: status})
				resolveMediaServers(&f)
			}
			e := f.Evidence["source"]
			if f.Source != "WEB-DL" || e.Conflict || f.Conflict || !e.APIDiffers {
				t.Fatalf("Arr alone warned: %+v", f)
			}
		})
	}
}

func TestMediaServerBeatsArrWithoutFilename151(t *testing.T) {
	f := File{Filename: "Movie.mkv"}
	Enrich(&f, APIInfo{Quality: "Bluray-1080p", VideoCodec: "HEVC", VideoBitDepth: 10, AudioChannels: 2})
	f.setMediaMatch("emby", MediaMatch{Status: "matched", Video: &MediaVideo{Width: 1920, Height: 1080, Resolution: "1080i", Codec: "AVC", BitDepth: "8"}, Tracks: []AudioTrack{{Codec: "AC-3", Channels: 6, ChannelLayout: "5.1"}}})
	resolveMediaServers(&f)
	if f.Resolution != "1080i" || f.Codec != "AVC" || f.Family != "H.264/AVC" || f.BitDepth != "8" || f.Channels != "5.1" || f.Source != "BluRay" || f.Conflict {
		t.Fatalf("media fallback did not win: %+v", f)
	}
	for _, field := range []string{"resolution", "codec", "bitDepth", "channels"} {
		e := f.Evidence[field]
		if e.Origin != "mediaServer" || e.Conflict || !e.APIDiffers {
			t.Fatalf("%s: %+v", field, e)
		}
	}
	// A reparse must replay the same precedence from retained provider data.
	resolveMediaServers(&f)
	if f.Resolution != "1080i" || f.Codec != "AVC" || f.BitDepth != "8" || f.Channels != "5.1" || f.Conflict {
		t.Fatalf("replay changed media values: %+v", f)
	}
}

func TestCategoryHintNotAPIDiff151(t *testing.T) {
	f := File{Filename: "Movie.UHD.BluRay.mkv"}
	Enrich(&f, APIInfo{Quality: "Bluray-2160p"})
	if f.Source != "UHD" || f.Conflict || f.Evidence["source"].APIDiffers {
		t.Fatal(f)
	}
}

func TestMediaChannelsFilenameConflict151(t *testing.T) {
	for _, tc := range []struct {
		filename, want       string
		conflict, apiDiffers bool
	}{
		{"Movie.2.0.mkv", "2.0", true, false},
		{"Movie.5.1.mkv", "5.1", false, true},
		{"Movie.7.1.mkv", "7.1", true, true},
	} {
		f := File{Filename: tc.filename}
		Enrich(&f, APIInfo{AudioChannels: 2})
		applyEmby(&f, []embyStream{{Type: "Audio", Index: 1, Codec: "ac3", Channels: 6, ChannelLayout: "5.1"}})
		e := f.Evidence["channels"]
		if f.Channels != tc.want || e.Conflict != tc.conflict || f.Conflict != tc.conflict || e.APIDiffers != tc.apiDiffers {
			t.Fatalf("channel evidence: %+v", f)
		}
	}
}

func TestCombinedLanguageAndPrimaryAudio151(t *testing.T) {
	f := File{Filename: "Movie.German.DTS.AC3.mkv"}
	Enrich(&f, APIInfo{AudioLanguages: "English", AudioCodec: "DTS"})
	if f.Language != "Deutsch, Englisch" || f.Evidence["language"].APIDiffers || f.Evidence["audio"].APIDiffers || f.Conflict {
		t.Fatalf("combined evidence falsely differs: %+v", f)
	}
	applyEmby(&f, []embyStream{{Type: "Audio", Index: 1, Codec: "aac", Language: "ger"}})
	if f.Language != "Deutsch" || !f.Evidence["language"].APIDiffers || f.Evidence["language"].Conflict || !f.Evidence["audio"].APIDiffers || !f.Evidence["audio"].Conflict || !f.Conflict {
		t.Fatalf("media evidence was not recomputed: %+v", f)
	}
}

func TestProviderDisagreementIsSeparate151(t *testing.T) {
	f := File{Filename: "Movie.1080i.x265.mkv"}
	Enrich(&f, APIInfo{Quality: "HDTV-1080p", VideoCodec: "HEVC"})
	f.setMediaMatch("emby", MediaMatch{Status: "no_tracks", Video: &MediaVideo{Resolution: "1080i", Codec: "HEVC"}})
	f.setMediaMatch("jellyfin", MediaMatch{Status: "no_tracks", Video: &MediaVideo{Resolution: "1080p", Codec: "AVC"}})
	resolveMediaServers(&f)
	if f.EmbyMatch != "conflicting" || f.Conflict || f.Resolution != "1080i" || !f.Evidence["resolution"].APIDiffers {
		t.Fatalf("provider disagreement leaked into filename warning: %+v", f)
	}
}
