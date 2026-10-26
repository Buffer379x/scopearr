package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"sort"
	"strings"
	"testing"
	"time"
)

func metadataLifecycleFile160(id int) File {
	f := sample(id, fmt.Sprintf("Synthetic.%05d.1080p.x264.2.0.mkv", id))
	f.Service = "radarr"
	f.Size = 1 << 20
	f.SourcePath = fmt.Sprintf("/arr/Synthetic.%05d.mkv", id)
	return f
}
func seedLifecycleMetadata160(t *testing.T, s *Store, count int) {
	t.Helper()
	tx, e := s.DB.Begin()
	if e != nil {
		t.Fatal(e)
	}
	defer tx.Rollback()
	c, e := tx.Prepare("INSERT INTO field_confirmations(service,file_id,field,source,value,size,created) VALUES('radarr',?,'channels','mediainfo','5.1',?,?)")
	if e != nil {
		t.Fatal(e)
	}
	defer c.Close()
	m, e := tx.Prepare("INSERT INTO mediainfo_results(service,file_id,arr_path,size,scanned_at,version,data) VALUES('radarr',?,?,?,?,?,?)")
	if e != nil {
		t.Fatal(e)
	}
	defer m.Close()
	result := MediaInfoResult{mediaInfoResult: mediaInfoResult{Video: &MediaVideo{Width: 1920, Height: 1080, Resolution: "1080p", Codec: "x264", BitDepth: "8"}, AudioTracks: []AudioTrack{{Index: 1, Codec: "AC-3", Channels: 6, ChannelLayout: "5.1", Language: "Englisch"}}, Audio: "AC-3", Language: "Englisch"}, ScannedAt: 1793000000000, Version: "25.09"}
	raw, e := json.Marshal(result)
	if e != nil {
		t.Fatal(e)
	}
	for id := 1; id <= count; id++ {
		f := metadataLifecycleFile160(id)
		if _, e = c.Exec(id, f.Size, result.ScannedAt); e != nil {
			t.Fatal(e)
		}
		if _, e = m.Exec(id, f.SourcePath, f.Size, result.ScannedAt, result.Version, string(raw)); e != nil {
			t.Fatal(e)
		}
	}
	if e = tx.Commit(); e != nil {
		t.Fatal(e)
	}
}
func assertLifecycleMetadata160(t *testing.T, s *Store, count int) {
	t.Helper()
	for _, table := range []string{"field_confirmations", "mediainfo_results"} {
		var got int
		if e := s.DB.QueryRow("SELECT count(*) FROM " + table).Scan(&got); e != nil || got != count {
			t.Fatalf("%s retained %d, want%d: %v", table, got, count, e)
		}
	}
	q, e := s.Query(url.Values{"service": {"radarr"}, "confirmed": {"true"}}, "matches", false)
	if e != nil || q.Total != count {
		t.Fatalf("confirmed retained %d, want%d: %v", q.Total, count, e)
	}
	for _, f := range q.Files {
		if !f.Confirmed || f.MediaInfo == nil || f.Channels != "5.1" || f.Evidence["channels"].Confirmed == nil || f.Evidence["channels"].Confirmed.Source != "mediainfo" {
			t.Fatalf("metadata not reapplied to file %d: %+v", f.ID, f)
		}
	}
}

