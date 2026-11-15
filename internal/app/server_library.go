package app

import (
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

func (s *Server) filesHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		failure(w, r, http.StatusMethodNotAllowed, errors.New("Endpoint or method not supported"))
		return
	}
	mode := r.URL.Query().Get("mode")
	if mode == "" {
		mode = s.Config().SeasonMode
	}
	if mode != "matches" && mode != "season" {
		failure(w, r, http.StatusBadRequest, errors.New("Invalid view mode"))
		return
	}
	q := r.URL.Query()
	// distinct (optional, quick search): "series" keeps each series of a TV
	// library once, in the matches view only. It reaches the query as the
	// reserved _distinct, which no other caller of where() sets.
	q.Del("_distinct")
	if distinct := q["distinct"]; len(distinct) > 0 && !(len(distinct) == 1 && distinct[0] == "") {
		if len(distinct) != 1 || distinct[0] != "series" || mode != "matches" {
			failure(w, r, http.StatusBadRequest, errors.New("Invalid view mode"))
			return
		}
		if serviceKind(q.Get("service")) == "sonarr" {
			q.Set("_distinct", "series")
		}
	}
	q.Set("_infoMask", strconv.Itoa(infoMask(s.Config())))
	size := s.Config().PageSize
	// limit (optional, quick search): the page size of this request only,
	// checked like the page size; without it the configured one applies.
	if q.Has("limit") {
		limit, e := pageSize(q.Get("limit"))
		if e != nil {
			failure(w, r, http.StatusBadRequest, e)
			return
		}
		size = limit
	}
	q.Set("_pageSize", strconv.Itoa(size))
	out, e := s.Store.QueryContext(r.Context(), q, mode, false)
	if e != nil {
		failure(w, r, http.StatusBadRequest, e)
		return
	}
	s.decorateInstances(out.Files)
	jsonOut(w, http.StatusOK, out)
}

func (s *Server) statisticsHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		failure(w, r, http.StatusMethodNotAllowed, errors.New("Endpoint or method not supported"))
		return
	}
	out, e := s.Store.StatisticsContext(r.Context())
	if e != nil {
		failure(w, r, http.StatusInternalServerError, errors.New("Could not load statistics"))
		return
	}
	jsonOut(w, http.StatusOK, out)
}

func (s *Server) facetsHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		failure(w, r, http.StatusMethodNotAllowed, errors.New("Endpoint or method not supported"))
		return
	}
	out, e := s.Store.FacetsContext(r.Context(), r.URL.Query().Get("service"))
	if e != nil {
		failure(w, r, http.StatusBadRequest, e)
		return
	}
	jsonOut(w, http.StatusOK, out)
}

func (s *Server) presetsHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		out, e := s.Store.Presets()
		if e != nil {
			failure(w, r, http.StatusInternalServerError, errors.New("Could not load presets"))
			return
		}
		jsonOut(w, http.StatusOK, out)
		return
	}
	if r.Method == "POST" {
		var p Preset
		if e := decode(w, r, &p); e != nil {
			failure(w, r, http.StatusBadRequest, e)
			return
		}
		q, e := url.ParseQuery(p.Query)
		if e != nil {
			failure(w, r, http.StatusBadRequest, errors.New("Invalid filter"))
			return
		}
		q.Set("service", p.Service)
		if _, e = canonicalPresetQuery(q.Encode(), p.Service); e != nil || strings.TrimSpace(p.Name) == "" || len(p.Name) > 80 {
			failure(w, r, http.StatusBadRequest, errors.New("Invalid preset"))
			return
		}
		q.Del("page")
		p.Query = q.Encode()
		created, duplicate, e := s.Store.SavePreset(r.Context(), p)
		if e != nil {
			failure(w, r, http.StatusInternalServerError, errors.New("Could not save preset"))
			return
		}
		if duplicate != nil {
			jsonOut(w, http.StatusConflict, duplicatePresetResponse(*duplicate))
			return
		}
		p = created
		s.Store.Events.Info("settings", "", "Preset saved: {name}", map[string]any{"name": p.Name}, p.Name)
		jsonOut(w, http.StatusCreated, p)
		return
	}
	if r.Method == "DELETE" {
		id, e := strconv.ParseInt(r.URL.Query().Get("id"), 10, 64)
		if e != nil {
			failure(w, r, http.StatusBadRequest, errors.New("Invalid ID"))
			return
		}
		var name string
		_ = s.Store.DB.QueryRow("SELECT name FROM presets WHERE id=?", id).Scan(&name)
		result, e := s.Store.DB.Exec("DELETE FROM presets WHERE id=?", id)
		if e != nil {
			failure(w, r, http.StatusInternalServerError, errors.New("Could not delete preset"))
			return
		}
		if n, _ := result.RowsAffected(); n > 0 {
			s.Store.Events.Info("settings", "", "Preset deleted: {name}", map[string]any{"name": name}, name)
		}
		jsonOut(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	failure(w, r, http.StatusMethodNotAllowed, errors.New("Endpoint or method not supported"))

}
