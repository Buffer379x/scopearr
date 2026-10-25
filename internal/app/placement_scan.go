package app

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const placementFileLimit = 500000

var errPlacementLimit = errors.New("Too many files to plan at once; select fewer libraries or group series by season")

// The scanner's dependency exposes only metadata operations, never file Open.
// WalkDir reads directories and DirEntry.Info obtains lstat metadata.
type placementMetadata interface {
	ReadDir(string) ([]os.DirEntry, error)
	Lstat(string) (os.FileInfo, error)
	WalkDir(string, fs.WalkDirFunc) error
	EvalSymlinks(string) (string, error)
}
type placementOSMetadata struct{}

func (placementOSMetadata) EvalSymlinks(p string) (string, error)    { return filepath.EvalSymlinks(p) }
func (placementOSMetadata) ReadDir(p string) ([]os.DirEntry, error)  { return os.ReadDir(p) }
func (placementOSMetadata) Lstat(p string) (os.FileInfo, error)      { return os.Lstat(p) }
func (placementOSMetadata) WalkDir(p string, f fs.WalkDirFunc) error { return filepath.WalkDir(p, f) }

type PlacementManager struct {
	s            *Server
	mu           sync.Mutex
	once         sync.Once
	wg           sync.WaitGroup
	scan         PlacementScan
	scanCancel   context.CancelFunc
	cancel       context.CancelFunc
	active       int64
	pendingFinal *PlacementItem
	metadata     placementMetadata
	testCopy     func(context.Context, *os.File, *os.File, func(int64)) error
}

func NewPlacementManager(s *Server) *PlacementManager {
	p := &PlacementManager{s: s, metadata: placementOSMetadata{}}
	p.scan, _ = s.Store.placementScan()
	return p
}

func placementMappingHash(cfg Settings) string {
	payload, _ := json.Marshal(struct {
		Mappings  string            `json:"mappings"`
		ShareDirs map[string]string `json:"shareDirs,omitempty"`
	}{cfg.Mux.Mappings, cfg.Unraid.ShareDirs})
	return fmt.Sprintf("%x", sha256.Sum256(payload))
}

func (p *PlacementManager) planSettingsMatch(cfg Settings) bool {
	previous, e := p.s.Store.placementScan()
	return e == nil && previous.Options.DiskRoot == cfg.Unraid.DiskRoot && previous.Options.ShareRoot == cfg.Unraid.ShareRoot && previous.MappingHash == placementMappingHash(cfg)
}
func (p *PlacementManager) scanStatus() PlacementScan {
	p.mu.Lock()
	defer p.mu.Unlock()
	return clonePlacementScan(p.scan)
}

func clonePlacementScan(scan PlacementScan) PlacementScan {
	scan.Roots = cloneScanRoots(scan.Roots)
	scan.Shares = clonePlacementShares(scan.Shares)
	scan.RootFolders = clonePlacementRootFolders(scan.RootFolders)
	scan.Counts = maps.Clone(scan.Counts)
	scan.Targets = slices.Clone(scan.Targets)
	for n := range scan.Targets {
		scan.Targets[n].Sources = maps.Clone(scan.Targets[n].Sources)
	}
	scan.Options.ShareDirs = maps.Clone(scan.Options.ShareDirs)
	scan.Options.Libraries = slices.Clone(scan.Options.Libraries)
	scan.Options.ExcludedDisks = slices.Clone(scan.Options.ExcludedDisks)
	return scan
}
func placementRel(root, path string) (string, error) {
	rel, e := filepath.Rel(root, path)
	if e != nil || !validPlacementRel(rel) {
		return "", errors.New("Folder is outside the user share")
	}
	return rel, nil
}
func validPlacementRel(rel string) bool {
	return rel != "" && rel != "." && filepath.IsLocal(rel) && filepath.Clean(rel) == rel && !strings.ContainsAny(rel, "\x00\r\n")
}

