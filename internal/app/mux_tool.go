package app

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type MuxToolStatus = ToolStatus
type toolRunner struct{ root, base, binary string }

func (r *toolRunner) command(ctx context.Context, args ...string) *exec.Cmd {
	arch := "x86_64"
	if runtime.GOARCH == "arm64" {
		arch = "aarch64"
	}
	binary := r.binary
	if binary == "" {
		binary = "mkvmerge"
	}
	cmd := exec.CommandContext(ctx, filepath.Join(r.root, "lib/ld-musl-"+arch+".so.1"), append([]string{"--library-path", r.root + "/usr/lib:" + r.root + "/lib", r.root + "/usr/bin/" + binary}, args...)...)
	cmd.Env = []string{"HOME=" + r.base + "/home", "TMPDIR=" + r.base + "/tmp", "LANG=C.UTF-8", "LC_ALL=C.UTF-8"}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM) }
	cmd.WaitDelay = 10 * time.Second
	return cmd
}

type limitedMuxBuffer struct {
	b   bytes.Buffer
	max int
}

func (w *limitedMuxBuffer) Write(p []byte) (int, error) {
	n := len(p)
	left := w.max - w.b.Len()
	if left <= 0 {
		return 0, errors.New("Process output exceeds limit")
	}
	if len(p) > left {
		p = p[:left]
	}
	w.b.Write(p)
	if len(p) < n {
		return len(p), errors.New("Process output exceeds limit")
	}
	return n, nil
}
func (r *toolRunner) output(ctx context.Context, max int, args ...string) ([]byte, error) {
	cmd := r.command(ctx, args...)
	var b limitedMuxBuffer
	b.max = max
	cmd.Stdout = &b
	cmd.Stderr = io.Discard
	e := cmd.Run()
	return b.b.Bytes(), e
}

var muxVersionPattern = regexp.MustCompile(`^mkvmerge v(\d+(?:\.\d+)*)`)

func (r *toolRunner) Version(ctx context.Context) (string, error) {
	b, e := r.output(ctx, 4096, "--version")
	if e != nil {
		return "", e
	}
	m := muxVersionPattern.FindSubmatch(b)
	if len(m) < 2 {
		return "", errors.New("Invalid MKVToolNix version")
	}
	return string(m[1]), nil
}
func (r *toolRunner) Mux(ctx context.Context, args []string, progress func(int)) ([]string, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	cmd := r.command(ctx, args...)
	cmd.Dir = filepath.Dir(args[len(args)-1])
	pipe, e := cmd.StdoutPipe()
	if e != nil {
		return nil, e
	}
	cmd.Stderr = cmd.Stdout
	if e = cmd.Start(); e != nil {
		return nil, errors.New("Could not start MKVToolNix")
	}
	watchdog := time.AfterFunc(15*time.Minute, cancel)
	defer watchdog.Stop()
	scanner := bufio.NewScanner(pipe)
	scanner.Buffer(make([]byte, 4096), 256<<10)
	warnings := []string{}
	total := 0
	for scanner.Scan() {
		line := scanner.Text()
		muxLogLine(ctx, line)
		if strings.HasPrefix(line, "#GUI#progress ") {
			n, _ := strconv.Atoi(strings.TrimSuffix(strings.TrimPrefix(line, "#GUI#progress "), "%"))
			if n >= 0 && n <= 100 {
				progress(n)
				watchdog.Reset(15 * time.Minute)
			}
		}
		if strings.HasPrefix(line, "#GUI#warning") || strings.HasPrefix(line, "#GUI#error") {
			total += len(line)
			if total <= 16<<10 {
				warnings = append(warnings, line)
			}
		}
	}
	scanErr := scanner.Err()
	if scanErr != nil {
		cancel()
	}
	e = cmd.Wait()
	if scanErr != nil {
		return warnings, errors.New("Invalid or oversized MKVToolNix output")
	}
	if ctx.Err() != nil {
		return warnings, errors.New("Mux cancelled or stalled")
	}
	var exit *exec.ExitError
	if errors.As(e, &exit) && exit.ExitCode() == 1 {
		return warnings, nil
	}
	if e != nil {
		return warnings, errors.New("MKVToolNix failed")
	}
	return warnings, nil
}
func (m *MuxManager) toolBase() string { return filepath.Join(m.s.Store.Dir, "tools/mkvtoolnix") }
func (m *MuxManager) runner() muxRunner {
	if m.testRunner != nil {
		return m.testRunner
	}
	root, _ := filepath.EvalSymlinks(filepath.Join(m.toolBase(), "current"))
	return &toolRunner{root: root, base: m.toolBase(), binary: mkvtoolnixSpec.Binary}
}
func (m *MuxManager) toolStatus() MuxToolStatus { m.mu.Lock(); defer m.mu.Unlock(); return m.tool }
func muxBranch(channel string) (string, error) {
	if channel == "edge" {
		return "edge", nil
	}
	b, e := os.ReadFile("/etc/alpine-release")
	if e != nil {
		return "", errors.New("MKVToolNix installation requires Alpine Linux")
	}
	p := strings.Split(strings.TrimSpace(string(b)), ".")
	if len(p) < 2 {
		return "", errors.New("Unknown Alpine release")
	}
	return "v" + p[0] + "." + p[1], nil
}
func (m *MuxManager) toolAction(action string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.tool.Busy != "" || m.active != 0 {
		return errors.New("MKVToolNix is busy")
	}
	if m.s.Demo {
		return errors.New("Tool installation is disabled in demo mode")
	}
	if action != "install" && action != "update" && action != "remove" && action != "check" {
		return errors.New("Invalid tool action")
	}
	if !m.s.Config().Mux.Enabled && action != "remove" {
		return errors.New("Enable and save MKVToolNix first")
	}
	m.tool.Busy = map[string]string{"install": "installing", "update": "installing", "check": "checking", "remove": "removing"}[action]
	if action == "check" {
		now := time.Now().UTC()
		m.tool.CheckedAt = &now
	}
	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		ctx, cancel := context.WithTimeout(m.s.ctx, 10*time.Minute)
		defer cancel()
		var e error
		if action == "remove" {
			e = m.installer().remove()
		} else if action == "check" {
			e = m.checkTool(ctx)
		} else {
			e = m.installTool(ctx)
		}
		m.mu.Lock()
		defer m.mu.Unlock()
		m.tool.Busy = ""
		if e != nil {
			m.tool.Error = e.Error()
			m.s.Store.Events.Error("mux", "", "MKVToolNix action failed: {action}", map[string]any{"action": action}, "", e.Error())
		} else {
			m.tool.Error = ""
			if action == "remove" {
				m.tool = MuxToolStatus{}
			}
			if action != "check" {
				m.s.Store.Events.Info("mux", "", "MKVToolNix action completed: {action}", map[string]any{"action": action}, "")
			}
		}
	}()
	return nil
}
func (m *MuxManager) installer() *toolInstaller {
	return newToolInstaller(mkvtoolnixSpec, m.toolBase(), m.toolStatus())
}
func (m *MuxManager) installTool(ctx context.Context) error {
	installer := m.installer()
	if err := installer.install(ctx, m.s.Config().Mux.Channel); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	busy := m.tool.Busy
	m.tool = installer.toolStatus()
	m.tool.Busy = busy
	return nil
}
func (m *MuxManager) checkTool(ctx context.Context) error {
	installer := m.installer()
	if err := installer.check(ctx, m.s.Config().Mux.Channel); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	busy := m.tool.Busy
	m.tool = installer.toolStatus()
	m.tool.Busy = busy
	return nil
}
