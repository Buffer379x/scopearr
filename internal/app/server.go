package app

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"maps"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

type Server struct {
	Placement    *PlacementManager
	FileCheck    *FileCheckManager
	fileWork     fileWorkLock
	Mux          *MuxManager
	Background   *Background
	Webhooks     *WebhookManager
	Tags         *TagWriter
	Store        *Store
	Security     *Security
	Sync         *Syncer
	mu           sync.Mutex
	settingsMu   sync.Mutex
	renameMu     sync.Mutex
	testRenameFS *renameFS
	settings     Settings
	ctx          context.Context
	Static       fs.FS
	Demo         bool
	Version      string
}

func NewServer(ctx context.Context, store *Store, static fs.FS, version string) (*Server, error) {
	sec, e := NewSecurity(store)
	if e != nil {
		return nil, e
	}
	s := &Server{Store: store, Security: sec, Sync: NewSyncer(store), settings: DefaultSettings(), ctx: ctx, Static: static, Version: version}
	store.Events.Start(ctx)
	var cfg Settings
	migratedInstances := false
	e = store.Get("settings", &cfg)
	if e != nil && !errors.Is(e, sql.ErrNoRows) {
		return nil, fmt.Errorf("Could not load settings: %w", e)
	}
	if e == nil {
		legacyMux := cfg.MuxColumnOrder == nil || cfg.MuxVisibleColumns == nil
		for _, value := range cfg.Mux.PathMappings {
			if cfg.Mux.Mappings == "" && strings.TrimSpace(value) != "" {
				legacyMux = true
			}
		}
		legacyInstances := cfg.Instances == nil
		migratedInstances = legacyInstances
		legacyInfo := cfg.ListInfoOrder == nil || (cfg.MuxInfo == nil && !containsColumn(cfg.ListInfoOrder, "mux")) || (cfg.ColumnOrder != nil && !containsColumn(cfg.ColumnOrder["radarr"], "processing")) || (cfg.ColumnOrder != nil && !containsColumn(cfg.ColumnOrder["sonarr"], "processing"))
		encryptedKeys := map[string]string{}
		for i, connection := range cfg.Connections() {
			id := connection.ID
			if id == "" {
				id = []string{"radarr", "sonarr", "emby", "jellyfin"}[i]
			}
			encryptedKeys[id] = connection.APIKey
			connection.APIKey, e = sec.Open(connection.APIKey)
			if e != nil {
				return nil, e
			}
		}
		if legacyInstances {
			cfg.Instances = cfg.AllInstances()
		}
		if e := normalizeSettings(&cfg); e != nil {
			return nil, e
		}
		if e := normalizeMux(&cfg); e != nil {
			return nil, e
		}
		if e := normalizeUnraid(&cfg); e != nil {
			return nil, e
		}
		if e := normalizeFileCheck(&cfg); e != nil {
			return nil, e
		}
		if e := normalizeInterfaceTheme(&cfg); e != nil {
			return nil, e
		}
		if cfg.TagColors == nil {
			cfg.TagColors = map[string]string{}
		}
		if e := normalizeTagTextColors(&cfg); e != nil {
			return nil, e
		}
		if e := normalizeWarningColors(&cfg); e != nil {
			return nil, e
		}
		if e := normalizeVisibleColumns(&cfg); e != nil {
			return nil, e
		}
		if legacyInfo || legacyInstances || legacyMux {
			// Persist the additive layout upgrade once; a pre-upgrade backup also
			// allows older versions to restore their supported column settings.
			if e := store.Backup(); e != nil {
				return nil, e
			}
			persisted := cfg
			persisted.Instances = append([]ServiceConfig{}, cfg.Instances...)
			for i, connection := range persisted.Connections() {
				id := connection.ID
				if id == "" {
					id = []string{"radarr", "sonarr", "emby", "jellyfin"}[i]
				}
				connection.APIKey = encryptedKeys[id]
			}
			persisted.mirrorLegacy()
			if e := store.Put("settings", persisted); e != nil {
				return nil, e
			}
		}
		s.settings = cfg
	}
	s.Mux = NewMuxManager(s)
	s.Placement = NewPlacementManager(s)
	s.FileCheck = NewFileCheckManager(s)
	s.Background = NewBackground(s)
	s.Webhooks = NewWebhookManager(s)
	s.Tags = NewTagWriter(ctx, store, s.Config, s.Sync.gate)
	s.Sync.AfterSync = s.afterLibrarySync
	s.Sync.AfterStop = s.Tags.Close
	if migratedInstances && s.Config().enabledMedia() {
		cfg := s.Config()
		for _, c := range cfg.ArrInstances() {
			if c.Enabled {
				s.Sync.Start(ctx, c.ID, c, cfg.MediaInstancesFor(c.ID)...)
			}
		}
	}
	go s.Sync.Schedule(ctx, s.scheduleDue)
	return s, nil
}
func (s *Server) Config() Settings {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := s.settings
	out.Unraid.ShareDirs = maps.Clone(s.settings.Unraid.ShareDirs)
	out.Unraid.Libraries = append([]string{}, s.settings.Unraid.Libraries...)
	out.Unraid.ExcludedDisks = append([]string{}, s.settings.Unraid.ExcludedDisks...)
	out.Mux.PathMappings = map[string]string{}
	for k, v := range s.settings.Mux.PathMappings {
		out.Mux.PathMappings[k] = v
	}
	if out.Instances != nil {
		out.Instances = append([]ServiceConfig{}, out.Instances...)
	}
	return out
}

