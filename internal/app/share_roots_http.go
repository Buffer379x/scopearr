package app

import (
	"context"
	"errors"
	"net/http"
	"path/filepath"
	"slices"
	"time"
)

// listShareDirectories lists names at one explicitly requested level only.
// An empty parent is reserved for the top-level manual selection options.
func listShareDirectories(ctx context.Context, u UnraidSettings, parent string, metadata shareMetadata) ([]string, error) {
	out := []string{}
	if parent != "" && !validShareDir(parent) {
		return nil, errors.New("Invalid share directory")
	}
	path := filepath.Join(u.DiskRoot, "user", parent)
	if _, err := safeShareDirectory(ctx, metadata, path); err != nil {
		return nil, err
	}
	entries, err := metadata.ReadDir(path)
	if err != nil {
		return nil, errors.New("Share directories are unavailable")
	}
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		rel := filepath.Join(parent, entry.Name())
		if !entry.IsDir() || !validShareDir(rel) {
			continue
		}
		if _, err := safeShareDirectory(ctx, metadata, filepath.Join(path, entry.Name())); err == nil {
			out = append(out, rel)
		}
	}
	slices.Sort(out)
	return out, nil
}

func (s *Server) shareRootsHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		failure(w, r, 405, errors.New("Endpoint or method not supported"))
		return
	}
	if s.Demo {
		failure(w, r, 403, errors.New("Unraid operations are disabled in demo mode"))
		return
	}
	var in struct {
		Unraid   *UnraidSettings `json:"unraid"`
		Mappings *string         `json:"mappings"`
		Parent   string          `json:"parent"`
	}
	if err := decode(w, r, &in); err != nil {
		failure(w, r, 400, err)
		return
	}
	cfg := s.Config()
	if in.Unraid != nil {
		cfg.Unraid = *in.Unraid
	}
	if err := normalizeUnraid(&cfg); err != nil {
		failure(w, r, 400, err)
		return
	}
	if in.Mappings != nil {
		if _, err := parsePathMappings(*in.Mappings); err != nil {
			failure(w, r, 400, err)
			return
		}
		cfg.Mux.Mappings = *in.Mappings
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	metadata := placementOSMetadata{}
	if r.URL.Path == "/api/unraid/share-dirs" {
		if in.Parent == "" {
			failure(w, r, 400, errors.New("Choose a parent share directory"))
			return
		}
		directories, err := listShareDirectories(ctx, cfg.Unraid, in.Parent, metadata)
		if err != nil {
			failure(w, r, 400, err)
			return
		}
		jsonOut(w, 200, struct {
			Parent      string   `json:"parent"`
			Directories []string `json:"directories"`
		}{in.Parent, directories})
		return
	}
	result := struct {
		ShareRoots
		Choices []string `json:"choices"`
		Error   string   `json:"error,omitempty"`
	}{ShareRoots: s.resolveShareRoots(ctx, cfg, nil, metadata), Choices: []string{}}
	choices, err := listShareDirectories(ctx, cfg.Unraid, "", metadata)
	if err != nil {
		result.Error = "Share directories are unavailable"
	} else {
		result.Choices = choices
	}
	jsonOut(w, 200, result)
}
