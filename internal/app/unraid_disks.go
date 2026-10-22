package app

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"

	"golang.org/x/sys/unix"
)

type UnraidDisk struct {
	Name     string `json:"name"`
	Kind     string `json:"kind"`
	Total    uint64 `json:"total"`
	Free     uint64 `json:"free"`
	Writable bool   `json:"writable"`
	Excluded bool   `json:"excluded"`
}

var unraidIsMount = func(parent, child string) bool {
	a, e1 := os.Lstat(parent)
	b, e2 := os.Lstat(child)
	if e1 != nil || e2 != nil || !a.IsDir() || !b.IsDir() {
		return false
	}
	x, ok1 := a.Sys().(*syscall.Stat_t)
	y, ok2 := b.Sys().(*syscall.Stat_t)
	return ok1 && ok2 && x.Dev != y.Dev
}

func discoverDisks(root string) ([]UnraidDisk, error) {
	user, err := os.Lstat(filepath.Join(root, "user"))
	if err != nil || !user.IsDir() {
		return nil, errors.New("Disk root does not look like Unraid /mnt")
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, errors.New("Unraid disk root is not reachable")
	}
	disks := []UnraidDisk{}
	for _, entry := range entries {
		name := entry.Name()
		if !entry.IsDir() || unraidExcludedRoot(name) || !unraidDeviceName.MatchString(name) {
			continue
		}
		path := filepath.Join(root, name)
		if !unraidIsMount(root, path) {
			continue
		}
		var st unix.Statfs_t
		if err := unix.Statfs(path, &st); err != nil {
			return nil, errors.New("Cannot read disk capacity: " + name)
		}
		kind := "pool"
		if unraidArrayName.MatchString(name) {
			kind = "array"
		}
		disks = append(disks, UnraidDisk{Name: name, Kind: kind, Total: st.Blocks * uint64(st.Bsize), Free: st.Bavail * uint64(st.Bsize)})
	}
	sort.Slice(disks, func(i, j int) bool {
		a, b := disks[i], disks[j]
		if a.Kind != b.Kind {
			return a.Kind == "array"
		}
		if a.Kind == "array" {
			x, _ := strconv.ParseUint(strings.TrimPrefix(a.Name, "disk"), 10, 64)
			y, _ := strconv.ParseUint(strings.TrimPrefix(b.Name, "disk"), 10, 64)
			if x != y {
				return x < y
			}
		}
		return a.Name < b.Name
	})
	return disks, nil
}
