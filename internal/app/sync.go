package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"runtime/debug"
	"sync"
	"time"
)

type Syncer struct {
	mediaSources map[string]map[string]bool
	mediaCounts  map[string]map[string]int
	AfterSync    func(string)
	AfterStop    func()
	store        *Store
	mu           sync.Mutex
	status       map[string]SyncStatus
	cancels      map[string]context.CancelFunc
	generation   map[string]int
	wg           sync.WaitGroup
	stopped      bool
	gate         chan struct{}
}

func NewSyncer(s *Store) *Syncer {
	m := &Syncer{mediaSources: map[string]map[string]bool{}, mediaCounts: map[string]map[string]int{}, store: s, status: map[string]SyncStatus{}, cancels: map[string]context.CancelFunc{}, generation: map[string]int{}, gate: make(chan struct{}, 1)}
	var settings Settings
	_ = s.Get("settings", &settings)
	for _, connection := range settings.ArrInstances() {
		service := connection.ID
		var status SyncStatus
		s.Get("sync:"+service, &status)
		if status.Running {
			status.Error = "Sync durch Neustart unterbrochen"
		}
		status.Running = false
		status.Queued = false
		m.status[service] = status
	}
	for _, arr := range settings.ArrInstances() {
		for _, media := range settings.MediaInstancesFor(arr.ID) {
			if !media.Enabled {
				continue
			}
			if m.mediaSources[media.ID] == nil {
				m.mediaSources[media.ID] = map[string]bool{}
				var st SyncStatus
				_ = s.Get("sync:"+media.ID, &st)
				st.Running = false
				st.Queued = false
				m.status[media.ID] = st
				var counts map[string]int
				_ = s.Get("media-match:"+media.ID, &counts)
				m.mediaCounts[media.ID] = counts
			}
			m.mediaSources[media.ID][arr.ID] = true
		}
	}
	return m
}
func (m *Syncer) Statuses() map[string]SyncStatus {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := map[string]SyncStatus{}
	for k, v := range m.status {
		out[k] = v
	}
	for id, sources := range m.mediaSources {
		st := out[id]
		st.Running = false
		st.Queued = false
		for source := range sources {
			arr := m.status[source]
			st.Running = st.Running || arr.Running
			st.Queued = st.Queued || arr.Queued
			if arr.LastAttempt != nil && (st.LastAttempt == nil || arr.LastAttempt.After(*st.LastAttempt)) {
				st.LastAttempt = arr.LastAttempt
			}
		}
		out[id] = st
	}
	return out
}
func (m *Syncer) Invalidate(service string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.generation[service]++
	if cancel := m.cancels[service]; cancel != nil {
		cancel()
	}
	st := m.status[service]
	st.Running = false
	st.Queued = false
	m.status[service] = st
}
func (m *Syncer) Start(parent context.Context, service string, c ServiceConfig, supplemental ...ServiceConfig) error {
	if !serviceOK(service) || !c.Enabled {
		return errors.New("Service is not enabled")
	}
	m.mu.Lock()
	if m.stopped || parent.Err() != nil {
		m.mu.Unlock()
		return errors.New("App is shutting down")
	}
	if m.status[service].Running {
		m.mu.Unlock()
		return errors.New("Sync already running")
	}
	for i := range supplemental {
		if !supplemental[i].Enabled {
			continue
		}
		id := supplemental[i].ID
		if id == "" {
			id = "emby"
			if i == 1 || supplemental[i].Type == "jellyfin" {
				id = "jellyfin"
			}
			supplemental[i].ID = id
		}
		if m.mediaSources[id] == nil {
			m.mediaSources[id] = map[string]bool{}
		}
		m.mediaSources[id][service] = true
	}
	now := time.Now().UTC()
	st := m.status[service]
	st.Running = true
	st.Queued = true
	st.LastAttempt = &now
	st.Error = ""
	m.status[service] = st
	gen := m.generation[service]
	ctx, cancel := context.WithCancel(parent)
	m.cancels[service] = cancel
	m.wg.Add(1)
	m.mu.Unlock()
	go func() {
		defer m.wg.Done()
		defer cancel()
		var files []File
		matched := map[string]int{}
		mediaFailures := map[string]string{}
		var err error
		select {
		case m.gate <- struct{}{}:
			defer func() { <-m.gate }()
			err = ctx.Err()
		case <-ctx.Done():
			err = ctx.Err()
		}
		if err == nil {
			_ = m.persistStatus(ctx, service, st, gen)
			m.mu.Lock()
			if gen != m.generation[service] {
				m.mu.Unlock()
				return
			}
			st := m.status[service]
			st.Queued = false
			m.status[service] = st
			m.mu.Unlock()
			// Return released pages from the previous service before fetching another snapshot.
			debug.FreeOSMemory()
			files, err = NewArr(c).Fetch(ctx, service)
			if err == nil && len(files) >= 10000 {
				shareSnapshotAPIInfo(files)
			}
			if len(files) >= 10000 {
				debug.FreeOSMemory()
			}
		}
		if err == nil {
			for i, config := range supplemental {
				if !config.Enabled {
					continue
				}
				client := NewEmby(config)
				if serviceKind(config.ID) == "jellyfin" || config.ID == "" && i == 1 {
					client = NewJellyfin(config)
				}
				if err = client.Enrich(ctx, service, files); err != nil {
					err = errors.New(client.label() + " enrichment failed: " + err.Error())
					mediaFailures[client.instance] = err.Error()
					break
				}
				matched[client.instance] = 0
				for _, file := range files {
					if value := file.MediaServers.get(client.instance); value != nil && (value.Status == "matched" || value.Status == "no_tracks") {
						matched[client.instance]++
					}
				}
				if len(files) >= 10000 {
					shareSnapshotAPIInfo(files)
					// Provider candidate indexes are no longer live. Return their
					// backing pages before building another provider's indexes.
					debug.FreeOSMemory()
				}
			}
		}
		// Arr catalog indexes and Emby candidate maps are no longer needed.
		// Reclaim their backing pages before SQLite starts a large transaction.
		if len(files) >= 10000 {
			debug.FreeOSMemory()
		}
		if err == nil {
			err = ctx.Err()
		}
		m.mu.Lock()
		if gen != m.generation[service] {
			m.mu.Unlock()
			return
		}
		st := m.status[service]
		m.mu.Unlock()
		st.Running = false
		st.Queued = false
		if err == nil {
			now := time.Now().UTC()
			st.LastSuccess = &now
			st.Source = tagEndpoint(c)
			st.Count = len(files)
			st.Error = ""
			// Only the final commit needs to exclude invalidation. Database work
			// remains cancellable, and status readers stay responsive.
			err = m.store.replaceContext(ctx, service, files, st, true, nil, func(tx *sql.Tx) error {
				m.mu.Lock()
				defer m.mu.Unlock()
				if gen != m.generation[service] {
					return context.Canceled
				}
				if err := ctx.Err(); err != nil {
					return err
				}
				return tx.Commit()
			})
			if err != nil {
				st.Error = "Cache konnte nicht gespeichert werden"
			}
		} else {
			st.Error = err.Error()
		}
		files = nil
		debug.FreeOSMemory()
		m.mu.Lock()
		if gen != m.generation[service] {
			m.mu.Unlock()
			return
		}
		if err != nil {
			previous := m.status[service]
			st.LastSuccess, st.Source, st.Count = previous.LastSuccess, previous.Source, previous.Count
		}
		m.status[service] = st
		delete(m.cancels, service)
		mediaUpdates := m.finishMediaLocked(service, matched, mediaFailures, err == nil)
		m.mu.Unlock()
		if err == nil {
			m.store.Events.Info("sync", service, "Sync completed · {count} files in {seconds} s", map[string]any{"count": st.Count, "seconds": int(time.Since(now).Seconds())}, "")
		} else if !errors.Is(err, context.Canceled) {
			m.store.Events.Error("sync", service, "Sync failed", nil, "", err.Error())
		}
		for media, failure := range mediaFailures {
			m.store.Events.Error("media", media, "Media server matching failed", nil, "", failure)
		}
		for media, n := range matched {
			if mediaFailures[media] == "" {
				m.store.Events.Info("media", media, "Media server matching completed · {count} files matched", map[string]any{"count": n}, "")
			}
		}
		for _, update := range mediaUpdates {
			statusCtx, finish := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			_ = m.persistMedia(statusCtx, update)
			finish()
		}
		if err != nil {
			statusCtx, cancelStatus := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			_ = m.persistStatus(statusCtx, service, st, gen)
			cancelStatus()
		}
		if err == nil && m.AfterSync != nil {
			m.AfterSync(service)
		}
	}()
	return nil
}

func (m *Syncer) persistStatus(ctx context.Context, service string, status SyncStatus, generation int) error {
	raw, err := json.Marshal(status)
	if err != nil {
		return err
	}
	tx, err := m.store.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", "sync:"+service, string(raw)); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if generation != m.generation[service] {
		return context.Canceled
	}
	return tx.Commit()
}
func (m *Syncer) Shutdown() {
	m.mu.Lock()
	m.stopped = true
	for _, cancel := range m.cancels {
		cancel()
	}
	m.mu.Unlock()
	m.wg.Wait()
	if m.AfterStop != nil {
		m.AfterStop()
	}
}
func (m *Syncer) Schedule(ctx context.Context, dispatch func()) {
	tick := time.NewTicker(15 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			dispatch()
		}
	}
}
