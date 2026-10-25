package app

import (
	"encoding/json"
	"fmt"
	"reflect"
	"slices"
	"sort"
	"strings"
)

func settingsSnapshot(cfg Settings) map[string]any {
	raw, _ := json.Marshal(cfg)
	snapshot := map[string]any{}
	_ = json.Unmarshal(raw, &snapshot)
	for _, key := range []string{"radarr", "sonarr", "emby", "jellyfin"} {
		delete(snapshot, key)
	}
	instances := map[string]any{}
	for _, instance := range cfg.AllInstances() {
		raw, _ = json.Marshal(instance)
		fields := map[string]any{}
		_ = json.Unmarshal(raw, &fields)
		delete(fields, "hasKey")
		delete(fields, "clearKey")
		instances[instance.ID] = fields
	}
	snapshot["instances"] = instances
	return snapshot
}

func settingsChangeArea(path string, before, after Settings) string {
	if strings.HasPrefix(path, "instances[") {
		id, _, _ := strings.Cut(strings.TrimPrefix(path, "instances["), "]")
		instance := after.GetService(id)
		if instance.Name == "" && instance.URL == "" {
			instance = before.GetService(id)
		}
		area := "Services"
		if mediaProviderOK(id) {
			area = "Media servers"
		}
		return area + " · " + instanceLabel(instance)
	}
	key, _, _ := strings.Cut(path, ".")
	switch key {
	case "mux":
		return "MKVToolNix"
	case "unraid":
		return "Unraid"
	case "fileCheck":
		return "Files & permissions"
	case "widgets":
		return "Widgets"
	case "syncTimezone":
		return "Synchronization schedule"
	case "columnOrder", "visibleColumns", "filecheckColumnOrder", "filecheckVisibleColumns", "placementColumnOrder", "placementVisibleColumns", "listInfoOrder", "listInfoVisible", "muxInfo", "muxColumnOrder", "muxVisibleColumns":
		return "Lists & columns"
	case "tagColors", "tagTextColors", "warningColors", "hiddenTags":
		return "Colors"
	default:
		return "Display"
	}
}

func settingsFieldPath(parent, key string) string {
	if parent == "" {
		return key
	}
	if slices.Contains([]string{"instances", "unraid.shareDirs", "mux.pathMappings", "columnOrder", "visibleColumns", "tagColors", "tagTextColors", "warningColors", "hiddenTags", "widgets.storage", "widgets.colors"}, parent) {
		return parent + "[" + key + "]"
	}
	return parent + "." + key
}

// Details are field-level changes in stable order. Credentials never reach a
// formatted value: redactEvent remains the second boundary before persistence.
func settingsChanges(before, after Settings) (areas, details []string) {
	seen := map[string]bool{}
	changes := 0
	var walk func(string, any, any)
	walk = func(path string, old, next any) {
		if reflect.DeepEqual(old, next) {
			return
		}
		oldMap, oldOK := old.(map[string]any)
		nextMap, nextOK := next.(map[string]any)
		if (oldOK || old == nil) && (nextOK || next == nil) && (oldOK || nextOK) {
			keys := []string{}
			for k := range oldMap {
				keys = append(keys, k)
			}
			for k := range nextMap {
				if _, ok := oldMap[k]; !ok {
					keys = append(keys, k)
				}
			}
			sort.Strings(keys)
			for _, key := range keys {
				walk(settingsFieldPath(path, key), oldMap[key], nextMap[key])
			}
			return
		}
		area := settingsChangeArea(path, before, after)
		if !seen[area] {
			seen[area] = true
			areas = append(areas, area)
		}
		changes++
		if len(details) >= 50 {
			return
		}
		lower := strings.ToLower(path)
		for _, secret := range []string{"apikey", "password", "token", "secret", "authorization", "cookie"} {
			if strings.Contains(lower, secret) {
				details = append(details, redactEvent(path+": changed"))
				return
			}
		}
		value := func(v any) string {
			if v == nil {
				if strings.HasPrefix(path, "unraid.shareDirs[") {
					return "(automatic)"
				}
				return "(none)"
			}
			if text, ok := v.(string); ok {
				if text == "" && strings.HasPrefix(path, "unraid.shareDirs[") {
					return "(automatic)"
				}
				return text
			}
			raw, _ := json.Marshal(v)
			return string(raw)
		}
		details = append(details, redactEvent(path+": "+value(old)+" → "+value(next)))
	}
	walk("", settingsSnapshot(before), settingsSnapshot(after))
	if changes > 50 {
		details = append(details, fmt.Sprintf("… and %d more", changes-50))
	}
	return areas, details
}
