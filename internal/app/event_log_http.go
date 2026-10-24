package app

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func eventQueryFromRequest(r *http.Request) (eventQuery, error) {
	v := r.URL.Query()
	q := eventQuery{Q: v.Get("q"), Levels: v["level"], Sources: v["source"], Instances: v["instance"], Sort: v.Get("sort"), Dir: v.Get("dir")}
	for _, level := range q.Levels {
		if !containsString(eventLevels, level) {
			return q, errors.New("Invalid filter")
		}
	}
	for _, source := range q.Sources {
		if !containsString(eventSources, source) {
			return q, errors.New("Invalid filter")
		}
	}
	if q.Sort != "" && q.Sort != "ts" && q.Sort != "level" && q.Sort != "source" {
		return q, errors.New("Invalid sort field")
	}
	q.Limit, _ = strconv.Atoi(v.Get("limit"))
	q.Offset, _ = strconv.Atoi(v.Get("offset"))
	return q, nil
}

// eventsHTTP serves the System → Log viewer: list, export and clear.
func (s *Server) eventsHTTP(w http.ResponseWriter, r *http.Request) {
	if s.Demo && r.Method == "GET" && r.URL.Path == "/api/events" {
		s.seedDemoEvents()
	}
	switch {
	case r.URL.Path == "/api/events" && r.Method == "GET":
		q, err := eventQueryFromRequest(r)
		if err != nil {
			failure(w, r, 400, err)
			return
		}
		page, err := s.Store.Events.query(r.Context(), q)
		if err != nil {
			failure(w, r, 500, errors.New("Could not read the log"))
			return
		}
		jsonOut(w, 200, page)
	case r.URL.Path == "/api/events/export" && r.Method == "GET":
		q, err := eventQueryFromRequest(r)
		if err != nil {
			failure(w, r, 400, err)
			return
		}
		q.Limit, q.Offset = eventLimit, 0
		page, err := s.Store.Events.query(r.Context(), q)
		if err != nil {
			failure(w, r, 500, errors.New("Could not read the log"))
			return
		}
		name := "scopearr-log-" + time.Now().Format("2006-01-02-1504")
		if r.URL.Query().Get("format") == "json" {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Content-Disposition", `attachment; filename="`+name+`.json"`)
			_ = json.NewEncoder(w).Encode(page.Events)
			return
		}
		names := map[string]string{}
		for _, c := range s.Config().AllInstances() {
			names[c.ID] = instanceLabel(c)
		}
		lines := make([]string, len(page.Events))
		for n, e := range page.Events {
			lines[n] = eventText(e, names)
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="`+name+`.txt"`)
		_, _ = w.Write([]byte(strings.Join(lines, "\n") + "\n"))
	case r.URL.Path == "/api/events" && r.Method == "DELETE":
		if s.Demo {
			failure(w, r, 403, errors.New("The demo log cannot be cleared"))
			return
		}
		if err := s.Store.Events.Clear(); err != nil {
			failure(w, r, 500, errors.New("Could not clear the log"))
			return
		}
		jsonOut(w, 200, map[string]bool{"ok": true})
	default:
		failure(w, r, 405, errors.New("Endpoint or method not supported"))
	}
}

// Demo mode shows a small, plausible log without touching real services.
func (s *Server) seedDemoEvents() {
	var n int
	if s.Store.DB.QueryRow("SELECT count(*) FROM event_log").Scan(&n) != nil || n > 0 {
		return
	}
	l := s.Store.Events
	l.Info("system", "", "Scopearr {version} started", map[string]any{"version": s.Version}, "")
	l.Info("sync", "radarr", "Sync completed · {count} files in {seconds} s", map[string]any{"count": 14, "seconds": 2}, "")
	l.Warning("tags", "sonarr", "Tag removals need approval", nil, "", "")
	l.Error("media", "emby", "Media server matching failed", nil, "", "connection refused")
	l.Flush()
}
