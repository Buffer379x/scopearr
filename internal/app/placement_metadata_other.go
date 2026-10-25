//go:build !linux

package app

import (
	"os"
 "errors"
	"time"
)

func placementAtime(info os.FileInfo) int64 { return info.ModTime().UnixNano() }

func placementSetTimes(f *os.File, atime, mtime int64) error {
	return os.Chtimes(f.Name(), time.Unix(0, atime), time.Unix(0, mtime))
}

var placementAccess = func(string,uint32)error{return errors.New("Placement access checks require Linux")}
