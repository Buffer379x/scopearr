package app

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"unicode"
)

const customSchema = `
CREATE TABLE IF NOT EXISTS custom_tags(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,name_key TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS custom_overrides(service TEXT NOT NULL,file_id INTEGER NOT NULL,tag_id INTEGER NOT NULL REFERENCES custom_tags(id) ON DELETE CASCADE,state INTEGER NOT NULL CHECK(state IN (-1,1)),PRIMARY KEY(service,file_id,tag_id));
CREATE TABLE IF NOT EXISTS file_custom_auto(file_rowid INTEGER REFERENCES files(rowid) ON DELETE CASCADE,tag_id INTEGER REFERENCES custom_tags(id) ON DELETE CASCADE,PRIMARY KEY(file_rowid,tag_id));
CREATE TABLE IF NOT EXISTS file_custom(file_rowid INTEGER REFERENCES files(rowid) ON DELETE CASCADE,tag_id INTEGER REFERENCES custom_tags(id) ON DELETE CASCADE,PRIMARY KEY(file_rowid,tag_id));
CREATE INDEX IF NOT EXISTS file_custom_value ON file_custom(tag_id,file_rowid);
PRAGMA user_version=6;`
const customJSON = `coalesce((SELECT json_group_array(json_object('id',ct.id,'name',ct.name,'displayName',ct.display_name,'protected',json(CASE WHEN EXISTS(SELECT 1 FROM external_tag_defs d WHERE d.custom_id=ct.id AND d.service=f.service AND d.rules<>'[]') THEN 'true' ELSE 'false' END),'rules',json(coalesce((SELECT json_group_array(d.service||' · '||r.value) FROM external_tag_defs d,json_each(d.rules) r WHERE d.custom_id=ct.id AND d.service=f.service),'[]')),'manual',json(CASE WHEN EXISTS(SELECT 1 FROM custom_overrides o WHERE o.service=f.service AND o.file_id=f.id AND o.tag_id=ct.id AND o.state=1) THEN 'true' ELSE 'false' END))) FROM (SELECT t.id,t.name,coalesce((SELECT label FROM custom_tag_labels WHERE tag_id=t.id),'') display_name FROM file_custom c JOIN custom_tags t ON t.id=c.tag_id WHERE c.file_rowid=f.rowid ORDER BY lower(coalesce(nullif(display_name,''),t.name)),t.id) ct),'[]')`

