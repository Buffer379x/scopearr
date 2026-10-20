package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
)

const tagPolicySchema = `CREATE TABLE IF NOT EXISTS tag_sync_groups(service TEXT,endpoint TEXT,field TEXT,state TEXT,PRIMARY KEY(service,endpoint,field));
CREATE TABLE IF NOT EXISTS tag_sync_values(service TEXT,endpoint TEXT,field TEXT,label TEXT,media_id INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(service,endpoint,field,label,media_id));
CREATE TABLE IF NOT EXISTS tag_sync_cleanup(service TEXT,endpoint TEXT,label TEXT,PRIMARY KEY(service,endpoint,label));PRAGMA user_version=8;`

func positiveTagPath(path, prefix string) bool {
	if !strings.HasPrefix(path, prefix) {
		return false
	}
	n, e := strconv.Atoi(strings.TrimPrefix(path, prefix))
	return e == nil && n > 0 && path == prefix+strconv.Itoa(n)
}
func (g TagGroups) fields() map[string]bool {
	return map[string]bool{"resolution": g.Resolution, "codec": g.Codec, "source": g.Source, "hdr": g.HDR, "bitDepth": g.BitDepth, "audio": g.Audio, "channels": g.Channels, "language": g.Language, "custom": g.Custom}
}
func tagMode(c ServiceConfig) string {
	if c.TagSyncMode == "add" {
		return "add"
	}
	return "replace"
}
func tagChanges(old, next ServiceConfig) (enabled, disabled bool) {
	for field, on := range next.TagSync.fields() {
		enabled = enabled || on && !old.TagSync.fields()[field]
		disabled = disabled || !on && old.TagSync.fields()[field]
	}
	return
}
func validateTagPolicy(old, next ServiceConfig) error {
	if next.TagSyncMode != "" && next.TagSyncMode != "add" && next.TagSyncMode != "replace" || next.TagSyncDisable != "" && next.TagSyncDisable != "keep" && next.TagSyncDisable != "delete" {
		return errors.New("Invalid tag synchronization policy")
	}
	enabled, disabled := tagChanges(old, next)
	if (enabled || old.URL != next.URL && next.TagSync.Active()) && next.TagSyncMode == "" {
		return errors.New("Choose how existing tags should be handled")
	}
	if disabled && next.TagSyncDisable == "" {
		return errors.New("Choose whether disabled tags should be kept or deleted")
	}
	if disabled && old.URL != next.URL {
		return errors.New("Disable tag groups on the original service before changing its address")
	}
	if disabled && next.TagSyncDisable == "delete" && !next.Enabled {
		return errors.New("Keep the service enabled until tag cleanup finishes")
	}
	return nil
}

type tagQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}
type tagSnapshot struct {
	desired map[int]map[string]bool
	groups  map[string]map[string]bool
	custom  map[int]map[string]bool
}

