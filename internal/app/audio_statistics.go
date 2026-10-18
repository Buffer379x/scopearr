package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"sort"
	"strings"
)

// Read compact index groups once; never repeatedly decode every full file record.
func addAudioStatistics(ctx context.Context, tx *sql.Tx, out *Statistics, active ...string) error {
	out.FileTotals = map[string]int{"all": 0, "radarr": 0, "sonarr": 0}
	counts := map[string]map[string]int{"all": {}, "radarr": {}, "sonarr": {}}
	condition := "1"
	if len(active) > 0 {
		condition = active[0]
	}
	rows, e := tx.QueryContext(ctx, `SELECT service,audio,CASE WHEN json_valid(data) THEN json_extract(data,'$.unknownTraits') END,count(*) FROM files INDEXED BY files_audio_statistics WHERE `+condition+` GROUP BY 1,2,3`)
	if e != nil {
		return e
	}
	defer rows.Close()
	for rows.Next() {
		var service, value string
		var traits sql.NullString
		var n int
		if e = rows.Scan(&service, &value, &traits, &n); e != nil {
			return e
		}
		unknown := value == ""
		if traits.Valid {
			var fields []string
			if e = json.Unmarshal([]byte(traits.String), &fields); e != nil {
				return e
			}
			for _, field := range fields {
				if field == "audio" {
					unknown = true
				}
			}
		}
		seen := map[string]bool{}
		for _, codec := range strings.Split(value, " + ") {
			if codec != "" {
				seen[codec] = true
			}
		}
		if unknown {
			seen[""] = true
		}
		for _, scope := range []string{"all", serviceKind(service)} {
			out.FileTotals[scope] += n
			for codec := range seen {
				counts[scope][codec] += n
			}
		}
	}
	if e = rows.Err(); e != nil {
		return e
	}
	for scope, values := range counts {
		buckets := []StatisticBucket{}
		for value, n := range values {
			buckets = append(buckets, StatisticBucket{Value: value, Count: n})
		}
		sort.Slice(buckets, func(i, j int) bool {
			if buckets[i].Count != buckets[j].Count {
				return buckets[i].Count > buckets[j].Count
			}
			return buckets[i].Value < buckets[j].Value
		})
		out.Distributions[scope]["audio"] = buckets
	}
	return nil
}
