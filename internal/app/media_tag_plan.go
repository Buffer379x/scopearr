package app

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"
)

// No PRAGMA here: the normal migration owns the database schema version. These
// idempotent definitions also support callers restoring an older cache.
const mediaTagSchema = `CREATE TABLE IF NOT EXISTS media_tag_history(service TEXT NOT NULL,endpoint TEXT NOT NULL,item_id TEXT NOT NULL,label TEXT NOT NULL,groups INTEGER NOT NULL,owned INTEGER NOT NULL,PRIMARY KEY(service,endpoint,item_id,label));
CREATE TABLE IF NOT EXISTS media_tag_policy(service TEXT NOT NULL,endpoint TEXT NOT NULL,field TEXT NOT NULL,state TEXT NOT NULL,PRIMARY KEY(service,endpoint,field));
CREATE TABLE IF NOT EXISTS media_tag_approvals(service TEXT NOT NULL,endpoint TEXT NOT NULL,item_id TEXT NOT NULL,label TEXT NOT NULL,PRIMARY KEY(service,endpoint,item_id,label));
CREATE TABLE IF NOT EXISTS media_tag_targets(service TEXT NOT NULL,endpoint TEXT NOT NULL,item_id TEXT NOT NULL,title TEXT NOT NULL,identities TEXT NOT NULL,PRIMARY KEY(service,endpoint,item_id));`

var mediaTagFieldOrder = []string{"resolution", "codec", "source", "hdr", "bitDepth", "audio", "channels", "language", "custom"}

type mediaTagHistory struct {
	Groups uint16
	Owned  bool
}
type mediaTagIdentity struct {
	Source, Filename, SourceID, ItemType, ServerID string
	Size                                           int64
	FileID                                         int
}
type mediaTagOperation struct {
	ID                   int
	ItemID, Title, Stamp string
	Identities           []mediaTagIdentity
	Desired              map[string]uint16
	Current              map[string]string
	Want                 map[string]string
	Remove               []string
	History              map[string]mediaTagHistory
	Contributing         bool
	Gone                 bool
}

// Preview uses presentation IDs so the established review UI can be reused.
// Remote item identifiers never become SQL IDs and remain bound to this plan.
type MediaTagPlan struct {
	Preview          TagPreview
	Waiting          bool
	Skipped          int
	Config           ServiceConfig
	Endpoint         string
	Operations       []*mediaTagOperation
	states           map[string]string
	client           *mediaTagClient
	labels           map[int]string
	processedThrough string
	window           mediaTagWindow
}

type mediaTagWindow struct {
	After, Through string
	More           bool
}
type mediaTagCursor struct{ Signature, After, Revision string }

func mediaTagRangeSQL(column string, window mediaTagWindow) (string, []any) {
	if window.Through == "" {
		return "", nil
	}
	return " AND " + column + ">? AND " + column + "<=?", []any{window.After, window.Through}
}

func mediaTagBit(field string) uint16 {
	for i, f := range mediaTagFieldOrder {
		if f == field {
			return 1 << i
		}
	}
	return 0
}
func mediaTagMapKey(id, label string) string { return id + "\x00" + label }

func (s *Store) mediaTagTables(ctx context.Context) error {
	_, e := s.DB.ExecContext(ctx, mediaTagSchema)
	return e
}

