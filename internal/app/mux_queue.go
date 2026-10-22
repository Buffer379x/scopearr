package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

type MuxManager struct {
	s                 *Server
	mu                sync.Mutex
	wg                sync.WaitGroup
	once              sync.Once
	tool              MuxToolStatus
	active            int64
	cancel            context.CancelFunc
	testRunner        muxRunner
	lastCleanup       time.Time
	checks            map[int64]muxCheckCache
	pendingFinal      map[int64]MuxJob
	testFinish        func(*MuxJob) error
	testFinishBudget  time.Duration
	testFinishDelay   time.Duration
	testOutputTimeout time.Duration
	testRescanTimeout time.Duration
	testRescanPoll    time.Duration
}

func NewMuxManager(s *Server) *MuxManager {
	m := &MuxManager{s: s, checks: map[int64]muxCheckCache{}, pendingFinal: map[int64]MuxJob{}}
	if b, e := os.ReadFile(filepath.Join(m.toolBase(), "state.json")); e == nil {
		json.Unmarshal(b, &m.tool)
	}
	if _, e := os.Stat(filepath.Join(m.toolBase(), "current/usr/bin/mkvmerge")); e != nil {
		m.tool.Installed = false
	}
	return m
}
func (m *MuxManager) Start(ctx context.Context) {
	m.once.Do(func() {
		m.wg.Add(1)
		go func() {
			defer m.wg.Done()
			if !m.s.fileWork.acquire(ctx, "mux") {
				return
			}
			m.recoverJobs()
			m.s.fileWork.release("mux")
			tick := time.NewTicker(time.Second)
			defer tick.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-tick.C:
					m.processOne(ctx)
				}
			}
		}()
	})
}
func (m *MuxManager) recoverJobs() {
	m.mu.Lock()
	defer m.mu.Unlock()
	workRoot := m.s.Config().Mux.WorkDir
	if workRoot != "" && checkMuxWorkDir(workRoot).Exists {
		base := filepath.Join(workRoot, ".scopearr-mux")
		if st, e := os.Lstat(base); e == nil && st.IsDir() {
			entries, _ := os.ReadDir(base)
			for _, entry := range entries {
				if entry.IsDir() && numericMuxDir(entry.Name()) {
					os.RemoveAll(filepath.Join(base, entry.Name()))
				}
			}
		}
	}
	jobs, _ := m.s.Store.muxJobs()
	for _, j := range jobs {
		if j.Status != "running" {
			continue
		}
		m.recoverJob(&j, false)
	}
}
func muxTemp(src string, j MuxJob) string {
	return filepath.Join(filepath.Dir(src), "."+j.Spec.OutputName+".scopearr-"+strconv.FormatInt(j.ID, 10)+".partial")
}
func (m *MuxManager) processOne(ctx context.Context) {
	m.mu.Lock()
	m.reconcileFinals()
	cfg := m.s.Config()
	if len(m.pendingFinal) > 0 || m.active != 0 || m.tool.Busy != "" || !m.tool.Installed || !cfg.Mux.Enabled {
		m.mu.Unlock()
		return
	}
	if cfg.Mux.KeepFinished > 0 && time.Since(m.lastCleanup) >= 24*time.Hour {
		m.lastCleanup = time.Now()
		cutoff := time.Now().Add(-time.Duration(cfg.Mux.KeepFinished) * 24 * time.Hour).UTC().Format(time.RFC3339Nano)
		oldJobs, _ := m.s.Store.muxJobs()
		for _, old := range oldJobs {
			if old.Status == "succeeded" && old.BackupName == "" && old.FinishedAt != nil && *old.FinishedAt < cutoff {
				if _, e := m.s.Store.DB.Exec("DELETE FROM mux_jobs WHERE id=?", old.ID); e == nil {
					os.Remove(m.logPath(old.ID))
				}
			}
		}
	}
	jobs, e := m.s.Store.muxJobs()
	if e != nil {
		m.mu.Unlock()
		return
	}
	var j MuxJob
	for _, v := range jobs {
		if v.Status == "queued" {
			j = v
			break
		}
	}
	if j.ID == 0 {
		m.mu.Unlock()
		return
	}
	if !m.s.fileWork.try("mux") {
		if j.Message != "Waiting: disk placement is moving files" {
			j.Message = "Waiting: disk placement is moving files"
			_ = m.s.Store.muxSave(&j)
		}
		m.mu.Unlock()
		return
	}
	defer m.s.fileWork.release("mux")
	j.Status = "running"
	j.Message = "Checking media file"
	j.Progress = 0
	if m.s.Store.muxSave(&j) != nil {
		m.mu.Unlock()
		return
	}
	finishCtx := ctx
	ctx, cancel := context.WithCancel(ctx)
	m.active = j.ID
	m.cancel = cancel
	m.mu.Unlock()
	e = m.execute(ctx, &j)
	wasCancelled := ctx.Err() != nil
	cancel()
	if e != nil {
		if j.Status == "running" {
			j.Status = "failed"
			if wasCancelled {
				j.Status = "cancelled"
			}
		}
		j.Message = e.Error()
	} else if j.Status == "running" {
		j.Status = "succeeded"
		j.Message = "Mux completed"
		j.Progress = 100
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	j.FinishedAt = &now
	e = m.persistFinal(finishCtx, &j)
	m.mu.Lock()
	m.rememberFinal(j, e)
	m.active = 0
	m.cancel = nil
	m.mu.Unlock()
}
func (m *MuxManager) execute(ctx context.Context, j *MuxJob) (result error) {
	logCtx, closeLog, e := m.openJobLog(ctx, *j, false)
	if e != nil {
		return e
	}
	defer closeLog()
	ctx = logCtx
	defer func() {
		if result != nil {
			muxLogLine(ctx, "Error: "+result.Error())
			var detail *muxVerificationError
			if errors.As(result, &detail) {
				muxLogLine(ctx, "Details: "+detail.detail)
			}
		} else if j.Status == "needs_attention" {
			muxLogLine(ctx, "Error: "+j.Message)
		} else {
			muxLogLine(ctx, "Done: Mux completed")
		}
	}()
	f, e := m.s.Store.muxFile(j.Service, j.FileID)
	if e != nil {
		return errors.New("File is no longer in Radarr/Sonarr")
	}
	src, e := resolveLocalPath(m.s.Config().Mux, j.Service, f.SourcePath)
	if e != nil {
		return e
	}
	settings := m.s.Config()
	shareSource := src
	src, disk, e := muxResolvePhysical(settings, shareSource)
	if e != nil {
		return e
	}
	muxRecordLocation(j, settings, shareSource, src, disk)
	if e = m.saveRunning(j); e != nil {
		return errors.New("Could not save mux disk location")
	}
	if disk == muxDiskFallback {
		muxLogLine(ctx, "Disk location not found; writing through the user share")
	} else if disk != "" {
		muxLogLine(ctx, "Output disk: "+disk)
	}
	muxLogPaths(ctx, shareSource, src)
	cfg := settings.Mux
	check := checkMuxFile(src, f.Size, j.Source, cfg.WorkDir)
	if !check.Unchanged {
		j.Status = "needs_review"
		return errors.New("Media file changed. Identify it again")
	}
	if !check.Ready() {
		return errors.New("Media file checks failed")
	}
	final := filepath.Join(filepath.Dir(src), j.Spec.OutputName+".mkv")
	if final != src {
		if _, e := os.Lstat(final); !os.IsNotExist(e) {
			return errors.New("Output file already exists")
		}
	}
	tmp := muxTemp(src, *j)
	if _, e := os.Lstat(tmp); !os.IsNotExist(e) {
		return errors.New("Temporary output already exists")
	}
	out := tmp
	if cfg.WorkDir != "" {
		dir := muxWorkDir(cfg, *j)
		// Refuse stale paths and symlinked job roots, even if supplied locally.
		base := filepath.Dir(dir)
		if e = os.Mkdir(base, 0700); e != nil && !os.IsExist(e) {
			return e
		}
		st, err := os.Lstat(base)
		if err != nil || !st.IsDir() {
			return errors.New("Invalid mux working directory")
		}
		if e = os.Mkdir(dir, 0700); e != nil {
			return e
		}
		defer os.RemoveAll(dir)
		out = muxWorkOutput(cfg, *j)
	}
	args, e := buildMuxArgs(src, out, j.Source, j.Spec)
	if e != nil {
		return e
	}
	runner := m.runner()
	fresh, e := runner.Identify(ctx, src)
	if e != nil {
		return e
	}
	if fresh.Size != j.Source.Size || !fresh.ModTime.Equal(j.Source.ModTime) {
		j.Status = "needs_review"
		return errors.New("Media file changed. Identify it again")
	}
	// Only discard temporary output while the original has not been touched.
	preserve := false
	defer func() {
		if !preserve {
			os.Remove(tmp)
		}
	}()
	j.Message = "Muxing"
	m.saveProgress(j)
	last := time.Time{}
	muxLogPaths(ctx, src, out, tmp, final, cfg.WorkDir)
	started := time.Now()
	warnings, e := runner.Mux(ctx, args, func(n int) {
		if time.Since(last) >= time.Second {
			j.Progress = n * 90 / 100
			m.saveProgress(j)
			last = time.Now()
		}
	})
	j.Log = strings.Join(warnings, "\n")
	if e != nil && ctx.Err() == nil {
		lines := muxFailureLines(ctx, warnings)
		hint := classifyMuxFailure(lines)
		muxLogLine(ctx, "Error: "+e.Error())
		muxLogLine(ctx, "Hint: "+hint)
		if strings.Contains(strings.ToLower(strings.Join(lines, " ")), "bytes of invalid data") {
			muxLogLine(ctx, "Hint: MKVToolNix also reported invalid data in the source.")
		}
		return errors.New(hint)
	}
	if e == nil {
		muxLogLine(ctx, fmt.Sprintf("mkvmerge finished (exit code 0, %s)", time.Since(started).Round(time.Second)))
	}
	if e != nil {
		return e
	}
	j.Message = "Verifying"
	j.Progress = 90
	m.saveProgress(j)
	muxLogLine(ctx, "Verifying output …")
	output, e := m.identifyOutput(ctx, runner, out)
	if e != nil {
		return e
	}
	if e = verifyMux(j.Source, output, j.Spec); e != nil {
		return e
	}
	muxLogLine(ctx, fmt.Sprintf("Verified: duration %s, tracks %s", muxDuration(output.DurationNS), muxTrackCounts(output)))
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if cfg.WorkDir != "" {
		muxLogLine(ctx, "Moving output …")
		j.Message = "Moving output"
		j.Progress = 90
		m.saveProgress(j)
		if e = stageMuxOutput(ctx, out, tmp, func(copied, total int64) {
			if time.Since(last) >= time.Second {
				j.Progress = 90 + int(copied*4/max(total, 1))
				m.saveProgress(j)
				last = time.Now()
			}
		}); e != nil {
			return e
		}
		j.Progress = 94
		m.saveProgress(j)
	}
	// Re-resolve and check immediately before any destructive operation.
	latest := m.s.Config()
	again, e := resolveLocalPath(latest.Mux, j.Service, f.SourcePath)
	physical, againDisk, diskError := "", "", error(nil)
	if e == nil {
		physical, againDisk, diskError = muxResolvePhysical(latest, again)
	}
	if e != nil || diskError != nil || again != shareSource || physical != src || againDisk != disk || !checkMuxFile(src, f.Size, j.Source).Unchanged {
		return errors.New("Media file changed before replacement")
	}
	if e = ctx.Err(); e != nil {
		return e
	}
	j.Message = "Replacing"
	if e = m.saveRunning(j); e != nil {
		return errors.New("Could not save mux job")
	}
	kind := "same name"
	if final != src {
		kind = "new name"
	}
	if j.Spec.DeleteOriginal {
		kind += ", deleting original through " + muxServiceName(j.Service)
	}
	muxLogLine(ctx, "Replacing original … ("+kind+")")
	preserve = true
	if e = m.finalize(ctx, j, f, src, tmp, final); e != nil {
		j.Status = "needs_attention"
		return e
	}
	attentionMessage := j.Message
	j.Message = "Rescanning"
	j.Progress = 95
	m.saveProgress(j)
	if e = m.finishSync(ctx, j, f); e != nil {
		j.Status = "needs_attention"
		return e
	}
	if j.Status == "needs_attention" {
		j.Message = attentionMessage
	}
	return nil
}
func (m *MuxManager) finalize(ctx context.Context, j *MuxJob, f File, src, tmp, final string) error {
	if final != src {
		if _, e := os.Lstat(final); !os.IsNotExist(e) {
			return errors.New("Output file already exists")
		}
		if e := os.Link(tmp, final); e != nil {
			return errors.New("Could not publish output file")
		}
		if e := os.Remove(tmp); e != nil {
			return errors.New("Could not remove temporary output")
		}
		if j.Spec.DeleteOriginal {
			if e := m.deleteOriginal(ctx, *j, f); e != nil {
				j.Status = "needs_attention"
				return e
			}
		}
		return nil
	}
	deleted := false
	if j.Spec.DeleteOriginal {
		if e := m.deleteOriginal(ctx, *j, f); e == nil {
			if _, e := os.Lstat(src); os.IsNotExist(e) {
				deleted = true
			} else {
				j.Status = "needs_attention"
			}
		} else {
			j.Status = "needs_attention"
		}
	}
	if !deleted {
		backup := src + ".scopearr-backup-" + strconv.FormatInt(j.ID, 10)
		if _, e := os.Lstat(backup); !os.IsNotExist(e) {
			return errors.New("Backup file already exists")
		}
		if e := os.Link(src, backup); e != nil {
			return errors.New("Could not preserve original as backup")
		}
		j.BackupName = filepath.Base(backup)
		if e := m.saveRunning(j); e != nil {
			return e
		}
		if e := os.Remove(src); e != nil {
			return errors.New("Could not prepare media replacement")
		}
	}
	if e := os.Link(tmp, final); e != nil {
		j.Status = "needs_attention"
		return errors.New("Verified output retained in temporary file; replacement failed")
	}
	if e := os.Remove(tmp); e != nil {
		j.Status = "needs_attention"
		return errors.New("Could not remove temporary output")
	}
	if j.Status == "needs_attention" {
		j.Message = "Original preserved as backup because Arr deletion failed"
	}
	return nil
}
func (m *MuxManager) status() map[string]any {
	st := m.toolStatus()
	out := map[string]any{"enabled": m.s.Config().Mux.Enabled, "installed": st.Installed, "pending": 0, "running": 0, "failed": 0}
	jobs, _ := m.s.Store.muxJobs()
	for _, j := range jobs {
		key := "pending"
		if j.Status == "running" {
			key = "running"
		} else if j.Status == "failed" || j.Status == "needs_attention" || j.Status == "needs_review" {
			key = "failed"
		}
		out[key] = out[key].(int) + 1
	}
	return out
}

func numericMuxDir(name string) bool {
	if name == "" {
		return false
	}
	for _, c := range name {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}
func muxWorkDir(m MuxSettings, j MuxJob) string {
	return filepath.Join(m.WorkDir, ".scopearr-mux", strconv.FormatInt(j.ID, 10))
}
func muxWorkOutput(m MuxSettings, j MuxJob) string {
	return filepath.Join(muxWorkDir(m, j), "output.mkv.partial")
}

var muxRename = os.Rename
var muxCopy = io.CopyBuffer

// The verified output is staged beside the original before any replacement begins.
func stageMuxOutput(ctx context.Context, out, tmp string, progress func(int64, int64)) (err error) {
	defer func() {
		var pathError *os.PathError
		var linkError *os.LinkError
		if errors.As(err, &pathError) || errors.As(err, &linkError) {
			err = errors.New("Could not move mux output")
		}
	}()
	if e := ctx.Err(); e != nil {
		return e
	}
	if e := muxRename(out, tmp); e == nil {
		return ctx.Err()
	} else if !errors.Is(e, syscall.EXDEV) {
		return e
	}
	src, e := os.Open(out)
	if e != nil {
		return e
	}
	defer src.Close()
	before, e := src.Stat()
	if e != nil {
		return e
	}
	dst, e := os.OpenFile(tmp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, before.Mode().Perm())
	if e != nil {
		return e
	}
	closed := false
	defer func() {
		if !closed {
			dst.Close()
		}
	}()
	reader := &muxCopyReader{ctx: ctx, r: src, total: before.Size(), progress: progress}
	n, e := muxCopy(&muxSyncWriter{file: dst}, reader, make([]byte, 1<<20))
	if e != nil {
		return e
	}
	if e = ctx.Err(); e != nil {
		return e
	}
	if e = dst.Sync(); e != nil {
		return e
	}
	e = dst.Close()
	closed = true
	if e != nil {
		return e
	}
	after, e := os.Stat(tmp)
	if e != nil {
		return e
	}
	original, e := src.Stat()
	if e != nil {
		return e
	}
	if n != before.Size() || after.Size() != before.Size() || original.Size() != before.Size() {
		return errors.New("Mux output size changed while moving")
	}
	return os.Remove(out)
}

type muxCopyReader struct {
	ctx      context.Context
	r        io.Reader
	n, total int64
	progress func(int64, int64)
}

func (r *muxCopyReader) Read(b []byte) (int, error) {
	if e := r.ctx.Err(); e != nil {
		return 0, e
	}
	n, e := r.r.Read(b)
	r.n += int64(n)
	r.progress(r.n, r.total)
	return n, e
}
