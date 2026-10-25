package app

import (
	"golang.org/x/sys/unix"
	"os"
	"syscall"
)

func placementAtime(info os.FileInfo) int64 {
	if st, ok := info.Sys().(*syscall.Stat_t); ok {
		return st.Atim.Sec*1e9 + st.Atim.Nsec
	}
	return info.ModTime().UnixNano()
}

func placementSetTimes(f *os.File, atime, mtime int64) error {
	return unix.UtimesNanoAt(int(f.Fd()), "", []unix.Timespec{unix.NsecToTimespec(atime), unix.NsecToTimespec(mtime)}, unix.AT_EMPTY_PATH)
}

// AT_EACCESS checks the effective process identity, including supplementary groups.
var placementAccess = func(path string, mode uint32) error {
	return unix.Faccessat(unix.AT_FDCWD, path, mode, unix.AT_SYMLINK_NOFOLLOW|unix.AT_EACCESS)
}
