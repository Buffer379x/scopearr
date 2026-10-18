package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
)

const tagImportSchema = `CREATE TABLE IF NOT EXISTS external_tag_defs(service TEXT NOT NULL,endpoint TEXT NOT NULL,remote_id INTEGER NOT NULL,custom_id INTEGER REFERENCES custom_tags(id) ON DELETE SET NULL,label TEXT NOT NULL,rules TEXT NOT NULL,PRIMARY KEY(service,endpoint,remote_id));
CREATE INDEX IF NOT EXISTS external_tag_custom ON external_tag_defs(custom_id);
CREATE TABLE IF NOT EXISTS external_tag_bindings(service TEXT NOT NULL,endpoint TEXT NOT NULL,media_id INTEGER NOT NULL,remote_id INTEGER NOT NULL,present INTEGER NOT NULL,imported INTEGER NOT NULL,PRIMARY KEY(service,endpoint,media_id,remote_id));
CREATE TABLE IF NOT EXISTS external_tag_pending(service TEXT NOT NULL,endpoint TEXT NOT NULL,media_id INTEGER NOT NULL,remote_id INTEGER NOT NULL,label TEXT NOT NULL,custom_id INTEGER REFERENCES custom_tags(id) ON DELETE SET NULL,desired INTEGER NOT NULL,baseline INTEGER NOT NULL,conflict INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(service,endpoint,media_id,remote_id));
PRAGMA user_version=12;`

type externalDetail struct {
	ID     int    `json:"id"`
	Label  string `json:"label"`
	Movies []int  `json:"movieIds"`
	Series []int  `json:"seriesIds"`
	Auto   []int  `json:"autoTagIds"`
}
type autoRule struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
	Tags []int  `json:"tags"`
}
type ExternalConflict struct {
	Service  string `json:"service"`
	MediaID  int    `json:"mediaId"`
	RemoteID int    `json:"remoteId"`
	Label    string `json:"label"`
	Desired  bool   `json:"desired"`
}

var ErrExternalConflict = errors.New("External tag changes need review")

func protectedCustom(ctx context.Context, q tagQueryer, id int64, service ...string) (bool, error) {
	query := `SELECT EXISTS(SELECT 1 FROM external_tag_defs WHERE custom_id=? AND rules<>'[]'`
	args := []any{id}
	if len(service) > 0 {
		query += " AND service=?"
		args = append(args, service[0])
	}
	query += ")"
	rows, e := q.QueryContext(ctx, query, args...)
	if e != nil {
		return false, e
	}
	defer rows.Close()
	var on bool
	if rows.Next() {
		e = rows.Scan(&on)
	}
	return on, e
}
func (s *Store) decorateCustom(ctx context.Context, tags []CustomTag) error {
	by := map[int64]*CustomTag{}
	for i := range tags {
		by[tags[i].ID] = &tags[i]
	}
	rows, e := s.DB.QueryContext(ctx, `SELECT custom_id,service,rules FROM external_tag_defs WHERE custom_id IS NOT NULL ORDER BY service,remote_id`)
	if e != nil {
		return e
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var service, raw string
		if e = rows.Scan(&id, &service, &raw); e != nil {
			return e
		}
		tag := by[id]
		if tag == nil {
			continue
		}
		var names []string
		if e = json.Unmarshal([]byte(raw), &names); e != nil {
			return e
		}
		if !containsString(tag.Sources, service) {
			tag.Sources = append(tag.Sources, service)
		}
		for _, name := range names {
			tag.Rules = append(tag.Rules, service+" · "+name)
		}
		tag.Protected = tag.Protected || len(names) > 0
	}
	if e = rows.Err(); e != nil {
		return e
	}
	var config RecognitionConfig
	if e = s.Get("recognition", &config); e != nil {
		return e
	}
	for _, r := range config.Rules {
		if r.Enabled && r.Field == "custom" {
			id, _ := strconv.ParseInt(r.Value, 10, 64)
			if tag := by[id]; tag != nil {
				tag.LocalRule = true
			}
		}
	}
	return nil
}
func containsString(xs []string, x string) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}

