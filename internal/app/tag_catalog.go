package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"sort"
	"strings"
)

const tagCatalogSchema = `CREATE TABLE IF NOT EXISTS custom_tag_labels(tag_id INTEGER PRIMARY KEY REFERENCES custom_tags(id) ON DELETE CASCADE,label TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS display_tag_catalog(field TEXT NOT NULL,value TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(field,value));
PRAGMA user_version=13;`

var catalogFields = []string{"resolution", "codec", "family", "source", "processing", "hdr", "bitDepth", "audio", "channels"}

type CatalogTag struct {
	Field       string `json:"field"`
	Value       string `json:"value"`
	Count       int    `json:"count"`
	MediaServer bool   `json:"mediaServer,omitempty"`
}

func catalogField(field string) bool { return containsString(catalogFields, field) }
func traitValues(field, value string) []string {
	if value == "" {
		return []string{"__unknown__"}
	}
	if field == "hdr" || field == "audio" || field == "channels" {
		return strings.Split(value, " + ")
	}
	return []string{value}
}

// Aggregate complete tuples once per field; composite traits count each file once per value.
func traitCounts(ctx context.Context, q tagQueryer, field string) (map[string]int, error) {
	out := map[string]int{}
	if !catalogField(field) {
		return nil, errors.New("Invalid tag category")
	}
	rows, e := q.QueryContext(ctx, `SELECT `+field+`,count(*),sum(CASE WHEN json_valid(data) THEN EXISTS(SELECT 1 FROM json_each(data,'$.unknownTraits') WHERE value=?) ELSE 0 END) FROM files GROUP BY `+field, field)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	for rows.Next() {
		var value string
		var n, unknown int
		if e = rows.Scan(&value, &n, &unknown); e != nil {
			return nil, e
		}
		seen := map[string]bool{}
		for _, v := range traitValues(field, value) {
			if !seen[v] {
				out[v] += n
				seen[v] = true
			}
		}
		if value != "" && unknown > 0 {
			out["__unknown__"] += unknown
		}
	}
	return out, rows.Err()
}
func rememberTagRules(ctx context.Context, tx *sql.Tx, rules []RecognitionRule) error {
	for _, r := range rules {
		if !r.Enabled || !ruleIsTag(r) || !catalogField(r.Field) {
			continue
		}
		values := []string{normalizeRuleValue(r.Field, r.Value)}
		if strings.Contains(r.Value, "$") {
			values = nil
			rows, e := tx.QueryContext(ctx, `SELECT DISTINCT `+r.Field+` FROM files WHERE EXISTS(SELECT 1 FROM json_each(data,'$.evidence.'||?||'.rules') WHERE value=?)`, r.Field, r.ID)
			if e != nil {
				return e
			}
			for rows.Next() {
				var v string
				if e = rows.Scan(&v); e != nil {
					rows.Close()
					return e
				}
				values = append(values, traitValues(r.Field, v)...)
			}
			e = rows.Err()
			rows.Close()
			if e != nil {
				return e
			}
		}
		for _, v := range values {
			if _, e := tx.ExecContext(ctx, "INSERT OR IGNORE INTO display_tag_catalog(field,value) VALUES(?,?)", r.Field, v); e != nil {
				return e
			}
		}
	}
	return nil
}
func (s *Store) TagCatalog(ctx context.Context) ([]CatalogTag, error) {
	s.catalogLoad.Lock()
	defer s.catalogLoad.Unlock()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.cacheMu.Lock()
	cached, generation := s.catalogCache, s.cacheGeneration
	s.cacheMu.Unlock()
	if cached != nil {
		return append([]CatalogTag{}, cached...), nil
	}
	tx, rules, err := s.beginRecognitionRead(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	active, err := displayTags(ctx, tx, rules)
	if err != nil {
		return nil, err
	}
	counts, err := allTraitCounts(ctx, tx)
	if err != nil {
		return nil, err
	}
	values := map[string]CatalogTag{}
	for field, tags := range active {
		if !catalogField(field) {
			continue
		}
		for _, value := range tags {
			values[field+":"+value] = CatalogTag{Field: field, Value: value, Count: counts[field][value]}
		}
	}
	rows, err := tx.QueryContext(ctx, "SELECT field,value,deleted FROM display_tag_catalog")
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var tag CatalogTag
		var deleted bool
		if err = rows.Scan(&tag.Field, &tag.Value, &deleted); err != nil {
			rows.Close()
			return nil, err
		}
		tag.Count = counts[tag.Field][tag.Value]
		key := tag.Field + ":" + tag.Value
		_, isActive := values[key]
		if deleted && (!isActive || tag.Count == 0) {
			delete(values, key)
		} else {
			values[key] = tag
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	mediaValues, err := mediaServerTagValues(ctx, tx)
	if err != nil {
		return nil, err
	}
	out := make([]CatalogTag, 0, len(values))
	for key, tag := range values {
		tag.MediaServer = mediaValues[key]
		out = append(out, tag)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Field != out[j].Field {
			return out[i].Field < out[j].Field
		}
		return out[i].Value < out[j].Value
	})
	s.cacheMu.Lock()
	if generation == s.cacheGeneration {
		s.catalogCache = out
	}
	s.cacheMu.Unlock()
	return append([]CatalogTag{}, out...), nil
}

// Provenance describes values actually used from verified server metadata, not
// every codec a server could report. This read shares the catalog's snapshot and
// cache, so rendering color rows never requires upstream requests or per-file JSON
// decoding in Go. Rule-derived values and API-only Arr evidence stay unmarked.
func mediaServerTagValues(ctx context.Context, tx *sql.Tx) (map[string]bool, error) {
	rows, err := tx.QueryContext(ctx, `SELECT e.key,json_extract(e.value,'$.emby')
		FROM files f,json_each(CASE WHEN json_valid(f.data) THEN f.data ELSE '{}' END,'$.evidence') e
		WHERE json_extract(e.value,'$.origin') IN ('emby','mediaServer','combined')
		AND coalesce(json_extract(e.value,'$.emby'),'')<>''
		GROUP BY e.key,json_extract(e.value,'$.emby')`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var field, value string
		if err = rows.Scan(&field, &value); err != nil {
			return nil, err
		}
		if !catalogField(field) {
			continue
		}
		for _, v := range traitValues(field, value) {
			if v != "" {
				out[field+":"+v] = true
			}
		}
		if field == "codec" {
			out["family:"+family(value)] = true
		}
	}
	return out, rows.Err()
}
func (s *Store) DeleteCatalogTag(ctx context.Context, field, value string) error {
	if !catalogField(field) || value == "" {
		return errors.New("Invalid tag category")
	}
	s.recognitionMu.Lock()
	defer s.recognitionMu.Unlock()
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	counts, e := traitCounts(ctx, tx, field)
	if e != nil {
		return e
	}
	if counts[value] > 0 {
		return errors.New("Remove tag assignments before deleting the tag")
	}
	result, e := tx.ExecContext(ctx, "UPDATE display_tag_catalog SET deleted=1 WHERE field=? AND value=? AND deleted=0", field, value)
	if e != nil {
		return e
	}
	n, _ := result.RowsAffected()
	if n != 1 {
		return errors.New("Tag no longer exists")
	}
	var raw string
	e = tx.QueryRowContext(ctx, "SELECT value FROM kv WHERE key='settings'").Scan(&raw)
	if e != nil && e != sql.ErrNoRows {
		return e
	}
	if e == nil {
		var cfg Settings
		if e = json.Unmarshal([]byte(raw), &cfg); e != nil {
			return e
		}
		delete(cfg.TagColors, field+":"+value)
		delete(cfg.TagTextColors, field+":"+value)
		delete(cfg.HiddenTags, field+":"+value)
		data, _ := json.Marshal(cfg)
		if _, e = tx.ExecContext(ctx, "UPDATE kv SET value=? WHERE key='settings'", string(data)); e != nil {
			return e
		}
	}
	if e = tx.Commit(); e != nil {
		return e
	}
	s.invalidateCustomFacets()
	return nil
}
func (s *Store) seedTagCatalog(ctx context.Context) error {
	var cfg Settings
	if err := s.Get("settings", &cfg); err != nil && err != sql.ErrNoRows {
		return err
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if e = rememberDisplayTags(ctx, tx, s.recognition.Load().config.Rules); e != nil {
		return e
	}
	if cfg.TagColors != nil || cfg.TagTextColors != nil {
		for _, m := range []map[string]string{cfg.TagColors, cfg.TagTextColors} {
			for key := range m {
				f, v, ok := strings.Cut(key, ":")
				if ok && catalogField(f) {
					if _, e = tx.ExecContext(ctx, "INSERT OR IGNORE INTO display_tag_catalog(field,value) VALUES(?,?)", f, v); e != nil {
						return e
					}
				}
			}
		}
	}
	return tx.Commit()
}

func allTraitCounts(ctx context.Context, q tagQueryer) (map[string]map[string]int, error) {
	out := map[string]map[string]int{}
	for _, f := range catalogFields {
		out[f] = map[string]int{}
	}
	columns := strings.Join(catalogFields, ",")
	unknown := `CASE WHEN json_valid(data) THEN coalesce(json_extract(data,'$.unknownTraits'),'[]') ELSE '[]' END`
	rows, e := q.QueryContext(ctx, `SELECT `+columns+`,`+unknown+`,count(*) FROM files GROUP BY `+columns+`,`+unknown)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	for rows.Next() {
		values := make([]string, len(catalogFields))
		args := make([]any, 0, len(values)+2)
		for i := range values {
			args = append(args, &values[i])
		}
		var raw string
		var n int
		args = append(args, &raw, &n)
		if e = rows.Scan(args...); e != nil {
			return nil, e
		}
		var missing []string
		if e = json.Unmarshal([]byte(raw), &missing); e != nil {
			return nil, e
		}
		for i, f := range catalogFields {
			seen := map[string]bool{}
			for _, v := range traitValues(f, values[i]) {
				if !seen[v] {
					out[f][v] += n
					seen[v] = true
				}
			}
			if values[i] != "" && containsString(missing, f) {
				out[f]["__unknown__"] += n
			}
		}
	}
	return out, rows.Err()
}
