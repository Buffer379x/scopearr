package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"
)

type StorageSelection struct {
	Name        string `json:"name,omitempty"`
	Path        string `json:"path"`
	SharedGroup string `json:"sharedGroup"`
}
type WidgetSettings struct {
	Order   []string                      `json:"order"`
	Visible []string                      `json:"visible"`
	Storage map[string][]StorageSelection `json:"storage"`
	Colors  map[string]string             `json:"colors"`
}
type DiskSpace struct {
	Path  string `json:"path"`
	Label string `json:"label"`
	Free  int64  `json:"freeSpace"`
	Total int64  `json:"totalSpace"`
}
type StorageSnapshot struct {
	Disks     []DiskSpace `json:"disks"`
	CheckedAt *time.Time  `json:"checkedAt"`
	SuccessAt *time.Time  `json:"successAt"`
	Error     string      `json:"error"`
	Source    string      `json:"-"`
}

// A storage area is one complete filesystem reading, never a sum of shares.
type StorageArea struct {
	Key   string   `json:"key"`
	Label string   `json:"label"`
	Paths []string `json:"paths"`
	Total int64    `json:"total"`
	Free  int64    `json:"free"`
	Used  int64    `json:"used"`
	Error string   `json:"error"`
}

func defaultWidgets() WidgetSettings {
	return WidgetSettings{Order: defaultDashboardOrder(), Visible: defaultDashboardOrder(), Storage: map[string][]StorageSelection{"radarr": {}, "sonarr": {}}, Colors: map[string]string{"used": "#729acb", "free": "#62b69d"}}
}
func defaultDashboardOrder() []string {
	return []string{"resolution", "codec", "source", "audio", "language", "storage"}
}
func normalizeDashboard(cfg *Settings) error {
	if cfg.PageSize == 0 {
		cfg.PageSize = 100
	}
	if cfg.PageSize < 1 || cfg.PageSize > 1000 {
		return errors.New("Entries per page must be between 1 and 1000")
	}
	defaults := defaultDashboardOrder()
	if cfg.Widgets.Order == nil {
		cfg.Widgets.Order = defaults
	}
	if cfg.Widgets.Visible == nil {
		cfg.Widgets.Visible = defaultDashboardOrder()
	}
	valid := map[string]bool{}
	for _, id := range defaults {
		valid[id] = true
	}
	for _, list := range [][]string{cfg.Widgets.Order, cfg.Widgets.Visible} {
		seen := map[string]bool{}
		for _, id := range list {
			if !valid[id] || seen[id] {
				return errors.New("Invalid dashboard widget selection")
			}
			seen[id] = true
		}
	}
	for _, id := range defaults {
		found := false
		for _, existing := range cfg.Widgets.Order {
			if existing == id {
				found = true
				break
			}
		}
		if !found {
			cfg.Widgets.Order = append(cfg.Widgets.Order, id)
			cfg.Widgets.Visible = append(cfg.Widgets.Visible, id)
		}
	}
	return nil
}
func normalizeSettings(cfg *Settings) error {
	if cfg.GroupSD == nil {
		enabled := true
		cfg.GroupSD = &enabled
	}
	if !*cfg.GroupSD {
		cfg.GroupSDLists = false
	}

	if err := normalizeDashboard(cfg); err != nil {
		return err
	}

	if cfg.Emby.SyncStart != "" || cfg.Emby.WebhookEnabled {
		return errors.New("Emby follows the Radarr/Sonarr schedule and has no webhook")
	}
	if cfg.SyncTimezone != "" {
		if _, e := time.LoadLocation(cfg.SyncTimezone); e != nil {
			return errors.New("Invalid sync timezone")
		}
	}
	if cfg.Widgets.Storage == nil {
		cfg.Widgets.Storage = defaultWidgets().Storage
	}
	if cfg.Widgets.Colors == nil {
		cfg.Widgets.Colors = defaultWidgets().Colors
	}
	for service, list := range cfg.Widgets.Storage {
		if !serviceOK(service) || len(list) > 128 {
			return errors.New("Invalid storage selection")
		}
		seen := map[string]bool{}
		for i, item := range list {
			list[i].SharedGroup = strings.TrimSpace(item.SharedGroup)
			list[i].Name = strings.TrimSpace(item.Name)
			if list[i].Name == "" {
				list[i].Name = item.Path
			}
			if item.Path == "" || len(item.Path) > 1024 || seen[item.Path] || len(list[i].SharedGroup) > 80 || len([]rune(list[i].Name)) > 160 || strings.ContainsAny(list[i].Name, "\r\n\x00") {
				return errors.New("Invalid storage selection")
			}
			seen[item.Path] = true
		}
	}
	for key, color := range cfg.Widgets.Colors {
		if (key != "used" && key != "free") || !tagColorPattern.MatchString(color) {
			return errors.New("Invalid storage color")
		}
	}
	for k, v := range defaultWidgets().Colors {
		if cfg.Widgets.Colors[k] == "" {
			cfg.Widgets.Colors[k] = v
		}
	}
	return nil
}
func storageAreas(cfg Settings, snap map[string]StorageSnapshot, scope string) []StorageArea {
	type sample struct {
		area         StorageArea
		at           time.Time
		valid        bool
		inconsistent bool
	}
	groups := map[string]*sample{}
	for _, service := range []string{"radarr", "sonarr"} {
		if scope != "all" && scope != service {
			continue
		}
		c := cfg.Radarr
		if service == "sonarr" {
			c = cfg.Sonarr
		}
		if !c.Enabled {
			continue
		}
		s := snap[service]
		index := map[string]DiskSpace{}
		for _, d := range s.Disks {
			index[d.Path] = d
		}
		for _, selection := range cfg.Widgets.Storage[service] {
			key, label := service+":"+selection.Path, selection.Name
			if label == "" {
				label = selection.Path
			}
			if selection.SharedGroup != "" {
				key = "shared:" + selection.SharedGroup
			}
			v := groups[key]
			if v == nil {
				v = &sample{area: StorageArea{Key: key, Label: label, Paths: []string{}}}
				groups[key] = v
			}
			v.area.Paths = append(v.area.Paths, service+" · "+selection.Path)
			if s.Error != "" {
				v.area.Error = "Storage readings are stale or unavailable"
			}
			if s.Source != tagEndpoint(c) || s.SuccessAt == nil {
				v.area.Error = "Storage readings are stale or unavailable"
				continue
			}
			d, ok := index[selection.Path]
			if !ok {
				v.area.Error = "A selected storage path is unavailable"
				continue
			}
			if d.Total < 0 || d.Free < 0 || d.Free > d.Total {
				v.area.Error = "Invalid storage capacity"
				continue
			}
			if v.valid && v.area.Total != d.Total {
				v.inconsistent = true
			}
			if !v.valid || s.SuccessAt.After(v.at) {
				v.area.Total, v.area.Free, v.area.Used = d.Total, d.Free, d.Total-d.Free
				v.at, v.valid = *s.SuccessAt, true
			}
		}
	}
	result := []StorageArea{}
	for _, v := range groups {
		if v.inconsistent {
			v.area.Total, v.area.Free, v.area.Used = 0, 0, 0
			v.area.Error = "Shared storage readings have different total capacities"
		}
		result = append(result, v.area)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Label < result[j].Label })
	return result
}
func (s *Server) storageHTTP(w http.ResponseWriter, r *http.Request) {
	snap, cfg := s.Background.Storage(), s.Config()
	areas := map[string][]StorageArea{}
	for _, scope := range []string{"all", "radarr", "sonarr"} {
		areas[scope] = storageAreas(cfg, snap, scope)
	}
	jsonOut(w, http.StatusOK, map[string]any{"services": snap, "areas": areas})
}
func (s *Server) storageRefreshHTTP(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Service string `json:"service"`
	}
	if e := decode(w, r, &in); e != nil || !serviceOK(in.Service) {
		failure(w, r, http.StatusBadRequest, errors.New("Invalid service"))
		return
	}
	if s.Demo {
		failure(w, r, http.StatusBadRequest, errors.New("Demo connections are locked"))
		return
	}
	if e := s.Background.RefreshStorage(r.Context(), in.Service); e != nil {
		failure(w, r, http.StatusBadGateway, e)
		return
	}
	s.storageHTTP(w, r)
}
func fetchStorage(ctx context.Context, c ServiceConfig) ([]DiskSpace, error) {
	var disks []DiskSpace
	if e := NewArr(c).get(ctx, "diskspace", nil, &disks); e != nil {
		return nil, e
	}
	seen := map[string]bool{}
	for _, d := range disks {
		if d.Path == "" || seen[d.Path] || d.Total < 0 || d.Free < 0 || d.Free > d.Total {
			return nil, fmt.Errorf("Invalid disk-space response")
		}
		seen[d.Path] = true
	}
	return disks, nil
}
