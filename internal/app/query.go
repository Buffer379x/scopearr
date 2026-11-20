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
	// The answer of pageBy=series (rc.4 R2): the page holds pageSize
	// series, displayTotal counts the series, total the matching files and
	// offset the matching files of the series before this page.
	PagedBy string `json:"pagedBy,omitempty"`
	Offset  int    `json:"offset,omitempty"`
	// summary=1 with pageBy=series (D33a): the page's series in their
	// order, each with the numbers of its collapsed row and its files' keys;
	// files then holds only the files of the series named by expand.
	Series *[]SeriesSummary `json:"series,omitempty"`
}

// SeriesSummary is a series of a page of series (summary=1): its listed
// files (the ones the full answer holds for it) counted, their seasons
// counted, and each file's [id, season] in the display order.
type SeriesSummary struct {
	Service string   `json:"service"`
	MediaID int      `json:"mediaId"`
	Series  string   `json:"series"`
	Files   int      `json:"files"`
	Seasons int      `json:"seasons"`
	Keys    [][2]int `json:"keys"`
}

// pageSize reads a page size: a whole number from 1 to 1000.
func pageSize(value string) (int, error) {
	size, err := strconv.Atoi(value)
	if err != nil || size < 1 || size > 1000 {
		return 0, fmt.Errorf("Entries per page must be between 1 and 1000")
	}
	return size, nil
}

