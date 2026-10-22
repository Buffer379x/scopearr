package app

import (
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

const fileCheckTable = `(id INTEGER PRIMARY KEY, service TEXT NOT NULL, instance TEXT NOT NULL,
 media_id INTEGER NOT NULL, title TEXT NOT NULL, root TEXT NOT NULL, rel TEXT NOT NULL, path TEXT NOT NULL,
 is_dir INTEGER NOT NULL, kind TEXT NOT NULL, fix TEXT NOT NULL, size INTEGER NOT NULL, mode INTEGER NOT NULL,
 uid INTEGER NOT NULL, gid INTEGER NOT NULL, mtime INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '',
 job_status TEXT NOT NULL DEFAULT '', queue_pos INTEGER, progress INTEGER NOT NULL DEFAULT 0,
 message TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, finished_at TEXT, UNIQUE(path, kind))`
const fileCheckSchema = `CREATE TABLE IF NOT EXISTS filecheck_scan(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS filecheck_items` + fileCheckTable + `;
CREATE INDEX IF NOT EXISTS filecheck_items_job ON filecheck_items(job_status,queue_pos);
CREATE INDEX IF NOT EXISTS filecheck_items_kind ON filecheck_items(kind,fix);`
const fileCheckColumns = `id,service,instance,media_id,title,root,rel,path,is_dir,kind,fix,size,mode,uid,gid,mtime,note,job_status,queue_pos,progress,message,updated_at,finished_at`

// Fixes run in this order regardless of how the table is sorted.
const fileCheckOrder = `title COLLATE NOCASE,rel,kind,id`
const fileCheckFixable = "fix IN ('chmod','take_ownership','delete') AND job_status IN ('','failed')"

type FileCheckItem struct {
	ID         int64   `json:"id"`
	Service    string  `json:"service"`
	Instance   string  `json:"instance"`
	MediaID    int     `json:"mediaId"`
	Title      string  `json:"title"`
	Root       string  `json:"-"`
	Rel        string  `json:"rel"`
	Path       string  `json:"-"`
	Dir        bool    `json:"dir"`
	Kind       string  `json:"kind"`
	Fix        string  `json:"fix"`
	Size       int64   `json:"size"`
	Mode       uint32  `json:"mode"`
	UID        int     `json:"uid"`
	GID        int     `json:"gid"`
	Mtime      int64   `json:"mtime"`
	Note       string  `json:"note"`
	JobStatus  string  `json:"jobStatus"`
	QueuePos   *int64  `json:"queuePos"`
	Progress   int     `json:"progress"`
	Message    string  `json:"message"`
	UpdatedAt  string  `json:"updatedAt"`
	FinishedAt *string `json:"finishedAt"`
}

type FileCheckScan struct {
	Running    bool           `json:"running"`
	StartedAt  string         `json:"startedAt"`
	FinishedAt string         `json:"finishedAt"`
	Duration   float64        `json:"duration"`
	Checked    int            `json:"checked"`
	Total      int            `json:"total"`
	Files      int            `json:"files"`
	Findings   int            `json:"findings"`
	Bytes      int64          `json:"bytes"`
	Kinds      map[string]int `json:"kinds"`
	Fixes      map[string]int `json:"fixes"`
	Items      int            `json:"items"`
	Error      string         `json:"error"`
}

func scanFileCheck(row interface{ Scan(...any) error }) (FileCheckItem, error) {
	var i FileCheckItem
	var dir int
	var queue sql.NullInt64
	var finished sql.NullString
	e := row.Scan(&i.ID, &i.Service, &i.Instance, &i.MediaID, &i.Title, &i.Root, &i.Rel, &i.Path, &dir, &i.Kind, &i.Fix, &i.Size, &i.Mode, &i.UID, &i.GID, &i.Mtime, &i.Note, &i.JobStatus, &queue, &i.Progress, &i.Message, &i.UpdatedAt, &finished)
	i.Dir = dir == 1
	if queue.Valid {
		i.QueuePos = &queue.Int64
	}
	if finished.Valid {
		i.FinishedAt = &finished.String
	}
	return i, e
}
func (s *Store) fileCheckItem(id int64) (FileCheckItem, error) {
	return scanFileCheck(s.DB.QueryRow("SELECT "+fileCheckColumns+" FROM filecheck_items WHERE id=?", id))
}
func fileCheckArgs(i *FileCheckItem) []any {
	dir := 0
	if i.Dir {
		dir = 1
	}
	return []any{i.Service, i.Instance, i.MediaID, i.Title, i.Root, i.Rel, i.Path, dir, i.Kind, i.Fix, i.Size, i.Mode, i.UID, i.GID, i.Mtime, i.Note, i.JobStatus, i.QueuePos, i.Progress, i.Message, i.UpdatedAt, i.FinishedAt}
}
func (s *Store) fileCheckSave(i *FileCheckItem) error {
	i.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	_, e := s.DB.Exec("UPDATE filecheck_items SET fix=?,job_status=?,queue_pos=?,progress=?,message=?,updated_at=?,finished_at=? WHERE id=?", i.Fix, i.JobStatus, i.QueuePos, i.Progress, i.Message, i.UpdatedAt, i.FinishedAt, i.ID)
	return e
}
func (s *Store) fileCheckActive() (bool, error) {
	var active bool
	e := s.DB.QueryRow("SELECT EXISTS(SELECT 1 FROM filecheck_items WHERE job_status IN ('queued','running'))").Scan(&active)
	return active, e
}
func (s *Store) fileCheckScan() (FileCheckScan, error) {
	var raw string
	scan := FileCheckScan{Kinds: map[string]int{}, Fixes: map[string]int{}}
	e := s.DB.QueryRow("SELECT data FROM filecheck_scan WHERE id=1").Scan(&raw)
	if errors.Is(e, sql.ErrNoRows) {
		return scan, nil
	}
	if e != nil {
		return scan, e
	}
	e = json.Unmarshal([]byte(raw), &scan)
	return scan, e
}
