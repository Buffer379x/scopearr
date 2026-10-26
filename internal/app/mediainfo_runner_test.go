package app

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestMediaInfoRunnerLimitAndCancellation160(t *testing.T) {
	for _, tc := range []struct {
		name, script string
		timeout      time.Duration
		want         string
	}{
		{"limit", "head -c 4194305 /dev/zero", time.Second, "limit"},
		{"cancel", "trap '' TERM; sleep 30 & wait", 100 * time.Millisecond, "cancel"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), tc.timeout)
			defer cancel()
			started := time.Now()
			_, err := runMediaInfoCommand(ctx, exec.CommandContext(ctx, "/bin/sh", "-c", tc.script))
			if err == nil || !strings.Contains(strings.ToLower(err.Error()), tc.want) {
				t.Fatalf("err=%v", err)
			}
			if time.Since(started) > 3*time.Second {
				t.Fatalf("process group was not stopped promptly")
			}
		})
	}
}

type blockingMediaInfoRunner struct {
	started chan struct{}
	release chan struct{}
	once    sync.Once
	raw     []byte
}

func (r *blockingMediaInfoRunner) Read(ctx context.Context, _ string) ([]byte, error) {
	r.once.Do(func() { close(r.started) })
	select {
	case <-r.release:
		return r.raw, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func TestMediaInfoReadPrerequisitesAndLock160(t *testing.T) {
	s, _ := muxServer120(t)
	dir := muxTempDir120(t)
	local := filepath.Join(dir, "Movie.mkv")
	if err := os.WriteFile(local, []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	s.settings.MediaInfo.Enabled = true
	s.settings.Mux.Mappings = "/arr => " + dir
	s.mu.Unlock()
	manager := NewMediaInfoManager(s)
	manager.installer.status.Installed = true
	raw, _ := os.ReadFile("testdata/mediainfo/avc.json")
	runner := &blockingMediaInfoRunner{started: make(chan struct{}), release: make(chan struct{}), raw: raw}
	manager.testRunner = runner
	f := File{SourcePath: "/arr/Movie.mkv", Size: 7}
	done := make(chan error, 1)
	go func() { _, e := manager.read(context.Background(), s.Config(), f); done <- e }()
	<-runner.started
	if _, e := manager.read(context.Background(), s.Config(), f); !errors.Is(e, errMediaInfoBusy) {
		t.Fatalf("second read: %v", e)
	}
	if e := manager.toolAction("remove"); !errors.Is(e, errMediaInfoBusy) {
		t.Fatalf("remove while reading: %v", e)
	}
	close(runner.release)
	if e := <-done; e != nil {
		t.Fatal(e)
	}
	f.Size = 8
	if _, e := manager.read(context.Background(), s.Config(), f); e == nil {
		t.Fatal("accepted size mismatch")
	}
	f.Size = 7
	f.SourcePath = "/other/Movie.mkv"
	if _, e := manager.read(context.Background(), s.Config(), f); e == nil {
		t.Fatal("accepted unmapped path")
	}
	f.SourcePath = "/arr"
	if _, e := manager.read(context.Background(), s.Config(), f); e == nil {
		t.Fatal("accepted directory")
	}
}
