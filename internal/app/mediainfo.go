package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

var errMediaInfoBusy = errors.New("Another file is being read")

type mediaInfoRunner interface {
	Read(context.Context, string) ([]byte, error)
}
type installedMediaInfoRunner struct{ runner *toolRunner }

func (r installedMediaInfoRunner) Read(ctx context.Context, path string) ([]byte, error) {
	return runMediaInfoCommand(ctx, r.runner.command(ctx, "--Output=JSON", "--Full", path))
}

type mediaInfoOutput struct {
	limitedMuxBuffer
	kill     func()
	exceeded bool
}

func (w *mediaInfoOutput) Write(p []byte) (int, error) {
	n, e := w.limitedMuxBuffer.Write(p)
	if e != nil {
		w.exceeded = true
		w.kill()
	}
	return n, e
}
func runMediaInfoCommand(ctx context.Context, cmd *exec.Cmd) ([]byte, error) {
	return runMediaInfoProcess(ctx, cmd, mediaInfoOutputLimit)
}
func runMediaInfoProcess(ctx context.Context, cmd *exec.Cmd, maxOutput int) ([]byte, error) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	kill := func() error {
		if cmd.Process == nil {
			return os.ErrProcessDone
		}
		return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
	cmd.Cancel = kill
	cmd.WaitDelay = time.Second
	output := &mediaInfoOutput{limitedMuxBuffer: limitedMuxBuffer{max: maxOutput}, kill: func() { _ = kill() }}
	cmd.Stdout = output
	cmd.Stderr = io.Discard
	e := cmd.Run()
	if ctx.Err() != nil {
		return nil, errors.New("MediaInfo read cancelled or timed out")
	}
	if output.exceeded {
		return nil, errors.New("MediaInfo output exceeds limit")
	}
	if e != nil {
		return nil, errors.New("MediaInfo could not read this file")
	}
	return output.b.Bytes(), nil
}

type MediaInfoManager struct {
	s               *Server
	installer       *toolInstaller
	mu              sync.Mutex
	reading         bool
	wg              sync.WaitGroup
	testRunner      mediaInfoRunner
	testFSCommand   func(context.Context) *exec.Cmd
	testReadTimeout time.Duration
}

func NewMediaInfoManager(s *Server) *MediaInfoManager {
	base := filepath.Join(s.Store.Dir, "tools", "mediainfo")
	var status ToolStatus
	if raw, e := os.ReadFile(filepath.Join(base, "state.json")); e == nil {
		_ = json.Unmarshal(raw, &status)
	}
	status.Busy = ""
	if _, e := os.Stat(filepath.Join(base, "current", "usr", "bin", "mediainfo")); e != nil {
		status.Installed = false
	}
	return &MediaInfoManager{s: s, installer: newToolInstaller(mediainfoSpec, base, status)}
}
func (m *MediaInfoManager) Wait()                  { m.wg.Wait() }
func (m *MediaInfoManager) toolStatus() ToolStatus { return m.installer.toolStatus() }
func (m *MediaInfoManager) toolAction(action string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.reading || m.installer.toolStatus().Busy != "" {
		return errMediaInfoBusy
	}
	if m.s.Demo {
		return errors.New("Tool installation is disabled in demo mode")
	}
	if action != "install" && action != "update" && action != "remove" && action != "check" {
		return errors.New("Invalid tool action")
	}
	cfg := m.s.Config()
	if !cfg.MediaInfo.Enabled && action != "remove" {
		return errors.New("Enable and save MediaInfo first")
	}
	m.installer.mu.Lock()
	m.installer.status.Busy = map[string]string{"install": "installing", "update": "installing", "remove": "removing", "check": "checking"}[action]
	m.installer.mu.Unlock()
	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		ctx, cancel := context.WithTimeout(m.s.ctx, 10*time.Minute)
		defer cancel()
		var e error
		switch action {
		case "remove":
			e = m.installer.remove()
		case "check":
			e = m.installer.check(ctx, cfg.MediaInfo.Channel)
		default:
			e = m.installer.install(ctx, cfg.MediaInfo.Channel)
		}
		m.mu.Lock()
		defer m.mu.Unlock()
		m.installer.mu.Lock()
		m.installer.status.Busy = ""
		m.installer.status.Error = ""
		if e != nil {
			m.installer.status.Error = e.Error()
		}
		m.installer.mu.Unlock()
		if e != nil {
			m.s.Store.Events.Error("mediainfo", "", "MediaInfo action failed: {action}", map[string]any{"action": action}, "", e.Error())
		} else {
			m.s.Store.Events.Info("mediainfo", "", "MediaInfo action completed: {action}", map[string]any{"action": action}, "")
		}
	}()
	return nil
}
func (m *MediaInfoManager) read(ctx context.Context, cfg Settings, f File) (mediaInfoResult, error) {
	m.mu.Lock()
	if m.reading || m.installer.toolStatus().Busy != "" {
		m.mu.Unlock()
		return mediaInfoResult{}, errMediaInfoBusy
	}
	if m.s.Demo {
		m.mu.Unlock()
		return mediaInfoResult{}, errors.New("MediaInfo reads are disabled in demo mode")
	}
	if !cfg.MediaInfo.Enabled {
		m.mu.Unlock()
		return mediaInfoResult{}, errors.New("Enable and save MediaInfo first")
	}
	if !m.installer.toolStatus().Installed {
		m.mu.Unlock()
		return mediaInfoResult{}, errors.New("Install MediaInfo under Settings → Services → MediaInfo")
	}
	m.reading = true
	m.wg.Add(1)
	m.mu.Unlock()
	defer func() { m.mu.Lock(); m.reading = false; m.mu.Unlock(); m.wg.Done() }()
	budget := 120 * time.Second
	if m.testReadTimeout > 0 {
		budget = m.testReadTimeout
	}
	ctx, cancel := context.WithTimeout(ctx, budget)
	defer cancel()
	if f.SourcePath == "" {
		return mediaInfoResult{}, errors.New("This file has no source path")
	}
	before, e := m.probeFilesystem(ctx, cfg.Mux, f)
	if e != nil {
		return mediaInfoResult{}, e
	}
	if !before.Regular {
		return mediaInfoResult{}, errors.New("Media file is not reachable or is not a regular file")
	}
	if before.Size != f.Size {
		return mediaInfoResult{}, errors.New("Media file size differs from the cached Arr file; sync the library first")
	}
	local := before.Local
	runner := m.testRunner
	if runner == nil {
		runner = installedMediaInfoRunner{runner: m.installer.runner()}
	}
	raw, e := runner.Read(ctx, local)
	if e != nil {
		return mediaInfoResult{}, e
	}
	if ctx.Err() != nil {
		return mediaInfoResult{}, errors.New("MediaInfo read cancelled or timed out")
	}
	after, e := m.probeFilesystem(ctx, cfg.Mux, f)
	if e != nil {
		return mediaInfoResult{}, e
	}
	if !before.sameFile(after) {
		return mediaInfoResult{}, errors.New("Media file changed while it was being read")
	}
	return parseMediaInfo(raw)
}
