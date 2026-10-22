package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

const placementTable = `(id INTEGER PRIMARY KEY, item_key TEXT NOT NULL UNIQUE,
 service TEXT NOT NULL, instance TEXT NOT NULL, media_id INTEGER NOT NULL, season INTEGER,
 title TEXT NOT NULL, rel TEXT NOT NULL, scan_status TEXT NOT NULL, kind TEXT NOT NULL DEFAULT '',
 target TEXT NOT NULL DEFAULT '', total_bytes INTEGER NOT NULL, move_bytes INTEGER NOT NULL,
 move_files INTEGER NOT NULL, disks TEXT NOT NULL DEFAULT '{}', files TEXT NOT NULL DEFAULT '[]',
 warnings TEXT NOT NULL DEFAULT '[]', job_status TEXT NOT NULL DEFAULT '', queue_pos INTEGER,
 progress INTEGER NOT NULL DEFAULT 0, bytes_done INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT '',
 updated_at TEXT NOT NULL, finished_at TEXT)`
const placementSchema = `CREATE TABLE IF NOT EXISTS placement_scan(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS placement_items` + placementTable + `;
CREATE INDEX IF NOT EXISTS placement_items_job ON placement_items(job_status,queue_pos);
CREATE INDEX IF NOT EXISTS placement_items_scan ON placement_items(scan_status,target);`
const placementColumns = `id,item_key,service,instance,media_id,season,title,rel,scan_status,kind,target,total_bytes,move_bytes,move_files,disks,files,warnings,job_status,queue_pos,progress,bytes_done,message,updated_at,finished_at`
const placementOrder = `CASE WHEN scan_status IN ('split','empty_folders') AND job_status IN ('','failed') THEN 0 ELSE 1 END, CASE kind WHEN 'small_files' THEN 0 ELSE 1 END,move_bytes,id`

func scanPlacement(row interface{ Scan(...any) error }) (PlacementItem, error) {
	var i PlacementItem
	var disks, files, warnings string
	err := row.Scan(&i.ID, &i.Key, &i.Service, &i.Instance, &i.MediaID, &i.Season, &i.Title, &i.Rel, &i.ScanStatus, &i.Kind, &i.Target, &i.TotalBytes, &i.MoveBytes, &i.MoveFiles, &disks, &files, &warnings, &i.JobStatus, &i.QueuePos, &i.Progress, &i.BytesDone, &i.Message, &i.UpdatedAt, &i.FinishedAt)
	if err == nil {
		err = json.Unmarshal([]byte(disks), &i.Disks)
	}
	if err == nil {
		err = json.Unmarshal([]byte(files), &i.Files)
	}
	if err == nil {
		err = json.Unmarshal([]byte(warnings), &i.Warnings)
	}
	return i, err
}
func (s *Store) placementItem(id int64) (PlacementItem, error) {
	return scanPlacement(s.DB.QueryRow("SELECT "+placementColumns+" FROM placement_items WHERE id=?", id))
}
func placementArgs(i *PlacementItem) ([]any, error) {
	disks, e := json.Marshal(i.Disks)
	if e != nil {
		return nil, e
	}
	files, e := json.Marshal(i.Files)
	if e != nil {
		return nil, e
	}
	warnings, e := json.Marshal(i.Warnings)
	if e != nil {
		return nil, e
	}
	i.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	return []any{i.Key, i.Service, i.Instance, i.MediaID, i.Season, i.Title, i.Rel, i.ScanStatus, i.Kind, i.Target, i.TotalBytes, i.MoveBytes, i.MoveFiles, string(disks), string(files), string(warnings), i.JobStatus, i.QueuePos, i.Progress, i.BytesDone, i.Message, i.UpdatedAt, i.FinishedAt}, nil
}
func insertPlacement(ctx context.Context, conn interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}, table string, i *PlacementItem) error {
	args, e := placementArgs(i)
	if e != nil {
		return e
	}
	// table is internal and fixed (placement_items or connection-local staging).
	r, e := conn.ExecContext(ctx, "INSERT INTO "+table+"("+strings.TrimPrefix(placementColumns, "id,")+") VALUES("+strings.TrimSuffix(strings.Repeat("?,", len(args)), ",")+")", args...)
	if e == nil {
		i.ID, e = r.LastInsertId()
	}
	return e
}
func (s *Store) placementSave(i *PlacementItem) error {
	if i.ID == 0 {
		return errors.New("Placement item is missing")
	}
	args, e := placementArgs(i)
	if e != nil {
		return e
	}
	columns := strings.Split(strings.TrimPrefix(placementColumns, "id,"), ",")
	for n := range columns {
		columns[n] += "=?"
	}
	args = append(args, i.ID)
	_, e = s.DB.Exec("UPDATE placement_items SET "+strings.Join(columns, ",")+" WHERE id=?", args...)
	return e
}
func (s *Store) placementActive() (bool, error) {
	var active bool
	e := s.DB.QueryRow("SELECT EXISTS(SELECT 1 FROM placement_items WHERE job_status IN ('queued','running'))").Scan(&active)
	return active, e
}
func (s *Store) placementScan() (PlacementScan, error) {
	var scan PlacementScan
	var raw string
	e := s.DB.QueryRow("SELECT data FROM placement_scan WHERE id=1").Scan(&raw)
	if e == nil {
		e = json.Unmarshal([]byte(raw), &scan)
	}
	return scan, e
}
