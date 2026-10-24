package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"

	_ "modernc.org/sqlite"
)

type Results struct {
	Files        []File `json:"files"`
	Total        int    `json:"total"`
	DisplayTotal int    `json:"displayTotal"`
	Page         int    `json:"page"`
	PageSize     int    `json:"pageSize"`
}

func (s *Store) QueryContext(ctx context.Context, q url.Values, mode string, all bool) (Results, error) {
	out := Results{Files: []File{}, Page: 1, PageSize: 100}
	if value := q.Get("_pageSize"); value != "" {
		size, err := strconv.Atoi(value)
		if err != nil || size < 1 || size > 1000 {
			return out, fmt.Errorf("Entries per page must be between 1 and 1000")
		}
		out.PageSize = size
	}
	filter, args, e := s.scopedWhere(q)
	if e != nil {
		return out, e
	}
	if v := q.Get("page"); v != "" {
		out.Page, e = strconv.Atoi(v)
		if e != nil || out.Page < 1 || out.Page > 100000 {
			return out, fmt.Errorf("Invalid page")
		}
	}
	tx, e := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	if mode == "season" && groupedSeries(q) && !all {
		out, e = querySeasonPage(ctx, tx, q, filter, args, out)
		return out, e
	}
	if e = tx.QueryRowContext(ctx, "SELECT count(*) FROM files f WHERE "+filter, args...).Scan(&out.Total); e != nil {
		return out, e
	}
	out.DisplayTotal = out.Total
	order, e := displayOrder(q)
	if e != nil {
		return out, e
	}
	query := "SELECT " + fileDataSQL + ",1," + customJSON + " FROM files f WHERE " + filter + " ORDER BY " + order
	qa := append([]any{}, args...)
	if !all {
		// Sort compact row IDs first, then load and evaluate only the current page.
		// Carrying large evidence/track JSON through a 50k-row temp sort is avoidable.
		query = "WITH page AS MATERIALIZED (SELECT f.rowid FROM files f WHERE " + filter + " ORDER BY " + order + " LIMIT ? OFFSET ?) SELECT " + fileDataSQL + ",1," + customJSON + " FROM page p JOIN files f ON f.rowid=p.rowid ORDER BY " + order
		qa = append(qa, out.PageSize, (out.Page-1)*out.PageSize)
	}

	rows, e := tx.QueryContext(ctx, query, qa...)
	if e != nil {
		return out, e
	}
	defer rows.Close()
	for rows.Next() {
		var raw string
		var matched bool
		var custom string
		if e = rows.Scan(&raw, &matched, &custom); e != nil {
			return out, e
		}
		var f File
		if e = json.Unmarshal([]byte(raw), &f); e != nil {
			return out, e
		}
		if e = json.Unmarshal([]byte(custom), &f.Custom); e != nil {
			return out, e
		}
		f.Matched = matched
		out.Files = append(out.Files, f)
	}
	if e = rows.Err(); e != nil {
		return out, e
	}
	rows.Close()
	return out, e
}

func querySeasonPage(ctx context.Context, tx *sql.Tx, q url.Values, filter string, args []any, out Results) (Results, error) {
	order, err := displayOrder(q)
	if err != nil {
		return out, err
	}
	// Evaluate costly compound filters once, then reuse compact IDs for season
	// membership, counts and matched markers. The left join retains counts even
	// when no results exist or the requested page is beyond the last page.
	query := `WITH matched AS MATERIALIZED (SELECT f.rowid,f.service,f.media_id,f.season FROM files f WHERE ` + filter + `),
groups AS MATERIALIZED (SELECT DISTINCT service,media_id,season FROM matched),
counts AS MATERIALIZED (SELECT (SELECT count(*) FROM matched) AS total,(SELECT count(*) FROM files f INDEXED BY files_group WHERE (f.service,f.media_id,f.season) IN (SELECT service,media_id,season FROM groups)) AS displayed),
page AS MATERIALIZED (SELECT f.rowid FROM files f INDEXED BY files_series_sort WHERE (f.service,f.media_id,f.season) IN (SELECT service,media_id,season FROM groups) ORDER BY ` + order + ` LIMIT ? OFFSET ?)
SELECT ` + fileDataSQL + `,coalesce(f.rowid IN (SELECT rowid FROM matched),0),counts.total,counts.displayed,` + customJSON + `
FROM counts LEFT JOIN page p ON 1 LEFT JOIN files f ON f.rowid=p.rowid ORDER BY ` + order
	params := append(append([]any{}, args...), out.PageSize, (out.Page-1)*out.PageSize)
	rows, err := tx.QueryContext(ctx, query, params...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var raw sql.NullString
		var matched bool
		var custom string
		if err = rows.Scan(&raw, &matched, &out.Total, &out.DisplayTotal, &custom); err != nil {
			return out, err
		}
		if !raw.Valid {
			continue
		}
		var file File
		if err = json.Unmarshal([]byte(raw.String), &file); err != nil {
			return out, err
		}
		if err = json.Unmarshal([]byte(custom), &file.Custom); err != nil {
			return out, err
		}
		file.Matched = matched
		out.Files = append(out.Files, file)
	}
	return out, rows.Err()
}