func readTagSnapshot(ctx context.Context, q tagQueryer, service string, g TagGroups, target ...int) (tagSnapshot, error) {
	mask := g.fields()
	intern := map[string]string{}
	out := tagSnapshot{map[int]map[string]bool{}, map[string]map[string]bool{}, map[int]map[string]bool{}}
	custom := "'[]'"
	if g.Custom {
		custom = customJSON
	}
	uncertainty := "'[]'"
	if g.Audio || g.Language {
		uncertainty = "coalesce(json_extract(f.data,'$.unknownTraits'),'[]')"
	}
	filter := "f.service=?"
	args := []any{service}
	if len(target) > 0 {
		filter += " AND f.media_id=?"
		args = append(args, target[0])
	}
	rows, err := q.QueryContext(ctx, "SELECT f.media_id,f.resolution,f.codec,f.source,f.processing,f.hdr,f.bitDepth,f.audio,f.channels,f.language,"+custom+","+uncertainty+" FROM files f WHERE "+filter, args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int
		var resolution, codec, source, processing, hdr, depth, audio, channels, language, raw, unknown string
		if err = rows.Scan(&id, &resolution, &codec, &source, &processing, &hdr, &depth, &audio, &channels, &language, &raw, &unknown); err != nil {
			return out, err
		}
		if out.desired[id] == nil {
			out.desired[id] = map[string]bool{}
		}
		add := func(field, value, sep string) {
			if !mask[field] {
				return
			}
			if out.groups[field] == nil {
				out.groups[field] = map[string]bool{}
			}
			if value == "" && field != "custom" {
				value = unknownTagLabel(field)
			}
			for _, v := range strings.Split(value, sep) {
				label, exists := intern[v]
				if !exists {
					label = tagLabel(v)
					intern[v] = label
				}
				if label != "" {
					out.groups[field][label] = true
					out.desired[id][label] = true
					if field == "custom" {
						if out.custom[id] == nil {
							out.custom[id] = map[string]bool{}
						}
						out.custom[id][label] = true
					}
				}
			}
		}
		add("resolution", resolution, " + ")
		add("codec", codec, " + ")
		add("source", source, " + ")
		if processing != "" {
			add("source", processing, " + ")
		}
		add("hdr", hdr, " + ")
		add("bitDepth", depth, " + ")
		add("audio", audio, " + ")
		add("channels", channels, " + ")
		add("language", language, ", ")
		var missing []string
		if e := json.Unmarshal([]byte(unknown), &missing); e != nil {
			return out, e
		}
		for _, field := range missing {
			if field == "audio" || field == "language" {
				add(field, unknownTagLabel(field), "\x00")
			}
		}
		if g.Custom {
			var tags []CustomTag
			if err = json.Unmarshal([]byte(raw), &tags); err != nil {
				return out, err
			}
			for _, tag := range tags {
				add("custom", tag.Name, "\x00")
			}
		}
	}
	return out, rows.Err()
}
func (s *Store) seedTagValues(ctx context.Context, tx *sql.Tx, service, endpoint string, g TagGroups, owned bool, rules []RecognitionRule, target ...int) error {
	snap, err := readTagSnapshot(ctx, tx, service, g, target...)
	if err != nil {
		return err
	}
	for field, on := range g.fields() {
		if !on {
			continue
		}
		if snap.groups[field] == nil {
			snap.groups[field] = map[string]bool{}
		}
		if field != "custom" {
			snap.groups[field][unknownTagLabel(field)] = true
		}
	}
	for _, rule := range rules {
		field := rule.Field
		if field == "processing" {
			field = "source"
		}
		if g.fields()[field] && field != "custom" && !strings.Contains(rule.Value, "$") {
			if label := tagLabel(normalizeRuleValue(rule.Field, rule.Value)); label != "" {
				snap.groups[field][label] = true
			}
		}
	}
	if g.Custom {
		rows, e := tx.QueryContext(ctx, "SELECT name FROM custom_tags")
		if e != nil {
			return e
		}
		for rows.Next() {
			var name string
			if e = rows.Scan(&name); e != nil {
				rows.Close()
				return e
			}
			if label := tagLabel(name); label != "" {
				snap.groups["custom"][label] = true
			}
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return e
		}
	}
	for field, labels := range snap.groups {
		for label := range labels {
			if _, err = tx.ExecContext(ctx, "INSERT OR IGNORE INTO tag_sync_values VALUES(?,?,?,?,0)", service, endpoint, field, label); err != nil {
				return err
			}
		}
	}
	if owned {
		for id, labels := range snap.custom {
			for label := range labels {
				if _, err = tx.ExecContext(ctx, "INSERT OR IGNORE INTO tag_sync_values VALUES(?,?, 'custom',?,?)", service, endpoint, label, id); err != nil {
					return err
				}
			}
		}
	}
	return nil
}
func (s *Store) saveSettingsWithTagPolicies(ctx context.Context, stored Settings, old, next Settings, approved ...*tagPlan) error {
	return s.saveSettingsWithAllTagPolicies(ctx, stored, old, next, nil, approved...)
}
func (s *Store) saveSettingsWithAllTagPolicies(ctx context.Context, stored Settings, old, next Settings, mediaApproved []*MediaTagPlan, approved ...*tagPlan) error {
	s.recognitionMu.Lock()
	defer s.recognitionMu.Unlock()
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for service, pair := range instancePairs(old, next) {
		if !serviceOK(service) {
			continue
		}
		before, after := pair[0], pair[1]
		if after.ID == "" {
			for _, table := range []string{"files", "custom_overrides", "external_tag_bindings", "external_tag_defs", "external_tag_pending"} {
				if _, err = tx.ExecContext(ctx, "DELETE FROM "+table+" WHERE service=?", service); err != nil {
					return err
				}
			}
			for _, prefix := range []string{"sync:", "storage:", "webhook-status:", "webhook-key:"} {
				if _, err = tx.ExecContext(ctx, "DELETE FROM kv WHERE key=?", prefix+service); err != nil {
					return err
				}
			}
			if _, err = tx.ExecContext(ctx, "DELETE FROM kv WHERE key LIKE ?", "webhook-job:"+service+":%"); err != nil {
				return err
			}
			continue
		}
		if before == after {
			continue
		}
		if tagEndpoint(before) != tagEndpoint(after) {
			for _, table := range []string{"external_tag_bindings", "external_tag_defs", "external_tag_pending"} {
				if _, err = tx.ExecContext(ctx, "DELETE FROM "+table+" WHERE service=?", service); err != nil {
					return err
				}
			}
			if err = rebuildExternalCustom(ctx, tx, service); err != nil {
				return err
			}
			if err = revisionCustom(ctx, tx); err != nil {
				return err
			}
		}

		endpoint := tagEndpoint(after)
		if tagEndpoint(before) == endpoint && before.TagSync.Active() {
			if err = s.seedTagValues(ctx, tx, service, endpoint, before.TagSync, false, s.recognition.Load().config.Rules); err != nil {
				return err
			}
		}
		if !after.TagSync.Active() && after.TagSyncDisable == "keep" {
			if _, err = tx.ExecContext(ctx, "UPDATE tag_sync_groups SET state='keep' WHERE service=? AND endpoint=?", service, endpoint); err != nil {
				return err
			}
			for _, table := range []string{"tag_sync_cleanup", "tag_sync_managed", "tag_sync_approvals"} {
				if _, err = tx.ExecContext(ctx, "DELETE FROM "+table+" WHERE service=? AND endpoint=?", service, endpoint); err != nil {
					return err
				}
			}
			if _, err = tx.ExecContext(ctx, "INSERT INTO kv VALUES(?, '0') ON CONFLICT(key) DO UPDATE SET value=excluded.value", "tagSyncRetained:"+service); err != nil {
				return err
			}
		}
		enabled, _ := tagChanges(before, after)
		if after.TagSync.Custom && after.TagSyncMode == "add" && (!before.TagSync.Custom || before.TagSyncMode != "add") {
			if _, err = tx.ExecContext(ctx, "DELETE FROM tag_sync_values WHERE service=? AND endpoint=? AND field='custom' AND media_id>0", service, endpoint); err != nil {
				return err
			}
		}

		if tagMode(after) == "replace" && after.TagSync.Active() && (enabled || before.TagSyncMode != after.TagSyncMode || before.URL != after.URL) {
			if _, err = tx.ExecContext(ctx, "UPDATE tag_sync_groups SET state='delete' WHERE service=? AND endpoint=? AND state='keep'", service, endpoint); err != nil {
				return err
			}
		}
		for field, on := range after.TagSync.fields() {
			state := ""
			if on {
				state = "active"
			} else if before.TagSync.fields()[field] {
				state = after.TagSyncDisable
			}
			if state != "" {
				if _, err = tx.ExecContext(ctx, "INSERT INTO tag_sync_groups VALUES(?,?,?,?) ON CONFLICT(service,endpoint,field) DO UPDATE SET state=excluded.state", service, endpoint, field, state); err != nil {
					return err
				}
			}
		}
		if after.Enabled || tagPolicyChanged(before, after) || before.TagSyncDisable != after.TagSyncDisable {
			if _, err = tx.ExecContext(ctx, "INSERT INTO kv VALUES(?, 'true') ON CONFLICT(key) DO UPDATE SET value=excluded.value", "tagSyncDirty:"+service); err != nil {
				return err
			}
		}
	}
	for _, plan := range approved {
		if err = approveTagPlan(ctx, tx, plan); err != nil {
			return err
		}
	}
	for _, plan := range mediaApproved {
		if err = approveMediaTagPlan(ctx, tx, plan); err != nil {
			return err
		}
	}
	raw, err := json.Marshal(stored)
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO kv VALUES('settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", string(raw)); err != nil {
		return err
	}
	return tx.Commit()
}

