package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

var fileCheckSorts = map[string]string{
	"progress": "progress",
	"title":    "title COLLATE NOCASE",
	"path":     "rel COLLATE NOCASE",
	"kind":     "kind",
	"size":     "size",
	"fix":      "fix",
	"status":   "coalesce(nullif(job_status,''),CASE fix WHEN 'manual' THEN 'manual' ELSE 'open' END)",
}

func fileCheckFilter(r *http.Request) (string, []any, error) {
	return fileCheckFilterValues(r.URL.Query())
}

// "Fix all" reuses the list filters so it acts on exactly the filtered rows.
func fileCheckFilterValues(q url.Values) (string, []any, error) {
	clauses := []string{"1=1"}
	args := []any{}
	statuses := []string{}
	for _, status := range q["status"] {
		switch status {
		case "open":
			statuses = append(statuses, "(job_status='' AND fix<>'manual')")
		case "manual":
			statuses = append(statuses, "(job_status='' AND fix='manual')")
		case "fixed":
			statuses = append(statuses, "job_status='succeeded'")
		case "failed":
			statuses = append(statuses, "job_status IN ('failed','needs_review','cancelled')")
		case "active":
			statuses = append(statuses, "job_status IN ('queued','running')")
		case "":
		default:
			return "", nil, errors.New("Invalid filter")
		}
	}
	if len(statuses) > 0 {
		clauses = append(clauses, "("+strings.Join(statuses, " OR ")+")")
	}
	for _, column := range []string{"kind", "fix"} {
		values := []string{}
		for _, value := range q[column] {
			if value == "" {
				continue
			}
			if column == "kind" && !slicesContains(fileCheckKinds, value) {
				return "", nil, errors.New("Invalid filter")
			}
			values = append(values, column+"=?")
			args = append(args, value)
		}
		if len(values) > 0 {
			clauses = append(clauses, "("+strings.Join(values, " OR ")+")")
		}
	}
	if text := q.Get("q"); text != "" {
		clauses = append(clauses, "(instr(lower(title),lower(?))>0 OR instr(lower(rel),lower(?))>0)")
		args = append(args, text, text)
	}
	return strings.Join(clauses, " AND "), args, nil
}

func (s *Server) fileCheckActivity() map[string]any {
	cfg := s.Config()
	var queued, running, fixed int
	_ = s.Store.DB.QueryRow("SELECT coalesce(sum(job_status='queued'),0),coalesce(sum(job_status='running'),0),coalesce(sum(job_status='succeeded'),0) FROM filecheck_items").Scan(&queued, &running, &fixed)
	counts := map[string]int{}
	if rows, e := s.Store.DB.Query("SELECT kind,fix,job_status,count(*) FROM filecheck_items GROUP BY kind,fix,job_status"); e == nil {
		for rows.Next() {
			var kind, fix, status string
			var n int
			if rows.Scan(&kind, &fix, &status, &n) == nil {
				switch {
				case status == "succeeded":
					counts["fixed"] += n
				case status == "failed" || status == "needs_review" || status == "cancelled":
					counts["failed"] += n
				case status == "" && fix == "manual":
					counts["manual"] += n
				case status == "":
					counts["open"] += n
				}
				counts["kind:"+kind] += n
			}
		}
		rows.Close()
	}
	prerequisite := ""
	if e := fileCheckPrerequisite(cfg); e != nil {
		prerequisite = e.Error()
	}
	return map[string]any{"ready": prerequisite == "", "error": prerequisite, "physical": fileCheckPhysical(cfg), "scan": s.FileCheck.scanStatus(), "counts": counts, "queued": queued, "running": running, "fixed": fixed, "fileWork": s.fileWork.current()}
}

