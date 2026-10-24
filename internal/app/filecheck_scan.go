package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/sys/unix"
)

const fileCheckMaxFindings = 500000

var errFileCheckLimit = errors.New("Too many findings at once; select fewer libraries or checks")

type FileCheckManager struct {
	s            *Server
	mu           sync.Mutex
	wg           sync.WaitGroup
	once         sync.Once
	scan         FileCheckScan
	scanCancel   context.CancelFunc
	active       int64
	cancel       context.CancelFunc
	pendingFinal *FileCheckItem
}

func NewFileCheckManager(s *Server) *FileCheckManager {
	f := &FileCheckManager{s: s}
	if scan, e := s.Store.fileCheckScan(); e == nil {
		f.scan = scan
		f.scan.Running = false
	}
	return f
}

// Stubbed in tests: access(2) uses the container's real UID, which equals the effective one.
var fileCheckAccess = func(path string, dir bool) bool {
	mode := uint32(unix.R_OK | unix.W_OK)
	if dir {
		mode |= unix.X_OK
	}
	return unix.Access(path, mode) == nil
}
var fileCheckEUID = os.Geteuid

func (f *FileCheckManager) scanStatus() FileCheckScan {
	f.mu.Lock()
	defer f.mu.Unlock()
	scan := f.scan
	scan.Roots = cloneScanRoots(scan.Roots)
	scan.Kinds = map[string]int{}
	scan.Fixes = map[string]int{}
	for k, v := range f.scan.Kinds {
		scan.Kinds[k] = v
	}
	for k, v := range f.scan.Fixes {
		scan.Fixes[k] = v
	}
	return scan
}

// Arr paths map to Scopearr's namespace by string only; the walk checks existence.
func fileCheckLocal(mappings []pathMapping, arrPath string) (string, bool) {
	arr := cleanMediaPath(arrPath)
	for _, m := range mappings {
		if pathWithin(m.arr, arr) {
			return filepath.Clean(filepath.Clean(m.emby) + strings.TrimPrefix(arr, m.arr)), true
		}
	}
	return "", false
}

func (f *FileCheckManager) managedFiles(ctx context.Context, mappings []pathMapping, service string, mediaID int) (map[string]bool, error) {
	rows, e := f.s.Store.DB.QueryContext(ctx, "SELECT source_path FROM files WHERE service=? AND media_id=? AND source_path<>''", service, mediaID)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var source string
		if rows.Scan(&source) == nil {
			if local, ok := fileCheckLocal(mappings, source); ok {
				out[local] = true
			}
		}
	}
	return out, rows.Err()
}

