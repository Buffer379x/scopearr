package app

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"time"
)

func (s *Server) customTagsBatchHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != "PUT" {
		failure(w, r, http.StatusMethodNotAllowed, errors.New("Endpoint or method not supported"))
		return
	}
	var draft struct {
		Original []CustomTag `json:"original"`
		Tags     []CustomTag `json:"tags"`
	}
	if err := decodeLimit(w, r, &draft, 128*1024); err != nil {
		failure(w, r, http.StatusBadRequest, err)
		return
	}
	s.settingsMu.Lock()
	defer s.settingsMu.Unlock()
	tags, err := s.Store.SaveCustomTags(r.Context(), draft.Original, draft.Tags)
	if err != nil {
		failure(w, r, http.StatusBadRequest, err)
		return
	}
	if err := s.refreshTagSettings(); err != nil {
		failure(w, r, http.StatusInternalServerError, errors.New("Could not load settings"))
		return
	}
	s.queueTagSync()
	jsonOut(w, http.StatusOK, tags)
}

func (s *Server) customTagsHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		tags, err := s.Store.CustomTags(r.Context())
		if err != nil {
			failure(w, r, http.StatusInternalServerError, err)
		} else {
			jsonOut(w, http.StatusOK, tags)
		}
		return
	}
	var tag CustomTag
	if err := decodeLimit(w, r, &tag, 2048); err != nil {
		failure(w, r, http.StatusBadRequest, err)
		return
	}
	switch r.Method {
	case "POST", "PUT":
		s.settingsMu.Lock()
		defer s.settingsMu.Unlock()
		out, err := s.Store.SaveCustomTag(r.Context(), tag)
		if err != nil {
			failure(w, r, http.StatusBadRequest, err)
		} else {
			s.queueTagSync()
			jsonOut(w, http.StatusOK, out)
		}
		return
	case "DELETE":
		if tag.ID <= 0 {
			failure(w, r, http.StatusBadRequest, errors.New("Invalid custom tag"))
			return
		}
		s.settingsMu.Lock()
		defer s.settingsMu.Unlock()
		if err := s.Store.DeleteCustomTag(r.Context(), tag.ID); err != nil {
			failure(w, r, http.StatusBadRequest, err)
		} else {
			if err := s.refreshTagSettings(); err != nil {
				failure(w, r, http.StatusInternalServerError, errors.New("Could not load settings"))
				return
			}
			s.queueTagSync()
			jsonOut(w, http.StatusOK, map[string]bool{"ok": true})
		}
		return
	}
	failure(w, r, http.StatusMethodNotAllowed, errors.New("Endpoint or method not supported"))

}

func (s *Server) customSelectionHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		out, err := s.Store.CustomSelection(r.Context(), r.URL.Query())
		if err != nil {
			failure(w, r, http.StatusBadRequest, err)
		} else {
			jsonOut(w, http.StatusOK, out)
		}
		return
	}
	if r.Method == "PUT" {
		var in struct {
			Query   string          `json:"query"`
			Changes map[string]bool `json:"changes"`
		}
		if err := decodeLimit(w, r, &in, 16384); err != nil {
			failure(w, r, http.StatusBadRequest, err)
			return
		}
		q, err := url.ParseQuery(in.Query)
		if err != nil {
			failure(w, r, http.StatusBadRequest, err)
			return
		}
		_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(190 * time.Second))
		ctx, cancel := context.WithTimeout(r.Context(), 180*time.Second)
		defer cancel()
		total, err := s.Store.ApplyCustom(ctx, q, in.Changes)
		if err != nil {
			failure(w, r, http.StatusBadRequest, err)
		} else {
			s.queueTagSync()
			jsonOut(w, http.StatusOK, map[string]int{"total": total})
		}
		return
	}
	failure(w, r, http.StatusMethodNotAllowed, errors.New("Endpoint or method not supported"))

}
