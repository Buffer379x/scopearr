package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
)

const tagSyncSchema = `CREATE TABLE IF NOT EXISTS tag_sync_managed(service TEXT NOT NULL,endpoint TEXT NOT NULL,media_id INTEGER NOT NULL,PRIMARY KEY(service,endpoint,media_id));PRAGMA user_version=7;`

type TagSyncStatus struct {
	LastTagCheck        *time.Time         `json:"lastTagCheck,omitempty"`
	ImportConflicts     []ExternalConflict `json:"importConflicts,omitempty"`
	ImportPending       int                `json:"importPending,omitempty"`
	ApprovalRequired    bool               `json:"approvalRequired"`
	Running             bool               `json:"running"`
	Pending             bool               `json:"pending"`
	LastSuccess         *time.Time         `json:"lastSuccess"`
	Error               string             `json:"error"`
	Changed             int                `json:"changed"`
	RetainedDefinitions int                `json:"retainedDefinitions"`
}
type TagWriter struct {
	store       *Store
	config      func() Settings
	gate        chan struct{}
	ctx         context.Context
	cancel      context.CancelFunc
	events      chan string
	done        chan struct{}
	mu          sync.Mutex
	generations map[string]int
	status      map[string]TagSyncStatus
}

func NewTagWriter(ctx context.Context, store *Store, config func() Settings, gate chan struct{}) *TagWriter {
	ctx, cancel := context.WithCancel(ctx)
	w := &TagWriter{store: store, config: config, gate: gate, ctx: ctx, cancel: cancel, events: make(chan string, 2), done: make(chan struct{}), generations: map[string]int{}, status: map[string]TagSyncStatus{}}
	for _, instance := range w.config().AllInstances() {
		service := instance.ID
		var retained int
		if store.Get("tagSyncRetained:"+service, &retained) == nil && retained > 0 {
			w.status[service] = TagSyncStatus{RetainedDefinitions: retained}
		}
	}
	for _, instance := range w.config().AllInstances() {
		service := instance.ID
		var at time.Time
		if store.Get("tagImportCheck:"+service, &at) == nil {
			st := w.status[service]
			st.LastTagCheck = &at
			w.status[service] = st
		}
	}

	go w.run()
	return w
}
func (w *TagWriter) Close() { w.cancel(); <-w.done }
func (w *TagWriter) Queue(service string) {
	if (!serviceOK(service) && !mediaProviderOK(service)) || w.ctx.Err() != nil || !w.config().GetService(service).Enabled {
		return
	}
	w.mu.Lock()
	w.generations[service]++
	_ = w.store.Put("tagSyncDirty:"+service, true)
	st := w.status[service]
	st.Pending = true
	st.ApprovalRequired = false
	w.status[service] = st
	w.mu.Unlock()
	select {
	case w.events <- service:
	default:
	}
}
func (w *TagWriter) Statuses() map[string]TagSyncStatus {
	w.mu.Lock()
	defer w.mu.Unlock()
	out := map[string]TagSyncStatus{}
	for k, v := range w.status {
		out[k] = v
	}
	return out
}
func (w *TagWriter) run() {
	defer close(w.done)
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for _, instance := range w.config().AllInstances() {
		service := instance.ID
		var dirty bool
		_ = w.store.Get("tagSyncDirty:"+service, &dirty)
		if dirty {
			w.apply(service)
		}
	}
	for {
		select {
		case <-w.ctx.Done():
			return
		case service := <-w.events:
			w.apply(service)
		case <-ticker.C:
			for _, instance := range w.config().AllInstances() {
				service := instance.ID
				w.apply(service)
			}
		}
	}
}
func (w *TagWriter) apply(service string) {
	var dirty bool
	w.mu.Lock()
	paused := w.status[service].ApprovalRequired
	w.mu.Unlock()
	cfgBefore := w.config()
	before := cfgBefore.GetService(service)
	if !before.Enabled {
		w.inactive(service)
		return
	}
	w.mu.Lock()
	last := w.status[service].LastTagCheck
	w.mu.Unlock()
	due := before.Enabled && before.TagImport && before.TagImportInterval > 0 && (last == nil || time.Since(*last) >= time.Duration(before.TagImportInterval)*time.Minute)
	if w.store.Get("tagSyncDirty:"+service, &dirty) != nil {
		dirty = false
	}
	if !due && !dirty {
		return
	}
	if paused && !due {
		return
	}

	ctx, cancel := context.WithTimeout(w.ctx, 5*time.Minute)
	defer cancel()
	select {
	case w.gate <- struct{}{}:
		defer func() { <-w.gate }()
	case <-ctx.Done():
		return
	}
	cfg := w.config()
	c := cfg.GetService(service)
	if !c.Enabled {
		w.inactive(service)
		return
	}
	w.mu.Lock()
	gen := w.generations[service]
	st := w.status[service]
	st.Running = true
	st.Pending = true
	st.Error = ""
	w.status[service] = st
	w.mu.Unlock()
	unchanged := func() bool {
		fresh := w.config()
		next := fresh.GetService(service)
		return next == c
	}
	var changed int
	var waiting bool
	var err error
	if mediaProviderOK(service) {
		changed, waiting, err = w.store.ReconcileMediaTags(ctx, cfg, service, c, unchanged)
	} else if paused {
		err = w.store.ImportTags(ctx, service, c, unchanged)
		waiting = true
	} else {
		changed, waiting, err = w.store.ReconcileTags(ctx, service, c, unchanged)
	}
	conflicts, conflictErr := w.store.ExternalConflicts(ctx, service)
	if err == nil && conflictErr != nil {
		err = conflictErr
	}
	var pending int
	w.store.DB.QueryRowContext(ctx, "SELECT count(*) FROM external_tag_pending WHERE service=?", service).Scan(&pending)

	w.mu.Lock()
	defer w.mu.Unlock()
	st = w.status[service]
	st.Running = false
	st.Changed = changed
	st.ImportConflicts = conflicts
	st.ImportPending = pending
	var lastCheck time.Time
	if w.store.Get("tagImportCheck:"+service, &lastCheck) == nil {
		st.LastTagCheck = &lastCheck
	}

	_ = w.store.Get("tagSyncRetained:"+service, &st.RetainedDefinitions)
	if errors.Is(err, ErrTagApproval) {
		st.ApprovalRequired = true
		st.Pending = true
		st.Error = ""
	} else if err != nil {
		st.Error = err.Error()
	} else if !waiting && gen == w.generations[service] {
		_ = w.store.Put("tagSyncDirty:"+service, false)
		st.Pending = false
		now := time.Now().UTC()
		st.LastSuccess = &now
	}
	w.status[service] = st
}
func tagEndpoint(c ServiceConfig) string {
	u, err := url.Parse(c.URL)
	if err != nil {
		return ""
	}
	u.Scheme = strings.ToLower(u.Scheme)
	u.Host = strings.ToLower(u.Host)
	u.Path = strings.TrimRight(u.Path, "/")
	sum := sha256.Sum256([]byte(u.String()))
	return hex.EncodeToString(sum[:])
}

