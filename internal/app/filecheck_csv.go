package app

import (
	"encoding/csv"
	"errors"
	"io"
	"net/http"
	"strconv"
)

// Export the complete filtered list, independent of the current page. Rows are
// streamed so a large findings list does not duplicate the cache in memory.
func (s *Server) fileCheckCSV(w http.ResponseWriter, r *http.Request) {
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
	roots := s.FileCheck.scanStatus().Roots
	rows, err := s.Store.DB.QueryContext(r.Context(), "SELECT "+fileCheckColumns+" FROM filecheck_items WHERE "+where+" ORDER BY "+order, args...)
	if err != nil {
		failure(w, r, 500, errors.New("Could not export findings"))
		return
	}
	defer rows.Close()
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="scopearr-file-check.csv"`)
	_, _ = io.WriteString(w, "\ufeff")
	out := csv.NewWriter(w)
	out.UseCRLF = true
	if out.Write([]string{"id", "title", "service", "share", "relative_path", "kind", "size_bytes", "mode", "uid", "gid", "fix", "status", "progress", "note"}) != nil {
		return
	}
	for rows.Next() {
		item, e := scanFileCheck(rows)
		if e != nil {
			return
		}
		status := item.JobStatus
		if status == "" {
			status = "open"
			if item.Fix == "manual" {
				status = "manual"
			}
		}
		values := []string{strconv.FormatInt(item.ID, 10), item.Title, item.Instance, fileCheckShare(roots, item.Root), item.Rel, item.Kind, strconv.FormatInt(item.Size, 10), strconv.FormatUint(uint64(item.Mode), 8), strconv.Itoa(item.UID), strconv.Itoa(item.GID), item.Fix, status, strconv.Itoa(item.Progress), item.Note}
		for n := range values {
			values[n] = placementCSVCell(values[n])
		}
		if out.Write(values) != nil {
			return
		}
	}
	out.Flush()
}
