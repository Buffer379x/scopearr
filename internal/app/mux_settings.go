package app

import (
	"errors"
	"path/filepath"
	"strings"
)

type MuxSettings struct {
	Enabled        bool              `json:"enabled"`
	Channel        string            `json:"channel"`
	PathMappings   map[string]string `json:"pathMappings"`
	DeleteOriginal bool              `json:"deleteOriginal"`
	NotifyMedia    bool              `json:"notifyMedia"`
	KeepFinished   int               `json:"keepFinished"`
}

func defaultMuxSettings() MuxSettings {
	return MuxSettings{Channel: "stable", PathMappings: map[string]string{}, DeleteOriginal: true, NotifyMedia: true, KeepFinished: 7}
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
	m := &cfg.Mux
	if m.Channel == "" {
		*m = defaultMuxSettings()
	}
	if m.Channel != "stable" && m.Channel != "edge" {
		return errors.New("Invalid MKVToolNix channel")
	}
	if m.KeepFinished < 0 || m.KeepFinished > 3650 {
		return errors.New("Invalid finished job retention")
	}
	for id, value := range m.PathMappings {
		found := false
		for _, c := range cfg.ArrInstances() {
			if c.ID == id {
				found = true
			}
		}
		if !found {
			return errors.New("Unknown library in mux path mappings")
		}
		mappings, e := parsePathMappings(value)
		if e != nil {
			return errors.New("Path mappings require unique absolute paths: Arr path => Scopearr path")
		}
		for _, p := range mappings {
			if muxForbidden(filepath.Clean(p.emby)) {
				return errors.New("Media must be mounted outside Appdata and system directories")
			}
		}
	}
	return nil
}
