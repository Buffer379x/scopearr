package app

import (
	"context"
	"encoding/json"
	"maps"
	"time"
)

type mediaSyncUpdate struct {
	id         string
	status     SyncStatus
	counts     map[string]int
	generation int
}

// Called under the Syncer mutex after the Arr snapshot's final outcome is known.
// Failed snapshots never publish new match counts or success dates.
func (m *Syncer) finishMediaLocked(service string, matched map[string]int, failures map[string]string, success bool) []mediaSyncUpdate {
	updates := []mediaSyncUpdate{}
	for id, sources := range m.mediaSources {
		if !sources[service] {
			continue
		}
		status := m.status[id]
		if reason := failures[id]; reason != "" {
			status.Error = reason
		}
		if n, ok := matched[id]; success && ok {
			if m.mediaCounts[id] == nil {
				m.mediaCounts[id] = map[string]int{}
			}
			m.mediaCounts[id][service] = n
			now := time.Now().UTC()
			status.LastSuccess = &now
			status.Error = ""
			status.Count = 0
			for source, count := range m.mediaCounts[id] {
				if sources[source] {
					status.Count += count
				}
			}
		}
		m.status[id] = status
		m.generation[id]++
		updates = append(updates, mediaSyncUpdate{id, status, maps.Clone(m.mediaCounts[id]), m.generation[id]})
	}
	return updates
}
func (m *Syncer) persistMedia(ctx context.Context, u mediaSyncUpdate) error {
	raw, e := json.Marshal(u.status)
	if e != nil {
		return e
	}
	counts, e := json.Marshal(u.counts)
	if e != nil {
		return e
	}
	tx, e := m.store.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	for key, value := range map[string][]byte{"sync:" + u.id: raw, "media-match:" + u.id: counts} {
		if _, e = tx.ExecContext(ctx, "INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, string(value)); e != nil {
			return e
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.generation[u.id] != u.generation {
		return context.Canceled
	}
	return tx.Commit()
}

// Refresh the provider/source relation after settings change, including removals.
// Counts and dates retain their last successful values until the next match.
func (m *Syncer) ConfigureMedia(cfg Settings) {
	sources := map[string]map[string]bool{}
	for _, arr := range cfg.ArrInstances() {
		if !arr.Enabled {
			continue
		}
		for _, media := range cfg.MediaInstancesFor(arr.ID) {
			if !media.Enabled {
				continue
			}
			if sources[media.ID] == nil {
				sources[media.ID] = map[string]bool{}
			}
			sources[media.ID][arr.ID] = true
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.mediaSources = sources
	for id, configured := range sources {
		st := m.status[id]
		st.Count = 0
		for source, count := range m.mediaCounts[id] {
			if configured[source] {
				st.Count += count
			}
		}
		m.status[id] = st
	}
}