// The upstream label restriction is a-z, digits and hyphens. Unicode is encoded
// deterministically; labels are shared/reused across traits and custom tags.
func tagLabel(value string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(value)) {
		switch {
		case r >= 'a' && r <= 'z' || r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '+':
			b.WriteString("-plus-")
		case r > 127:
			fmt.Fprintf(&b, "-u%x-", r)
		default:
			b.WriteByte('-')
		}
	}
	label := strings.Join(strings.FieldsFunc(b.String(), func(r rune) bool { return r == '-' }), "-")
	if len(label) > 80 {
		sum := sha256.Sum256([]byte(value))
		label = strings.TrimRight(label[:60], "-") + "-" + hex.EncodeToString(sum[:8])
	}
	return label
}

type arrTag struct {
	ID    int    `json:"id"`
	Label string `json:"label"`
}
type taggedMedia struct {
	Title string `json:"title,omitempty"`
	ID    int    `json:"id"`
	Tags  []int  `json:"tags"`
}

func (c *ArrClient) writeTags(ctx context.Context, path, method string, body, out any) error {
	if !(path == "tag" && method == "POST" || (path == "movie/editor" || path == "series/editor") && method == "PUT" || method == "DELETE" && positiveTagPath(path, "tag/")) {
		return errors.New("Tag write endpoint is not allowed")
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(c.Base, "/")+"/api/v3/"+path, bytes.NewReader(raw))
	if err != nil {
		return errors.New("Could not create tag write request")
	}
	req.Header.Set("X-Api-Key", c.Key)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	res, err := c.HTTP.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return errors.New("Tag write request failed")
	}
	defer res.Body.Close()
	if method == "DELETE" && res.StatusCode == http.StatusNotFound {
		return nil
	}
	if res.StatusCode < http.StatusOK || res.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("Tag API returned HTTP %d", res.StatusCode)
	}
	if out != nil {
		return json.NewDecoder(io.LimitReader(res.Body, 8<<20)).Decode(out)
	}
	_, err = io.Copy(io.Discard, io.LimitReader(res.Body, 8<<20))
	return err
}
func sameTagIDs(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	set := map[int]bool{}
	for _, id := range a {
		if id <= 0 || set[id] {
			return false
		}
		set[id] = true
	}
	for _, id := range b {
		if !set[id] {
			return false
		}
		delete(set, id)
	}
	return len(set) == 0
}

