package app

import (
	"context"
	"errors"
	"net/http"
	"reflect"
	"time"
)

func (s *Server) tagPreviewHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		failure(w, r, http.StatusMethodNotAllowed, errors.New("Endpoint or method not supported"))
		return
	}
	var in struct {
		Service   string          `json:"service"`
		Config    ServiceConfig   `json:"config"`
		Token     string          `json:"token"`
		TagID     int             `json:"tagId"`
		Page      int             `json:"page"`
		Instances []ServiceConfig `json:"instances,omitempty"`
	}
	if e := decodeLimit(w, r, &in, 256<<10); e != nil {
		failure(w, r, http.StatusBadRequest, e)
		return
	}
	if !serviceOK(in.Service) && !mediaProviderOK(in.Service) {
		failure(w, r, http.StatusBadRequest, errors.New("Invalid service"))
		return
	}
	if s.Demo {
		failure(w, r, http.StatusForbidden, errors.New("Demo connections cannot be changed"))
		return
	}
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(130 * time.Second))
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()
	select {
	case s.Sync.gate <- struct{}{}:
		defer func() { <-s.Sync.gate }()
	case <-ctx.Done():
		failure(w, r, http.StatusServiceUnavailable, errors.New("Sync is busy. Try again after it completes"))
		return
	}
	cfg := s.Config()
	before := cfg.GetService(in.Service)
	if in.Instances != nil {
		proposed := cfg
		proposed.Instances = append([]ServiceConfig{}, in.Instances...)
		if e := normalizeInstances(&proposed); e != nil {
			failure(w, r, http.StatusBadRequest, e)
			return
		}
		for _, c := range proposed.AllInstances() {
			if e := mergeConnection(&c, cfg.GetService(c.ID)); e != nil {
				failure(w, r, http.StatusBadRequest, e)
				return
			}
			proposed.setService(c)
		}
		proposed.mirrorLegacy()
		cfg = proposed
	}

	next := in.Config
	if next.ID != "" && next.ID != in.Service || next.Type != "" && next.Type != serviceKind(in.Service) {
		failure(w, r, http.StatusBadRequest, errors.New("Invalid service instance"))
		return
	}
	next.ID = in.Service
	next.Type = serviceKind(in.Service)
	if r.URL.Path == "/api/tag-approval" {
		next = before
	} else {
		if e := mergeConnection(&next, before); e != nil {
			failure(w, r, http.StatusBadRequest, e)
			return
		}
		if e := validateTagPolicy(before, next); e != nil {
			failure(w, r, http.StatusBadRequest, e)
			return
		}
	}
	var old *ServiceConfig
	if r.URL.Path != "/api/tag-approval" {
		old = &before
	}
	if mediaProviderOK(in.Service) {
		s.mediaTagPreviewHTTP(w, r, ctx, in.Service, next, old, in.Token, in.TagID, in.Page, cfg)
		return
	}
	p, e := s.Store.BuildTagPlan(ctx, in.Service, next, old)
	if e != nil {
		failure(w, r, http.StatusBadRequest, e)
		return
	}
	if p.Waiting {
		failure(w, r, http.StatusConflict, errors.New("Synchronize file data before reviewing outbound tags"))
		return
	}
	if in.Token != "" && in.Token != p.Preview.Token {
		failure(w, r, http.StatusConflict, ErrTagPreviewChanged)
		return
	}
	if r.URL.Path == "/api/tag-approval" {
		if in.Token == "" {
			failure(w, r, http.StatusBadRequest, errors.New("Review the tag preview before confirming"))
			return
		}
		if !reflect.DeepEqual(s.Config(), cfg) {
			failure(w, r, http.StatusConflict, ErrTagPreviewChanged)
			return
		}
		if e = s.Store.ApproveTagPlan(ctx, p); e != nil {
			failure(w, r, http.StatusInternalServerError, errors.New("Could not save tag approval"))
			return
		}
		s.Tags.Queue(in.Service)
		jsonOut(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	if in.TagID > 0 {
		page := in.Page
		if page < 1 {
			page = 1
		}
		targets := []TagTarget{}
		for _, op := range p.Operations {
			for _, id := range op.Remove {
				if id == in.TagID {
					targets = append(targets, TagTarget{op.ID, op.Title})
					break
				}
			}
		}
		maxPage := (len(targets) + 99) / 100
		if maxPage < 1 {
			maxPage = 1
		}
		if page > maxPage {
			page = maxPage
		}
		p.Preview.TargetTotal = len(targets)
		p.Preview.TargetPage = page
		start := (page - 1) * 100
		if start > len(targets) {
			start = len(targets)
		}
		end := start + 100
		if end > len(targets) {
			end = len(targets)
		}
		p.Preview.Targets = targets[start:end]
	}
	jsonOut(w, http.StatusOK, p.Preview)
}

func (s *Server) mediaTagPreviewHTTP(w http.ResponseWriter, r *http.Request, ctx context.Context, id string, next ServiceConfig, old *ServiceConfig, token string, tagID, page int, cfg Settings) {
	p, e := s.Store.BuildMediaTagPlan(ctx, id, next, old, cfg)
	if e != nil {
		failure(w, r, http.StatusBadRequest, e)
		return
	}
	if p.Waiting {
		failure(w, r, http.StatusConflict, errors.New("Synchronize file data before reviewing outbound tags"))
		return
	}
	if token != "" && token != p.Preview.Token {
		failure(w, r, http.StatusConflict, ErrTagPreviewChanged)
		return
	}
	if r.URL.Path == "/api/tag-approval" {
		if token == "" || !reflect.DeepEqual(s.Config(), cfg) {
			failure(w, r, http.StatusConflict, ErrTagPreviewChanged)
			return
		}
		if e = s.Store.ApproveMediaTagPlan(ctx, p); e != nil {
			failure(w, r, http.StatusInternalServerError, e)
			return
		}
		s.Tags.Queue(id)
		jsonOut(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	if tagID > 0 {
		jsonOut(w, http.StatusOK, p.TagTargets(tagID, page))
		return
	}
	jsonOut(w, http.StatusOK, p.Preview)
}
