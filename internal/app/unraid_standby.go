package app

import (
	"bufio"
	"bytes"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var diskStandbyIgnored = regexp.MustCompile(`^(parity\d*|flash)$`)

// parseDiskStandby reads emhttp's disks.ini (sections ["disk1"], optional
// name="…", spundown="0|1"). The name field keys a section, else the section
// name, both without quotes. Parity and flash are ignored. The first section
// claiming a name keeps it, so a pool with several devices reports its first
// device. Unknown values and duplicate keys drop the section; a line over
// 1 MiB drops the whole file.
func parseDiskStandby(data []byte) map[string]bool {
	out := map[string]bool{}
	claimed := map[string]bool{}
	section, name, spundown := "", "", ""
	broken, hasName, hasSpundown := false, false, false
	flush := func() {
		if section == "" {
			return
		}
		key := section
		if name != "" {
			key = name
		}
		if claimed[key] || diskStandbyIgnored.MatchString(section) || diskStandbyIgnored.MatchString(key) {
			return
		}
		claimed[key] = true
		if broken || !hasSpundown || (spundown != "0" && spundown != "1") {
			return
		}
		out[key] = spundown == "1"
	}
	scanner := bufio.NewScanner(bytes.NewReader(data))
	scanner.Buffer(make([]byte, 4096), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") {
			continue
		}
		if strings.HasPrefix(line, "[") {
			flush()
			section, name, spundown = "", "", ""
			broken, hasName, hasSpundown = false, false, false
			if strings.HasSuffix(line, "]") {
				section = strings.Trim(strings.TrimSpace(line[1:len(line)-1]), `"'`)
			}
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		switch strings.TrimSpace(key) {
		case "name":
			broken = broken || hasName
			name, hasName = value, true
		case "spundown":
			broken = broken || hasSpundown
			spundown, hasSpundown = value, true
		}
	}
	if scanner.Err() != nil {
		return map[string]bool{}
	}
	flush()
	return out
}

// readDiskStandby reads only disks.ini in the state directory (tmpfs on
// Unraid), never a disk or mount, so it cannot wake a disk. Without a state
// directory, or when the file is missing, unreadable or over 1 MiB, it returns
// nil and the status leaves standby out.
func readDiskStandby(u UnraidSettings) map[string]bool {
	if u.StateDir == "" {
		return nil
	}
	f, err := os.Open(filepath.Join(u.StateDir, "disks.ini"))
	if err != nil {
		return nil
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, 1024*1024+1))
	if err != nil || len(data) > 1024*1024 {
		return nil
	}
	return parseDiskStandby(data)
}
