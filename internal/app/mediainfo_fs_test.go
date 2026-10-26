package app

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestMediaInfoFilesystemTimeoutReleasesReader160(t *testing.T) {
	for _, stage := range []int{1, 2} {
		t.Run(map[int]string{1: "preflight", 2: "postflight"}[stage], func(t *testing.T) {
			s, _ := muxServer120(t)
			dir := muxTempDir120(t)
			if e := os.WriteFile(filepath.Join(dir, "Movie.mkv"), []byte("fixture"), 0600); e != nil {
				t.Fatal(e)
			}
			cfg := s.Config()
			cfg.MediaInfo.Enabled = true
			cfg.Mux.Mappings = "/arr => " + dir
			manager := NewMediaInfoManager(s)
			manager.installer.status.Installed = true
			raw, e := os.ReadFile("testdata/mediainfo/avc.json")
			if e != nil {
				t.Fatal(e)
			}
			release := make(chan struct{})
			close(release)
			manager.testRunner = &blockingMediaInfoRunner{started: make(chan struct{}), release: release, raw: raw}
			manager.testReadTimeout = 500 * time.Millisecond
			probes := 0
			manager.testFSCommand = func(ctx context.Context) *exec.Cmd {
				probes++
				if probes == stage {
					return exec.CommandContext(ctx, "/bin/sh", "-c", "trap '' TERM; sleep 30 & wait")
				}
				return mediaInfoFilesystemCommand(ctx)
			}
			// The request itself has no deadline: the manager's single total budget must
			// cover either hanging filesystem phase and release the reader/install lock.
			started := time.Now()
			_, e = manager.read(context.Background(), cfg, File{Service: "radarr", SourcePath: "/arr/Movie.mkv", Size: 7})
			if e == nil || !strings.Contains(strings.ToLower(e.Error()), "timed out") {
				t.Fatalf("hanging stage returned %v", e)
			}
			if probes != stage {
				t.Fatalf("timed out before intended filesystem stage %d (reached %d)", stage, probes)
			}
			if time.Since(started) > 2*time.Second {
				t.Fatal("filesystem timeout did not kill process group promptly")
			}
			manager.testFSCommand = nil
			manager.testReadTimeout = 2 * time.Second
			if _, e = manager.read(context.Background(), cfg, File{Service: "radarr", SourcePath: "/arr/Movie.mkv", Size: 7}); e != nil {
				t.Fatalf("reader remained unavailable after timeout: %v", e)
			}
		})
	}
}

func TestMediaInfoFilesystemProbePreservesPathGuards160(t *testing.T) {
	root := muxTempDir120(t)
	outside := muxTempDir120(t)
	file := filepath.Join(root, "Movie.mkv")
	if e := os.WriteFile(file, []byte("fixture"), 0600); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(filepath.Join(outside, "Outside.mkv"), []byte("outside"), 0600); e != nil {
		t.Fatal(e)
	}
	if e := os.Symlink(filepath.Join(outside, "Outside.mkv"), filepath.Join(root, "Escape.mkv")); e != nil {
		t.Fatal(e)
	}
	if e := os.Symlink(root, filepath.Join(root, "Alias")); e != nil {
		t.Fatal(e)
	}
	s, _ := muxServer120(t)
	manager := NewMediaInfoManager(s)
	cfg := MuxSettings{Mappings: "/arr => " + root}
	for _, arr := range []string{"/arr/Movie.mkv", "/arr/Alias/Movie.mkv", "/arr/Escape.mkv", "/arr/Missing.mkv", "/arr", "/other/Movie.mkv"} {
		want, e := resolveLocalPath(cfg, "radarr", arr)
		got, probeErr := manager.probeFilesystem(context.Background(), cfg, File{Service: "radarr", SourcePath: arr})
		if (e == nil) != (probeErr == nil) {
			t.Fatalf("guard mismatch for %q: existing=%v helper=%v", arr, e, probeErr)
		}
		if e == nil && got.Local != want {
			t.Fatalf("resolved %q to %q, want %q", arr, got.Local, want)
		}
	}
}

func TestMediaInfoFilesystemProbeDetectsReplacement160(t *testing.T) {
	s, _ := muxServer120(t)
	manager := NewMediaInfoManager(s)
	root := muxTempDir120(t)
	file := filepath.Join(root, "Movie.mkv")
	if e := os.WriteFile(file, []byte("fixture"), 0600); e != nil {
		t.Fatal(e)
	}
	cfg := MuxSettings{Mappings: "/arr => " + root}
	f := File{Service: "radarr", SourcePath: "/arr/Movie.mkv"}
	before, e := manager.probeFilesystem(context.Background(), cfg, f)
	if e != nil {
		t.Fatal(e)
	}
	replacement := filepath.Join(root, "replacement")
	if e = os.WriteFile(replacement, []byte("fixture"), 0600); e != nil {
		t.Fatal(e)
	}
	if e = os.Rename(replacement, file); e != nil {
		t.Fatal(e)
	}
	after, e := manager.probeFilesystem(context.Background(), cfg, f)
	if e != nil {
		t.Fatal(e)
	}
	if before.sameFile(after) {
		t.Fatal("replacement with equal size was treated as unchanged")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e = manager.probeFilesystem(ctx, cfg, f); e == nil || errors.Is(e, errMediaInfoBusy) {
		t.Fatalf("canceled filesystem probe: %v", e)
	}
}
