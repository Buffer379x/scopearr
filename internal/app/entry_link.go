package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

var titleSlugPattern = regexp.MustCompile(`^[\p{L}\p{N}][\p{L}\p{N}_-]{0,255}$`)

func safeTitleSlug(value string) string {
	if titleSlugPattern.MatchString(value) {
		return value
	}
	return ""
}
func movieSlug(slug string, tmdbID int) string {
	if slug = safeTitleSlug(slug); slug != "" {
		return slug
	}
	if tmdbID > 0 {
		return strconv.Itoa(tmdbID)
	}
	return ""
}
func entryURL(base, service, slug string) (string, error) {
	if serviceKind(service) != "radarr" && serviceKind(service) != "sonarr" || safeTitleSlug(slug) == "" {
		return "", errors.New("Invalid entry link")
	}
	u, err := url.Parse(base)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Scheme != "https" && u.Scheme != "http" {
		return "", errors.New("Invalid service address")
	}
	path := "movie"
	if serviceKind(service) == "sonarr" {
		path = "series"
	}
	return strings.TrimRight(u.String(), "/") + "/" + path + "/" + url.PathEscape(slug), nil
}
func (c *ArrClient) entrySlug(ctx context.Context, service string, id int) (string, error) {
	if id <= 0 || (serviceKind(service) != "radarr" && serviceKind(service) != "sonarr") {
		return "", errors.New("Invalid entry link")
	}
	path := "movie/"
	if serviceKind(service) == "sonarr" {
		path = "series/"
	}
	var resource struct {
		ID        int    `json:"id"`
		TitleSlug string `json:"titleSlug"`
		TMDBID    int    `json:"tmdbId"`
	}
	if err := c.get(ctx, path+strconv.Itoa(id), nil, &resource); err != nil {
		return "", err
	}
	if resource.ID != id {
		return "", errors.New("Entry mapping changed; synchronize the library again")
	}
	slug := safeTitleSlug(resource.TitleSlug)
	if serviceKind(service) == "radarr" {
		slug = movieSlug(resource.TitleSlug, resource.TMDBID)
	}
	if slug == "" {
		return "", errors.New("Service did not provide a usable entry link")
	}
	return slug, nil
}

// Old cached rows resolve their UI slug on demand, using one authenticated GET.
// Only a cached media ID and the configured service address can be opened.
func (s *Server) openEntry(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		failure(w, r, http.StatusMethodNotAllowed, errors.New("Method not allowed"))
		return
	}
	service := r.URL.Query().Get("service")
	id, err := strconv.Atoi(r.URL.Query().Get("mediaId"))
	if err != nil || id <= 0 || (serviceKind(service) != "radarr" && serviceKind(service) != "sonarr") {
		failure(w, r, http.StatusBadRequest, errors.New("Invalid entry link"))
		return
	}
	var raw string
	if err = s.Store.DB.QueryRowContext(r.Context(), "SELECT data FROM files WHERE service=? AND media_id=? LIMIT 1", service, id).Scan(&raw); err != nil {
		failure(w, r, http.StatusNotFound, errors.New("Cached entry not found"))
		return
	}
	var file File
	if err = json.Unmarshal([]byte(raw), &file); err != nil {
		failure(w, r, http.StatusInternalServerError, errors.New("Could not read cached entry"))
		return
	}
	settings := s.Config()
	cfg := settings.GetService(service)
	if !cfg.Enabled || cfg.URL == "" {
		failure(w, r, http.StatusConflict, errors.New("Enable the service to resolve this entry link"))
		return
	}
	var snapshot SyncStatus
	if s.Store.Get("sync:"+service, &snapshot) == nil && snapshot.Source != "" && snapshot.Source != tagEndpoint(cfg) {
		failure(w, r, http.StatusConflict, errors.New("Entry mapping changed; synchronize the library again"))
		return
	}
	slug := safeTitleSlug(file.TitleSlug)
	if slug == "" {
		if !cfg.Enabled || cfg.APIKey == "" {
			failure(w, r, http.StatusConflict, errors.New("Enable the service to resolve this entry link"))
			return
		}
		slug, err = NewArr(cfg).entrySlug(r.Context(), service, id)
		if err != nil {
			failure(w, r, http.StatusBadGateway, err)
			return
		}
	}
	target, err := entryURL(cfg.URL, service, slug)
	if err != nil {
		failure(w, r, http.StatusBadRequest, err)
		return
	}
	w.Header().Set("Referrer-Policy", "no-referrer")
	http.Redirect(w, r, target, http.StatusFound)
}

// Provider IDs are opaque route components, never paths or executable URLs.
var mediaIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

func safeMediaID(value string) bool { return mediaIDPattern.MatchString(value) }
