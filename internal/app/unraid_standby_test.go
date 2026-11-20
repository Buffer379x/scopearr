package app

import (
	"encoding/json"
	"maps"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The probe format of a real Unraid system (grep -E '^\[|spundown' disks.ini):
// quoted section names and quoted values, "1" asleep and "0" awake.
const diskStandbyProbe = "[\"parity\"]\nspundown=\"1\"\n[\"disk1\"]\nspundown=\"1\"\n[\"disk2\"]\nspundown=\"0\"\n[\"cache\"]\nspundown=\"0\"\n[\"flash\"]\nspundown=\"0\"\n"

func TestParseDiskStandbyReadsSpundown(t *testing.T) {
	cases := []struct {
		name string
		data string
		want map[string]bool
	}{
		{"probe format", diskStandbyProbe, map[string]bool{"disk1": true, "disk2": false, "cache": false}},
		{"CRLF line ends", strings.ReplaceAll(diskStandbyProbe, "\n", "\r\n"), map[string]bool{"disk1": true, "disk2": false, "cache": false}},
		{"unquoted sections and values", "[disk1]\nspundown=1\n[disk2]\nspundown=0\n", map[string]bool{"disk1": true, "disk2": false}},
		{"spaces around keys and values", "  [ \"disk1\" ]  \n  spundown = \"1\"  \n", map[string]bool{"disk1": true}},
		{"other keys", "[\"disk1\"]\nidx=\"1\"\nname=\"disk1\"\ndevice=\"sdb\"\nstatus=\"DISK_OK\"\nspundown=\"1\"\ntype=\"Data\"\n", map[string]bool{"disk1": true}},
		{"name field wins over the section", "[\"dev3\"]\nname=\"disk3\"\nspundown=\"1\"\n", map[string]bool{"disk3": true}},
		{"name field after spundown", "[\"dev3\"]\nspundown=\"0\"\nname=\"disk3\"\n", map[string]bool{"disk3": false}},
		{"empty name falls back to the section", "[\"disk4\"]\nname=\"\"\nspundown=\"1\"\n", map[string]bool{"disk4": true}},
		{"missing spundown", "[\"disk1\"]\nname=\"disk1\"\n[\"disk2\"]\nspundown=\"1\"\n", map[string]bool{"disk2": true}},
		{"parity and flash ignored", "[\"parity\"]\nspundown=\"1\"\n[\"parity2\"]\nspundown=\"1\"\n[\"flash\"]\nspundown=\"0\"\n[\"dev9\"]\nname=\"parity\"\nspundown=\"1\"\n[\"disk1\"]\nspundown=\"1\"\n", map[string]bool{"disk1": true}},
		{"pool reports its first device", "[\"cache\"]\nspundown=\"0\"\n[\"cache2\"]\nspundown=\"1\"\n[\"cache3\"]\nspundown=\"1\"\n", map[string]bool{"cache": false, "cache2": true, "cache3": true}},
		{"pool devices sharing the pool name", "[\"cache\"]\nname=\"cache\"\nspundown=\"0\"\n[\"cache2\"]\nname=\"cache\"\nspundown=\"1\"\n", map[string]bool{"cache": false}},
		{"comments, blank and garbage lines", "# comment\n; comment\n\n[\"disk1\"]\nthis is not a key\nspundown=\"1\"\n\x00\xff garbage\n[\"disk2\"]\nspundown=\"0\"\n", map[string]bool{"disk1": true, "disk2": false}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := parseDiskStandby([]byte(c.data)); !maps.Equal(got, c.want) {
				t.Fatalf("got %v, want %v", got, c.want)
			}
		})
	}
}

func TestParseDiskStandbyIgnoresBrokenInput(t *testing.T) {
	long := "[\"disk1\"]\nspundown=\"1\"\n" + "x=" + strings.Repeat("a", 1024*1024) + "\n[\"disk2\"]\nspundown=\"1\"\n"
	cases := []struct {
		name string
		data string
		want map[string]bool
	}{
		{"empty", "", map[string]bool{}},
		{"no section", "spundown=\"1\"\nname=\"disk1\"\n", map[string]bool{}},
		{"keys before the first section", "spundown=\"1\"\n[\"disk2\"]\nspundown=\"0\"\n", map[string]bool{"disk2": false}},
		{"duplicate spundown", "[\"disk1\"]\nspundown=\"0\"\nspundown=\"1\"\n[\"disk2\"]\nspundown=\"1\"\n", map[string]bool{"disk2": true}},
		{"duplicate name", "[\"disk1\"]\nname=\"disk1\"\nname=\"disk3\"\nspundown=\"1\"\n", map[string]bool{}},
		{"unknown values", "[\"disk1\"]\nspundown=\"2\"\n[\"disk2\"]\nspundown=\"\"\n[\"disk3\"]\nspundown=\"yes\"\n[\"disk4\"]\nspundown=\"1\"\n", map[string]bool{"disk4": true}},
		{"broken first section claims the name", "[\"cache\"]\nspundown=\"x\"\n[\"cache2\"]\nname=\"cache\"\nspundown=\"1\"\n", map[string]bool{}},
		{"unclosed section", "[\"disk1\"]\nspundown=\"0\"\n[\"disk2\"\nspundown=\"1\"\n", map[string]bool{"disk1": false}},
		{"empty section", "[\"\"]\nspundown=\"1\"\n[]\nspundown=\"1\"\n", map[string]bool{}},
		{"line over 1 MiB", long, map[string]bool{}},
		{"binary", "\x00\x01\x02[\xff\xfe]\n=\n==\n[", map[string]bool{}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := parseDiskStandby([]byte(c.data))
			if got == nil || !maps.Equal(got, c.want) {
				t.Fatalf("got %#v, want %v", got, c.want)
			}
		})
	}
}

