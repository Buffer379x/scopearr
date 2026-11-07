package app

import (
	"errors"
	"slices"
)

// interfaceThemes are the palettes this version can show.
var interfaceThemes = []string{"default", "nord", "catppuccin", "graphite", "slate", "ocean", "atlantic", "forest", "sage", "sandstone", "copper", "coffee", "midnight", "ink", "steel", "mist", "linen", "charcoal"}

func normalizeInterfaceTheme(cfg *Settings) error {
	if cfg.InterfaceTheme == "" {
		cfg.InterfaceTheme = "default"
	}
	if !slices.Contains(interfaceThemes, cfg.InterfaceTheme) {
		return errors.New("Invalid interface theme")
	}
	return nil
}
