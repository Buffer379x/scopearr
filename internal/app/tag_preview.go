package app

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strings"
)

const tagApprovalSchema = `CREATE TABLE IF NOT EXISTS tag_sync_ownership(service TEXT,endpoint TEXT,media_id INTEGER,tag_id INTEGER,label TEXT,kind TEXT,PRIMARY KEY(service,endpoint,media_id,tag_id)); CREATE TABLE IF NOT EXISTS tag_sync_approvals(service TEXT,endpoint TEXT,media_id INTEGER,tag_id INTEGER,label TEXT,PRIMARY KEY(service,endpoint,media_id,tag_id)); PRAGMA user_version=9;`

var ErrTagApproval = errors.New("Tag deletion requires a reviewed preview")
var ErrTagPreviewChanged = errors.New("Tag preview changed. Review the updated preview before confirming")

type TagTarget struct {
	ID    int    `json:"id"`
	Title string `json:"title"`
}
type TagPreviewRow struct {
	ID               int         `json:"id"`
	Label            string      `json:"label"`
	Origin           string      `json:"origin"`
	Assignments      int         `json:"assignments"`
	DeleteDefinition bool        `json:"deleteDefinition"`
	Retained         bool        `json:"retained"`
	Targets          []TagTarget `json:"targets"`
}
type TagPreview struct {
	Service          string          `json:"service"`
	Token            string          `json:"token"`
	Rows             []TagPreviewRow `json:"rows"`
	ApprovalRequired bool            `json:"approvalRequired"`
	TargetTotal      int             `json:"targetTotal,omitempty"`
	TargetPage       int             `json:"targetPage,omitempty"`
	Targets          []TagTarget     `json:"targets,omitempty"`
}
type tagOperation struct {
	ID      int
	Title   string
	Current []int
	Remove  []int
	Want    []string
}
type tagPlan struct {
	AutoProtected map[int]bool
	Historical    bool
	Preview       TagPreview
	Config        ServiceConfig
	Endpoint      string
	Snapshot      tagSnapshot
	Policy        tagPolicyState
	Labels        map[string]int
	Names         map[int]string
	Required      map[string]bool
	Operations    []tagOperation
	Cleanup       map[string]bool
	Ownership     map[string]string
	Grants        map[string]bool
	Retained      int
	Waiting       bool
}