func TestReadDiskStandbyLimitsTheFile(t *testing.T) {
	if got := readDiskStandby(UnraidSettings{}); got != nil {
		t.Fatalf("no state dir: %v", got)
	}
	dir := t.TempDir()
	u := UnraidSettings{StateDir: dir}
	if got := readDiskStandby(u); got != nil {
		t.Fatalf("missing disks.ini: %v", got)
	}
	path := filepath.Join(dir, "disks.ini")
	if e := os.Mkdir(path, 0755); e != nil {
		t.Fatal(e)
	}
	if got := readDiskStandby(u); got != nil {
		t.Fatalf("unreadable disks.ini: %v", got)
	}
	os.Remove(path)
	head := "[\"disk1\"]\nspundown=\"1\"\n"
	// A file of exactly 1 MiB is read; one byte more is refused as a whole.
	fill := strings.Repeat("#\n", (1024*1024-len(head))/2)
	exact := head + fill + strings.Repeat("\n", 1024*1024-len(head)-len(fill))
	if e := os.WriteFile(path, []byte(exact), 0644); e != nil {
		t.Fatal(e)
	}
	if got := readDiskStandby(u); !maps.Equal(got, map[string]bool{"disk1": true}) {
		t.Fatalf("1 MiB disks.ini: %v", got)
	}
	if e := os.WriteFile(path, []byte(exact+"\n"), 0644); e != nil {
		t.Fatal(e)
	}
	if got := readDiskStandby(u); got != nil {
		t.Fatalf("disks.ini over 1 MiB: %v", got)
	}
	if e := os.WriteFile(path, []byte(diskStandbyProbe), 0644); e != nil {
		t.Fatal(e)
	}
	if got := readDiskStandby(u); !maps.Equal(got, map[string]bool{"disk1": true, "disk2": false, "cache": false}) {
		t.Fatalf("probe disks.ini: %v", got)
	}
}

func TestUnraidStatusOmitsUnknownStandby(t *testing.T) {
	s, cfg := placementFixture130(t)
	status := func() (string, map[string]*bool) {
		t.Helper()
		w := httptest.NewRecorder()
		s.unraidHTTP(w, httptest.NewRequest("GET", "/api/unraid/status", nil))
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
		var body struct {
			Ready bool `json:"ready"`
			Disks []struct {
				Name    string `json:"name"`
				Standby *bool  `json:"standby"`
			} `json:"disks"`
		}
		if e := json.Unmarshal(w.Body.Bytes(), &body); e != nil {
			t.Fatal(e)
		}
		if !body.Ready || len(body.Disks) != 3 {
			t.Fatalf("fixture status: %s", w.Body.String())
		}
		out := map[string]*bool{}
		for _, d := range body.Disks {
			out[d.Name] = d.Standby
		}
		return w.Body.String(), out
	}
	if raw, _ := status(); strings.Contains(raw, "standby") {
		t.Fatalf("without a state dir the field is absent: %s", raw)
	}
	cfg.Unraid.StateDir = filepath.Join(filepath.Dir(cfg.Unraid.DiskRoot), "state")
	if e := os.MkdirAll(cfg.Unraid.StateDir, 0755); e != nil {
		t.Fatal(e)
	}
	setTestSettings(s, cfg)
	if raw, _ := status(); strings.Contains(raw, "standby") {
		t.Fatalf("without disks.ini the field is absent: %s", raw)
	}
	ini := filepath.Join(cfg.Unraid.StateDir, "disks.ini")
	if e := os.WriteFile(ini, []byte("[\"parity\"]\nspundown=\"1\"\n[\"disk3\"]\nspundown=\"1\"\n[\"disk6\"]\nspundown=\"0\"\n[\"flash\"]\nspundown=\"0\"\n"), 0644); e != nil {
		t.Fatal(e)
	}
	raw, disks := status()
	if disks["disk3"] == nil || !*disks["disk3"] || disks["disk6"] == nil || *disks["disk6"] || disks["cache"] != nil {
		t.Fatalf("standby only for disks with an entry: %s", raw)
	}
	if strings.Count(raw, `"standby":true`) != 1 || strings.Count(raw, `"standby":false`) != 1 {
		t.Fatalf("standby true only at the sleeping disk: %s", raw)
	}
	if e := os.WriteFile(ini, []byte(strings.Repeat("#", 1024*1024+1)), 0644); e != nil {
		t.Fatal(e)
	}
	if raw, _ := status(); strings.Contains(raw, "standby") {
		t.Fatalf("an oversize disks.ini leaves the field absent: %s", raw)
	}
	if e := os.WriteFile(ini, []byte("garbage\x00\n"), 0644); e != nil {
		t.Fatal(e)
	}
	if raw, _ := status(); strings.Contains(raw, "standby") {
		t.Fatalf("a broken disks.ini leaves the field absent: %s", raw)
	}
}