func (s *Store) CustomTags(ctx context.Context) ([]CustomTag, error) {
	out := []CustomTag{}
	rows, err := s.DB.QueryContext(ctx, `SELECT t.id,t.name,coalesce(l.label,''),(SELECT count(*) FROM file_custom c WHERE c.tag_id=t.id) FROM custom_tags t LEFT JOIN custom_tag_labels l ON l.tag_id=t.id ORDER BY lower(coalesce(nullif(l.label,''),t.name)),t.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var t CustomTag
		if err = rows.Scan(&t.ID, &t.Name, &t.DisplayName, &t.Count); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	if err = s.decorateCustom(ctx, out); err != nil {
		return nil, err
	}
	return out, nil
}
func (s *Store) SaveCustomTag(ctx context.Context, tag CustomTag) (CustomTag, error) {
	original, e := s.CustomTags(ctx)
	if e != nil {
		return tag, e
	}
	next := append([]CustomTag{}, original...)
	if tag.ID == 0 {
		tag.ID = -1
		next = append(next, tag)
	} else {
		found := false
		for i := range next {
			if next[i].ID == tag.ID {
				next[i] = tag
				found = true
				break
			}
		}
		if !found {
			return tag, fmt.Errorf("Custom tag no longer exists")
		}
	}
	saved, e := s.SaveCustomTags(ctx, original, next)
	if e != nil {
		return tag, e
	}
	for _, value := range saved {
		if value.ID == tag.ID || tag.ID < 0 && value.Name == strings.TrimSpace(tag.Name) {
			return value, nil
		}
	}
	return tag, fmt.Errorf("Custom tag no longer exists")
}
func (s *Store) DeleteCustomTag(ctx context.Context, id int64) error {
	s.recognitionMu.Lock()
	defer s.recognitionMu.Unlock()
	var links int
	if e := s.DB.QueryRowContext(ctx, "SELECT count(*) FROM file_custom WHERE tag_id=?", id).Scan(&links); e != nil {
		return e
	} else if links > 0 {
		return fmt.Errorf("Remove tag assignments before deleting the tag")
	}
	if on, e := protectedCustom(ctx, s.DB, id); e != nil {
		return e
	} else if on {
		return fmt.Errorf("This tag is controlled by an external auto-tag rule")
	}

	deleted := map[int64]bool{id: true}
	engine, err := s.recognitionWithoutCustomTags(deleted)
	if err != nil {
		return err
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, service := range s.arrNamespaces(ctx) {
		if err = queueExternalIntent(ctx, tx, service, id, "1=1", nil, false); err != nil {
			return err
		}
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM custom_tags WHERE id=?", id); err != nil {
		return err
	}
	if err = cleanupDeletedCustomTags(ctx, tx, deleted, engine); err != nil {
		return err
	}
	if err = revisionCustom(ctx, tx); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	s.recognition.Store(engine)
	s.invalidateCustomFacets()
	return nil
}
func (s *Store) validateCustomRules(ctx context.Context, rules []RecognitionRule) error {
	for _, r := range rules {
		if r.Field != "custom" {
			continue
		}
		var exists bool
		if err := s.DB.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM custom_tags WHERE id=?)", r.Value).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("Custom tag no longer exists")
		}
	}
	return nil
}
func replaceFileCustom(ctx context.Context, tx *sql.Tx, rowid int64, f File, sync bool) error {
	if sync {
		if _, err := tx.ExecContext(ctx, "DELETE FROM custom_overrides WHERE service=? AND file_id=? AND state=-1", f.Service, f.ID); err != nil {
			return err
		}
	}
	for _, table := range []string{"file_custom_auto", "file_custom"} {
		if _, err := tx.ExecContext(ctx, "DELETE FROM "+table+" WHERE file_rowid=?", rowid); err != nil {
			return err
		}
	}
	for _, id := range f.RecognizedCustom {
		if _, err := tx.ExecContext(ctx, "INSERT OR IGNORE INTO file_custom_auto SELECT ?,id FROM custom_tags WHERE id=?", rowid, id); err != nil {
			return err
		}
	}
	_, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO file_custom SELECT a.file_rowid,a.tag_id FROM file_custom_auto a WHERE a.file_rowid=? AND NOT EXISTS(SELECT 1 FROM external_tag_defs d WHERE d.custom_id=a.tag_id AND d.service=(SELECT service FROM files WHERE rowid=a.file_rowid) AND d.rules<>'[]') AND NOT EXISTS(SELECT 1 FROM custom_overrides o WHERE o.service=? AND o.file_id=? AND o.tag_id=a.tag_id AND o.state=-1) UNION SELECT ?,tag_id FROM custom_overrides WHERE service=? AND file_id=? AND state=1 AND NOT EXISTS(SELECT 1 FROM external_tag_defs d WHERE d.custom_id=custom_overrides.tag_id AND d.service=custom_overrides.service AND d.rules<>'[]')`, rowid, f.Service, f.ID, rowid, f.Service, f.ID)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, "INSERT OR IGNORE INTO file_custom "+externalCustomSelect+" AND f.rowid=?", rowid)
	return err
}

type CustomSelection struct {
	Total  int            `json:"total"`
	Counts map[string]int `json:"counts"`
	Tags   []CustomTag    `json:"tags"`
}