func bindingKey(mid, tid int, label string) string { return fmt.Sprintf("%d/%d/%s", mid, tid, label) }
func (s *Store) tagBindings(ctx context.Context, service, endpoint, table string) (map[string]string, error) {
	out := map[string]string{}
	kind := "'approved'"
	if table == "tag_sync_ownership" {
		kind = "kind"
	}
	rows, e := s.DB.QueryContext(ctx, "SELECT media_id,tag_id,label,"+kind+" FROM "+table+" WHERE service=? AND endpoint=?", service, endpoint)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	for rows.Next() {
		var mid, tid int
		var label, k string
		if e = rows.Scan(&mid, &tid, &label, &k); e != nil {
			return nil, e
		}
		out[bindingKey(mid, tid, label)] = k
	}
	return out, rows.Err()
}
func (s *Store) plannedPolicies(ctx context.Context, service string, c ServiceConfig, old *ServiceConfig) (tagPolicyState, error) {
	before := c
	if old != nil {
		before = *old
	}
	p, e := s.tagPolicies(ctx, service, tagEndpoint(c), before.TagSync)
	if e != nil {
		return p, e
	}
	if old == nil {
		return p, nil
	}
	enabled, _ := tagChanges(before, c)
	for f, st := range p.states {
		if !c.TagSync.Active() && c.TagSyncDisable == "keep" {
			p.states[f] = "keep"
		} else if st == "keep" && c.TagSync.Active() && tagMode(c) == "replace" && (enabled || before.TagSyncMode != c.TagSyncMode || before.URL != c.URL) {
			p.states[f] = "delete"
		}
	}
	for f, on := range c.TagSync.fields() {
		if on {
			p.states[f] = "active"
		} else if before.TagSync.fields()[f] {
			p.states[f] = c.TagSyncDisable
		}
	}
	byField := map[string]map[string]bool{}
	rows, e := s.DB.QueryContext(ctx, "SELECT field,label FROM tag_sync_values WHERE service=? AND endpoint=? AND media_id=0", service, tagEndpoint(c))
	if e != nil {
		return p, e
	}
	for rows.Next() {
		var f, l string
		if e = rows.Scan(&f, &l); e != nil {
			rows.Close()
			return p, e
		}
		if byField[f] == nil {
			byField[f] = map[string]bool{}
		}
		byField[f][l] = true
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return p, e
	}
	snap, e := readTagSnapshot(ctx, s.DB, service, before.TagSync)
	if e != nil {
		return p, e
	}
	for f, vs := range snap.groups {
		if byField[f] == nil {
			byField[f] = map[string]bool{}
		}
		for v := range vs {
			byField[f][v] = true
		}
	}
	for f, on := range before.TagSync.fields() {
		if on {
			if byField[f] == nil {
				byField[f] = map[string]bool{}
			}
			if f != "custom" {
				byField[f][unknownTagLabel(f)] = true
			}
		}
	}
	for _, r := range s.Recognition().Rules {
		f := r.Field
		if f == "processing" {
			f = "source"
		}
		if before.TagSync.fields()[f] && !strings.Contains(r.Value, "$") {
			if byField[f] == nil {
				byField[f] = map[string]bool{}
			}
			if l := tagLabel(normalizeRuleValue(r.Field, r.Value)); l != "" {
				byField[f][l] = true
			}
		}
	}
	if before.TagSync.Custom {
		tags, e := s.CustomTags(ctx)
		if e != nil {
			return p, e
		}
		if byField["custom"] == nil {
			byField["custom"] = map[string]bool{}
		}
		for _, t := range tags {
			byField["custom"][tagLabel(t.Name)] = true
		}
	}
	p.keep = map[string]bool{}
	p.remove = map[string]bool{}
	p.active = map[string]bool{}
	for f, vs := range byField {
		for v := range vs {
			if p.states[f] == "active" && f != "custom" {
				p.active[v] = true
			}
			if p.states[f] == "keep" {
				p.keep[v] = true
			}
			if p.states[f] == "delete" {
				p.remove[v] = true
			}
		}
	}
	if c.TagSync.Custom && c.TagSyncMode == "add" && (!before.TagSync.Custom || before.TagSyncMode != "add") {
		p.custom = map[int]map[string]bool{}
	}
	return p, nil
}

