package app

import (
	"errors"
	"log"
	"path/filepath"
	"sort"
	"strings"
	"unicode"
)

type MuxSettings struct {
	WorkDir        string            `json:"workDir"`
	Enabled        bool              `json:"enabled"`
	Channel        string            `json:"channel"`
	Mappings       string            `json:"mappings"`
	PathMappings   map[string]string `json:"pathMappings,omitempty"`
	DeleteOriginal bool              `json:"deleteOriginal"`
	NotifyMedia    bool              `json:"notifyMedia"`
	KeepFinished   int               `json:"keepFinished"`
}

func defaultMuxSettings() MuxSettings {
	return MuxSettings{Channel: "stable", DeleteOriginal: true, NotifyMedia: true, KeepFinished: 7}
}
func muxForbidden(p string) bool {
	for _, root := range []string{"/data", "/proc", "/sys", "/etc", "/usr", "/tmp", "/dev", "/bin", "/sbin", "/lib"} {
		if p == root || strings.HasPrefix(p, root+"/") {
			return true
		}
	}
	return p == "/" || !filepath.IsAbs(p)
}
func normalizeMux(cfg *Settings) error {
	if err := normalizeMediaInfo(cfg); err != nil {
		return err
	}
	m := &cfg.Mux
	if m.Channel == "" {
		workDir, mappings, legacy := m.WorkDir, m.Mappings, m.PathMappings
		*m = defaultMuxSettings()
		m.WorkDir, m.Mappings, m.PathMappings = workDir, mappings, legacy
	}
	if m.WorkDir != "" {
		if len(m.WorkDir) > 1024 || strings.ContainsFunc(m.WorkDir, unicode.IsControl) {
			return errors.New("Invalid mux working directory")
		}
		m.WorkDir = filepath.Clean(m.WorkDir)
		if muxForbidden(m.WorkDir) {
			return errors.New("Mux working directory must be outside Appdata and system directories")
		}
	}
	if m.Channel != "stable" && m.Channel != "edge" {
		return errors.New("Invalid MKVToolNix channel")
	}
	if m.KeepFinished < 0 || m.KeepFinished > 3650 {
		return errors.New("Invalid finished job retention")
	}
	if m.Mappings == "" && len(m.PathMappings) > 0 {
		ids := make([]string, 0, len(m.PathMappings))
		for id := range m.PathMappings {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		seen := map[string]string{}
		lines := []string{}
		for _, id := range ids {
			for _, line := range strings.Split(m.PathMappings[id], "\n") {
				if strings.TrimSpace(line) == "" {
					continue
				}
				parts, e := parsePathMappings(line)
				if e != nil || len(parts) != 1 {
					return errors.New(muxMappingError)
				}
				p := parts[0]
				if target, ok := seen[p.arr]; ok {
					if target != p.emby {
						log.Printf("Mux mapping conflict for Arr root %q: keeping the first mapping for %q", p.arr, p.arr)
					}
					continue
				}
				seen[p.arr] = p.emby
				lines = append(lines, strings.TrimSpace(line))
			}
		}
		m.Mappings = strings.Join(lines, "\n")
	}
	mappings, e := parsePathMappings(m.Mappings)
	if e != nil {
		return errors.New(muxMappingError)
	}
	for _, p := range mappings {
		if muxForbidden(filepath.Clean(p.emby)) {
			return errors.New("Media must be mounted outside Appdata and system directories")
		}
	}
	m.PathMappings = map[string]string{}
	for _, c := range cfg.ArrInstances() {
		m.PathMappings[c.ID] = m.Mappings
	}
	return nil
}

const muxMappingError = "Path mappings require unique absolute paths: Arr path => Scopearr path"