type tagPolicyState struct {
	keep, remove, active map[string]bool
	custom               map[int]map[string]bool
	states               map[string]string
}

func (s *Store) tagPolicies(ctx context.Context, service, endpoint string, g TagGroups) (tagPolicyState, error) {
	p := tagPolicyState{keep: map[string]bool{}, remove: map[string]bool{}, active: map[string]bool{}, custom: map[int]map[string]bool{}, states: map[string]string{}}
	rows, e := s.DB.QueryContext(ctx, "SELECT field,state FROM tag_sync_groups WHERE service=? AND endpoint=?", service, endpoint)
	if e != nil {
		return p, e
	}
	for rows.Next() {
		var f, state string
		if e = rows.Scan(&f, &state); e != nil {
			rows.Close()
			return p, e
		}
		if state == "active" && !g.fields()[f] {
			state = "delete"
		}
		p.states[f] = state
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return p, e
	}
	for f, state := range p.states {
		if state == "active" && f != "custom" {
			p.active[unknownTagLabel(f)] = true
		}
	}
	rows, e = s.DB.QueryContext(ctx, "SELECT field,label,media_id FROM tag_sync_values WHERE service=? AND endpoint=?", service, endpoint)
	if e != nil {
		return p, e
	}
	defer rows.Close()
	for rows.Next() {
		var f, label string
		var id int
		if e = rows.Scan(&f, &label, &id); e != nil {
			return p, e
		}
		if p.states[f] == "active" && f != "custom" {
			p.active[label] = true
		}
		if p.states[f] == "keep" {
			p.keep[label] = true
		}
		if p.states[f] == "delete" {
			p.remove[label] = true
		}
		if f == "custom" && id > 0 {
			if p.custom[id] == nil {
				p.custom[id] = map[string]bool{}
			}
			p.custom[id][label] = true
		}
	}
	return p, rows.Err()
}

