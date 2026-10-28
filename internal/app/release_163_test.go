package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

// A create/unlink probe leaves names unchanged but changes the directory mtime.
func mediaUnchanged163(t *testing.T, dir string, check func()) {
	t.Helper()
	before, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	stamp := time.Unix(946684800, 0)
	if err = os.Chtimes(dir, stamp, stamp); err != nil {
		t.Fatal(err)
	}
	check()
	after, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	names := func(entries []os.DirEntry) []string {
		out := []string{}
		for _, entry := range entries {
			out = append(out, entry.Name())
		}
		return out
	}
	if !reflect.DeepEqual(names(before), names(after)) {
		t.Error("media check changed directory entries", names(after))
	}
	info, err := os.Stat(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !info.ModTime().Equal(stamp) {
		t.Errorf("media check changed directory mtime: %v", info.ModTime())
	}
}

func TestMediaChecksLeaveDirectoriesUntouched163(t *testing.T) {
	for _, operation := range []string{"mark", "job", "rename-preview", "mapping"} {
		t.Run(operation, func(t *testing.T) {
			x := newRenameFixture(t, "radarr")
			source, _ := muxFixture120()
			x.s.Mux.testRunner = &fakeMux120{source: source}
			x.s.Mux.tool.Installed = true
			mediaUnchanged163(t, x.dir, func() {
				switch operation {
				case "mark":
					w := httptest.NewRecorder()
					x.s.muxHTTP(w, httptest.NewRequest("POST", "/api/mux/jobs", bytes.NewBufferString(`{"service":"radarr","fileId":1}`)))
					if w.Code != 201 {
						t.Fatal(w.Code, w.Body)
					}
				case "job":
					if check := x.s.Mux.checkJob(MuxJob{Service: "radarr", FileID: 1}); !check.Ready() {
						t.Fatal(check)
					}
				case "rename-preview":
					w := x.request(t, true, renameRequest{Name: "New"})
					if w.Code != 200 {
						t.Fatal(w.Code, w.Body)
					}
				case "mapping":
					cfg := x.s.Config()
					cfg.Instances = nil // Root-folder transport is unrelated to this directory probe.
					setTestSettings(x.s, cfg)
					body, _ := json.Marshal(map[string]string{"mappings": "/arr => " + x.dir})
					w := httptest.NewRecorder()
					x.s.muxPathHTTP(w, httptest.NewRequest("POST", "/api/mux/check-paths", bytes.NewReader(body)), "check-paths")
					if w.Code != 200 {
						t.Fatal(w.Code, w.Body)
					}
					var result struct{ Mappings []muxMappingCheck }
					if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil || len(result.Mappings) != 1 || !result.Mappings[0].Writable {
						t.Fatal(result, err)
					}
				}
			})
		})
	}
}

func TestDirectoryCheckHonorsAccessErrors163(t *testing.T) {
	dir := muxTempDir120(t)
	old := placementAccess
	t.Cleanup(func() { placementAccess = old })
	for _, accessErr := range []error{unix.EACCES, unix.EROFS, unix.ENOTSUP} {
		t.Run(accessErr.Error(), func(t *testing.T) {
			placementAccess = func(path string, mode uint32) error {
				if path != dir || mode != 3 {
					t.Errorf("wrong effective-access check: %s %d", path, mode)
				}
				return accessErr
			}
			if checkMuxMapping(pathMapping{arr: "/arr", emby: dir}, false).Writable {
				t.Fatal("failed access check reported writable")
			}
		})
	}
}

func TestDirectoryModeAndForbiddenSymlink163(t *testing.T) {
	dir := muxTempDir120(t)
	if err := os.Chmod(dir, 0555); err != nil {
		t.Fatal(err)
	}
	if checkMuxMapping(pathMapping{arr: "/arr", emby: dir}, false).Writable {
		t.Fatal("directory without write bits accepted")
	}
	link := filepath.Join(muxTempDir120(t), "forbidden")
	if err := os.Symlink("/etc", link); err != nil {
		t.Fatal(err)
	}
	if checkMuxMapping(pathMapping{arr: "/arr", emby: link}, false).Writable {
		t.Fatal("forbidden symlink accepted")
	}
}

func TestMuxWorkDirectoryRetainsWriteProbe163(t *testing.T) {
	dir := muxTempDir120(t)
	stamp := time.Unix(946684800, 0)
	if err := os.Chtimes(dir, stamp, stamp); err != nil {
		t.Fatal(err)
	}
	if !checkMuxWorkDir(dir).Writable {
		t.Fatal("writable work directory rejected")
	}
	info, _ := os.Stat(dir)
	if info.ModTime().Equal(stamp) {
		t.Fatal("working directory was not actually write-probed")
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 0 {
		t.Fatal("working directory probe was not cleaned up")
	}
}

type markRunner163 struct {
	fakeMux120
	identified string
}

func (r *markRunner163) Identify(ctx context.Context, path string) (MuxSource, error) {
	r.identified = path
	return r.fakeMux120.Identify(ctx, path)
}

func TestMuxMarkUsesPhysicalCheckAndReadOnlyIdentify163(t *testing.T) {
	s, cfg := placementFixture130(t)
	placementWrite130(t, cfg, "disk6", "Film.mkv", "original")
	physical := filepath.Join(cfg.Unraid.DiskRoot, "disk6/movies/Film/Film.mkv")
	local := filepath.Join(cfg.Unraid.ShareRoot, "movies/Film/Film.mkv")
	if err := os.MkdirAll(filepath.Dir(local), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(local, []byte("original"), 0640); err != nil {
		t.Fatal(err)
	}
	info, _ := os.Stat(physical)
	if err := os.Chtimes(local, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	cfg.Unraid.MuxSameDisk = true
	setTestSettings(s, cfg)
	f := sample(1, "Film.mkv")
	f.Service, f.SourcePath, f.Size = "radarr", "/arr/movies/Film/Film.mkv", 8
	if err := s.Store.Replace("radarr", []File{f}, SyncStatus{}); err != nil {
		t.Fatal(err)
	}
	source, _ := muxFixture120()
	runner := &markRunner163{fakeMux120: fakeMux120{source: source}}
	s.Mux.testRunner, s.Mux.tool.Installed = runner, true
	old := placementAccess
	t.Cleanup(func() { placementAccess = old })
	checked := []string{}
	placementAccess = func(path string, mode uint32) error {
		checked = append(checked, path)
		if path == filepath.Dir(local) {
			return unix.EACCES
		}
		return old(path, mode)
	}
	mediaUnchanged163(t, filepath.Dir(local), func() {
		mediaUnchanged163(t, filepath.Dir(physical), func() {
			w := httptest.NewRecorder()
			s.muxHTTP(w, httptest.NewRequest("POST", "/api/mux/jobs", bytes.NewBufferString(`{"service":"radarr","fileId":1}`)))
			var job MuxJob
			if w.Code != 201 || json.Unmarshal(w.Body.Bytes(), &job) != nil {
				t.Fatal(w.Code, w.Body)
			}
			if job.Check.OutputDisk != "disk6" {
				t.Error("mark did not check the original disk", job.Check)
			}
		})
	})
	if !reflect.DeepEqual(checked, []string{filepath.Dir(physical)}) {
		t.Error("wrong write-check path", checked)
	}
	if runner.identified != local {
		t.Error("Identify should keep the read-only user-share source", runner.identified)
	}
}

func TestMediaReadOnlyMount163(t *testing.T) {
	dir := os.Getenv("SCOPEARR_READONLY_163")
	if dir == "" {
		t.Skip("extra integration invocation supplies a real read-only media mount")
	}
	if checkMuxMapping(pathMapping{arr: "/arr", emby: dir}, false).Writable {
		t.Fatal("actual read-only mount reported writable")
	}
}