// Mapping directory paths does not require the item to exist in the share.
// Existing ancestors still cannot escape the configured mapping through symlinks.
func resolveLocalDir(m MuxSettings, arrPath string) (string, error) {
	mappings, e := parsePathMappings(m.Mappings)
	if e != nil {
		return "", errors.New(muxMappingError)
	}
	for _, mapping := range mappings {
		arr := cleanMediaPath(arrPath)
		if !pathWithin(mapping.arr, arr) {
			continue
		}
		root := filepath.Clean(mapping.emby)
		if muxForbidden(root) {
			break
		}
		candidate := filepath.Clean(root + strings.TrimPrefix(arr, mapping.arr))
		if !pathWithin(root, candidate) {
			break
		}
		realRoot, e := filepath.EvalSymlinks(root)
		if e != nil || muxForbidden(realRoot) {
			break
		}
		parent := candidate
		for {
			_, e = os.Lstat(parent)
			if e == nil {
				break
			}
			if !os.IsNotExist(e) || parent == root {
				return "", errors.New("Media folder is not reachable")
			}
			parent = filepath.Dir(parent)
		}
		real, e := filepath.EvalSymlinks(parent)
		if e != nil || !pathWithin(realRoot, real) || muxForbidden(real) {
			return "", errors.New("Media path escapes the configured mount")
		}
		// Return the configured namespace; ShareRoot is compared in that namespace.
		return candidate, nil
	}
	return "", errors.New("No usable mux path mapping")
}

type placementParent struct {
	path  string
	names map[string]bool
	err   error
}
type placementParents map[string]placementParent

func (p *PlacementManager) folderExists(u UnraidSettings, disk, rel string, cache placementParents) (bool, error) {
	parent := filepath.Dir(rel)
	c, ok := cache[disk]
	if !ok || c.path != parent {
		c = placementParent{path: parent, names: map[string]bool{}}
		entries, e := p.metadata.ReadDir(filepath.Join(u.DiskRoot, disk, parent))
		if e != nil && !os.IsNotExist(e) {
			c.err = e
		}
		for _, entry := range entries {
			c.names[entry.Name()] = true
		}
		cache[disk] = c
	}
	return c.names[filepath.Base(rel)], c.err
}

var placementOwner = func(st os.FileInfo) (uint32, uint32) {
	if sys, ok := st.Sys().(*syscall.Stat_t); ok {
		return sys.Uid, sys.Gid
	}
	return ^uint32(0), ^uint32(0)
}

// Stop on the first non-directory entry, never following links or requesting
// per-file stat metadata. Warnings retain special entries as nonempty evidence.
func (p *PlacementManager) folderHasEntries(ctx context.Context, path string, warnings *[]string) (bool, error) {
	found := false
	err := p.metadata.WalkDir(path, func(name string, entry fs.DirEntry, err error) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err != nil {
			return err
		}
		if !entry.IsDir() {
			found = true
			if entry.Type() != 0 {
				*warnings = append(*warnings, "Skipped link or special file: "+name)
			}
			return fs.SkipAll
		}
		return nil
	})
	return found, err
}

