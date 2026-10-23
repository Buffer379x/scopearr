package app

// Findings and unstarted placement plans are not queued work.
func (s *Server) openFileJobs(table string) map[string]any {
	out := map[string]any{"pending": 0, "running": 0, "failed": 0}
	if table != "placement_items" && table != "filecheck_items" {
		return out
	}
	var pending, running, failed int
	_ = s.Store.DB.QueryRow("SELECT coalesce(sum(job_status='queued'),0),coalesce(sum(job_status='running'),0),coalesce(sum(job_status IN ('failed','needs_attention','needs_review')),0) FROM "+table).Scan(&pending, &running, &failed)
	out["pending"], out["running"], out["failed"] = pending, running, failed
	return out
}
