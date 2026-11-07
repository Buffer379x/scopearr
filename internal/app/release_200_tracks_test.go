package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"reflect"
	"testing"
)

type audioTrackRow200 struct {
	Position int
	Language string
	Codec    string
	Channels string
}

func audioTrackRows200(t *testing.T, db *sql.DB, rowid int64) []audioTrackRow200 {
	t.Helper()
	rows, err := db.Query("SELECT position,language,codec,channels FROM file_audio_tracks WHERE file_rowid=? ORDER BY position", rowid)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	result := []audioTrackRow200{}
	for rows.Next() {
		var row audioTrackRow200
		if err = rows.Scan(&row.Position, &row.Language, &row.Codec, &row.Channels); err != nil {
			t.Fatal(err)
		}
		result = append(result, row)
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	return result
}

func audioTrackCount200(t *testing.T, db *sql.DB) int {
	t.Helper()
	var count int
	if err := db.QueryRow("SELECT count(*) FROM file_audio_tracks").Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

// expectedAudioTrackRows200 applies the Go rules to the stored record: one row
// per stored track with the stored language/codec and mediaChannelLayout.
func expectedAudioTrackRows200(t *testing.T, raw string) []audioTrackRow200 {
	t.Helper()
	var f File
	if err := json.Unmarshal([]byte(raw), &f); err != nil {
		t.Fatal(err)
	}
	rows := []audioTrackRow200{}
	for index, track := range f.AudioTracks {
		rows = append(rows, audioTrackRow200{index, track.Language, track.Codec, mediaChannelLayout(track)})
	}
	return rows
}

// assertAudioTrackIndex200 compares every file's index rows with its data.
func assertAudioTrackIndex200(t *testing.T, db *sql.DB) {
	t.Helper()
	rows, err := db.Query("SELECT rowid,data FROM files ORDER BY rowid")
	if err != nil {
		t.Fatal(err)
	}
	type entry struct {
		id  int64
		raw string
	}
	entries := []entry{}
	for rows.Next() {
		var item entry
		if err = rows.Scan(&item.id, &item.raw); err != nil {
			t.Fatal(err)
		}
		entries = append(entries, item)
	}
	rows.Close()
	total := 0
	for _, item := range entries {
		want := expectedAudioTrackRows200(t, item.raw)
		total += len(want)
		if got := audioTrackRows200(t, db, item.id); !reflect.DeepEqual(got, want) {
			t.Fatalf("file %d index %#v, want %#v", item.id, got, want)
		}
	}
	if count := audioTrackCount200(t, db); count != total {
		t.Fatalf("index holds %d rows, data has %d tracks", count, total)
	}
}

func audioTrackTriggers200(t *testing.T, db *sql.DB) []string {
	t.Helper()
	rows, err := db.Query("SELECT name FROM sqlite_schema WHERE type='trigger' AND name GLOB 'file_audio_tracks_*' ORDER BY name")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	names := []string{}
	for rows.Next() {
		var name string
		if err = rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		names = append(names, name)
	}
	return names
}

// updateAudioTracksCase200 writes old, adds a sentinel row and writes new. The
// sentinel survives only when the update trigger leaves the rows untouched.
func updateAudioTracksCase200(t *testing.T, db *sql.DB, rowid int64, old, new string, rewrite bool) {
	t.Helper()
	if _, err := db.Exec("UPDATE files SET data=? WHERE rowid=?", old, rowid); err != nil {
		t.Fatalf("old UPDATE failed: %v", err)
	}
	if _, err := db.Exec("DELETE FROM file_audio_tracks WHERE file_rowid=? AND position=99", rowid); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO file_audio_tracks(file_rowid,position,language,codec,channels) VALUES(?,99,'sentinel','sentinel','sentinel')", rowid); err != nil {
		t.Fatal(err)
	}
	before := audioTrackRows200(t, db, rowid)
	if _, err := db.Exec("UPDATE files SET data=? WHERE rowid=?", new, rowid); err != nil {
		t.Fatalf("new UPDATE failed: %v", err)
	}
	after := audioTrackRows200(t, db, rowid)
	if !rewrite {
		if !reflect.DeepEqual(after, before) {
			t.Fatalf("rows were rewritten: %#v, want untouched %#v", after, before)
		}
		return
	}
	want := []audioTrackRow200{}
	rows, err := db.Query("SELECT t.key,coalesce(json_extract(t.value,'$.language'),''),coalesce(json_extract(t.value,'$.codec'),''),"+audioTrackChannelsSQL+" FROM json_each(CASE WHEN json_valid(?1) THEN ?1 ELSE '{}' END,'$.audioTracks') t WHERE t.type='object' ORDER BY t.key", new)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var row audioTrackRow200
		if err = rows.Scan(&row.Position, &row.Language, &row.Codec, &row.Channels); err != nil {
			t.Fatal(err)
		}
		want = append(want, row)
	}
	if !reflect.DeepEqual(after, want) {
		t.Fatalf("rows %#v, want rewritten %#v", after, want)
	}
}

