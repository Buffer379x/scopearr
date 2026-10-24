package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

// shareMetadata deliberately permits directory metadata only.
type shareMetadata interface {
	ReadDir(string) ([]os.DirEntry, error)
	Lstat(string) (os.FileInfo, error)
}

type ShareRootResolution struct {
	muxRootFolder
	Selection         string `json:"selection"`
	ShareDir          string `json:"shareDir"`
	AutomaticShareDir string `json:"automaticShareDir"`
	Status            string `json:"status"`
	Source            string `json:"source"`
}

type ShareDirectory struct {
	ShareDir    string   `json:"shareDir"`
	ArrPaths    []string `json:"arrPaths"`
	Instances   []string `json:"instances"`
	InstanceIDs []string `json:"instanceIds"`
	ExcludeDirs []string `json:"excludeDirs"`
}

type ShareRoots struct {
	Folders     []ShareRootResolution `json:"rootFolders"`
	Directories []ShareDirectory      `json:"shareDirectories"`
	Errors      []muxRootError        `json:"errors"`
}

// safeShareDirectory rejects symlinks at every ancestor, including configured roots.
// All operations are metadata-only. Callers still revalidate paths before a scan.
func safeShareDirectory(ctx context.Context, metadata shareMetadata, path string) (os.FileInfo, error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return nil, errors.New("Invalid directory path")
	}
	current := string(filepath.Separator)
	info, err := metadata.Lstat(current)
	if err != nil || !info.IsDir() {
		return nil, errors.New("Directory is unavailable")
	}
	for _, part := range strings.Split(strings.TrimPrefix(path, current), string(filepath.Separator)) {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if part == "" {
			continue
		}
		current = filepath.Join(current, part)
		info, err = metadata.Lstat(current)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return nil, errors.New("Directory is unavailable or is a symlink")
		}
	}
	return info, nil
}

func resolveShareRoot(ctx context.Context, cfg Settings, root muxRootFolder, metadata shareMetadata) ShareRootResolution {
	root.ArrPath = cleanMediaPath(root.ArrPath)
	out := ShareRootResolution{muxRootFolder: root, Status: "unresolved", Selection: cfg.Unraid.ShareDirs[root.ArrPath]}
	if !validShareArrPath(root.ArrPath) {
		return out
	}
	user := filepath.Join(cfg.Unraid.DiskRoot, "user")
	resolve := func(rel, source string) bool {
		if !validShareDir(rel) {
			return false
		}
		if _, err := safeShareDirectory(ctx, metadata, filepath.Join(user, rel)); err != nil {
			return false
		}
		out.ShareDir, out.Status, out.Source = rel, "resolved", source
		if source != "saved" {
			out.AutomaticShareDir = rel
		}
		return true
	}
	if out.Selection != "" {
		out.Source = "saved"
		if out.Selection == "-" {
			out.Status = "disabled"
			return out
		}
		resolve(out.Selection, "saved")
		return out
	}
	if ctx.Err() != nil {
		return out
	}
	if root.Mapped {
		if local, err := safeShareDirectory(ctx, metadata, root.LocalPath); err == nil {
			out.LocalExists = true
			same := func(rel string) bool {
				if !validShareDir(rel) {
					return false
				}
				info, err := safeShareDirectory(ctx, metadata, filepath.Join(user, rel))
				return err == nil && os.SameFile(local, info)
			}
			if rel, err := placementRel(cfg.Unraid.ShareRoot, root.LocalPath); err == nil && same(rel) {
				resolve(rel, "identity")
				return out
			}
			// Compare share roots only. Never ReadDir inside a candidate share.
			if _, err := safeShareDirectory(ctx, metadata, user); err == nil {
				if entries, err := metadata.ReadDir(user); err == nil {
					matches := []string{}
					for _, entry := range entries {
						if ctx.Err() != nil {
							return out
						}
						if entry.IsDir() && same(entry.Name()) {
							matches = append(matches, entry.Name())
						}
					}
					if len(matches) == 1 {
						resolve(matches[0], "identity")
						return out
					}
					if len(matches) > 1 {
						return out
					}
				}
			}
		}
	}
	resolve(filepath.Base(root.ArrPath), "name")
	return out
}

// resolveShareRoots fetches rootfolder only for selected enabled Arr instances.
// An empty libraries filter means all enabled libraries, matching scanner settings.
func (s *Server) resolveShareRoots(ctx context.Context, cfg Settings, libraries []string, metadata shareMetadata) ShareRoots {
	out := ShareRoots{Folders: []ShareRootResolution{}, Directories: []ShareDirectory{}, Errors: []muxRootError{}}
	roots := map[string]*muxRootFolder{}
	for _, c := range cfg.ArrInstances() {
		if !c.Enabled || (len(libraries) > 0 && !slices.Contains(libraries, c.ID)) {
			continue
		}
		var folders []struct {
			Path string `json:"path"`
		}
		if err := NewArr(c).get(ctx, "rootfolder", nil, &folders); err != nil {
			out.Errors = append(out.Errors, muxRootError{instanceLabel(c), "Root folders unavailable"})
			continue
		}
		for _, folder := range folders {
			path := cleanMediaPath(folder.Path)
			if !validShareArrPath(path) {
				continue
			}
			root := roots[path]
			if root == nil {
				root = &muxRootFolder{ArrPath: path, Instances: []string{}, InstanceIDs: []string{}}
				roots[path] = root
			}
			root.Instances = append(root.Instances, instanceLabel(c))
			root.InstanceIDs = append(root.InstanceIDs, c.ID)
		}
	}
	keys := make([]string, 0, len(roots))
	for key := range roots {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	for _, key := range keys {
		root := roots[key]
		root.Instances = sortedShareStrings(root.Instances)
		root.InstanceIDs = sortedShareStrings(root.InstanceIDs)
		root.LocalPath, root.Mapped = mappedMuxRoot(cfg.Mux.Mappings, root.ArrPath)
		out.Folders = append(out.Folders, resolveShareRoot(ctx, cfg, *root, metadata))
	}
	directories := map[string]*ShareDirectory{}
	for _, root := range out.Folders {
		if root.Status != "resolved" {
			continue
		}
		dir := directories[root.ShareDir]
		if dir == nil {
			dir = &ShareDirectory{ShareDir: root.ShareDir, ArrPaths: []string{}, Instances: []string{}, InstanceIDs: []string{}, ExcludeDirs: []string{}}
			directories[root.ShareDir] = dir
		}
		dir.ArrPaths = append(dir.ArrPaths, root.ArrPath)
		dir.Instances = append(dir.Instances, root.Instances...)
		dir.InstanceIDs = append(dir.InstanceIDs, root.InstanceIDs...)
	}
	for _, dir := range directories {
		dir.ArrPaths = sortedShareStrings(dir.ArrPaths)
		dir.Instances = sortedShareStrings(dir.Instances)
		dir.InstanceIDs = sortedShareStrings(dir.InstanceIDs)
		for child := range directories {
			if strings.HasPrefix(child, dir.ShareDir+"/") {
				dir.ExcludeDirs = append(dir.ExcludeDirs, strings.TrimPrefix(child, dir.ShareDir+"/"))
			}
		}
		slices.Sort(dir.ExcludeDirs)
		out.Directories = append(out.Directories, *dir)
	}
	slices.SortFunc(out.Directories, func(a, b ShareDirectory) int { return strings.Compare(a.ShareDir, b.ShareDir) })
	return out
}

func sortedShareStrings(values []string) []string {
	slices.Sort(values)
	return slices.Compact(values)
}
