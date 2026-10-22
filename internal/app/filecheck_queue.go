package app

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

var errFileCheckChanged = errors.New("Changed since the scan. Scan again.")
var errFileCheckDenied = errors.New("Scopearr may not change this item. Use the terminal command.")

func (f *FileCheckManager) Start(ctx context.Context) {
	f.once.Do(func() {
		f.wg.Add(1)
		go func() {
			defer f.wg.Done()
			if !f.s.fileWork.acquire(ctx, "files") {
				return
			}
			f.recoverJobs()
			f.s.fileWork.release("files")
			tick := time.NewTicker(time.Second)
			defer tick.Stop()
			for {
				select {
				case <-ctx.Done():
					f.mu.Lock()
					if f.scanCancel != nil {
						f.scanCancel()
					}
					f.mu.Unlock()
					return
				case <-tick.C:
					for f.processOne(ctx) {
					}
				}
			}
		}()
	})
}

func (f *FileCheckManager) recoverJobs() {
	rows, e := f.s.Store.DB.Query("SELECT " + fileCheckColumns + " FROM filecheck_items WHERE job_status='running'")
	if e != nil {
		return
	}
	items := []FileCheckItem{}
	for rows.Next() {
		if item, e := scanFileCheck(rows); e == nil {
			items = append(items, item)
		}
	}
	rows.Close()
	cfg := f.s.Config()
	for _, item := range items {
		if item.Fix == "take_ownership" {
			if physical, _, e := resolveDiskPath(cfg.Unraid, item.Path); e == nil {
				_ = os.Remove(fileCheckPartial(physical, item.ID))
			}
		}
		item.JobStatus = "failed"
		item.Message = "Interrupted. Fix again."
		now := time.Now().UTC().Format(time.RFC3339Nano)
		item.FinishedAt = &now
		_ = f.s.Store.fileCheckSave(&item)
	}
}

func fileCheckPartial(physical string, id int64) string {
	return filepath.Join(filepath.Dir(physical), "."+filepath.Base(physical)+".scopearr-own-"+strconv.FormatInt(id, 10)+".partial")
}