func (s *Server) fileCheckHTTP(w http.ResponseWriter, r *http.Request) {
	if s.Demo && r.Method != "GET" {
		failure(w, r, 403, errors.New("File operations are disabled in demo mode"))
		return
	}
	route := strings.TrimPrefix(r.URL.Path, "/api/filecheck/")
	f := s.FileCheck
	switch {
	case route == "scan" && r.Method == "GET":
		jsonOut(w, 200, s.fileCheckActivity())
		return
	case route == "scan" && r.Method == "POST":
		s.fileCheckStartScan(w, r)
		return
	case route == "scan" && r.Method == "DELETE":
		f.mu.Lock()
		if f.scanCancel != nil {
			f.scanCancel()
		}
		f.mu.Unlock()
		jsonOut(w, 200, map[string]bool{"ok": true})
		return
	case route == "export.csv" && r.Method == "GET":
		s.fileCheckCSV(w, r)
		return
	case route == "items" && r.Method == "GET":
		s.fileCheckListHTTP(w, r)
		return
	case route == "items" && r.Method == "DELETE" && r.URL.Query().Get("fixed") == "1":
		if _, e := s.Store.DB.Exec("DELETE FROM filecheck_items WHERE job_status='succeeded'"); e != nil {
			failure(w, r, 500, errors.New("Could not remove fixed items"))
			return
		}
		jsonOut(w, 200, map[string]bool{"ok": true})
		return
	case route == "fix" && r.Method == "POST":
		s.fileCheckStartFix(w, r)
		return
	case route == "cancel" && r.Method == "POST":
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.cancel != nil {
			f.cancel()
		}
		if _, e := s.Store.DB.Exec("UPDATE filecheck_items SET job_status='',queue_pos=NULL,message='' WHERE job_status='queued'"); e != nil {
			failure(w, r, 500, errors.New("Could not cancel queued fixes"))
			return
		}
		jsonOut(w, 200, map[string]bool{"ok": true})
		return
	case route == "commands" && r.Method == "POST":
		s.fileCheckCommandsHTTP(w, r)
		return
	case strings.HasPrefix(route, "items/"):
		id, e := strconv.ParseInt(strings.TrimPrefix(route, "items/"), 10, 64)
		if e != nil || id <= 0 {
			http.NotFound(w, r)
			return
		}
		item, e := s.Store.fileCheckItem(id)
		if e != nil {
			http.NotFound(w, r)
			return
		}
		if r.Method == "GET" {
			jsonOut(w, 200, item)
			return
		}
		if r.Method == "DELETE" {
			result, e := s.Store.DB.Exec("DELETE FROM filecheck_items WHERE id=? AND job_status='succeeded'", id)
			if e != nil {
				failure(w, r, 500, errors.New("Could not remove item"))
				return
			}
			if n, _ := result.RowsAffected(); n != 1 {
				failure(w, r, 409, errors.New("Only fixed items can be removed"))
				return
			}
			jsonOut(w, 200, map[string]bool{"ok": true})
			return
		}
	}
	failure(w, r, 405, errors.New("Endpoint or method not supported"))
}