// inspectFolder walks one item folder with lstat metadata only and never opens files.
func fileCheckInspect(cfg Settings, folder arrFolder, managed map[string]bool, emit func(FileCheckItem) error) (int, error) {
	fc := cfg.FileCheck
	kinds := map[string]bool{}
	for _, k := range fc.Kinds {
		kinds[k] = true
	}
	fileMode, _ := parseFileMode(fc.FileMode)
	dirMode, _ := parseFileMode(fc.DirMode)
	physical := fileCheckPhysical(cfg)
	root := folder.Local
	stems := map[string][]string{}
	for p := range managed {
		stems[filepath.Dir(p)] = append(stems[filepath.Dir(p)], fileCheckVideoStem(filepath.Base(p)))
	}
	children := map[string]int{}
	writable := map[string]bool{}
	parentWritable := func(dir string) bool {
		ok, seen := writable[dir]
		if !seen {
			ok = fileCheckAccess(dir, true)
			writable[dir] = ok
		}
		return ok
	}
	var skipped []string
	var empty []FileCheckItem
	underSkipped := func(p string) bool {
		for _, s := range skipped {
			if p != s && pathWithin(s, p) {
				return true
			}
		}
		return false
	}
	files := 0
	e := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			if p == root {
				return err
			}
			return nil
		}
		if p == root {
			return nil
		}
		parent := filepath.Dir(p)
		children[parent]++
		name, dir := d.Name(), d.IsDir()
		if fileCheckMatches(fc.Ignore, name, dir) {
			if dir {
				return fs.SkipDir
			}
			return nil
		}
		info, e := d.Info()
		if e != nil {
			return nil
		}
		rel, _ := filepath.Rel(root, p)
		uid, gid := placementOwner(info)
		item := FileCheckItem{Service: folder.Service, Instance: folder.Instance, MediaID: folder.MediaID, Title: folder.Title, Root: root, Rel: rel, Path: p, Dir: dir, Mode: uint32(info.Mode()), UID: int(uid), GID: int(gid), Mtime: info.ModTime().UnixNano()}
		if !dir {
			item.Size = info.Size()
			files++
		}
		add := func(kind, fix, note string) error {
			next := item
			next.Kind, next.Fix, next.Note = kind, fix, note
			return emit(next)
		}
		deleteFix := "delete"
		if !parentWritable(parent) {
			deleteFix = "manual"
		}
		if info.Mode()&os.ModeSymlink != 0 || !dir && !info.Mode().IsRegular() {
			if kinds["other"] {
				note := "Special file"
				if info.Mode()&os.ModeSymlink != 0 {
					note = "Symlink"
				}
				return add("other", "manual", note)
			}
			return nil
		}
		ext := strings.ToLower(filepath.Ext(name))
		ownFix := "manual"
		if !dir && physical && fc.TakeOwnership && (fc.IncludeVideo || !videoExtensions[ext]) {
			ownFix = "take_ownership"
		}
		target := fileMode
		if dir {
			target = dirMode
		}
		if kinds["permissions"] && (!fileCheckAccess(p, dir) || fc.Strict && uint32(info.Mode().Perm()) != target) {
			fix := ownFix
			if int(uid) == fileCheckEUID() {
				fix = "chmod"
			}
			if e := add("permissions", fix, ""); e != nil {
				return e
			}
		}
		if kinds["owner"] && (int(uid) != fc.OwnerUID || int(gid) != fc.OwnerGID) {
			if e := add("owner", ownFix, ""); e != nil {
				return e
			}
		}
		skip := func() error {
			if dir {
				return fs.SkipDir
			}
			return nil
		}
		if fileCheckJunk(name, dir) {
			if kinds["junk"] {
				if e := add("junk", deleteFix, ""); e != nil {
					return e
				}
			}
			return skip()
		}
		if strings.HasPrefix(name, ".") {
			if fileCheckMatches(fc.Allowed, name, dir) {
				if dir {
					skipped = append(skipped, p)
				}
				return nil
			}
			if kinds["hidden"] {
				note := ""
				if strings.Contains(name, ".scopearr-") {
					note = "Scopearr temporary file"
				}
				if e := add("hidden", deleteFix, note); e != nil {
					return e
				}
			}
			return skip()
		}
		if underSkipped(p) {
			return nil
		}
		if dir {
			lower := strings.ToLower(name)
			if strings.HasSuffix(lower, ".trickplay") {
				if !fileCheckMatchesStem(name, stems[parent]) && kinds["orphan"] {
					if e := add("orphan", deleteFix, "Trickplay"); e != nil {
						return e
					}
				}
				return fs.SkipDir
			}
			if fileCheckExtrasDirs[lower] || fileCheckMatches(fc.Allowed, name, true) {
				skipped = append(skipped, p)
			}
			if kinds["empty_dir"] {
				next := item
				next.Kind, next.Fix = "empty_dir", deleteFix
				empty = append(empty, next)
			}
			return nil
		}
		if videoExtensions[ext] {
			if managed[p] || fileCheckExtra(name) || !kinds["untracked_media"] {
				return nil
			}
			note := ""
			if strings.Contains(strings.ToLower(name), "sample") {
				note = "Sample"
			}
			return add("untracked_media", deleteFix, note)
		}
		if fileCheckSidecar(ext) {
			if fileCheckMatches(fc.Allowed, name, false) || fileCheckMatchesStem(name, stems[parent]) || !kinds["orphan"] {
				return nil
			}
			return add("orphan", deleteFix, "")
		}
		if kinds["other"] {
			return add("other", deleteFix, "")
		}
		return nil
	})
	if e != nil {
		return files, e
	}
	for _, item := range empty {
		if children[item.Path] == 0 {
			if e := emit(item); e != nil {
				return files, e
			}
		}
	}
	return files, nil
}

