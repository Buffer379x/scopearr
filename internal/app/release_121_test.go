package app

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func TestMuxWorkNormalization121(t *testing.T) {
	for _, path := range []string{"", "/mux-work", "/media/tmp", "relative", "/data/x", "/tmp/x", "/", "/media/a\nb", strings.Repeat("/x", 513)} {
		cfg := DefaultSettings()
		cfg.Mux.WorkDir = path
		valid := path == "" || path == "/mux-work" || path == "/media/tmp"
		if e := normalizeMux(&cfg); (e == nil) != valid {
			t.Errorf("%q: %v", path, e)
		}
	}
	if muxForbidden("/media/movies") || muxForbidden("/mux-work") || !muxForbidden("/data/movies") {
		t.Fatal("mount policy")
	}
	cfg := DefaultSettings()
	cfg.Mux.WorkDir = "/media/a/../tmp"
	if e := normalizeMux(&cfg); e != nil || cfg.Mux.WorkDir != "/media/tmp" {
		t.Fatal(cfg.Mux, e)
	}
}
func TestMuxWorkChecks121(t *testing.T) {
	dir := muxTempDir120(t)
	src := filepath.Join(dir, "movie.mkv")
	os.WriteFile(src, []byte("original"), 0600)
	old := muxSpace
	t.Cleanup(func() { muxSpace = old })
	muxSpace = func(string) (uint64, error) { return 10 << 30, nil }
	work := filepath.Join(dir, "work")
	os.Mkdir(work, 0700)
	if !checkMuxFile(src, 8, MuxSource{}, work).Ready() {
		t.Fatal("valid workdir rejected")
	}
	c := checkMuxFile(src, 8, MuxSource{}, filepath.Join(dir, "missing"))
	if c.Ready() || c.WorkWritable || c.WorkFreeSpace {
		t.Fatal(c)
	}
	os.Chmod(work, 0500)
	c = checkMuxFile(src, 8, MuxSource{}, work)
	if c.Ready() || c.WorkWritable {
		t.Fatal(c)
	}
	os.Chmod(work, 0700)
	muxSpace = func(p string) (uint64, error) {
		if p == work {
			return 1, nil
		}
		return 10 << 30, nil
	}
	c = checkMuxFile(src, 8, MuxSource{}, work)
	if c.Ready() || c.WorkFreeSpace || !c.FreeSpace {
		t.Fatal(c)
	}
	muxSpace = func(p string) (uint64, error) {
		if p == work {
			return 10 << 30, nil
		}
		return 1, nil
	}
	c = checkMuxFile(src, 8, MuxSource{}, work)
	if c.Ready() || !c.WorkFreeSpace || c.FreeSpace {
		t.Fatal(c)
	}
	link := filepath.Join(dir, "link")
	os.Symlink("/tmp", link)
	if checkMuxWorkDir(link).Writable {
		t.Fatal("symlink bypass")
	}
}
func TestMuxWorkStaging121(t *testing.T) {
	for _, mode := range []string{"rename", "copy", "cancel", "mismatch", "destination-exists"} {
		t.Run(mode, func(t *testing.T) {
			dir := t.TempDir()
			out := filepath.Join(dir, "output")
			tmp := filepath.Join(dir, "staging")
			os.WriteFile(out, []byte("verified-output"), 0600)
			oldRename, oldCopy := muxRename, muxCopy
			t.Cleanup(func() { muxRename, muxCopy = oldRename, oldCopy })
			if mode != "rename" {
				muxRename = func(string, string) error { return syscall.EXDEV }
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if mode == "cancel" {
				muxCopy = func(w io.Writer, r io.Reader, b []byte) (int64, error) { cancel(); return io.CopyBuffer(w, r, b) }
			}
			if mode == "mismatch" {
				muxCopy = func(w io.Writer, r io.Reader, b []byte) (int64, error) {
					n, e := io.CopyBuffer(w, r, b)
					w.Write([]byte("extra"))
					return n, e
				}
			}
			if mode == "destination-exists" {
				os.WriteFile(tmp, []byte("other"), 0600)
			}
			e := stageMuxOutput(ctx, out, tmp, func(int64, int64) {})
			if mode == "rename" || mode == "copy" {
				if e != nil {
					t.Fatal(e)
				}
				b, _ := os.ReadFile(tmp)
				if string(b) != "verified-output" {
					t.Fatal(string(b))
				}
				if _, e = os.Stat(out); !os.IsNotExist(e) {
					t.Fatal("work output remains")
				}
			} else {
				if e == nil {
					t.Fatal("expected failure")
				}
				b, _ := os.ReadFile(out)
				if string(b) != "verified-output" {
					t.Fatal("verified work output changed")
				}
			}
			if mode == "destination-exists" {
				b, _ := os.ReadFile(tmp)
				if string(b) != "other" {
					t.Fatal("existing destination overwritten")
				}
			}
		})
	}
}
func TestMuxWorkExecution121(t *testing.T) {
	for _, mode := range []string{"rename", "copy", "cancel", "mismatch"} {
		t.Run(mode, func(t *testing.T) {
			s, _ := muxServer120(t)
			dir := muxTempDir120(t)
			work := muxTempDir120(t)
			src := filepath.Join(dir, "Movie.mkv")
			os.WriteFile(src, []byte("original"), 0600)
			source, spec := muxFixture120()
			st, _ := os.Stat(src)
			source.ModTime = st.ModTime()
			spec.OutputName = "Result"
			spec.DeleteOriginal = false
			f := sample(1, "Movie.mkv")
			f.SourcePath = "/arr/Movie.mkv"
			f.Size = 8
			f.MediaID = 10
			s.Store.Replace("radarr", []File{f}, SyncStatus{})
			arr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.Method + " " + r.URL.Path {
				case "POST /api/v3/command":
					io.WriteString(w, `{"id":3}`)
				case "GET /api/v3/command/3":
					io.WriteString(w, `{"id":3,"status":"completed"}`)
				default:
					t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
					w.WriteHeader(404)
				}
			}))
			defer arr.Close()
			s.mu.Lock()
			s.settings.Instances = []ServiceConfig{{ID: "radarr", Type: "radarr", Enabled: true, URL: arr.URL, APIKey: "test"}}
			s.settings.Mux.WorkDir = work
			s.settings.Mux.PathMappings["radarr"] = "/arr => " + dir
			s.settings.Mux.NotifyMedia = false
			s.mu.Unlock()
			s.Mux.testRunner = &fakeMux120{source: source}
			j := MuxJob{Service: "radarr", FileID: 1, MediaID: 10, SourceName: "Movie.mkv", Title: "Movie", Source: source, Spec: spec, Status: "running"}
			s.Store.muxSave(&j)
			oldRename, oldCopy, oldSpace := muxRename, muxCopy, muxSpace
			t.Cleanup(func() { muxRename, muxCopy, muxSpace = oldRename, oldCopy, oldSpace })
			muxSpace = func(string) (uint64, error) { return 10 << 30, nil }
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if mode != "rename" {
				muxRename = func(string, string) error { return syscall.EXDEV }
			}
			if mode == "cancel" {
				muxCopy = func(w io.Writer, r io.Reader, b []byte) (int64, error) { cancel(); return io.CopyBuffer(w, r, b) }
			}
			if mode == "mismatch" {
				muxCopy = func(w io.Writer, r io.Reader, b []byte) (int64, error) {
					n, e := io.CopyBuffer(w, r, b)
					w.Write([]byte("extra"))
					return n, e
				}
			}
			e := s.Mux.execute(ctx, &j)
			if mode == "rename" || mode == "copy" {
				if e != nil {
					t.Fatal(e)
				}
				b, _ := os.ReadFile(filepath.Join(dir, "Result.mkv"))
				if string(b) != "new-data" {
					t.Fatal(string(b))
				}
			} else {
				if e == nil {
					t.Fatal("expected error")
				}
				if _, e = os.Stat(filepath.Join(dir, "Result.mkv")); !os.IsNotExist(e) {
					t.Fatal("published invalid output")
				}
			}
			b, _ := os.ReadFile(src)
			if string(b) != "original" {
				t.Fatal("original modified")
			}
			if _, e = os.Stat(muxTemp(src, j)); !os.IsNotExist(e) {
				t.Fatal("staging remains")
			}
			if _, e = os.Stat(muxWorkDir(s.Config().Mux, j)); !os.IsNotExist(e) {
				t.Fatal("work directory remains")
			}
		})
	}
}
func TestMuxWorkRecovery121(t *testing.T) {
	s, _ := muxServer120(t)
	work := muxTempDir120(t)
	s.mu.Lock()
	s.settings.Mux.WorkDir = work
	s.mu.Unlock()
	base := filepath.Join(work, ".scopearr-mux")
	for _, name := range []string{"12", "004", "keep", "12x"} {
		os.MkdirAll(filepath.Join(base, name), 0700)
		os.WriteFile(filepath.Join(base, name, "partial"), []byte("data"), 0600)
	}
	os.WriteFile(filepath.Join(base, "123"), []byte("file"), 0600)
	s.Mux.recoverJobs()
	for _, name := range []string{"12", "004"} {
		if _, e := os.Stat(filepath.Join(base, name)); !os.IsNotExist(e) {
			t.Fatal(name)
		}
	}
	for _, name := range []string{"keep", "12x", "123"} {
		if _, e := os.Stat(filepath.Join(base, name)); e != nil {
			t.Fatal(name, e)
		}
	}
}
func TestMuxWorkSettingsBusy121(t *testing.T) {
	for _, status := range []string{"queued", "running"} {
		t.Run(status, func(t *testing.T) {
			s, _ := muxServer120(t)
			source, spec := muxFixture120()
			j := MuxJob{Service: "radarr", FileID: 1, MediaID: 10, Source: source, Spec: spec, Status: status}
			s.Store.muxSave(&j)
			request := func(cfg Settings) *httptest.ResponseRecorder {
				b, _ := json.Marshal(cfg)
				w := httptest.NewRecorder()
				s.settingsHTTP(w, httptest.NewRequest("PUT", "/api/settings", bytes.NewReader(b)))
				return w
			}
			cfg := s.Config()
			cfg.Mux.WorkDir = "/mux-work"
			w := request(cfg)
			if w.Code != 409 || !strings.Contains(w.Body.String(), "Wait for running mux jobs") {
				t.Fatal(w.Code, w.Body.String())
			}
			cfg = s.Config()
			cfg.Mux.KeepFinished = 9
			cfg.Mux.NotifyMedia = false
			cancelled := false
			s.Mux.cancel = func() { cancelled = true }
			s.Mux.checks[1] = muxCheckCache{}
			w = request(cfg)
			if w.Code != 200 || cancelled || len(s.Mux.checks) != 0 {
				t.Fatal(w.Code, w.Body.String(), cancelled)
			}
		})
	}
}
func TestMuxSettingsUnknownJSON121(t *testing.T) {
	// 1.2.0 Store.Get uses json.Unmarshal, which accepts unknown JSON fields.
	s := testStore(t)
	s.DB.Exec(`INSERT INTO kv(key,value) VALUES('old-settings','{"mux":{"workDir":"/mux-work"}}')`)
	var old struct {
		Mux struct {
			Enabled bool `json:"enabled"`
		} `json:"mux"`
	}
	if e := s.Get("old-settings", &old); e != nil {
		t.Fatal(e)
	}
}

