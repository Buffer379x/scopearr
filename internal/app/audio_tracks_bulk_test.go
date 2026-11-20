package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"reflect"
	"testing"
)

// audioTrackFixture returns count movies with 0–3 tracks each; variant
// changes the track values so a second sync rewrites the index.
func audioTrackFixture(count, variant int) []File {
	languages := []string{"Deutsch", "Englisch", "und", "", "Japanisch"}
	codecs := []string{"DTS-HD MA", "AC-3", "", "TrueHD", "AAC"}
	layouts := []struct {
		channels int
		layout   string
	}{{8, "7.1"}, {6, " 5.1(side) "}, {2, "stereo"}, {1, "Mono"}, {3, ""}, {0, "quad"}, {0, ""}}
	files := make([]File, 0, count)
	for i := 1; i <= count; i++ {
		f := sample(i, fmt.Sprintf("Movie.%03d.1080p.WEB-DL.x264.mkv", i))
		f.MediaID = i
		for n := 0; n < (i+variant)%4; n++ {
			l := layouts[(i+n+variant)%len(layouts)]
			f.AudioTracks = append(f.AudioTracks, AudioTrack{Index: n + 1, Language: languages[(i+2*n+variant)%len(languages)], Codec: codecs[(i+n)%len(codecs)], Channels: l.channels, ChannelLayout: l.layout, Default: n == 0})
		}
		files = append(files, f)
	}
	return files
}

type audioTrackRow struct {
	rowid, file int64
	position    int
	language    string
	codec       string
	channels    string
}

func audioTrackDump(t *testing.T, s *Store) []audioTrackRow {
	t.Helper()
	rows, err := s.DB.Query("SELECT rowid,file_rowid,position,language,codec,channels FROM file_audio_tracks ORDER BY rowid")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := []audioTrackRow{}
	for rows.Next() {
		var r audioTrackRow
		if err = rows.Scan(&r.rowid, &r.file, &r.position, &r.language, &r.codec, &r.channels); err != nil {
			t.Fatal(err)
		}
		out = append(out, r)
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

// requireAudioTrackTriggers checks that both v1 triggers are stored with the
// exact text this version (and the index check of 1.7.0's successor) expects.
func requireAudioTrackTriggers(t *testing.T, s *Store) {
	t.Helper()
	got := map[string]string{}
	rows, err := s.DB.Query("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND name GLOB 'file_audio_tracks_*'")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var name, text string
		if err = rows.Scan(&name, &text); err != nil {
			t.Fatal(err)
		}
		got[name] = text
	}
	want := map[string]string{"file_audio_tracks_insert_v1": audioTrackInsertTriggerSQL, "file_audio_tracks_update_v1": audioTrackUpdateTriggerSQL}
	for name, text := range want {
		if got[name] != text {
			t.Fatalf("trigger %s = %q, want %q", name, got[name], text)
		}
	}
	if len(got) != len(want) {
		t.Fatalf("triggers %v", got)
	}
}

// TestFullSyncAudioTrackIndexMatchesTriggers runs the same syncs once with
// the per-row triggers and once with the bulk rebuild of a full sync: the
// index tables must be equal row by row, rowids included.
func TestFullSyncAudioTrackIndexMatchesTriggers(t *testing.T) {
	previous := audioTrackBulkRebuild
	t.Cleanup(func() { audioTrackBulkRebuild = previous })
	run := func(bulk bool) [][]audioTrackRow {
		audioTrackBulkRebuild = bulk
		s := testStore(t)
		ctx := context.Background()
		steps := []func() error{
			func() error { return s.Replace("radarr", audioTrackFixture(40, 0), SyncStatus{}) },
			func() error { return s.Replace("radarr-2", audioTrackFixture(25, 1), SyncStatus{}) },
			func() error {
				one := audioTrackFixture(5, 2)[2:3]
				return s.replaceContext(ctx, "radarr", one, SyncStatus{}, false, &DeltaScope{MediaID: 3, All: true}, nil)
			},
			func() error { return s.Replace("radarr", audioTrackFixture(33, 3), SyncStatus{}) },
			func() error { return s.Replace("sonarr", audioTrackFixture(12, 1), SyncStatus{}) },
			func() error { return s.Replace("radarr-2", nil, SyncStatus{}) },
			func() error { return s.Replace("radarr", audioTrackFixture(50, 2), SyncStatus{}) },
		}
		dumps := [][]audioTrackRow{}
		for index, step := range steps {
			if err := step(); err != nil {
				t.Fatalf("bulk=%v step %d: %v", bulk, index, err)
			}
			requireAudioTrackTriggers(t, s)
			dumps = append(dumps, audioTrackDump(t, s))
		}
		return dumps
	}
	triggered, bulk := run(false), run(true)
	for index := range triggered {
		if len(triggered[index]) == 0 && index != 5 {
			t.Fatalf("step %d: empty index", index)
		}
		if !reflect.DeepEqual(triggered[index], bulk[index]) {
			t.Fatalf("step %d: triggers %v\nbulk %v", index, triggered[index], bulk[index])
		}
	}
}

// TestAbortedFullSyncKeepsAudioTrackTriggers aborts a full sync after the
// triggers were dropped (a failing insert mid-sync, a refused commit after the
// rebuild): the rollback must restore both triggers verbatim and the previous
// index, and later writes must again run through the triggers.
func TestAbortedFullSyncKeepsAudioTrackTriggers(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	if err := s.Replace("radarr", audioTrackFixture(20, 0), SyncStatus{}); err != nil {
		t.Fatal(err)
	}
	before := audioTrackDump(t, s)
	if len(before) == 0 {
		t.Fatal("empty index")
	}
	duplicate := audioTrackFixture(10, 1)
	duplicate = append(duplicate, duplicate[3])
	if err := s.Replace("radarr", duplicate, SyncStatus{}); err == nil {
		t.Fatal("duplicate file id was accepted")
	}
	requireAudioTrackTriggers(t, s)
	if got := audioTrackDump(t, s); !reflect.DeepEqual(got, before) {
		t.Fatalf("index after failed insert %v, want %v", got, before)
	}
	err := s.replaceContext(ctx, "radarr", audioTrackFixture(10, 1), SyncStatus{}, false, nil, func(*sql.Tx) error { return context.Canceled })
	if !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	requireAudioTrackTriggers(t, s)
	if got := audioTrackDump(t, s); !reflect.DeepEqual(got, before) {
		t.Fatalf("index after refused commit %v, want %v", got, before)
	}
	// A delta write still indexes through the trigger.
	changed := sample(7, "Movie.007.1080p.WEB-DL.x264.mkv")
	changed.MediaID = 7
	changed.AudioTracks = []AudioTrack{{Index: 1, Language: "Französisch", Codec: "FLAC", Channels: 2}}
	if err = s.replaceContext(ctx, "radarr", []File{changed}, SyncStatus{}, false, &DeltaScope{MediaID: 7, All: true}, nil); err != nil {
		t.Fatal(err)
	}
	var language, codec, channels string
	if err = s.DB.QueryRow("SELECT t.language,t.codec,t.channels FROM file_audio_tracks t JOIN files f ON f.rowid=t.file_rowid WHERE f.service='radarr' AND f.id=7").Scan(&language, &codec, &channels); err != nil {
		t.Fatal(err)
	}
	if language != normLanguage("Französisch") || codec == "" || channels != "2 ch" {
		t.Fatal(language, codec, channels)
	}
	if rebuilt, err := ensureAudioTrackIndex(ctx, s.DB); err != nil || rebuilt {
		t.Fatal(rebuilt, err)
	}
}
