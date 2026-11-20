package app

import (
	"maps"
	"slices"
)

// settingsReset names one stored display value this version does not know.
type settingsReset struct{ Setting, Value string }

// legacyLibraryColumns are older column names that normalizeVisibleColumns
// still migrates, so they count as known.
var legacyLibraryColumns = []string{"language"}

// tolerateUnknownSettings removes display values unknown to this version, and
// duplicates, from settings loaded at startup. A newer version may have saved
// them; this version then starts with its defaults instead of failing. The
// correction stays in memory. Saving through PUT /api/settings never calls this
// and keeps rejecting unknown values. Order lists that lost a value regain the
// missing known values in default order, unless the existing layout upgrades
// add them at their own position.
func tolerateUnknownSettings(cfg *Settings) []settingsReset {
	t := settingsTolerance{seen: map[settingsReset]bool{}}
	if cfg.InterfaceTheme != "" && !slices.Contains(interfaceThemes, cfg.InterfaceTheme) {
		t.reset("interfaceTheme", cfg.InterfaceTheme)
		cfg.InterfaceTheme = "default"
	}

	// normalizeDashboard appends missing widgets to the order and the visible list.
	widgets := defaultDashboardOrder()
	cfg.Widgets.Order, _ = t.clean("widgets", cfg.Widgets.Order, widgets)
	cfg.Widgets.Visible, _ = t.clean("widgets", cfg.Widgets.Visible, widgets)

	columns := slices.Concat(libraryColumns, legacyLibraryColumns)
	for _, layout := range []map[string][]string{cfg.VisibleColumns, cfg.ColumnOrder} {
		for _, service := range slices.Sorted(maps.Keys(layout)) {
			if service != "radarr" && service != "sonarr" {
				t.reset("columns", service)
				delete(layout, service)
			}
		}
	}
	for _, service := range slices.Sorted(maps.Keys(cfg.VisibleColumns)) {
		cfg.VisibleColumns[service], _ = t.clean("columns."+service, cfg.VisibleColumns[service], columns)
	}
	for _, service := range slices.Sorted(maps.Keys(cfg.ColumnOrder)) {
		order, removed := t.clean("columns."+service, cfg.ColumnOrder[service], columns)
		if removed {
			// normalizeVisibleColumns adds info, custom and processing (after
			// source) itself and turns the legacy language column into audio.
			order = appendMissing(order, libraryColumns, func(column string) bool {
				return column == "info" || column == "custom" || column == "processing" && slices.Contains(order, "source") || column == "audio" && slices.Contains(order, "language")
			})
		}
		cfg.ColumnOrder[service] = order
	}

	info := defaultListInfoOrder()
	order, removed := t.clean("listInfo", cfg.ListInfoOrder, info)
	if removed {
		// normalizeListInfo inserts media after link in four-action lists and
		// mux at its saved position in five-action lists.
		order = appendMissing(order, info, func(key string) bool { return key == "mux" || key == "media" })
		if !slices.Contains(order, "media") && (len(order) != 4 || slices.Contains(order, "mux")) {
			order = append(order, "media")
		}
	}
	cfg.ListInfoOrder = order
	cfg.ListInfoVisible, _ = t.clean("listInfo", cfg.ListInfoVisible, info)

	placement := defaultPlacementColumns()
	order, removed = t.clean("placementColumns", cfg.PlacementColumnOrder, placement)
	if removed {
		// normalizePlacementColumns appends a missing remove column, visible.
		order = selectFirst(appendMissing(order, placement, func(key string) bool { return key == "remove" }))
	}
	cfg.PlacementColumnOrder = order
	cfg.PlacementVisibleColumns, _ = t.clean("placementColumns", cfg.PlacementVisibleColumns, placement)

	filecheck := defaultFileCheckColumns()
	order, removed = t.clean("filecheckColumns", cfg.FileCheckColumnOrder, filecheck)
	if removed {
		order = selectFirst(appendMissing(order, filecheck, func(string) bool { return false }))
	}
	cfg.FileCheckColumnOrder = order
	cfg.FileCheckVisibleColumns, _ = t.clean("filecheckColumns", cfg.FileCheckVisibleColumns, filecheck)
	return t.resets
}

type settingsTolerance struct {
	resets []settingsReset
	seen   map[settingsReset]bool
}

// reset records one warning per setting and value, even when the value
// appears in both the order and the visible list.
func (t *settingsTolerance) reset(setting, value string) {
	r := settingsReset{Setting: setting, Value: value}
	if !t.seen[r] {
		t.seen[r] = true
		t.resets = append(t.resets, r)
	}
}

// clean drops unknown values and duplicates. A nil list stays nil, because
// the normalizers treat a missing list as a legacy layout.
func (t *settingsTolerance) clean(setting string, list, known []string) ([]string, bool) {
	if list == nil {
		return nil, false
	}
	out := make([]string, 0, len(list))
	for _, value := range list {
		if !slices.Contains(known, value) {
			t.reset(setting, value)
			continue
		}
		if !slices.Contains(out, value) {
			out = append(out, value)
		}
	}
	if len(out) == len(list) {
		return list, false
	}
	return out, true
}

func appendMissing(order, defaults []string, skip func(string) bool) []string {
	for _, value := range defaults {
		if !slices.Contains(order, value) && !skip(value) {
			order = append(order, value)
		}
	}
	return order
}

// selectFirst keeps the selection column in front, as tool tables require.
func selectFirst(order []string) []string {
	if i := slices.Index(order, "select"); i > 0 {
		order = slices.Insert(slices.Delete(order, i, i+1), 0, "select")
	}
	return order
}
