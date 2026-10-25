package app

import (
	"context"
	"errors"
	"net/http"
	"reflect"
	"sort"
	"time"
)

const recognitionReprocessBudget = 5 * time.Minute

func (s *Server) recognitionHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" && r.URL.Path == "/api/recognition" {
		jsonOut(w, http.StatusOK, s.Store.Recognition())
		return
	}
	// Legacy defaults catalog retained for API compatibility; unused by the 1.4.2 interface.
	if r.Method == "GET" && r.URL.Path == "/api/recognition/defaults" {
		jsonOut(w, http.StatusOK, defaultRecognitionEngine.Config())
		return
	}
	if (r.Method == "PUT" && r.URL.Path == "/api/recognition") || (r.Method == "POST" && r.URL.Path == "/api/recognition/preview") {
		var in struct {
			Rules    []RecognitionRule `json:"rules"`
			Revision string            `json:"revision"`
			Filename string            `json:"filename"`
		}
		if err := decodeLimit(w, r, &in, 256<<10); err != nil {
			failure(w, r, http.StatusBadRequest, err)
			return
		}
		engine, err := CompileRecognition(in.Rules)
		if err != nil {
			failure(w, r, http.StatusBadRequest, err)
			return
		}
		if r.Method == "POST" {
			if len(in.Filename) == 0 || len(in.Filename) > 2048 {
				failure(w, r, http.StatusBadRequest, errors.New("Enter a filename up to 2048 characters"))
				return
			}
			jsonOut(w, http.StatusOK, engine.Recognize(in.Filename))
			return
		}
		// Reprocessing is an authenticated, atomic bulk operation. Give it
		// a bounded budget on slower hosts without changing query timeouts.
		_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(recognitionReprocessBudget + 10*time.Second))
		ctx, cancel := context.WithTimeout(r.Context(), recognitionReprocessBudget)
		defer cancel()

		// Serialize long cache rewrites with file/tag reconciliation.
		select {
		case s.Sync.gate <- struct{}{}:
			defer func() { <-s.Sync.gate }()
		case <-ctx.Done():
			failure(w, r, http.StatusServiceUnavailable, errors.New("Sync is busy. Try again after it completes"))
			return
		}
		before := s.Store.Recognition()
		out, err := s.Store.SaveRecognition(ctx, in.Rules, in.Revision)
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				status = http.StatusServiceUnavailable
				err = errors.New("Recognition reprocessing timed out. Previous rules and files are unchanged. Try again when the server is less busy.")
			}
			if errors.Is(err, ErrRecognitionRevision) {
				status = http.StatusConflict
			}
			failure(w, r, status, err)
			return
		}
		old := map[string]RecognitionRule{}
		for _, rule := range before.Rules {
			old[rule.ID] = rule
		}
		for _, rule := range out.Rules {
			previous, exists := old[rule.ID]
			if !exists || !reflect.DeepEqual(previous, rule) {
				s.Store.Events.Info("settings", "", "Tag rule saved: {name}", map[string]any{"name": rule.Name}, rule.Name)
			}
			delete(old, rule.ID)
		}
		ids := make([]string, 0, len(old))
		for id := range old {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		for _, id := range ids {
			rule := old[id]
			s.Store.Events.Info("settings", "", "Tag rule deleted: {name}", map[string]any{"name": rule.Name}, rule.Name)
		}
		s.queueTagSync()
		jsonOut(w, http.StatusOK, out)
		return
	}
	failure(w, r, http.StatusMethodNotAllowed, errors.New("Endpoint or method not supported"))

}

func (s *Server) tagCatalogHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		out, e := s.Store.TagCatalog(r.Context())
		if e != nil {
			failure(w, r, http.StatusInternalServerError, e)
		} else {
			jsonOut(w, http.StatusOK, out)
		}
		return
	}
	if r.Method == "DELETE" {
		var in struct {
			Field string `json:"field"`
			Value string `json:"value"`
		}
		if e := decode(w, r, &in); e != nil {
			failure(w, r, http.StatusBadRequest, e)
			return
		}
		s.settingsMu.Lock()
		defer s.settingsMu.Unlock()
		e := s.Store.DeleteCatalogTag(r.Context(), in.Field, in.Value)
		if e == nil {
			e = s.refreshTagSettings()
		}
		if e != nil {
			failure(w, r, http.StatusBadRequest, e)
		} else {
			jsonOut(w, http.StatusOK, map[string]bool{"ok": true})
		}
		return
	}
	failure(w, r, http.StatusMethodNotAllowed, errors.New("Endpoint or method not supported"))

}

func (s *Server) displayTagsHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		out, e := s.Store.DisplayTags(r.Context())
		if e != nil {
			failure(w, r, http.StatusInternalServerError, e)
		} else {
			jsonOut(w, http.StatusOK, out)
		}
		return
	}
	failure(w, r, http.StatusMethodNotAllowed, errors.New("Endpoint or method not supported"))

}

func (s *Server) tagPresentationHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		failure(w, r, http.StatusMethodNotAllowed, errors.New("Endpoint or method not supported"))
		return
	}
	out, err := s.Store.TagPresentation(r.Context())
	if err != nil {
		failure(w, r, http.StatusInternalServerError, err)
		return
	}
	jsonOut(w, http.StatusOK, out)
}
