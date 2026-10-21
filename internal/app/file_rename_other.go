//go:build !linux

package app

import "syscall"

func renameAtNoReplace(src, dst string) error { return syscall.ENOSYS }
