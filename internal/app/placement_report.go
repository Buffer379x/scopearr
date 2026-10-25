package app

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
)

type PlacementShareReport struct {
	ShareDir string         `json:"shareDir"`
	Counts   map[string]int `json:"counts"`
	Several  map[string]int `json:"several"`
}

// A read transaction keeps the grouped totals and breakdown on the same live
// snapshot even while a worker finishes a move. Scan diagnostics stay separate.
func (s *Store) placementReport(ctx context.Context, shares []PlacementShare) ([]PlacementShareReport, error) {
	keys, columns := placementCountColumns()
	out := make([]PlacementShareReport, 0, len(shares))
	byShare := map[string]int{}
	for _, share := range shares {
		counts := map[string]int{}
		for _, key := range keys {
			counts[key] = 0
		}
		byShare[share.ShareDir] = len(out)
		out = append(out, PlacementShareReport{ShareDir: share.ShareDir, Counts: counts, Several: map[string]int{}})
	}
	tx, e := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	rows, e := tx.QueryContext(ctx, "SELECT share,"+columns+" FROM placement_items GROUP BY share")
	if e != nil {
		return nil, e
	}
	for rows.Next() {
		var share string
		values := make([]int, len(keys))
		args := []any{&share}
		for n := range values {
			args = append(args, &values[n])
		}
		if e = rows.Scan(args...); e != nil {
			rows.Close()
			return nil, e
		}
		if index, ok := byShare[share]; ok {
			for n, key := range keys {
				out[index].Counts[key] = values[n]
			}
		}
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	rows, e = tx.QueryContext(ctx, "SELECT share,scan_status,count(*) FROM placement_items WHERE "+placementStatusFilters["several"]+" GROUP BY share,scan_status")
	if e != nil {
		return nil, e
	}
	for rows.Next() {
		var share, status string
		var count int
		if e = rows.Scan(&share, &status, &count); e != nil {
			rows.Close()
			return nil, e
		}
		if index, ok := byShare[share]; ok {
			out[index].Several[status] = count
		}
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return out, nil
}

func (s *Server) placementReportHTTP(w http.ResponseWriter, r *http.Request) {
	shares, e := s.Store.placementReport(r.Context(), s.Placement.scanStatus().Shares)
	if e != nil {
		failure(w, r, 500, errors.New("Could not read placement report"))
		return
	}
	jsonOut(w, 200, map[string]any{"shares": shares})
}