func (s *Store) mediaTagState(ctx context.Context, id, endpoint string, window mediaTagWindow) (map[string]map[string]mediaTagHistory, map[string]string, map[string]bool, error) {
	history := map[string]map[string]mediaTagHistory{}
	states := map[string]string{}
	grants := map[string]bool{}
	rangeSQL, rangeArgs := mediaTagRangeSQL("item_id", window)
	args := append([]any{id, endpoint}, rangeArgs...)
	rows, e := s.DB.QueryContext(ctx, `SELECT item_id,label,groups,owned FROM media_tag_history WHERE service=? AND endpoint=?`+rangeSQL, args...)
	if e != nil {
		return nil, nil, nil, e
	}
	for rows.Next() {
		var item, label string
		var h mediaTagHistory
		if e = rows.Scan(&item, &label, &h.Groups, &h.Owned); e != nil {
			rows.Close()
			return nil, nil, nil, e
		}
		if history[item] == nil {
			history[item] = map[string]mediaTagHistory{}
		}
		history[item][label] = h
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, nil, nil, e
	}
	rows, e = s.DB.QueryContext(ctx, `SELECT field,state FROM media_tag_policy WHERE service=? AND endpoint=?`, id, endpoint)
	if e != nil {
		return nil, nil, nil, e
	}
	for rows.Next() {
		var f, state string
		if e = rows.Scan(&f, &state); e != nil {
			break
		}
		states[f] = state
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		return nil, nil, nil, e
	}
	rows, e = s.DB.QueryContext(ctx, `SELECT item_id,label FROM media_tag_approvals WHERE service=? AND endpoint=?`+rangeSQL, args...)
	if e != nil {
		return nil, nil, nil, e
	}
	for rows.Next() {
		var item, label string
		if e = rows.Scan(&item, &label); e != nil {
			break
		}
		grants[mediaTagMapKey(item, label)] = true
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	return history, states, grants, e
}

func mediaTagSourceSelected(c ServiceConfig, id string) bool {
	return c.SourceIDs == "" || containsString(strings.Split(c.SourceIDs, ","), id)
}

func (s *Store) addHistoricalMediaTargets(ctx context.Context, id string, c ServiceConfig, cfg Settings, targets map[string]*mediaTagOperation, window mediaTagWindow) (int, error) {
	rangeSQL, rangeArgs := mediaTagRangeSQL("item_id", window)
	args := append([]any{id, tagEndpoint(c)}, rangeArgs...)
	rows, e := s.DB.QueryContext(ctx, `SELECT item_id,title,identities FROM media_tag_targets WHERE service=? AND endpoint=?`+rangeSQL, args...)
	if e != nil {
		return 0, e
	}
	defer rows.Close()
	skipped := 0
	for rows.Next() {
		var item, title, raw string
		if e = rows.Scan(&item, &title, &raw); e != nil {
			return skipped, e
		}
		if targets[item] != nil {
			continue
		}
		var identities []mediaTagIdentity
		if json.Unmarshal([]byte(raw), &identities) != nil || len(identities) == 0 {
			skipped++
			continue
		}
		safe := true
		for _, identity := range identities {
			source := cfg.GetService(identity.Source)
			if !source.Enabled || !mediaTagSourceSelected(c, identity.Source) {
				continue
			}
			var status SyncStatus
			if s.Get("sync:"+identity.Source, &status) != nil || status.Source != tagEndpoint(source) {
				safe = false
				break
			}
			var name, matchRaw string
			var size int64
			e = s.DB.QueryRowContext(ctx, `SELECT filename,size,coalesce(json_extract(data,?),'null') FROM files WHERE service=? AND id=?`, `$.mediaServers."`+id+`"`, identity.Source, identity.FileID).Scan(&name, &size, &matchRaw)
			if errors.Is(e, sql.ErrNoRows) {
				continue
			}
			if e != nil {
				return skipped, e
			}
			if name != identity.Filename || size != identity.Size {
				continue
			}
			// A still-present file whose cached target became ambiguous or stale
			// must not be reinterpreted as a deleted file by historical cleanup.
			var match MediaMatch
			if json.Unmarshal([]byte(matchRaw), &match) != nil || match.ItemID == item || match.ItemID == "" || match.Endpoint != tagEndpoint(c) || match.Status != "matched" && match.Status != "no_tracks" {
				safe = false
				break
			}
		}
		if !safe {
			skipped++
			continue
		}
		targets[item] = &mediaTagOperation{ItemID: item, Title: title, Identities: identities, Desired: map[string]uint16{}, History: map[string]mediaTagHistory{}}
	}
	return skipped, rows.Err()
}

func (s *Store) mediaTagTargets(ctx context.Context, id string, c ServiceConfig, before *ServiceConfig, cfg Settings, window mediaTagWindow) (map[string]*mediaTagOperation, int, error) {
	targets := map[string]*mediaTagOperation{}
	skipped := 0
	intern := map[string]string{}
	for _, source := range cfg.ArrInstances() {
		if !source.Enabled {
			continue
		}
		selected := mediaTagSourceSelected(c, source.ID)
		wasSelected := before != nil && mediaTagSourceSelected(*before, source.ID)
		if !selected && !wasSelected {
			continue
		}
		var status SyncStatus
		fresh := s.Get("sync:"+source.ID, &status) == nil && status.Source == tagEndpoint(source)
		matchPath := `$.mediaServers."` + id + `"`
		query := `SELECT f.id,f.title,f.filename,f.size,f.resolution,f.codec,f.source,f.processing,f.hdr,f.bitDepth,f.audio,f.channels,f.language,` + customJSON + `,coalesce(json_extract(f.data,'$.unknownTraits'),'[]'),coalesce(json_extract(f.data,?),'null') FROM files f WHERE f.service=?`
		args := []any{matchPath, source.ID}
		if window.Through != "" {
			query += ` AND coalesce(json_extract(f.data,?),'')>? AND coalesce(json_extract(f.data,?),'')<=?`
			args = append(args, matchPath+`.itemId`, window.After, matchPath+`.itemId`, window.Through)
		}
		rows, e := s.DB.QueryContext(ctx, query, args...)
		if e != nil {
			return nil, skipped, e
		}
		for rows.Next() {
			var title, filename, resolution, codec, src, processing, hdr, depth, audio, channels, language, custom, unknown, raw string
			var size int64
			var fileID int
			if e = rows.Scan(&fileID, &title, &filename, &size, &resolution, &codec, &src, &processing, &hdr, &depth, &audio, &channels, &language, &custom, &unknown, &raw); e != nil {
				rows.Close()
				return nil, skipped, e
			}
			var match MediaMatch
			if json.Unmarshal([]byte(raw), &match) != nil || !fresh || (match.Status != "matched" && match.Status != "no_tracks") || !safeMediaID(match.ItemID) || !safeMediaID(match.ServerID) || match.Endpoint != tagEndpoint(c) || size <= 0 {
				skipped++
				continue
			}
			expected := "Movie"
			if serviceKind(source.ID) == "sonarr" {
				expected = "Episode"
			}
			if match.ItemType != expected {
				skipped++
				continue
			}
			op := targets[match.ItemID]
			if op == nil {
				op = &mediaTagOperation{ItemID: match.ItemID, Title: title, Desired: map[string]uint16{}, History: map[string]mediaTagHistory{}}
				targets[match.ItemID] = op
			}
			op.Contributing = op.Contributing || selected
			op.Identities = append(op.Identities, mediaTagIdentity{Source: source.ID, Filename: filename, SourceID: match.SourceID, ItemType: match.ItemType, ServerID: match.ServerID, Size: size, FileID: fileID})
			if !selected {
				continue
			}
			add := func(field, value, separator string) {
				if !c.TagSync.fields()[field] {
					return
				}
				if value == "" && field != "custom" {
					value = unknownTagLabel(field)
				}
				for _, v := range strings.Split(value, separator) {
					label, ok := intern[v]
					if !ok {
						label = tagLabel(v)
						intern[v] = label
					}
					if label != "" {
						op.Desired[label] |= mediaTagBit(field)
					}
				}
			}
			add("resolution", resolution, " + ")
			add("codec", codec, " + ")
			add("source", src, " + ")
			if processing != "" {
				add("source", processing, " + ")
			}
			add("hdr", hdr, " + ")
			add("bitDepth", depth, " + ")
			add("audio", audio, " + ")
			add("channels", channels, " + ")
			add("language", language, ", ")
			var missing []string
			if e = json.Unmarshal([]byte(unknown), &missing); e != nil {
				rows.Close()
				return nil, skipped, e
			}
			for _, field := range missing {
				if field == "audio" || field == "language" {
					add(field, unknownTagLabel(field), "\x00")
				}
			}
			if c.TagSync.Custom {
				var tags []CustomTag
				if e = json.Unmarshal([]byte(custom), &tags); e != nil {
					rows.Close()
					return nil, skipped, e
				}
				for _, tag := range tags {
					add("custom", tag.Name, "\x00")
				}
			}
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return nil, skipped, e
		}
	}
	return targets, skipped, nil
}

func mediaTagIdentityMatches(op *mediaTagOperation, d mediaTagDocument, serverID string) bool {
	if d.Item.Id != op.ItemID || d.Item.ServerId != "" && d.Item.ServerId != serverID {
		return false
	}
	for _, identity := range op.Identities {
		if identity.ServerID != serverID || identity.ItemType != d.Item.Type {
			return false
		}
		sources := d.Item.MediaSources
		if len(sources) == 0 && d.Item.Path != "" {
			sources = []embySource{{Path: d.Item.Path, Size: d.Item.Size}}
		}
		count := 0
		for _, source := range sources {
			if source.IsRemote || source.Path == "" {
				continue
			}
			size := source.Size
			if size <= 0 && source.Path == d.Item.Path {
				size = d.Item.Size
			}
			if size == identity.Size && pathBasename(source.Path) == identity.Filename && (identity.SourceID == "" || identity.SourceID == source.Id) {
				count++
			}
		}
		if count != 1 {
			return false
		}
	}
	return len(op.Identities) > 0
}

// BuildMediaTagPlan performs only allowlisted GET requests. Every write target
// must have an exact cached movie/episode identity and a fresh live identity.
func (s *Store) BuildMediaTagPlan(ctx context.Context, id string, next ServiceConfig, before *ServiceConfig, sources ...Settings) (*MediaTagPlan, error) {
	return s.buildMediaTagPlan(ctx, id, next, before, mediaTagWindow{}, sources...)
}

func (s *Store) buildMediaTagPlan(ctx context.Context, id string, next ServiceConfig, before *ServiceConfig, window mediaTagWindow, sources ...Settings) (*MediaTagPlan, error) {
	p := &MediaTagPlan{Preview: TagPreview{Service: id, Rows: []TagPreviewRow{}}, Config: next, Endpoint: tagEndpoint(next), states: map[string]string{}, labels: map[int]string{}}
	p.window = window
	if !mediaProviderOK(id) || next.ID != "" && next.ID != id {
		return nil, errors.New("Invalid media server instance")
	}
	p.Config.ID = id
	p.Config.Type = serviceKind(id)
	if e := s.mediaTagTables(ctx); e != nil {
		return nil, e
	}
	history, states, grants, e := s.mediaTagState(ctx, id, p.Endpoint, window)
	if e != nil {
		return nil, e
	}
	p.states = states
	previous := TagGroups{}
	if before != nil {
		previous = before.TagSync
	}
	for field, on := range next.TagSync.fields() {
		if on {
			p.states[field] = "active"
		} else if previous.fields()[field] || p.states[field] == "active" {
			p.states[field] = next.TagSyncDisable
			if p.states[field] == "" {
				p.states[field] = "delete"
			}
		}
	}
	technical := uint16(0)
	for field, state := range p.states {
		if state == "active" && field != "custom" {
			technical |= mediaTagBit(field)
		}
	}
	if !next.TagSync.Active() && len(history) == 0 {
		return p, nil
	}
	if !next.TagSync.Active() {
		cleanup := false
		for _, tags := range history {
			for _, h := range tags {
				for field, state := range p.states {
					if state == "delete" && h.Groups&mediaTagBit(field) != 0 {
						cleanup = true
					}
				}
			}
		}
		if !cleanup {
			return p, nil
		}
	}
	if !next.Enabled {
		return nil, errors.New("Keep the media server enabled until tag cleanup finishes")
	}
	var cfg Settings
	if len(sources) > 0 {
		cfg = sources[0]
	} else {
		if e = s.Get("settings", &cfg); e != nil {
			return nil, e
		}
	}
	targets, skipped, e := s.mediaTagTargets(ctx, id, p.Config, before, cfg, window)
	if e != nil {
		return nil, e
	}
	p.Skipped = skipped
	moreSkipped, e := s.addHistoricalMediaTargets(ctx, id, p.Config, cfg, targets, window)
	if e != nil {
		return nil, e
	}
	p.Skipped += moreSkipped
	if len(targets) == 0 {
		p.Waiting = p.Skipped > 0
		return p, nil
	}
	p.client = newMediaTagClient(p.Config)
	if e = p.client.check(ctx); e != nil {
		return nil, e
	}
	ids := make([]string, 0, len(targets))
	for itemID := range targets {
		ids = append(ids, itemID)
	}
	sort.Strings(ids)
	for start := 0; start < len(ids); {
		end := start
		size := 0
		for end < len(ids) && end-start < 100 && size+len(ids[end])+1 <= 5000 {
			size += len(ids[end]) + 1
			end++
		}
		documents, e := p.client.readItems(ctx, ids[start:end])
		if e != nil {
			return nil, e
		}
		for _, itemID := range ids[start:end] {
			op := targets[itemID]
			d, exists := documents[itemID]
			if !exists {
				if len(history[itemID]) == 0 && op.Contributing {
					p.Skipped++
					continue
				}
				op.ID = len(p.Operations) + 1
				op.Gone = true
				op.Current = map[string]string{}
				op.Want = map[string]string{}
				p.Operations = append(p.Operations, op)
				continue
			}
			if !mediaTagIdentityMatches(op, d, p.client.serverID) {
				p.Skipped++
				continue
			}
			if p.client.kind == "jellyfin" {
				if _, e = jellyfinTagPayload(d, d.Tags); e != nil {
					return nil, e
				}
			}
			op.ID = len(p.Operations) + 1
			op.Title = d.Title
			op.Stamp = d.Stamp
			op.Current = d.Tags
			op.History = history[itemID]
			if op.History == nil {
				op.History = map[string]mediaTagHistory{}
			}
			op.Want = map[string]string{}
			for label := range op.Desired {
				if old, ok := op.Current[label]; ok {
					op.Want[label] = old
				} else {
					op.Want[label] = label
				}
			}
			for label, h := range op.History {
				for field, state := range p.states {
					if state == "keep" && h.Groups&mediaTagBit(field) != 0 {
						if v, ok := op.Current[label]; ok {
							op.Want[label] = v
						}
					}
				}
			}
			for label, value := range op.Current {
				if _, want := op.Want[label]; want {
					continue
				}
				h := op.History[label]
				remove := op.Contributing && next.TagSync.Active() && tagMode(next) == "replace"
				// Additive mode still refreshes technical values Scopearr added to this item.
				if tagMode(next) == "add" && op.Contributing && next.TagSync.Active() && h.Owned && h.Groups&technical != 0 {
					remove = true
				}
				if h.Groups&mediaTagBit("custom") != 0 && next.TagSync.Custom {
					remove = true
				}
				if !op.Contributing && h.Groups != 0 {
					remove = true
				}
				for field, state := range p.states {
					if state == "delete" && h.Groups&mediaTagBit(field) != 0 {
						remove = true
					}
				}
				if remove {
					op.Remove = append(op.Remove, label)
					if !h.Owned && !grants[mediaTagMapKey(itemID, label)] {
						p.Preview.ApprovalRequired = true
					}
				} else {
					op.Want[label] = value
				}
			}
			sort.Strings(op.Remove)
			p.Operations = append(p.Operations, op)
		}
		start = end
	}
	p.Waiting = len(p.Operations) == 0 && p.Skipped > 0
	rows := map[string]*TagPreviewRow{}
	labels := []string{}
	for _, op := range p.Operations {
		for _, label := range op.Remove {
			row := rows[label]
			if row == nil {
				row = &TagPreviewRow{Label: op.Current[label], Origin: "scopearr", Targets: []TagTarget{}}
				rows[label] = row
				labels = append(labels, label)
			}
			if !op.History[label].Owned {
				row.Origin = "existing"
			}
			row.Assignments++
			if len(row.Targets) < 10 {
				row.Targets = append(row.Targets, TagTarget{ID: op.ID, Title: op.Title})
			}
		}
	}
	sort.Strings(labels)
	for i, label := range labels {
		row := rows[label]
		row.ID = i + 1
		p.labels[row.ID] = label
		p.Preview.Rows = append(p.Preview.Rows, *row)
	}
	tokenRaw, _ := json.Marshal(struct {
		Service, Endpoint, Server, Revision, Mode, Disable, Sources string
		Groups                                                      TagGroups
		Operations                                                  []*mediaTagOperation
	}{id, p.Endpoint, p.client.serverID, s.Recognition().Revision, tagMode(next), next.TagSyncDisable, next.SourceIDs, next.TagSync, p.Operations})
	sum := sha256.Sum256(tokenRaw)
	p.Preview.Token = hex.EncodeToString(sum[:])
	return p, nil
}

// TagTargets exposes only presentation IDs/titles, never provider metadata.
func (p *MediaTagPlan) TagTargets(tagID, page int) TagPreview {
	preview := p.Preview
	targets := []TagTarget{}
	label := p.labels[tagID]
	for _, op := range p.Operations {
		if containsString(op.Remove, label) {
			targets = append(targets, TagTarget{ID: op.ID, Title: op.Title})
		}
	}
	if page < 1 {
		page = 1
	}
	maxPage := (len(targets) + 99) / 100
	if maxPage < 1 {
		maxPage = 1
	}
	if page > maxPage {
		page = maxPage
	}
	preview.TargetTotal = len(targets)
	preview.TargetPage = page
	start := (page - 1) * 100
	end := start + 100
	if end > len(targets) {
		end = len(targets)
	}
	preview.Targets = targets[start:end]
	return preview
}

func approveMediaTagPlan(ctx context.Context, tx *sql.Tx, p *MediaTagPlan) error {
	if _, e := tx.ExecContext(ctx, `DELETE FROM kv WHERE key=?`, "mediaTagCursor:"+p.Preview.Service); e != nil {
		return e
	}
	for _, op := range p.Operations {
		for _, label := range op.Remove {
			if _, e := tx.ExecContext(ctx, `INSERT OR IGNORE INTO media_tag_approvals VALUES(?,?,?,?)`, p.Preview.Service, p.Endpoint, op.ItemID, label); e != nil {
				return e
			}
		}
	}
	return nil
}

func (s *Store) ApproveMediaTagPlan(ctx context.Context, p *MediaTagPlan) error {
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if e = approveMediaTagPlan(ctx, tx, p); e != nil {
		return e
	}
	if e = tx.Commit(); e != nil {
		return e
	}
	p.Preview.ApprovalRequired = false
	return nil
}

func (s *Store) ExecuteMediaTagPlan(ctx context.Context, p *MediaTagPlan, unchanged func() bool) (int, bool, error) {
	if p.Waiting {
		return 0, true, nil
	}
	if p.Preview.ApprovalRequired {
		return 0, true, ErrTagApproval
	}
	changed := 0
	if unchanged == nil {
		unchanged = func() bool { return true }
	}
	if !unchanged() {
		return 0, true, ErrTagPreviewChanged
	}
	if e := s.saveMediaTagStates(ctx, p); e != nil {
		return 0, false, e
	}
	started := time.Now()
	for index, op := range p.Operations {
		if index > 0 && (changed >= 250 || time.Since(started) >= 30*time.Second) {
			return changed, true, nil
		}
		if !unchanged() {
			return changed, true, ErrTagPreviewChanged
		}
		if e := ctx.Err(); e != nil {
			return changed, false, e
		}
		if op.Gone {
			tx, e := s.DB.BeginTx(ctx, nil)
			if e != nil {
				return changed, false, e
			}
			for _, table := range []string{"media_tag_history", "media_tag_approvals", "media_tag_targets"} {
				if _, e = tx.ExecContext(ctx, "DELETE FROM "+table+" WHERE service=? AND endpoint=? AND item_id=?", p.Preview.Service, p.Endpoint, op.ItemID); e != nil {
					break
				}
			}
			if e == nil {
				e = tx.Commit()
			} else {
				_ = tx.Rollback()
			}
			if e != nil {
				return changed, false, e
			}
			p.processedThrough = op.ItemID
			continue
		}
		if !mediaTagsEqual(op.Current, op.Want) {
			d, e := p.client.readItem(ctx, op.ItemID)
			if e != nil {
				return changed, false, e
			}
			if d.Stamp != op.Stamp || !mediaTagIdentityMatches(op, d, p.client.serverID) {
				return changed, true, ErrTagPreviewChanged
			}
			// Ownership is recorded only after a verified mutation. A lost
			// response remains conservatively external, never silently adopted.
			if !unchanged() {
				return changed, true, ErrTagPreviewChanged
			}
			if e = p.client.update(ctx, d, op.Want); e != nil {
				return changed, false, e
			}
			changed++
		}
		tx, e := s.DB.BeginTx(ctx, nil)
		if e != nil {
			return changed, false, e
		}
		for _, label := range op.Remove {
			if _, e = tx.ExecContext(ctx, `DELETE FROM media_tag_history WHERE service=? AND endpoint=? AND item_id=? AND label=?`, p.Preview.Service, p.Endpoint, op.ItemID, label); e != nil {
				break
			}
			if _, e = tx.ExecContext(ctx, `DELETE FROM media_tag_approvals WHERE service=? AND endpoint=? AND item_id=? AND label=?`, p.Preview.Service, p.Endpoint, op.ItemID, label); e != nil {
				break
			}
		}
		if e == nil {
			for label := range op.History {
				if _, present := op.Current[label]; !present {
					if _, wanted := op.Desired[label]; !wanted {
						_, e = tx.ExecContext(ctx, `DELETE FROM media_tag_history WHERE service=? AND endpoint=? AND item_id=? AND label=?`, p.Preview.Service, p.Endpoint, op.ItemID, label)
						if e != nil {
							break
						}
					}
				}
			}
		}
		if e == nil {
			for label, groups := range op.Desired {
				h := op.History[label]
				owned := h.Owned
				if _, present := op.Current[label]; !present {
					owned = true
				}
				if _, e = tx.ExecContext(ctx, `INSERT INTO media_tag_history VALUES(?,?,?,?,?,?) ON CONFLICT(service,endpoint,item_id,label) DO UPDATE SET groups=excluded.groups,owned=MAX(media_tag_history.owned,excluded.owned)`, p.Preview.Service, p.Endpoint, op.ItemID, label, groups, owned); e != nil {
					break
				}
			}
		}
		if e == nil {
			identities, _ := json.Marshal(op.Identities)
			_, e = tx.ExecContext(ctx, `INSERT INTO media_tag_targets VALUES(?,?,?,?,?) ON CONFLICT(service,endpoint,item_id) DO UPDATE SET title=excluded.title,identities=excluded.identities`, p.Preview.Service, p.Endpoint, op.ItemID, op.Title, string(identities))
		}
		if e == nil {
			e = tx.Commit()
		} else {
			_ = tx.Rollback()
		}
		if e != nil {
			return changed, false, e
		}
		p.processedThrough = op.ItemID
	}
	return changed, false, nil
}

func (s *Store) saveMediaTagStates(ctx context.Context, p *MediaTagPlan) error {
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	for field, state := range p.states {
		if _, e = tx.ExecContext(ctx, `INSERT INTO media_tag_policy VALUES(?,?,?,?) ON CONFLICT(service,endpoint,field) DO UPDATE SET state=excluded.state`, p.Preview.Service, p.Endpoint, field, state); e != nil {
			return e
		}
	}
	if e = tx.Commit(); e != nil {
		return e
	}
	return nil
}

func (s *Store) ReconcileMediaTags(ctx context.Context, cfg Settings, id string, c ServiceConfig, unchanged func() bool) (int, bool, error) {
	if e := s.mediaTagTables(ctx); e != nil {
		return 0, false, e
	}
	cleanup, e := s.mediaTagCleanupPending(ctx, id, c)
	if e != nil {
		return 0, false, e
	}
	if !c.TagSync.Active() && !cleanup {
		p, e := s.BuildMediaTagPlan(ctx, id, c, nil, cfg)
		if e != nil {
			return 0, false, e
		}
		return s.ExecuteMediaTagPlan(ctx, p, unchanged)
	}
	signature, e := s.mediaTagCursorSignature(ctx, cfg, id, c)
	if e != nil {
		return 0, false, e
	}
	key := "mediaTagCursor:" + id
	var cursor mediaTagCursor
	if s.Get(key, &cursor) != nil || cursor.Signature != signature {
		cursor = mediaTagCursor{Signature: signature}
	}
	if cursor.After == "" {
		cursor.Revision = s.mediaTagContentRevision()
	}
	window, e := s.mediaTagNextWindow(ctx, cfg, id, c, cursor.After)
	if e != nil {
		return 0, false, e
	}
	if cursor.After != "" && window.Through == "" {
		pending, e := s.completeMediaTagPass(key, cursor, false)
		return 0, pending, e
	}
	p, e := s.buildMediaTagPlan(ctx, id, c, nil, window, cfg)
	if e != nil {
		return 0, false, e
	}
	changed, waiting, e := s.ExecuteMediaTagPlan(ctx, p, unchanged)
	if e != nil || waiting && !p.Waiting {
		if p.processedThrough != "" {
			cursor.After = p.processedThrough
			if saveErr := s.Put(key, cursor); saveErr != nil {
				return changed, true, saveErr
			}
		}
		return changed, waiting, e
	}
	if window.More {
		cursor.After = window.Through
		if e = s.Put(key, cursor); e != nil {
			return changed, true, e
		}
		return changed, true, nil
	}
	pending, e := s.completeMediaTagPass(key, cursor, p.Waiting)
	return changed, pending, e
}

func (s *Store) mediaTagContentRevision() string {
	var revision string
	_ = s.Get("cacheRevision", &revision)
	return revision + "\x00" + s.RecognitionRevision()
}

func (s *Store) completeMediaTagPass(key string, cursor mediaTagCursor, waiting bool) (bool, error) {
	// Content changes are soft dirtiness: finish the bounded pass so frequent
	// library syncs cannot starve its tail, then revisit earlier targets.
	current := s.mediaTagContentRevision()
	if current != cursor.Revision {
		cursor.After = ""
		cursor.Revision = current
		return true, s.Put(key, cursor)
	}
	return waiting, s.Put(key, mediaTagCursor{})
}

func (s *Store) effectiveMediaTagStates(ctx context.Context, id string, c ServiceConfig) (map[string]string, error) {
	states := map[string]string{}
	rows, e := s.DB.QueryContext(ctx, `SELECT field,state FROM media_tag_policy WHERE service=? AND endpoint=?`, id, tagEndpoint(c))
	if e != nil {
		return nil, e
	}
	for rows.Next() {
		var field, state string
		if e = rows.Scan(&field, &state); e != nil {
			break
		}
		states[field] = state
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		return nil, e
	}
	for field, on := range c.TagSync.fields() {
		if on {
			states[field] = "active"
		} else if states[field] == "active" {
			states[field] = c.TagSyncDisable
			if states[field] == "" {
				states[field] = "delete"
			}
		}
	}
	return states, nil
}

func (s *Store) mediaTagCleanupPending(ctx context.Context, id string, c ServiceConfig) (bool, error) {
	if c.TagSync.Active() {
		return false, nil
	}
	states, e := s.effectiveMediaTagStates(ctx, id, c)
	if e != nil {
		return false, e
	}
	mask := uint16(0)
	for field, state := range states {
		if state == "delete" {
			mask |= mediaTagBit(field)
		}
	}
	if mask == 0 {
		return false, nil
	}
	var pending bool
	e = s.DB.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM media_tag_history WHERE service=? AND endpoint=? AND (groups & ?)<>0)`, id, tagEndpoint(c), mask).Scan(&pending)
	return pending, e
}

func (s *Store) mediaTagCursorSignature(ctx context.Context, cfg Settings, id string, c ServiceConfig) (string, error) {
	states, e := s.effectiveMediaTagStates(ctx, id, c)
	if e != nil {
		return "", e
	}
	type sourceStamp struct {
		ID, Endpoint string
		Enabled      bool
	}
	sourceStamps := []sourceStamp{}
	for _, source := range cfg.ArrInstances() {
		sourceStamps = append(sourceStamps, sourceStamp{source.ID, tagEndpoint(source), source.Enabled})
	}
	sort.Slice(sourceStamps, func(i, j int) bool { return sourceStamps[i].ID < sourceStamps[j].ID })
	b, _ := json.Marshal(struct {
		ID, Endpoint, Mode, Disable, Sources string
		Enabled                              bool
		Groups                               TagGroups
		SourceStamps                         []sourceStamp
		States                               map[string]string
	}{id, tagEndpoint(c), tagMode(c), c.TagSyncDisable, c.SourceIDs, c.Enabled, c.TagSync, sourceStamps, states})
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:]), nil
}

func (s *Store) mediaTagNextWindow(ctx context.Context, cfg Settings, id string, c ServiceConfig, after string) (mediaTagWindow, error) {
	query := `SELECT item_id FROM media_tag_targets WHERE service=? AND endpoint=? AND item_id>?`
	args := []any{id, tagEndpoint(c), after}
	selected := []string{}
	for _, source := range cfg.ArrInstances() {
		if source.Enabled && mediaTagSourceSelected(c, source.ID) {
			selected = append(selected, source.ID)
		}
	}
	if len(selected) > 0 {
		placeholders := make([]string, len(selected))
		for i := range placeholders {
			placeholders[i] = "?"
		}
		path := `$.mediaServers."` + id + `".itemId`
		query += ` UNION SELECT json_extract(data,?) AS item_id FROM files WHERE service IN (` + strings.Join(placeholders, ",") + `) AND json_extract(data,?)>?`
		args = append(args, path)
		for _, source := range selected {
			args = append(args, source)
		}
		args = append(args, path, after)
	}
	query += ` ORDER BY item_id LIMIT 1001`
	rows, e := s.DB.QueryContext(ctx, query, args...)
	if e != nil {
		return mediaTagWindow{}, e
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var item string
		if e = rows.Scan(&item); e != nil {
			return mediaTagWindow{}, e
		}
		ids = append(ids, item)
	}
	if e = rows.Err(); e != nil {
		return mediaTagWindow{}, e
	}
	window := mediaTagWindow{After: after}
	if len(ids) > 1000 {
		window.More = true
		ids = ids[:1000]
	}
	if len(ids) > 0 {
		window.Through = ids[len(ids)-1]
	}
	return window, nil
}