func (s *Store) CustomSelection(ctx context.Context, q url.Values) (CustomSelection, error) {
	out := CustomSelection{Counts: map[string]int{}}
	filter, args, err := s.scopedWhere(q)
	if err != nil {
		return out, err
	}
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = tx.QueryRowContext(ctx, "SELECT count(*) FROM files f WHERE "+filter, args...).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, "SELECT c.tag_id,count(*) FROM file_custom c JOIN files f ON f.rowid=c.file_rowid WHERE "+filter+" GROUP BY c.tag_id", args...)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var id string
		var n int
		if err = rows.Scan(&id, &n); err != nil {
			rows.Close()
			return out, err
		}
		out.Counts[id] = n
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	if err = tx.Commit(); err != nil {
		return out, err
	}
	out.Tags, err = s.CustomTags(ctx)
	if err == nil {
		protected := map[int64]bool{}
		rows, e := s.DB.QueryContext(ctx, "SELECT DISTINCT d.custom_id FROM external_tag_defs d WHERE d.custom_id IS NOT NULL AND d.rules<>'[]' AND d.service IN (SELECT DISTINCT f.service FROM files f WHERE "+filter+")", args...)
		if e != nil {
			return out, e
		}
		for rows.Next() {
			var id int64
			if e = rows.Scan(&id); e != nil {
				break
			}
			protected[id] = true
		}
		if e == nil {
			e = rows.Err()
		}
		rows.Close()
		if e != nil {
			return out, e
		}
		for i := range out.Tags {
			out.Tags[i].Protected = protected[out.Tags[i].ID]
		}
	}
	return out, err
}
func (s *Store) ApplyCustom(ctx context.Context, q url.Values, changes map[string]bool) (int, error) {
	if len(changes) == 0 || len(changes) > 128 {
		return 0, fmt.Errorf("Select at least one custom tag change")
	}
	filter, args, err := s.scopedWhere(q)
	if err != nil {
		return 0, err
	}
	s.recognitionMu.Lock()
	defer s.recognitionMu.Unlock()
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "CREATE TEMP TABLE custom_targets(rowid INTEGER PRIMARY KEY)"); err != nil {
		return 0, err
	}
	// Freeze actual matches before modifying any tag used by the filter. Never include season context.
	if _, err = tx.ExecContext(ctx, "INSERT INTO custom_targets SELECT f.rowid FROM files f WHERE "+filter, args...); err != nil {
		return 0, err
	}
	var total int
	if err = tx.QueryRowContext(ctx, "SELECT count(*) FROM custom_targets").Scan(&total); err != nil {
		return 0, err
	}
	for value, add := range changes {
		id, e := strconv.ParseInt(value, 10, 64)
		if e != nil || id <= 0 {
			return 0, fmt.Errorf("Invalid custom tag")
		}
		var exists bool
		if err = tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM custom_tags WHERE id=?)", id).Scan(&exists); err != nil {
			return 0, err
		}
		if !exists {
			return 0, fmt.Errorf("Custom tag no longer exists")
		}
		for _, svc := range s.arrNamespaces(ctx) {
			var selected bool
			if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM custom_targets ct JOIN files f ON f.rowid=ct.rowid WHERE f.service=?)`, svc).Scan(&selected); err != nil {
				return 0, err
			}
			if selected {
				if on, e := protectedCustom(ctx, tx, id, svc); e != nil {
					return 0, e
				} else if on {
					return 0, fmt.Errorf("This tag is controlled by an external auto-tag rule")
				}
			}
		}

		for _, service := range s.arrNamespaces(ctx) {
			if err = queueExternalIntent(ctx, tx, service, id, "b.media_id IN(SELECT f.media_id FROM files f JOIN custom_targets ct ON ct.rowid=f.rowid WHERE f.service=?)", []any{service}, add); err != nil {
				return 0, err
			}
		}

		state := -1
		if add {
			state = 1
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO custom_overrides(service,file_id,tag_id,state) SELECT f.service,f.id,?,? FROM files f JOIN custom_targets t ON t.rowid=f.rowid WHERE true ON CONFLICT(service,file_id,tag_id) DO UPDATE SET state=excluded.state`, id, state); err != nil {
			return 0, err
		}
		if add {
			_, err = tx.ExecContext(ctx, "INSERT OR IGNORE INTO file_custom SELECT rowid,? FROM custom_targets", id)
		} else {
			_, err = tx.ExecContext(ctx, "DELETE FROM file_custom WHERE tag_id=? AND file_rowid IN (SELECT rowid FROM custom_targets)", id)
		}
		if err != nil {
			return 0, err
		}
	}
	for _, service := range s.arrNamespaces(ctx) {
		if err = rebuildExternalCustom(ctx, tx, service); err != nil {
			return 0, err
		}
	}
	// Existing independent file/rule assignments preserve the series/movie union.
	if _, err = tx.ExecContext(ctx, `UPDATE external_tag_pending AS p SET desired=1 WHERE desired=0 AND EXISTS(SELECT 1 FROM external_tag_defs d JOIN files f ON f.service=p.service AND f.media_id=p.media_id JOIN file_custom c ON c.file_rowid=f.rowid AND c.tag_id=d.custom_id WHERE d.service=p.service AND d.endpoint=p.endpoint AND d.remote_id=p.remote_id)`); err != nil {
		return 0, err
	}
	for _, service := range s.arrNamespaces(ctx) {
		if err = rebuildExternalCustom(ctx, tx, service); err != nil {
			return 0, err
		}
	}

	if err = revisionCustom(ctx, tx); err != nil {
		return 0, err
	}

	if _, err = tx.ExecContext(ctx, "DROP TABLE custom_targets"); err != nil {
		return 0, err
	}
	if err = tx.Commit(); err != nil {
		return 0, err
	}
	s.invalidateCustomFacets()
	return total, nil
}

