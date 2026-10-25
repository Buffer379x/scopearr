package app

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"
)

var errPlacementChanged = errors.New("Item changed since the scan. Check again or scan again.")
var errPlacementDifference = errors.New("Source and copy differ; check manually")

func (p *PlacementManager) Start(ctx context.Context) {
	p.once.Do(func() {
		p.wg.Add(1)
		go func() {
			defer p.wg.Done()
			if !p.s.fileWork.acquire(ctx, "placement") {
				return
			}
			p.recoverJobs()
			p.s.fileWork.release("placement")
			tick := time.NewTicker(time.Second)
			defer tick.Stop()
			for {
				select {
				case <-ctx.Done():
					p.mu.Lock()
					if p.scanCancel != nil {
						p.scanCancel()
					}
					p.mu.Unlock()
					return
				case <-tick.C:
					p.processOne(ctx)
				}
			}
		}()
	})
}
func (p *PlacementManager) logPath(id int64) string {
	return filepath.Join(p.s.Store.Dir, "placement-logs", strconv.FormatInt(id, 10)+".log")
}
func (p *PlacementManager) log(id int64, message string) {
	dir := filepath.Dir(p.logPath(id))
	if os.MkdirAll(dir, 0700) != nil {
		return
	}
	f, e := os.OpenFile(p.logPath(id), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if e != nil {
		return
	}
	defer f.Close()
	// All call sites use relative names, never raw OS errors containing absolute paths.
	_, _ = fmt.Fprintf(f, "%s %s\n", time.Now().UTC().Format(time.RFC3339), message)
}
func (p *PlacementManager) queueMessage(j *PlacementItem, message string) {
	if j.Message != message {
		j.Message = message
		_ = p.s.Store.placementSave(j)
	}
}
func (p *PlacementManager) processOne(parent context.Context) {
	p.mu.Lock()
	if p.pendingFinal != nil {
		if p.s.Store.placementSave(p.pendingFinal) != nil {
			p.mu.Unlock()
			return
		}
		p.pendingFinal = nil
	}
	if p.scan.Running || p.active != 0 {
		p.mu.Unlock()
		return
	}
	var interrupted bool
	if p.s.Store.DB.QueryRow("SELECT EXISTS(SELECT 1 FROM placement_items WHERE job_status='running')").Scan(&interrupted) != nil {
		p.mu.Unlock()
		return
	}
	if interrupted {
		if p.s.fileWork.try("placement") {
			p.recoverJobs()
			p.s.fileWork.release("placement")
		}
		p.mu.Unlock()
		return
	}
	j, e := scanPlacement(p.s.Store.DB.QueryRow("SELECT " + placementColumns + " FROM placement_items WHERE job_status='queued' ORDER BY queue_pos,id LIMIT 1"))
	if e != nil {
		p.mu.Unlock()
		return
	}
	cfg := p.s.Config()
	if e = placementPrerequisite(cfg); e != nil {
		p.queueMessage(&j, e.Error())
		p.mu.Unlock()
		return
	}
	state := readUnraidState(cfg.Unraid)
	if state.Mover {
		p.queueMessage(&j, "Waiting: mover is running")
		p.mu.Unlock()
		return
	}
	if state.Parity {
		p.queueMessage(&j, "Waiting: parity operation in progress")
		p.mu.Unlock()
		return
	}
	if !p.s.fileWork.try("placement") {
		message := "Waiting: a mux job is running"
		if p.s.fileWork.current() == "files" {
			message = "Waiting: file fixes are running"
		}
		p.queueMessage(&j, message)
		p.mu.Unlock()
		return
	}
	defer p.s.fileWork.release("placement")
	j.JobStatus = "running"
	j.Progress = 0
	j.BytesDone = 0
	j.Message = "Checking folders"
	j.FinishedAt = nil
	if p.s.Store.placementSave(&j) != nil {
		p.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(parent)
	p.active = j.ID
	p.cancel = cancel
	p.mu.Unlock()
	p.log(j.ID, "Starting item: "+strconv.Quote(j.Rel))
	e = p.executeMove(ctx, cfg, &j)
	cancelled := ctx.Err() != nil
	cancel()
	if e != nil {
		j.JobStatus = "failed"
		if errors.Is(e, errPlacementChanged) {
			j.JobStatus = "needs_review"
		}
		if errors.Is(e, errPlacementDifference) {
			j.JobStatus = "needs_attention"
		}
		j.Message = e.Error()
		if cancelled {
			j.JobStatus = "cancelled"
			j.Message = fmt.Sprintf("Partially moved: %d of %d files. Check again to continue.", p.movedFiles(cfg.Unraid, j), j.MoveFiles)
		}
	} else {
		j.JobStatus = "succeeded"
		j.ScanStatus = "ok"
		j.Progress = 100
		j.BytesDone = j.MoveBytes
		j.Message = "Moved to " + j.Target
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	j.FinishedAt = &now
	p.log(j.ID, j.Message)
	params := map[string]any{"item": j.ID}
	switch j.JobStatus {
	case "succeeded":
		p.s.Store.Events.Info("placement", j.Service, "Folder moved to {disk}", map[string]any{"item": j.ID, "disk": j.Target}, j.Title)
	case "cancelled":
		p.s.Store.Events.Info("placement", j.Service, "Move cancelled", params, j.Title)
	case "failed":
		p.s.Store.Events.Error("placement", j.Service, "Move failed", params, j.Title, j.Message)
	default:
		p.s.Store.Events.Warning("placement", j.Service, "Move needs attention", params, j.Title, j.Message)
	}
	// Keep the in-memory active claim until the terminal state is durable.
	// A failed save leaves running in SQLite, which recovery handles on restart.
	for n := 0; n < 3; n++ {
		e = p.s.Store.placementSave(&j)
		if e == nil {
			break
		}
		if n < 2 {
			select {
			case <-parent.Done():
			case <-time.After(100 * time.Millisecond):
			}
		}
	}
	p.mu.Lock()
	if e != nil {
		saved := j
		p.pendingFinal = &saved
	}
	p.active = 0
	p.cancel = nil
	p.mu.Unlock()
}
func placementSame(a, b PlacementItem) bool {
	if a.Rel != b.Rel || len(a.Files) != len(b.Files) {
		return false
	}
	signature := func(files []PlacementFile) []PlacementFile {
		out := append([]PlacementFile{}, files...)
		for n := range out {
			out[n].Atime = 0
			if out[n].Dir {
				out[n].Mtime = 0
				out[n].Size = 0
			}
		}
		sort.Slice(out, func(i, j int) bool {
			if out[i].Disk != out[j].Disk {
				return out[i].Disk < out[j].Disk
			}
			return out[i].Rel < out[j].Rel
		})
		return out
	}
	x, y := signature(a.Files), signature(b.Files)
	for n := range x {
		if x[n] != y[n] {
			return false
		}
	}
	return true
}
func placementFileMatches(f PlacementFile, st os.FileInfo) bool {
	if st == nil || !st.Mode().IsRegular() {
		return false
	}
	uid, gid := placementOwner(st)
	return f.Size == st.Size() && f.Mtime == st.ModTime().UnixNano() && f.Mode == uint32(st.Mode()) && f.UID == uid && f.GID == gid
}
func (p *PlacementManager) checkItem(ctx context.Context, cfg Settings, item PlacementItem) (PlacementCheck, PlacementItem, error) {
	check := PlacementCheck{State: readUnraidState(cfg.Unraid)}
	if e := placementPrerequisite(cfg); e != nil {
		return check, item, e
	}
	// Folders without an Arr entry have no service; Arr-backed rows keep requiring it.
	if !p.planSettingsMatch(cfg) || item.Service != "" && !cfg.GetService(item.Service).Enabled {
		return check, item, errPlacementChanged
	}
	disks, e := discoverDisks(cfg.Unraid.DiskRoot)
	if e != nil {
		return check, item, e
	}
	check.Reachable = true
	found := false
	for _, d := range disks {
		if d.Name == item.Target && d.Kind == "array" {
			found = true
		}
	}
	if !found || slicesContains(cfg.Unraid.ExcludedDisks, item.Target) {
		return check, item, errPlacementChanged
	}
	target := filepath.Join(cfg.Unraid.DiskRoot, item.Target, item.Rel)
	check.Writable = muxDirWritable(target)
	fresh, e := p.inspectItem(ctx, cfg.Unraid, disks, item, placementParents{})
	if e != nil {
		return check, item, e
	}
	check.Unchanged = placementSame(item, fresh)
	check.NoConflict = fresh.ScanStatus != "conflict" && fresh.ScanStatus != "error"
	for disk, stats := range fresh.Disks {
		if disk != item.Target && stats.SpecialFiles > 0 {
			check.Unchanged = false
			check.NoConflict = false
		}
	}
	check.Owner = true
	for _, f := range fresh.Files {
		if !f.Dir && f.Disk != item.Target && (f.UID != 99 || f.GID != 100) {
			check.Owner = false
		}
	}
	free, e := muxSpace(target)
	check.FreeSpace = e == nil && placementHasSpace(free, item.MoveBytes, cfg.Unraid.ReserveGB)
	return check, fresh, nil
}
func slicesContains(a []string, s string) bool {
	for _, v := range a {
		if v == s {
			return true
		}
	}
	return false
}
func placementHasSpace(free uint64, cost int64, reserveGB int) bool {
	if cost < 0 || reserveGB < 0 {
		return false
	}
	reserve := uint64(reserveGB) * 1e9
	return free >= uint64(cost) && free-uint64(cost) >= reserve
}

// Each root is an existing mapped item folder on a physical disk. Root methods
// keep operations inside that folder even if a concurrent process renames it.
func openPlacementRoot(u UnraidSettings, disk, rel string) (*os.Root, error) {
	if !unraidDeviceName.MatchString(disk) || unraidExcludedRoot(disk) || !validPlacementRel(rel) {
		return nil, errPlacementChanged
	}
	base := filepath.Join(u.DiskRoot, disk, rel)
	real, e := filepath.EvalSymlinks(base)
	if e != nil || real != base || muxForbidden(real) {
		return nil, errPlacementChanged
	}
	r, e := os.OpenRoot(base)
	if e != nil {
		return nil, errors.New("Media folder is not reachable")
	}
	return r, nil
}
func (p *PlacementManager) executeMove(ctx context.Context, cfg Settings, j *PlacementItem) error {
	check, _, e := p.checkItem(ctx, cfg, *j)
	if e != nil {
		return e
	}
	if check.State.Mover || check.State.Parity {
		return errPlacementChanged
	}
	if !check.Unchanged || !check.NoConflict || !check.Owner || !check.FreeSpace {
		return errPlacementChanged
	}
	if !check.Writable {
		return errors.New("Target disk is not writable")
	}
	roots := map[string]*os.Root{}
	defer func() {
		for _, r := range roots {
			_ = r.Close()
		}
	}()
	for disk := range j.Disks {
		r, e := openPlacementRoot(cfg.Unraid, disk, j.Rel)
		if e != nil {
			return e
		}
		roots[disk] = r
	}
	if roots[j.Target] == nil {
		r, e := openPlacementRoot(cfg.Unraid, j.Target, j.Rel)
		if e != nil {
			return e
		}
		roots[j.Target] = r
	}
	target := roots[j.Target]
	dirModes := map[string]os.FileMode{}
	for _, f := range j.Files {
		if f.Dir {
			dirModes[f.Disk+"/"+f.Rel] = f.fileMode().Perm()
		}
	}
	moving := []PlacementFile{}
	for _, f := range j.Files {
		if !f.Dir && f.Disk != j.Target {
			moving = append(moving, f)
		}
	}
	sort.SliceStable(moving, func(i, k int) bool {
		if moving[i].Size != moving[k].Size {
			return moving[i].Size < moving[k].Size
		}
		return moving[i].Rel < moving[k].Rel
	})
	// Check every destination before creating even the first directory or partial.
	for _, f := range moving {
		if _, e := target.Lstat(f.Rel); !os.IsNotExist(e) {
			return errPlacementChanged
		}
	}
	var done int64
	lastSave := time.Now()
	for _, f := range moving {
		if e = ctx.Err(); e != nil {
			return e
		}
		free, e := muxSpace(filepath.Join(cfg.Unraid.DiskRoot, j.Target, j.Rel))
		if e != nil || !placementHasSpace(free, j.MoveBytes-done, cfg.Unraid.ReserveGB) {
			return errors.New("Not enough free space on the target disk")
		}
		before := done
		e = p.moveFile(ctx, cfg, j, f, roots[f.Disk], target, dirModes, func(n int64) {
			j.BytesDone = before + n
			if j.MoveBytes > 0 {
				j.Progress = int(min(int64(99), j.BytesDone*100/j.MoveBytes))
			}
			if time.Since(lastSave) >= time.Second {
				j.Message = "Moving " + strconv.Quote(f.Rel)
				_ = p.s.Store.placementSave(j)
				lastSave = time.Now()
			}
		})
		if e != nil {
			return e
		}
		done += f.Size
		j.BytesDone = done
	}
	if e = ctx.Err(); e != nil {
		return e
	}
	if e = p.cleanupEmpty(j, roots); e != nil {
		return e
	}
	// Child-first timestamps, using the source directory associated with moved files.
	dirs := []PlacementFile{}
	seen := map[string]bool{}
	for _, f := range j.Files {
		if f.Dir && !seen[f.Rel] {
			dirs = append(dirs, f)
			seen[f.Rel] = true
		}
	}
	sort.Slice(dirs, func(i, k int) bool { return len(dirs[i].Rel) > len(dirs[k].Rel) })
	for _, d := range dirs {
		if st, e := target.Lstat(d.Rel); e == nil && st.IsDir() {
			if dir, e := target.OpenFile(d.Rel, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0); e == nil {
				_ = placementSetTimes(dir, d.Atime, d.Mtime)
				_ = dir.Close()
			}
		}
	}
	// A concurrent writer may add an unplanned entry after preflight. A move is
	// complete only when every source folder is gone; never hide remaining copies.
	for disk := range j.Disks {
		if disk == j.Target {
			continue
		}
		physical, e := os.OpenRoot(filepath.Join(cfg.Unraid.DiskRoot, disk))
		if e != nil {
			return errPlacementChanged
		}
		current, e := physical.Lstat(j.Rel)
		_ = physical.Close()
		if os.IsNotExist(e) {
			continue
		}
		// Root companions own only top-level files; seasons remain separate jobs.
		if e != nil || !j.rootOnly() || !current.IsDir() {
			return errPlacementChanged
		}
		original, e := roots[disk].Stat(".")
		if e != nil || !os.SameFile(original, current) {
			return errPlacementChanged
		}
		remaining, e := roots[disk].Open(".")
		if e != nil {
			return errPlacementChanged
		}
		entries, e := remaining.ReadDir(-1)
		_ = remaining.Close()
		if e != nil {
			return errPlacementChanged
		}
		for _, entry := range entries {
			if !entry.IsDir() {
				return errPlacementChanged
			}
		}
	}
	return nil
}
func placementPartial(f PlacementFile, id int64) string {
	return "." + filepath.Base(f.Rel) + ".scopearr-move-" + strconv.FormatInt(id, 10) + ".partial"
}
func ensurePlacementParents(target *os.Root, f PlacementFile, dirModes map[string]os.FileMode) error {
	parent := filepath.Dir(f.Rel)
	if parent == "." {
		return nil
	}
	parts := strings.Split(parent, string(filepath.Separator))
	path := ""
	for _, part := range parts {
		path = filepath.Join(path, part)
		mode := os.FileMode(0755)
		if m, ok := dirModes[f.Disk+"/"+path]; ok {
			mode = m
		}
		e := target.Mkdir(path, mode)
		if e != nil && !os.IsExist(e) {
			return errors.New("Could not create target directory")
		}
		st, e := target.Lstat(path)
		if e != nil || !st.IsDir() {
			return errPlacementChanged
		}
	}
	return nil
}
func copyPlacement(ctx context.Context, src, dst *os.File, progress func(int64)) error {
	buffer := make([]byte, 1<<20)
	var copied, synced int64
	for {
		if e := ctx.Err(); e != nil {
			return e
		}
		n, re := src.Read(buffer)
		if n > 0 {
			wrote, e := dst.Write(buffer[:n])
			if e != nil {
				return e
			}
			if wrote != n {
				return io.ErrShortWrite
			}
			copied += int64(n)
			// Real-Unraid spike: an unbounded dirty page cache OOMed even at 512 MB.
			if copied-synced >= 16<<20 {
				if e = dst.Sync(); e != nil {
					return e
				}
				synced = copied
			}
			progress(copied)
		}
		if re == io.EOF {
			return dst.Sync()
		}
		if re != nil {
			return re
		}
	}
}
func hashPlacement(ctx context.Context, f *os.File) ([32]byte, error) {
	h := sha256.New()
	buffer := make([]byte, 1<<20)
	for {
		if e := ctx.Err(); e != nil {
			return [32]byte{}, e
		}
		n, e := f.Read(buffer)
		if n > 0 {
			_, _ = h.Write(buffer[:n])
		}
		if e == io.EOF {
			var sum [32]byte
			copy(sum[:], h.Sum(nil))
			return sum, nil
		}
		if e != nil {
			return [32]byte{}, e
		}
	}
}
func (p *PlacementManager) moveFile(ctx context.Context, cfg Settings, j *PlacementItem, f PlacementFile, source, target *os.Root, dirModes map[string]os.FileMode, progress func(int64)) error {
	if e := ensurePlacementParents(target, f, dirModes); e != nil {
		return e
	}
	srcDir, e := source.OpenRoot(filepath.Dir(f.Rel))
	if e != nil {
		return errPlacementChanged
	}
	defer srcDir.Close()
	dstDir, e := target.OpenRoot(filepath.Dir(f.Rel))
	if e != nil {
		return errors.New("Target directory is not reachable")
	}
	defer dstDir.Close()
	name := filepath.Base(f.Rel)
	partial := placementPartial(f, j.ID)
	src, e := srcDir.OpenFile(name, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if e != nil {
		return errPlacementChanged
	}
	defer src.Close()
	srcInfo, e := src.Stat()
	if e != nil || !placementFileMatches(f, srcInfo) {
		return errPlacementChanged
	}
	dst, e := dstDir.OpenFile(partial, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if e != nil {
		return errors.New("Could not create an exclusive partial copy")
	}
	published := false
	defer func() {
		_ = dst.Close()
		if !published {
			_ = dstDir.Remove(partial)
		}
	}()
	copier := copyPlacement
	if p.testCopy != nil {
		copier = p.testCopy
	}
	if e = copier(ctx, src, dst, progress); e != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return errors.New("Could not copy file")
	}
	if e = dst.Sync(); e != nil {
		return errors.New("Could not synchronize copy")
	}
	if e = dst.Chmod(f.fileMode()); e != nil {
		return errors.New("Could not preserve file mode")
	}
	if e = placementSetTimes(dst, f.Atime, f.Mtime); e != nil {
		return errors.New("Could not preserve file timestamps")
	}
	outInfo, e := dst.Stat()
	if e != nil || outInfo.Size() != f.Size {
		return errors.New("Copy size differs from source")
	}
	uid, gid := placementOwner(outInfo)
	if uid != 99 || gid != 100 {
		return errors.New("Moving files requires Scopearr to run as owner 99:100")
	}
	if cfg.Unraid.VerifyChecksum {
		if _, e = src.Seek(0, 0); e != nil {
			return errors.New("Could not verify source")
		}
		if _, e = dst.Seek(0, 0); e != nil {
			return errors.New("Could not verify copy")
		}
		a, e := hashPlacement(ctx, src)
		if e != nil {
			return errors.New("Could not verify source")
		}
		b, e := hashPlacement(ctx, dst)
		if e != nil {
			return errors.New("Could not verify copy")
		}
		if a != b {
			return errors.New("Copy checksum differs from source")
		}
	}
	if e = placementSetTimes(dst, f.Atime, f.Mtime); e != nil {
		return errors.New("Could not preserve file timestamps")
	}
	p.log(j.ID, fmt.Sprintf("Copied %s (%d bytes) %s → %s", strconv.Quote(f.Rel), f.Size, f.Disk, j.Target))
	p.log(j.ID, "Verified "+strconv.Quote(f.Rel))
	fresh, e := srcDir.Lstat(name)
	if e != nil || !placementFileMatches(f, fresh) || !os.SameFile(srcInfo, fresh) {
		return errPlacementChanged
	}
	if e = ctx.Err(); e != nil {
		return e
	}
	// Closing before publishing ensures no buffered file error can be ignored.
	if e = dst.Sync(); e != nil {
		return errors.New("Could not synchronize copy")
	}
	if e = dst.Close(); e != nil {
		return errors.New("Could not close copy")
	}
	if e = dstDir.Link(partial, name); e != nil {
		return errPlacementChanged
	}
	published = true
	if e = dstDir.Remove(partial); e != nil {
		return errors.New("Published copy needs cleanup; check again")
	}
	dir, e := dstDir.Open(".")
	if e != nil {
		return errors.New("Could not open target directory for synchronization")
	}
	e = dir.Sync()
	_ = dir.Close()
	if e != nil {
		return errors.New("Could not synchronize target directory")
	}
	// Recheck immediately before unlink, too, since checksum and fsync can take time.
	fresh, e = srcDir.Lstat(name)
	if e != nil || !placementFileMatches(f, fresh) || !os.SameFile(srcInfo, fresh) {
		return errPlacementDifference
	}
	if e = srcDir.Remove(name); e != nil {
		return errors.New("Copy published; source could not be removed. Check again")
	}
	p.log(j.ID, "Removed source "+f.Disk+"/"+strconv.Quote(f.Rel))
	return nil
}
func (p *PlacementManager) cleanupEmpty(j *PlacementItem, roots map[string]*os.Root) error {
	dirs := []PlacementFile{}
	for _, f := range j.Files {
		if f.Dir && f.Disk != j.Target {
			dirs = append(dirs, f)
		}
	}
	sort.Slice(dirs, func(i, k int) bool { return len(dirs[i].Rel) > len(dirs[k].Rel) })
	for _, d := range dirs {
		if d.Rel == "." {
			continue
		}
		if !validPlacementRel(d.Rel) {
			return errPlacementChanged
		}
		r := roots[d.Disk]
		if r == nil {
			continue
		}
		e := r.Remove(d.Rel)
		if e != nil && !os.IsNotExist(e) && !errors.Is(e, syscall.ENOTEMPTY) && !errors.Is(e, syscall.EEXIST) {
			return errors.New("Could not remove an empty source directory")
		}
	}
	// Removing an item root requires the physical disk handle; never a parent above rel.
	for disk := range j.Disks {
		if disk == j.Target {
			continue
		}
		rootPath := roots[disk]
		if rootPath == nil {
			continue
		}
		entries, e := rootPath.Open(".")
		if e != nil {
			continue
		}
		names, e := entries.Readdirnames(1)
		_ = entries.Close()
		if e != io.EOF || len(names) > 0 {
			continue
		}
		// The named item still has to refer to the opened directory, even after rename.
		original, e := rootPath.Stat(".")
		if e != nil {
			continue
		}
		u := p.s.Config().Unraid
		named := filepath.Join(u.DiskRoot, disk, j.Rel)
		current, e := os.Lstat(named)
		if e != nil || !os.SameFile(original, current) {
			continue
		}
		diskRoot, e := os.OpenRoot(filepath.Join(u.DiskRoot, disk))
		if e != nil {
			return errors.New("Source disk is not reachable")
		}
		e = diskRoot.Remove(j.Rel)
		_ = diskRoot.Close()
		if e != nil && !errors.Is(e, syscall.ENOTEMPTY) && !os.IsNotExist(e) {
			return errors.New("Could not remove an empty source folder")
		}
	}
	return nil
}
func (p *PlacementManager) movedFiles(u UnraidSettings, j PlacementItem) int {
	moved := 0
	for _, f := range j.Files {
		if f.Dir || f.Disk == j.Target {
			continue
		}
		if _, e := os.Lstat(filepath.Join(u.DiskRoot, f.Disk, j.Rel, f.Rel)); os.IsNotExist(e) {
			moved++
		}
	}
	return moved
}
func (p *PlacementManager) recoverJobs() {
	state := readUnraidState(p.s.Config().Unraid)
	if state.Mover || state.Parity {
		message := "Waiting: parity operation in progress"
		if state.Mover {
			message = "Waiting: mover is running"
		}
		_, _ = p.s.Store.DB.Exec("UPDATE placement_items SET message=? WHERE job_status='running'", message)
		return
	}
	rows, e := p.s.Store.DB.Query("SELECT id FROM placement_items WHERE job_status='running'")
	if e != nil {
		return
	}
	ids := []int64{}
	for rows.Next() {
		var id int64
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	for _, id := range ids {
		j, e := p.s.Store.placementItem(id)
		if e != nil {
			continue
		}
		p.recoverItem(&j)
	}
}
func (p *PlacementManager) recoverItem(j *PlacementItem) {
	u := p.s.Config().Unraid
	j.JobStatus = "failed"
	j.Message = "Interrupted. Check again to continue."
	// Disabled or changed paths must not be used for recovery writes.
	if placementPrerequisite(p.s.Config()) != nil {
		_ = p.s.Store.placementSave(j)
		return
	}
	if !p.planSettingsMatch(p.s.Config()) {
		j.JobStatus = "needs_attention"
		j.Message = "Unraid paths or mappings changed. Check manually"
		_ = p.s.Store.placementSave(j)
		return
	}
	disks, e := discoverDisks(u.DiskRoot)
	if e != nil {
		j.JobStatus = "needs_attention"
		j.Message = "Unraid is not reachable; check manually"
		_ = p.s.Store.placementSave(j)
		return
	}
	known := map[string]bool{}
	for _, d := range disks {
		known[d.Name] = true
	}
	target, e := openPlacementRoot(u, j.Target, j.Rel)
	if e != nil {
		_ = p.s.Store.placementSave(j)
		return
	}
	defer target.Close()
	for _, f := range j.Files {
		if f.Dir || f.Disk == j.Target || !known[f.Disk] || !known[j.Target] {
			continue
		}
		source, e := openPlacementRoot(u, f.Disk, j.Rel)
		if e != nil {
			continue
		}
		src, se := source.Lstat(f.Rel)
		dst, de := target.Lstat(f.Rel)
		partial := filepath.Join(filepath.Dir(f.Rel), placementPartial(f, j.ID))
		if os.IsNotExist(se) && os.IsNotExist(de) {
			if _, e := target.Lstat(partial); e == nil {
				j.JobStatus = "needs_attention"
				j.Message = "A partial copy may be the only remaining copy; check manually"
			}
		} else {
			_ = target.Remove(partial)
		}
		if se == nil && de == nil {
			if placementFileMatches(f, src) && placementFileMatches(f, dst) {
				if e = verifyRecoveredPlacement(source, target, f, u.VerifyChecksum); e == nil {
					e = source.Remove(f.Rel)
				}
				if e != nil {
					j.JobStatus = "needs_attention"
					j.Message = "Copy exists; source could not be removed. Check manually"
				} else {
					p.log(j.ID, "Recovered published copy; removed source "+f.Disk+"/"+strconv.Quote(f.Rel))
				}
			} else {
				j.JobStatus = "needs_attention"
				j.Message = errPlacementDifference.Error()
			}
		}
		_ = source.Close()
	}
	p.log(j.ID, j.Message)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	j.FinishedAt = &now
	_ = p.s.Store.placementSave(j)
}

// Recovery opens both copies without following a final symlink, verifies the
// optional checksum, then checks the named entries still refer to those files.
func verifyRecoveredPlacement(source, target *os.Root, f PlacementFile, checksum bool) error {
	a, e := source.OpenFile(f.Rel, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if e != nil {
		return errPlacementDifference
	}
	defer a.Close()
	b, e := target.OpenFile(f.Rel, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if e != nil {
		return errPlacementDifference
	}
	defer b.Close()
	ai, e := a.Stat()
	if e != nil || !placementFileMatches(f, ai) {
		return errPlacementDifference
	}
	bi, e := b.Stat()
	if e != nil || !placementFileMatches(f, bi) {
		return errPlacementDifference
	}
	if checksum {
		x, e := hashPlacement(context.Background(), a)
		if e != nil {
			return errPlacementDifference
		}
		y, e := hashPlacement(context.Background(), b)
		if e != nil || x != y {
			return errPlacementDifference
		}
	}
	named, e := source.Lstat(f.Rel)
	if e != nil || !os.SameFile(ai, named) || !placementFileMatches(f, named) {
		return errPlacementDifference
	}
	named, e = target.Lstat(f.Rel)
	if e != nil || !os.SameFile(bi, named) || !placementFileMatches(f, named) {
		return errPlacementDifference
	}
	return nil
}
