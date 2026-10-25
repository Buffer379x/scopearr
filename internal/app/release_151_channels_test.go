package app

import "testing"

func TestUnknownMeasuredChannelLayout151(t *testing.T) {
	for _, tc := range []struct {
		filename, layout string
		conflict         bool
	}{
		{"Movie.5.1.mkv", "", false},
		{"Movie.2.0.mkv", "", true},
		{"Movie.5.1.mkv", "6.0", true},
	} {
		f := File{Filename: tc.filename}
		Enrich(&f, APIInfo{})
		applyEmby(&f, []embyStream{{Type: "Audio", Channels: 6, ChannelLayout: tc.layout, Codec: "ac3"}})
		if f.Evidence["channels"].Conflict != tc.conflict || f.Conflict != tc.conflict {
			t.Fatalf("%s / layout %q: count-only metadata must not guess an LFE layout: %+v", tc.filename, tc.layout, f.Evidence["channels"])
		}
	}
}
