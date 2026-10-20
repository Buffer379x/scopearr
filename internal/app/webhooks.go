package app

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sort"
	"strconv"
	"sync"
	"time"
)

type WebhookJob struct {
	InternalMux bool      `json:"internalMux,omitempty"`
	Service     string    `json:"service"`
	MediaID     int       `json:"mediaId"`
	FileIDs     []int     `json:"fileIds"`
	All         bool      `json:"all"`
	Source      string    `json:"source"`
	Next        time.Time `json:"next"`
	Attempts    int       `json:"attempts"`
}
type WebhookStatus struct {
	LastReceived *time.Time `json:"lastReceived"`
	LastSuccess  *time.Time `json:"lastSuccess"`
	Error        string     `json:"error"`
	Pending      int        `json:"pending"`
}
type WebhookManager struct {
	s         *Server
	mu        sync.Mutex
	enqueueMu sync.Mutex
	states    map[string]WebhookStatus
	wg        sync.WaitGroup
	once      sync.Once
}

func NewWebhookManager(s *Server) *WebhookManager {
	m := &WebhookManager{s: s, states: map[string]WebhookStatus{}}
	for _, c := range s.Config().ArrInstances() {
		service := c.ID
		var st WebhookStatus
		s.Store.Get("webhook-status:"+service, &st)
		m.states[service] = st
	}
	return m
}
func (m *WebhookManager) Statuses() map[string]WebhookStatus {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := map[string]WebhookStatus{}
	for k, v := range m.states {
		m.s.Store.DB.QueryRow("SELECT count(*) FROM kv WHERE key LIKE ?", "webhook-job:"+k+":%").Scan(&v.Pending)
		out[k] = v
	}
	return out
}
func (m *WebhookManager) setStatus(service string, update func(*WebhookStatus)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	v := m.states[service]
	update(&v)
	m.states[service] = v
	m.s.Store.Put("webhook-status:"+service, v)
}
func (m *WebhookManager) key(service string, create bool) (string, error) {
	m.enqueueMu.Lock()
	defer m.enqueueMu.Unlock()
	var sealed string
	e := m.s.Store.Get("webhook-key:"+service, &sealed)
	if e == nil {
		return m.s.Security.Open(sealed)
	}
	if !errors.Is(e, sql.ErrNoRows) {
		return "", e
	}
	if !create {
		return "", errors.New("Webhook credentials are not configured")
	}
	bytes := make([]byte, 32)
	if _, e = rand.Read(bytes); e != nil {
		return "", e
	}
	key := base64.RawURLEncoding.EncodeToString(bytes)
	return key, m.s.Store.Put("webhook-key:"+service, m.s.Security.Seal(key))
}
func (s *Server) webhookCredentialsHTTP(w http.ResponseWriter, r *http.Request) {
	service := r.URL.Query().Get("service")
	if !serviceOK(service) || s.Demo {
		failure(w, r, http.StatusBadRequest, errors.New("Invalid service"))
		return
	}
	key, e := s.Webhooks.key(service, true)
	if e != nil {
		failure(w, r, http.StatusInternalServerError, errors.New("Could not create webhook credentials"))
		return
	}
	jsonOut(w, http.StatusOK, map[string]string{"username": service, "password": key, "endpoint": "/api/webhooks/arr?service=" + service})
}
func (s *Server) webhookHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != "POST" {
		w.Header().Set("Allow", "POST")
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	service := r.URL.Query().Get("service")
	if !serviceOK(service) || s.Demo {
		http.Error(w, "Webhook unavailable", http.StatusNotFound)
		return
	}
	cfg := s.Config()
	c := cfg.GetService(service)
	if !c.Enabled || !c.WebhookEnabled {
		http.Error(w, "Webhook unavailable", http.StatusNotFound)
		return
	}
	key, e := s.Webhooks.key(service, false)
	user, pass, ok := r.BasicAuth()
	if !ok {
		user = service
		pass = r.Header.Get("X-Scopearr-Webhook-Key")
	}
	if e != nil || user != service || len(pass) > 128 || subtle.ConstantTimeCompare([]byte(pass), []byte(key)) != 1 {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 256<<10)
	var payload struct {
		Event string `json:"eventType"`
		Movie struct {
			ID int `json:"id"`
		} `json:"movie"`
		Series struct {
			ID int `json:"id"`
		} `json:"series"`
		EpisodeFile struct {
			ID int `json:"id"`
		} `json:"episodeFile"`
		EpisodeFiles []struct {
			ID int `json:"id"`
		} `json:"episodeFiles"`
		DeletedFiles []struct {
			ID int `json:"id"`
		} `json:"deletedFiles"`
	}
	decoder := json.NewDecoder(r.Body)
	if e = decoder.Decode(&payload); e != nil {
		http.Error(w, "Invalid webhook payload", http.StatusBadRequest)
		return
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		http.Error(w, "Invalid webhook payload", http.StatusBadRequest)
		return
	}
	if payload.Event == "Test" {
		jsonOut(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	id := payload.Movie.ID
	if serviceKind(service) == "sonarr" {
		id = payload.Series.ID
	}
	all := false
	recognized := false
	switch payload.Event {
	case "Download":
		recognized = true
	case "MovieFileDelete", "MovieDelete":
		recognized = serviceKind(service) == "radarr"
	case "EpisodeFileDelete":
		recognized = serviceKind(service) == "sonarr"
	case "SeriesDelete":
		recognized = serviceKind(service) == "sonarr"
		all = true
	case "Rename":
		recognized = true
		all = true
	}
	if !recognized {
		jsonOut(w, http.StatusOK, map[string]bool{"ignored": true})
		return
	}
	if id <= 0 || (serviceKind(service) == "radarr" && payload.Series.ID != 0) || (serviceKind(service) == "sonarr" && payload.Movie.ID != 0) {
		http.Error(w, "Invalid media identity", http.StatusBadRequest)
		return
	}
	ids := map[int]bool{}
	if payload.EpisodeFile.ID > 0 {
		ids[payload.EpisodeFile.ID] = true
	}
	for _, f := range payload.EpisodeFiles {
		if f.ID > 0 {
			ids[f.ID] = true
		}
	}
	for _, f := range payload.DeletedFiles {
		if f.ID > 0 {
			ids[f.ID] = true
		}
	}
	if serviceKind(service) == "radarr" {
		all = true
	}
	if serviceKind(service) == "sonarr" && !all && len(ids) == 0 {
		http.Error(w, "Episode file identities are required", http.StatusBadRequest)
		return
	}
	if len(ids) > 512 {
		http.Error(w, "Too many file identities", http.StatusBadRequest)
		return
	}
	job := WebhookJob{Service: service, MediaID: id, All: all, Source: tagEndpoint(c), Next: time.Now().UTC().Add(2 * time.Second)}
	for fileID := range ids {
		job.FileIDs = append(job.FileIDs, fileID)
	}
	if e = s.Webhooks.Enqueue(job); e != nil {
		http.Error(w, "Webhook queue is full or unavailable; retry later", http.StatusServiceUnavailable)
		return
	}
	jsonOut(w, http.StatusAccepted, map[string]bool{"queued": true})
}
func jobKey(job WebhookJob) string {
	return "webhook-job:" + job.Service + ":" + strconv.Itoa(job.MediaID)
}
func (m *WebhookManager) Enqueue(job WebhookJob) error {
	m.enqueueMu.Lock()
	defer m.enqueueMu.Unlock()
	key := jobKey(job)
	var old WebhookJob
	if e := m.s.Store.Get(key, &old); e == nil && old.Source == job.Source {
		job.All = job.All || old.All
		ids := map[int]bool{}
		for _, id := range append(old.FileIDs, job.FileIDs...) {
			ids[id] = true
		}
		if len(ids) > 512 {
			return errors.New("Too many pending file identities")
		}
		job.FileIDs = nil
		for id := range ids {
			job.FileIDs = append(job.FileIDs, id)
		}
	} else {
		var count int
		if e := m.s.Store.DB.QueryRow("SELECT count(*) FROM kv WHERE key LIKE 'webhook-job:%'").Scan(&count); e != nil {
			return e
		}
		if count >= 256 {
			return errors.New("Queue is full")
		}
	}
	sort.Ints(job.FileIDs)
	if e := m.s.Store.Put(key, job); e != nil {
		return e
	}
	now := time.Now().UTC()
	m.setStatus(job.Service, func(st *WebhookStatus) { st.LastReceived = &now })
	return nil
}
func (m *WebhookManager) Start(ctx context.Context) {
	m.once.Do(func() {
		m.wg.Add(1)
		go func() {
			defer m.wg.Done()
			tick := time.NewTicker(time.Second)
			defer tick.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-tick.C:
					m.processOne(ctx)
				}
			}
		}()
	})
}
func (m *WebhookManager) processOne(ctx context.Context) {
	rows, e := m.s.Store.DB.QueryContext(ctx, "SELECT key,value FROM kv WHERE key LIKE 'webhook-job:%' ORDER BY key LIMIT 256")
	if e != nil {
		return
	}
	var key, raw string
	var job WebhookJob
	found := false
	for rows.Next() {
		var k, v string
		if rows.Scan(&k, &v) != nil {
			break
		}
		var candidate WebhookJob
		if json.Unmarshal([]byte(v), &candidate) == nil && !candidate.Next.After(time.Now()) {
			cfg := m.s.Config()
			c := cfg.GetService(candidate.Service)
			if c.Enabled && (c.WebhookEnabled || candidate.InternalMux) {
				key, raw, job, found = k, v, candidate, true
				break
			}
		}
	}
	rows.Close()
	if !found {
		return
	}
	select {
	case m.s.Sync.gate <- struct{}{}:
		defer func() { <-m.s.Sync.gate }()
	case <-ctx.Done():
		return
	}
	cfg := m.s.Config()
	c := cfg.GetService(job.Service)
	if !c.Enabled || (!c.WebhookEnabled && !job.InternalMux) {
		return
	}
	if tagEndpoint(c) != job.Source {
		m.s.Store.DB.Exec("DELETE FROM kv WHERE key=? AND value=?", key, raw)
		return
	}
	readCtx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	scope := &DeltaScope{MediaID: job.MediaID, FileIDs: job.FileIDs, All: job.All}
	files, e := NewArr(c).FetchDelta(readCtx, job.Service, scope)
	if e == nil {
		e = m.s.Store.preserveDeltaEmby(readCtx, job.Service, files, len(cfg.MediaInstancesFor(job.Service)) > 0)
	}
	// Settings updates and the commit share the same lock; obsolete endpoints never replace the cache.
	m.s.settingsMu.Lock()
	settings := m.s.Config()
	current := settings.GetService(job.Service)
	if (tagEndpoint(current) != job.Source || current.APIKey != c.APIKey) || !current.Enabled || (!current.WebhookEnabled && !job.InternalMux) {
		m.s.settingsMu.Unlock()
		return
	}
	if e == nil && readCtx.Err() == nil {
		e = m.s.Store.replaceContext(readCtx, job.Service, files, SyncStatus{}, true, scope, nil)
	} else if e == nil {
		e = readCtx.Err()
	}
	m.s.settingsMu.Unlock()
	var tagPolicyPending bool
	m.s.Store.Get("tagSyncDirty:"+job.Service, &tagPolicyPending)
	// A pending service-wide policy transition must finish before a targeted tag reconciliation.
	if e == nil && c.TagSync.Active() && !tagPolicyPending {
		_, _, e = m.s.Store.ReconcileTags(readCtx, job.Service, c, func() bool {
			fresh := m.s.Config()
			next := fresh.GetService(job.Service)
			return next == c
		}, job.MediaID)
	}
	if ctx.Err() != nil {
		return
	}
	now := time.Now().UTC()
	if e == nil {
		m.s.Store.DB.Exec("DELETE FROM kv WHERE key=? AND value=?", key, raw)
		m.s.queueMediaTags()
		m.setStatus(job.Service, func(st *WebhookStatus) { st.LastSuccess = &now; st.Error = "" })
		m.s.Sync.mu.Lock()
		st := m.s.Sync.status[job.Service]
		m.s.Store.DB.QueryRow("SELECT count(*) FROM files WHERE service=?", job.Service).Scan(&st.Count)
		m.s.Sync.status[job.Service] = st
		m.s.Sync.mu.Unlock()
	} else {
		job.Attempts++
		seconds := 30
		for i := 1; i < job.Attempts && seconds < 1800; i++ {
			seconds *= 2
		}
		if seconds > 1800 {
			seconds = 1800
		}
		job.Next = now.Add(time.Duration(seconds) * time.Second)
		updated, _ := json.Marshal(job)
		m.s.Store.DB.Exec("UPDATE kv SET value=? WHERE key=? AND value=?", string(updated), key, raw)
		m.setStatus(job.Service, func(st *WebhookStatus) { st.Error = e.Error() })
	}
}