// The services enforce their own in-use check at DELETE time. Inspect fresh
// details first and fail closed for missing, malformed or unknown usage fields.
func tagUnused(detail map[string]json.RawMessage, service string, id int, label string) (bool, error) {
	var found int
	var name string
	if json.Unmarshal(detail["id"], &found) != nil || found != id || json.Unmarshal(detail["label"], &name) != nil || !strings.EqualFold(name, label) {
		return false, errors.New("Tag usage could not be verified")
	}
	required := "movieIds"
	if serviceKind(service) == "sonarr" {
		required = "seriesIds"
	}
	if raw, ok := detail[required]; !ok || string(raw) == "null" {
		return false, errors.New("Tag usage could not be verified")
	}
	for key, raw := range detail {
		if key == "id" || key == "label" {
			continue
		}
		if strings.HasSuffix(key, "Ids") {
			var ids []int
			if json.Unmarshal(raw, &ids) != nil {
				return false, errors.New("Tag usage could not be verified")
			}
			if len(ids) > 0 {
				return false, nil
			}
		} else if key == "inUse" {
			var used bool
			if json.Unmarshal(raw, &used) != nil {
				return false, errors.New("Tag usage could not be verified")
			}
			if used {
				return false, nil
			}
		} else {
			return false, errors.New("Tag usage could not be verified")
		}
	}
	return true, nil
}
func (s *Store) cleanupTags(ctx context.Context, service, endpoint string, c *ArrClient, labels map[string]int, required, kept map[string]bool, unchanged func() bool) (int, error) {
	rows, e := s.DB.QueryContext(ctx, "SELECT label FROM tag_sync_cleanup WHERE service=? AND endpoint=? ORDER BY label", service, endpoint)
	if e != nil {
		return 0, e
	}
	pending := []string{}
	for rows.Next() {
		var label string
		if e = rows.Scan(&label); e != nil {
			rows.Close()
			return 0, e
		}
		pending = append(pending, label)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return 0, e
	}
	blocked := 0
	for _, label := range pending {
		if !unchanged() {
			return blocked, errors.New("Tag synchronization settings changed")
		}
		id := labels[label]
		done := id == 0 || required[label] || kept[label]
		gone := id == 0
		if !done {
			var detail map[string]json.RawMessage
			if e = c.get(ctx, "tag/detail/"+strconv.Itoa(id), nil, &detail); e != nil {
				if strings.Contains(e.Error(), "HTTP 404") {
					done = true
					gone = true
				} else {
					return blocked, e
				}
			} else {
				unused, err := tagUnused(detail, service, id, label)
				if err != nil {
					return blocked, err
				}
				if !unused {
					blocked++
					continue
				}
				if !unchanged() {
					return blocked, errors.New("Tag synchronization settings changed")
				}
				err = c.writeTags(ctx, "tag/"+strconv.Itoa(id), "DELETE", nil, nil)
				if err != nil {
					if strings.Contains(err.Error(), "HTTP 409") {
						blocked++
						continue
					}
					return blocked, err
				}
				done = true
				gone = true
			}
		}
		if gone {
			if _, e = s.DB.ExecContext(ctx, "DELETE FROM tag_sync_ownership WHERE service=? AND endpoint=? AND label=?", service, endpoint, label); e != nil {
				return blocked, e
			}
		}
		if done {
			if _, e = s.DB.ExecContext(ctx, "DELETE FROM tag_sync_cleanup WHERE service=? AND endpoint=? AND label=?", service, endpoint, label); e != nil {
				return blocked, e
			}
		}
	}
	return blocked, nil
}
func tagResponseMatches(op string, got, want []int) bool {
	if op == "replace" {
		return sameTagIDs(got, want)
	}
	set := map[int]bool{}
	for _, id := range got {
		if id <= 0 || set[id] {
			return false
		}
		set[id] = true
	}
	for _, id := range want {
		if op == "add" && !set[id] || op == "remove" && set[id] {
			return false
		}
	}
	return true
}