func trackFile200(id int, tracks ...AudioTrack) File {
	return File{ID: id, MediaID: id, Service: "radarr", Title: "Track file", Filename: "Track.File.2020.mkv", Size: 4096, AudioTracks: tracks}
}

func TestAudioTrackIndex200(t *testing.T) {
	ctx := context.Background()

	t.Run("channel labels match the Go layout rule", func(t *testing.T) {
		s, err := OpenStore(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		defer s.DB.Close()
		fixed := []struct {
			channels int
			layout   string
			want     string
		}{
			{1, "mono", "1.0"},
			{2, " Stereo ", "2.0"},
			{4, "quad", "4.0"},
			{6, "5.1", "5.1"},
			{8, "7.1(side)", "7.1"},
			{7, "6.1", "6.1"},
			{6, "", "6 ch"},
			{6, "5.1()", "6 ch"},
			{6, "10.1", "6 ch"},
			{0, "", ""},
		}
		// Further spellings only pin SQL = Go: Unicode spaces, case, a newline
		// inside the qualifier, trailing text and a missing count.
		extra := []AudioTrack{
			{Channels: 2, ChannelLayout: "\t MONO　"},
			{Channels: 6, ChannelLayout: "5.1(Side)"},
			{Channels: 6, ChannelLayout: "5.1(a\nb)"},
			{Channels: 6, ChannelLayout: "5.1 side"},
			{Channels: 6, ChannelLayout: "5.1(side"},
			{Channels: 0, ChannelLayout: "5.1(x)(y)"},
			{Channels: 0, ChannelLayout: "Quad"},
			{Channels: 3, ChannelLayout: "2.1)"},
			{Channels: 0, ChannelLayout: "unknown"},
		}
		files := []File{}
		for index, item := range fixed {
			files = append(files, trackFile200(index+1, AudioTrack{Language: "Deutsch", Codec: "AC-3", Channels: item.channels, ChannelLayout: item.layout}))
		}
		files = append(files, trackFile200(len(fixed)+1, extra...))
		if err = s.Replace("radarr", files, SyncStatus{Count: len(files)}); err != nil {
			t.Fatal(err)
		}
		for index, item := range fixed {
			track := AudioTrack{Channels: item.channels, ChannelLayout: item.layout}
			if got := mediaChannelLayout(track); got != item.want {
				t.Fatalf("Go layout %q/%d = %q, want %q", item.layout, item.channels, got, item.want)
			}
			var got string
			if err = s.DB.QueryRow("SELECT t.channels FROM file_audio_tracks t JOIN files f ON f.rowid=t.file_rowid WHERE f.id=?", index+1).Scan(&got); err != nil || got != item.want {
				t.Fatalf("SQL layout %q/%d = %q, want %q (%v)", item.layout, item.channels, got, item.want, err)
			}
		}
		assertAudioTrackIndex200(t, s.DB)
	})

	t.Run("scopearr writes fill the index", func(t *testing.T) {
		s, err := OpenStore(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		defer s.DB.Close()
		f := trackFile200(1,
			AudioTrack{Index: 1, Language: "Deutsch", Codec: "DTS-HD MA", Channels: 8, ChannelLayout: "7.1"},
			AudioTrack{Index: 2, Language: "Englisch", Codec: "AC-3", Channels: 6, ChannelLayout: "5.1"},
		)
		if err = s.Replace("radarr", []File{f}, SyncStatus{Count: 1}); err != nil {
			t.Fatal(err)
		}
		var rowid int64
		if err = s.DB.QueryRow("SELECT rowid FROM files WHERE id=1").Scan(&rowid); err != nil {
			t.Fatal(err)
		}
		want := []audioTrackRow200{{0, "Deutsch", "DTS-HD MA", "7.1"}, {1, "Englisch", "AC-3", "5.1"}}
		if got := audioTrackRows200(t, s.DB, rowid); !reflect.DeepEqual(got, want) {
			t.Fatalf("index %#v, want %#v", got, want)
		}
		// A second snapshot replaces the file row; no stale tracks remain.
		f.AudioTracks = f.AudioTracks[1:]
		if err = s.Replace("radarr", []File{f}, SyncStatus{Count: 1}); err != nil {
			t.Fatal(err)
		}
		assertAudioTrackIndex200(t, s.DB)
		if count := audioTrackCount200(t, s.DB); count != 1 {
			t.Fatalf("index holds %d rows after replace, want 1", count)
		}
	})

	t.Run("writes made with plain SQL keep the index in step", func(t *testing.T) {
		s, err := OpenStore(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		defer s.DB.Close()
		if err = s.Replace("radarr", []File{trackFile200(1, AudioTrack{Language: "Deutsch", Codec: "AC-3", Channels: 6, ChannelLayout: "5.1"})}, SyncStatus{Count: 1}); err != nil {
			t.Fatal(err)
		}
		var rowid int64
		if err = s.DB.QueryRow("SELECT rowid FROM files WHERE id=1").Scan(&rowid); err != nil {
			t.Fatal(err)
		}
		// 1.7.0 rewrites data with plain UPDATE statements.
		changed := trackFile200(1,
			AudioTrack{Language: "Englisch", Codec: "TrueHD", Channels: 8, ChannelLayout: "7.1(side)"},
			AudioTrack{Language: "", Codec: "AAC", Channels: 2, ChannelLayout: "stereo"},
			AudioTrack{Language: "Japanisch", Codec: "", Channels: 1},
		)
		raw, _ := json.Marshal(changed)
		if _, err = s.DB.Exec("UPDATE files SET data=? WHERE rowid=?", string(raw), rowid); err != nil {
			t.Fatal(err)
		}
		want := []audioTrackRow200{{0, "Englisch", "TrueHD", "7.1"}, {1, "", "AAC", "2.0"}, {2, "Japanisch", "", "1 ch"}}
		if got := audioTrackRows200(t, s.DB, rowid); !reflect.DeepEqual(got, want) {
			t.Fatalf("index after UPDATE %#v, want %#v", got, want)
		}
		// Updates of other columns leave the index alone.
		if _, err = s.DB.Exec("UPDATE files SET title='Renamed' WHERE rowid=?", rowid); err != nil {
			t.Fatal(err)
		}
		if got := audioTrackRows200(t, s.DB, rowid); !reflect.DeepEqual(got, want) {
			t.Fatalf("index after title UPDATE %#v, want %#v", got, want)
		}
		// 1.7.0 inserts with the column list of store.go.
		inserted := trackFile200(2, AudioTrack{Language: "Französisch", Codec: "DTS", Channels: 6, ChannelLayout: "5.1"})
		raw, _ = json.Marshal(inserted)
		if _, err = s.DB.Exec("INSERT INTO files(service,id,media_id,season,title,filename,resolution,codec,family,source,processing,hdr,bitDepth,audio,channels,language,size,conflict,data,series,episode_sort,rule_conflict,emby_match,source_path) VALUES('radarr',2,2,0,'Inserted','Inserted.mkv','','','','','','','','','','',1,0,?,'',0,0,'','')", string(raw)); err != nil {
			t.Fatal(err)
		}
		assertAudioTrackIndex200(t, s.DB)
		if count := audioTrackCount200(t, s.DB); count != 4 {
			t.Fatalf("index holds %d rows after INSERT, want 4", count)
		}
		// A delete without foreign keys (sqlite3 shell default) leaves orphan
		// rows; reusing that rowid must still insert and replace them.
		conn, err := s.DB.Conn(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var reused int64
		if err = conn.QueryRowContext(ctx, "SELECT rowid FROM files WHERE id=2").Scan(&reused); err != nil {
			t.Fatal(err)
		}
		for _, statement := range []string{"PRAGMA foreign_keys=OFF", "DELETE FROM files WHERE id=2", "PRAGMA foreign_keys=ON"} {
			if _, err = conn.ExecContext(ctx, statement); err != nil {
				t.Fatal(statement, err)
			}
		}
		conn.Close()
		if got := audioTrackRows200(t, s.DB, reused); len(got) != 1 {
			t.Fatalf("orphan rows %#v, want the deleted file's track", got)
		}
		inserted = trackFile200(3, AudioTrack{Language: "Spanisch", Codec: "AAC", Channels: 2, ChannelLayout: "stereo"}, AudioTrack{Language: "Deutsch", Codec: "AC-3", Channels: 6})
		raw, _ = json.Marshal(inserted)
		if _, err = s.DB.Exec("INSERT INTO files(rowid,service,id,media_id,season,title,filename,resolution,codec,family,source,processing,hdr,bitDepth,audio,channels,language,size,conflict,data) VALUES(?,'radarr',3,3,0,'Reused','Reused.mkv','','','','','','','','','','',1,0,?)", reused, string(raw)); err != nil {
			t.Fatal("INSERT over orphan index rows failed:", err)
		}
		assertAudioTrackIndex200(t, s.DB)
		if _, err = s.DB.Exec("DELETE FROM files"); err != nil {
			t.Fatal(err)
		}
		if count := audioTrackCount200(t, s.DB); count != 0 {
			t.Fatalf("index holds %d rows after DELETE, want 0", count)
		}
	})

	t.Run("invalid or trackless data never blocks a write", func(t *testing.T) {
		s, err := OpenStore(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		defer s.DB.Close()
		if err = s.Replace("radarr", []File{trackFile200(1, AudioTrack{Language: "Deutsch", Codec: "AC-3", Channels: 6, ChannelLayout: "5.1"})}, SyncStatus{Count: 1}); err != nil {
			t.Fatal(err)
		}
		var rowid int64
		if err = s.DB.QueryRow("SELECT rowid FROM files WHERE id=1").Scan(&rowid); err != nil {
			t.Fatal(err)
		}
		cases := []struct {
			name string
			data string
			want []audioTrackRow200
		}{
			{"invalid JSON", "not json", []audioTrackRow200{}},
			{"empty text", "", []audioTrackRow200{}},
			{"JSON array", `[1,2]`, []audioTrackRow200{}},
			{"no audioTracks", `{"id":1,"title":"x"}`, []audioTrackRow200{}},
			{"empty audioTracks", `{"audioTracks":[]}`, []audioTrackRow200{}},
			{"null audioTracks", `{"audioTracks":null}`, []audioTrackRow200{}},
			{"text audioTracks", `{"audioTracks":"Deutsch"}`, []audioTrackRow200{}},
			{"single track object", `{"audioTracks":{"language":"Deutsch","codec":"AC-3","channels":6}}`, []audioTrackRow200{}},
			{"non-object elements", `{"audioTracks":["Deutsch",6,null,true,[1],{"language":"Englisch","codec":"AAC","channels":2}]}`, []audioTrackRow200{{5, "Englisch", "AAC", "2 ch"}}},
			{"missing fields", `{"audioTracks":[{}]}`, []audioTrackRow200{{0, "", "", ""}}},
			{"null fields", `{"audioTracks":[{"language":null,"codec":null,"channels":null,"channelLayout":null}]}`, []audioTrackRow200{{0, "", "", ""}}},
			{"text channel count", `{"audioTracks":[{"language":"Deutsch","channels":"6"}]}`, []audioTrackRow200{{0, "Deutsch", "", ""}}},
		}
		for _, item := range cases {
			if _, err = s.DB.Exec("UPDATE files SET data=? WHERE rowid=?", item.data, rowid); err != nil {
				t.Fatalf("%s: UPDATE failed: %v", item.name, err)
			}
			if got := audioTrackRows200(t, s.DB, rowid); !reflect.DeepEqual(got, item.want) {
				t.Fatalf("%s: index %#v, want %#v", item.name, got, item.want)
			}
			if _, err = s.DB.Exec("INSERT INTO files(service,id,media_id,season,title,filename,resolution,codec,family,source,processing,hdr,bitDepth,audio,channels,language,size,conflict,data) VALUES('sonarr',99,1,0,'x','x','','','','','','','','','','',1,0,?)", item.data); err != nil {
				t.Fatalf("%s: INSERT failed: %v", item.name, err)
			}
			var inserted int64
			if err = s.DB.QueryRow("SELECT rowid FROM files WHERE service='sonarr' AND id=99").Scan(&inserted); err != nil {
				t.Fatal(err)
			}
			if got := audioTrackRows200(t, s.DB, inserted); !reflect.DeepEqual(got, item.want) {
				t.Fatalf("%s: index after INSERT %#v, want %#v", item.name, got, item.want)
			}
			if _, err = s.DB.Exec("DELETE FROM files WHERE rowid=?", inserted); err != nil {
				t.Fatal(err)
			}
		}
		// The start-up rebuild reads the same invalid data without failing.
		if _, err = s.DB.Exec("UPDATE files SET data='not json' WHERE rowid=?", rowid); err != nil {
			t.Fatal(err)
		}
		if _, err = s.DB.Exec("DROP TRIGGER file_audio_tracks_update_v1"); err != nil {
			t.Fatal(err)
		}
		if rebuilt, err := ensureAudioTrackIndex(ctx, s.DB); err != nil || !rebuilt {
			t.Fatal("rebuild over invalid data", rebuilt, err)
		}
		if count := audioTrackCount200(t, s.DB); count != 0 {
			t.Fatalf("index holds %d rows for invalid data, want 0", count)
		}
	})

	t.Run("data updates rewrite tracks only when they change", func(t *testing.T) {
		s, err := OpenStore(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		defer s.DB.Close()
		if err = s.Replace("radarr", []File{trackFile200(1)}, SyncStatus{Count: 1}); err != nil {
			t.Fatal(err)
		}
		var rowid int64
		if err = s.DB.QueryRow("SELECT rowid FROM files WHERE id=1").Scan(&rowid); err != nil {
			t.Fatal(err)
		}
		const two = `[{"language":"Deutsch","codec":"DTS","channels":6,"channelLayout":"5.1"},{"language":"Englisch","codec":"AC-3","channels":2,"channelLayout":"stereo"}]`
		cases := []struct {
			name, old, new string
			rewrite        bool
		}{
			{"other fields only", `{"title":"a","audioTracks":` + two + `}`, `{"title":"b","hdr":"SDR","audioTracks":` + two + `}`, false},
			{"same tracks with other spacing", `{"audioTracks":` + two + `}`, `{"title":"b", "audioTracks": [ {"language": "Deutsch", "codec": "DTS", "channels": 6, "channelLayout": "5.1"}, {"language": "Englisch", "codec": "AC-3", "channels": 2, "channelLayout": "stereo"} ]}`, false},
			{"track changed", `{"audioTracks":` + two + `}`, `{"audioTracks":[{"language":"Französisch","codec":"DTS","channels":6,"channelLayout":"5.1"},{"language":"Englisch","codec":"AC-3","channels":2,"channelLayout":"stereo"}]}`, true},
			{"tracks reordered", `{"audioTracks":` + two + `}`, `{"audioTracks":[{"language":"Englisch","codec":"AC-3","channels":2,"channelLayout":"stereo"},{"language":"Deutsch","codec":"DTS","channels":6,"channelLayout":"5.1"}]}`, true},
			{"track added", `{"audioTracks":` + two + `}`, `{"audioTracks":[{"language":"Deutsch","codec":"DTS","channels":6,"channelLayout":"5.1"},{"language":"Englisch","codec":"AC-3","channels":2,"channelLayout":"stereo"},{"language":"Japanisch","codec":"AAC","channels":2}]}`, true},
			{"track removed", `{"audioTracks":` + two + `}`, `{"audioTracks":[{"language":"Deutsch","codec":"DTS","channels":6,"channelLayout":"5.1"}]}`, true},
			{"invalid to valid", `not json`, `{"audioTracks":` + two + `}`, true},
			{"valid to invalid", `{"audioTracks":` + two + `}`, `not json`, true},
			{"invalid to invalid", `not json`, `still not json`, false},
			{"missing to present", `{"title":"a"}`, `{"title":"a","audioTracks":` + two + `}`, true},
			{"present to missing", `{"title":"a","audioTracks":` + two + `}`, `{"title":"a"}`, true},
			{"array to the same text as a string", `{"audioTracks":[{"language":"Deutsch"}]}`, `{"audioTracks":"[{\"language\":\"Deutsch\"}]"}`, true},
		}
		for _, item := range cases {
			t.Run(item.name, func(t *testing.T) {
				updateAudioTracksCase200(t, s.DB, rowid, item.old, item.new, item.rewrite)
			})
		}
	})

	t.Run("missing triggers rebuild the index once", func(t *testing.T) {
		dir := t.TempDir()
		s, err := OpenStore(dir)
		if err != nil {
			t.Fatal(err)
		}
		files := []File{
			trackFile200(1, AudioTrack{Language: "Deutsch", Codec: "DTS-HD MA", Channels: 8, ChannelLayout: "7.1"}, AudioTrack{Language: "Englisch", Codec: "AC-3", Channels: 6, ChannelLayout: "5.1"}),
			trackFile200(2),
			trackFile200(3, AudioTrack{Language: "Japanisch", Codec: "AAC", Channels: 2, ChannelLayout: "stereo"}),
		}
		if err = s.Replace("radarr", files, SyncStatus{Count: len(files)}); err != nil {
			t.Fatal(err)
		}
		dropAndStale := func() {
			t.Helper()
			for _, statement := range []string{
				"DROP TRIGGER file_audio_tracks_insert_v1",
				"DROP TRIGGER file_audio_tracks_update_v1",
				// An older or foreign trigger generation is replaced, not kept.
				"CREATE TRIGGER file_audio_tracks_insert_v0 AFTER INSERT ON files BEGIN SELECT 1; END",
				"INSERT INTO file_audio_tracks(file_rowid,position,language,codec,channels) SELECT rowid,7,'Klingonisch','X','9 ch' FROM files WHERE id=2",
				// A write while the triggers are missing leaves the index behind.
				`UPDATE files SET data=json_set(data,'$.audioTracks',json('[{"language":"Italienisch","codec":"Opus","channels":2}]')) WHERE id=3`,
			} {
				if _, err := s.DB.Exec(statement); err != nil {
					t.Fatal(statement, err)
				}
			}
		}
		dropAndStale()
		if rebuilt, err := ensureAudioTrackIndex(ctx, s.DB); err != nil || !rebuilt {
			t.Fatal("first ensure must rebuild", rebuilt, err)
		}
		assertAudioTrackIndex200(t, s.DB)
		if got, want := audioTrackTriggers200(t, s.DB), []string{"file_audio_tracks_insert_v1", "file_audio_tracks_update_v1"}; !reflect.DeepEqual(got, want) {
			t.Fatalf("triggers %v, want %v", got, want)
		}
		if rebuilt, err := ensureAudioTrackIndex(ctx, s.DB); err != nil || rebuilt {
			t.Fatal("second ensure must not rebuild", rebuilt, err)
		}
		// The same through OpenStore, as after restoring an older backup.
		dropAndStale()
		s.DB.Close()
		s, err = OpenStore(dir)
		if err != nil {
			t.Fatal(err)
		}
		defer s.DB.Close()
		assertAudioTrackIndex200(t, s.DB)
		if got, want := audioTrackTriggers200(t, s.DB), []string{"file_audio_tracks_insert_v1", "file_audio_tracks_update_v1"}; !reflect.DeepEqual(got, want) {
			t.Fatalf("triggers after OpenStore %v, want %v", got, want)
		}
		if rebuilt, err := ensureAudioTrackIndex(ctx, s.DB); err != nil || rebuilt {
			t.Fatal("ensure after OpenStore must not rebuild", rebuilt, err)
		}
	})

	t.Run("older stores fill the index once", func(t *testing.T) {
		dir := t.TempDir()
		s, err := OpenStore(dir)
		if err != nil {
			t.Fatal(err)
		}
		files := []File{
			trackFile200(1, AudioTrack{Language: "Deutsch", Codec: "DTS", Channels: 6, ChannelLayout: "5.1"}),
			trackFile200(2, AudioTrack{Language: "Englisch", Codec: "AC-3", Channels: 2, ChannelLayout: "stereo"}, AudioTrack{Language: "Deutsch", Codec: "AC-3", Channels: 1, ChannelLayout: "mono"}),
		}
		if err = s.Replace("radarr", files, SyncStatus{Count: len(files)}); err != nil {
			t.Fatal(err)
		}
		// The schema of a 1.7.0 store: neither the table nor its triggers.
		for _, statement := range []string{"DROP TRIGGER file_audio_tracks_insert_v1", "DROP TRIGGER file_audio_tracks_update_v1", "DROP TABLE file_audio_tracks"} {
			if _, err = s.DB.Exec(statement); err != nil {
				t.Fatal(statement, err)
			}
		}
		s.DB.Close()
		s, err = OpenStore(dir)
		if err != nil {
			t.Fatal(err)
		}
		defer s.DB.Close()
		assertAudioTrackIndex200(t, s.DB)
		if count := audioTrackCount200(t, s.DB); count != 3 {
			t.Fatalf("index holds %d rows, want 3", count)
		}
		var index int
		if err = s.DB.QueryRow("SELECT count(*) FROM sqlite_schema WHERE type='index' AND name='file_audio_tracks_combination' AND tbl_name='file_audio_tracks'").Scan(&index); err != nil || index != 1 {
			t.Fatal("combination index missing", index, err)
		}
		var version int
		if err = s.DB.QueryRow("PRAGMA user_version").Scan(&version); err != nil || version != 18 {
			t.Fatal("user_version must stay 18", version, err)
		}
		if rebuilt, err := ensureAudioTrackIndex(ctx, s.DB); err != nil || rebuilt {
			t.Fatal("filled store must not rebuild again", rebuilt, err)
		}
	})
}
