package app

import (
	"errors"
	"os"
	"path/filepath"
)

const muxDiskFallback = "user share (fallback)"

var errMuxSeveralDisks = errors.New("The media file exists on several disks")

func resolveDiskPath(u UnraidSettings, local string) (diskPath, disk string, err error) {
	rel, e := placementRel(u.ShareRoot, local)
	if e != nil {
		return "", "", e
	}
	original, e := os.Lstat(local)
	if e != nil || !original.Mode().IsRegular() {
		return "", "", errors.New("Media file is not reachable")
	}
	disks, e := discoverDisks(u.DiskRoot)
	if e != nil {
		return "", "", e
	}
	matches := 0
	for _, d := range disks {
		base := filepath.Join(u.DiskRoot, d.Name)
		path := filepath.Join(base, rel)
		info, e := os.Lstat(path)
		if e != nil || !info.Mode().IsRegular() || info.Size() != original.Size() || !info.ModTime().Equal(original.ModTime()) {
			continue
		}
		realRoot, e := filepath.EvalSymlinks(base)
		if e != nil || muxForbidden(realRoot) {
			return "", "", errors.New("Media path escapes the configured mount")
		}
		real, e := filepath.EvalSymlinks(path)
		if e != nil || !pathWithin(realRoot, real) || muxForbidden(real) {
			return "", "", errors.New("Media path escapes the configured mount")
		}
		matches++
		diskPath = real
		disk = d.Name
	}
	if matches > 1 {
		return "", "", errMuxSeveralDisks
	}
	if matches == 0 {
		return local, muxDiskFallback, nil
	}
	return diskPath, disk, nil
}
func muxResolvePhysical(cfg Settings, local string) (string, string, error) {
	if !cfg.Unraid.Enabled || !cfg.Unraid.MuxSameDisk {
		return local, "", nil
	}
	if e := unraidPrerequisite(cfg); e != nil {
		return "", "", e
	}
	return resolveDiskPath(cfg.Unraid, local)
}
func muxRecordLocation(j *MuxJob, cfg Settings, local, physical, disk string) {
	j.Source.OutputDisk = disk
	j.Source.DiskPath = ""
	j.Source.DiskRoot = ""
	j.Source.SharePath = ""
	if disk != "" && disk != muxDiskFallback {
		j.Source.DiskPath = physical
		j.Source.DiskRoot = cfg.Unraid.DiskRoot
		j.Source.SharePath = local
	}
}
func resolveMuxJobDestination(cfg Settings, j MuxJob, arrPath string) (string, error) {
	if j.Source.DiskPath == "" {
		return resolveMuxDestination(cfg.Mux, j.Service, arrPath)
	}
	if j.Source.DiskRoot != cfg.Unraid.DiskRoot || !unraidDeviceName.MatchString(j.Source.OutputDisk) || unraidExcludedRoot(j.Source.OutputDisk) {
		return "", errors.New("Unraid disk location changed. Check the output manually")
	}
	disks, e := discoverDisks(cfg.Unraid.DiskRoot)
	if e != nil {
		return "", e
	}
	known := false
	for _, d := range disks {
		if d.Name == j.Source.OutputDisk {
			known = true
		}
	}
	if !known {
		return "", errors.New("Original disk is not reachable")
	}
	base := filepath.Join(cfg.Unraid.DiskRoot, j.Source.OutputDisk)
	realBase, e := filepath.EvalSymlinks(base)
	if e != nil {
		return "", errors.New("Original disk is not reachable")
	}
	candidate := filepath.Clean(j.Source.DiskPath)
	if !pathWithin(realBase, candidate) || candidate == realBase || muxForbidden(candidate) {
		return "", errors.New("Media path escapes the configured mount")
	}
	parent, e := filepath.EvalSymlinks(filepath.Dir(candidate))
	if e != nil || !pathWithin(realBase, parent) {
		return "", errors.New("Original disk folder is not reachable")
	}
	return filepath.Join(parent, filepath.Base(candidate)), nil
}

type muxSyncWriter struct {
	file  *os.File
	dirty int64
}

func (w *muxSyncWriter) Write(data []byte) (int, error) {
	n, e := w.file.Write(data)
	w.dirty += int64(n)
	if e == nil && w.dirty >= 16<<20 {
		e = w.file.Sync()
		w.dirty = 0
	}
	return n, e
}