const externalCustomSelect = `SELECT f.rowid,d.custom_id FROM files f JOIN external_tag_bindings b ON b.service=f.service AND b.media_id=f.media_id JOIN external_tag_defs d ON d.service=b.service AND d.endpoint=b.endpoint AND d.remote_id=b.remote_id WHERE d.custom_id IS NOT NULL AND b.present=1 AND b.imported=1 AND NOT EXISTS(SELECT 1 FROM external_tag_pending p WHERE p.service=b.service AND p.endpoint=b.endpoint AND p.media_id=b.media_id AND p.remote_id=b.remote_id AND p.desired=0)`

func rebuildExternalCustom(ctx context.Context, tx *sql.Tx, service string) error {
	if _, e := tx.ExecContext(ctx, `DELETE FROM file_custom WHERE file_rowid IN (SELECT rowid FROM files WHERE service=?)`, service); e != nil {
		return e
	}
	_, e := tx.ExecContext(ctx, `INSERT OR IGNORE INTO file_custom SELECT a.file_rowid,a.tag_id FROM file_custom_auto a JOIN files f ON f.rowid=a.file_rowid WHERE f.service=? AND NOT EXISTS(SELECT 1 FROM external_tag_defs d WHERE d.custom_id=a.tag_id AND d.service=f.service AND d.rules<>'[]') AND NOT EXISTS(SELECT 1 FROM custom_overrides o WHERE o.service=f.service AND o.file_id=f.id AND o.tag_id=a.tag_id AND o.state=-1) UNION SELECT f.rowid,o.tag_id FROM custom_overrides o JOIN files f ON f.service=o.service AND f.id=o.file_id WHERE f.service=? AND o.state=1 AND NOT EXISTS(SELECT 1 FROM external_tag_defs d WHERE d.custom_id=o.tag_id AND d.service=f.service AND d.rules<>'[]') UNION `+externalCustomSelect+` AND f.service=?`, service, service, service)
	return e
}
func revisionCustom(ctx context.Context, tx *sql.Tx) error {
	_, e := tx.ExecContext(ctx, `INSERT INTO kv(key,value) VALUES('cacheRevision',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, strconv.Quote(fmt.Sprint(time.Now().UnixNano())))
	return e
}
func (s *Store) technicalTags(ctx context.Context, service string) (map[string]bool, error) {
	out := map[string]bool{}
	rows, e := s.DB.QueryContext(ctx, `SELECT DISTINCT resolution,codec,source,processing,hdr,bitDepth,audio,channels,language FROM files WHERE service=?`, service)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	for rows.Next() {
		vs := make([]string, 9)
		ptr := make([]any, 9)
		for i := range vs {
			ptr[i] = &vs[i]
		}
		if e = rows.Scan(ptr...); e != nil {
			return nil, e
		}
		for i, v := range vs {
			sep := "\x00"
			if i == 4 || i == 6 {
				sep = " + "
			}
			if i == 8 {
				sep = ", "
			}
			for _, v := range strings.Split(v, sep) {
				if v != "" {
					out[tagLabel(v)] = true
				}
			}
		}
	}
	if e = rows.Err(); e != nil {
		return nil, e
	}
	rows.Close()
	for _, r := range s.Recognition().Rules {
		if r.Field != "custom" && !strings.Contains(r.Value, "$") {
			out[tagLabel(normalizeRuleValue(r.Field, r.Value))] = true
		}
	}
	for field := range (TagGroups{}).fields() {
		if field != "custom" {
			out[unknownTagLabel(field)] = true
		}
	}
	rows, e = s.DB.QueryContext(ctx, `SELECT label FROM tag_sync_values WHERE service=? AND field<>'custom'`, service)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	for rows.Next() {
		var l string
		if e = rows.Scan(&l); e != nil {
			return nil, e
		}
		out[l] = true
	}
	return out, rows.Err()
}
func queueExternalIntent(ctx context.Context, tx *sql.Tx, service string, customID int64, mediaFilter string, args []any, desired bool) error {
	values := []any{desired, service, customID}
	values = append(values, args...)
	_, e := tx.ExecContext(ctx, `INSERT INTO external_tag_pending(service,endpoint,media_id,remote_id,label,custom_id,desired,baseline,conflict) SELECT d.service,d.endpoint,b.media_id,d.remote_id,d.label,d.custom_id,?,b.present,0 FROM external_tag_defs d JOIN external_tag_bindings b ON b.service=d.service AND b.endpoint=d.endpoint AND b.remote_id=d.remote_id WHERE d.service=? AND d.custom_id=? AND d.rules='[]' AND `+mediaFilter+` ON CONFLICT(service,endpoint,media_id,remote_id) DO UPDATE SET desired=excluded.desired,conflict=0`, values...)
	return e
}
func (s *Store) ExternalConflicts(ctx context.Context, service string) ([]ExternalConflict, error) {
	out := []ExternalConflict{}
	rows, e := s.DB.QueryContext(ctx, `SELECT service,media_id,remote_id,label,desired FROM external_tag_pending WHERE service=? AND conflict=1 ORDER BY media_id,remote_id`, service)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	for rows.Next() {
		var c ExternalConflict
		if e = rows.Scan(&c.Service, &c.MediaID, &c.RemoteID, &c.Label, &c.Desired); e != nil {
			return nil, e
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// All upstream reads finish before the transaction. Incomplete snapshots never
// remove cached assignments; pending local edits survive a pull and a restart.
func (s *Store) ImportTags(ctx context.Context, service string, c ServiceConfig, unchanged func() bool) error {
	if !c.Enabled || !c.TagImport {
		return nil
	}
	var snapshot SyncStatus
	if s.Get("sync:"+service, &snapshot) == nil && snapshot.Source != "" && snapshot.Source != tagEndpoint(c) {
		return errors.New("Synchronize the new service before importing tags")
	}
	client := NewArr(c)
	var details []externalDetail
	if e := client.get(ctx, "tag/detail", nil, &details); e != nil {
		return e
	}
	if details == nil {
		return errors.New("Invalid tag catalog")
	}
	seen := map[int]bool{}
	autoIDs := map[int]bool{}
	for _, d := range details {
		if d.ID <= 0 || d.Label == "" || len([]rune(d.Label)) > 80 || d.Auto == nil || seen[d.ID] {
			return errors.New("Invalid tag catalog")
		}
		seen[d.ID] = true
		for _, id := range d.Auto {
			if id <= 0 {
				return errors.New("Invalid auto-tag references")
			}
			autoIDs[id] = true
		}
		ids := d.Movies
		if serviceKind(service) == "sonarr" {
			ids = d.Series
		}
		if ids == nil {
			return errors.New("Invalid tag assignment")
		}
		unique := map[int]bool{}
		for _, id := range ids {
			if id <= 0 || unique[id] {
				return errors.New("Invalid tag assignment")
			}
			unique[id] = true
		}
	}
	ruleNames := map[int]string{}
	if len(autoIDs) > 0 {
		var rules []autoRule
		if e := client.get(ctx, "autotagging", nil, &rules); e != nil {
			return e
		}
		for _, r := range rules {
			if r.ID <= 0 || r.Name == "" {
				return errors.New("Invalid auto-tag rules")
			}
			ruleNames[r.ID] = r.Name
		}
		for id := range autoIDs {
			if ruleNames[id] == "" {
				return errors.New("Auto-tag rules changed during the read. Retry the tag check")
			}
		}
	}
	technical, e := s.technicalTags(ctx, service)
	if e != nil {
		return e
	}
	s.recognitionMu.Lock()
	defer s.recognitionMu.Unlock()
	if !unchanged() {
		return errors.New("Service settings changed during tag check")
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	endpoint := tagEndpoint(c)
	oldDefs := map[int]string{}
	rows, e := tx.QueryContext(ctx, `SELECT remote_id,label FROM external_tag_defs WHERE service=? AND endpoint=?`, service, endpoint)
	if e != nil {
		return e
	}
	for rows.Next() {
		var id int
		var label string
		if e = rows.Scan(&id, &label); e != nil {
			rows.Close()
			return e
		}
		oldDefs[id] = label
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	for _, d := range details {
		names := []string{}
		for _, id := range d.Auto {
			names = append(names, ruleNames[id])
		}
		sort.Strings(names)
		raw, _ := json.Marshal(names)
		media := d.Movies
		if serviceKind(service) == "sonarr" {
			media = d.Series
		}
		label := strings.ToLower(d.Label)
		if technical[label] && len(names) == 0 && oldDefs[d.ID] == "" {
			continue
		}
		var cid sql.NullInt64
		e = tx.QueryRowContext(ctx, `SELECT custom_id FROM external_tag_defs WHERE service=? AND endpoint=? AND remote_id=?`, service, endpoint, d.ID).Scan(&cid)
		if e != nil && e != sql.ErrNoRows {
			return e
		}
		if !cid.Valid && len(media) == 0 && len(names) == 0 && oldDefs[d.ID] == "" {
			continue
		}
		if cid.Valid && oldDefs[d.ID] != label {
			var refs int
			if e = tx.QueryRowContext(ctx, `SELECT count(*) FROM external_tag_defs WHERE custom_id=?`, cid.Int64).Scan(&refs); e != nil {
				return e
			}
			if refs == 1 {
				var collision bool
				if e = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM custom_tags WHERE name_key=? AND id<>?)`, label, cid.Int64).Scan(&collision); e != nil {
					return e
				}
				if !collision {
					if _, e = tx.ExecContext(ctx, `UPDATE custom_tags SET name=?,name_key=? WHERE id=?`, d.Label, label, cid.Int64); e != nil {
						return e
					}
				} else {
					cid.Valid = false
				}
			} else {
				cid.Valid = false
			}
			if _, e = tx.ExecContext(ctx, `UPDATE external_tag_pending SET conflict=1 WHERE service=? AND endpoint=? AND remote_id=? AND label<>?`, service, endpoint, d.ID, label); e != nil {
				return e
			}
		}
		if !cid.Valid {
			rs, err := tx.QueryContext(ctx, `SELECT id,name FROM custom_tags`)
			if err != nil {
				return err
			}
			for rs.Next() {
				var id int64
				var n string
				if err = rs.Scan(&id, &n); err != nil {
					rs.Close()
					return err
				}
				if tagLabel(n) == label {
					if cid.Valid {
						rs.Close()
						return errors.New("Custom tag names collide after normalization")
					}
					cid = sql.NullInt64{Int64: id, Valid: true}
				}
			}
			err = rs.Err()
			rs.Close()
			if err != nil {
				return err
			}
			if !cid.Valid {
				var tombstone bool
				if e = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM external_tag_pending WHERE service=? AND endpoint=? AND remote_id=? AND desired=0)`, service, endpoint, d.ID).Scan(&tombstone); e != nil {
					return e
				}
				if (len(media) > 0 || len(names) > 0) && (!tombstone || len(names) > 0) {
					var count int
					if e = tx.QueryRowContext(ctx, "SELECT count(*) FROM custom_tags").Scan(&count); e != nil {
						return e
					}
					if count >= 128 {
						return errors.New("At most 128 custom tags are allowed")
					}
					res, err := tx.ExecContext(ctx, `INSERT INTO custom_tags(name,name_key) VALUES(?,?)`, d.Label, label)
					if err != nil {
						return err
					}
					id, err := res.LastInsertId()
					if err != nil {
						return err
					}
					cid = sql.NullInt64{Int64: id, Valid: true}
				}
			}
		}
		var val any
		if cid.Valid {
			val = cid.Int64
		}
		if _, e = tx.ExecContext(ctx, `INSERT INTO external_tag_defs VALUES(?,?,?,?,?,?) ON CONFLICT(service,endpoint,remote_id) DO UPDATE SET custom_id=excluded.custom_id,label=excluded.label,rules=excluded.rules`, service, endpoint, d.ID, val, label, string(raw)); e != nil {
			return e
		}
		present := map[int]bool{}
		for _, mid := range media {
			present[mid] = true
		}
		rs, err := tx.QueryContext(ctx, `SELECT media_id FROM external_tag_bindings WHERE service=? AND endpoint=? AND remote_id=?`, service, endpoint, d.ID)
		if err != nil {
			return err
		}
		for rs.Next() {
			var mid int
			if err = rs.Scan(&mid); err != nil {
				rs.Close()
				return err
			}
			if !present[mid] {
				present[mid] = false
			}
		}
		err = rs.Err()
		rs.Close()
		if err != nil {
			return err
		}
		for mid, on := range present {
			var desired, baseline, conflict bool
			err = tx.QueryRowContext(ctx, `SELECT desired,baseline,conflict FROM external_tag_pending WHERE service=? AND endpoint=? AND media_id=? AND remote_id=?`, service, endpoint, mid, d.ID).Scan(&desired, &baseline, &conflict)
			if err != nil && err != sql.ErrNoRows {
				return err
			}
			if err == nil {
				if len(names) > 0 {
					if _, e = tx.ExecContext(ctx, `DELETE FROM external_tag_pending WHERE service=? AND endpoint=? AND media_id=? AND remote_id=?`, service, endpoint, mid, d.ID); e != nil {
						return e
					}
				} else if on != baseline && on != desired {
					if _, e = tx.ExecContext(ctx, `UPDATE external_tag_pending SET conflict=1 WHERE service=? AND endpoint=? AND media_id=? AND remote_id=?`, service, endpoint, mid, d.ID); e != nil {
						return e
					}
				} else if on == desired && !conflict && (cid.Valid || desired) {
					if _, e = tx.ExecContext(ctx, `DELETE FROM external_tag_pending WHERE service=? AND endpoint=? AND media_id=? AND remote_id=?`, service, endpoint, mid, d.ID); e != nil {
						return e
					}
				}
			}
			if err == sql.ErrNoRows && !on && cid.Valid {
				var before, wasImported bool
				re := tx.QueryRowContext(ctx, `SELECT present,imported FROM external_tag_bindings WHERE service=? AND endpoint=? AND media_id=? AND remote_id=?`, service, endpoint, mid, d.ID).Scan(&before, &wasImported)
				if re != nil && re != sql.ErrNoRows {
					return re
				}
				if before && !wasImported {
					if _, e = tx.ExecContext(ctx, `DELETE FROM custom_overrides WHERE service=? AND tag_id=? AND file_id IN(SELECT id FROM files WHERE service=? AND media_id=?)`, service, cid.Int64, service, mid); e != nil {
						return e
					}
					if _, e = tx.ExecContext(ctx, `INSERT OR IGNORE INTO custom_overrides SELECT f.service,f.id,a.tag_id,-1 FROM file_custom_auto a JOIN files f ON f.rowid=a.file_rowid WHERE f.service=? AND f.media_id=? AND a.tag_id=?`, service, mid, cid.Int64); e != nil {
						return e
					}
				}
			}

			imported := true
			if len(names) == 0 {
				var owned bool
				if e = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM tag_sync_ownership WHERE service=? AND endpoint=? AND media_id=? AND tag_id=? AND label=? AND kind='managed')`, service, endpoint, mid, d.ID, label).Scan(&owned); e != nil {
					return e
				}
				if owned {
					var before bool
					err = tx.QueryRowContext(ctx, `SELECT imported FROM external_tag_bindings WHERE service=? AND endpoint=? AND media_id=? AND remote_id=?`, service, endpoint, mid, d.ID).Scan(&before)
					if err != nil && err != sql.ErrNoRows {
						return err
					}
					imported = err == nil && before
				}
			}
			if _, e = tx.ExecContext(ctx, `INSERT INTO external_tag_bindings VALUES(?,?,?,?,?,?) ON CONFLICT(service,endpoint,media_id,remote_id) DO UPDATE SET present=excluded.present,imported=excluded.imported`, service, endpoint, mid, d.ID, on, imported); e != nil {
				return e
			}
		}
	}
	for id := range oldDefs {
		if !seen[id] {
			var oldCID sql.NullInt64
			re := tx.QueryRowContext(ctx, `SELECT custom_id FROM external_tag_defs WHERE service=? AND endpoint=? AND remote_id=?`, service, endpoint, id).Scan(&oldCID)
			if re != nil && re != sql.ErrNoRows {
				return re
			}
			if oldCID.Valid {
				if _, e = tx.ExecContext(ctx, `DELETE FROM custom_overrides WHERE service=? AND tag_id=? AND file_id IN(SELECT f.id FROM files f JOIN external_tag_bindings b ON b.service=f.service AND b.media_id=f.media_id WHERE b.service=? AND b.endpoint=? AND b.remote_id=? AND b.present=1 AND b.imported=0 AND NOT EXISTS(SELECT 1 FROM external_tag_pending p WHERE p.service=b.service AND p.endpoint=b.endpoint AND p.media_id=b.media_id AND p.remote_id=b.remote_id))`, service, oldCID.Int64, service, endpoint, id); e != nil {
					return e
				}
			}

			if _, e = tx.ExecContext(ctx, `DELETE FROM external_tag_bindings WHERE service=? AND endpoint=? AND remote_id=?`, service, endpoint, id); e != nil {
				return e
			}
			if _, e = tx.ExecContext(ctx, `DELETE FROM external_tag_pending WHERE service=? AND endpoint=? AND remote_id=? AND desired=0`, service, endpoint, id); e != nil {
				return e
			}
			if _, e = tx.ExecContext(ctx, `UPDATE external_tag_pending SET conflict=1 WHERE service=? AND endpoint=? AND remote_id=?`, service, endpoint, id); e != nil {
				return e
			}
			if _, e = tx.ExecContext(ctx, `DELETE FROM external_tag_defs WHERE service=? AND endpoint=? AND remote_id=?`, service, endpoint, id); e != nil {
				return e
			}
		}
	}
	if e = rebuildExternalCustom(ctx, tx, service); e != nil {
		return e
	}
	if e = revisionCustom(ctx, tx); e != nil {
		return e
	}
	if !unchanged() {
		return errors.New("Service settings changed during tag check")
	}
	at, _ := json.Marshal(time.Now().UTC())
	if _, e = tx.ExecContext(ctx, `INSERT INTO kv VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, "tagImportCheck:"+service, string(at)); e != nil {
		return e
	}

	if e = tx.Commit(); e != nil {
		return e
	}
	s.invalidateCustomFacets()
	return nil
}

func (s *Store) ResolveExternal(ctx context.Context, service string, c ServiceConfig, mid, tid int, local bool) error {
	s.recognitionMu.Lock()
	defer s.recognitionMu.Unlock()
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	endpoint := tagEndpoint(c)
	var on bool
	var label, rules string
	var cid sql.NullInt64
	e = tx.QueryRowContext(ctx, `SELECT coalesce(b.present,0),coalesce(d.label,p.label),coalesce(d.custom_id,p.custom_id),coalesce(d.rules,'[]') FROM external_tag_pending p LEFT JOIN external_tag_defs d ON d.service=p.service AND d.endpoint=p.endpoint AND d.remote_id=p.remote_id LEFT JOIN external_tag_bindings b ON b.service=p.service AND b.endpoint=p.endpoint AND b.media_id=p.media_id AND b.remote_id=p.remote_id WHERE p.service=? AND p.endpoint=? AND p.media_id=? AND p.remote_id=? AND p.conflict=1`, service, endpoint, mid, tid).Scan(&on, &label, &cid, &rules)
	if e != nil {
		return errors.New("Refresh tag conflicts before resolving")
	}
	if local && rules != "[]" {
		return errors.New("This tag is controlled by an external auto-tag rule")
	}
	if local {
		var exists bool
		if e = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM external_tag_defs WHERE service=? AND endpoint=? AND remote_id=?)`, service, endpoint, tid).Scan(&exists); e != nil {
			return e
		}
		if !exists {
			// The retained local assignment recreates a missing definition with a new
			// remote ID. Do not carry its old ID intent into future reconciliations.
			if !cid.Valid {
				return errors.New("Refresh tag conflicts before resolving")
			}
			_, e = tx.ExecContext(ctx, `DELETE FROM external_tag_pending WHERE service=? AND endpoint=? AND media_id=? AND remote_id=?`, service, endpoint, mid, tid)
		} else {
			_, e = tx.ExecContext(ctx, `UPDATE external_tag_pending SET baseline=?,label=?,conflict=0 WHERE service=? AND endpoint=? AND media_id=? AND remote_id=?`, on, label, service, endpoint, mid, tid)
		}
	} else {
		if cid.Valid {
			_, e = tx.ExecContext(ctx, `DELETE FROM custom_overrides WHERE service=? AND tag_id=? AND file_id IN(SELECT id FROM files WHERE service=? AND media_id=?)`, service, cid.Int64, service, mid)
			if e != nil {
				return e
			}
			if !on {
				if _, e = tx.ExecContext(ctx, `INSERT OR IGNORE INTO custom_overrides SELECT f.service,f.id,a.tag_id,-1 FROM file_custom_auto a JOIN files f ON f.rowid=a.file_rowid WHERE f.service=? AND f.media_id=? AND a.tag_id=?`, service, mid, cid.Int64); e != nil {
					return e
				}
			}

			_, e = tx.ExecContext(ctx, `UPDATE external_tag_bindings SET imported=1 WHERE service=? AND endpoint=? AND media_id=? AND remote_id=?`, service, endpoint, mid, tid)
			if e != nil {
				return e
			}
		}
		_, e = tx.ExecContext(ctx, `DELETE FROM external_tag_pending WHERE service=? AND endpoint=? AND media_id=? AND remote_id=?`, service, endpoint, mid, tid)
	}
	if e != nil {
		return e
	}
	if e = rebuildExternalCustom(ctx, tx, service); e != nil {
		return e
	}
	if e = revisionCustom(ctx, tx); e != nil {
		return e
	}
	if e = tx.Commit(); e == nil {
		s.invalidateCustomFacets()
	}
	return e
}

