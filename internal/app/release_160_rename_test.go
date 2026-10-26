package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

// The user-share view is a separate tree, as shfs would expose it; physical
// copies preserve mtime and size so disk resolution can identify each file.
func renameDisks160(t *testing.T) (*renameFixture, string) {
	t.Helper()
	x := newRenameFixture(t, "radarr")
	root := muxTempDir120(t)
	for _, device := range []string{"user", "disk1", "cache"} {
		if err := os.Mkdir(filepath.Join(root, device), 0700); err != nil {
			t.Fatal(err)
		}
	}
	old := unraidIsMount
	unraidIsMount = func(_, child string) bool { return filepath.Base(child) != "user" }
	t.Cleanup(func() { unraidIsMount = old })
	x.s.mu.Lock()
	x.s.settings.Unraid.Enabled = true
	x.s.settings.Unraid.DiskRoot = root
	x.s.settings.Unraid.ShareRoot = filepath.Dir(x.dir)
	x.s.mu.Unlock()
	copyRename160(t, x, root, "disk1", "Old.mkv")
	return x, root
}
func renameDiskFile160(x *renameFixture, root, device, name string) string {
	return filepath.Join(root, device, filepath.Base(x.dir), name)
}
func copyRename160(t *testing.T, x *renameFixture, root, device, name string) {
	t.Helper()
	source := filepath.Join(x.dir, name)
	content, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(source)
	if err != nil {
		t.Fatal(err)
	}
	dest := renameDiskFile160(x, root, device, name)
	if err = os.MkdirAll(filepath.Dir(dest), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(dest, content, 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.Chtimes(dest, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
}
func assertRenameFile160(t *testing.T, path, content string) {
	t.Helper()
	got, err := os.ReadFile(path)
	if content == "" {
		if !os.IsNotExist(err) {
			t.Fatalf("unexpected file %s: %v", path, err)
		}
		return
	}
	if err != nil || string(got) != content {
		t.Fatalf("%s: %q %v", path, got, err)
	}
}
func TestRelease160RenamePhysicalDevices(t *testing.T) {
	for _, rollback := range []bool{false, true} {
		t.Run(map[bool]string{false: "success", true: "rollback"}[rollback], func(t *testing.T) {
			x, root := renameDisks160(t)
			for _, name := range []string{"Old.de.srt", "Old.nfo"} {
				if err := os.WriteFile(filepath.Join(x.dir, name), []byte(name), 0600); err != nil {
					t.Fatal(err)
				}
				copyRename160(t, x, root, "cache", name)
			}
			fs := defaultRenameFS()
			fs.link = func(string, string) error { t.Error("physical rename attempted a hardlink"); return syscall.EIO }
			if rollback {
				fs.noReplace = func(a, b string) error {
					if filepath.Base(a) == "Old.nfo" {
						return syscall.EIO
					}
					return os.Rename(a, b)
				}
			}
			x.s.testRenameFS = &fs
			in := renameRequest{Name: "New", Companions: true, CompanionNames: []string{"Old.de.srt", "Old.nfo"}}
			preview := x.request(t, true, in)
			var p struct {
				Device     string
				UserShare  bool
				Companions []struct{ From, Device string }
			}
			if err := json.Unmarshal(preview.Body.Bytes(), &p); err != nil {
				t.Fatal(err)
			}
			if preview.Code != 200 || p.Device != "disk1" || p.UserShare || len(p.Companions) != 2 || p.Companions[0].Device != "cache" {
				t.Fatalf("missing physical preview: %d %s", preview.Code, preview.Body)
			}
			response := x.request(t, false, in)
			wantCode, prefix, absent := 200, "New", "Old"
			if rollback {
				wantCode, prefix, absent = 400, "Old", "New"
			}
			if response.Code != wantCode {
				t.Fatal(response.Code, response.Body)
			}
			assertRenameFile160(t, renameDiskFile160(x, root, "disk1", prefix+".mkv"), "original")
			assertRenameFile160(t, renameDiskFile160(x, root, "disk1", absent+".mkv"), "")
			for _, suffix := range []string{".de.srt", ".nfo"} {
				assertRenameFile160(t, renameDiskFile160(x, root, "cache", prefix+suffix), "Old"+suffix)
				assertRenameFile160(t, renameDiskFile160(x, root, "cache", absent+suffix), "")
			}
			if x.commands.Load() != map[bool]int32{false: 1, true: 0}[rollback] {
				t.Fatal("unexpected rescan")
			}
		})
	}
}
func TestRelease160RenameNoCacheFolder(t *testing.T) {
	x, root := renameDisks160(t)
	w := x.request(t, false, renameRequest{Name: "New"})
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body)
	}
	assertRenameFile160(t, renameDiskFile160(x, root, "disk1", "New.mkv"), "original")
	if _, err := os.Lstat(filepath.Dir(renameDiskFile160(x, root, "cache", "New.mkv"))); !os.IsNotExist(err) {
		t.Fatalf("cache folder created: %v", err)
	}
}
func TestRelease160RenameDuplicatePreview(t *testing.T) {
	for _, name := range []string{"Old.mkv", "Old.srt"} {
		t.Run(name, func(t *testing.T) {
			x, root := renameDisks160(t)
			if name != "Old.mkv" {
				os.WriteFile(filepath.Join(x.dir, name), []byte("subtitle"), 0600)
				copyRename160(t, x, root, "disk1", name)
			}
			copyRename160(t, x, root, "cache", name)
			w := x.request(t, true, renameRequest{Name: "New"})
			if w.Code != 409 || !strings.Contains(w.Body.String(), "Consolidate the folder") {
				t.Fatal(w.Code, w.Body)
			}
			assertRenameFile160(t, renameDiskFile160(x, root, "disk1", "Old.mkv"), "original")
		})
	}
}
func TestRelease160RenameUserShareFallback(t *testing.T) {
	x := newRenameFixture(t, "radarr")
	w := x.request(t, true, renameRequest{Name: "New"})
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"userShare":true`) {
		t.Fatal(w.Code, w.Body)
	}
	w = x.request(t, false, renameRequest{Name: "New"})
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body)
	}
	x.contents(t, "New.mkv", "original")
}
func TestRelease160RenameDetectsRefreshDevices(t *testing.T) {
	for _, state := range []string{"completed", "failed"} {
		t.Run(state, func(t *testing.T) {
			x, root := renameDisks160(t)
			x.state = state
			x.entered, x.block = make(chan struct{}), make(chan struct{})
			created := make(chan error, 1)
			go func() {
				<-x.entered
				created <- os.MkdirAll(filepath.Dir(renameDiskFile160(x, root, "cache", "New.mkv")), 0700)
				close(x.block)
			}()
			w := x.request(t, false, renameRequest{Name: "New"})
			if err := <-created; err != nil {
				t.Fatal(err)
			}
			var response struct {
				Refresh    string
				NewDevices []string
				Warning    string
			}
			if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if w.Code != 200 || response.Refresh != state {
				t.Fatal(w.Code, w.Body)
			}
			if state == "completed" && (len(response.NewDevices) != 1 || response.NewDevices[0] != "cache" || !strings.Contains(response.Warning, "cache")) {
				t.Fatal("new device not reported", w.Body)
			}
			if state != "completed" && len(response.NewDevices) != 0 {
				t.Fatal("checked before completed refresh", w.Body)
			}
			x.s.Store.Events.Flush()
			var count int
			if err := x.s.Store.DB.QueryRow("SELECT count(*) FROM event_log WHERE source='rename' AND level='warning' AND params LIKE '%cache%'").Scan(&count); err != nil {
				t.Fatal(err)
			}
			want := 0
			if state == "completed" {
				want = 1
			}
			if count != want {
				t.Fatalf("warning count %d want %d", count, want)
			}
		})
	}
}

func TestRelease160RenameWarnsWhenDeviceCheckFails(t *testing.T) {
	x, root := renameDisks160(t)
	x.entered, x.block = make(chan struct{}), make(chan struct{})
	removed := make(chan error, 1)
	go func() { <-x.entered; removed <- os.Remove(filepath.Join(root, "user")); close(x.block) }()
	w := x.request(t, false, renameRequest{Name: "New"})
	if err := <-removed; err != nil {
		t.Fatal(err)
	}
	var response struct {
		Refresh    string
		NewDevices []string
		Warning    string
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if w.Code != 200 || response.Refresh != "completed" || response.Warning == "" || !strings.Contains(response.Warning, "could not be checked") {
		t.Fatal("check failure hidden", w.Code, w.Body)
	}
	if len(response.NewDevices) != 0 {
		t.Fatal("unverified devices reported", w.Body)
	}
	assertRenameFile160(t, renameDiskFile160(x, root, "disk1", "New.mkv"), "original")
	x.s.Store.Events.Flush()
	var count int
	if err := x.s.Store.DB.QueryRow("SELECT count(*) FROM event_log WHERE source='rename' AND level='warning' AND message LIKE '%could not be checked%'").Scan(&count); err != nil || count != 1 {
		t.Fatal("missing check warning", count, err)
	}
}