func TestPerformance50KMetadataLifecycle160(t *testing.T) {
	if os.Getenv("SCOPEARR_PERF") != "1" {
		t.Skip("set SCOPEARR_PERF=1 for 50,000 files with 500 saved confirmations and results")
	}
	s := testStore(t)
	files := make([]File, 50000)
	for i := range files {
		files[i] = metadataLifecycleFile160(i + 1)
	}
	if e := s.Replace("radarr", files, SyncStatus{Count: len(files)}); e != nil {
		t.Fatal(e)
	}
	seedLifecycleMetadata160(t, s, 500)
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
	e := s.Replace("radarr", files, SyncStatus{Count: len(files)})
	elapsed := time.Since(start)
	close(stop)
	<-done
	if e != nil {
		t.Fatal(e)
	}
	files = nil
	debug.FreeOSMemory()
	assertLifecycleMetadata160(t, s, 500)
	durations := make([]time.Duration, 30)
	for i := range durations {
		q := url.Values{"service": {"radarr"}, "confirmed": {"true"}}
		want := 500
		if i%2 == 1 {
			q.Set("confirmed", "false")
			want = 49500
		}
		start = time.Now()
		out, e := s.Query(q, "matches", false)
		durations[i] = time.Since(start)
		if e != nil || out.Total != want || len(out.Files) != 100 {
			t.Fatalf("confirmed filter count=%d want=%d rows=%d: %v", out.Total, want, len(out.Files), e)
		}
	}
	sort.Slice(durations, func(i, j int) bool { return durations[i] < durations[j] })
	where, args, e := s.scopedWhere(url.Values{"service": {"radarr"}, "confirmed": {"true"}})
	if e != nil {
		t.Fatal(e)
	}
	rows, e := s.DB.Query("EXPLAIN QUERY PLAN SELECT count(*) FROM files f WHERE "+where, args...)
	if e != nil {
		t.Fatal(e)
	}
	var plans []string
	for rows.Next() {
		var id, parent, unused int
		var detail string
		if e = rows.Scan(&id, &parent, &unused, &detail); e != nil {
			t.Fatal(e)
		}
		plans = append(plans, detail)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		t.Fatal(e)
	}
	t.Logf("50,000 files + 500 confirmations + 500 MediaInfo results: full sync=%s peak heap=%.2f MiB confirmed filter p95=%s plan=%s", elapsed, float64(peak)/(1<<20), durations[28], strings.Join(plans, "; "))
	if elapsed > 60*time.Second || peak > 512<<20 || durations[28] > 200*time.Millisecond {
		t.Fatal("metadata lifecycle performance budget exceeded")
	}
}

// These opt-in phases are used by work/check-rollback160.sh against the actual
// archived v1.5.1 sources; no approximate legacy structs substitute for that code.
func TestRollbackPrepare160(t *testing.T) {
	dir := os.Getenv("SCOPEARR_ROLLBACK_DATA")
	if dir == "" || os.Getenv("SCOPEARR_ROLLBACK_PHASE") != "prepare" {
		t.Skip("rollback preparation phase")
	}
	s, e := OpenStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer s.DB.Close()
	cfg := DefaultSettings()
	cfg.Instances = []ServiceConfig{{ID: "radarr", Type: "radarr", Name: "Synthetic rollback", Enabled: true, URL: "http://127.0.0.1:1", APIKey: "synthetic", Interval: 60, TagImportInterval: 5}}
	cfg.MediaInfo = MediaInfoSettings{Enabled: true, Channel: "edge"}
	uid, gid := 1000, 100
	cfg.Unraid.OwnerUID = &uid
	cfg.Unraid.OwnerGID = &gid
	if e = normalizeSettings(&cfg); e != nil {
		t.Fatal(e)
	}
	security, err := NewSecurity(s)
	if err != nil {
		t.Fatal(err)
	}
	cfg.Instances[0].APIKey = security.Seal("synthetic")
	if e = s.Put("settings", cfg); e != nil {
		t.Fatal(e)
	}
	f := metadataLifecycleFile160(1)
	if e = s.Replace("radarr", []File{f}, SyncStatus{Count: 1}); e != nil {
		t.Fatal(e)
	}
	seedLifecycleMetadata160(t, s, 1)
	if e = s.Replace("radarr", []File{f}, SyncStatus{Count: 1}); e != nil {
		t.Fatal(e)
	}
	assertLifecycleMetadata160(t, s, 1)
	s.Events.Flush()
	t.Log("prepared 1.6 database: schema18, additive metadata tables, MediaInfo edge enabled, owner1000:100")
}
func TestRollbackReopen160(t *testing.T) {
	dir := os.Getenv("SCOPEARR_ROLLBACK_DATA")
	if dir == "" || os.Getenv("SCOPEARR_ROLLBACK_PHASE") != "reopen" {
		t.Skip("rollback reopen phase")
	}
	s, e := OpenStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer s.DB.Close()
	var cfg Settings
	if e = s.Get("settings", &cfg); e != nil {
		t.Fatal(e)
	}
	if !cfg.MediaInfo.Enabled || cfg.MediaInfo.Channel != "edge" || cfg.Unraid.OwnerUID == nil || *cfg.Unraid.OwnerUID != 1000 {
		t.Fatalf("additive settings lost through rollback: %+v", cfg.MediaInfo)
	}
	var confirmations, results int
	if e = s.DB.QueryRow("SELECT count(*) FROM field_confirmations").Scan(&confirmations); e != nil {
		t.Fatal(e)
	}
	if e = s.DB.QueryRow("SELECT count(*) FROM mediainfo_results").Scan(&results); e != nil {
		t.Fatal(e)
	}
	if confirmations != 1 || results != 1 {
		t.Fatalf("rollback lost side tables: confirmations=%d results=%d", confirmations, results)
	}
	cached, e := s.Query(url.Values{"service": {"radarr"}}, "matches", false)
	if e != nil {
		t.Fatal(e)
	}
	if cached.Total != 1 || len(cached.Files) != 1 {
		t.Fatalf("startup cache count=%d rows=%d", cached.Total, len(cached.Files))
	}
	assertLifecycleMetadata160(t, s, 1)
	t.Logf("before any current sync, restored startup cache: confirmed=%v MediaInfo=%v", cached.Files[0].Confirmed, cached.Files[0].MediaInfo != nil)
	if err := normalizeMux(&cfg); err != nil {
		t.Fatal("MediaInfo settings normalization after rollback", err)
	}
	if !cfg.MediaInfo.Enabled || cfg.MediaInfo.Channel != "edge" {
		t.Fatal("normalization changed enabled MediaInfo", cfg.MediaInfo)
	}
	if e = s.Replace("radarr", []File{metadataLifecycleFile160(1)}, SyncStatus{Count: 1}); e != nil {
		t.Fatal(e)
	}
	assertLifecycleMetadata160(t, s, 1)
	if _, e = loadMediaInfo(context.Background(), s.DB, "radarr"); e != nil {
		t.Fatal(e)
	}
	t.Log("actual 1.5.1 startup/settings normalization/library sync accepted 1.6 database; re-upgrade retained and reapplied metadata")
}

