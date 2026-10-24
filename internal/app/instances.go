package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"regexp"
	"slices"
	"sort"
	"strings"
	"unicode"
)

var instanceIDPattern = regexp.MustCompile(`^(radarr|sonarr|emby|jellyfin)(-[a-z0-9][a-z0-9-]{0,55})?$`)

func serviceKind(id string) string {
	if !instanceIDPattern.MatchString(id) {
		return ""
	}
	return strings.SplitN(id, "-", 2)[0]
}
func instanceLabel(c ServiceConfig) string {
	if c.Name != "" {
		return c.Name
	}
	switch c.Type {
	case "radarr":
		return "Radarr"
	case "sonarr":
		return "Sonarr"
	case "emby":
		return "Emby"
	case "jellyfin":
		return "Jellyfin"
	}
	return c.ID
}
func (s Settings) AllInstances() []ServiceConfig {
	if s.Instances != nil {
		return append([]ServiceConfig{}, s.Instances...)
	}
	out := []ServiceConfig{s.Radarr, s.Sonarr, s.Emby, s.Jellyfin}
	for i, id := range []string{"radarr", "sonarr", "emby", "jellyfin"} {
		out[i].ID = id
		out[i].Type = id
	}
	return out
}
func (s Settings) GetService(id string) ServiceConfig {
	for _, c := range s.AllInstances() {
		if c.ID == id {
			return c
		}
	}
	return ServiceConfig{ID: id, Type: serviceKind(id)}
}
func (s Settings) ArrInstances() []ServiceConfig {
	out := []ServiceConfig{}
	for _, c := range s.AllInstances() {
		if serviceOK(c.ID) {
			out = append(out, c)
		}
	}
	return out
}
func (s Settings) MediaInstances() []ServiceConfig {
	out := []ServiceConfig{}
	for _, c := range s.AllInstances() {
		if mediaProviderOK(c.ID) {
			out = append(out, c)
		}
	}
	return out
}
func (s Settings) MediaInstancesFor(id string) []ServiceConfig {
	out := []ServiceConfig{}
	for _, c := range s.MediaInstances() {
		if c.Enabled && (c.SourceIDs == "" || containsString(strings.Split(c.SourceIDs, ","), id)) {
			out = append(out, c)
		}
	}
	return out
}
func (s *Settings) mirrorLegacy() {
	if s.Instances == nil {
		return
	}
	s.Radarr = ServiceConfig{}
	s.Sonarr = ServiceConfig{}
	s.Emby = ServiceConfig{}
	s.Jellyfin = ServiceConfig{}
	for _, c := range s.Instances {
		switch c.ID {
		case "radarr":
			s.Radarr = c
		case "sonarr":
			s.Sonarr = c
		case "emby":
			s.Emby = c
		case "jellyfin":
			s.Jellyfin = c
		}
	}
}
func normalizeInstances(s *Settings) error {
	if s.Instances == nil {
		return nil
	}
	if len(s.Instances) > 64 {
		return errors.New("At most 64 service instances are supported")
	}
	seen := map[string]bool{}
	for i := range s.Instances {
		c := &s.Instances[i]
		kind := serviceKind(c.ID)
		if kind == "" || seen[c.ID] || c.Type != "" && c.Type != kind {
			return errors.New("Invalid or duplicate service instance")
		}
		seen[c.ID] = true
		c.Type = kind
		c.Name = strings.TrimSpace(c.Name)
		if len([]rune(c.Name)) > 120 || strings.IndexFunc(c.Name, unicode.IsControl) >= 0 {
			return errors.New("Invalid service name")
		}
	}
	endpoints := map[string]bool{}
	for i := range s.Instances {
		c := &s.Instances[i]
		if c.Enabled && c.URL != "" {
			key := duplicateInstanceEndpoint(*c)
			if endpoints[key] {
				return errors.New("This service address is already configured")
			}
			endpoints[key] = true
		}
		ids := []string{}
		selected := map[string]bool{}
		for _, raw := range strings.Split(c.SourceIDs, ",") {
			id := strings.TrimSpace(raw)
			if id == "" {
				continue
			}
			if !mediaProviderOK(c.ID) || !seen[id] || !serviceOK(id) || selected[id] {
				return errors.New("Invalid source service selection")
			}
			selected[id] = true
			ids = append(ids, id)
		}
		sort.Strings(ids)
		c.SourceIDs = strings.Join(ids, ",")
	}
	s.mirrorLegacy()
	return nil
}
func instancePairs(old, next Settings) map[string][2]ServiceConfig {
	out := map[string][2]ServiceConfig{}
	for _, c := range old.AllInstances() {
		pair := out[c.ID]
		pair[0] = c
		out[c.ID] = pair
	}
	for _, c := range next.AllInstances() {
		pair := out[c.ID]
		pair[1] = c
		out[c.ID] = pair
	}
	return out
}
func (s *Store) arrNamespaces(ctx context.Context) []string {
	out := []string{"radarr", "sonarr"}
	rows, e := s.DB.QueryContext(ctx, `SELECT DISTINCT service FROM files UNION SELECT DISTINCT service FROM external_tag_defs`)
	if e != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil && serviceOK(id) && !containsString(out, id) {
			out = append(out, id)
		}
	}
	return out
}
func scopePredicate(column, scope string) string {
	if scope == "radarr" || scope == "sonarr" {
		return "(" + column + "='" + scope + "' OR " + column + " GLOB '" + scope + "-*')"
	}
	return column + "='" + scope + "'"
}

