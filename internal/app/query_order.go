package app

import (
	"fmt"
	"net/url"
	"strings"

	_ "modernc.org/sqlite"
)

func groupedSeries(q url.Values) bool {
	return serviceKind(q.Get("service")) == "sonarr" && (q.Get("sort") == "" || q.Get("sort") == "title")
}

func displayOrder(q url.Values) (string, error) {
	order, err := movieOrder(q)
	if err == nil && groupedSeries(q) {
		direction := "ASC"
		if q.Get("dir") == "desc" {
			direction = "DESC"
		}
		order = "f.series COLLATE NOCASE " + direction + ",f.service,f.media_id,f.season,f.episode_sort,f.id"
	}
	return order, err
}
func movieOrder(q url.Values) (string, error) {
	field := q.Get("sort")
	if field == "info" {
		order, err := infoOrderSQL(q)
		if serviceKind(q.Get("service")) == "sonarr" {
			order = strings.Replace(order, ",f.title COLLATE NOCASE ASC,f.id ASC", ",f.series COLLATE NOCASE,f.season,f.episode_sort,f.id,f.service", 1)
		}
		return order, err
	}
	if field == "" {
		field = "title"
	}
	expression, ok := map[string]string{
		"custom": "(SELECT group_concat(name_sort) FROM (SELECT lower(coalesce(nullif(l.label,''),t.name_key)) name_sort FROM file_custom c JOIN custom_tags t ON t.id=c.tag_id LEFT JOIN custom_tag_labels l ON l.tag_id=t.id WHERE c.file_rowid=f.rowid ORDER BY name_sort))",
		"title":  "f.title COLLATE NOCASE", "year": "(SELECT min(year) FROM years y WHERE y.file_rowid=f.rowid)",
		"resolution": "CASE f.resolution WHEN '4320p' THEN 4320 WHEN '2160p' THEN 2160 WHEN '1440p' THEN 1440 WHEN '1080p' THEN 1080 WHEN '720p' THEN 720 WHEN '576p' THEN 576 WHEN '480p' THEN 480 ELSE CAST(f.resolution AS INTEGER) END",
		"codec":      "f.codec COLLATE NOCASE", "source": "f.source COLLATE NOCASE", "processing": "f.processing COLLATE NOCASE", "size": "f.size", "hdr": "f.hdr COLLATE NOCASE", "bitDepth": "CAST(f.bitDepth AS INTEGER)", "audio": "(f.language||' '||f.audio) COLLATE NOCASE", "channels": "CAST(f.channels AS REAL)", "language": "f.language COLLATE NOCASE",
	}[field]
	if !ok {
		return "", fmt.Errorf("Invalid sort field")
	}
	direction := q.Get("dir")
	if direction == "" {
		direction = "asc"
	}
	if direction != "asc" && direction != "desc" {
		return "", fmt.Errorf("Invalid sort direction")
	}
	unknown := "f." + field + "=''"
	if field == "custom" {
		unknown = "NOT EXISTS(SELECT 1 FROM file_custom c WHERE c.file_rowid=f.rowid)"
	}
	if field == "audio" {
		unknown = "f.language='' AND f.audio=''"
	}
	if field == "year" {
		unknown = "NOT EXISTS(SELECT 1 FROM years y WHERE y.file_rowid=f.rowid)"
	}
	if field == "size" {
		unknown = "f.size=0"
	}
	tie := ",f.title COLLATE NOCASE ASC,f.service ASC,f.id ASC"
	if serviceKind(q.Get("service")) == "sonarr" {
		tie = ",f.series COLLATE NOCASE,f.season,f.episode_sort,f.id,f.service"
	}
	return unknown + " ASC," + expression + " " + strings.ToUpper(direction) + tie, nil
}