func (p *PlacementManager) inspectItem(ctx context.Context, u UnraidSettings, disks []UnraidDisk, item PlacementItem, cache placementParents, progress ...func(string)) (PlacementItem, error) {
	item.Disks = map[string]PlacementDisk{}
	item.Files = []PlacementFile{}
	item.specialFiles = nil
	item.Check = nil
	item.Warnings = []string{}
	item.TotalBytes = 0
	item.MoveBytes = 0
	item.MoveFiles = 0
	item.Target = ""
	item.Kind = ""
	item.ScanStatus = "ok"
	item.Message = ""
	if !validPlacementRel(item.Rel) {
		item.ScanStatus = "outside_share"
		item.Message = "Folder is outside the user share"
		return item, nil
	}
	for _, disk := range disks {
		if e := ctx.Err(); e != nil {
			return item, e
		}
		if len(progress) > 0 {
			progress[0](disk.Name)
		}
		// Share-first scans already know the devices that hold the folder.
		var exists bool
		var e error
		if item.present != nil {
			exists = slices.Contains(item.present, disk.Name)
		} else {
			exists, e = p.folderExists(u, disk.Name, item.Rel, cache)
		}
		if e != nil {
			item.ScanStatus = "error"
			item.Message = "Could not read folder metadata: " + disk.Name
			continue
		}
		if !exists {
			continue
		}
		item.Disks[disk.Name] = PlacementDisk{}
		base := filepath.Join(u.DiskRoot, disk.Name, item.Rel)
		st, e := p.metadata.Lstat(base)
		if e != nil {
			item.ScanStatus = "error"
			item.Message = "Could not read folder metadata: " + disk.Name
			continue
		}
		if !st.IsDir() {
			if len(item.Warnings) < 100 {
				item.Warnings = append(item.Warnings, "Skipped link or special folder on "+disk.Name)
			}
			continue
		}
		// Never follow an item ancestor link into another share, device, or system path.
		real, e := p.metadata.EvalSymlinks(base)
		if e != nil || real != base {
			item.ScanStatus = "error"
			item.Message = "Media folder contains a symbolic link: " + disk.Name
			continue
		}
		err := p.metadata.WalkDir(base, func(path string, entry fs.DirEntry, walkErr error) error {
			if e := ctx.Err(); e != nil {
				return e
			}
			if walkErr != nil {
				return walkErr
			}
			rel, e := filepath.Rel(base, path)
			if e != nil {
				return e
			}
			if item.rootOnly() && rel != "." && entry.IsDir() {
				return fs.SkipDir
			}
			info, e := entry.Info()
			if e != nil {
				return e
			}
			if !info.IsDir() && !info.Mode().IsRegular() {
				uid, gid := placementOwner(info)
				item.specialFiles = append(item.specialFiles, PlacementFile{Disk: disk.Name, Rel: rel, UID: uid, GID: gid, Mode: uint32(info.Mode())})
				d := item.Disks[disk.Name]
				d.Files++
				d.SpecialFiles++
				item.Disks[disk.Name] = d
				if len(item.Warnings) < 100 {
					item.Warnings = append(item.Warnings, "Skipped link or special file: "+disk.Name+"/"+rel)
				}
				return nil
			}
			uid, gid := placementOwner(info)
			f := PlacementFile{Disk: disk.Name, Rel: rel, Size: info.Size(), Mtime: info.ModTime().UnixNano(), Atime: placementAtime(info), Mode: uint32(info.Mode()), UID: uid, GID: gid, Dir: info.IsDir()}
			item.Files = append(item.Files, f)
			if len(item.Files) > placementFileLimit {
				return errPlacementLimit
			}
			d := item.Disks[disk.Name]
			if info.IsDir() {
				d.Dirs++
			} else {
				d.Files++
				d.Bytes += info.Size()
				item.TotalBytes += info.Size()
			}
			item.Disks[disk.Name] = d
			return nil
		})
		if err != nil {
			if ctx.Err() != nil {
				return item, ctx.Err()
			}
			if errors.Is(err, errPlacementLimit) {
				return item, err
			}
			item.ScanStatus = "error"
			item.Message = "Could not read folder metadata: " + disk.Name
		}
	}
	if item.ScanStatus == "error" {
		return item, nil
	}
	seen := map[string]bool{}
	arrayFiles, poolFiles, devices, arrayFolders := 0, 0, 0, 0
	for _, f := range item.Files {
		if f.Dir {
			continue
		}
		if seen[f.Rel] {
			item.ScanStatus = "conflict"
			item.Message = "The same relative file exists on several disks"
		}
		seen[f.Rel] = true
	}
	if item.ScanStatus == "conflict" {
		return item, nil
	}
	for _, disk := range disks {
		d, ok := item.Disks[disk.Name]
		if !ok {
			continue
		}
		devices++
		if disk.Kind == "array" {
			arrayFolders++
		}
		if d.Files > 0 {
			if disk.Kind == "array" {
				arrayFiles++
			} else {
				poolFiles++
			}
		}
	}
	if devices == 0 {
		item.ScanStatus = "not_found"
		item.Message = "Folder not found on any disk: " + item.Rel
	} else if arrayFiles+poolFiles == 0 {
		item.ScanStatus = "empty"
	} else if arrayFiles+poolFiles >= 2 {
		item.ScanStatus = "split"
	} else if arrayFiles == 1 && devices > 1 {
		item.ScanStatus = "empty_folders"
	} else if poolFiles == 1 && arrayFolders > 0 {
		item.ScanStatus = "split"
	}

	return item, nil
}
func planPlacement(item PlacementItem, u UnraidSettings, disks []UnraidDisk, influx map[string]int64, forced string, settings ...shareCacheSettings) PlacementItem {
	policies := shareCacheSettings(nil)
	if len(settings) > 0 {
		policies = settings[0]
	} else {
		policies = readShareCache(u)
	}
	policy := policies.policy(item.Rel)
	poolFiles, arrayFiles, pools := 0, 0, []string{}
	for _, disk := range disks {
		if item.Disks[disk.Name].Files > 0 {
			if disk.Kind == "array" {
				arrayFiles++
			} else {
				poolFiles++
				pools = append(pools, disk.Name)
			}
		}
	}
	if poolFiles > 0 && (policy.UseCache == "prefer" || policy.UseCache == "only") {
		item.Target, item.Kind, item.MoveBytes, item.MoveFiles = "", "", 0, 0
		if arrayFiles == 0 {
			item.ScanStatus = "ok"
		} else {
			item.ScanStatus = "split"
			item.Message = fmt.Sprintf("This share keeps files on %s (Use cache: %s). Disk placement does not move them to the array.", strings.Join(pools, ", "), policy.UseCache)
		}
		return item
	}
	if item.ScanStatus != "split" && item.ScanStatus != "empty_folders" && !(item.rootOnly() && item.ScanStatus == "ok" && forced != "") {
		return item
	}
	candidates := []UnraidDisk{}
	for _, disk := range disks {
		_, exists := item.Disks[disk.Name]
		if disk.Kind != "array" || slices.Contains(u.ExcludedDisks, disk.Name) {
			continue
		}
		if forced != "" {
			if disk.Name == forced {
				candidates = append(candidates, disk)
			}
			continue
		}
		if exists {
			candidates = append(candidates, disk)
		}
	}
	if len(candidates) == 0 && forced == "" {
		hasArrayFolder := false
		for _, disk := range disks {
			if disk.Kind == "array" {
				if _, ok := item.Disks[disk.Name]; ok {
					hasArrayFolder = true
				}
			}
		}
		if !hasArrayFolder {
			for _, disk := range disks {
				if disk.Kind == "array" && !slices.Contains(u.ExcludedDisks, disk.Name) {
					candidates = append(candidates, disk)
				}
			}
		}
	}
	sort.Slice(candidates, func(a, b int) bool {
		x, y := candidates[a], candidates[b]
		xb, yb := item.Disks[x.Name].Bytes, item.Disks[y.Name].Bytes
		if xb != yb {
			return xb > yb
		}
		if x.Free != y.Free {
			return x.Free > y.Free
		}
		xn, _ := strconv.ParseUint(strings.TrimPrefix(x.Name, "disk"), 10, 64)
		yn, _ := strconv.ParseUint(strings.TrimPrefix(y.Name, "disk"), 10, 64)
		return xn < yn
	})
	item.Target = ""
	item.Kind = "small_files"
	reserve := int64(u.ReserveGB) * 1e9
	for _, disk := range candidates {
		cost := item.TotalBytes - item.Disks[disk.Name].Bytes
		available := int64(min(disk.Free, uint64(^uint64(0)>>1))) - influx[disk.Name]
		if available >= cost && available-cost >= reserve {
			item.Target = disk.Name
			item.MoveBytes = cost
			break
		}
	}
	if item.Target == "" {
		item.ScanStatus = "no_space"
		item.Message = "No eligible target has enough free space"
		return item
	}
	for name, d := range item.Disks {
		if name != item.Target && d.SpecialFiles > 0 {
			item.ScanStatus = "error"
			item.Message = "Links or special files on " + name + " cannot be moved"
			item.Target, item.Kind, item.MoveBytes, item.MoveFiles = "", "", 0, 0
			return item
		}
	}
	item.MoveFiles = 0
	for _, f := range item.Files {
		if f.Dir || f.Disk == item.Target {
			continue
		}
		item.MoveFiles++
		if videoExtensions[strings.ToLower(filepath.Ext(f.Rel))] {
			item.Kind = "media_files"
		}
	}
	access := placementSourceCheck(&item, u)
	if !access.Readable || !access.Removable {
		item.ScanStatus = "error"
		item.Message = placementSourceMessage(item)
		return item
	}
	if item.rootOnly() && item.MoveFiles > 0 {
		item.ScanStatus = "split"
	}
	if _, exists := item.Disks[item.Target]; !exists {
		item.Message = "Target " + item.Target + " is new for this folder"
	}
	if item.ScanStatus == "ok" {
		return item
	}
	influx[item.Target] += item.MoveBytes
	return item
}

