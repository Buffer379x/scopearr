package app

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestNormalizeUnraid130(t *testing.T) {
	cfg := DefaultSettings()
	cfg.Unraid = UnraidSettings{}
	if err := normalizeUnraid(&cfg); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(cfg.Unraid, defaultUnraidSettings()) {
		t.Fatalf("defaults: %#v", cfg.Unraid)
	}
	for name, modify := range map[string]func(*UnraidSettings){
		"relative":         func(u *UnraidSettings) { u.DiskRoot = "relative" },
		"root":             func(u *UnraidSettings) { u.DiskRoot = "/" },
		"data":             func(u *UnraidSettings) { u.DiskRoot = "/data/disks" },
		"control":          func(u *UnraidSettings) { u.ShareRoot = "/media/\n" },
		"nested":           func(u *UnraidSettings) { u.ShareRoot = "/unraid/user" },
		"state nested":     func(u *UnraidSettings) { u.StateDir = "/media/state" },
		"identical":        func(u *UnraidSettings) { u.ShareRoot = "/unraid" },
		"socket":           func(u *UnraidSettings) { u.StateDir = "/var/run" },
		"disk name":        func(u *UnraidSettings) { u.ExcludedDisks = []string{"../disk1"} },
		"excluded root":    func(u *UnraidSettings) { u.ExcludedDisks = []string{"user"} },
		"zero disk":        func(u *UnraidSettings) { u.ExcludedDisks = []string{"disk0"} },
		"library":          func(u *UnraidSettings) { u.Libraries = []string{"unknown"} },
		"grouping":         func(u *UnraidSettings) { u.SeriesGrouping = "episode" },
		"negative reserve": func(u *UnraidSettings) { u.ReserveGiB = -1 },
		"huge reserve":     func(u *UnraidSettings) { u.ReserveGiB = 10241 },
	} {
		t.Run(name, func(t *testing.T) {
			cfg := DefaultSettings()
			modify(&cfg.Unraid)
			if err := normalizeUnraid(&cfg); err == nil {
				t.Fatal("accepted invalid setting")
			}
		})
	}
	cfg = DefaultSettings()
	cfg.Unraid.DiskRoot = "/unraid/a/.."
	cfg.Unraid.StateDir = "/unraid-state/"
	cfg.Unraid.ReserveGiB = 0
	cfg.Unraid.MuxSameDisk = false
	cfg.Unraid.ExcludedDisks = []string{"nvme", "disk2", "nvme"}
	if err := normalizeUnraid(&cfg); err != nil {
		t.Fatal(err)
	}
	if cfg.Unraid.DiskRoot != "/unraid" || cfg.Unraid.StateDir != "/unraid-state" || cfg.Unraid.ReserveGiB != 0 || cfg.Unraid.MuxSameDisk {
		t.Fatalf("explicit values lost: %#v", cfg.Unraid)
	}
	if !reflect.DeepEqual(cfg.Unraid.ExcludedDisks, []string{"disk2", "nvme"}) {
		t.Fatal(cfg.Unraid.ExcludedDisks)
	}
}

func TestDiscoverUnraid130(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"disk10", "disk2", "disk1", "cache", "nvme", "user", "user0", "disks", "remotes", "addons", "rootshare", ".hidden", "ordinary"} {
		if err := os.Mkdir(filepath.Join(root, name), 0750); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink(filepath.Join(root, "disk1"), filepath.Join(root, "symlink")); err != nil {
		t.Fatal(err)
	}
	old := unraidIsMount
	unraidIsMount = func(_, child string) bool { return filepath.Base(child) != "ordinary" }
	t.Cleanup(func() { unraidIsMount = old })
	disks, err := discoverDisks(root)
	if err != nil {
		t.Fatal(err)
	}
	names := []string{}
	for _, d := range disks {
		names = append(names, d.Name)
		if d.Total == 0 || d.Writable {
			t.Fatalf("unexpected capacity/write probe: %#v", d)
		}
	}
	if !reflect.DeepEqual(names, []string{"disk1", "disk2", "disk10", "cache", "nvme"}) {
		t.Fatal(names)
	}
	if err := os.Remove(filepath.Join(root, "user")); err != nil {
		t.Fatal(err)
	}
	if _, err := discoverDisks(root); err == nil {
		t.Fatal("accepted non-Unraid tree")
	}
}

func TestUnraidState130(t *testing.T) {
	for _, tc := range []struct {
		name, data           string
		known, mover, parity bool
	}{
		{"idle", "shareMoverActive=\"no\"\nmdResync=\"0\"\nmdResyncPos=\"0\"\nmdResyncAction=\"check P\"", true, false, false},
		{"mover", "shareMoverActive=\"yes\"\nmdResync=0\nmdResyncPos=0", true, true, false},
		{"parity", "shareMoverActive=no\nmdResync=19531825100\nmdResyncPos=6680764", true, false, true},
		{"parity starting", "shareMoverActive=no\nmdResync=19531825100\nmdResyncPos=0", true, false, true},
		{"position", "shareMoverActive=no\nmdResync=0\nmdResyncPos=1", true, false, true},
		{"unknown", "something=else", false, false, false},
		{"invalid", "shareMoverActive=maybe\nmdResync=invalid\nmdResyncPos=-1", false, false, false},
		{"partly known active", "shareMoverActive=yes\nmdResync=invalid\nmdResyncPos=2", false, true, true},
		{"duplicate", "shareMoverActive=yes\nshareMoverActive=no\nmdResync=0\nmdResyncPos=0", false, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := parseUnraidState([]byte(tc.data))
			if s.Known != tc.known || s.Mover != tc.mover || s.Parity != tc.parity || (s.Warning == "") != tc.known {
				t.Fatalf("%#v", s)
			}
		})
	}
	u := defaultUnraidSettings()
	if readUnraidState(u).Warning != unraidNoState {
		t.Fatal("missing setup warning")
	}
	u.StateDir = t.TempDir()
	if readUnraidState(u).Known {
		t.Fatal("missing state file is known")
	}
	if err := os.WriteFile(filepath.Join(u.StateDir, "var.ini"), []byte("shareMoverActive=no\nmdResync=0\nmdResyncPos=0\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if !readUnraidState(u).Known {
		t.Fatal("valid state file is unknown")
	}
}