func (f *FileCheckManager) runScan(ctx context.Context, cfg Settings) {
	started := time.Now()
	result := FileCheckScan{Kinds: map[string]int{}, Fixes: map[string]int{}, StartedAt: started.UTC().Format(time.RFC3339Nano)}
	var finalErr error
	defer func() {
		f.mu.Lock()
		defer f.mu.Unlock()
		if finalErr != nil {
			// A failed or cancelled scan keeps the previous result visible.
			f.scan.Running = false
			f.scan.Error = finalErr.Error()
			if errors.Is(finalErr, context.Canceled) {
				f.scan.Error = ""
			}
		} else {
			f.scan = result
		}
		f.scanCancel = nil
	}()
	mappings, e := parsePathMappings(cfg.Mux.Mappings)
	if e != nil {
		finalErr = errors.New(muxMappingError)
		return
	}
	folders, e := f.s.arrFolders(ctx, cfg, cfg.FileCheck.Libraries)
	if e != nil {
		finalErr = e
		return
	}
	result.Roots = f.s.coveredRoots(ctx, cfg, cfg.FileCheck.Libraries, folders)
	f.mu.Lock()
	f.scan.Total = len(folders)
	f.mu.Unlock()
	conn, e := f.s.Store.DB.Conn(ctx)
	if e != nil {
		finalErr = errors.New("Could not store scan results")
		return
	}
	defer conn.Close()
	defer conn.ExecContext(context.Background(), "DROP TABLE IF EXISTS temp.filecheck_stage")
	if _, e = conn.ExecContext(ctx, "DROP TABLE IF EXISTS temp.filecheck_stage; CREATE TEMP TABLE filecheck_stage"+fileCheckTable); e != nil {
		finalErr = errors.New("Could not store scan results")
		return
	}
	var tx *sql.Tx
	var insert *sql.Stmt
	pending := 0
	flush := func() error {
		if tx == nil {
			return nil
		}
		insert.Close()
		e := tx.Commit()
		tx, insert, pending = nil, nil, 0
		return e
	}
	defer func() {
		if tx != nil {
			insert.Close()
			tx.Rollback()
		}
	}()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	emit := func(item FileCheckItem) error {
		if result.Findings >= fileCheckMaxFindings {
			return errFileCheckLimit
		}
		if tx == nil {
			var e error
			if tx, e = conn.BeginTx(ctx, nil); e != nil {
				return e
			}
			if insert, e = tx.PrepareContext(ctx, "INSERT OR IGNORE INTO temp.filecheck_stage("+strings.TrimPrefix(fileCheckColumns, "id,")+") VALUES(?"+strings.Repeat(",?", 21)+")"); e != nil {
				return e
			}
		}
		item.UpdatedAt = now
		if _, e := insert.ExecContext(ctx, fileCheckArgs(&item)...); e != nil {
			return e
		}
		result.Findings++
		if pending++; pending >= 1000 {
			return flush()
		}
		return nil
	}
	for n, folder := range folders {
		if e = ctx.Err(); e != nil {
			finalErr = e
			return
		}
		root := scanRootByKey(result.Roots, folder.rootKey)
		if folder.Err != nil {
			if root != nil {
				root.Skipped++
				root.OutsideShare++
				root.Errors++
			}
		} else {
			managed, e := f.managedFiles(ctx, mappings, folder.Service, folder.MediaID)
			if e != nil {
				finalErr = errors.New("Could not read library files")
				return
			}
			files, e := fileCheckInspect(cfg, folder, managed, emit)
			result.Files += files
			if root != nil {
				if e == nil {
					root.Scanned++
				} else {
					root.Skipped++
					root.Errors++
				}
			}
			if errors.Is(e, errFileCheckLimit) || ctx.Err() != nil {
				finalErr = e
				if ctx.Err() != nil {
					finalErr = ctx.Err()
				}
				return
			}
			// An unreachable folder is reported by Disk placement; skip it here.
		}
		f.mu.Lock()
		f.scan.Checked = n + 1
		f.mu.Unlock()
	}
	if e = flush(); e != nil {
		finalErr = errors.New("Could not store scan results")
		return
	}
	rows, e := conn.QueryContext(ctx, "SELECT kind,fix,count(*),sum(size),count(DISTINCT service||':'||media_id) FROM temp.filecheck_stage GROUP BY kind,fix")
	if e != nil {
		finalErr = errors.New("Could not store scan results")
		return
	}
	for rows.Next() {
		var kind, fix string
		var n, items int
		var size sql.NullInt64
		if rows.Scan(&kind, &fix, &n, &size, &items) == nil {
			result.Kinds[kind] += n
			result.Fixes[fix] += n
			if kind != "permissions" && kind != "owner" {
				result.Bytes += size.Int64
			}
		}
	}
	rows.Close()
	_ = conn.QueryRowContext(ctx, "SELECT count(DISTINCT service||':'||media_id) FROM temp.filecheck_stage").Scan(&result.Items)
	result.Checked, result.Total = len(folders), len(folders)
	result.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
	result.Duration = time.Since(started).Seconds()
	raw, _ := json.Marshal(result)
	tx2, e := conn.BeginTx(ctx, nil)
	if e != nil {
		finalErr = errors.New("Could not publish scan")
		return
	}
	defer tx2.Rollback()
	cols := strings.TrimPrefix(fileCheckColumns, "id,")
	if _, e = tx2.ExecContext(ctx, "DELETE FROM filecheck_items"); e == nil {
		if _, e = tx2.ExecContext(ctx, "INSERT INTO filecheck_items("+cols+") SELECT "+cols+" FROM temp.filecheck_stage ORDER BY "+fileCheckOrder); e == nil {
			_, e = tx2.ExecContext(ctx, "INSERT INTO filecheck_scan(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data", string(raw))
		}
	}
	if e == nil {
		e = tx2.Commit()
	}
	if e != nil {
		finalErr = errors.New("Could not publish scan")
	}
}
