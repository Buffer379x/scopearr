package app

import (
	"context"
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

type StatisticBucket struct {
	Value string `json:"value"`
	Count int    `json:"count"`
}
type Statistics struct {
	FileTotals     map[string]int                          `json:"fileTotals"`
	LanguageTotals map[string]int                          `json:"languageTotals"`
	Movies         int                                     `json:"movies"`
	Series         int                                     `json:"series"`
	Episodes       int                                     `json:"episodes"`
	Files          int                                     `json:"files"`
	Emby           map[string]int                          `json:"emby"`
	Incomplete     int                                     `json:"incomplete"`
	Distributions  map[string]map[string][]StatisticBucket `json:"distributions"`
}

// One read transaction keeps widgets and diagrams consistent during a sync.
func (s *Store) statistics(ctx context.Context) (Statistics, error) {
	out := Statistics{LanguageTotals: map[string]int{}, Emby: map[string]int{}, Distributions: map[string]map[string][]StatisticBucket{}}
	tx, e := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	active := s.activePredicate("")
	var damaged int
	if e = tx.QueryRowContext(ctx, "SELECT count(*) FROM files INDEXED BY files_statistics WHERE "+active+" AND json_valid(data)=0").Scan(&damaged); e != nil {
		return out, e
	}
	if damaged > 0 {
		return out, fmt.Errorf("Invalid cached file data")
	}
	if e = tx.QueryRowContext(ctx, "SELECT (SELECT count(*) FROM (SELECT DISTINCT service,media_id FROM files WHERE "+scopePredicate("service", "radarr")+" AND "+active+")),(SELECT count(*) FROM (SELECT DISTINCT service,media_id FROM files WHERE "+scopePredicate("service", "sonarr")+" AND "+active+")),(SELECT count(*) FROM files WHERE "+active+")").Scan(&out.Movies, &out.Series, &out.Files); e != nil {
		return out, e
	}
	if e = tx.QueryRowContext(ctx, "SELECT count(*) FROM (SELECT DISTINCT f.service,f.media_id,f.season,json_extract(ep.value,'$.number') FROM files f INDEXED BY files_statistics,json_each(CASE WHEN json_valid(f.data) THEN json_extract(f.data,'$.episodes') END) ep WHERE "+scopePredicate("f.service", "sonarr")+" AND "+s.activePredicate("f.")+")").Scan(&out.Episodes); e != nil {
		return out, e
	}
	if e = tx.QueryRowContext(ctx, "SELECT count(*) FROM files INDEXED BY files_statistics WHERE "+active+" AND (CASE WHEN json_valid(data) THEN coalesce(json_extract(data,'$.metadataIncomplete'),0) END)=1").Scan(&out.Incomplete); e != nil {
		return out, e
	}
	rows, e := tx.QueryContext(ctx, "SELECT coalesce(nullif(emby_match,''),'unconfigured'),count(*) FROM files INDEXED BY files_emby_match WHERE "+active+" GROUP BY 1")
	if e != nil {
		return out, e
	}
	for rows.Next() {
		var state string
		var n int
		if e = rows.Scan(&state, &n); e != nil {
			rows.Close()
			return out, e
		}
		out.Emby[state] = n
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return out, e
	}
	for _, service := range []string{"all", "radarr", "sonarr"} {
		out.Distributions[service] = map[string][]StatisticBucket{}
		for _, field := range []string{"resolution", "codec", "source"} {
			buckets := []StatisticBucket{}
			query := "SELECT " + field + ",count(*) FROM files WHERE " + active
			args := []any{}
			if service != "all" {
				query += " AND " + scopePredicate("service", service)
			}
			query += " GROUP BY " + field + " ORDER BY count(*) DESC," + field + " COLLATE NOCASE"
			rows, err := tx.QueryContext(ctx, query, args...)
			if err != nil {
				return out, err
			}
			for rows.Next() {
				var b StatisticBucket
				if err = rows.Scan(&b.Value, &b.Count); err != nil {
					rows.Close()
					return out, err
				}
				buckets = append(buckets, b)
			}
			err = rows.Err()
			rows.Close()
			if err != nil {
				return out, err
			}
			out.Distributions[service][field] = buckets
		}
	}
	if e = addAudioStatistics(ctx, tx, &out, active); e != nil {
		return out, e
	}
	// Decode episode associations once, rather than once per language and scope.
	// DISTINCT entity identities retain multi-episode and duplicate-file semantics.
	entity := `f.service||':'||f.media_id||CASE WHEN (f.service='sonarr' OR f.service GLOB 'sonarr-*') THEN ':'||f.season||':'||CASE WHEN json_extract(ep.value,'$.number') IS NULL THEN 'file:'||f.id ELSE 'episode:'||json_extract(ep.value,'$.number') END ELSE '' END`
	query := `WITH entities AS MATERIALIZED (SELECT f.rowid AS file_rowid,CASE WHEN f.service='radarr' OR f.service GLOB 'radarr-*' THEN 'radarr' ELSE 'sonarr' END AS service,` + entity + ` AS identity FROM files f INDEXED BY files_statistics LEFT JOIN json_each(CASE WHEN (f.service='sonarr' OR f.service GLOB 'sonarr-*') THEN (CASE WHEN json_valid(f.data) THEN json_extract(f.data,'$.episodes') END) ELSE '[]' END) ep WHERE ` + s.activePredicate("f.") + `),
scopes(service) AS (VALUES('all'),('radarr'),('sonarr'))
SELECT s.service,'' AS language,1 AS is_total,count(DISTINCT e.identity) AS n FROM scopes s LEFT JOIN entities e ON s.service='all' OR e.service=s.service GROUP BY s.service
UNION ALL
SELECT s.service,l.language,0,count(DISTINCT e.identity) FROM scopes s JOIN entities e ON s.service='all' OR e.service=s.service JOIN file_languages l ON l.file_rowid=e.file_rowid GROUP BY s.service,l.language
ORDER BY 1,3 DESC,4 DESC,2`
	for _, service := range []string{"all", "radarr", "sonarr"} {
		out.Distributions[service]["language"] = []StatisticBucket{}
	}
	rows, e = tx.QueryContext(ctx, query)
	if e != nil {
		return out, e
	}
	for rows.Next() {
		var service string
		var bucket StatisticBucket
		var total bool
		if e = rows.Scan(&service, &bucket.Value, &total, &bucket.Count); e != nil {
			rows.Close()
			return out, e
		}
		if total {
			out.LanguageTotals[service] = bucket.Count
		} else {
			out.Distributions[service]["language"] = append(out.Distributions[service]["language"], bucket)
		}
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return out, e
	}
	return out, tx.Commit()
}
