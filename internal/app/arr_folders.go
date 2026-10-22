package app

import (
	"context"
	"errors"
	"path/filepath"
	"slices"
)

// One Radarr movie or Sonarr series folder, mapped into Scopearr's namespace.
type arrFolder struct {
	Service  string
	Type     string
	Instance string
	MediaID  int
	Title    string
	Local    string
	Err      error
}

// Folder paths come from the Arr API (movie/series "path"); a missing path falls
// back to the folder of a cached file. Shared by disk placement and file checks.
func (s *Server) arrFolders(ctx context.Context, cfg Settings, libraries []string) ([]arrFolder, error) {
	out := []arrFolder{}
	for _, c := range cfg.ArrInstances() {
		if !c.Enabled || len(libraries) > 0 && !slices.Contains(libraries, c.ID) {
			continue
		}
		var data []struct {
			ID    int    `json:"id"`
			Title string `json:"title"`
			Path  string `json:"path"`
		}
		route := "movie"
		if c.Type == "sonarr" {
			route = "series"
		}
		if e := NewArr(c).get(ctx, route, nil, &data); e != nil {
			return nil, errors.New("Could not read library folders: " + instanceLabel(c))
		}
		for _, media := range data {
			folder := arrFolder{Service: c.ID, Type: c.Type, Instance: instanceLabel(c), MediaID: media.ID, Title: media.Title}
			source := media.Path
			if source == "" {
				var cached string
				e := s.Store.DB.QueryRowContext(ctx, "SELECT source_path FROM files WHERE service=? AND media_id=? AND source_path<>'' ORDER BY id LIMIT 1", c.ID, media.ID).Scan(&cached)
				if e == nil {
					source = filepath.Dir(cached)
				}
			}
			folder.Local, folder.Err = resolveLocalDir(cfg.Mux, source)
			out = append(out, folder)
		}
	}
	return out, nil
}