func TestMediaInfoSettingsNormalization160(t *testing.T) {
	for _, tc := range []struct {
		channel, want string
		valid         bool
	}{
		{"", "stable", true}, {"stable", "stable", true}, {"edge", "edge", true}, {"nightly", "", false}, {"EDGE", "", false},
	} {
		cfg := DefaultSettings()
		cfg.MediaInfo = MediaInfoSettings{Enabled: true, Channel: tc.channel}
		err := normalizeMux(&cfg)
		if (err == nil) != tc.valid {
			t.Fatalf("channel %q validation: %v", tc.channel, err)
		}
		if tc.valid && (!cfg.MediaInfo.Enabled || cfg.MediaInfo.Channel != tc.want) {
			t.Fatalf("normalization lost enabled MediaInfo: %+v", cfg.MediaInfo)
		}
	}
}

func TestMediaInfoStartupAndSyncNeverReadFiles160(t *testing.T) {
	dir := t.TempDir()
	store, e := OpenStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer func() { store.DB.Close() }()
	mediaDir := muxTempDir120(t)
	f := metadataLifecycleFile160(1)
	local := filepath.Join(mediaDir, "Synthetic.00001.mkv")
	if e = os.WriteFile(local, nil, 0600); e != nil {
		t.Fatal(e)
	}
	if e = os.Truncate(local, f.Size); e != nil {
		t.Fatal(e)
	}
	cfg := DefaultSettings()
	cfg.Instances = []ServiceConfig{}
	cfg.MediaInfo = MediaInfoSettings{Enabled: true, Channel: "stable"}
	cfg.Mux.Mappings = "/arr => " + mediaDir
	if e = store.Put("settings", cfg); e != nil {
		t.Fatal(e)
	}
	if e = store.Replace("radarr", []File{f}, SyncStatus{Count: 1}); e != nil {
		t.Fatal(e)
	}
	seedLifecycleMetadata160(t, store, 1)
	// Simulate the old version's cache JSON without removing additive saved data.
	if _, e = store.DB.Exec("UPDATE files SET data=json_remove(data,'$.confirmed','$.mediaInfo')"); e != nil {
		t.Fatal(e)
	}
	toolBase := filepath.Join(dir, "tools", "mediainfo")
	root := filepath.Join(toolBase, "synthetic-root")
	if e = os.MkdirAll(filepath.Join(root, "usr", "bin"), 0700); e != nil {
		t.Fatal(e)
	}
	if e = os.MkdirAll(filepath.Join(root, "lib"), 0700); e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(filepath.Join(root, "usr", "bin", "mediainfo"), nil, 0700); e != nil {
		t.Fatal(e)
	}
	marker := filepath.Join(dir, "unexpected-mediainfo-execution")
	arch := "x86_64"
	if runtime.GOARCH == "arm64" {
		arch = "aarch64"
	}
	script := "#!/bin/sh\nprintf invoked >> '" + strings.ReplaceAll(marker, "'", "'\"'\"'") + "'\nexit 1\n"
	if e = os.WriteFile(filepath.Join(root, "lib", "ld-musl-"+arch+".so.1"), []byte(script), 0700); e != nil {
		t.Fatal(e)
	}
	if e = os.Symlink("synthetic-root", filepath.Join(toolBase, "current")); e != nil {
		t.Fatal(e)
	}
	raw, _ := json.Marshal(ToolStatus{Installed: true, Version: "25.09"})
	if e = os.WriteFile(filepath.Join(toolBase, "state.json"), raw, 0600); e != nil {
		t.Fatal(e)
	}
	if e = store.DB.Close(); e != nil {
		t.Fatal(e)
	}
	store, e = OpenStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	restored, e := store.muxFile("radarr", 1)
	if e != nil {
		t.Fatal(e)
	}
	if !restored.Confirmed || restored.MediaInfo == nil || restored.Channels != "5.1" {
		t.Fatalf("startup did not restore metadata: %+v", restored)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, e := NewServer(ctx, store, nil, "1.6.0-test")
	if e != nil {
		t.Fatal(e)
	}
	defer server.Sync.Shutdown()
	if !server.Config().MediaInfo.Enabled || !server.MediaInfo.toolStatus().Installed {
		t.Fatal("synthetic enabled tool not ready")
	}
	if e = store.Replace("radarr", []File{f}, SyncStatus{Count: 1}); e != nil {
		t.Fatal(e)
	}
	if _, e = os.Stat(marker); !os.IsNotExist(e) {
		t.Fatalf("startup or sync invoked MediaInfo: %v", e)
	}
	// Prove the execution marker is effective: only this explicit read runs it.
	if _, e = server.MediaInfo.read(ctx, server.Config(), f); e == nil {
		t.Fatal("synthetic runner should report its nonzero exit")
	}
	if _, e = os.Stat(marker); e != nil {
		t.Fatalf("explicit read did not invoke the installed test tool: %v", e)
	}
}

func TestMetadataRetainedAcrossWebhookDelta160(t *testing.T) {
	for _, all := range []bool{true, false} {
		t.Run(fmt.Sprint(all), func(t *testing.T) {
			s, err := OpenStore(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			defer s.DB.Close()
			first, other := metadataLifecycleFile160(1), metadataLifecycleFile160(2)
			first.MediaID = 1
			other.MediaID = 2
			seedLifecycleMetadata160(t, s, 2)
			if err = s.Replace("radarr", []File{first, other}, SyncStatus{}); err != nil {
				t.Fatal(err)
			}
			scope := &DeltaScope{MediaID: 1, All: all, FileIDs: []int{1}}
			if err = s.replaceContext(context.Background(), "radarr", []File{first}, SyncStatus{}, false, scope, nil); err != nil {
				t.Fatal(err)
			}
			assertLifecycleMetadata160(t, s, 2)
			for _, id := range []int{1, 2} {
				f, err := s.muxFile("radarr", id)
				if err != nil || !f.Confirmed || f.MediaInfo == nil || f.Channels != "5.1" {
					t.Fatalf("file%d lost metadata during delta: %+v %v", id, f, err)
				}
			}
		})
	}
}
