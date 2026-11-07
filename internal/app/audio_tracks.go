package app

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"unicode/utf8"

	"scopearr/internal/langdata"
)

// file_audio_tracks indexes one row per stored audio track for combination
// filters (language, codec and channel label of the same track). SQLite
// triggers keep it current for every write to files, including writes made by
// versions that do not know the table; user_version stays unchanged.
//
// Tracks are measurements: field confirmations change the file value, not the
// stored tracks, so the index holds the stored track values. Language and codec
// are stored normalized; an empty string means unknown.

// audioTrackLayoutSQL is lower(strings.TrimSpace(channelLayout)) of the track
// in t.value. The trim set is Go's unicode.IsSpace.
const audioTrackLayoutSQL = "lower(trim(coalesce(json_extract(t.value,'$.channelLayout'),''),char(9,10,11,12,13,32,133,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288)))"

// audioTrackChannelsSQL is the SQL counterpart of mediaChannelLayout. The
// trigger and the rebuild share it; a test pins SQL = Go.
const audioTrackChannelsSQL = "CASE" +
	" WHEN " + audioTrackLayoutSQL + "='mono' THEN '1.0'" +
	" WHEN " + audioTrackLayoutSQL + "='stereo' THEN '2.0'" +
	" WHEN " + audioTrackLayoutSQL + "='quad' THEN '4.0'" +
	// ^(\d\.\d)(\(.+\))?$ — Go's "." does not match a newline.
	" WHEN " + audioTrackLayoutSQL + " GLOB '[0-9].[0-9]' OR (" + audioTrackLayoutSQL + " GLOB '[0-9].[0-9](?*)' AND instr(" + audioTrackLayoutSQL + ",char(10))=0) THEN substr(" + audioTrackLayoutSQL + ",1,3)" +
	" WHEN json_type(t.value,'$.channels')='integer' AND json_extract(t.value,'$.channels')>0 THEN json_extract(t.value,'$.channels')||' ch'" +
	" ELSE '' END"

// audioTrackRowsSQL selects the index rows of one files row named {row}; {from}
// adds the files table for the rebuild. Invalid JSON, non-object elements and
// an audioTracks object instead of an array (its members have text keys, and
// duplicate member names would collide on the primary key) yield no rows, so
// the triggers never make a write fail.
const audioTrackRowsSQL = "SELECT {row}.rowid,t.key,coalesce(json_extract(t.value,'$.language'),''),coalesce(json_extract(t.value,'$.codec'),'')," + audioTrackChannelsSQL +
	" FROM {from}json_each(CASE WHEN json_valid({row}.data) THEN {row}.data ELSE '{}' END,'$.audioTracks') t WHERE t.type='object' AND typeof(t.key)='integer'"

func audioTrackRows(row, from string) string {
	return strings.NewReplacer("{row}", row, "{from}", from).Replace(audioTrackRowsSQL)
}

const audioTrackInsert = "INSERT INTO file_audio_tracks(file_rowid,position,language,codec,channels) "

// audioTrackChangedSQL limits the update trigger to writes that change the
// stored tracks; reparses rewrite data but almost never the measured tracks.
// "->" keeps JSON types apart (an array and the same text as a string differ),
// and the json_valid guards keep invalid data from raising: both sides are
// NULL then, matching an index without rows.
const audioTrackChangedSQL = "(CASE WHEN json_valid(old.data) THEN old.data->'$.audioTracks' END) IS NOT (CASE WHEN json_valid(new.data) THEN new.data->'$.audioTracks' END)"

var audioTrackIndexSchema = `CREATE TABLE IF NOT EXISTS file_audio_tracks(file_rowid INTEGER NOT NULL REFERENCES files(rowid) ON DELETE CASCADE,position INTEGER NOT NULL,language TEXT NOT NULL,codec TEXT NOT NULL,channels TEXT NOT NULL,PRIMARY KEY(file_rowid,position));
CREATE INDEX IF NOT EXISTS file_audio_tracks_combination ON file_audio_tracks(language,codec,channels,file_rowid);
CREATE TRIGGER file_audio_tracks_insert_v1 AFTER INSERT ON files BEGIN DELETE FROM file_audio_tracks WHERE file_rowid=new.rowid; ` + audioTrackInsert + audioTrackRows("new", "") + `; END;
CREATE TRIGGER file_audio_tracks_update_v1 AFTER UPDATE OF data ON files WHEN ` + audioTrackChangedSQL + ` BEGIN DELETE FROM file_audio_tracks WHERE file_rowid=old.rowid; ` + audioTrackInsert + audioTrackRows("new", "") + `; END;
`

