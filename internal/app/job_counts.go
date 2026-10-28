package app

// Findings and unstarted placement plans are not queued work.
func (s *Server) openFileJobs(table string) map[string]any {
	out := map[string]any{"pending": 0, "running": 0, "failed": 0}
	if table != "placement_items" && table != "filecheck_items" {
		return out
	}
	rows, err := s.Store.DB.Query("SELECT job_status,count(*) FROM " + table + " WHERE job_status IN ('queued','running','failed','needs_attention','needs_review') GROUP BY job_status")
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var status string
		var count int
		if rows.Scan(&status, &count) != nil {
			continue
		}
		key := "failed"
		if status == "queued" {
			key = "pending"
		} else if status == "running" {
			key = "running"
		}
		out[key] = out[key].(int) + count
	}
	return out
}
