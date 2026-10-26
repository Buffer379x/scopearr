package app

import (
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
	"strings"
	"sync"
	"syscall"
	"time"
)

type ToolStatus struct {
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

type toolSpec struct {
	ID, Package, Binary, Label string
	VersionArgs                []string
	VersionPattern             *regexp.Regexp
	MinFree                    uint64
	Upstream                   func(context.Context) string
}

var mkvtoolnixSpec = toolSpec{ID: "mkvtoolnix", Package: "mkvtoolnix", Binary: "mkvmerge", Label: "MKVToolNix", VersionArgs: []string{"--version"}, VersionPattern: muxVersionPattern, MinFree: 850e6, Upstream: mkvtoolnixUpstream}
var mediainfoSpec = toolSpec{ID: "mediainfo", Package: "mediainfo", Binary: "mediainfo", Label: "MediaInfo", VersionArgs: []string{"--Version"}, VersionPattern: regexp.MustCompile(`MediaInfoLib - v(\d+(?:\.\d+)*)`), MinFree: 150e6, Upstream: mediaInfoUpstream}

type toolInstaller struct {
	spec   toolSpec
	base   string
	mu     sync.Mutex
	status ToolStatus
}

func newToolInstaller(spec toolSpec, base string, status ToolStatus) *toolInstaller {
	return &toolInstaller{spec: spec, base: base, status: status}
}
func (m *toolInstaller) toolStatus() ToolStatus { m.mu.Lock(); defer m.mu.Unlock(); return m.status }
func (m *toolInstaller) runner() *toolRunner {
	root, _ := filepath.EvalSymlinks(filepath.Join(m.base, "current"))
	return &toolRunner{root: root, base: m.base, binary: m.spec.Binary}
}
func (m *toolInstaller) remove() error {
	if err := os.RemoveAll(m.base); err != nil {
		return err
	}
	m.mu.Lock()
	m.status = ToolStatus{Busy: m.status.Busy}
	m.mu.Unlock()
	return nil
}
func (m *toolInstaller) version(ctx context.Context, r *toolRunner) (string, error) {
	raw, err := r.output(ctx, 4096, m.spec.VersionArgs...)
	if err != nil {
		return "", err
	}
	match := m.spec.VersionPattern.FindSubmatch(raw)
	if len(match) < 2 {
		return "", fmt.Errorf("Invalid %s version", m.spec.Label)
	}
	return string(match[1]), nil
}
func apkToolArgs(root, cache, branch, pkg string) []string {
	return []string{"add", "--root", root, "--initdb", "--usermode", "--no-scripts", "--no-interactive", "--keys-dir", "/etc/apk/keys", "--repository", "https://dl-cdn.alpinelinux.org/alpine/" + branch + "/main", "--repository", "https://dl-cdn.alpinelinux.org/alpine/" + branch + "/community", "--cache-dir", cache, pkg}
}
func upstreamResponse(ctx context.Context, url string, decode func(io.Reader) string) string {
	client := &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("Redirect rejected") }}
	req, e := http.NewRequestWithContext(ctx, "GET", url, nil)
	if e != nil {
		return ""
	}
	res, e := client.Do(req)
	if e != nil {
		return ""
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return ""
	}
	return decode(io.LimitReader(res.Body, 64<<10))
}
func mkvtoolnixUpstream(ctx context.Context) string {
	return upstreamResponse(ctx, "https://mkvtoolnix.download/latest-release.xml", func(r io.Reader) string {
		var d struct {
			Version string `xml:"latest-source>version"`
		}
		if xml.NewDecoder(r).Decode(&d) != nil {
			return ""
		}
		return d.Version
	})
}
func mediaInfoUpstream(ctx context.Context) string {
	return upstreamResponse(ctx, "https://api.github.com/repos/MediaArea/MediaInfo/releases/latest", func(r io.Reader) string {
		var d struct {
			Tag string `json:"tag_name"`
		}
		if json.NewDecoder(r).Decode(&d) != nil {
			return ""
		}
		return strings.TrimPrefix(d.Tag, "v")
	})
}
func (m *toolInstaller) install(ctx context.Context, channel string) error {
	if runtime.GOARCH != "amd64" && runtime.GOARCH != "arm64" {
		return errors.New("Unsupported architecture")
	}
	base := m.base
	if e := os.MkdirAll(base, 0700); e != nil {
		return errors.New("Appdata is not writable")
	}
	free, e := muxSpace(base)
	if e != nil || free < m.spec.MinFree {
		return fmt.Errorf("At least %d MB of free Appdata space is required", m.spec.MinFree/1000000)
	}
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
	cmd := exec.CommandContext(ctx, "/sbin/apk", apkToolArgs(root, cache, branch, m.spec.Package)...)
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
	runner := &toolRunner{root: root, base: base, binary: m.spec.Binary}
	version, e := m.version(ctx, runner)
	if e != nil {
		if errors.Is(e, syscall.EACCES) {
			return errors.New("Appdata is mounted with noexec")
		}
		return fmt.Errorf("%s self-test failed", m.spec.Label)
	}
	state := ToolStatus{Installed: true, Version: version, Channel: channel, Branch: branch, Arch: runtime.GOARCH}
	raw, _ := os.ReadFile(filepath.Join(root, "lib/apk/db/installed"))
	for _, paragraph := range strings.Split(string(raw), "\n\n") {
		if strings.Contains("\n"+paragraph+"\n", "\nP:"+m.spec.Package+"\n") {
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
		return fmt.Errorf("Could not activate %s", m.spec.Label)
	}
	old, _ := filepath.EvalSymlinks(filepath.Join(base, "current"))
	if e = os.Rename(next, filepath.Join(base, "current")); e != nil {
		return fmt.Errorf("Could not activate %s", m.spec.Label)
	}
	success = true
	b, _ := json.Marshal(state)
	os.WriteFile(filepath.Join(base, "state.json"), b, 0600)
	if old != "" && old != root && filepath.Dir(old) == base {
		os.RemoveAll(old)
	}
	os.RemoveAll(cache)
	m.mu.Lock()
	busy := m.status.Busy
	state.Busy = busy
	m.status = state
	m.mu.Unlock()
	return nil
}
func (m *toolInstaller) check(ctx context.Context, channel string) error {
	branch, e := muxBranch(channel)
	if e != nil {
		return e
	}
	base := m.base
	os.MkdirAll(filepath.Join(base, "cache"), 0700)
	checkRoot := filepath.Join(base, "check-root")
	if e := os.MkdirAll(checkRoot, 0700); e != nil {
		return errors.New("Appdata is not writable")
	}
	defer os.RemoveAll(checkRoot)
	cmd := exec.CommandContext(ctx, "/sbin/apk", "search", "--root", checkRoot, "--keys-dir", "/etc/apk/keys", "--repository", "https://dl-cdn.alpinelinux.org/alpine/"+branch+"/main", "--repository", "https://dl-cdn.alpinelinux.org/alpine/"+branch+"/community", "--cache-dir", base+"/cache", "--update-cache", "-x", m.spec.Package)
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
		if strings.HasPrefix(line, m.spec.Package+"-") {
			available = strings.TrimPrefix(line, m.spec.Package+"-")
		}
	}
	upstream := ""
	if m.spec.Upstream != nil {
		upstream = m.spec.Upstream(ctx)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now().UTC()
	m.status.CheckedAt = &now
	m.status.Available = available
	m.status.Upstream = upstream
	compare := exec.CommandContext(ctx, "/sbin/apk", "version", "-t", m.status.Package, available)
	out, _ := compare.Output()
	m.status.UpdateAvailable = strings.TrimSpace(string(out)) == "<"
	return nil
}
