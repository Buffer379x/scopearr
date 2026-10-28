package app

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"unicode"
	"unicode/utf8"
)

type companion struct {
	From     string `json:"from"`
	To       string `json:"to"`
	Conflict bool   `json:"conflict"`
}

var videoExtensions = map[string]bool{".mkv": true, ".mp4": true, ".m4v": true, ".avi": true, ".ts": true, ".m2ts": true, ".wmv": true, ".mov": true, ".mpg": true, ".mpeg": true, ".webm": true}

func validCompanionName(name string) bool {
	return name != "" && len(name) <= 255 && utf8.ValidString(name) && filepath.Base(name) == name && !strings.ContainsAny(name, "/\\") && !strings.HasPrefix(name, ".") && strings.IndexFunc(name, unicode.IsControl) < 0
}
func sameRenameTarget(src, dst string) bool {
	if !strings.EqualFold(src, dst) {
		return false
	}
	a, e := os.Lstat(src)
	if e != nil {
		return false
	}
	b, e := os.Lstat(dst)
	return e == nil && b.Mode().IsRegular() && os.SameFile(a, b)
}
func targetConflict(src, dst string) bool {
	_, e := os.Lstat(dst)
	return !os.IsNotExist(e) && !sameRenameTarget(src, dst)
}
func findCompanions(dir, oldStem, newStem string) ([]companion, error) {
	entries, e := os.ReadDir(dir)
	if e != nil {
		return nil, errors.New("Could not read companion files")
	}
	out := []companion{}
	for _, entry := range entries {
		name := entry.Name()
		lower := strings.ToLower(name)
		if strings.HasPrefix(name, ".") || !(strings.HasPrefix(name, oldStem+".") || strings.HasPrefix(name, oldStem+"-")) || strings.HasSuffix(lower, ".partial") || strings.Contains(lower, ".scopearr-backup-") || videoExtensions[strings.ToLower(filepath.Ext(name))] {
			continue
		}
		info, e := os.Lstat(filepath.Join(dir, name))
		if e != nil {
			return nil, errors.New("Could not read companion files")
		}
		if !info.Mode().IsRegular() {
			continue
		}
		target := newStem + strings.TrimPrefix(name, oldStem)
		if !validCompanionName(target) {
			return nil, errors.New("Invalid companion filename")
		}
		out = append(out, companion{name, target, targetConflict(filepath.Join(dir, name), filepath.Join(dir, target))})
		if len(out) > 50 {
			return nil, errors.New("Too many companion files")
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].From < out[j].From })
	return out, nil
}

type renameIncomplete struct{}

func (*renameIncomplete) Error() string { return "Could not undo incomplete rename" }

// Injectable filesystem operations exercise fallback and rollback paths without changing global syscalls.
type renameFS struct {
	link      func(string, string) error
	remove    func(string) error
	rename    func(string, string) error
	noReplace func(string, string) error
}

func defaultRenameFS() renameFS { return renameFS{os.Link, os.Remove, os.Rename, renameAtNoReplace} }

// Physical disk paths must never use hardlinks: a rename keeps every file on
// its original device and avoids asking shfs to allocate a directory entry.
func (fs renameFS) moveOnDevice(src, dst string, physical bool) error {
	st, e := os.Lstat(src)
	if e != nil || !st.Mode().IsRegular() {
		return errors.New("File is not reachable for renaming")
	}
	if targetConflict(src, dst) {
		return errors.New("A target name already exists")
	}
	if strings.EqualFold(src, dst) && !physical {
		return fs.rename(src, dst)
	}
	if !physical {
		e = fs.link(src, dst)
		if e == nil {
			if e = fs.remove(src); e != nil {
				if undo := fs.remove(dst); undo != nil {
					return &renameIncomplete{}
				}
				return errors.New("Could not remove the old filename")
			}
			return nil
		}
		if !(errors.Is(e, syscall.EXDEV) || errors.Is(e, syscall.EPERM) || errors.Is(e, syscall.ENOTSUP)) {
			return e
		}
	}
	e = fs.noReplace(src, dst)
	if e == nil {
		return nil
	}
	if errors.Is(e, syscall.EEXIST) && sameRenameTarget(src, dst) {
		return fs.rename(src, dst)
	}
	if !(errors.Is(e, syscall.EINVAL) || errors.Is(e, syscall.ENOSYS) || errors.Is(e, syscall.ENOTSUP)) {
		return e
	}
	// Older kernels/filesystems lack RENAME_NOREPLACE. Recheck immediately under the global rename lock.
	if targetConflict(src, dst) {
		return errors.New("A target name already exists")
	}
	return fs.rename(src, dst)
}
