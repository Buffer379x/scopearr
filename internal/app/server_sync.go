package app

import (
	"errors"
	"net/http"
	"strings"
)

func (s *Server) tagImportHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		failure(w, r, http.StatusMethodNotAllowed, errors.New("Endpoint or method not supported"))
		return
	}
	var in struct {
		Service    string `json:"service"`
		MediaID    int    `json:"mediaId"`
		RemoteID   int    `json:"remoteId"`
		Resolution string `json:"resolution"`
	}
	if e := decode(w, r, &in); e != nil || !serviceOK(in.Service) || s.Demo {
		failure(w, r, http.StatusBadRequest, errors.New("Invalid service or demo mode"))
		return
	}
	cfg := s.Config()
	c := cfg.GetService(in.Service)
	if !c.Enabled || !c.TagImport {
		failure(w, r, http.StatusBadRequest, errors.New("Enable external tag import first"))
		return
	}
	if in.Resolution != "" {
		if in.Resolution != "local" && in.Resolution != "remote" {
			failure(w, r, http.StatusBadRequest, errors.New("Invalid conflict resolution"))
			return
		}
		if e := s.Store.ResolveExternal(r.Context(), in.Service, c, in.MediaID, in.RemoteID, in.Resolution == "local"); e != nil {
			failure(w, r, http.StatusConflict, e)
			return
		}
	}
	s.Tags.Queue(in.Service)
	jsonOut(w, http.StatusAccepted, map[string]bool{"queued": true})
}

func (s *Server) syncHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		failure(w, r, http.StatusMethodNotAllowed, errors.New("Endpoint or method not supported"))
		return
	}
	var in struct {
		Service string `json:"service"`
	}
	if e := decode(w, r, &in); e != nil {
		failure(w, r, http.StatusBadRequest, e)
		return
	}
	if s.Demo {
		failure(w, r, http.StatusBadRequest, errors.New("Demo data does not need syncing"))
		return
	}
	if mediaProviderOK(in.Service) {
		s.settingsMu.Lock()
		cfg := s.Config()
		media := cfg.GetService(in.Service)
		if !media.Enabled {
			s.settingsMu.Unlock()
			failure(w, r, http.StatusConflict, errors.New("Enable the selected media server before matching"))
			return
		}
		targets := []ServiceConfig{}
		statuses := s.Sync.Statuses()
		for _, c := range cfg.ArrInstances() {
			if c.Enabled && (media.SourceIDs == "" || containsString(strings.Split(media.SourceIDs, ","), c.ID)) {
				if statuses[c.ID].Running {
					s.settingsMu.Unlock()
					failure(w, r, http.StatusConflict, errors.New("Sync already running"))
					return
				}
				targets = append(targets, c)
			}
		}
		if len(targets) == 0 {
			s.settingsMu.Unlock()
			failure(w, r, http.StatusConflict, errors.New("Enable at least one source library before matching"))
			return
		}
		for _, c := range targets {
			if e := s.Sync.Start(s.ctx, c.ID, c, cfg.MediaInstancesFor(c.ID)...); e != nil {
				s.settingsMu.Unlock()
				failure(w, r, http.StatusConflict, e)
				return
			}
		}
		s.settingsMu.Unlock()
		jsonOut(w, http.StatusAccepted, map[string]bool{"ok": true})
		return
	}
	s.settingsMu.Lock()
	settings := s.Config()
	cfg := settings.GetService(in.Service)
	e := s.Sync.Start(s.ctx, in.Service, cfg, settings.MediaInstancesFor(in.Service)...)
	s.settingsMu.Unlock()
	if e != nil {
		failure(w, r, http.StatusConflict, e)
		return
	}
	jsonOut(w, http.StatusAccepted, map[string]bool{"ok": true})
}