// processOne fixes the next queued row and reports whether more work may follow.
func (f *FileCheckManager) processOne(parent context.Context) bool {
	f.mu.Lock()
	if f.pendingFinal != nil {
		if f.s.Store.fileCheckSave(f.pendingFinal) != nil {
			f.mu.Unlock()
			return false
		}
		f.pendingFinal = nil
	}
	if f.scan.Running || f.active != 0 || parent.Err() != nil {
		f.mu.Unlock()
		return false
	}
	j, e := scanFileCheck(f.s.Store.DB.QueryRow("SELECT " + fileCheckColumns + " FROM filecheck_items WHERE job_status='queued' ORDER BY queue_pos,id LIMIT 1"))
	if e != nil {
		f.mu.Unlock()
		return false
	}
	cfg := f.s.Config()
	if e = fileCheckPrerequisite(cfg); e != nil {
		if j.Message != e.Error() {
			j.Message = e.Error()
			_ = f.s.Store.fileCheckSave(&j)
		}
		f.mu.Unlock()
		return false
	}
	if !f.s.fileWork.try("files") {
		message := "Waiting: a mux job is running"
		if f.s.fileWork.current() == "placement" {
			message = "Waiting: disk placement is moving files"
		}
		if j.Message != message {
			j.Message = message
			_ = f.s.Store.fileCheckSave(&j)
		}
		f.mu.Unlock()
		return false
	}
	defer f.s.fileWork.release("files")
	j.JobStatus, j.Progress, j.Message, j.FinishedAt = "running", 0, "Fixing", nil
	if f.s.Store.fileCheckSave(&j) != nil {
		f.mu.Unlock()
		return false
	}
	ctx, cancel := context.WithCancel(parent)
	f.active, f.cancel = j.ID, cancel
	f.mu.Unlock()
	e = f.fix(ctx, cfg, &j)
	cancelled := ctx.Err() != nil
	cancel()
	switch {
	case e == nil:
		j.JobStatus, j.Progress = "succeeded", 100
		if j.Message == "Fixing" {
			j.Message = "Fixed"
		}
	case cancelled:
		j.JobStatus, j.Message = "cancelled", "Cancelled"
	case errors.Is(e, errFileCheckChanged):
		j.JobStatus, j.Message = "needs_review", e.Error()
	case errors.Is(e, errFileCheckDenied):
		j.JobStatus, j.Fix, j.Message = "", "manual", e.Error()
	default:
		j.JobStatus, j.Message = "failed", e.Error()
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	j.FinishedAt = &now
	if j.JobStatus == "" {
		j.FinishedAt = nil
	}
	j.QueuePos = nil
	e = f.s.Store.fileCheckSave(&j)
	f.mu.Lock()
	if e != nil {
		saved := j
		f.pendingFinal = &saved
	}
	f.active, f.cancel = 0, nil
	f.mu.Unlock()
	return e == nil && !cancelled
}

func fileCheckDenied(e error) bool {
	return errors.Is(e, os.ErrPermission) || errors.Is(e, syscall.EPERM) || errors.Is(e, syscall.EACCES)
}

// Every fix re-reads the item first and refuses to act on anything that changed.
func (f *FileCheckManager) fix(ctx context.Context, cfg Settings, j *FileCheckItem) error {
	if !validPlacementRel(j.Rel) || filepath.Join(j.Root, j.Rel) != j.Path {
		return errFileCheckChanged
	}
	realRoot, e := filepath.EvalSymlinks(j.Root)
	if e != nil || muxForbidden(realRoot) {
		return errFileCheckChanged
	}
	parent, e := filepath.EvalSymlinks(filepath.Dir(j.Path))
	if e != nil || !pathWithin(realRoot, parent) {
		return errFileCheckChanged
	}
	info, e := os.Lstat(j.Path)
	if e != nil {
		return errFileCheckChanged
	}
	uid, gid := placementOwner(info)
	if uint32(info.Mode()) != j.Mode || int(uid) != j.UID || int(gid) != j.GID || !j.Dir && (info.Size() != j.Size || info.ModTime().UnixNano() != j.Mtime) {
		return errFileCheckChanged
	}
	switch j.Fix {
	case "chmod":
		mode, _ := parseFileMode(cfg.FileCheck.FileMode)
		if j.Dir {
			mode, _ = parseFileMode(cfg.FileCheck.DirMode)
		}
		if e = os.Chmod(j.Path, os.FileMode(mode)); e != nil {
			if fileCheckDenied(e) {
				return errFileCheckDenied
			}
			return errors.New("Could not change permissions")
		}
		f.settleSiblings(j, "Permissions changed", false)
		return nil
	case "delete":
		if e = f.deletable(ctx, cfg, *j); e != nil {
			return e
		}
		if j.Dir && j.Kind != "empty_dir" {
			// RemoveAll removes symlinks themselves and never follows them.
			e = os.RemoveAll(j.Path)
		} else {
			e = os.Remove(j.Path)
		}
		if e != nil {
			if fileCheckDenied(e) {
				return errFileCheckDenied
			}
			if j.Kind == "empty_dir" {
				return errFileCheckChanged
			}
			return errors.New("Could not delete the item")
		}
		j.Message = "Deleted"
		f.settleSiblings(j, "Deleted", true)
		return nil
	case "take_ownership":
		if e = f.takeOwnership(ctx, cfg, j); e != nil {
			return e
		}
		j.Message = "Ownership taken"
		f.settleSiblings(j, "Ownership taken", false)
		return nil
	}
	return errors.New("This item needs a manual fix")
}

// deletable guards against deleting files that Radarr/Sonarr manage or a running job uses.
func (f *FileCheckManager) deletable(ctx context.Context, cfg Settings, j FileCheckItem) error {
	mappings, e := parsePathMappings(cfg.Mux.Mappings)
	if e != nil {
		return errFileCheckChanged
	}
	managed, e := f.managedFiles(ctx, mappings, j.Service, j.MediaID)
	if e != nil {
		return errors.New("Could not read library files")
	}
	for p := range managed {
		if p == j.Path || j.Dir && pathWithin(j.Path, p) {
			return errFileCheckChanged
		}
	}
	if strings.Contains(filepath.Base(j.Path), ".scopearr-") || j.Dir {
		busy := false
		_ = f.s.Store.DB.QueryRow("SELECT EXISTS(SELECT 1 FROM mux_jobs WHERE status IN ('queued','running'))").Scan(&busy)
		if active, _ := f.s.Store.placementActive(); active || busy {
			return errors.New("A mux or move job is running. Fix again when it has finished.")
		}
	}
	return nil
}

// Other rows for the same path (or below a deleted folder) are resolved by this fix.
func (f *FileCheckManager) settleSiblings(j *FileCheckItem, message string, below bool) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	query := "UPDATE filecheck_items SET job_status='succeeded',queue_pos=NULL,progress=100,message=?,updated_at=?,finished_at=? WHERE id<>? AND job_status<>'running' AND (path=?"
	args := []any{message, now, now, j.ID, j.Path}
	if below {
		query += " OR substr(path,1,?)=?"
		prefix := j.Path + string(filepath.Separator)
		args = append(args, len(prefix), prefix)
	}
	if !below {
		// A chmod or new owner settles only the permission/owner rows of that path.
		query += ") AND kind IN ('permissions','owner')"
	} else {
		query += ")"
	}
	_, _ = f.s.Store.DB.Exec(query, args...)
}

