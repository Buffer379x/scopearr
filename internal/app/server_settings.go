package app

import (
	"context"
	"errors"
	"net/http"
	"reflect"
	"time"
)

func (s *Server) settingsHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		cfg := s.Config()
		cfg.Instances = cfg.AllInstances()
		for _, c := range cfg.Connections() {
			c.HasKey = c.APIKey != ""
			c.APIKey = ""
		}
		cfg.mirrorLegacy()
		jsonOut(w, http.StatusOK, cfg)
		return
	}
	if r.Method != "PUT" {
		failure(w, r, http.StatusMethodNotAllowed, errors.New("Endpoint or method not supported"))
		return
	}
	var in struct {
		Settings
		TagApprovals map[string]string `json:"tagApprovals"`
	}
	if e := decodeLimit(w, r, &in, 256<<10); e != nil {
		failure(w, r, http.StatusBadRequest, e)
		return
	}
	cfg := in.Settings

	for _, normalize := range []func(*Settings) error{normalizeSettings, normalizeMux, normalizeUnraid, normalizeFileCheck, normalizeInterfaceTheme, normalizeWarningColors, normalizeTagTextColors, normalizeVisibleColumns} {
		if e := normalize(&cfg); e != nil {
			failure(w, r, http.StatusBadRequest, e)
			return
		}
	}
	if e := validateTagColors(cfg.TagColors); e != nil {
		failure(w, r, http.StatusBadRequest, e)
		return
	}
	if cfg.TagColors == nil {
		cfg.TagColors = map[string]string{}
	}
	if cfg.SeasonMode != "matches" && cfg.SeasonMode != "season" {
		failure(w, r, http.StatusBadRequest, errors.New("Invalid TV view"))
		return
	}
	base := s.Config()
	if cfg.Instances == nil && base.Instances != nil {
		for _, c := range base.Instances {
			if c.ID != c.Type {
				failure(w, r, http.StatusConflict, errors.New("Reload settings before saving service instances"))
				return
			}
		}
	}
	for _, connection := range cfg.AllInstances() {
		old := base.GetService(connection.ID)
		if e := mergeConnection(&connection, old); e != nil {
			failure(w, r, http.StatusBadRequest, e)
			return
		}
		cfg.setService(connection)
	}
	cfg.mirrorLegacy()
	pairs := instancePairs(base, cfg)
	for id, pair := range pairs {
		if pair[1].ID == "" {
			if pair[0].TagSyncDisable == "delete" {
				var dirty bool
				s.Store.Get("tagSyncDirty:"+id, &dirty)
				if dirty {
					failure(w, r, http.StatusConflict, errors.New("Wait for tag cleanup to finish before removing the service"))
					return
				}
			}
			if pair[0].Enabled || pair[0].TagSync.Active() {
				failure(w, r, http.StatusConflict, errors.New("Disable tag synchronization and the service before removing it"))
				return
			}
		}
		if mediaProviderOK(id) && invalidMediaConfig(pair[1]) {
			failure(w, r, http.StatusBadRequest, errors.New("Media servers sync at the Radarr/Sonarr interval"))
			return
		}
		if e := validateTagPolicy(pair[0], pair[1]); e != nil {
			failure(w, r, http.StatusBadRequest, e)
			return
		}
	}
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(130 * time.Second))
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()
	if connectionsChanged(base, cfg) {
		select {
		case s.Sync.gate <- struct{}{}:
			defer func() { <-s.Sync.gate }()
		case <-ctx.Done():
			failure(w, r, http.StatusServiceUnavailable, errors.New("Sync is busy. Try again after it completes"))
			return
		}
	}
	s.settingsMu.Lock()
	defer s.settingsMu.Unlock()
	if !reflect.DeepEqual(s.Config(), base) {
		failure(w, r, http.StatusConflict, ErrTagPreviewChanged)
		return
	}
	if s.Demo && connectionsChanged(base, cfg) {
		failure(w, r, http.StatusForbidden, errors.New("Demo connections cannot be changed"))
		return
	}
	// Serialize settings publication with job queue mutations and worker startup.
	s.Mux.mu.Lock()
	defer s.Mux.mu.Unlock()
	s.Placement.mu.Lock()
	defer s.Placement.mu.Unlock()
	// A queued plan and recovery must keep the same physical namespace. Preserve
	// the scan snapshot until the user explicitly cancels/finishes file work.
	unraidChanged := !reflect.DeepEqual(base.Unraid, cfg.Unraid) || base.Mux.Mappings != cfg.Mux.Mappings || base.Mux.Enabled != cfg.Mux.Enabled || connectionsChanged(base, cfg)
	if unraidChanged {
		active, e := s.Store.placementActive()
		if e != nil {
			failure(w, r, 500, errors.New("Could not read move queue"))
			return
		}
		if active || s.Placement.scan.Running || s.Placement.pendingFinal != nil {
			failure(w, r, 409, errors.New("Finish or cancel disk placement before changing its settings"))
			return
		}
		if s.Mux.active != 0 && (!reflect.DeepEqual(base.Unraid, cfg.Unraid)) {
			failure(w, r, 409, errors.New("Wait for running mux jobs before changing Unraid settings"))
			return
		}
	}
	if base.Mux.WorkDir != cfg.Mux.WorkDir {
		jobs, e := s.Store.muxJobs()
		if e != nil {
			failure(w, r, 500, errors.New("Could not read mux jobs"))
			return
		}
		for _, j := range jobs {
			if j.Status == "queued" || j.Status == "running" {
				failure(w, r, 409, errors.New("Wait for running mux jobs before changing the working directory"))
				return
			}
		}
	}
	plans := []*tagPlan{}
	mediaPlans := []*MediaTagPlan{}
	for id, pair := range pairs {
		before, next := pair[0], pair[1]
		if !tagPolicyChanged(before, next) && before.SourceIDs == next.SourceIDs {
			continue
		}
		if serviceOK(id) {
			plan, e := s.Store.BuildTagPlan(ctx, id, next, &before)
			if e != nil {
				failure(w, r, http.StatusBadRequest, e)
				return
			}
			if plan.Waiting {
				failure(w, r, http.StatusConflict, errors.New("Synchronize file data before reviewing outbound tags"))
				return
			}
			if len(plan.Preview.Rows) > 0 {
				if in.TagApprovals[id] != plan.Preview.Token {
					failure(w, r, http.StatusConflict, ErrTagPreviewChanged)
					return
				}
				plans = append(plans, plan)
			}
		} else if mediaProviderOK(id) {
			plan, e := s.Store.BuildMediaTagPlan(ctx, id, next, &before, cfg)
			if e != nil {
				failure(w, r, http.StatusBadRequest, e)
				return
			}
			if plan.Waiting {
				failure(w, r, http.StatusConflict, errors.New("Synchronize file data before reviewing outbound tags"))
				return
			}
			if len(plan.Preview.Rows) > 0 {
				if in.TagApprovals[id] != plan.Preview.Token {
					failure(w, r, http.StatusConflict, ErrTagPreviewChanged)
					return
				}
				mediaPlans = append(mediaPlans, plan)
			}
		}
	}
	stored := cfg
	stored.Instances = append([]ServiceConfig(nil), cfg.Instances...)
	if cfg.Instances != nil && stored.Instances == nil {
		stored.Instances = []ServiceConfig{}
	}
	for _, connection := range stored.Connections() {
		connection.APIKey = s.Security.Seal(connection.APIKey)
	}
	stored.mirrorLegacy()
	if e := s.Store.saveSettingsWithAllTagPolicies(ctx, stored, base, cfg, mediaPlans, plans...); e != nil {
		failure(w, r, http.StatusInternalServerError, errors.New("Could not save settings"))
		return
	}
	for id, pair := range pairs {
		if serviceOK(id) && (dataConfig(pair[0]) != dataConfig(pair[1]) || base.mediaChanged(cfg)) {
			s.Sync.Invalidate(id)
		}
	}
	s.Sync.ConfigureMedia(cfg)
	s.mu.Lock()
	s.settings = cfg
	s.mu.Unlock()
	s.Mux.checks = map[int64]muxCheckCache{}
	if base.Mux.Channel != cfg.Mux.Channel {
		s.Mux.tool.CheckedAt = nil
	}
	if (!cfg.Mux.Enabled || connectionsChanged(base, cfg) || base.Mux.Mappings != cfg.Mux.Mappings) && s.Mux.cancel != nil {
		s.Mux.cancel()
	}
	for id, pair := range pairs {
		if serviceOK(id) && pair[1].ID == "" {
			s.Store.DB.Exec("UPDATE mux_jobs SET status='failed',message='Library instance removed',revision=revision+1 WHERE service=? AND status<>'running'", id)
		}
	}
	s.Store.invalidateAggregates()
	for id, pair := range pairs {
		if !serviceOK(id) {
			continue
		}
		before, next := pair[0], pair[1]
		if next.Enabled && (!before.Enabled || before.URL != next.URL || before.APIKey != next.APIKey || base.mediaChanged(cfg) || before.TagSync != next.TagSync && next.TagSync.Active()) {
			s.Sync.Start(s.ctx, id, next, cfg.MediaInstancesFor(id)...)
		}
		if before != next && next.Enabled {
			s.Tags.Queue(id)
		}
	}
	s.queueMediaTags()
	s.Store.Events.Info("settings", "", "Settings saved", nil, "")
	jsonOut(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) testConnectionHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		failure(w, r, http.StatusMethodNotAllowed, errors.New("Endpoint or method not supported"))
		return
	}
	var in struct {
		Service string `json:"service"`
		Type    string `json:"type,omitempty"`
		URL     string `json:"url"`
		APIKey  string `json:"apiKey"`
	}
	if e := decode(w, r, &in); e != nil {
		failure(w, r, http.StatusBadRequest, e)
		return
	}
	if (!serviceOK(in.Service) && !mediaProviderOK(in.Service)) || s.Demo {
		failure(w, r, http.StatusBadRequest, errors.New("Invalid service or demo mode"))
		return
	}
	cfg := s.Config().GetService(in.Service)
	if in.Type != "" && in.Type != serviceKind(in.Service) {
		failure(w, r, http.StatusBadRequest, errors.New("Invalid service type"))
		return
	}
	if in.APIKey != "" {
		cfg.APIKey = in.APIKey
	}
	cfg.URL = in.URL
	cfg.Enabled = true
	if e := ValidateConfig(cfg); e != nil {
		failure(w, r, http.StatusBadRequest, e)
		return
	}
	var version string
	var e error
	if serviceKind(in.Service) == "emby" {
		version, e = NewEmby(cfg).Test(r.Context())
	} else if serviceKind(in.Service) == "jellyfin" {
		version, e = NewJellyfin(cfg).Test(r.Context())
	} else {
		version, e = NewArr(cfg).Test(r.Context())
	}
	if e != nil {
		failure(w, r, http.StatusBadGateway, e)
		return
	}
	jsonOut(w, http.StatusOK, map[string]string{"version": version})
}