func (s *Store) QueryContext(ctx context.Context, q url.Values, mode string, all bool) (Results, error) {
	out := Results{Files: []File{}, Page: 1, PageSize: 100}
	if value := q.Get("_pageSize"); value != "" {
		size, err := pageSize(value)
		if err != nil {
			return out, err
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
	if q.Get("_pageBy") == "series" && q.Get("_distinct") == "" && groupedSeries(q) && !all {
		out, e = querySeriesPage(ctx, tx, q, filter, args, out, mode == "season")
		return out, e
	}
	if mode == "season" && groupedSeries(q) && !all {
		out, e = querySeasonPage(ctx, tx, q, filter, args, out)
		return out, e
	}
	// _distinct=series (filesHTTP, quick search): the first file of each
	// series in the display order; the totals count series.
	if !all && q.Get("_distinct") == "series" {
		out, e = queryDistinctPage(ctx, tx, q, filter, args, out)
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

// queryDistinctPage answers _distinct=series: the first file of each series
// (case-insensitive, files without a series are one) in the display order;
// total counts the series. The filter (often a broad search of the quick
// search) runs once: the series' first files are kept as compact row IDs,
// counted and paged from there (Phase 6.2, 100k check).
func queryDistinctPage(ctx context.Context, tx *sql.Tx, q url.Values, filter string, args []any, out Results) (Results, error) {
	order, err := displayOrder(q)
	if err != nil {
		return out, err
	}
	query := `WITH firsts AS MATERIALIZED (SELECT rowid FROM (SELECT f.rowid,ROW_NUMBER() OVER (PARTITION BY f.series COLLATE NOCASE ORDER BY ` + order + `) AS n FROM files f WHERE ` + filter + `) WHERE n=1),
counts AS MATERIALIZED (SELECT count(*) AS total FROM firsts),
page AS MATERIALIZED (SELECT f.rowid FROM firsts x JOIN files f ON f.rowid=x.rowid ORDER BY ` + order + ` LIMIT ? OFFSET ?)
SELECT ` + fileDataSQL + `,counts.total,` + customJSON + `
FROM counts LEFT JOIN page p ON 1 LEFT JOIN files f ON f.rowid=p.rowid ORDER BY ` + order
	params := append(append([]any{}, args...), out.PageSize, (out.Page-1)*out.PageSize)
	rows, err := tx.QueryContext(ctx, query, params...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var raw sql.NullString
		var custom string
		if err = rows.Scan(&raw, &out.Total, &custom); err != nil {
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
		file.Matched = true
		out.Files = append(out.Files, file)
	}
	out.DisplayTotal = out.Total
	return out, rows.Err()
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

// querySeriesPage pages a TV library in its series order by series (rc.4
// R2, pageBy=series): a series is a service's media ID, as the table groups
// it, and a page holds the series pageSize places on with all their matching
// files, or in the season view (whole) every season that has a match.
// displayTotal counts the matching series, total the matching files and
// offset the matching files of the series on the pages before.
func querySeriesPage(ctx context.Context, tx *sql.Tx, q url.Values, filter string, args []any, out Results, season bool) (Results, error) {
	order, err := displayOrder(q)
	if err != nil {
		return out, err
	}
	direction := "ASC"
	if q.Get("dir") == "desc" {
		direction = "DESC"
	}
	members := `SELECT m.rowid FROM matched m JOIN page USING(service,media_id)`
	if season {
		members = `SELECT f.rowid FROM files f INDEXED BY files_group WHERE (f.service,f.media_id,f.season) IN (SELECT DISTINCT m.service,m.media_id,m.season FROM matched m JOIN page USING(service,media_id))`
	}
	summary := q.Get("_summary") == "1"
	// out.Series points at list, which the rows below fill.
	list := []SeriesSummary{}
	if summary {
		out.Series = &list
	}
	// In a summary only the files of the expanded series carry their data.
	data, custom, expanded := fileDataSQL, customJSON, ""
	if summary {
		expanded = `,opened AS MATERIALIZED (SELECT value AS k FROM json_each(?))`
		open := `(f.service||'/'||f.media_id) IN (SELECT k FROM opened)`
		data = `CASE WHEN ` + open + ` THEN ` + fileDataSQL + ` END`
		custom = `CASE WHEN ` + open + ` THEN ` + customJSON + ` ELSE '[]' END`
	}
	query := `WITH matched AS MATERIALIZED (SELECT f.rowid,f.service,f.media_id,f.season,f.series FROM files f WHERE ` + filter + `),
shows AS MATERIALIZED (SELECT service,media_id,max(series) AS series,count(*) AS n FROM matched GROUP BY service,media_id),
ranked AS MATERIALIZED (SELECT service,media_id,n,ROW_NUMBER() OVER (ORDER BY series COLLATE NOCASE ` + direction + `,service,media_id) AS r FROM shows),
counts AS MATERIALIZED (SELECT (SELECT count(*) FROM matched) AS total,(SELECT count(*) FROM shows) AS shows,(SELECT coalesce(sum(n),0) FROM ranked WHERE r<=?) AS before),
page AS MATERIALIZED (SELECT service,media_id FROM ranked WHERE r>? AND r<=?),
listed AS MATERIALIZED (` + members + `)` + expanded + `
SELECT ` + data + `,coalesce(f.rowid IN (SELECT rowid FROM matched),0),counts.total,counts.shows,counts.before,` + custom + `,f.service,f.media_id,f.season,f.id,f.series
FROM counts LEFT JOIN listed p ON 1 LEFT JOIN files f ON f.rowid=p.rowid ORDER BY ` + order
	skip := (out.Page - 1) * out.PageSize
	params := append(append([]any{}, args...), skip, skip, skip+out.PageSize)
	if summary {
		opened := q.Get("_expand")
		if opened == "" {
			opened = "[]"
		}
		params = append(params, opened)
	}
	rows, err := tx.QueryContext(ctx, query, params...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	out.PagedBy = "series"
	var seasons map[int]bool
	for rows.Next() {
		var raw sql.NullString
		var matched bool
		var custom string
		var service, series sql.NullString
		var mediaID, season, id sql.NullInt64
		if err = rows.Scan(&raw, &matched, &out.Total, &out.DisplayTotal, &out.Offset, &custom, &service, &mediaID, &season, &id, &series); err != nil {
			return out, err
		}
		if !service.Valid {
			continue
		}
		if summary {
			last := len(list) - 1
			if last < 0 || list[last].Service != service.String || list[last].MediaID != int(mediaID.Int64) {
				list = append(list, SeriesSummary{Service: service.String, MediaID: int(mediaID.Int64), Series: series.String, Keys: [][2]int{}})
				last++
				seasons = map[int]bool{}
			}
			entry := &list[last]
			entry.Files++
			entry.Keys = append(entry.Keys, [2]int{int(id.Int64), int(season.Int64)})
			if !seasons[int(season.Int64)] {
				seasons[int(season.Int64)] = true
				entry.Seasons++
			}
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