// takeOwnership copies the file on its physical disk and atomically replaces it.
// The copy belongs to Scopearr (99:100) and keeps the original's timestamps.
func (f *FileCheckManager) takeOwnership(ctx context.Context, cfg Settings, j *FileCheckItem) error {
	if j.Dir || !fileCheckPhysical(cfg) {
		return errFileCheckDenied
	}
	physical, _, e := resolveDiskPath(cfg.Unraid, j.Path)
	if e != nil {
		return errors.New("The file was not found on exactly one disk")
	}
	free, e := muxSpace(filepath.Dir(physical))
	if e != nil || !placementHasSpace(free, j.Size, cfg.Unraid.ReserveGB) {
		return errors.New("Not enough free space on the file's disk")
	}
	src, e := os.Open(physical)
	if e != nil {
		if fileCheckDenied(e) {
			return errFileCheckDenied
		}
		return errors.New("Could not read the file")
	}
	defer src.Close()
	before, e := src.Stat()
	if e != nil || before.Size() != j.Size || before.ModTime().UnixNano() != j.Mtime {
		return errFileCheckChanged
	}
	mode, _ := parseFileMode(cfg.FileCheck.FileMode)
	tmp := fileCheckPartial(physical, j.ID)
	dst, e := os.OpenFile(tmp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, os.FileMode(mode))
	if e != nil {
		if fileCheckDenied(e) {
			return errFileCheckDenied
		}
		return errors.New("Could not create the copy")
	}
	published := false
	defer func() {
		if !published {
			dst.Close()
			_ = os.Remove(tmp)
		}
	}()
	last := time.Now()
	if e = copyPlacement(ctx, src, dst, func(n int64) {
		if time.Since(last) >= time.Second && j.Size > 0 {
			j.Progress = int(n * 99 / j.Size)
			_ = f.s.Store.fileCheckSave(j)
			last = time.Now()
		}
	}); e != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return errors.New("Could not copy the file")
	}
	if e = dst.Sync(); e != nil {
		return errors.New("Could not copy the file")
	}
	if e = dst.Chmod(os.FileMode(mode)); e != nil {
		return errors.New("Could not set permissions on the copy")
	}
	if e = placementSetTimes(dst, placementAtime(before), before.ModTime().UnixNano()); e != nil {
		return errors.New("Could not preserve file times")
	}
	if st, e := dst.Stat(); e != nil || st.Size() != before.Size() {
		return errors.New("Copy size differs from the original")
	}
	if cfg.Unraid.VerifyChecksum {
		if _, e = src.Seek(0, io.SeekStart); e != nil {
			return errors.New("Could not verify the copy")
		}
		a, e1 := hashPlacement(ctx, src)
		check, e2 := os.Open(tmp)
		if e1 != nil || e2 != nil {
			return errors.New("Could not verify the copy")
		}
		b, e3 := hashPlacement(ctx, check)
		check.Close()
		if e3 != nil || a != b {
			return errors.New("Checksum differs; the original was kept")
		}
	}
	if after, e := os.Lstat(physical); e != nil || after.Size() != before.Size() || !after.ModTime().Equal(before.ModTime()) {
		return errFileCheckChanged
	}
	if e = dst.Close(); e != nil {
		return errors.New("Could not copy the file")
	}
	if e = os.Rename(tmp, physical); e != nil {
		return errors.New("Could not replace the file")
	}
	published = true
	if d, e := os.Open(filepath.Dir(physical)); e == nil {
		_ = d.Sync()
		d.Close()
	}
	return nil
}