func (s *Server) fileCheckStartScan(w http.ResponseWriter, r *http.Request) {
	var options FileCheckSettings
	if e := decode(w, r, &options); e != nil {
		failure(w, r, 400, e)
		return
	}
	s.settingsMu.Lock()
	defer s.settingsMu.Unlock()
	f := s.FileCheck
	f.mu.Lock()
	defer f.mu.Unlock()
	active, e := s.Store.fileCheckActive()
	if e != nil {
		failure(w, r, 500, errors.New("Could not read fix queue"))
		return
	}
	if f.scan.Running || active || f.pendingFinal != nil {
		failure(w, r, 409, errors.New("Finish or cancel fixes first"))
		return
	}
	cfg := s.Config()
	cfg.FileCheck = options
	if e = normalizeFileCheck(&cfg); e != nil {
		failure(w, r, 400, e)
		return
	}
	if e = fileCheckPrerequisite(cfg); e != nil {
		failure(w, r, 400, e)
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
	f.scanCancel = cancel
	f.scan.Running = true
	f.scan.Error = ""
	f.scan.StartedAt = time.Now().UTC().Format(time.RFC3339Nano)
	f.scan.Checked, f.scan.Total = 0, 0
	f.wg.Add(1)
	go func() { defer f.wg.Done(); defer cancel(); f.runScan(ctx, cfg) }()
	jsonOut(w, 202, map[string]bool{"ok": true})
}

func (s *Server) fileCheckListHTTP(w http.ResponseWriter, r *http.Request) {
	where, args, err := s.fileCheckListFilter(r.Context(), r.URL.Query())
	if err != nil {
		failure(w, r, 400, err)
		return
	}
	order, err := fileCheckListOrder(r.URL.Query())
	if err != nil {
		failure(w, r, 400, err)
		return
	}
	var total int
	if e := s.Store.DB.QueryRowContext(r.Context(), "SELECT count(*) FROM filecheck_items WHERE "+where, args...).Scan(&total); e != nil {
		failure(w, r, 500, errors.New("Could not read findings"))
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 {
		limit = s.Config().PageSize
	}
	limit = min(max(limit, 1), 500)
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	offset = max(offset, 0)
	rows, e := s.Store.DB.QueryContext(r.Context(), "SELECT "+fileCheckColumns+" FROM filecheck_items WHERE "+where+" ORDER BY "+order+" LIMIT ? OFFSET ?", append(append([]any{}, args...), limit, offset)...)
	if e != nil {
		failure(w, r, 500, errors.New("Could not read findings"))
		return
	}
	items := []FileCheckItem{}
	for rows.Next() {
		item, e := scanFileCheck(rows)
		if e != nil {
			rows.Close()
			failure(w, r, 500, errors.New("Could not read findings"))
			return
		}
		items = append(items, item)
	}
	rows.Close()
	// "Fix all" and the header checkbox never include untracked videos.
	ids := []int64{}
	if rows, e = s.Store.DB.QueryContext(r.Context(), "SELECT id FROM filecheck_items WHERE "+where+" AND "+fileCheckFixable+" AND kind<>'untracked_media' ORDER BY "+order, args...); e == nil {
		for rows.Next() {
			var id int64
			if rows.Scan(&id) == nil {
				ids = append(ids, id)
			}
		}
		rows.Close()
	}
	jsonOut(w, 200, map[string]any{"items": items, "total": total, "selectableIds": ids, "shares": s.fileCheckShares(r.Context())})
}

func (s *Server) fileCheckStartFix(w http.ResponseWriter, r *http.Request) {
	var in struct {
		IDs   []int64 `json:"ids"`
		All   bool    `json:"all"`
		Query string  `json:"query"`
	}
	if e := decodeLimit(w, r, &in, 512<<10); e != nil {
		failure(w, r, 400, e)
		return
	}
	if len(in.IDs) > 50000 {
		failure(w, r, 400, errors.New("Too many selected items"))
		return
	}
	f := s.FileCheck
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.scan.Running {
		failure(w, r, 409, errors.New("Wait for the scan to finish"))
		return
	}
	if e := fileCheckPrerequisite(s.Config()); e != nil {
		failure(w, r, 400, e)
		return
	}
	where := fileCheckFixable
	args := []any{}
	if in.All {
		values, e := url.ParseQuery(in.Query)
		if e != nil {
			failure(w, r, 400, errors.New("Invalid filter"))
			return
		}
		filter, filterArgs, err := fileCheckFilterForRoots(values, f.scan.Roots)
		if err != nil {
			failure(w, r, 400, err)
			return
		}
		where += " AND kind<>'untracked_media' AND " + filter
		args = append(args, filterArgs...)
	}
	wanted := map[int64]bool{}
	for _, id := range in.IDs {
		wanted[id] = true
	}
	tx, e := s.Store.DB.BeginTx(r.Context(), nil)
	if e != nil {
		failure(w, r, 500, errors.New("Could not queue fixes"))
		return
	}
	defer tx.Rollback()
	rows, e := tx.QueryContext(r.Context(), "SELECT id FROM filecheck_items WHERE "+where+" ORDER BY "+fileCheckOrder, args...)
	if e != nil {
		failure(w, r, 500, errors.New("Could not queue fixes"))
		return
	}
	ordered := []int64{}
	for rows.Next() {
		var id int64
		if rows.Scan(&id) == nil && (in.All || wanted[id]) {
			ordered = append(ordered, id)
		}
	}
	rows.Close()
	var position int64
	_ = tx.QueryRow("SELECT coalesce(max(queue_pos),0) FROM filecheck_items WHERE job_status IN ('queued','running')").Scan(&position)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for _, id := range ordered {
		position++
		if _, e = tx.ExecContext(r.Context(), "UPDATE filecheck_items SET job_status='queued',queue_pos=?,progress=0,message='',updated_at=?,finished_at=NULL WHERE id=? AND "+fileCheckFixable, position, now, id); e != nil {
			failure(w, r, 500, errors.New("Could not queue fixes"))
			return
		}
	}
	if e = tx.Commit(); e != nil {
		failure(w, r, 500, errors.New("Could not queue fixes"))
		return
	}
	jsonOut(w, 202, map[string]int{"queued": len(ordered)})
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'\''`) + "'"
}

// fileCheckCommands builds terminal commands for the user to review and run on Unraid.
func fileCheckCommands(cfg Settings, items []FileCheckItem) string {
	host := cfg.Unraid.Enabled && cfg.Unraid.ShareRoot != ""
	lines := []string{"#!/bin/bash", "# Generated by Scopearr. Review every line before running it on Unraid."}
	if !host {
		lines = append(lines, "# These are container paths. Replace the media mount (for example /media) with its host path.")
	}
	fc := cfg.FileCheck
	// One block per path: a deletion makes chown/chmod pointless; duplicates collapse.
	order := []string{}
	byPath := map[string][]FileCheckItem{}
	for _, item := range items {
		if _, seen := byPath[item.Path]; !seen {
			order = append(order, item.Path)
		}
		byPath[item.Path] = append(byPath[item.Path], item)
	}
	for _, original := range order {
		group := byPath[original]
		p := original
		if host && pathWithin(cfg.Unraid.ShareRoot, p) {
			p = filepath.ToSlash(filepath.Join("/mnt/user", strings.TrimPrefix(p, cfg.Unraid.ShareRoot)))
		}
		if strings.ContainsAny(p, "\r\n\x00") {
			lines = append(lines, "# skipped: unsupported characters")
			continue
		}
		quoted := shellQuote(p)
		var removal *FileCheckItem
		for n := range group {
			if group[n].Kind != "permissions" && group[n].Kind != "owner" {
				removal = &group[n]
				break
			}
		}
		switch {
		case removal != nil && removal.Kind == "empty_dir":
			lines = append(lines, "rmdir "+quoted)
		case removal != nil && removal.Dir:
			lines = append(lines, "rm -rf -- "+quoted)
		case removal != nil:
			lines = append(lines, "rm -f -- "+quoted)
		default:
			mode := fc.FileMode
			if group[0].Dir {
				mode = fc.DirMode
			}
			lines = append(lines, fmt.Sprintf("chown %d:%d %s", fc.OwnerUID, fc.OwnerGID, quoted), fmt.Sprintf("chmod %s %s", strings.TrimPrefix(mode, "0"), quoted))
		}
	}
	return strings.Join(lines, "\n") + "\n"
}

func (s *Server) fileCheckCommandsHTTP(w http.ResponseWriter, r *http.Request) {
	var in struct {
		IDs []int64 `json:"ids"`
	}
	if e := decodeLimit(w, r, &in, 512<<10); e != nil || len(in.IDs) == 0 || len(in.IDs) > 50000 {
		failure(w, r, 400, errors.New("Select at least one finding"))
		return
	}
	items := []FileCheckItem{}
	for _, id := range in.IDs {
		if item, e := s.Store.fileCheckItem(id); e == nil && item.JobStatus != "succeeded" {
			items = append(items, item)
		}
	}
	jsonOut(w, 200, map[string]any{"text": fileCheckCommands(s.Config(), items), "count": len(items), "hostPaths": s.Config().Unraid.Enabled})
}

func fileCheckListOrder(q url.Values) (string, error) {
	order := fileCheckOrder
	if field := q.Get("sort"); field != "" {
		column, ok := fileCheckSorts[field]
		dir := q.Get("dir")
		if !ok || dir != "asc" && dir != "desc" {
			return "", errors.New("Invalid sort")
		}
		order = column + " " + strings.ToUpper(dir) + ",id"
	}
	return order, nil
}
