package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
)

const fileSelectionLimit = 10000

type FileKey struct {
	Service  string `json:"service"`
	ID       int    `json:"id"`
	MediaID  int    `json:"mediaId,omitempty"`
	Filename string `json:"filename,omitempty"`
	Title    string `json:"title,omitempty"`
	Season   *int   `json:"season,omitempty"`
}
type FileSelection struct {
	Keys      []FileKey `json:"keys"`
	Total     int       `json:"total"`
	Truncated bool      `json:"truncated"`
}
type FileGroup struct {
	Service   string `json:"service"`
	MediaID   int    `json:"mediaId"`
	Season    *int   `json:"season,omitempty"`
	Total     int    `json:"total"`
	Seasons   int    `json:"seasons"`
	Continued bool   `json:"continued"`
}

// Bind one bounded JSON value instead of thousands of SQL placeholders.
func explicitSelection(q url.Values, keys []FileKey) (url.Values, error) {
	if keys == nil {
		return q, nil
	}
	if len(keys) == 0 || len(keys) > fileSelectionLimit {
		return nil, fmt.Errorf("Select between 1 and 10000 files")
	}
	for _, k := range keys {
		if !serviceOK(k.Service) || k.ID <= 0 {
			return nil, fmt.Errorf("Invalid file selection")
		}
	}
	raw, e := json.Marshal(keys)
	if e != nil {
		return nil, e
	}
	return url.Values{"_files": {string(raw)}}, nil
}

func (s *Store) SelectFiles(ctx context.Context, q url.Values, mode string) (FileSelection, error) {
	out := FileSelection{Keys: []FileKey{}}
	filter, args, e := s.scopedWhere(q)
	if e != nil {
		return out, e
	}
	if mode == "season" && groupedSeries(q) {
		filter = "(f.service,f.media_id,f.season) IN (SELECT f.service,f.media_id,f.season FROM files f WHERE " + filter + ") AND " + s.activePredicate("f.")
	}
	for _, field := range []struct{ param, column string }{{"mediaId", "media_id"}, {"season", "season"}} {
		if q.Has(field.param) {
			n, e := strconv.Atoi(q.Get(field.param))
			if e != nil || n < 0 {
				return out, fmt.Errorf("Invalid selection group")
			}
			filter += " AND f." + field.column + "=?"
			args = append(args, n)
		}
	}
	// Instance is required for a group when querying all instances: IDs are not global.
	if instance := q.Get("groupService"); instance != "" {
		if !serviceOK(instance) {
			return out, fmt.Errorf("Invalid selection group")
		}
		filter += " AND f.service=?"
		args = append(args, instance)
	}
	order, e := displayOrder(q)
	if e != nil {
		return out, e
	}
	tx, e := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	if e = tx.QueryRowContext(ctx, "SELECT count(*) FROM files f WHERE "+filter, args...).Scan(&out.Total); e != nil {
		return out, e
	}
	rows, e := tx.QueryContext(ctx, "SELECT f.service,f.id,f.media_id,f.season,f.filename,f.title FROM files f WHERE "+filter+" ORDER BY "+order+" LIMIT 10000", args...)
	if e != nil {
		return out, e
	}
	defer rows.Close()
	for rows.Next() {
		var k FileKey
		if e = rows.Scan(&k.Service, &k.ID, &k.MediaID, &k.Season, &k.Filename, &k.Title); e != nil {
			return out, e
		}
		out.Keys = append(out.Keys, k)
	}
	out.Truncated = out.Total > fileSelectionLimit
	return out, rows.Err()
}

func (s *Server) fileSelectionHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		failure(w, r, 405, fmt.Errorf("Endpoint or method not supported"))
		return
	}
	q := r.URL.Query()
	q.Set("_infoMask", strconv.Itoa(infoMask(s.Config())))
	mode := q.Get("mode")
	if mode == "" {
		mode = s.Config().SeasonMode
	}
	if mode != "season" && mode != "matches" {
		failure(w, r, 400, fmt.Errorf("Invalid view mode"))
		return
	}
	out, e := s.Store.SelectFiles(r.Context(), q, mode)
	if e != nil {
		failure(w, r, 400, e)
		return
	}
	jsonOut(w, 200, out)
}

// Count only the series/seasons represented on this page, including context.
func (s *Store) pageGroups(ctx context.Context, reader interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, q url.Values, mode string, out Results, filter string, args []any) ([]FileGroup, error) {
	result := []FileGroup{}
	if !groupedSeries(q) || len(out.Files) == 0 {
		return result, nil
	}
	series := map[string]*FileGroup{}
	seasons := map[string]bool{}
	for _, f := range out.Files {
		key := f.Service + ":" + strconv.Itoa(f.MediaID)
		series[key] = &FileGroup{Service: f.Service, MediaID: f.MediaID}
		seasons[key+":"+strconv.Itoa(f.Season)] = true
	}
	groups := []FileGroup{}
	for _, g := range series {
		groups = append(groups, *g)
	}
	raw, _ := json.Marshal(groups)
	// Read only page-series keys through the group index before evaluating
	// compound metadata filters. Reuse the predicate built before the page
	// transaction: a fresh scopedWhere call would need another pooled connection.
	pageSeries := "(f.service,f.media_id) IN (SELECT json_extract(value,'$.service'),json_extract(value,'$.mediaId') FROM json_each(?))"
	if mode == "season" {
		filter = "(f.service,f.media_id,f.season) IN (SELECT f.service,f.media_id,f.season FROM files f INDEXED BY files_group WHERE " + pageSeries + " AND " + filter + ")"
		args = append([]any{string(raw)}, args...)
	}
	first := out.Files[0]
	episode := 0
	for n, e := range first.Episodes {
		if n == 0 || e.Number < episode {
			episode = e.Number
		}
	}
	params := []any{first.Season, episode, first.ID, string(raw)}
	params = append(params, args...)
	rows, e := reader.QueryContext(ctx, `SELECT f.service,f.media_id,f.season,count(*),sum((f.season,f.episode_sort,f.id)<(?,?,?)) FROM files f INDEXED BY files_group WHERE `+pageSeries+` AND `+filter+` GROUP BY f.service,f.media_id,f.season ORDER BY f.service,f.media_id,f.season`, params...)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	for rows.Next() {
		var service string
		var media, season, total, before int
		if e = rows.Scan(&service, &media, &season, &total, &before); e != nil {
			return nil, e
		}
		key := service + ":" + strconv.Itoa(media)
		g := series[key]
		g.Total += total
		g.Seasons++
		if out.Page > 1 && service == first.Service && media == first.MediaID && before > 0 {
			g.Continued = true
		}
		if seasons[key+":"+strconv.Itoa(season)] {
			v := season
			result = append(result, FileGroup{Service: service, MediaID: media, Season: &v, Total: total})
		}
	}
	if e = rows.Err(); e != nil {
		return nil, e
	}
	for _, g := range series {
		result = append(result, *g)
	}
	return result, nil
}
