package app

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
)

// PlacementShare summarizes one scanned share directory. Counts describe the
// folders found directly on the devices, independent of Arr path mappings.
type PlacementShare struct {
	ShareDir     string   `json:"shareDir"`
	ArrPaths     []string `json:"arrPaths"`
	Instances    []string `json:"instances"`
	Devices      []string `json:"devices"`
	Folders      int      `json:"folders"`
	Several      int      `json:"several"`
	OneDisk      int      `json:"oneDisk"`
	WithArr      int      `json:"withArr"`
	WithoutArr   int      `json:"withoutArr"`
	ArrMissing   int      `json:"arrMissing"`
	DeviceErrors []string `json:"deviceErrors"`
	Notice       string   `json:"notice,omitempty"`
}

// PlacementRootFolder reports how an Arr root folder was resolved and how many
// Arr entries it holds, including roots that were not scanned.
type PlacementRootFolder struct {
	ShareRootResolution
	Items int `json:"items"`
}

func clonePlacementShares(shares []PlacementShare) []PlacementShare {
	out := slices.Clone(shares)
	for n := range out {
		out[n].ArrPaths = slices.Clone(out[n].ArrPaths)
		out[n].Instances = slices.Clone(out[n].Instances)
		out[n].Devices = slices.Clone(out[n].Devices)
		out[n].DeviceErrors = slices.Clone(out[n].DeviceErrors)
	}
	return out
}

func clonePlacementRootFolders(roots []PlacementRootFolder) []PlacementRootFolder {
	out := slices.Clone(roots)
	for n := range out {
		out[n].Instances = slices.Clone(out[n].Instances)
		out[n].InstanceIDs = slices.Clone(out[n].InstanceIDs)
	}
	return out
}

// Recycle bins, Synology/Unraid metadata and hidden folders are never media items.
func placementShareEntry(entry os.DirEntry) bool {
	name := entry.Name()
	if !entry.IsDir() || entry.Type()&fs.ModeSymlink != 0 || name == "" {
		return false
	}
	return !strings.HasPrefix(name, ".") && !strings.HasPrefix(name, "@") && !strings.HasPrefix(name, "#")
}

type placementArrRef struct {
	folder arrFolder
	share  string
	rel    string
}

