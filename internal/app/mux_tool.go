package app

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
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

type MuxToolStatus struct {
	Installed       bool       `json:"installed"`
	Version         string     `json:"version"`
	Package         string     `json:"package"`
	Channel         string     `json:"channel"`
	Branch          string     `json:"branch"`
	Arch            string     `json:"arch"`
	Available       string     `json:"available"`
	UpdateAvailable bool       `json:"updateAvailable"`
	Upstream        string     `json:"upstream"`
	CheckedAt       *time.Time `json:"checkedAt"`
	Busy            string     `json:"busy"`
	Error           string     `json:"error"`
	SizeBytes       int64      `json:"sizeBytes"`
}
type toolRunner struct{ root, base string }

func (r *toolRunner) command(ctx context.Context, args ...string) *exec.Cmd {
	arch := "x86_64"
	if runtime.GOARCH == "arm64" {
		arch = "aarch64"
	}
	cmd := exec.CommandContext(ctx, filepath.Join(r.root, "lib/ld-musl-"+arch+".so.1"), append([]string{"--library-path", r.root + "/usr/lib:" + r.root + "/lib", r.root + "/usr/bin/mkvmerge"}, args...)...)
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
	return &toolRunner{root, m.toolBase()}
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
func apkMuxArgs(root, cache, branch string) []string {
	return []string{"add", "--root", root, "--initdb", "--usermode", "--no-scripts", "--no-interactive", "--keys-dir", "/etc/apk/keys", "--repository", "https://dl-cdn.alpinelinux.org/alpine/" + branch + "/main", "--repository", "https://dl-cdn.alpinelinux.org/alpine/" + branch + "/community", "--cache-dir", cache, "mkvtoolnix"}
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
			e = os.RemoveAll(m.toolBase())
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
		} else {
			m.tool.Error = ""
			if action == "remove" {
				m.tool = MuxToolStatus{}
			}
		}
	}()
	return nil
}
func (m *MuxManager) installTool(ctx context.Context) error {
	if runtime.GOARCH != "amd64" && runtime.GOARCH != "arm64" {
		return errors.New("Unsupported architecture")
	}
	base := m.toolBase()
	if e := os.MkdirAll(base, 0700); e != nil {
		return errors.New("Appdata is not writable")
	}
	free, e := muxSpace(base)
	if e != nil || free < 800<<20 {
		return errors.New("At least 800 MiB of free Appdata space is required")
	}
	channel := m.s.Config().Mux.Channel
	branch, e := muxBranch(channel)
	if e != nil {
		return e
	}
	root := filepath.Join(base, fmt.Sprintf("root-%d", time.Now().UnixNano()))
	cache := filepath.Join(base, "cache")
	os.MkdirAll(cache, 0700)
	os.MkdirAll(filepath.Join(base, "home"), 0700)
	os.MkdirAll(filepath.Join(base, "tmp"), 0700)
	success := false
	defer func() {
		if !success {
			os.RemoveAll(root)
		}
	}()
	cmd := exec.CommandContext(ctx, "/sbin/apk", apkMuxArgs(root, cache, branch)...)
	cmd.Env = []string{"PATH=/usr/bin:/bin:/sbin", "LANG=C.UTF-8", "LC_ALL=C.UTF-8"}
	var log limitedMuxBuffer
	log.max = 256 << 10
	cmd.Stdout = &log
	cmd.Stderr = &log
	e = cmd.Run()
	os.WriteFile(filepath.Join(base, "install.log"), log.b.Bytes(), 0600)
	if e != nil {
		return errors.New("Signed package download or installation failed")
	}
	runner := &toolRunner{root, base}
	version, e := runner.Version(ctx)
	if e != nil {
		if errors.Is(e, syscall.EACCES) {
			return errors.New("Appdata is mounted with noexec")
		}
		return errors.New("MKVToolNix self-test failed")
	}
	state := MuxToolStatus{Installed: true, Version: version, Channel: channel, Branch: branch, Arch: runtime.GOARCH}
	raw, _ := os.ReadFile(filepath.Join(root, "lib/apk/db/installed"))
	for _, paragraph := range strings.Split(string(raw), "\n\n") {
		if strings.Contains("\n"+paragraph+"\n", "\nP:mkvtoolnix\n") {
			for _, line := range strings.Split(paragraph, "\n") {
				if strings.HasPrefix(line, "V:") {
					state.Package = strings.TrimPrefix(line, "V:")
				}
			}
		}
	}
	filepath.WalkDir(root, func(path string, d os.DirEntry, e error) error {
		if e == nil && !d.IsDir() {
			if i, e := d.Info(); e == nil {
				state.SizeBytes += i.Size()
			}
		}
		return nil
	})
	next := filepath.Join(base, "current.new")
	os.Remove(next)
	if e = os.Symlink(filepath.Base(root), next); e != nil {
		return errors.New("Could not activate MKVToolNix")
	}
	old, _ := filepath.EvalSymlinks(filepath.Join(base, "current"))
	if e = os.Rename(next, filepath.Join(base, "current")); e != nil {
		return errors.New("Could not activate MKVToolNix")
	}
	success = true
	b, _ := json.Marshal(state)
	os.WriteFile(filepath.Join(base, "state.json"), b, 0600)
	if old != "" && old != root && filepath.Dir(old) == base {
		os.RemoveAll(old)
	}
	os.RemoveAll(cache)
	m.mu.Lock()
	busy := m.tool.Busy
	state.Busy = busy
	m.tool = state
	m.mu.Unlock()
	return nil
}
func (m *MuxManager) checkTool(ctx context.Context) error {
	branch, e := muxBranch(m.s.Config().Mux.Channel)
	if e != nil {
		return e
	}
	base := m.toolBase()
	os.MkdirAll(filepath.Join(base, "cache"), 0700)
	checkRoot := filepath.Join(base, "check-root")
	if e := os.MkdirAll(checkRoot, 0700); e != nil {
		return errors.New("Appdata is not writable")
	}
	defer os.RemoveAll(checkRoot)
	cmd := exec.CommandContext(ctx, "/sbin/apk", "search", "--root", checkRoot, "--keys-dir", "/etc/apk/keys", "--repository", "https://dl-cdn.alpinelinux.org/alpine/"+branch+"/main", "--repository", "https://dl-cdn.alpinelinux.org/alpine/"+branch+"/community", "--cache-dir", base+"/cache", "--update-cache", "-x", "mkvtoolnix")
	var b limitedMuxBuffer
	b.max = 64 << 10
	cmd.Env = []string{"PATH=/usr/bin:/bin:/sbin"}
	cmd.Stdout = &b
	cmd.Stderr = io.Discard
	e = cmd.Run()
	if e != nil {
		return errors.New("Could not check package updates")
	}
	available := ""
	for _, line := range strings.Split(b.b.String(), "\n") {
		if strings.HasPrefix(line, "mkvtoolnix-") {
			available = strings.TrimPrefix(line, "mkvtoolnix-")
		}
	}
	client := &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("Redirect rejected") }}
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://mkvtoolnix.download/latest-release.xml", nil)
	upstream := ""
	if res, e := client.Do(req); e == nil {
		defer res.Body.Close()
		var d struct {
			Version string `xml:"latest-source>version"`
		}
		if res.StatusCode == 200 && xml.NewDecoder(io.LimitReader(res.Body, 64<<10)).Decode(&d) == nil {
			upstream = d.Version
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now().UTC()
	m.tool.CheckedAt = &now
	m.tool.Available = available
	m.tool.Upstream = upstream
	compare := exec.CommandContext(ctx, "/sbin/apk", "version", "-t", m.tool.Package, available)
	out, _ := compare.Output()
	m.tool.UpdateAvailable = strings.TrimSpace(string(out)) == "<"
	return nil
}