func (p *PlacementManager) runScan(ctx context.Context, cfg Settings) {
	started := time.Now()
	result := PlacementScan{Running: true, StartedAt: started.UTC().Format(time.RFC3339Nano), Options: cfg.Unraid, MappingHash: placementMappingHash(cfg), Counts: map[string]int{}, Targets: []PlacementTargetSummary{}}
	var finalErr error
	defer func() {
		result.Running = false
		result.Duration = time.Since(started).Seconds()
		if finalErr != nil {
			result.Error = "Scan failed"
			if errors.Is(finalErr, context.Canceled) {
				result.Error = "Scan cancelled"
			} else if errors.Is(finalErr, errPlacementLimit) {
				result.Error = errPlacementLimit.Error()
			} else {
				result.Error = finalErr.Error()
			}
			if errors.Is(finalErr, context.Canceled) {
				p.s.Store.Events.Info("placement", "", "Disk placement scan cancelled", nil, "")
			} else {
				p.s.Store.Events.Error("placement", "", "Disk placement scan failed", nil, "", finalErr.Error())
			}
			if previous, e := p.s.Store.placementScan(); e == nil {
				previous.Error = result.Error
				result = previous
			}
		} else {
			p.s.Store.Events.Info("placement", "", "Disk placement scan completed · {count} folders in {seconds} s", map[string]any{"count": result.Total, "seconds": int(result.Duration), "several": result.Counts["several"], "empty": result.Counts["empty"]}, "")
			for _, root := range result.RootFolders {
				if root.Status == "unresolved" {
					p.s.Store.Events.Warning("placement", "", "Root folder not resolved: {path}", map[string]any{"path": root.ArrPath}, "", "")
				}
			}
		}
		p.mu.Lock()
		p.scan = clonePlacementScan(result)
		p.scanCancel = nil
		p.mu.Unlock()
	}()
	disks, e := discoverDisks(cfg.Unraid.DiskRoot)
	if e != nil {
		finalErr = e
		return
	}
	result.Roots = []ScanRoot{}
	items, e := p.shareItems(ctx, cfg, disks, &result)
	if e != nil {
		finalErr = e
		return
	}
	result.Total = len(items)
	conn, e := p.s.Store.DB.Conn(ctx)
	if e != nil {
		finalErr = errors.New("Could not prepare scan")
		return
	}
	defer conn.Close()
	if _, e = conn.ExecContext(ctx, "CREATE TEMP TABLE placement_stage"+placementTable); e != nil {
		finalErr = errors.New("Could not prepare scan")
		return
	}
	defer conn.ExecContext(context.Background(), "DROP TABLE IF EXISTS temp.placement_stage")
	parents := placementParents{}
	storedFiles := 0
	// Series-root targets need the total across all season items, including OK ones.
	seriesBytes := map[string]map[string]int64{}
	for _, item := range items {
		var previous *PlacementItem
		old, oldErr := scanPlacement(conn.QueryRowContext(ctx, "SELECT "+placementColumns+" FROM placement_items WHERE item_key=? AND check_result<>''", item.Key))
		if oldErr == nil && old.Check != nil {
			previous = &old
			item.skipInspect = false
		}
		if ctx.Err() != nil {
			finalErr = ctx.Err()
			return
		}
		if !item.skipInspect && item.ScanStatus != "outside_share" && item.ScanStatus != "not_found" {
			item, e = p.inspectItem(ctx, cfg.Unraid, disks, item, parents, func(disk string) { result.Disk = disk; p.mu.Lock(); p.scan.Disk = disk; p.mu.Unlock() })
			if e != nil {
				finalErr = e
				return
			}
		}
		if previous != nil && placementSame(*previous, item) {
			item.Check = previous.Check
		}
		key := item.Service + ":" + strconv.Itoa(item.MediaID)
		if item.Season != nil {
			if seriesBytes[key] == nil {
				seriesBytes[key] = map[string]int64{}
			}
			for disk, d := range item.Disks {
				seriesBytes[key][disk] += d.Bytes
			}
		}
		result.Checked++
		if item.ScanStatus == "ok" && !item.rootOnly() && item.Check == nil {
			item.Files = []PlacementFile{}
		} else {
			storedFiles += len(item.Files)
			if storedFiles > placementFileLimit {
				finalErr = errPlacementLimit
				return
			}
		}
		if e = insertPlacement(ctx, conn, "placement_stage", &item); e != nil {
			finalErr = errors.New("Could not store scan plan")
			return
		}

		p.mu.Lock()
		p.scan = clonePlacementScan(result)
		p.mu.Unlock()
	}
	// Row IDs never identify another item after a replacement scan, including
	// when the user has removed all successful rows since the previous scan.
	var previousMax int64
	if e = conn.QueryRowContext(ctx, "SELECT coalesce(max(id),0) FROM placement_items").Scan(&previousMax); e != nil {
		finalErr = errors.New("Could not prepare scan identifiers")
		return
	}
	if previous, e := p.s.Store.placementScan(); e == nil {
		previousMax = max(previousMax, previous.LastItemID)
	}
	if previousMax > 0 {
		if _, e = conn.ExecContext(ctx, "UPDATE placement_stage SET id=-id"); e == nil {
			_, e = conn.ExecContext(ctx, "UPDATE placement_stage SET id=?-id", previousMax)
		}
		if e != nil {
			finalErr = errors.New("Could not prepare scan identifiers")
			return
		}
	}
	// Keep only compact IDs while applying the greedy plan in descending size.
	rows, e := conn.QueryContext(ctx, "SELECT id FROM placement_stage ORDER BY total_bytes DESC,id")
	if e != nil {
		finalErr = errors.New("Could not read scan plan")
		return
	}
	ids := []int64{}
	for rows.Next() {
		var id int64
		if e = rows.Scan(&id); e != nil {
			break
		}
		ids = append(ids, id)
	}
	rowErr := rows.Err()
	rows.Close()
	if e != nil || rowErr != nil {
		finalErr = errors.New("Could not read scan plan")
		return
	}
	result.LastItemID = previousMax + int64(len(ids))
	cacheSettings := readShareCache(cfg.Unraid)
	influx := map[string]int64{}
	groups := map[string]*PlacementTargetSummary{}
	for _, id := range ids {
		item, e := scanPlacement(conn.QueryRowContext(ctx, "SELECT "+placementColumns+" FROM placement_stage WHERE id=?", id))
		if e != nil {
			finalErr = errors.New("Could not read scan plan")
			return
		}
		forced := ""
		if item.rootOnly() {
			sizes := seriesBytes[item.Service+":"+strconv.Itoa(item.MediaID)]
			maxBytes := int64(-1)
			for _, d := range disks {
				if d.Kind == "array" && !slices.Contains(cfg.Unraid.ExcludedDisks, d.Name) && sizes[d.Name] > maxBytes && sizes[d.Name] > 0 {
					forced = d.Name
					maxBytes = sizes[d.Name]
				}
			}
		}
		if item.rootOnly() && item.TotalBytes == 0 && (item.ScanStatus == "empty_folders" || item.ScanStatus == "empty" || item.ScanStatus == "ok") {
			n := 0
			for _, disk := range disks {
				if disk.Kind == "array" && seriesBytes[item.Service+":"+strconv.Itoa(item.MediaID)][disk.Name] > 0 {
					n++
				}
			}
			if n > 1 {
				item.ScanStatus = "seasons_spread"
				item.Message = fmt.Sprintf("Seasons occupy %d disks. Use grouping by series to consolidate them on one disk.", n)
			}
		}
		item = planPlacement(item, cfg.Unraid, disks, influx, forced, cacheSettings)
		if item.ScanStatus == "ok" {
			result.OK++
			if item.Check == nil {
				item.Files = []PlacementFile{}
			}
		}
		{
			args, _ := placementArgs(&item)
			args = append(args, id)
			cols := strings.Split(strings.TrimPrefix(placementColumns, "id,"), ",")
			for n := range cols {
				cols[n] += "=?"
			}
			_, e = conn.ExecContext(ctx, "UPDATE placement_stage SET "+strings.Join(cols, ",")+" WHERE id=?", args...)
			result.Counts[item.ScanStatus]++
			if len(item.Disks) >= 2 {
				result.Counts["several"]++
				result.Several++
			}
			if item.startable() {
				result.MoveBytes += item.MoveBytes
				if item.Kind == "small_files" {
					result.SmallFiles++
				}
				g := groups[item.Target]
				if g == nil {
					g = &PlacementTargetSummary{Target: item.Target, Sources: map[string]int64{}}
					groups[item.Target] = g
				}
				g.Items++
				g.MoveBytes += item.MoveBytes
				if item.Kind == "small_files" {
					g.SmallFiles++
				} else {
					g.MediaFiles++
				}
				for name, d := range item.Disks {
					if name != item.Target {
						g.Sources[name] += d.Bytes
					}
				}
			} else {
				if item.ScanStatus != "ok" {
					result.Unstartable++
				}
			}
		}
		if e != nil {
			finalErr = errors.New("Could not store scan plan")
			return
		}
	}
	for _, disk := range disks {
		if g := groups[disk.Name]; g != nil {
			result.Targets = append(result.Targets, *g)
		}
	}
	result.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
	result.Duration = time.Since(started).Seconds()
	result.Running = false
	result.Disk = ""
	raw, e := json.Marshal(result)
	if e != nil {
		finalErr = e
		return
	}
	tx, e := conn.BeginTx(ctx, nil)
	if e != nil {
		finalErr = errors.New("Could not publish scan")
		return
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(ctx, "DELETE FROM placement_items"); e == nil {
		_, e = tx.ExecContext(ctx, "INSERT INTO placement_items("+placementColumns+") SELECT "+placementColumns+" FROM placement_stage")
	}
	if e == nil {
		_, e = tx.ExecContext(ctx, "INSERT INTO placement_scan(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data", string(raw))
	}
	if e == nil {
		e = tx.Commit()
	}
	if e != nil {
		finalErr = errors.New("Could not publish scan")
		return
	}
	// No active queue can exist during a scan; old logs are no longer referenced.
	_ = os.RemoveAll(filepath.Join(p.s.Store.Dir, "placement-logs"))
}
