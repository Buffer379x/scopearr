package app

import (
	"context"
	"encoding/csv"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

const placementStartableWhere = "scan_status IN ('split','empty_folders') AND target<>'' AND job_status IN ('','failed')"

// Marked items may also include mover items; "Start all" never does.
const placementSelectableWhere = "scan_status IN ('split','empty_folders','waiting_for_mover') AND target<>'' AND job_status IN ('','failed')"

// Every clickable count and list filter consumes these same predicates.
var placementStatusFilters = func() map[string]string {
	filters := map[string]string{
		"":         "(scan_status<>'ok' OR job_status<>'')",
		"all":      "1=1",
		"several":  "devices>=2 AND job_status<>'succeeded'",
		"one_disk": "devices=1 AND scan_status IN ('ok','empty') AND job_status<>'succeeded'",
		"no_arr":   "service=''",
		"moved":    "job_status='succeeded'",
		"errors":   "(scan_status IN ('error','not_found','outside_share','foreign_owner','conflict','no_space') OR job_status IN ('failed','needs_review','needs_attention'))",
		"open":     "job_status NOT IN ('succeeded','cancelled') AND (scan_status IN ('split','empty_folders','waiting_for_mover') OR job_status IN ('queued','running','failed','needs_review','needs_attention'))",
	}
	for _, status := range []string{"empty", "not_found", "seasons_spread", "ok", "split", "empty_folders", "waiting_for_mover", "conflict", "no_space", "foreign_owner", "outside_share", "error", "queued", "running", "succeeded", "failed", "cancelled", "needs_review", "needs_attention"} {
		filters[status] = "(scan_status='" + status + "' OR job_status='" + status + "')"
	}
	for _, status := range []string{"split", "empty_folders", "empty", "waiting_for_mover", "seasons_spread"} {
		filters["several_"+status] = filters["several"] + " AND scan_status='" + status + "'"
	}
	filters["several_errors"] = filters["several"] + " AND scan_status NOT IN ('split','empty_folders','empty','waiting_for_mover','seasons_spread')"
	return filters
}()

func placementCountColumns() ([]string, string) {
	keys := make([]string, 0, len(placementStatusFilters)-1)
	for name := range placementStatusFilters {
		if name != "" {
			keys = append(keys, name)
		}
	}
	sort.Strings(keys)
	columns := make([]string, len(keys))
	for n, key := range keys {
		columns[n] = "coalesce(sum(CASE WHEN " + placementStatusFilters[key] + " THEN 1 ELSE 0 END),0)"
	}
	return keys, strings.Join(columns, ",")
}

func placementReadCounts(row interface{ Scan(...any) error }, keys []string) (map[string]int, error) {
	values := make([]int, len(keys))
	args := make([]any, len(keys))
	for n := range values {
		args[n] = &values[n]
	}
	if e := row.Scan(args...); e != nil {
		return nil, e
	}
	counts := make(map[string]int, len(keys))
	for n, key := range keys {
		counts[key] = values[n]
	}
	return counts, nil
}

// Display sorting never changes the processing order (placementOrder).
var placementSorts = map[string]string{
	"title":    "title COLLATE NOCASE",
	"service":  "instance COLLATE NOCASE",
	"size":     "total_bytes",
	"disks":    "(SELECT count(*) FROM json_each(disks))",
	"target":   "target",
	"move":     "move_bytes",
	"kind":     "kind",
	"status":   "coalesce(nullif(job_status,''),scan_status)",
	"progress": "progress",
}

func placementSortOrder(r *http.Request) (string, error) {
	field := r.URL.Query().Get("sort")
	if field == "" {
		return placementOrder, nil
	}
	column, ok := placementSorts[field]
	dir := r.URL.Query().Get("dir")
	if !ok || dir != "asc" && dir != "desc" {
		return "", errors.New("Invalid sort")
	}
	return column + " " + strings.ToUpper(dir) + ",id", nil
}

func (s *Server) placementHTTP(w http.ResponseWriter, r *http.Request) {
	if s.Demo && r.Method != "GET" {
		failure(w, r, 403, errors.New("Unraid operations are disabled in demo mode"))
		return
	}
	route := strings.TrimPrefix(r.URL.Path, "/api/placement/")
	p := s.Placement
	switch {
	case route == "scan" && r.Method == "GET":
		scan := p.scanStatus()
		var queued, running, moved int
		var bytesDone, totalBytes int64
		_ = s.Store.DB.QueryRow("SELECT coalesce(sum(job_status='queued'),0),coalesce(sum(job_status='running'),0),coalesce(sum(job_status='succeeded'),0),coalesce(sum(CASE WHEN job_status IN ('queued','running','succeeded') THEN bytes_done ELSE 0 END),0),coalesce(sum(CASE WHEN job_status IN ('queued','running','succeeded') THEN move_bytes ELSE 0 END),0) FROM placement_items").Scan(&queued, &running, &moved, &bytesDone, &totalBytes)
		keys, columns := placementCountColumns()
		counts, e := placementReadCounts(s.Store.DB.QueryRowContext(r.Context(), "SELECT "+columns+" FROM placement_items"), keys)
		if e != nil {
			failure(w, r, 500, errors.New("Could not read placement counts"))
			return
		}

		jsonOut(w, 200, map[string]any{"counts": counts, "scan": scan, "queued": queued, "running": running, "moved": moved, "bytesDone": bytesDone, "totalBytes": totalBytes, "fileWork": s.fileWork.current()})
		return
	case route == "scan" && r.Method == "POST":
		s.placementStartScan(w, r)
		return
	case route == "scan" && r.Method == "DELETE":
		p.mu.Lock()
		if p.scanCancel != nil {
			p.scanCancel()
		}
		p.mu.Unlock()
		jsonOut(w, 200, map[string]bool{"ok": true})
		return
	case route == "items" && r.Method == "GET":
		s.placementListHTTP(w, r)
		return
	case route == "items" && r.Method == "DELETE" && r.URL.Query().Get("moved") == "1":
		p.mu.Lock()
		defer p.mu.Unlock()
		rows, e := s.Store.DB.Query("SELECT id FROM placement_items WHERE job_status='succeeded'")
		if e != nil {
			failure(w, r, 500, errors.New("Could not remove moved items"))
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
			result, e := s.Store.DB.Exec("DELETE FROM placement_items WHERE id=? AND job_status='succeeded'", id)
			if e == nil {
				n, _ := result.RowsAffected()
				if n == 1 {
					_ = os.Remove(p.logPath(id))
				}
			}
		}
		jsonOut(w, 200, map[string]bool{"ok": true})
		return
	case route == "start" && r.Method == "POST":
		s.placementStartJobs(w, r)
		return
	case route == "cancel" && r.Method == "POST":
		p.mu.Lock()
		defer p.mu.Unlock()
		if p.cancel != nil {
			p.cancel()
		}
		if _, e := s.Store.DB.Exec("UPDATE placement_items SET job_status='',queue_pos=NULL,message='' WHERE job_status='queued'"); e != nil {
			failure(w, r, 500, errors.New("Could not cancel queued moves"))
			return
		}
		jsonOut(w, 200, map[string]bool{"ok": true})
		return
	case route == "export.csv" && r.Method == "GET":
		s.placementCSV(w, r)
		return
	case strings.HasPrefix(route, "items/"):
		parts := strings.Split(strings.TrimPrefix(route, "items/"), "/")
		id, e := strconv.ParseInt(parts[0], 10, 64)
		if e != nil || id <= 0 {
			http.NotFound(w, r)
			return
		}
		item, e := s.Store.placementItem(id)
		if e != nil {
			http.NotFound(w, r)
			return
		}
		if len(parts) == 1 && r.Method == "GET" {
			jsonOut(w, 200, placementPresentation(item))
			return
		}
		if len(parts) == 1 && r.Method == "DELETE" {
			// Removes a finished row from the list only; files stay untouched.
			p.mu.Lock()
			defer p.mu.Unlock()
			result, e := s.Store.DB.Exec("DELETE FROM placement_items WHERE id=? AND job_status='succeeded'", id)
			if e != nil {
				failure(w, r, 500, errors.New("Could not remove item"))
				return
			}
			if n, _ := result.RowsAffected(); n != 1 {
				failure(w, r, 409, errors.New("Only moved items can be removed"))
				return
			}
			_ = os.Remove(p.logPath(id))
			jsonOut(w, 200, map[string]bool{"ok": true})
			return
		}
		if len(parts) == 2 && parts[1] == "log" && r.Method == "GET" {
			s.placementLogHTTP(w, r, item)
			return
		}
		if len(parts) == 2 && parts[1] == "recheck" && r.Method == "POST" {
			s.placementRecheck(w, r, item)
			return
		}
	}
	failure(w, r, 405, errors.New("Endpoint or method not supported"))
}
func (s *Server) placementStartScan(w http.ResponseWriter, r *http.Request) {
	var options struct {
		Libraries      []string `json:"libraries"`
		SeriesGrouping string   `json:"seriesGrouping"`
		ExcludedDisks  []string `json:"excludedDisks"`
		ReserveGB      int      `json:"reserveGB"`
		VerifyChecksum bool     `json:"verifyChecksum"`
	}
	if e := decode(w, r, &options); e != nil {
		failure(w, r, 400, e)
		return
	}
	s.settingsMu.Lock()
	defer s.settingsMu.Unlock()
	p := s.Placement
	p.mu.Lock()
	defer p.mu.Unlock()
	active, e := s.Store.placementActive()
	if e != nil {
		failure(w, r, 500, errors.New("Could not read move queue"))
		return
	}
	if p.scan.Running || active || p.pendingFinal != nil {
		failure(w, r, 409, errors.New("Finish or cancel moves first"))
		return
	}
	cfg := s.Config()
	cfg.Unraid.Libraries = options.Libraries
	cfg.Unraid.SeriesGrouping = options.SeriesGrouping
	cfg.Unraid.ExcludedDisks = options.ExcludedDisks
	cfg.Unraid.ReserveGB = options.ReserveGB
	cfg.Unraid.LegacyReserve = nil
	cfg.Unraid.VerifyChecksum = options.VerifyChecksum
	if e = normalizeUnraid(&cfg); e != nil {
		failure(w, r, 400, e)
		return
	}
	if e = placementPrerequisite(cfg); e != nil {
		failure(w, r, 400, e)
		return
	}
	disks, e := discoverDisks(cfg.Unraid.DiskRoot)
	if e != nil {
		failure(w, r, 400, e)
		return
	}
	arrays := 0
	for _, d := range disks {
		if d.Kind == "array" {
			arrays++
		}
	}
	if arrays == 0 {
		failure(w, r, 400, errors.New("No Unraid array disks found"))
		return
	}
	stored := cfg
	stored.Instances = append([]ServiceConfig{}, cfg.Instances...)
	for _, c := range stored.Connections() {
		c.APIKey = s.Security.Seal(c.APIKey)
	}
	stored.mirrorLegacy()
	if e = s.Store.Put("settings", stored); e != nil {
		failure(w, r, 500, errors.New("Could not save scan settings"))
		return
	}
	s.mu.Lock()
	s.settings = cfg
	s.mu.Unlock()
	ctx, cancel := context.WithCancel(s.ctx)
	p.scanCancel = cancel
	p.scan.Running = true
	p.scan.Error = ""
	p.scan.StartedAt = time.Now().UTC().Format(time.RFC3339Nano)
	p.scan.Checked = 0
	p.scan.Total = 0
	p.scan.Disk = ""
	p.wg.Add(1)
	go func() { defer p.wg.Done(); defer cancel(); p.runScan(ctx, cfg) }()
	jsonOut(w, 202, map[string]bool{"ok": true})
}
func placementFilter(r *http.Request) (string, []any, error) {
	clauses := []string{"1=1"}
	args := []any{}
	statuses := []string{}
	for _, status := range r.URL.Query()["status"] {
		if status == "" {
			continue
		}
		predicate, ok := placementStatusFilters[status]
		if !ok {
			return "", nil, errors.New("Invalid filter")
		}
		statuses = append(statuses, "("+predicate+")")
	}
	if len(statuses) == 0 {
		clauses = append(clauses, placementStatusFilters[""])
	}
	if len(statuses) > 0 {
		clauses = append(clauses, "("+strings.Join(statuses, " OR ")+")")
	}
	for _, column := range []string{"target", "kind"} {
		values := []string{}
		for _, value := range r.URL.Query()[column] {
			if value != "" {
				values = append(values, column+"=?")
				args = append(args, value)
			}
		}
		if len(values) > 0 {
			clauses = append(clauses, "("+strings.Join(values, " OR ")+")")
		}
	}
	if q := r.URL.Query().Get("q"); q != "" {
		clauses = append(clauses, "(instr(lower(title),lower(?))>0 OR instr(lower(rel),lower(?))>0)")
		args = append(args, q, q)
	}
	return strings.Join(clauses, " AND "), args, nil
}
func (s *Server) placementListHTTP(w http.ResponseWriter, r *http.Request) {
	where, args, err := placementFilter(r)
	shares := map[string]int{}
	for _, share := range s.Placement.scanStatus().Shares {
		shares[share.ShareDir] += share.Folders
	}
	selected := []string{}
	for _, share := range r.URL.Query()["share"] {
		if _, ok := shares[share]; !ok {
			failure(w, r, 400, errors.New("Invalid filter"))
			return
		}
		selected = append(selected, "share=?")
		args = append(args, share)
	}
	if len(selected) > 0 {
		where += " AND (" + strings.Join(selected, " OR ") + ")"
	}
	if err != nil {
		failure(w, r, 400, err)
		return
	}
	var total int
	if e := s.Store.DB.QueryRowContext(r.Context(), "SELECT count(*) FROM placement_items WHERE "+where, args...).Scan(&total); e != nil {
		failure(w, r, 500, errors.New("Could not read placement items"))
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 {
		limit = s.Config().PageSize
	}
	limit = min(max(limit, 1), 500)
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	offset = max(offset, 0)
	order, e := placementSortOrder(r)
	if e != nil {
		failure(w, r, 400, e)
		return
	}
	projection := strings.Replace(placementColumns, ",files,", ",'[]',", 1)
	pageArgs := append(append([]any{}, args...), limit, offset)
	rows, e := s.Store.DB.QueryContext(r.Context(), "SELECT "+projection+" FROM placement_items WHERE "+where+" ORDER BY "+order+" LIMIT ? OFFSET ?", pageArgs...)
	if e != nil {
		failure(w, r, 500, errors.New("Could not read placement items"))
		return
	}
	items := []PlacementItem{}
	for rows.Next() {
		item, e := scanPlacement(rows)
		if e != nil {
			rows.Close()
			failure(w, r, 500, errors.New("Could not read placement items"))
			return
		}
		items = append(items, placementPresentation(item))
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		failure(w, r, 500, errors.New("Could not read placement items"))
		return
	}
	ids := []int64{}
	rows, e = s.Store.DB.QueryContext(r.Context(), "SELECT id FROM placement_items WHERE "+where+" AND "+placementStartableWhere+" ORDER BY "+order, args...)
	if e == nil {
		for rows.Next() {
			var id int64
			if rows.Scan(&id) == nil {
				ids = append(ids, id)
			}
		}
		rows.Close()
	}
	hiddenOK := 0
	if total == 0 && r.URL.Query().Get("q") != "" {
		q := r.URL.Query()
		q.Del("status")
		q.Add("status", "ok")
		other := r.Clone(r.Context())
		u := *r.URL
		other.URL = &u
		other.URL.RawQuery = q.Encode()
		okWhere, okArgs, err := placementFilter(other)
		if err == nil {
			if len(selected) > 0 {
				okWhere += " AND (" + strings.Join(selected, " OR ") + ")"
				for _, share := range q["share"] {
					okArgs = append(okArgs, share)
				}
			}
			_ = s.Store.DB.QueryRowContext(r.Context(), "SELECT count(*) FROM placement_items WHERE "+okWhere, okArgs...).Scan(&hiddenOK)
		}
	}
	jsonOut(w, 200, map[string]any{"items": items, "total": total, "selectableIds": ids, "shares": shares, "hiddenOK": hiddenOK})
}
func (s *Server) placementStartJobs(w http.ResponseWriter, r *http.Request) {
	var in struct {
		IDs []int64 `json:"ids"`
		All bool    `json:"all"`
	}
	if e := decodeLimit(w, r, &in, 512<<10); e != nil {
		failure(w, r, 400, e)
		return
	}
	if len(in.IDs) > 50000 {
		failure(w, r, 400, errors.New("Too many selected items"))
		return
	}
	s.settingsMu.Lock()
	defer s.settingsMu.Unlock()
	p := s.Placement
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.scan.Running {
		failure(w, r, 409, errors.New("Wait for the scan to finish"))
		return
	}
	cfg := s.Config()
	if e := placementPrerequisite(cfg); e != nil {
		failure(w, r, 400, e)
		return
	}
	if !p.planSettingsMatch(cfg) {
		failure(w, r, 409, errors.New("Unraid paths or mappings changed. Scan again"))
		return
	}
	tx, e := s.Store.DB.BeginTx(r.Context(), nil)
	if e != nil {
		failure(w, r, 500, errors.New("Could not queue moves"))
		return
	}
	defer tx.Rollback()
	// The queue always follows placementOrder, whatever order the IDs arrive in.
	where := placementSelectableWhere
	if in.All {
		where = placementStartableWhere
	}
	wanted := map[int64]bool{}
	for _, id := range in.IDs {
		wanted[id] = true
	}
	rows, e := tx.QueryContext(r.Context(), "SELECT id FROM placement_items WHERE "+where+" ORDER BY "+placementOrder)
	if e != nil {
		failure(w, r, 500, errors.New("Could not queue moves"))
		return
	}
	ordered := []int64{}
	for rows.Next() {
		var id int64
		if rows.Scan(&id) == nil && (in.All || wanted[id]) {
			ordered = append(ordered, id)
		}
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		failure(w, r, 500, errors.New("Could not queue moves"))
		return
	}
	in.IDs = ordered
	var position int64
	_ = tx.QueryRow("SELECT coalesce(max(queue_pos),0) FROM placement_items WHERE job_status IN ('queued','running')").Scan(&position)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for _, id := range in.IDs {
		position++
		if _, e = tx.ExecContext(r.Context(), "UPDATE placement_items SET job_status='queued',queue_pos=?,progress=0,bytes_done=0,message='',updated_at=?,finished_at=NULL WHERE id=? AND "+where, position, now, id); e != nil {
			failure(w, r, 500, errors.New("Could not queue moves"))
			return
		}
	}
	if e = tx.Commit(); e != nil {
		failure(w, r, 500, errors.New("Could not queue moves"))
		return
	}
	jsonOut(w, 202, map[string]bool{"ok": true})
}
func (s *Server) placementRecheck(w http.ResponseWriter, r *http.Request, item PlacementItem) {
	p := s.Placement
	p.mu.Lock()
	defer p.mu.Unlock()
	active, e := s.Store.placementActive()
	if e != nil || p.scan.Running || active {
		failure(w, r, 409, errors.New("Finish or cancel moves first"))
		return
	}
	cfg := s.Config()
	if !p.planSettingsMatch(cfg) {
		failure(w, r, 409, errors.New("Unraid paths or mappings changed. Scan again"))
		return
	}
	disks, e := discoverDisks(cfg.Unraid.DiskRoot)
	if e != nil {
		failure(w, r, 400, e)
		return
	}
	fresh, e := p.inspectItem(r.Context(), cfg.Unraid, disks, item, placementParents{})
	if e != nil {
		failure(w, r, 400, e)
		return
	}
	influx := map[string]int64{}
	rows, e := s.Store.DB.Query("SELECT target,sum(move_bytes) FROM placement_items WHERE id<>? AND "+placementStartableWhere+" GROUP BY target", item.ID)
	if e == nil {
		for rows.Next() {
			var name string
			var size int64
			if rows.Scan(&name, &size) == nil {
				influx[name] = size
			}
		}
		rows.Close()
	}
	forced := ""
	if item.rootOnly() {
		whole := item
		whole.Season = nil
		series, e := p.inspectItem(r.Context(), cfg.Unraid, disks, whole, placementParents{})
		if e == nil {
			var best int64 = -1
			for _, d := range disks {
				if d.Kind == "array" && !slicesContains(cfg.Unraid.ExcludedDisks, d.Name) && series.Disks[d.Name].Bytes > best && series.Disks[d.Name].Bytes > 0 {
					best = series.Disks[d.Name].Bytes
					forced = d.Name
				}
			}
		}
	}
	fresh.JobStatus = ""
	fresh.Progress = 0
	fresh.BytesDone = 0
	fresh.QueuePos = nil
	fresh.FinishedAt = nil
	fresh = planPlacement(fresh, cfg.Unraid, disks, influx, forced)
	check, _, _ := p.checkItem(r.Context(), cfg, fresh)
	fresh.Check = &check
	if e = s.Store.placementSave(&fresh); e != nil {
		failure(w, r, 500, errors.New("Could not update item plan"))
		return
	}
	jsonOut(w, 200, fresh)
}
func (s *Server) placementLogHTTP(w http.ResponseWriter, r *http.Request, item PlacementItem) {
	offset, _ := strconv.ParseInt(r.URL.Query().Get("offset"), 10, 64)
	offset = max(offset, 0)
	text := ""
	if f, e := os.Open(s.Placement.logPath(item.ID)); e == nil {
		defer f.Close()
		if st, e := f.Stat(); e == nil && offset > st.Size() {
			offset = 0
		}
		if _, e = f.Seek(offset, io.SeekStart); e == nil {
			data := make([]byte, 64<<10)
			n, _ := f.Read(data)
			text = string(data[:n])
			offset += int64(n)
		}
	}
	jsonOut(w, 200, map[string]any{"text": text, "offset": offset, "running": item.JobStatus == "running", "queued": item.JobStatus == "queued", "progress": item.Progress, "message": item.Message})
}
func placementCSVCell(value string) string {
	trimmed := strings.TrimLeft(value, " \t\r\n")
	if trimmed != "" && strings.ContainsRune("=+-@", rune(trimmed[0])) {
		return "'" + value
	}
	return value
}
func (s *Server) placementCSV(w http.ResponseWriter, r *http.Request) {
	where := "1=1"
	args := []any{}
	if target := r.URL.Query().Get("target"); target != "" {
		where = "target=?"
		args = append(args, target)
	}
	projection := strings.Replace(placementColumns, ",files,", ",'[]',", 1)
	rows, e := s.Store.DB.QueryContext(r.Context(), "SELECT "+projection+" FROM placement_items WHERE "+where+" ORDER BY "+placementOrder, args...)
	if e != nil {
		failure(w, r, 500, errors.New("Could not export placement items"))
		return
	}
	defer rows.Close()
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="scopearr-disk-placement.csv"`)
	_, _ = io.WriteString(w, "\ufeff")
	out := csv.NewWriter(w)
	out.UseCRLF = true
	_ = out.Write([]string{"target", "source", "kind", "status", "title", "service", "host_path", "total_bytes", "move_bytes", "move_files"})
	for rows.Next() {
		item, e := scanPlacement(rows)
		if e != nil {
			return
		}
		sources := []string{}
		for disk := range item.Disks {
			if disk != item.Target {
				sources = append(sources, disk)
			}
		}
		sort.Strings(sources)
		status := item.ScanStatus
		if item.JobStatus != "" {
			status = item.JobStatus
		}
		values := []string{item.Target, strings.Join(sources, ", "), item.Kind, status, item.Title, item.Instance, filepath.ToSlash(filepath.Join("/mnt/user", item.Rel)), strconv.FormatInt(item.TotalBytes, 10), strconv.FormatInt(item.MoveBytes, 10), strconv.Itoa(item.MoveFiles)}
		for n := range values {
			values[n] = placementCSVCell(values[n])
		}
		if out.Write(values) != nil {
			return
		}
	}
	out.Flush()
}