// shareItems builds the scan from the share directories of the selected Arr
// root folders. Each share directory is listed once per device; Arr entries
// only contribute titles and identities. Folders on one device need no walk.
func (p *PlacementManager) shareItems(ctx context.Context, cfg Settings, disks []UnraidDisk, result *PlacementScan) ([]PlacementItem, error) {
	resolved := p.s.resolveShareRoots(ctx, cfg, cfg.Unraid.Libraries, p.metadata)
	if e := ctx.Err(); e != nil {
		return nil, e
	}
	folders, e := p.s.arrFolderList(ctx, cfg, cfg.Unraid.Libraries, false)
	if e != nil {
		return nil, e
	}
	roots := make([]PlacementRootFolder, len(resolved.Folders))
	for n, root := range resolved.Folders {
		roots[n] = PlacementRootFolder{ShareRootResolution: root}
	}
	shares := map[string]*PlacementShare{}
	for _, dir := range resolved.Directories {
		shares[dir.ShareDir] = &PlacementShare{ShareDir: dir.ShareDir, ArrPaths: dir.ArrPaths, Instances: dir.Instances, Devices: []string{}, DeviceErrors: []string{}}
	}

	refs := []placementArrRef{}
	exact := map[string]int{}
	folded := map[string][]int{}
	for _, folder := range folders {
		folder.Source = cleanArrRoot(folder.Source)
		best := -1
		for n, root := range roots {
			if slices.Contains(root.InstanceIDs, folder.Service) && pathWithin(root.ArrPath, folder.Source) && (best < 0 || len(root.ArrPath) > len(roots[best].ArrPath)) {
				best = n
			}
		}
		if best < 0 {
			continue
		}
		roots[best].Items++
		root := roots[best]
		if root.Status != "resolved" {
			continue
		}
		suffix := strings.TrimPrefix(strings.TrimPrefix(folder.Source, root.ArrPath), "/")
		first, _, _ := strings.Cut(suffix, "/")
		rel := filepath.Join(root.ShareDir, first)
		if first == "" || first == "." || first == ".." || !validPlacementRel(rel) {
			continue
		}
		if _, duplicate := exact[rel]; duplicate {
			continue
		}
		exact[rel] = len(refs)
		folded[strings.ToLower(rel)] = append(folded[strings.ToLower(rel)], len(refs))
		refs = append(refs, placementArrRef{folder: folder, share: root.ShareDir, rel: rel})
	}

	items := []PlacementItem{}
	used := make([]bool, len(refs))
	for _, dir := range resolved.Directories {
		share := shares[dir.ShareDir]
		names := map[string][]string{}
		for _, disk := range disks {
			if e := ctx.Err(); e != nil {
				return nil, e
			}
			p.mu.Lock()
			p.scan.Disk = disk.Name
			p.mu.Unlock()
			share.Devices = append(share.Devices, disk.Name)
			entries, e := p.metadata.ReadDir(filepath.Join(cfg.Unraid.DiskRoot, disk.Name, dir.ShareDir))
			if e != nil {
				if !os.IsNotExist(e) {
					share.DeviceErrors = append(share.DeviceErrors, disk.Name)
				}
				continue
			}
			for _, entry := range entries {
				name := entry.Name()
				if !placementShareEntry(entry) || slices.Contains(dir.ExcludeDirs, name) || !validPlacementRel(filepath.Join(dir.ShareDir, name)) {
					continue
				}
				names[name] = append(names[name], disk.Name)
			}
		}
		keys := make([]string, 0, len(names))
		for name := range names {
			keys = append(keys, name)
		}
		slices.Sort(keys)
		for _, name := range keys {
			devices := names[name]
			rel := filepath.Join(dir.ShareDir, name)
			item := PlacementItem{Key: "folder:" + rel, Title: name, Rel: rel, present: devices}
			idx, ok := exact[rel]
			if !ok {
				if candidates := folded[strings.ToLower(rel)]; len(candidates) == 1 {
					idx, ok = candidates[0], true
				}
			}
			var ref *placementArrRef
			if ok && !used[idx] {
				used[idx] = true
				ref = &refs[idx]
				f := ref.folder
				item.Key = f.Type + ":" + f.Service + ":" + strconv.Itoa(f.MediaID)
				item.Service, item.Instance, item.MediaID, item.Title = f.Service, f.Instance, f.MediaID, f.Title
				share.WithArr++
			} else {
				share.WithoutArr++
			}
			share.Folders++
			if len(devices) < 2 {
				share.OneDisk++
				item.ScanStatus = "ok"
				item.skipInspect = true
				item.Disks = map[string]PlacementDisk{devices[0]: {}}
				items = append(items, item)
				continue
			}
			share.Several++
			if ref == nil || ref.folder.Type != "sonarr" || cfg.Unraid.SeriesGrouping != "season" {
				items = append(items, item)
				continue
			}
			expanded, e := p.seasonItems(cfg, item)
			if e != nil {
				return nil, e
			}
			items = append(items, expanded...)
		}
		if share.Folders == 0 {
			share.Notice = "No folders were found in this share on any device."
		}
	}
	for idx, ref := range refs {
		if used[idx] {
			continue
		}
		f := ref.folder
		shares[ref.share].ArrMissing++
		items = append(items, PlacementItem{Key: f.Type + ":" + f.Service + ":" + strconv.Itoa(f.MediaID), Service: f.Service, Instance: f.Instance, MediaID: f.MediaID, Title: f.Title, Rel: ref.rel, ScanStatus: "not_found", Message: "Folder not found on any disk: " + ref.rel, skipInspect: true})
	}
	result.RootFolders = roots
	result.Shares = []PlacementShare{}
	for _, dir := range resolved.Directories {
		result.Shares = append(result.Shares, *shares[dir.ShareDir])
	}
	return items, nil
}

// seasonItems splits a series folder on several devices into its root-only
// companion and season folders, keeping the devices each one exists on.
func (p *PlacementManager) seasonItems(cfg Settings, item PlacementItem) ([]PlacementItem, error) {
	seasons := map[string][]string{}
	for _, disk := range item.present {
		entries, e := p.metadata.ReadDir(filepath.Join(cfg.Unraid.DiskRoot, disk, item.Rel))
		if e != nil && !os.IsNotExist(e) {
			return nil, errors.New("Could not read series season folders")
		}
		for _, entry := range entries {
			if placementShareEntry(entry) {
				seasons[entry.Name()] = append(seasons[entry.Name()], disk)
			}
		}
	}
	root := item
	v := -1
	root.Season = &v
	root.Key += ":root"
	root.Title += " · Series folder"
	out := []PlacementItem{root}
	names := make([]string, 0, len(seasons))
	for name := range seasons {
		names = append(names, name)
	}
	slices.Sort(names)
	for _, name := range names {
		season := item
		n := 0
		_, _ = fmt.Sscanf(name, "Season %d", &n)
		season.Season = &n
		season.Key += ":season:" + name
		season.Rel = filepath.Join(item.Rel, name)
		season.Title += " · " + name
		season.present = seasons[name]
		out = append(out, season)
	}
	return out, nil
}