// Keep configuration selection and sync dispatch under the same lock as updates.
func (s *Server) scheduleDue() {
	s.settingsMu.Lock()
	defer s.settingsMu.Unlock()
	cfg := s.Config()
	statuses := s.Sync.Statuses()
	for _, connection := range cfg.ArrInstances() {
		service := connection.ID
		st := statuses[service]
		if !connection.Enabled || connection.Interval == 0 || st.Running {
			continue
		}
		if st.LastAttempt == nil || syncDue(time.Now(), st.LastAttempt, connection, cfg.SyncTimezone) {
			s.Sync.Start(s.ctx, service, connection, cfg.MediaInstancesFor(service)...)
		}
	}
}
func jsonOut(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
func failure(w http.ResponseWriter, r *http.Request, status int, e error) {
	jsonOut(w, status, map[string]string{"error": localizedMessage(requestLocale(r), e.Error())})
}
func decode(w http.ResponseWriter, r *http.Request, v any) error { return decodeLimit(w, r, v, 64<<10) }
func decodeLimit(w http.ResponseWriter, r *http.Request, v any, limit int64) error {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		return errors.New("Invalid input")
	}
	var x any
	if d.Decode(&x) != io.EOF {
		return errors.New("Invalid input")
	}
	return nil
}
func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
		if r.URL.Path == "/api/webhooks/arr" {
			s.webhookHTTP(w, r)
			return
		}
		if r.URL.Path == "/healthz" {
			jsonOut(w, http.StatusOK, map[string]string{"status": "ok", "version": s.Version})
			return
		}
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			if r.Method != http.MethodGet && r.Method != http.MethodHead {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
				return
			}
			if s.Static == nil {
				http.NotFound(w, r)
				return
			}
			path := strings.TrimPrefix(r.URL.Path, "/")
			if path == "" {
				path = "index.html"
			}
			if _, e := fs.Stat(s.Static, path); e != nil {
				http.NotFound(w, r)
				return
			}
			http.FileServer(http.FS(s.Static)).ServeHTTP(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		mutating := r.Method != "GET" && r.Method != "HEAD"
		if mutating {
			if origin := r.Header.Get("Origin"); origin != "" {
				u, e := url.Parse(origin)
				if e != nil || u.Host != r.Host {
					failure(w, r, http.StatusForbidden, errors.New("Invalid origin"))
					return
				}
			}
		}
		session, sessionErr := s.Security.readSession(r)
		if sessionErr != nil {
			failure(w, r, http.StatusServiceUnavailable, errors.New("Session check failed, try again"))
			return
		}
		hash, csrf, authenticated := session.hash, session.csrf, session.valid
		if authenticated {
			s.Security.renewSession(w, r, session)
		}
		if r.URL.Path == "/api/status" && r.Method == "GET" {
			out := map[string]any{"initialized": s.Security.Initialized(), "authenticated": authenticated, "version": s.Version, "demo": s.Demo}
			if authenticated {
				out["csrf"] = csrf
				states := s.Sync.Statuses()
				for service, state := range states {
					state.Error = localizedMessage(requestLocale(r), state.Error)
					states[service] = state
				}
				out["sync"] = states
				serviceNames := map[string]string{}
				for _, c := range s.Config().AllInstances() {
					serviceNames[c.ID] = instanceLabel(c)
				}
				out["serviceNames"] = serviceNames
				out["tagSync"] = s.Tags.Statuses()
				out["mux"] = s.Mux.status()
				placementJobs := s.openFileJobs("placement_items")
				placementJobs["enabled"] = s.Config().Unraid.Enabled
				out["unraid"] = placementJobs
				fileJobs := s.openFileJobs("filecheck_items")
				fileJobs["available"] = fileCheckPrerequisite(s.Config()) == nil
				out["files"] = fileJobs
				out["recognitionRevision"] = s.Store.RecognitionRevision()
				out["releaseCheck"] = s.Background.ReleaseStatus()
				var revision string
				s.Store.Get("cacheRevision", &revision)
				out["cacheRevision"] = revision
				out["webhook"] = s.Webhooks.Statuses()
				cfg := s.Config()
				out["webhooksEnabled"] = false
				for _, c := range cfg.ArrInstances() {
					if c.Enabled && c.WebhookEnabled {
						out["webhooksEnabled"] = true
					}
				}
				next := map[string]*time.Time{}
				for _, c := range cfg.ArrInstances() {
					service := c.ID
					next[service] = nextSync(time.Now(), c, cfg.SyncTimezone)
				}
				out["nextSync"] = next
			}
			jsonOut(w, http.StatusOK, out)
			return
		}
		if (r.URL.Path == "/api/setup" || r.URL.Path == "/api/login") && r.Method == "POST" {
			var in struct {
				Username string `json:"username"`
				Password string `json:"password"`
				Token    string `json:"token"`
			}
			if e := decode(w, r, &in); e != nil {
				failure(w, r, http.StatusBadRequest, e)
				return
			}
			if r.URL.Path == "/api/setup" {
				if e := s.Security.Setup(in.Username, in.Password, in.Token); e != nil {
					failure(w, r, http.StatusBadRequest, e)
					return
				}
				if e := s.Security.CreateSession(w, r); e != nil {
					failure(w, r, http.StatusInternalServerError, errors.New("Could not create session"))
					return
				}
			} else {
				valid, err := s.Security.LoginSession(w, r, in.Username, in.Password, remoteIP(r))
				if err != nil {
					failure(w, r, http.StatusInternalServerError, errors.New("Could not create session"))
					return
				}
				if !valid {
					s.Store.Events.Warning("auth", "", "Sign-in failed from {ip}", map[string]any{"ip": remoteIP(r)}, in.Username, "")
					failure(w, r, http.StatusUnauthorized, errors.New("Login failed or temporarily locked"))
					return
				}
				s.Store.Events.Info("auth", "", "Signed in from {ip}", map[string]any{"ip": remoteIP(r)}, in.Username)
			}
			jsonOut(w, http.StatusOK, map[string]bool{"ok": true})
			return
		}
		if !authenticated {
			failure(w, r, http.StatusUnauthorized, errors.New("Please sign in"))
			return
		}
		if mutating && subtle.ConstantTimeCompare([]byte(r.Header.Get("X-CSRF-Token")), []byte(csrf)) != 1 {
			failure(w, r, http.StatusForbidden, errors.New("Invalid CSRF token"))
			return
		}
		if r.URL.Path == "/api/files/rename" || r.URL.Path == "/api/files/rename/preview" {
			s.renameHTTP(w, r)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/unraid/") {
			s.unraidHTTP(w, r)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/filecheck/") {
			s.fileCheckHTTP(w, r)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/placement/") {
			s.placementHTTP(w, r)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/mux/") {
			s.muxHTTP(w, r)
			return
		}
		switch r.URL.Path {
		case "/api/storage":
			if r.Method != "GET" {
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			s.storageHTTP(w, r)
			return
		case "/api/storage/refresh":
			if r.Method != "POST" {
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			s.storageRefreshHTTP(w, r)
			return
		case "/api/webhook-credentials":
			if r.Method != "POST" {
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			s.webhookCredentialsHTTP(w, r)
			return
		case "/api/logout":
			if r.Method != "POST" {
				break
			}
			if _, err := s.Store.DB.ExecContext(r.Context(), "DELETE FROM sessions WHERE token=?", hash); err != nil {
				failure(w, r, http.StatusInternalServerError, errors.New("Could not revoke session"))
				return
			}
			http.SetCookie(w, &http.Cookie{Name: "scopearr_session", Value: "", Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: -1})
			jsonOut(w, http.StatusOK, map[string]bool{"ok": true})
			return

		case "/api/custom-tags/batch":
			s.customTagsBatchHTTP(w, r)
			return
		case "/api/custom-tags":
			s.customTagsHTTP(w, r)
			return
		case "/api/custom-selection":
			s.customSelectionHTTP(w, r)
			return
		case "/api/recognition", "/api/recognition/defaults", "/api/recognition/preview":
			s.recognitionHTTP(w, r)
			return
		case "/api/tag-catalog":
			s.tagCatalogHTTP(w, r)
			return
		case "/api/tag-presentation":
			s.tagPresentationHTTP(w, r)
			return
		case "/api/display-tags":
			s.displayTagsHTTP(w, r)
			return
		case "/api/tag-preview", "/api/tag-approval":
			s.tagPreviewHTTP(w, r)
			return
		case "/api/settings":
			s.settingsHTTP(w, r)
			return
		case "/api/tag-import":
			s.tagImportHTTP(w, r)
			return
		case "/api/test":
			s.testConnectionHTTP(w, r)
			return
		case "/api/sync":
			s.syncHTTP(w, r)
			return
		case "/api/open-entry":
			s.openEntry(w, r)
			return
		case "/api/files":
			s.filesHTTP(w, r)
			return
		case "/api/statistics":
			s.statisticsHTTP(w, r)
			return
		case "/api/facets":
			s.facetsHTTP(w, r)
			return
		case "/api/export":
			if r.Method != "GET" {
				break
			}
			s.export(w, r)
			return
		case "/api/events", "/api/events/export":
			s.eventsHTTP(w, r)
			return
		case "/api/presets":
			s.presetsHTTP(w, r)
			return
		case "/api/password":
			s.passwordHTTP(w, r)
			return
		case "/api/backup":
			if r.Method != "POST" {
				break
			}
			if e := s.Store.Backup(); e != nil {
				s.Store.Events.Error("system", "", "Backup failed", nil, "", e.Error())
				failure(w, r, http.StatusInternalServerError, errors.New("Could not create backup"))
				return
			}
			s.Store.Events.Info("system", "", "Backup created", nil, "")
			jsonOut(w, http.StatusOK, map[string]bool{"ok": true})
			return
		}
		failure(w, r, http.StatusMethodNotAllowed, errors.New("Endpoint or method not supported"))
	})
}
func (s *Server) queueTagSync() {
	if s.Tags != nil {
		for _, c := range s.Config().AllInstances() {
			if c.Enabled {
				s.Tags.Queue(c.ID)
			}
		}
	}
}

func (s *Server) queueMediaTags() {
	if s.Tags == nil {
		return
	}
	for _, c := range s.Config().MediaInstances() {
		if c.Enabled {
			s.Tags.Queue(c.ID)
		}
	}
}

// Media tag delivery follows every successful file snapshot, independently of
// whether the Arr instance imports external tags only on explicit requests.
func (s *Server) afterLibrarySync(id string) {
	c := s.Config().GetService(id)
	if s.Tags != nil && !(c.TagImport && c.TagImportInterval == 0 && !c.TagSync.Active()) {
		s.Tags.Queue(id)
	}
	s.queueMediaTags()
}