// ensureAudioTrackIndex creates and fills the track index when its table,
// index or either v1 trigger is missing (new store, store from an older
// version or restored backup). Older trigger generations are replaced. All of
// it runs in one transaction from cached JSON only; no media file is read.
func ensureAudioTrackIndex(ctx context.Context, db *sql.DB) (rebuilt bool, err error) {
	var present int
	if err = db.QueryRowContext(ctx, "SELECT count(*) FROM sqlite_schema WHERE (type='table' AND name='file_audio_tracks') OR (type='index' AND name='file_audio_tracks_combination') OR (type='trigger' AND name IN ('file_audio_tracks_insert_v1','file_audio_tracks_update_v1') AND tbl_name='files')").Scan(&present); err != nil {
		return false, err
	}
	if present == 4 {
		return false, nil
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, "SELECT name FROM sqlite_schema WHERE type='trigger' AND name GLOB 'file_audio_tracks_*'")
	if err != nil {
		return false, err
	}
	triggers := []string{}
	for rows.Next() {
		var name string
		if err = rows.Scan(&name); err != nil {
			rows.Close()
			return false, err
		}
		triggers = append(triggers, name)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return false, err
	}
	for _, name := range triggers {
		if _, err = tx.ExecContext(ctx, `DROP TRIGGER "`+strings.ReplaceAll(name, `"`, `""`)+`"`); err != nil {
			return false, err
		}
	}
	if _, err = tx.ExecContext(ctx, audioTrackIndexSchema); err != nil {
		return false, err
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM file_audio_tracks"); err != nil {
		return false, err
	}
	if _, err = tx.ExecContext(ctx, audioTrackInsert+audioTrackRows("f", "files f,")); err != nil {
		return false, err
	}
	return true, tx.Commit()
}

// maxTrackCombinations bounds the repeated track filter parameter.
const maxTrackCombinations = 16

// trackCombination is one value of the track filter: the parts must hold for
// the same indexed audio track. nil means any value, "" means unknown.
type trackCombination struct {
	language, codec, channels *string
}

// parseTrackCombination reads "language|codec|channels". An empty part means
// any value and __unknown__ an unknown one; at least one part must be set. The
// language is normalized and must name exactly one language (unknown-language
// markers such as "und" mean unknown, as stored). Codec and channel label are
// matched exactly after trimming, at most 80 characters each.
func parseTrackCombination(value string) (trackCombination, error) {
	invalid := errors.New("Invalid audio track combination")
	parts := strings.Split(value, "|")
	if len(parts) != 3 {
		return trackCombination{}, invalid
	}
	var out trackCombination
	targets := []**string{&out.language, &out.codec, &out.channels}
	set := false
	for index, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if part != "__unknown__" {
			if index == 0 {
				part = normLanguage(part)
				if part == "" && !langdata.IsUnknown(parts[0]) || strings.Contains(part, ", ") {
					return trackCombination{}, invalid
				}
			} else if utf8.RuneCountInString(part) > 80 {
				return trackCombination{}, invalid
			}
		} else {
			part = ""
		}
		*targets[index] = &part
		set = true
	}
	if !set {
		return trackCombination{}, invalid
	}
	return out, nil
}

// condition matches files with one indexed track that satisfies every set
// part; files without stored tracks never match. Every part tests the same
// row t. The subquery is uncorrelated, so SQLite evaluates it once through
// file_audio_tracks_combination; a correlated EXISTS made the planner search
// that index per file (quadratic: 83 s for 50,000 files).
func (c trackCombination) condition() (string, []any) {
	conditions := []string{}
	args := []any{}
	for _, part := range []struct {
		column string
		value  *string
	}{{"language", c.language}, {"codec", c.codec}, {"channels", c.channels}} {
		if part.value != nil {
			conditions = append(conditions, "t."+part.column+"=?")
			args = append(args, *part.value)
		}
	}
	return "f.rowid IN (SELECT t.file_rowid FROM file_audio_tracks t WHERE " + strings.Join(conditions, " AND ") + ")", args
}

// canonical writes the combination back as a normalized parameter value.
func (c trackCombination) canonical() string {
	parts := make([]string, 3)
	for index, value := range []*string{c.language, c.codec, c.channels} {
		if value != nil {
			parts[index] = *value
			if *value == "" {
				parts[index] = "__unknown__"
			}
		}
	}
	return strings.Join(parts, "|")
}