// Dynamic matches use a compact slice: a usual snapshot has one or two
// providers, so a per-file hash table would retain far more memory than its data.
func (m *MediaMatches) get(id string) *MediaMatch {
	if m == nil {
		return nil
	}
	if id == "emby" {
		return m.Emby
	}
	if id == "jellyfin" {
		return m.Jellyfin
	}
	for _, entry := range m.Instances {
		if entry.ID == id {
			return entry.Match
		}
	}
	return nil
}
func (m *MediaMatches) each(visit func(string, *MediaMatch)) {
	if m == nil {
		return
	}
	if m.Emby != nil {
		visit("emby", m.Emby)
	}
	if m.Jellyfin != nil {
		visit("jellyfin", m.Jellyfin)
	}
	for _, entry := range m.Instances {
		visit(entry.ID, entry.Match)
	}
}
func (m *MediaMatches) ids() []string {
	ids := make([]string, 0, m.count())
	m.each(func(id string, _ *MediaMatch) { ids = append(ids, id) })
	return ids
}

func (m *MediaMatches) put(id string, value *MediaMatch) {
	if id == "emby" {
		m.Emby = value
		return
	}
	if id == "jellyfin" {
		m.Jellyfin = value
		return
	}
	for i := range m.Instances {
		if m.Instances[i].ID == id {
			m.Instances[i].Match = value
			return
		}
	}
	m.Instances = append(m.Instances, mediaMatchEntry{ID: id, Match: value})
}
func (m *MediaMatches) MarshalJSON() ([]byte, error) {
	if m == nil {
		return []byte("null"), nil
	}
	ids := m.ids()
	sort.Strings(ids)
	out := make([]byte, 0, 256)
	out = append(out, '{')
	for i, id := range ids {
		if i > 0 {
			out = append(out, ',')
		}
		key, e := json.Marshal(id)
		if e != nil {
			return nil, e
		}
		out = append(out, key...)
		out = append(out, ':')
		raw, e := json.Marshal(m.get(id))
		if e != nil {
			return nil, e
		}
		out = append(out, raw...)
	}
	return append(out, '}'), nil
}
func (m *MediaMatches) UnmarshalJSON(raw []byte) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	token, e := dec.Token()
	if e != nil {
		return e
	}
	*m = MediaMatches{}
	if token == nil {
		return nil
	}
	if token != json.Delim('{') {
		return errors.New("Invalid media-server matches")
	}
	for dec.More() {
		key, e := dec.Token()
		if e != nil {
			return e
		}
		id, ok := key.(string)
		if !ok {
			return errors.New("Invalid media-server instance")
		}
		if !mediaProviderOK(id) {
			var skip json.RawMessage
			if e = dec.Decode(&skip); e != nil {
				return e
			}
			continue
		}
		var value *MediaMatch
		if e = dec.Decode(&value); e != nil {
			return e
		}
		m.put(id, value)
	}
	if _, e = dec.Token(); e != nil {
		return e
	}
	if _, e = dec.Token(); e != io.EOF {
		return errors.New("Invalid media-server matches")
	}
	return nil
}
func (m *MediaMatches) count() int {
	if m == nil {
		return 0
	}
	n := len(m.Instances)
	if m.Emby != nil {
		n++
	}
	if m.Jellyfin != nil {
		n++
	}
	return n
}
func (f *File) setMediaMatch(id string, value MediaMatch) {
	if f.MediaServers == nil {
		f.MediaServers = &MediaMatches{}
	}
	f.MediaServers.each(func(_ string, other *MediaMatch) {
		if other == nil {
			return
		}
		// These remain distinct target fields. Equal immutable values can
		// share storage, including when two providers derive IDs from a path.
		for _, existing := range []string{other.ItemID, other.SourceID} {
			if existing != "" && value.ItemID == existing {
				value.ItemID = existing
				if value.Link != nil && value.Link.ItemID == existing {
					value.Link.ItemID = existing
				}
			}
			if existing != "" && value.SourceID == existing {
				value.SourceID = existing
			}
		}
		if other.Video != nil && value.Video != nil && *other.Video == *value.Video {
			value.Video = other.Video
		}
		if slices.Equal(other.Tracks, value.Tracks) || trackInventory(other.Tracks) == trackInventory(value.Tracks) {
			value.Tracks = other.Tracks
		}
	})
	f.MediaServers.put(id, &value)
}

