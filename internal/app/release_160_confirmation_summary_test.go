package app

import (
	"context"
	"net/url"
	"reflect"
	"slices"
	"strings"
	"testing"
)

func confirmationSummaryFile160() File {
	return File{ID: 1, MediaID: 1, Service: "radarr", Title: "Summary fixture", Resolution: "1080p", Codec: "x264", Source: "WEB-DL", Audio: "AAC", Language: "Deutsch", Channels: "2.0", AudioTracks: []AudioTrack{{Index: 1, Codec: "DTS", Language: "Englisch", Channels: 6, ChannelLayout: "5.1"}}, Evidence: map[string]Evidence{
		"audio": {Filename: "AAC", Emby: "DTS"}, "language": {Filename: "Deutsch", Emby: "Englisch"}, "channels": {Filename: "2.0", Emby: "5.1"},
	}}
}

func TestConfirmedAudioSummary160(t *testing.T) {
	for _, field := range []string{"audio", "language", "channels"} {
		t.Run(field, func(t *testing.T) {
			f := confirmationSummaryFile160()
			original := slices.Clone(f.AudioTracks)
			e := f.Evidence[field]
			e.Confirmed = &FieldConfirmation{Source: "filename", Value: "previous source value"}
			f.Evidence[field] = e
			got := combinedAudioSummary(f, "en")
			want := "Languages: Deutsch | Codecs: AAC | Track mapping unavailable"
			if got != want {
				t.Fatalf("confirmed scalar overridden or falsely paired: %q", got)
			}
			if !reflect.DeepEqual(f.AudioTracks, original) {
				t.Fatal("raw evidence tracks changed")
			}
		})
	}
	// A saved marker whose source disappeared is ineffective.
	f := confirmationSummaryFile160()
	e := f.Evidence["audio"]
	e.Filename = ""
	e.Confirmed = &FieldConfirmation{Source: "filename", Value: "AAC"}
	f.Evidence["audio"] = e
	if got := combinedAudioSummary(f); !strings.Contains(got, "DTS") || !strings.Contains(got, "Englisch") {
		t.Fatal("inactive confirmation suppressed evidence", got)
	}
}

func TestConfirmedCompletenessAndUnknownFacets160(t *testing.T) {
	for _, active := range []struct{ audio, language bool }{{true, false}, {false, true}, {true, true}, {false, false}} {
		f := confirmationSummaryFile160()
		f.AudioTracks = []AudioTrack{{Index: 1}}
		for _, field := range []string{"audio", "language"} {
			e := f.Evidence[field]
			e.Confirmed = &FieldConfirmation{Source: "filename", Value: "old"}
			if field == "audio" && !active.audio || field == "language" && !active.language {
				e.Filename = ""
			}
			f.Evidence[field] = e
		}
		updateCompleteness(&f)
		if slices.Contains(f.UnknownTraits, "audio") == active.audio || slices.Contains(f.UnknownTraits, "language") == active.language {
			t.Fatalf("wrong confirmed completeness: %+v / %+v", active, f.UnknownTraits)
		}
		if !active.audio || !active.language {
			continue
		}
		store := testStore(t)
		if err := store.Replace("radarr", []File{sample(1, "Fixture.1080p.WEB-DL.x264.mkv")}, SyncStatus{}); err != nil {
			t.Fatal(err)
		}
		tx, err := store.DB.BeginTx(context.Background(), nil)
		if err != nil {
			t.Fatal(err)
		}
		if err = writeResolvedFile(context.Background(), tx, f); err != nil {
			tx.Rollback()
			t.Fatal(err)
		}
		if err = tx.Commit(); err != nil {
			t.Fatal(err)
		}
		for _, field := range []string{"audio", "language"} {
			page, err := store.Query(url.Values{"service": {"radarr"}, field: {"__unknown__"}}, "all", false)
			if err != nil || page.Total != 0 {
				t.Fatal("unknown filter leaked after confirmation", field, page, err)
			}
		}
		facets, err := store.Facets("radarr")
		if err != nil {
			t.Fatal(err)
		}
		if slices.Contains(facets["audio"], "__unknown__") || slices.Contains(facets["language"], "__unknown__") {
			t.Fatal("unknown facet leaked", facets)
		}
		tags, err := store.desiredTags(context.Background(), "radarr", TagGroups{Audio: true, Language: true})
		if err != nil {
			t.Fatal(err)
		}
		if tags[1]["audio-codec-unknown"] || tags[1]["language-unknown"] {
			t.Fatal("unknown outbound tag leaked", tags)
		}
	}
}

func TestActiveFieldConfirmationUsesCurrentSource160(t *testing.T) {
	for _, field := range confirmationFields {
		for _, source := range []string{"filename", "api", "mediaServer", "mediainfo"} {
			f := File{Evidence: map[string]Evidence{field: {Filename: "current", API: "current", Emby: "current", MediaInfo: "current", Confirmed: &FieldConfirmation{Source: source, Value: "old"}}}}
			if !hasActiveFieldConfirmation(f, field) {
				t.Fatal("current confirmation ignored", field, source)
			}
			f.Evidence[field] = Evidence{Confirmed: &FieldConfirmation{Source: source, Value: "saved"}}
			if hasActiveFieldConfirmation(f, field) {
				t.Fatal("saved value fabricated current evidence", field, source)
			}
		}
		f := File{Evidence: map[string]Evidence{field: {Filename: "current"}}}
		if hasActiveFieldConfirmation(f, field) {
			t.Fatal("automatic source treated as confirmed", field)
		}
	}
	if hasActiveFieldConfirmation(File{}, "audio") {
		t.Fatal("missing evidence treated as active")
	}
}
