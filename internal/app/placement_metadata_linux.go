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
