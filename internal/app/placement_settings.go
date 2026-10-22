package app

import "errors"

func defaultPlacementColumns() []string {
	return []string{"select", "actions", "title", "service", "size", "disks", "target", "move", "kind", "status", "progress", "remove"}
}
func normalizePlacementColumns(cfg *Settings) error {
	allowed := defaultPlacementColumns()
	if cfg.PlacementColumnOrder == nil {
		cfg.PlacementColumnOrder = defaultPlacementColumns()
	}
	if cfg.PlacementVisibleColumns == nil {
		cfg.PlacementVisibleColumns = defaultPlacementColumns()
	}
	// 1.3.1 added "remove"; older saved layouts gain it at the end, visible.
	if !containsColumn(cfg.PlacementColumnOrder, "remove") {
		cfg.PlacementColumnOrder = append(append([]string{}, cfg.PlacementColumnOrder...), "remove")
		if !containsColumn(cfg.PlacementVisibleColumns, "remove") {
			cfg.PlacementVisibleColumns = append(append([]string{}, cfg.PlacementVisibleColumns...), "remove")
		}
	}
	seen := map[string]bool{}
	if len(cfg.PlacementColumnOrder) != len(allowed) || cfg.PlacementColumnOrder[0] != "select" {
		return errors.New("Disk placement column order must include all columns, with selection first")
	}
	for _, key := range cfg.PlacementColumnOrder {
		if !containsColumn(allowed, key) || seen[key] {
			return errors.New("Invalid disk placement column order")
		}
		seen[key] = true
	}
	seen = map[string]bool{}
	for _, key := range cfg.PlacementVisibleColumns {
		if !containsColumn(allowed, key) || seen[key] {
			return errors.New("Invalid disk placement column selection")
		}
		seen[key] = true
	}
	if !seen["select"] {
		return errors.New("Disk placement selection must remain visible")
	}
	return nil
}
