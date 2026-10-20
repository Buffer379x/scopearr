package app

import (
	"context"
	"encoding/json"
	"errors"
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
	s           *Server
	mu          sync.Mutex
	wg          sync.WaitGroup
	once        sync.Once
	tool        MuxToolStatus
	active      int64
	cancel      context.CancelFunc
	testRunner  muxRunner
	lastCleanup time.Time
	checks      map[int64]muxCheckCache
}

func NewMuxManager(s *Server) *MuxManager {
	m := &MuxManager{s: s, checks: map[int64]muxCheckCache{}}
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
			m.recoverJobs()
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
		replacing := j.Message == "Replacing" || j.Message == "Rescanning"
		if !replacing {
			if f, e := m.s.Store.muxFile(j.Service, j.FileID); e == nil {
				if src, e := resolveMuxDestination(m.s.Config().Mux, j.Service, f.SourcePath); e == nil {
					os.Remove(muxTemp(src, j))
				}
			}
		}
		j.Status = "failed"
		j.Message = "Interrupted by restart"
		if replacing {
			j.Status = "needs_attention"
			j.Message = "Interrupted during replacement. Verified output has been preserved"
		}
		m.s.Store.muxSave(&j)
	}
}
func muxTemp(src string, j MuxJob) string {
	return filepath.Join(filepath.Dir(src), "."+j.Spec.OutputName+".scopearr-"+strconv.FormatInt(j.ID, 10)+".partial")
}
func (m *MuxManager) processOne(ctx context.Context) {
	m.mu.Lock()
	cfg := m.s.Config()
	if m.active != 0 || m.tool.Busy != "" || !m.tool.Installed || !cfg.Mux.Enabled {
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
	j.Status = "running"
	j.Message = "Checking media file"
	j.Progress = 0
	if m.s.Store.muxSave(&j) != nil {
		m.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(ctx)
	m.active = j.ID
	m.cancel = cancel
	m.mu.Unlock()
	e = m.execute(ctx, &j)
	wasCancelled := ctx.Err() != nil
	cancel()
	m.mu.Lock()
	m.active = 0
	m.cancel = nil
	defer m.mu.Unlock()
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
	m.s.Store.muxSave(&j)
}
func (m *MuxManager) execute(ctx context.Context, j *MuxJob) error {
	f, e := m.s.Store.muxFile(j.Service, j.FileID)
	if e != nil {
		return errors.New("File is no longer in Radarr/Sonarr")
	}
	src, e := resolveLocalPath(m.s.Config().Mux, j.Service, f.SourcePath)
	if e != nil {
		return e
	}
	cfg := m.s.Config().Mux
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
	m.s.Store.muxSave(j)
	last := time.Time{}
	os.MkdirAll(m.toolBase(), 0700)
	logFile, err := os.OpenFile(m.logPath(j.ID), os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return errors.New("Could not open mux log")
	}
	defer logFile.Close()
	paths := []string{src, out, tmp, final, cfg.WorkDir}
	mappings, _ := parsePathMappings(cfg.Mappings)
	for _, p := range mappings {
		paths = append(paths, p.arr, p.emby)
	}
	live := &muxLiveLog{file: logFile, paths: paths}
	live.line("Scopearr mux log")
	logCtx := context.WithValue(ctx, muxLogKey{}, live)
	warnings, e := runner.Mux(logCtx, args, func(n int) {
		if time.Since(last) >= time.Second {
			j.Progress = n * 90 / 100
			m.s.Store.muxSave(j)
			last = time.Now()
		}
	})
	j.Log = strings.Join(warnings, "\n")
	if e != nil {
		live.line("Error: " + e.Error())
	} else {
		live.line("Finished: MKVToolNix completed")
	}
	if e != nil {
		return e
	}
	j.Message = "Verifying"
	j.Progress = 90
	m.s.Store.muxSave(j)
	output, e := runner.Identify(ctx, out)
	if e != nil {
		return e
	}
	if e = verifyMux(j.Source, output, j.Spec); e != nil {
		return e
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if cfg.WorkDir != "" {
		j.Message = "Moving output"
		j.Progress = 90
		m.s.Store.muxSave(j)
		if e = stageMuxOutput(ctx, out, tmp, func(copied, total int64) {
			if time.Since(last) >= time.Second {
				j.Progress = 90 + int(copied*4/max(total, 1))
				m.s.Store.muxSave(j)
				last = time.Now()
			}
		}); e != nil {
			return e
		}
		j.Progress = 94
		m.s.Store.muxSave(j)
	}
	// Re-resolve and check immediately before any destructive operation.
	again, e := resolveLocalPath(m.s.Config().Mux, j.Service, f.SourcePath)
	if e != nil || again != src || !checkMuxFile(src, f.Size, j.Source).Unchanged {
		return errors.New("Media file changed before replacement")
	}
	if e = ctx.Err(); e != nil {
		return e
	}
	j.Message = "Replacing"
	if e = m.s.Store.muxSave(j); e != nil {
		return errors.New("Could not save mux job")
	}
	preserve = true
	if e = m.finalize(ctx, j, f, src, tmp, final); e != nil {
		j.Status = "needs_attention"
		return e
	}
	attentionMessage := j.Message
	j.Message = "Rescanning"
	j.Progress = 95
	m.s.Store.muxSave(j)
	if e = m.finishSync(ctx, *j, f); e != nil {
		j.Status = "needs_attention"
		return e
	}
	if j.Status == "needs_attention" {
		j.Message = attentionMessage
	}
	return nil
}
func verifyMux(source, output MuxSource, spec MuxSpec) error {
	if output.Size <= 0 || output.Container == "" {
		return errors.New("Output verification failed")
	}
	delta := source.DurationNS - output.DurationNS
	if delta < 0 {
		delta = -delta
	}
	if source.DurationNS > 0 && (output.DurationNS == 0 || delta > int64(time.Second)) {
		return errors.New("Output duration differs from source")
	}
	expected := map[string]int{}
	actual := map[string]int{}
	for _, t := range source.Tracks {
		if spec.Tracks[t.ID].Keep {
			expected[t.Type]++
		}
	}
	for _, t := range output.Tracks {
		actual[t.Type]++
	}
	for _, kind := range []string{"video", "audio", "subtitles"} {
		if expected[kind] != actual[kind] {
			return errors.New("Output track count differs from selection")
		}
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
		if e := m.s.Store.muxSave(j); e != nil {
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
	n, e := muxCopy(struct{ io.Writer }{dst}, reader, make([]byte, 1<<20))
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