// SaveCustomTags applies a settings draft atomically and rejects stale snapshots.
func (s *Store) SaveCustomTags(ctx context.Context, original, tags []CustomTag) ([]CustomTag, error) {
	s.recognitionMu.Lock()
	defer s.recognitionMu.Unlock()
	current, err := s.CustomTags(ctx)
	if err != nil {
		return nil, err
	}
	baseline := map[int64]string{}
	aliases := map[int64]string{}
	for _, tag := range original {
		baseline[tag.ID] = tag.Name
		aliases[tag.ID] = tag.DisplayName
	}
	if len(original) != len(current) || len(baseline) != len(original) {
		return nil, fmt.Errorf("Custom tags changed in another session. Reload before saving.")
	}
	for _, tag := range current {
		if baseline[tag.ID] != tag.Name || aliases[tag.ID] != tag.DisplayName {
			return nil, fmt.Errorf("Custom tags changed in another session. Reload before saving.")
		}
	}
	if len(tags) > 128 {
		return nil, fmt.Errorf("At most 128 custom tags are allowed")
	}
	ids := map[int64]bool{}
	names := map[string]bool{}
	deleted := map[int64]bool{}
	for _, tag := range current {
		deleted[tag.ID] = true
	}
	for i := range tags {
		tag := &tags[i]
		tag.Name = strings.TrimSpace(tag.Name)
		tag.DisplayName = strings.TrimSpace(tag.DisplayName)
		if len([]rune(tag.DisplayName)) > 80 || strings.ContainsFunc(tag.DisplayName, unicode.IsControl) {
			return nil, fmt.Errorf("Enter a tag name between 1 and 80 characters")
		}
		if tag.Name == "" || len([]rune(tag.Name)) > 80 || strings.ContainsFunc(tag.Name, unicode.IsControl) {
			return nil, fmt.Errorf("Enter a tag name between 1 and 80 characters")
		}
		key := strings.ToLower(tag.Name)
		if names[key] {
			return nil, fmt.Errorf("A custom tag with this name already exists")
		}
		names[key] = true
		if ids[tag.ID] || tag.ID == 0 {
			return nil, fmt.Errorf("Invalid custom tag")
		}
		ids[tag.ID] = true
		if tag.ID > 0 {
			if _, ok := baseline[tag.ID]; !ok {
				return nil, fmt.Errorf("Custom tag no longer exists")
			}
			delete(deleted, tag.ID)
		}
	}
	for _, tag := range current {
		if deleted[tag.ID] && tag.Count > 0 {
			return nil, fmt.Errorf("Remove tag assignments before deleting the tag")
		}
		if tag.Protected {
			found := false
			for _, next := range tags {
				if next.ID == tag.ID && next.Name == tag.Name {
					found = true
				}
			}
			if !found {
				return nil, fmt.Errorf("This tag is controlled by an external auto-tag rule")
			}
		}
	}

	engine, err := s.recognitionWithoutCustomTags(deleted)
	if err != nil {
		return nil, err
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	for _, tag := range current {
		changed := deleted[tag.ID]
		for _, next := range tags {
			if next.ID == tag.ID && next.Name != tag.Name {
				changed = true
			}
		}
		if changed {
			// Preserve the current file intent across an upstream label rename.
			if !deleted[tag.ID] {
				if _, err = tx.ExecContext(ctx, `INSERT INTO custom_overrides(service,file_id,tag_id,state) SELECT f.service,f.id,c.tag_id,1 FROM file_custom c JOIN files f ON f.rowid=c.file_rowid WHERE c.tag_id=? ON CONFLICT(service,file_id,tag_id) DO UPDATE SET state=1`, tag.ID); err != nil {
					return nil, err
				}
			}
			for _, service := range s.arrNamespaces(ctx) {
				if err = queueExternalIntent(ctx, tx, service, tag.ID, "1=1", nil, false); err != nil {
					return nil, err
				}
			}
		}
	}

	for _, tag := range current {
		if _, err = tx.ExecContext(ctx, "UPDATE custom_tags SET name_key=? WHERE id=?", "\x00draft:"+strconv.FormatInt(tag.ID, 10), tag.ID); err != nil {
			return nil, err
		}
	}
	for id := range deleted {
		if _, err = tx.ExecContext(ctx, "DELETE FROM custom_tags WHERE id=?", id); err != nil {
			return nil, err
		}
	}
	for i := range tags {
		tag := &tags[i]
		if tag.ID > 0 {
			_, err = tx.ExecContext(ctx, "UPDATE custom_tags SET name=?,name_key=? WHERE id=?", tag.Name, strings.ToLower(tag.Name), tag.ID)
		} else {
			var result sql.Result
			result, err = tx.ExecContext(ctx, "INSERT INTO custom_tags(name,name_key) VALUES(?,?)", tag.Name, strings.ToLower(tag.Name))
			if err == nil {
				tag.ID, err = result.LastInsertId()
			}
		}
		if err != nil {
			return nil, err
		}
	}
	for _, tag := range tags {
		if tag.DisplayName == "" {
			_, err = tx.ExecContext(ctx, "DELETE FROM custom_tag_labels WHERE tag_id=?", tag.ID)
		} else {
			_, err = tx.ExecContext(ctx, "INSERT INTO custom_tag_labels VALUES(?,?) ON CONFLICT(tag_id) DO UPDATE SET label=excluded.label", tag.ID, tag.DisplayName)
		}
		if err != nil {
			return nil, err
		}
	}
	if len(deleted) > 0 {
		if err = cleanupDeletedCustomTags(ctx, tx, deleted, engine); err != nil {
			return nil, err
		}
	}
	if err = revisionCustom(ctx, tx); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	s.recognition.Store(engine)
	s.invalidateCustomFacets()
	return s.CustomTags(ctx)
}
