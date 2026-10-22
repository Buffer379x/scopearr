package app

import (
	"errors"
	"path"
	"slices"
	"strconv"
	"strings"
	"unicode"
)

// Settings for Tools → Files & permissions. Modes are octal strings as shown to users.
type FileCheckSettings struct {
	Libraries     []string `json:"libraries"`
	Kinds         []string `json:"kinds"`
	OwnerUID      int      `json:"ownerUid"`
	OwnerGID      int      `json:"ownerGid"`
	FileMode      string   `json:"fileMode"`
	DirMode       string   `json:"dirMode"`
	Strict        bool     `json:"strict"`
	TakeOwnership bool     `json:"takeOwnership"`
	IncludeVideo  bool     `json:"includeVideo"`
	Allowed       []string `json:"allowed"`
	Ignore        []string `json:"ignore"`
}

var fileCheckKinds = []string{"permissions", "owner", "hidden", "junk", "orphan", "untracked_media", "other", "empty_dir"}

// Folder-wide names that never count as orphaned companions (Kodi/Emby/Jellyfin artwork and metadata).
var defaultFileCheckAllowed = []string{
	"movie.nfo", "tvshow.nfo", "season.nfo", "poster.*", "folder.*", "cover.*", "default.*", "movie.*", "show.*",
	"fanart.*", "backdrop*.*", "background.*", "art.*", "banner.*", "logo.*", "clearlogo.*", "clearart.*",
	"landscape.*", "thumb.*", "disc.*", "discart.*", "keyart.*", "season*-poster.*", "season*-banner.*",
	"season*-fanart.*", "season*-landscape.*", "season-all-*", "season-specials-*", "theme.*",
	"extrafanart/", "extrathumbs/", ".actors/",
}

func defaultFileCheckSettings() FileCheckSettings {
	return FileCheckSettings{Libraries: []string{}, Kinds: slices.Clone(fileCheckKinds), OwnerUID: 99, OwnerGID: 100, FileMode: "0666", DirMode: "0777", TakeOwnership: true, Allowed: slices.Clone(defaultFileCheckAllowed), Ignore: []string{}}
}

func parseFileMode(value string) (uint32, bool) {
	if len(value) != 4 || value[0] != '0' {
		return 0, false
	}
	n, e := strconv.ParseUint(value, 8, 32)
	return uint32(n), e == nil
}

func normalizeFileCheck(cfg *Settings) error {
	f := &cfg.FileCheck
	// Settings saved before 1.3.1 have no fileCheck object.
	if f.FileMode == "" && f.DirMode == "" && f.Kinds == nil {
		*f = defaultFileCheckSettings()
	}
	if f.Libraries == nil {
		f.Libraries = []string{}
	}
	if f.Ignore == nil {
		f.Ignore = []string{}
	}
	if f.Allowed == nil {
		f.Allowed = []string{}
	}
	fileMode, ok := parseFileMode(f.FileMode)
	if !ok || fileMode&0111 != 0 || fileMode&0600 != 0600 {
		return errors.New("File mode must be octal, readable and writable by the owner, without execute bits")
	}
	dirMode, ok := parseFileMode(f.DirMode)
	if !ok || dirMode&0700 != 0700 {
		return errors.New("Folder mode must be octal and include rwx for the owner")
	}
	if f.OwnerUID < 0 || f.OwnerUID > 65535 || f.OwnerGID < 0 || f.OwnerGID > 65535 {
		return errors.New("Owner UID and GID must be between 0 and 65535")
	}
	for _, kind := range f.Kinds {
		if !slices.Contains(fileCheckKinds, kind) {
			return errors.New("Unknown file check")
		}
	}
	for _, list := range [][]string{f.Allowed, f.Ignore} {
		if len(list) > 200 {
			return errors.New("Use at most 200 name patterns per list")
		}
		for _, pattern := range list {
			if pattern == "" || len(pattern) > 200 || strings.ContainsFunc(pattern, unicode.IsControl) {
				return errors.New("Invalid name pattern")
			}
			if _, e := path.Match(strings.TrimSuffix(pattern, "/"), ""); e != nil {
				return errors.New("Invalid name pattern")
			}
		}
	}
	ids := map[string]bool{}
	for _, c := range cfg.ArrInstances() {
		ids[c.ID] = true
	}
	for _, id := range f.Libraries {
		if !ids[id] {
			return errors.New("Unknown library in file check settings")
		}
	}
	for _, list := range []*[]string{&f.Libraries, &f.Kinds} {
		*list = slices.Clone(*list)
		slices.Sort(*list)
		*list = slices.Compact(*list)
	}
	return nil
}

// Same prerequisite as renaming: file operations need the mapped media mount.
func fileCheckPrerequisite(cfg Settings) error {
	if !cfg.Mux.Enabled || strings.TrimSpace(cfg.Mux.Mappings) == "" {
		return errors.New("Enable the MKVToolNix service and configure path mappings first")
	}
	if m, e := parsePathMappings(cfg.Mux.Mappings); e != nil || len(m) == 0 {
		return errors.New(muxMappingError)
	}
	return nil
}

// Physical copies for "Take ownership" need the Unraid disk mount.
func fileCheckPhysical(cfg Settings) bool {
	return cfg.Unraid.Enabled && unraidPrerequisite(cfg) == nil
}

func defaultFileCheckColumns() []string {
	return []string{"select", "actions", "title", "path", "kind", "current", "fix", "status", "progress", "remove"}
}
func normalizeFileCheckColumns(cfg *Settings) error {
	allowed := defaultFileCheckColumns()
	if cfg.FileCheckColumnOrder == nil {
		cfg.FileCheckColumnOrder = defaultFileCheckColumns()
	}
	if cfg.FileCheckVisibleColumns == nil {
		cfg.FileCheckVisibleColumns = defaultFileCheckColumns()
	}
	seen := map[string]bool{}
	if len(cfg.FileCheckColumnOrder) != len(allowed) || cfg.FileCheckColumnOrder[0] != "select" {
		return errors.New("File check column order must include all columns, with selection first")
	}
	for _, key := range cfg.FileCheckColumnOrder {
		if !containsColumn(allowed, key) || seen[key] {
			return errors.New("Invalid file check column order")
		}
		seen[key] = true
	}
	seen = map[string]bool{}
	for _, key := range cfg.FileCheckVisibleColumns {
		if !containsColumn(allowed, key) || seen[key] {
			return errors.New("Invalid file check column selection")
		}
		seen[key] = true
	}
	if !seen["select"] {
		return errors.New("File check selection must remain visible")
	}
	return nil
}
