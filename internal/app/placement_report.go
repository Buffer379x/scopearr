package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
)

type PlacementShareReport struct {
	ShareDir string         `json:"shareDir"`
	Counts   map[string]int `json:"counts"`
	Several  map[string]int `json:"several"`
}

// One aggregate statement keeps totals and breakdown on the same live snapshot.
// Device diagnostics remain facts of the scan, outside these current row counts.
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
	breakdown := "coalesce(json_group_array(json_object('status',scan_status,'count',n)) FILTER (WHERE " + placementStatusFilters["several"] + "),'[]')"
	rows, e := s.DB.QueryContext(ctx, placementCountFacts+"SELECT share,"+columns+","+breakdown+" FROM placement_count_facts GROUP BY share")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	for rows.Next() {
		var share, raw string
		values := make([]int, len(keys))
		args := []any{&share}
		for n := range values {
			args = append(args, &values[n])
		}
		args = append(args, &raw)
		if e = rows.Scan(args...); e != nil {
			return nil, e
		}
		if index, ok := byShare[share]; ok {
			for n, key := range keys {
				out[index].Counts[key] = values[n]
			}
			var facts []struct {
				Status string `json:"status"`
				Count  int    `json:"count"`
			}
			if e = json.Unmarshal([]byte(raw), &facts); e != nil {
				return nil, e
			}
			for _, fact := range facts {
				out[index].Several[fact.Status] += fact.Count
			}
		}
	}
	return out, rows.Err()
}

func (s *Server) placementReportHTTP(w http.ResponseWriter, r *http.Request) {
	shares, e := s.Store.placementReport(r.Context(), s.Placement.scanStatus().Shares)
	if e != nil {
		failure(w, r, 500, errors.New("Could not read placement report"))
		return
	}
	jsonOut(w, 200, map[string]any{"shares": shares})
}
