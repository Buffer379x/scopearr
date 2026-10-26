package app

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestMediaInfoFixtures160(t *testing.T) {
	for _, tc := range []struct {
		name, resolution, codec, depth, hdr, audio, channels, language string
		ambiguous                                                      bool
	}{
		{"avc", "1080p", "x264", "8", "", "AC-3 + DTS-HD MA", "2.0 + 5.1", "Deutsch, Englisch", false},
		{"hevc", "2160p", "x265", "10", "Dolby Vision + HDR10", "TrueHD", "7.1", "Englisch", false},
		{"interlaced", "1080i", "MPEG-2", "8", "", "", "", "", false},
		{"xvid", "576p", "XviD", "8", "", "MP3", "2.0", "Englisch", false},
		{"ambiguous", "", "", "", "", "", "", "", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw, err := os.ReadFile("testdata/mediainfo/" + tc.name + ".json")
			if err != nil {
				t.Fatal(err)
			}
			result, err := parseMediaInfo(raw)
			if err != nil {
				t.Fatal(err)
			}
			m := result.metadata()
			if m.ambiguous != tc.ambiguous {
				t.Fatalf("ambiguous=%v", m.ambiguous)
			}
			if !tc.ambiguous && (m.video == nil || m.video.Resolution != tc.resolution || m.video.Codec != tc.codec || m.video.BitDepth != tc.depth || m.hdr != tc.hdr || m.audio != tc.audio || mediaChannels(m.tracks) != tc.channels || m.language != tc.language) {
				t.Fatalf("metadata=%+v video=%+v tracks=%+v", m, m.video, m.tracks)
			}
			saved, _ := json.Marshal(result)
			if len(saved) > 64<<10 || strings.Contains(string(saved), "/private/") {
				t.Fatalf("unsafe persisted output: %s", saved)
			}
			var restored mediaInfoResult
			if err := json.Unmarshal(saved, &restored); err != nil {
				t.Fatal(err)
			}
			if restored.metadata().ambiguous != m.ambiguous || restored.metadata().audio != m.audio {
				t.Fatal("result lost persisted metadata")
			}
		})
	}
}

func TestMediaInfoInvalidAndBounded160(t *testing.T) {
	for _, raw := range []string{"", "{", `{}`, `{"media":{"track":[]}}`, `{"media":{"track":[{"@type":"Video","Width":"NaN"}]}}`, `{"media":{"track":[]}} {}`} {
		if _, err := parseMediaInfo([]byte(raw)); err == nil {
			t.Fatalf("accepted invalid result %q", raw)
		}
	}
	raw := `{"media":{"track":[{"@type":"Video","Format":"UnknownCodec","Width":"1920","Height":"1080","Title":"` + strings.Repeat("x", 100000) + `"},{"@type":"Audio","Format":"UnknownAudio","Channels":"6"}]}}`
	r, e := parseMediaInfo([]byte(raw))
	if e != nil {
		t.Fatal(e)
	}
	if r.Video.Codec != "" || r.Audio != "" || mediaChannels(r.AudioTracks) != "6 ch" {
		t.Fatalf("guessed metadata %+v", r)
	}
	saved, _ := json.Marshal(r)
	if len(saved) > 64<<10 {
		t.Fatalf("saved %d bytes", len(saved))
	}
}

func TestMediaInfoSignedPackageArgs160(t *testing.T) {
	got := strings.Join(apkToolArgs("/root", "/cache", "v3.24", mediainfoSpec.Package), " ")
	for _, want := range []string{"--root /root", "--keys-dir /etc/apk/keys", "--usermode", "--no-scripts", "/v3.24/community", "--cache-dir /cache mediainfo"} {
		if !strings.Contains(got, want) {
			t.Fatalf("missing %q in %q", want, got)
		}
	}
	if strings.Contains(got, "--allow-untrusted") {
		t.Fatal("unsigned packages allowed")
	}
}

func TestMediaInfoDefaultTrackAndExplicitFormats160(t *testing.T) {
	for _, tc := range []struct{ video, audio, wantCodec, wantAudio, wantHDR string }{
		{`"Format":"AV1","HDR_Format":"HDR10+"`, `"Format":"DTS","Format_AdditionalFeatures":"XBR"`, "AV1", "DTS-HD", "HDR10+"},
		{`"Format":"VC-1","transfer_characteristics":"HLG"`, `"Format":"E-AC-3"`, "VC-1", "E-AC-3", "HLG"},
		{`"Format":"MPEG-4 Visual","CodecID":"DX50","transfer_characteristics":"PQ"`, `"Format":"AAC"`, "DivX", "AAC", "HDR"},
		{`"Format":"HEVC","Encoded_Library_Name":"x264"`, `"Format":"FLAC"`, "HEVC", "FLAC", ""},
	} {
		raw := `{"media":{"track":[{"@type":"Video","Format":"Unknown","Width":"720","Height":"576"},{"@type":"Video","Default":"Yes","Width":"1920","Height":"1080",` + tc.video + `},{"@type":"Audio",` + tc.audio + `}]}}`
		r, e := parseMediaInfo([]byte(raw))
		if e != nil {
			t.Fatal(e)
		}
		if r.Ambiguous || r.Video == nil || r.Video.Codec != tc.wantCodec || r.Audio != tc.wantAudio || r.HDR != tc.wantHDR {
			t.Fatalf("unexpected explicit format: %+v video=%+v", r, r.Video)
		}
	}
}

func TestMediaInfoNeverPersistsMetadataPaths160(t *testing.T) {
	raw := `{"media":{"@ref":"/private/input.mkv","track":[{"@type":"General","FileName":"C:\\private\\input","CompleteName":"/private/input.mkv","Encoded_Application":"/private/encoder","Title":"/private/title","Format_Profile":"encoded at /private/profile"},{"@type":"Audio","Format":"AAC","Language":"/private/language"}]}}`
	r, e := parseMediaInfo([]byte(raw))
	if e != nil {
		t.Fatal(e)
	}
	saved, _ := json.Marshal(r)
	if strings.Contains(string(saved), "private") || strings.Contains(string(saved), "C:") {
		t.Fatalf("persisted a path: %s", saved)
	}
}

func TestMediaInfoRealCLIOutput160(t *testing.T) {
	raw, e := os.ReadFile("testdata/mediainfo/pcm-cli-25.09.json")
	if e != nil {
		t.Fatal(e)
	}
	r, e := parseMediaInfo(raw)
	if e != nil {
		t.Fatal(e)
	}
	if r.Video != nil || r.Audio != "PCM" || len(r.AudioTracks) != 1 || r.AudioTracks[0].Channels != 1 || mediaChannels(r.AudioTracks) != "1 ch" {
		t.Fatalf("real PCM output: %+v", r)
	}
	saved, _ := json.Marshal(r)
	if strings.Contains(string(saved), "/fixture.wav") {
		t.Fatalf("source path retained: %s", saved)
	}
}
