package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"os"
	"strings"
	"time"
)

var errMuxNotRunning = errors.New("Mux job is no longer running")

// The worker owns running jobs. A concurrent metadata writer must not prevent completion.
func (s *Store) muxFinish(j *MuxJob) error {
	spec, e := json.Marshal(j.Spec)
	if e != nil {
		return e
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	e = s.DB.QueryRow(`UPDATE mux_jobs SET status=?,message=?,progress=?,log=?,backup_name=?,spec=?,finished_at=?,updated_at=?,revision=revision+1 WHERE id=? AND status='running' RETURNING revision`, j.Status, j.Message, j.Progress, j.Log, j.BackupName, string(spec), j.FinishedAt, now, j.ID).Scan(&j.Revision)
	if errors.Is(e, sql.ErrNoRows) {
		return errMuxNotRunning
	}
	return e
}
func muxLocked(e error) bool {
	text := strings.ToLower(e.Error())
	return strings.Contains(text, "database is locked") || strings.Contains(text, "database is busy") || strings.Contains(text, "sqlite_busy") || strings.Contains(text, "sqlite_locked") || strings.Contains(text, "database table is locked")
}
func (m *MuxManager) saveRunning(j *MuxJob) error {
	snapshot := *j
	snapshot.Status = "running"
	e := m.s.Store.muxSave(&snapshot)
	if e == nil {
		j.Revision = snapshot.Revision
	} else {
		log.Printf("mux job %d: could not store progress: %v", j.ID, e)
	}
	return e
}
func (m *MuxManager) saveProgress(j *MuxJob) {
	m.saveRunning(j)
}
func (m *MuxManager) storeFinal(j *MuxJob) error {
	if m.testFinish != nil {
		return m.testFinish(j)
	}
	return m.s.Store.muxFinish(j)
}

// Called without m.mu; active stays set while a final write is retried.
func (m *MuxManager) persistFinal(ctx context.Context, j *MuxJob) error {
	budget := 2 * time.Minute
	if m.testFinishBudget > 0 {
		budget = m.testFinishBudget
	}
	retryCtx, cancel := context.WithTimeout(ctx, budget)
	defer cancel()
	delay := 500 * time.Millisecond
	if m.testFinishDelay > 0 {
		delay = m.testFinishDelay
	}
	for {
		e := m.storeFinal(j)
		if e == nil || errors.Is(e, errMuxNotRunning) {
			return e
		}
		log.Printf("mux job %d: could not store final state: %v", j.ID, e)
		if !muxLocked(e) {
			return e
		}
		select {
		case <-retryCtx.Done():
			return e
		case <-time.After(delay):
		}
		delay = min(delay*2, 5*time.Second)
	}
}

// Caller holds m.mu. Failed final writes retain the exact result for the next tick.
func (m *MuxManager) rememberFinal(j MuxJob, e error) {
	if e == nil || errors.Is(e, errMuxNotRunning) {
		delete(m.pendingFinal, j.ID)
		return
	}
	log.Printf("mux job %d: final state retained for retry: %v", j.ID, e)
	m.pendingFinal[j.ID] = j
}
func muxAfterReplacement(j MuxJob) bool {
	return j.Message == "Replacing" || j.Message == "Rescanning" || strings.HasPrefix(j.Message, "Waiting for ") || j.Progress >= 95
}
func (m *MuxManager) recoverJob(j *MuxJob, lost bool) {
	replacing := muxAfterReplacement(*j)
	unreachable := false
	if !replacing {
		if f, e := m.s.Store.muxFile(j.Service, j.FileID); e == nil {
			if src, e := resolveMuxJobDestination(m.s.Config(), *j, f.SourcePath); e == nil {
				os.Remove(muxTemp(src, *j))
			} else if j.Source.DiskPath != "" {
				unreachable = true
			}
		}
	}
	j.Status = "failed"
	j.Message = "Interrupted by restart"
	if replacing {
		j.Status = "needs_attention"
		j.Message = "Interrupted during replacement. Verified output has been preserved"
	}
	if lost {
		j.Message = "Job state was lost. Start it again"
		if replacing {
			j.Message = "Job state was lost after replacement. Check the output and retry the rescan"
		}
	}
	if unreachable {
		j.Status = "needs_attention"
		j.Message = "Original disk is not reachable. Check the output manually"
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	j.FinishedAt = &now
	if ctx, closeLog, e := m.openJobLog(context.Background(), *j, true); e == nil {
		muxLogLine(ctx, "Error: "+j.Message)
		closeLog()
	}
	e := m.storeFinal(j)
	m.rememberFinal(*j, e)
}

// Called under m.mu before selecting another queued job, including when the tool is disabled.
func (m *MuxManager) reconcileFinals() {
	for id, j := range m.pendingFinal {
		if e := m.storeFinal(&j); e == nil || errors.Is(e, errMuxNotRunning) {
			delete(m.pendingFinal, id)
		} else {
			log.Printf("mux job %d: could not store final state: %v", id, e)
		}
	}
	if m.active != 0 {
		return
	}
	jobs, e := m.s.Store.muxJobs()
	if e != nil {
		return
	}
	for _, j := range jobs {
		if _, pending := m.pendingFinal[j.ID]; pending {
			continue
		}
		updated, e := time.Parse(time.RFC3339Nano, j.UpdatedAt)
		if j.Status == "running" && e == nil && time.Since(updated) > 60*time.Second {
			if m.s.fileWork.try("mux") {
				m.recoverJob(&j, true)
				m.s.fileWork.release("mux")
			}
		}
	}
}
