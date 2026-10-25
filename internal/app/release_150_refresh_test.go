package app

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"testing"
	"time"
)

func legacyDerivedFile150(id int) File {
	f := File{ID: id, MediaID: id, Service: "radarr", Title: "Synthetic cropped movie", Filename: "Movie.UHD.x264.mkv"}
	Enrich(&f, APIInfo{Quality: "Bluray-1080p", VideoCodec: "AVC"})
	f.setMediaMatch("emby", MediaMatch{Status: "matched", Video: &MediaVideo{Width: 1912, Height: 796, Resolution: "720p", Codec: "AVC"}, Tracks: []AudioTrack{{Index: 1, Codec: "DTS", Channels: 6, ChannelLayout: "5.1(side)"}}})
	// These values are the persisted 1.4.6 interpretation, not a request to an upstream server.
	f.Resolution, f.Channels, f.Source, f.Conflict = "1080p", "6 ch", "UHD", true
	f.Evidence["resolution"] = Evidence{API: "1080p", Emby: "720p", Origin: "api", Conflict: true}
	f.Evidence["source"] = Evidence{Filename: "UHD", API: "BluRay", Origin: "filename", Conflict: true}
	return f
}

func seedDerived150(t *testing.T, s *Store, count int) {
	t.Helper()
	files := make([]File, count)
	for i := range files {
		files[i] = legacyDerivedFile150(i + 1)
	}
	if err := s.Replace("radarr", files, SyncStatus{Count: count}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec("DELETE FROM kv WHERE key='derivedRefresh:1.5.0'"); err != nil {
		t.Fatal(err)
	}
	if err := s.Put("settings", Settings{Instances: []ServiceConfig{{ID: "radarr", Type: "radarr", Enabled: true, TagSync: TagGroups{Channels: true}}, {ID: "sonarr-off", Type: "sonarr", Enabled: true}}}); err != nil {
		t.Fatal(err)
	}
}

func TestDerivedRefreshFreshStore150(t *testing.T) {
	s := testStore(t)
	backups, err := filepath.Glob(filepath.Join(s.Dir, "backups", "*.db"))
	if err != nil || len(backups) != 0 {
		t.Fatal("an empty fresh cache has nothing to back up", backups, err)
	}
	var marker bool
	if err = s.Get("derivedRefresh:1.5.0", &marker); err != nil || !marker {
		t.Fatal(marker, err)
	}
	s.Events.Flush()
	var events int
	if err = s.DB.QueryRow("SELECT count(*) FROM event_log").Scan(&events); err != nil || events != 0 {
		t.Fatal("an empty refresh is not an event", events, err)
	}
}

func TestDerivedRefresh150(t *testing.T) {
	dir := t.TempDir()
	s, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	seedDerived150(t, s, 1)
	if err = s.DB.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.DB.Close()
	var resolution, channels, raw string
	var conflict, schema int
	if err = s.DB.QueryRow("SELECT resolution,channels,conflict,data FROM files").Scan(&resolution, &channels, &conflict, &raw); err != nil {
		t.Fatal(err)
	}
	if resolution != "1080p" || channels != "5.1" || conflict != 0 {
		t.Fatalf("refresh left old traits: %s %s %d", resolution, channels, conflict)
	}
	var f File
	if err = json.Unmarshal([]byte(raw), &f); err != nil {
		t.Fatal(err)
	}
	if f.MediaServers.get("emby").Video.Resolution != "1080p" || f.Evidence["source"].Conflict || f.Source != "UHD" {
		t.Fatal(f)
	}
	var marker, dirty bool
	if err = s.Get("derivedRefresh:1.5.0", &marker); err != nil || !marker {
		t.Fatal(marker, err)
	}
	if err = s.Get("tagSyncDirty:radarr", &dirty); err != nil || !dirty {
		t.Fatal(dirty, err)
	}
	var off int
	if err = s.DB.QueryRow("SELECT count(*) FROM kv WHERE key='tagSyncDirty:sonarr-off'").Scan(&off); err != nil || off != 0 {
		t.Fatal(off, err)
	}
	backups, err := filepath.Glob(filepath.Join(dir, "backups", "*.db"))
	if err != nil || len(backups) == 0 {
		t.Fatal("no upgrade backup", backups, err)
	}
	if err = s.DB.QueryRow("PRAGMA user_version").Scan(&schema); err != nil || schema != 18 {
		t.Fatal(schema, err)
	}
	// Persisted rules still compile and contain no new source comparison field.
	var rules RecognitionConfig
	if err = s.Get("recognition", &rules); err != nil {
		t.Fatal(err)
	}
	if _, err = CompileRecognition(rules.Rules); err != nil {
		t.Fatal(err)
	}
	s.Events.Flush()
	var events int
	if err = s.DB.QueryRow("SELECT count(*) FROM event_log WHERE source='system' AND message='Media details refreshed for {count} files'").Scan(&events); err != nil || events != 1 {
		t.Fatal(events, err)
	}
	// A successful marker must prevent another write or backup on the next start.
	if _, err = s.DB.Exec("CREATE TRIGGER forbid_derived_update BEFORE UPDATE ON files BEGIN SELECT RAISE(ABORT,'unexpected second refresh'); END"); err != nil {
		t.Fatal(err)
	}
	if err = s.DB.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.DB.Close()
	after, _ := filepath.Glob(filepath.Join(dir, "backups", "*.db"))
	if fmt.Sprint(backups) != fmt.Sprint(after) {
		t.Fatal("second open made another backup", after)
	}
}

func TestDerivedRefreshRollback150(t *testing.T) {
	dir := t.TempDir()
	s, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	seedDerived150(t, s, 2)
	// Fail after the first row, proving that data, dirty flags and marker are atomic.
	if _, err = s.DB.Exec("CREATE TRIGGER fail_derived BEFORE UPDATE ON files WHEN old.id=2 BEGIN SELECT RAISE(ABORT,'synthetic refresh failure'); END"); err != nil {
		t.Fatal(err)
	}
	s.DB.Close()
	s, err = OpenStore(dir)
	if err != nil {
		t.Fatal("refresh failure must not stop startup", err)
	}
	defer s.DB.Close()
	var marker, changed int
	if err = s.DB.QueryRow("SELECT count(*) FROM kv WHERE key='derivedRefresh:1.5.0'").Scan(&marker); err != nil || marker != 0 {
		t.Fatal(marker, err)
	}
	if err = s.DB.QueryRow("SELECT count(*) FROM files WHERE channels<>'6 ch' OR conflict<>1").Scan(&changed); err != nil || changed != 0 {
		t.Fatal("partial refresh escaped rollback", changed, err)
	}
	s.Events.Flush()
	var warnings int
	if err = s.DB.QueryRow("SELECT count(*) FROM event_log WHERE source='system' AND level='warning' AND message='Could not refresh media details: {error}'").Scan(&warnings); err != nil || warnings != 1 {
		t.Fatal(warnings, err)
	}
	if _, err = s.DB.Exec("DROP TRIGGER fail_derived"); err != nil {
		t.Fatal(err)
	}
	s.DB.Close()
	s, err = OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.DB.Close()
	if err = s.DB.QueryRow("SELECT count(*) FROM kv WHERE key='derivedRefresh:1.5.0'").Scan(&marker); err != nil || marker != 1 {
		t.Fatal("retry did not complete", marker, err)
	}
}

func TestDerivedRefreshUnchangedRows150(t *testing.T) {
	s := testStore(t)
	f := sample(1, "Movie.1080p.BluRay.x264.mkv")
	if err := s.Replace("radarr", []File{f}, SyncStatus{}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec("CREATE TRIGGER no_rewrite150 BEFORE UPDATE ON files BEGIN SELECT RAISE(ABORT,'unchanged file rewritten'); END"); err != nil {
		t.Fatal(err)
	}
	tx, err := s.DB.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	count, err := reparseCachedForced(context.Background(), tx, s.recognition.Load())
	if err != nil || count != 0 {
		t.Fatal(count, err)
	}
}

func TestDerivedRefresh50K150(t *testing.T) {
	if os.Getenv("SCOPEARR_PERF") != "1" {
		t.Skip("opt-in 50,000-file refresh")
	}
	s := testStore(t)
	seedDerived150(t, s, 50000)
	debug.FreeOSMemory()
	var peak uint64
	stop, done := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(5 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				var m runtime.MemStats
				runtime.ReadMemStats(&m)
				peak = max(peak, m.HeapAlloc)
			case <-stop:
				return
			}
		}
	}()
	start := time.Now()
	s.refreshDerivedMetadata150()
	elapsed := time.Since(start)
	close(stop)
	<-done
	var corrected int
	if err := s.DB.QueryRow("SELECT count(*) FROM files WHERE channels='5.1' AND resolution='1080p' AND conflict=0").Scan(&corrected); err != nil || corrected != 50000 {
		t.Fatal(corrected, err)
	}
	t.Logf("50,000 derived files refreshed in %s; peak heap %.2f MiB", elapsed, float64(peak)/(1<<20))
	if elapsed > 60*time.Second || peak > 512<<20 {
		t.Fatal("refresh budget exceeded", elapsed, peak)
	}
}