func (s *Settings) setService(c ServiceConfig) {
	if s.Instances != nil {
		for i := range s.Instances {
			if s.Instances[i].ID == c.ID {
				s.Instances[i] = c
				return
			}
		}
		return
	}
	switch c.ID {
	case "radarr":
		s.Radarr = c
	case "sonarr":
		s.Sonarr = c
	case "emby":
		s.Emby = c
	case "jellyfin":
		s.Jellyfin = c
	}
}
func (s Settings) enabledMedia() bool {
	for _, c := range s.MediaInstances() {
		if c.Enabled {
			return true
		}
	}
	return false
}
func (s Settings) mediaChanged(other Settings) bool {
	a, b := s.MediaInstances(), other.MediaInstances()
	if len(a) != len(b) {
		return true
	}
	for _, c := range a {
		old := other.GetService(c.ID)
		if dataConfig(c) != dataConfig(old) {
			return true
		}
	}
	return false
}
func (s *Server) decorateInstances(files []File) {
	cfg := s.Config()
	for i := range files {
		c := cfg.GetService(files[i].Service)
		files[i].Type = serviceKind(files[i].Service)
		files[i].InstanceName = instanceLabel(c)
	}
}

func (s *Store) activePredicate(alias string) string {
	var cfg Settings
	if s.Get("settings", &cfg) != nil || cfg.Instances == nil {
		return "1"
	}
	ids := []string{}
	for _, c := range cfg.ArrInstances() {
		if c.Enabled && serviceOK(c.ID) {
			ids = append(ids, "'"+c.ID+"'")
		}
	}
	if len(ids) == 0 {
		return "0"
	}
	return alias + "service IN (" + strings.Join(ids, ",") + ")"
}
func (s *Store) scopedWhere(q url.Values) (string, []any, error) {
	if raw := q.Get("_files"); raw != "" {
		var keys []FileKey
		if e := json.Unmarshal([]byte(raw), &keys); e != nil {
			return "", nil, fmt.Errorf("Invalid file selection")
		}
		if _, e := explicitSelection(nil, keys); e != nil {
			return "", nil, e
		}
		return "(f.service,f.id) IN (SELECT json_extract(value,'$.service'),json_extract(value,'$.id') FROM json_each(?)) AND " + s.activePredicate("f."), []any{raw}, nil
	}

	w, a, e := where(q)
	if e != nil {
		return w, a, e
	}
	return "(" + w + ") AND " + s.activePredicate("f."), a, nil
}

// Validation only: existing ownership fingerprints intentionally remain stable.
func duplicateInstanceEndpoint(c ServiceConfig) string {
	u, e := url.Parse(c.URL)
	if e != nil {
		return c.Type + ":" + c.URL
	}
	u.Scheme = strings.ToLower(u.Scheme)
	u.Host = strings.ToLower(u.Host)
	if u.Scheme == "http" && u.Port() == "80" || u.Scheme == "https" && u.Port() == "443" {
		host := u.Hostname()
		if strings.Contains(host, ":") {
			host = "[" + host + "]"
		}
		u.Host = host
	}
	u.Path = strings.TrimRight(u.Path, "/")
	if c.Type == "emby" {
		if strings.HasSuffix(strings.ToLower(u.Path), "/emby") {
			u.Path = u.Path[:len(u.Path)-len("/emby")] + "/emby"
		} else {
			u.Path += "/emby"
		}
	}
	return c.Type + ":" + u.String()
}
