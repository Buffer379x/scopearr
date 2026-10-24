package app

import (
	"fmt"
	"slices"
)

type MuxInfoLayout struct {
	Position int  `json:"position"`
	Visible  bool `json:"visible"`
}

// Keep the legacy five-value lists readable by 1.4.1. The optional JSON field
// is ignored by that version; no database migration or rollback reset is needed.
func settingsForStorage(cfg Settings) Settings {
	if pos := slices.Index(cfg.ListInfoOrder, "mux"); pos >= 0 {
		cfg.MuxInfo = &MuxInfoLayout{Position: pos, Visible: containsColumn(cfg.ListInfoVisible, "mux")}
		cfg.ListInfoOrder = slices.DeleteFunc(slices.Clone(cfg.ListInfoOrder), func(k string) bool { return k == "mux" })
		cfg.ListInfoVisible = slices.DeleteFunc(slices.Clone(cfg.ListInfoVisible), func(k string) bool { return k == "mux" })
	}
	return cfg
}

func defaultListInfoOrder() []string {
	return []string{"link", "media", "details", "metadata", "recognition", "mux"}
}

// Upgrade old layouts once, preserving the relative order and visibility of other columns.
func normalizeListInfo(cfg *Settings) error {
	legacy := cfg.ListInfoOrder == nil
	if legacy {
		cfg.ListInfoOrder = defaultListInfoOrder()
	}
	if cfg.ListInfoVisible == nil {
		cfg.ListInfoVisible = defaultListInfoOrder()
	}
	// Add the new action once to valid pre-0.9.5 layouts. Preserve explicit hidden choices.
	if len(cfg.ListInfoOrder) == 4 && !containsColumn(cfg.ListInfoOrder, "media") {
		seen := map[string]bool{}
		for _, key := range cfg.ListInfoOrder {
			if key != "link" && key != "details" && key != "metadata" && key != "recognition" || seen[key] {
				return fmt.Errorf("Invalid Info action selection or order")
			}
			seen[key] = true
		}
		order := []string{}
		for _, key := range cfg.ListInfoOrder {
			order = append(order, key)
			if key == "link" {
				order = append(order, "media")
			}
		}
		cfg.ListInfoOrder = order
		if containsColumn(cfg.ListInfoVisible, "link") && !containsColumn(cfg.ListInfoVisible, "media") {
			cfg.ListInfoVisible = append(cfg.ListInfoVisible, "media")
		}
	}
	if len(cfg.ListInfoOrder) == 5 && !containsColumn(cfg.ListInfoOrder, "mux") {
		seen := map[string]bool{}
		for _, key := range cfg.ListInfoOrder {
			if !containsColumn([]string{"link", "media", "details", "metadata", "recognition"}, key) || seen[key] {
				return fmt.Errorf("Invalid Info action selection or order")
			}
			seen[key] = true
		}
		position := len(cfg.ListInfoOrder)
		if cfg.MuxInfo != nil {
			position = min(max(cfg.MuxInfo.Position, 0), position)
		}
		cfg.ListInfoOrder = slices.Insert(cfg.ListInfoOrder, position, "mux")
		if (cfg.MuxInfo == nil || cfg.MuxInfo.Visible) && !containsColumn(cfg.ListInfoVisible, "mux") {
			cfg.ListInfoVisible = append(cfg.ListInfoVisible, "mux")
		}
	}
	allowed := map[string]bool{"link": true, "media": true, "details": true, "metadata": true, "recognition": true, "mux": true}
	if len(cfg.ListInfoOrder) != len(allowed) {
		return fmt.Errorf("Info order must include all actions")
	}
	for _, values := range [][]string{cfg.ListInfoOrder, cfg.ListInfoVisible} {
		seen := map[string]bool{}
		for _, value := range values {
			if !allowed[value] || seen[value] {
				return fmt.Errorf("Invalid Info action selection or order")
			}
			seen[value] = true
		}
	}
	for service, order := range cfg.ColumnOrder {
		if !containsColumn(order, "info") {
			cfg.ColumnOrder[service] = append([]string{"info"}, order...)
		}
	}
	if legacy {
		for service, visible := range cfg.VisibleColumns {
			if !containsColumn(visible, "info") {
				cfg.VisibleColumns[service] = append([]string{"info"}, visible...)
			}
		}
	}
	return nil
}
