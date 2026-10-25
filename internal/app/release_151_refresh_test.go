package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func seedArrWarning151(t *testing.T, s *Store) {
	t.Helper()
	f := File{ID: 1, MediaID: 1, Service: "radarr", Title: "Synthetic Red Alert", Filename: "Red.Alert.1990.1080i.mkv"}
	Enrich(&f, APIInfo{Quality: "HDTV-1080p", VideoCodec: "AVC"})
	f.setMediaMatch("emby", MediaMatch{Status: "no_tracks", Video: &MediaVideo{Width: 1920, Height: 1080, Resolution: "1080i", Codec: "AVC"}})
	// Persist the pre-1.5.1 warning with its current recognition revision.
	f.Conflict = true
	f.Evidence["resolution"] = Evidence{Filename: "1080i", API: "1080p", Emby: "1080i", Origin: "filename", Conflict: true}
	if err := s.Replace("radarr", []File{f}, SyncStatus{Count: 1}); err != nil {
		t.Fatal(err)
	}
	if err := s.Put("settings", Settings{Instances: []ServiceConfig{{ID: "radarr", Type: "radarr", Enabled: true, TagSync: TagGroups{Resolution: true}}}}); err != nil {
		t.Fatal(err)
	}
}

func TestRefreshMarkers151(t *testing.T) {
	for _, from150 := range []bool{true, false} {
		name := "direct_146_upgrade"
		if from150 {
			name = "150_upgrade"
		}
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			s, err := OpenStore(dir)
			if err != nil {
				t.Fatal(err)
			}
			seedArrWarning151(t, s)
			if _, err = s.DB.Exec("DELETE FROM kv WHERE key='derivedRefresh:1.5.1'"); err != nil {
				t.Fatal(err)
			}
			if !from150 {
				if _, err = s.DB.Exec("DELETE FROM kv WHERE key='derivedRefresh:1.5.0'"); err != nil {
					t.Fatal(err)
				}
			}
			s.DB.Close()
			s, err = OpenStore(dir)
			if err != nil {
				t.Fatal(err)
			}
			defer s.DB.Close()
			for _, key := range []string{"derivedRefresh:1.5.0", "derivedRefresh:1.5.1", "tagSyncDirty:radarr"} {
				var value bool
				if err = s.Get(key, &value); err != nil || !value {
					t.Fatal(key, value, err)
				}
			}
			var conflict int
			var raw string
			if err = s.DB.QueryRow("SELECT conflict,data FROM files").Scan(&conflict, &raw); err != nil || conflict != 0 {
				t.Fatal(conflict, err)
			}
			var file map[string]any
			if err = json.Unmarshal([]byte(raw), &file); err != nil {
				t.Fatal(err)
			}
			evidence := file["evidence"].(map[string]any)["resolution"].(map[string]any)
			if evidence["apiDiffers"] != true || evidence["conflict"] != false {
				t.Fatal(evidence)
			}
			backups, err := filepath.Glob(filepath.Join(dir, "backups", "*.db"))
			if err != nil || len(backups) != 1 {
				t.Fatal("markers must coalesce into one backup", backups, err)
			}
			s.Events.Flush()
			var events int
			if err = s.DB.QueryRow("SELECT count(*) FROM event_log WHERE message='Media details refreshed for {count} files'").Scan(&events); err != nil || events != 1 {
				t.Fatal(events, err)
			}
			if _, err = s.DB.Exec("CREATE TRIGGER no_second_refresh151 BEFORE UPDATE ON files BEGIN SELECT RAISE(ABORT,'unexpected second refresh'); END"); err != nil {
				t.Fatal(err)
			}
			s.DB.Close()
			s, err = OpenStore(dir)
			if err != nil {
				t.Fatal(err)
			}
			defer s.DB.Close()
			after, _ := filepath.Glob(filepath.Join(dir, "backups", "*.db"))
			if len(after) != 1 {
				t.Fatal("reopen repeated backup", after)
			}
			before, err := os.ReadFile(backups[0])
			if err != nil || len(before) == 0 {
				t.Fatal("backup unreadable", err)
			}
		})
	}
}

func TestRefreshMarkerFailureRollsBack151(t *testing.T) {
	dir := t.TempDir()
	s, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	seedArrWarning151(t, s)
	if _, err = s.DB.Exec("DELETE FROM kv WHERE key IN ('derivedRefresh:1.5.0','derivedRefresh:1.5.1'); CREATE TRIGGER fail_refresh_marker151 BEFORE INSERT ON kv WHEN new.key='derivedRefresh:1.5.1' BEGIN SELECT RAISE(ABORT,'synthetic marker failure'); END"); err != nil {
		t.Fatal(err)
	}
	s.DB.Close()
	s, err = OpenStore(dir)
	if err != nil {
		t.Fatal("refresh failure prevented startup", err)
	}
	defer s.DB.Close()
	var count, conflict int
	if err = s.DB.QueryRow("SELECT count(*) FROM kv WHERE key IN ('derivedRefresh:1.5.0','derivedRefresh:1.5.1','tagSyncDirty:radarr')").Scan(&count); err != nil || count != 0 {
		t.Fatal("partial marker/dirty state", count, err)
	}
	if err = s.DB.QueryRow("SELECT conflict FROM files").Scan(&conflict); err != nil || conflict != 1 {
		t.Fatal("partial data refresh", conflict, err)
	}
	s.Events.Flush()
	if err = s.DB.QueryRow("SELECT count(*) FROM event_log WHERE level='warning' AND message='Could not refresh media details: {error}'").Scan(&count); err != nil || count != 1 {
		t.Fatal(count, err)
	}
	if _, err = s.DB.Exec("DROP TRIGGER fail_refresh_marker151"); err != nil {
		t.Fatal(err)
	}
	s.DB.Close()
	s, err = OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.DB.Close()
	if err = s.DB.QueryRow("SELECT count(*) FROM kv WHERE key IN ('derivedRefresh:1.5.0','derivedRefresh:1.5.1')").Scan(&count); err != nil || count != 2 {
		t.Fatal("retry did not set both markers", count, err)
	}
}
