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
	AfterSync  func(string)
	AfterStop  func()
	store      *Store
	mu         sync.Mutex
	status     map[string]SyncStatus
	cancels    map[string]context.CancelFunc
	generation map[string]int
	wg         sync.WaitGroup
	stopped    bool
	gate       chan struct{}
}

func NewSyncer(s *Store) *Syncer {
	m := &Syncer{store: s, status: map[string]SyncStatus{}, cancels: map[string]context.CancelFunc{}, generation: map[string]int{}, gate: make(chan struct{}, 1)}
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
	return m
}
func (m *Syncer) Statuses() map[string]SyncStatus {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := map[string]SyncStatus{}
	for k, v := range m.status {
		out[k] = v
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
					break
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
		m.mu.Unlock()
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
