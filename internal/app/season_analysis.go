package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strings"
)

const seasonSchema = `CREATE TABLE IF NOT EXISTS season_analysis(file_rowid INTEGER PRIMARY KEY REFERENCES files(rowid) ON DELETE CASCADE,technical INTEGER NOT NULL,languages INTEGER NOT NULL,reasons TEXT NOT NULL); CREATE INDEX IF NOT EXISTS season_technical ON season_analysis(technical,file_rowid); CREATE INDEX IF NOT EXISTS season_languages ON season_analysis(languages,file_rowid); PRAGMA user_version=14;`
const fileDataSQL = `CASE WHEN json_valid(f.data) THEN json_patch(f.data,coalesce((SELECT json_object('seasonOutlier',json(CASE WHEN a.technical THEN 'true' ELSE 'false' END),'languageOutlier',json(CASE WHEN a.languages THEN 'true' ELSE 'false' END),'seasonReasons',json(a.reasons)) FROM season_analysis a WHERE a.file_rowid=f.rowid),'{}')) ELSE f.data END`

type seasonEntry struct {
	id     int64
	traits [5]string
	weight int
}

func canonicalSet(value, separator string) string {
	values := strings.Split(value, separator)
	sort.Strings(values)
	unique := []string{}
	for _, v := range values {
		v = strings.TrimSpace(v)
		if v != "" && (len(unique) == 0 || unique[len(unique)-1] != v) {
			unique = append(unique, v)
		}
	}
	return strings.Join(unique, separator)
}

// Analyze complete cached seasons, independently of the active list filter.
// Read compact grouped traits and store indexed flags; never retain full file JSON.
func rebuildSeasonAnalysis(ctx context.Context, tx *sql.Tx, mediaID *int, instances ...string) error {
	condition := scopePredicate("service", "sonarr")
	args := []any{}
	if len(instances) > 0 {
		condition = "service=?"
		args = append(args, instances[0])
	}
	if mediaID != nil {
		condition += " AND media_id=?"
		args = append(args, *mediaID)
	}
	query := `SELECT rowid,service,media_id,season,resolution,family,audio,channels,language,coalesce(json_extract(data,'$.episodes'),'[]'),coalesce(json_extract(data,'$.unknownTraits'),'[]') FROM files WHERE ` + condition + ` ORDER BY service,media_id,season,id`
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return err
	}
	// The cursor must be closed before mutations on this connection. Only small
	// trait records are retained, never evidence or track JSON.
	groups := [][]seasonEntry{}
	var group []seasonEntry
	lastMedia, lastSeason := -1, -1
	lastService := ""
	for rows.Next() {
		var entry seasonEntry
		var media, season int
		var instance string
		var episodes, unknown string
		if err = rows.Scan(&entry.id, &instance, &media, &season, &entry.traits[0], &entry.traits[1], &entry.traits[2], &entry.traits[3], &entry.traits[4], &episodes, &unknown); err != nil {
			rows.Close()
			return err
		}
		if instance != lastService || media != lastMedia || season != lastSeason {
			if len(group) > 0 {
				groups = append(groups, group)
			}
			group = nil
			lastMedia, lastSeason = media, season
			lastService = instance
		}
		var eps []Episode
		if err = json.Unmarshal([]byte(episodes), &eps); err != nil {
			rows.Close()
			return err
		}
		identities := map[int]bool{}
		for _, ep := range eps {
			if ep.ID > 0 {
				identities[ep.ID] = true
			}
		}
		entry.weight = len(identities)
		if entry.weight < 1 {
			entry.weight = 1
		}
		var incomplete []string
		if err = json.Unmarshal([]byte(unknown), &incomplete); err != nil {
			rows.Close()
			return err
		}
		for _, field := range incomplete {
			if field == "language" {
				entry.traits[4] = ""
			}
			if field == "audio" {
				entry.traits[2] = ""
			}
		}
		entry.traits[2] = canonicalSet(entry.traits[2], " + ")
		entry.traits[3] = canonicalSet(entry.traits[3], " + ")
		entry.traits[4] = canonicalSet(normLanguage(entry.traits[4]), ", ")
		group = append(group, entry)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if len(group) > 0 {
		groups = append(groups, group)
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM season_analysis WHERE file_rowid IN (SELECT rowid FROM files WHERE `+condition+`)`, args...); err != nil {
		return err
	}
	insert, err := tx.PrepareContext(ctx, "INSERT INTO season_analysis(file_rowid,technical,languages,reasons) VALUES(?,?,?,?)")
	if err != nil {
		return err
	}
	defer insert.Close()
	keys := []string{"resolution", "codec", "audio", "channels", "language"}
	for _, entries := range groups {
		total := 0
		for _, entry := range entries {
			total += entry.weight
		}
		if total < 3 {
			continue
		}
		baseline := [5]string{}
		for field := 0; field < 5; field++ {
			counts := map[string]int{}
			for _, entry := range entries {
				if entry.traits[field] != "" {
					counts[entry.traits[field]] += entry.weight
				}
			}
			for value, n := range counts {
				if n >= 2 && n*2 > total {
					baseline[field] = value
				}
			}
		}
		for _, entry := range entries {
			reasons := map[string]string{}
			technical, languages := false, false
			for field, expected := range baseline {
				if expected != "" && entry.traits[field] != "" && entry.traits[field] != expected {
					reasons[keys[field]] = expected
					if field == 4 {
						languages = true
					} else {
						technical = true
					}
				}
			}
			if !technical && !languages {
				continue
			}
			raw, _ := json.Marshal(reasons)
			if _, err = insert.ExecContext(ctx, entry.id, technical, languages, string(raw)); err != nil {
				return err
			}
		}
	}
	return nil
}
func appendSeasonFilters(q url.Values, w *[]string) error {
	for _, entry := range []struct{ key, column string }{{"seasonOutlier", "technical"}, {"languageOutlier", "languages"}} {
		if v := q.Get(entry.key); v != "" {
			if serviceKind(q.Get("service")) != "sonarr" || (v != "true" && v != "false") {
				return fmt.Errorf("Invalid season outlier filter")
			}
			clause := "EXISTS(SELECT 1 FROM season_analysis a WHERE a.file_rowid=f.rowid AND a." + entry.column + "=1)"
			if v == "false" {
				clause = "NOT " + clause
			}
			*w = append(*w, clause)
		}
	}
	return nil
}
