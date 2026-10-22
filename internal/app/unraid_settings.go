package app

import (
	"errors"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"unicode"
)

type UnraidSettings struct {
	Enabled        bool     `json:"enabled"`
	DiskRoot       string   `json:"diskRoot"`
	ShareRoot      string   `json:"shareRoot"`
	StateDir       string   `json:"stateDir"`
	MuxSameDisk    bool     `json:"muxSameDisk"`
	Libraries      []string `json:"libraries"`
	SeriesGrouping string   `json:"seriesGrouping"`
	ExcludedDisks  []string `json:"excludedDisks"`
	ReserveGB      int      `json:"reserveGB"`
	// Mirrors ReserveGB so a rollback to 1.3.0 keeps the user's reserve.
	LegacyReserve  *int `json:"reserveGiB,omitempty"`
	VerifyChecksum bool `json:"verifyChecksum"`
}

func defaultUnraidSettings() UnraidSettings {
	return UnraidSettings{DiskRoot: "/unraid", ShareRoot: "/media", MuxSameDisk: true, SeriesGrouping: "series", ReserveGB: 20, Libraries: []string{}, ExcludedDisks: []string{}}
}

var unraidArrayName = regexp.MustCompile(`^disk[1-9][0-9]*$`)
var unraidDeviceName = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]*$`)

func unraidExcludedRoot(name string) bool {
	return strings.HasPrefix(name, ".") || slices.Contains([]string{"user", "user0", "disks", "remotes", "addons", "rootshare"}, name)
}

func normalizeUnraid(cfg *Settings) error {
	u := &cfg.Unraid
	// Older settings have no Unraid object. A populated object preserves explicit
	// false/zero values, especially a deliberately disabled checksum or reserve.
	if u.DiskRoot == "" && u.ShareRoot == "" && u.SeriesGrouping == "" {
		enabled, state := u.Enabled, u.StateDir
		*u = defaultUnraidSettings()
		u.Enabled, u.StateDir = enabled, state
	}
	if u.DiskRoot == "" {
		u.DiskRoot = "/unraid"
	}
	if u.ShareRoot == "" {
		u.ShareRoot = "/media"
	}
	if u.SeriesGrouping == "" {
		u.SeriesGrouping = "series"
	}
	paths := []*string{&u.DiskRoot, &u.ShareRoot, &u.StateDir}
	for i, p := range paths {
		if i == 2 && *p == "" {
			continue
		}
		if len(*p) > 1024 || strings.ContainsFunc(*p, unicode.IsControl) || !filepath.IsAbs(*p) {
			return errors.New("Invalid Unraid path")
		}
		*p = filepath.Clean(*p)
		if muxForbidden(*p) || pathWithin("/var/run", *p) || pathWithin("/run", *p) {
			return errors.New("Unraid paths must be outside Appdata and system directories")
		}
	}
	for i, a := range paths {
		for _, b := range paths[i+1:] {
			if *a != "" && *b != "" && (pathWithin(*a, *b) || pathWithin(*b, *a)) {
				return errors.New("Unraid paths must be separate and must not contain each other")
			}
		}
	}
	// 1.3.0 stored the reserve in GiB. The number carries over unchanged as GB.
	if u.LegacyReserve != nil && u.ReserveGB == 0 && *u.LegacyReserve != 0 {
		u.ReserveGB = *u.LegacyReserve
	}
	if u.ReserveGB < 0 || u.ReserveGB > 10240 {
		return errors.New("Free space reserve must be between 0 and 10240 GB")
	}
	reserve := u.ReserveGB
	u.LegacyReserve = &reserve
	if u.SeriesGrouping != "series" && u.SeriesGrouping != "season" {
		return errors.New("Invalid series grouping")
	}
	for _, name := range u.ExcludedDisks {
		if !unraidDeviceName.MatchString(name) || unraidExcludedRoot(name) || (strings.HasPrefix(name, "disk") && !unraidArrayName.MatchString(name)) {
			return errors.New("Invalid Unraid disk name")
		}
	}
	ids := map[string]bool{}
	for _, c := range cfg.ArrInstances() {
		ids[c.ID] = true
	}
	for _, id := range u.Libraries {
		if !ids[id] {
			return errors.New("Unknown library in Unraid settings")
		}
	}
	u.Libraries = slices.Clone(u.Libraries)
	u.ExcludedDisks = slices.Clone(u.ExcludedDisks)
	slices.Sort(u.Libraries)
	u.Libraries = slices.Compact(u.Libraries)
	slices.Sort(u.ExcludedDisks)
	u.ExcludedDisks = slices.Compact(u.ExcludedDisks)
	return nil
}

func unraidPrerequisite(cfg Settings) error {
	if !cfg.Unraid.Enabled {
		return errors.New("Enable Unraid disk placement first")
	}
	if !cfg.Mux.Enabled || strings.TrimSpace(cfg.Mux.Mappings) == "" {
		return errors.New("Enable the MKVToolNix service and configure path mappings first")
	}
	m, err := parsePathMappings(cfg.Mux.Mappings)
	if err != nil || len(m) == 0 {
		return errors.New(muxMappingError)
	}
	return nil
}