// Approved removals use targeted API operations. Concurrent foreign additions
// survive even in overwrite mode and are reviewed on a later reconciliation.
func (s *Store) ReconcileTags(ctx context.Context, service string, c ServiceConfig, unchanged func() bool, target ...int) (int, bool, error) {
	if c.TagImport {
		if e := s.ImportTags(ctx, service, c, unchanged); e != nil {
			return 0, false, e
		}
		if conflicts, e := s.ExternalConflicts(ctx, service); e != nil {
			return 0, false, e
		} else if len(conflicts) > 0 {
			return 0, true, ErrExternalConflict
		}
	}

	p, e := s.BuildTagPlan(ctx, service, c, nil, target...)
	if e != nil {
		return 0, false, e
	}
	if p.Waiting {
		return 0, true, nil
	}
	if p.Preview.ApprovalRequired {
		return 0, true, ErrTagApproval
	}
	if len(p.Operations) == 0 && len(p.Cleanup) == 0 {
		return 0, false, nil
	}
	endpoint := p.Endpoint
	client := NewArr(c)
	rules := s.Recognition().Rules
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return 0, false, e
	}
	defer tx.Rollback()
	if c.TagSync.Active() {
		if e = s.seedTagValues(ctx, tx, service, endpoint, c.TagSync, true, rules, target...); e != nil {
			return 0, false, e
		}
		for f, on := range c.TagSync.fields() {
			if on {
				if _, e = tx.ExecContext(ctx, "INSERT INTO tag_sync_groups VALUES(?,?,?,'active') ON CONFLICT(service,endpoint,field) DO UPDATE SET state='active'", service, endpoint, f); e != nil {
					return 0, false, e
				}
			}
		}
	}
	for _, op := range p.Operations {
		if _, e = tx.ExecContext(ctx, "INSERT OR IGNORE INTO tag_sync_managed VALUES(?,?,?)", service, endpoint, op.ID); e != nil {
			return 0, false, e
		}
	}
	observed := "existing"
	if p.Historical {
		observed = "unknown"
	}
	for id, label := range p.Names {
		if _, e = tx.ExecContext(ctx, "INSERT INTO tag_sync_ownership VALUES(?,?,0,?,?,?) ON CONFLICT(service,endpoint,media_id,tag_id) DO UPDATE SET label=excluded.label,kind=CASE WHEN tag_sync_ownership.label<>excluded.label THEN excluded.kind ELSE tag_sync_ownership.kind END", service, endpoint, id, label, observed); e != nil {
			return 0, false, e
		}
	}
	for l := range p.Cleanup {
		if _, e = tx.ExecContext(ctx, "INSERT OR IGNORE INTO tag_sync_cleanup VALUES(?,?,?)", service, endpoint, l); e != nil {
			return 0, false, e
		}
	}
	if e = tx.Commit(); e != nil {
		return 0, false, e
	}
	wanted := []string{}
	for l := range p.Required {
		wanted = append(wanted, l)
	}
	sort.Strings(wanted)
	for _, l := range wanted {
		if p.Labels[l] != 0 {
			continue
		}
		if !unchanged() {
			return 0, true, nil
		}
		var created arrTag
		confirmed := true
		e = client.writeTags(ctx, "tag", "POST", map[string]string{"label": l}, &created)
		if e != nil {
			confirmed = false
			var latest []arrTag
			if re := client.get(ctx, "tag", nil, &latest); re == nil {
				for _, t := range latest {
					if strings.EqualFold(t.Label, l) {
						created = t
						break
					}
				}
			}
			if created.ID <= 0 {
				return 0, false, e
			}
		}
		if created.ID <= 0 || !strings.EqualFold(created.Label, l) {
			return 0, false, errors.New("Invalid created tag")
		}
		p.Labels[l] = created.ID
		p.Names[created.ID] = l
		kind := "unknown"
		if confirmed {
			kind = "created"
		}
		if _, e = s.DB.ExecContext(ctx, "INSERT OR REPLACE INTO tag_sync_ownership VALUES(?,?,0,?,?,?)", service, endpoint, created.ID, l, kind); e != nil {
			return 0, false, e
		}
	}
	for l := range p.Required {
		id := p.Labels[l]
		if p.AutoProtected[id] {
			continue
		}
		kind := p.Ownership[bindingKey(0, id, l)]
		if kind == "created" || definitionControlled(kind) {
			continue
		}
		var storedKind string
		if e = s.DB.QueryRowContext(ctx, "SELECT kind FROM tag_sync_ownership WHERE service=? AND endpoint=? AND media_id=0 AND tag_id=? AND label=?", service, endpoint, id, l).Scan(&storedKind); e != nil {
			return 0, false, e
		}
		if storedKind == "created" {
			continue
		}
		adopted := "adopted-unknown"
		if strings.HasSuffix(storedKind, "existing") {
			adopted = "adopted-existing"
		}
		if _, e = s.DB.ExecContext(ctx, "UPDATE tag_sync_ownership SET kind=? WHERE service=? AND endpoint=? AND media_id=0 AND tag_id=? AND label=?", adopted, service, endpoint, id, l); e != nil {
			return 0, false, e
		}
	}
	// Persist desired assignment ownership before writes, so an ambiguous response
	// remains recoverable. Existing desired assignments become explicitly managed.
	tx, e = s.DB.BeginTx(ctx, nil)
	if e != nil {
		return 0, false, e
	}
	defer tx.Rollback()
	for _, op := range p.Operations {
		for _, l := range op.Want {
			if p.Policy.keep[l] || p.AutoProtected[p.Labels[l]] {
				continue
			}
			if _, e = tx.ExecContext(ctx, "INSERT OR REPLACE INTO tag_sync_ownership VALUES(?,?,?,?,?,'managed')", service, endpoint, op.ID, p.Labels[l], l); e != nil {
				return 0, false, e
			}
		}
	}
	if e = tx.Commit(); e != nil {
		return 0, false, e
	}
	type batch struct {
		ids, tags []int
		op        string
	}
	batches := map[string]*batch{}
	queue := func(id int, op string, tags []int) {
		if len(tags) == 0 {
			return
		}
		sort.Ints(tags)
		key := op + fmt.Sprint(tags)
		if batches[key] == nil {
			batches[key] = &batch{tags: tags, op: op}
		}
		batches[key].ids = append(batches[key].ids, id)
	}
	for _, op := range p.Operations {
		queue(op.ID, "remove", op.Remove)
		present := map[int]bool{}
		for _, id := range op.Current {
			present[id] = true
		}
		add := []int{}
		for _, l := range op.Want {
			if !present[p.Labels[l]] {
				add = append(add, p.Labels[l])
			}
		}
		queue(op.ID, "add", add)
	}
	keys := []string{}
	for k := range batches {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	changed := map[int]bool{}
	editor := "movie/editor"
	idsKey := "movieIds"
	if serviceKind(service) == "sonarr" {
		editor = "series/editor"
		idsKey = "seriesIds"
	}
	for _, k := range keys {
		b := batches[k]
		for start := 0; start < len(b.ids); start += 100 {
			end := start + 100
			if end > len(b.ids) {
				end = len(b.ids)
			}
			if !unchanged() {
				return len(changed), true, nil
			}
			var applied []taggedMedia
			if e = client.writeTags(ctx, editor, "PUT", map[string]any{idsKey: b.ids[start:end], "tags": b.tags, "applyTags": b.op, "moveFiles": false}, &applied); e != nil {
				return len(changed), false, e
			}
			expected := map[int]bool{}
			for _, id := range b.ids[start:end] {
				expected[id] = true
			}
			for _, m := range applied {
				if !expected[m.ID] || !tagResponseMatches(b.op, m.Tags, b.tags) {
					return len(changed), false, errors.New("Tag update could not be verified")
				}
				if c.TagImport {
					if e = s.recordExternalWrite(ctx, service, endpoint, m.ID, b.tags, b.op == "add"); e != nil {
						return len(changed), false, e
					}
				}
				delete(expected, m.ID)
				changed[m.ID] = true
			}
			if len(expected) > 0 {
				return len(changed), false, errors.New("Tag update could not be verified")
			}
		}
	}
	if !unchanged() {
		return len(changed), true, nil
	}
	blocked, e := s.cleanupTags(ctx, service, endpoint, client, p.Labels, p.Required, p.Policy.keep, unchanged)
	if e != nil {
		return len(changed), false, e
	}
	if e = s.Put("tagSyncRetained:"+service, blocked); e != nil {
		return len(changed), false, e
	}
	finish, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return len(changed), false, e
	}
	defer finish.Rollback()
	for _, op := range p.Operations {
		for _, id := range op.Remove {
			if _, e = finish.ExecContext(ctx, "DELETE FROM tag_sync_ownership WHERE service=? AND endpoint=? AND media_id=? AND tag_id=?", service, endpoint, op.ID, id); e != nil {
				return len(changed), false, e
			}
		}
	}
	for f, st := range p.Policy.states {
		if st == "delete" {
			if _, e = finish.ExecContext(ctx, "DELETE FROM tag_sync_values WHERE service=? AND endpoint=? AND field=?", service, endpoint, f); e != nil {
				return len(changed), false, e
			}
			if _, e = finish.ExecContext(ctx, "DELETE FROM tag_sync_groups WHERE service=? AND endpoint=? AND field=?", service, endpoint, f); e != nil {
				return len(changed), false, e
			}
		}
	}
	if c.TagSync.Custom {
		query := "DELETE FROM tag_sync_values WHERE service=? AND endpoint=? AND field='custom' AND media_id>0"
		args := []any{service, endpoint}
		if len(target) > 0 {
			query += " AND media_id=?"
			args = append(args, target[0])
		}
		if _, e = finish.ExecContext(ctx, query, args...); e != nil {
			return len(changed), false, e
		}
		for id, ls := range p.Snapshot.custom {
			for l := range ls {
				if _, e = finish.ExecContext(ctx, "INSERT OR IGNORE INTO tag_sync_values VALUES(?,?,'custom',?,?)", service, endpoint, l, id); e != nil {
					return len(changed), false, e
				}
			}
		}
	}
	if len(target) == 0 {
		if _, e = finish.ExecContext(ctx, "DELETE FROM tag_sync_approvals WHERE service=? AND endpoint=?", service, endpoint); e != nil {
			return len(changed), false, e
		}
	}
	if !c.TagSync.Active() {
		if _, e = finish.ExecContext(ctx, "DELETE FROM tag_sync_managed WHERE service=? AND endpoint=?", service, endpoint); e != nil {
			return len(changed), false, e
		}
	}
	if c.TagImport && c.TagSync.Custom {
		if _, e = finish.ExecContext(ctx, `DELETE FROM external_tag_pending AS p WHERE p.service=? AND p.endpoint=? AND p.desired=0 AND p.conflict=0 AND NOT EXISTS(SELECT 1 FROM external_tag_bindings b WHERE b.service=p.service AND b.endpoint=p.endpoint AND b.media_id=p.media_id AND b.remote_id=p.remote_id AND b.present=1)`, service, endpoint); e != nil {
			return len(changed), false, e
		}
	}

	if e = finish.Commit(); e != nil {
		return len(changed), false, e
	}
	if c.TagImport {
		if e = s.ImportTags(ctx, service, c, unchanged); e != nil {
			return len(changed), false, e
		}
	}

	return len(changed), false, nil
}

// Disabling a connection suspends mutations but retains its durable dirty flag
// so a later explicit re-enable reconciles the current state before writing.
func (w *TagWriter) inactive(service string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	st := w.status[service]
	st.Running = false
	st.Pending = false
	st.ApprovalRequired = false
	st.Error = ""
	w.status[service] = st
}