// Bind intent to IDs, endpoint and label; a fresh rename must be reviewed.
func (s *Store) pendingForPlan(ctx context.Context, service, endpoint string) (map[int]map[string]bool, error) {
	out := map[int]map[string]bool{}
	rows, e := s.DB.QueryContext(ctx, `SELECT media_id,label,desired,conflict FROM external_tag_pending WHERE service=? AND endpoint=?`, service, endpoint)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	for rows.Next() {
		var mid int
		var label string
		var desired, conflict bool
		if e = rows.Scan(&mid, &label, &desired, &conflict); e != nil {
			return nil, e
		}
		if conflict {
			return nil, ErrExternalConflict
		}
		if out[mid] == nil {
			out[mid] = map[string]bool{}
		}
		out[mid][label] = desired
	}
	return out, rows.Err()
}

func (s *Store) recordExternalWrite(ctx context.Context, service, endpoint string, mid int, ids []int, on bool) error {
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	for _, id := range ids {
		if _, e = tx.ExecContext(ctx, `UPDATE external_tag_bindings SET present=? WHERE service=? AND endpoint=? AND media_id=? AND remote_id=?`, on, service, endpoint, mid, id); e != nil {
			return e
		}
		// Advance only the assignments this write changed. Unrelated foreign changes
		// still compare against the earlier snapshot and are not mistaken for ours.
		if _, e = tx.ExecContext(ctx, `UPDATE external_tag_pending SET baseline=? WHERE service=? AND endpoint=? AND media_id=? AND remote_id=?`, on, service, endpoint, mid, id); e != nil {
			return e
		}
	}
	return tx.Commit()
}
