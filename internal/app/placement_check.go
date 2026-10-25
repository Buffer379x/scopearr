package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func placementCheckJSON(c *PlacementCheck) string {
	if c == nil {
		return ""
	}
	copy := *c
	copy.Files = append([]PlacementCheckFile{}, c.Files...)
	if len(copy.Files) > 50 {
		copy.MoreFiles += len(copy.Files) - 50
		copy.Files = copy.Files[:50]
	}
	for {
		raw, _ := json.Marshal(copy)
		if len(raw) <= 16*1024 {
			return string(raw)
		}
		if len(copy.Files) == 0 {
			return ""
		}
		copy.Files = copy.Files[:len(copy.Files)-1]
		copy.MoreFiles++
	}
}
func (c *PlacementCheck) addFile(f PlacementFile, reason string) {
	if len(c.Files) >= 50 {
		c.MoreFiles++
		return
	}
	c.Files = append(c.Files, PlacementCheckFile{Disk: f.Disk, Rel: f.Rel, UID: f.UID, GID: f.GID, Mode: f.Mode, Reason: reason})
}

// Access checks inspect metadata only and run only on outside-target sources.
// They deliberately use process access rather than an exact UID/GID equality.
func placementSourceCheck(item *PlacementItem, u UnraidSettings) PlacementCheck {
	c := PlacementCheck{Readable: true, Removable: true, Owner: true, Files: []PlacementCheckFile{}}
	dirs := map[string]PlacementFile{}
	for _, f := range item.Files {
		if f.Dir {
			dirs[f.Disk+"/"+f.Rel] = f
		}
	}
	for disk, d := range item.Disks {
		d.Unreadable, d.NotRemovable, d.ForeignOwner = 0, 0, 0
		item.Disks[disk] = d
	}
	for _, f := range item.Files {
		if f.Dir || f.Disk == item.Target {
			continue
		}
		d := item.Disks[f.Disk]
		if !f.fileMode().IsRegular() {
			c.addFile(f, "special")
			continue
		}
		path := filepath.Join(u.DiskRoot, f.Disk, item.Rel, f.Rel)
		if placementAccess(path, 4) != nil {
			c.Readable = false
			d.Unreadable++
			c.addFile(f, "unreadable")
		}
		parent := filepath.Dir(path)
		removable := placementAccess(parent, 3) == nil
		// Sticky directories allow removal only to the file or directory owner.
		dir, ok := dirs[f.Disk+"/"+filepath.Dir(f.Rel)]
		if !ok {
			removable = false
		} else if dir.fileMode()&os.ModeSticky != 0 {
			if uint32(os.Geteuid()) != dir.UID && uint32(os.Geteuid()) != f.UID {
				removable = false
			}
		}
		if !removable {
			c.Removable = false
			d.NotRemovable++
			c.addFile(f, "not_removable")
		}
		if f.UID != 99 || f.GID != 100 {
			c.Owner = false
			c.OwnerChanges++
			d.ForeignOwner++
			c.addFile(f, "owner_changes")
		}
		item.Disks[f.Disk] = d
	}
	for _, f := range item.specialFiles {
		if f.Disk != item.Target {
			c.addFile(f, "special")
		}
	}
	return c
}
func placementSourceMessage(i PlacementItem) string {
	unreadable, unremovable := 0, 0
	disks := []string{}
	for disk, d := range i.Disks {
		unreadable += d.Unreadable
		unremovable += d.NotRemovable
		if d.NotRemovable > 0 {
			disks = append(disks, disk)
		}
	}
	if unreadable > 0 {
		return fmt.Sprintf("%d files are not readable by Scopearr (99:100)", unreadable)
	}
	if unremovable > 0 {
		sort.Strings(disks)
		return fmt.Sprintf("%d files cannot be removed from %s", unremovable, joinPlacementDisks(disks))
	}
	return ""
}
func joinPlacementDisks(disks []string) string {
	out := ""
	for _, disk := range disks {
		if out != "" {
			out += ", "
		}
		out += disk
	}
	return out
}

func placementExistingParent(path, root, disk string) string {
	base := filepath.Join(root, disk)
	for path != base && strings.HasPrefix(path, base+string(filepath.Separator)) {
		st, e := os.Lstat(path)
		if e == nil {
			if !st.IsDir() || st.Mode()&os.ModeSymlink != 0 {
				return ""
			}
			real, e := filepath.EvalSymlinks(path)
			if e != nil || real != path {
				return ""
			}
			return path
		}
		if !os.IsNotExist(e) {
			return ""
		}
		path = filepath.Dir(path)
	}
	if path == base {
		real, e := filepath.EvalSymlinks(base)
		if e == nil && real == base {
			return base
		}
	}
	return ""
}
func placementTargetWritable(path, root, disk string) bool {
	parent := placementExistingParent(path, root, disk)
	return parent != "" && muxDirWritable(parent)
}
func createPlacementTarget(u UnraidSettings, disk, rel string) error {
	if !unraidDeviceName.MatchString(disk) || unraidExcludedRoot(disk) || !validPlacementRel(rel) {
		return errPlacementChanged
	}
	base := filepath.Join(u.DiskRoot, disk)
	real, e := filepath.EvalSymlinks(base)
	if e != nil || base != real || muxForbidden(real) {
		return errPlacementChanged
	}
	root, e := os.OpenRoot(base)
	if e != nil {
		return e
	}
	defer root.Close()
	path := ""
	for _, part := range strings.Split(rel, "/") {
		path = filepath.Join(path, part)
		st, e := root.Lstat(path)
		if os.IsNotExist(e) {
			if e = root.Mkdir(path, 0775); e != nil {
				return e
			}
			st, e = root.Lstat(path)
		}
		if e != nil || !st.IsDir() || st.Mode()&os.ModeSymlink != 0 {
			return errPlacementChanged
		}
	}
	return nil
}