// BuildTagPlan is read-only. Execution and preview consume exactly these operations.
func (s *Store) BuildTagPlan(ctx context.Context, service string, c ServiceConfig, old *ServiceConfig, target ...int) (*tagPlan, error) {
	if !serviceOK(service) {
		return nil, errors.New("Invalid service")
	}
	p := &tagPlan{Config: c, Endpoint: tagEndpoint(c), Preview: TagPreview{Service: service, Rows: []TagPreviewRow{}}, Labels: map[string]int{}, Names: map[int]string{}, Required: map[string]bool{}, Cleanup: map[string]bool{}, Grants: map[string]bool{}, Snapshot: tagSnapshot{map[int]map[string]bool{}, map[string]map[string]bool{}, map[int]map[string]bool{}}}
	var e error
	p.Policy, e = s.plannedPolicies(ctx, service, c, old)
	if e != nil {
		return nil, e
	}
	rows, e := s.DB.QueryContext(ctx, "SELECT label FROM tag_sync_cleanup WHERE service=? AND endpoint=?", service, p.Endpoint)
	if e != nil {
		return nil, e
	}
	for rows.Next() {
		var l string
		if e = rows.Scan(&l); e != nil {
			rows.Close()
			return nil, e
		}
		p.Cleanup[l] = true
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	if !c.TagSync.Active() && c.TagSyncDisable == "keep" && old != nil {
		p.Cleanup = map[string]bool{}
	}
	if !c.TagSync.Active() && len(p.Policy.remove) == 0 && len(p.Cleanup) == 0 {
		return p, nil
	}
	if !c.Enabled {
		p.Waiting = true
		return p, nil
	}
	if e = ValidateConfig(c); e != nil {
		return nil, e
	}
	if c.TagSync.Active() {
		var snapshot SyncStatus
		if s.Get("sync:"+service, &snapshot) != nil || snapshot.LastSuccess == nil || snapshot.Source != p.Endpoint {
			p.Waiting = true
			return p, nil
		}
		p.Snapshot, e = readTagSnapshot(ctx, s.DB, service, c.TagSync, target...)
		if e != nil {
			return nil, e
		}
	}
	p.Ownership, e = s.tagBindings(ctx, service, p.Endpoint, "tag_sync_ownership")
	if e != nil {
		return nil, e
	}
	grants, e := s.tagBindings(ctx, service, p.Endpoint, "tag_sync_approvals")
	if e != nil {
		return nil, e
	}
	for k := range grants {
		p.Grants[k] = true
	}
	client := NewArr(c)
	var definitions []arrTag
	if e = client.get(ctx, "tag", nil, &definitions); e != nil {
		return nil, e
	}
	for _, t := range definitions {
		l := strings.ToLower(t.Label)
		if t.ID <= 0 || l == "" {
			return nil, errors.New("Invalid tag catalog")
		}
		if _, duplicate := p.Names[t.ID]; duplicate {
			return nil, errors.New("Invalid tag catalog")
		}
		p.Names[t.ID] = l
		if p.Labels[l] == 0 || t.ID < p.Labels[l] {
			p.Labels[l] = t.ID
		}
	}
	catalog := "movie"
	if serviceKind(service) == "sonarr" {
		catalog = "series"
	}
	var media []taggedMedia
	q := url.Values{}
	if serviceKind(service) == "radarr" {
		q.Set("excludeLocalCovers", "true")
	}
	if len(target) > 0 {
		var one taggedMedia
		e = client.get(ctx, catalog+"/"+fmt.Sprint(target[0]), nil, &one)
		if errors.Is(e, ErrArrNotFound) {
			media = []taggedMedia{}
		} else if e != nil {
			return nil, e
		} else if one.ID != target[0] {
			return nil, errors.New("Invalid targeted tag response")
		} else {
			media = []taggedMedia{one}
		}
	} else if e = client.get(ctx, catalog, q, &media); e != nil {
		return nil, e
	}
	p.AutoProtected = map[int]bool{}
	pending := map[int]map[string]bool{}
	if c.TagImport {
		var details []externalDetail
		if e = client.get(ctx, "tag/detail", nil, &details); e != nil {
			return nil, e
		}
		for _, d := range details {
			if d.ID <= 0 {
				return nil, errors.New("Invalid tag catalog")
			}
			if len(d.Auto) > 0 {
				p.AutoProtected[d.ID] = true
			}
		}
		pending, e = s.pendingForPlan(ctx, service, p.Endpoint)
		if c.TagSync.Custom {
			for _, ls := range pending {
				for l, on := range ls {
					if !on {
						p.Cleanup[l] = true
					}
				}
			}
		}
		if e != nil {
			return nil, e
		}
	}

	if c.TagImport && c.TagSync.Custom {
		for _, ls := range pending {
			for label, on := range ls {
				if !on && p.Labels[label] > 0 {
					var localDefinition bool
					if e = s.DB.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM external_tag_defs WHERE service=? AND endpoint=? AND label=? AND custom_id IS NOT NULL)`, service, p.Endpoint, label).Scan(&localDefinition); e != nil {
						return nil, e
					}
					if localDefinition {
						p.Required[label] = true
					}
				}
			}
		}
	}

	sort.Slice(media, func(i, j int) bool { return media[i].ID < media[j].ID })
	var historical int
	if e = s.DB.QueryRowContext(ctx, "SELECT (SELECT count(*) FROM tag_sync_values WHERE service=? AND endpoint=?)+(SELECT count(*) FROM tag_sync_managed WHERE service=? AND endpoint=?)", service, p.Endpoint, service, p.Endpoint).Scan(&historical); e != nil {
		return nil, e
	}
	p.Historical = historical > 0
	originFor := func(id int, label string) string {
		kind := p.Ownership[bindingKey(0, id, label)]
		if kind == "created" {
			return "scopearr"
		}
		if strings.HasSuffix(kind, "existing") || historical == 0 {
			return "existing"
		}
		return "unknown"
	}
	seen := map[int]bool{}
	removed := map[int]map[int]bool{}
	previewRows := map[int]*TagPreviewRow{}
	for _, m := range media {
		if m.ID <= 0 || seen[m.ID] {
			return nil, errors.New("Invalid tag media catalog")
		}
		seen[m.ID] = true
		want := map[string]bool{}
		for l := range p.Snapshot.desired[m.ID] {
			want[l] = true
			p.Required[l] = true
		}
		// Import-only assignments survive technical overwrite; explicit group Delete still wins.
		if c.TagImport && !c.TagSync.Custom {
			rs, err := s.DB.QueryContext(ctx, `SELECT d.label FROM external_tag_defs d JOIN external_tag_bindings b ON b.service=d.service AND b.endpoint=d.endpoint AND b.remote_id=d.remote_id WHERE b.service=? AND b.endpoint=? AND b.media_id=? AND b.present=1 AND b.imported=1`, service, p.Endpoint, m.ID)
			if err != nil {
				return nil, err
			}
			for rs.Next() {
				var l string
				if err = rs.Scan(&l); err != nil {
					rs.Close()
					return nil, err
				}
				if !p.Policy.remove[l] {
					want[l] = true
					p.Required[l] = true
				}
			}
			err = rs.Err()
			rs.Close()
			if err != nil {
				return nil, err
			}
		}
		if c.TagImport && c.TagSync.Custom {
			for l, on := range pending[m.ID] {
				if on {
					want[l] = true
					p.Required[l] = true
				} else {
					delete(want, l)
				}
			}
		}
		for id := range p.AutoProtected {
			if l := p.Names[id]; l != "" {
				delete(want, l)
			}
		}

		op := tagOperation{ID: m.ID, Title: m.Title, Current: append([]int{}, m.Tags...)}
		sort.Ints(op.Current)
		_, hasFiles := p.Snapshot.desired[m.ID]
		assigned := map[int]bool{}
		for _, id := range m.Tags {
			if id <= 0 || assigned[id] {
				return nil, errors.New("Invalid tag assignment")
			}
			assigned[id] = true
			l, ok := p.Names[id]
			if !ok {
				return nil, errors.New("Invalid tag assignment")
			}
			if p.AutoProtected[id] {
				want[l] = true
				p.Required[l] = true
				continue
			}
			if p.Policy.keep[l] {
				want[l] = true
			}
			intent, explicit := pending[m.ID][l]
			policyRemove := c.TagSync.Custom && explicit && !intent || tagMode(c) == "replace" || p.Policy.remove[l] || c.TagSync.Custom && p.Policy.custom[m.ID][l]
			// Additive mode still refreshes values Scopearr manages for active technical groups.
			stale := tagMode(c) == "add" && c.TagSync.Active() && hasFiles && p.Policy.active[l] && !p.Policy.keep[l] && p.Ownership[bindingKey(m.ID, id, l)] == "managed"
			remove := !want[l] && (policyRemove || stale)
			if !remove {
				continue
			}
			op.Remove = append(op.Remove, id)
			if policyRemove || definitionControlled(p.Ownership[bindingKey(0, id, l)]) {
				p.Cleanup[l] = true
			}
			if removed[id] == nil {
				removed[id] = map[int]bool{}
			}
			removed[id][m.ID] = true
			row := previewRows[id]
			if row == nil {
				origin := originFor(id, l)
				row = &TagPreviewRow{ID: id, Label: l, Origin: origin, Targets: []TagTarget{}}
				previewRows[id] = row
			}
			row.Assignments++
			if len(row.Targets) < 10 {
				row.Targets = append(row.Targets, TagTarget{m.ID, m.Title})
			}
			if !(c.TagSync.Custom && explicit && !intent) && p.Ownership[bindingKey(m.ID, id, l)] != "managed" && !p.Grants[bindingKey(m.ID, id, l)] {
				p.Preview.ApprovalRequired = true
			}
		}
		for l := range want {
			op.Want = append(op.Want, l)
		}
		sort.Strings(op.Want)
		sort.Ints(op.Remove)
		p.Operations = append(p.Operations, op)
	}
	for l := range p.Policy.remove {
		if p.AutoProtected[p.Labels[l]] {
			continue
		}
		p.Cleanup[l] = true
	}
	cleanupNames := []string{}
	for l := range p.Cleanup {
		cleanupNames = append(cleanupNames, l)
	}
	sort.Strings(cleanupNames)
	details := map[int]map[string]json.RawMessage{}
	for _, l := range cleanupNames {
		id := p.Labels[l]
		if id == 0 || p.AutoProtected[id] || p.Required[l] || p.Policy.keep[l] {
			continue
		}
		var detail map[string]json.RawMessage
		if e = client.get(ctx, "tag/detail/"+fmt.Sprint(id), nil, &detail); e != nil {
			return nil, e
		}
		key := "movieIds"
		if serviceKind(service) == "sonarr" {
			key = "seriesIds"
		}
		var ids []int
		if json.Unmarshal(detail[key], &ids) != nil || string(detail[key]) == "null" {
			return nil, errors.New("Tag usage could not be verified")
		}
		remaining := []int{}
		for _, mid := range ids {
			if !removed[id][mid] {
				remaining = append(remaining, mid)
			}
		}
		projected := map[string]json.RawMessage{}
		for k, v := range detail {
			projected[k] = v
		}
		projected[key], _ = json.Marshal(remaining)
		delete(projected, "inUse")
		unused, err := tagUnused(projected, service, id, l)
		if err != nil {
			return nil, err
		}
		for k, v := range detail {
			if strings.HasSuffix(k, "Ids") {
				var ids []int
				if json.Unmarshal(v, &ids) == nil {
					sort.Ints(ids)
					detail[k], _ = json.Marshal(ids)
				}
			}
		}
		details[id] = detail
		row := previewRows[id]
		if row == nil {
			origin := originFor(id, l)
			row = &TagPreviewRow{ID: id, Label: l, Origin: origin, Targets: []TagTarget{}}
			previewRows[id] = row
		}
		row.DeleteDefinition = unused
		row.Retained = !unused
		if !unused {
			p.Retained++
		} else if !definitionControlled(p.Ownership[bindingKey(0, id, l)]) && !p.Grants[bindingKey(0, id, l)] {
			p.Preview.ApprovalRequired = true
		}
	}
	for _, r := range previewRows {
		p.Preview.Rows = append(p.Preview.Rows, *r)
	}
	sort.Slice(p.Preview.Rows, func(i, j int) bool { return p.Preview.Rows[i].Label < p.Preview.Rows[j].Label })
	// Signature covers the effective plan and the fresh remote usage, without keys.
	raw, _ := json.Marshal(struct {
		Service, Endpoint, Mode, Disable, Revision string
		Groups                                     TagGroups
		Operations                                 []tagOperation
		Rows                                       []TagPreviewRow
		Details                                    map[int]map[string]json.RawMessage
	}{service, p.Endpoint, tagMode(c), c.TagSyncDisable, s.Recognition().Revision, c.TagSync, p.Operations, p.Preview.Rows, details})
	sum := sha256.Sum256(raw)
	p.Preview.Token = hex.EncodeToString(sum[:])
	return p, nil
}
func approveTagPlan(ctx context.Context, tx *sql.Tx, p *tagPlan) error {
	for _, op := range p.Operations {
		for _, id := range op.Remove {
			if _, e := tx.ExecContext(ctx, "INSERT OR REPLACE INTO tag_sync_approvals VALUES(?,?,?,?,?)", p.Preview.Service, p.Endpoint, op.ID, id, p.Names[id]); e != nil {
				return e
			}
		}
	}
	for _, r := range p.Preview.Rows {
		if r.DeleteDefinition {
			if _, e := tx.ExecContext(ctx, "INSERT OR REPLACE INTO tag_sync_approvals VALUES(?,?,?,?,?)", p.Preview.Service, p.Endpoint, 0, r.ID, r.Label); e != nil {
				return e
			}
		}
	}
	return nil
}
func (s *Store) ApproveTagPlan(ctx context.Context, p *tagPlan) error {
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if e = approveTagPlan(ctx, tx, p); e != nil {
		return e
	}
	return tx.Commit()
}

func definitionControlled(kind string) bool {
	return kind == "created" || strings.HasPrefix(kind, "adopted-")
}