func TestMuxRealSeparateQueue121(t *testing.T) {
	work := os.Getenv("SCOPEARR_MUX_WORK")
	if work == "" {
		t.Skip("Set SCOPEARR_MUX_WORK to a directory on a separate mount")
	}
	testMuxRealQueue(t, work)
}

func TestMuxPathResponse121(t *testing.T) {
	s, _ := muxServer120(t)
	dir := muxTempDir120(t)
	work := muxTempDir120(t)
	src := filepath.Join(dir, "Movie.mkv")
	os.WriteFile(src, []byte("original"), 0600)
	f := sample(1, "Movie.mkv")
	f.SourcePath = "/arr/Movie.mkv"
	f.Size = 8
	s.Store.Replace("radarr", []File{f}, SyncStatus{})
	s.mu.Lock()
	s.settings.Mux.WorkDir = work
	s.settings.Mux.PathMappings["radarr"] = "/arr => " + dir
	s.mu.Unlock()
	w := httptest.NewRecorder()
	s.muxHTTP(w, httptest.NewRequest("POST", "/api/mux/check-paths", nil))
	var result struct {
		Instances map[string][]MuxCheck `json:"instances"`
		WorkDir   MuxWorkCheck          `json:"workDir"`
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil || !result.WorkDir.Configured || !result.WorkDir.Exists || !result.WorkDir.Writable || len(result.Instances["radarr"]) != 1 {
		t.Fatal(w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), dir) || strings.Contains(w.Body.String(), "Movie.mkv") {
		t.Fatal("media path leaked", w.Body.String())
	}
}
