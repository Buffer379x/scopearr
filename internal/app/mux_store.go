package app

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"
)

const muxSchema = `CREATE TABLE IF NOT EXISTS mux_jobs(id INTEGER PRIMARY KEY,service TEXT NOT NULL,file_id INTEGER NOT NULL,media_id INTEGER NOT NULL,title TEXT NOT NULL,source_name TEXT NOT NULL,status TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,spec TEXT NOT NULL DEFAULT '{}',source TEXT NOT NULL DEFAULT '{}',progress INTEGER NOT NULL DEFAULT 0,message TEXT NOT NULL DEFAULT '',log TEXT NOT NULL DEFAULT '',backup_name TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,finished_at TEXT,UNIQUE(service,file_id)); CREATE INDEX IF NOT EXISTS mux_jobs_status ON mux_jobs(status);`

type MuxJob struct {
	ID         int64     `json:"id"`
	Service    string    `json:"service"`
	FileID     int       `json:"fileId"`
	MediaID    int       `json:"mediaId"`
	Title      string    `json:"title"`
	SourceName string    `json:"sourceName"`
	Status     string    `json:"status"`
	Revision   int       `json:"revision"`
	Spec       MuxSpec   `json:"spec"`
	Source     MuxSource `json:"source"`
	Progress   int       `json:"progress"`
	Message    string    `json:"message"`
	Log        string    `json:"log"`
	BackupName string    `json:"backupName"`
	CreatedAt  string    `json:"createdAt"`
	UpdatedAt  string    `json:"updatedAt"`
	FinishedAt *string   `json:"finishedAt"`
	Check      MuxCheck  `json:"check"`
}

const muxColumns = "id,service,file_id,media_id,title,source_name,status,revision,spec,source,progress,message,log,backup_name,created_at,updated_at,finished_at"

func scanMux(row interface{ Scan(...any) error }) (MuxJob, error) {
	var j MuxJob
	var spec, source string
	e := row.Scan(&j.ID, &j.Service, &j.FileID, &j.MediaID, &j.Title, &j.SourceName, &j.Status, &j.Revision, &spec, &source, &j.Progress, &j.Message, &j.Log, &j.BackupName, &j.CreatedAt, &j.UpdatedAt, &j.FinishedAt)
	if e == nil {
		e = json.Unmarshal([]byte(spec), &j.Spec)
	}
	if e == nil {
		e = json.Unmarshal([]byte(source), &j.Source)
	}
	return j, e
}
func (s *Store) muxJobs(filters ...string) ([]MuxJob, error) {
	query := "SELECT " + muxColumns + " FROM mux_jobs"
	clauses := []string{}
	args := []any{}
	if len(filters) > 0 && filters[0] != "" {
		clauses = append(clauses, "service=?")
		args = append(args, filters[0])
	}
	if len(filters) > 1 && filters[1] != "" {
		id, err := strconv.Atoi(filters[1])
		// Match the previous canonical string comparison while preserving the
		// (service,file_id) index for valid filters.
		if err != nil || strconv.Itoa(id) != filters[1] {
			return []MuxJob{}, nil
		}
		clauses = append(clauses, "file_id=?")
		args = append(args, id)
	}
	if len(clauses) > 0 {
		query += " WHERE " + strings.Join(clauses, " AND ")
	}
	rows, e := s.DB.Query(query+" ORDER BY id", args...)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []MuxJob{}
	for rows.Next() {
		j, e := scanMux(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, j)
	}
	return out, rows.Err()
}
func (s *Store) muxJob(id int64) (MuxJob, error) {
	return scanMux(s.DB.QueryRow("SELECT "+muxColumns+" FROM mux_jobs WHERE id=?", id))
}
func (s *Store) muxFile(service string, id int) (File, error) {
	var f File
	var raw, path string
	e := s.DB.QueryRow("SELECT data,source_path FROM files WHERE service=? AND id=?", service, id).Scan(&raw, &path)
	if e == nil {
		e = json.Unmarshal([]byte(raw), &f)
		f.SourcePath = path
	}
	return f, e
}
func (s *Store) muxSave(j *MuxJob) error {
	spec, e := json.Marshal(j.Spec)
	if e != nil {
		return e
	}
	source, e := json.Marshal(j.Source)
	if e != nil {
		return e
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if j.ID == 0 {
		r, e := s.DB.Exec("INSERT INTO mux_jobs(service,file_id,media_id,title,source_name,status,spec,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)", j.Service, j.FileID, j.MediaID, j.Title, j.SourceName, j.Status, string(spec), string(source), now, now)
		if e != nil {
			return e
		}
		j.ID, e = r.LastInsertId()
		j.Revision = 1
		return e
	}
	r, e := s.DB.Exec("UPDATE mux_jobs SET status=?,revision=revision+1,spec=?,source=?,progress=?,message=?,log=?,backup_name=?,updated_at=?,finished_at=? WHERE id=? AND revision=?", j.Status, string(spec), string(source), j.Progress, j.Message, j.Log, j.BackupName, now, j.FinishedAt, j.ID, j.Revision)
	if e != nil {
		return e
	}
	n, e := r.RowsAffected()
	if e != nil {
		return e
	}
	if n != 1 {
		return errMuxRevision
	}
	j.Revision++
	return nil
}

var errMuxRevision = errors.New("Mux job changed. Reload and try again")

// Central redaction applies to every endpoint, including idempotent create and updates.
func (j MuxJob) MarshalJSON() ([]byte, error) {
	type public MuxJob
	v := public(j)
	v.Source.DiskPath = ""
	v.Source.DiskRoot = ""
	v.Source.SharePath = ""
	v.Log = safeMuxLog(j.Log)
	return json.Marshal(v)
}
