package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"regexp"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const eventLogSchema = `CREATE TABLE IF NOT EXISTS event_log(id INTEGER PRIMARY KEY,ts INTEGER NOT NULL,level TEXT NOT NULL,source TEXT NOT NULL,instance TEXT NOT NULL DEFAULT '',message TEXT NOT NULL,params TEXT NOT NULL DEFAULT '{}',subject TEXT NOT NULL DEFAULT '',detail TEXT NOT NULL DEFAULT '',repeat INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS event_log_ts ON event_log(ts);
CREATE INDEX IF NOT EXISTS event_log_merge ON event_log(message,params,subject,ts);`

const (
	eventRetention = 24 * time.Hour
	eventMerge     = 10 * time.Minute
	eventLimit     = 20000
	eventBuffer    = 1000
	eventBatch     = 200
)

var eventLevels = []string{"error", "warning", "info"}
var eventSources = []string{"system", "auth", "settings", "sync", "tags", "webhook", "media", "mux", "placement", "filecheck", "rename"}

// Event is one system log entry. Message is an English translation key whose
// placeholders are filled from Params in the viewer's language.
type Event struct {
	ID       int64          `json:"id"`
	TS       int64          `json:"ts"`
	Level    string         `json:"level"`
	Source   string         `json:"source"`
	Instance string         `json:"instance"`
	Message  string         `json:"message"`
	Params   map[string]any `json:"params"`
	Subject  string         `json:"subject"`
	Detail   string         `json:"detail"`
	Repeat   int            `json:"repeat"`
}

// EventLog records system events for 24 hours. Writes are buffered and batched
// in one transaction so logging never adds SQLite pressure to requests.
type EventLog struct {
	db        *sql.DB
	queue     chan Event
	dropped   atomic.Int64
	lastError atomic.Int64
	writeMu   sync.Mutex
	now       func() time.Time
	started   atomic.Bool
	flushes   chan chan struct{}
	done      chan struct{}
}

func newEventLog(db *sql.DB) *EventLog {
	l := &EventLog{db: db, queue: make(chan Event, eventBuffer), now: time.Now, flushes: make(chan chan struct{}), done: make(chan struct{})}
	var last sql.NullInt64
	if db.QueryRow("SELECT max(ts) FROM event_log WHERE level='error'").Scan(&last) == nil && last.Valid {
		l.lastError.Store(last.Int64)
	}
	return l
}

var eventSecret = regexp.MustCompile(`(?i)((?:api[_-]?key|apikey|x-api-key|token|access[_-]?token|password|passwd|secret|authorization|cookie|set-cookie)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|bearer\s+\S+|[^\s,&;"']+)`)
var eventURLCredentials = regexp.MustCompile(`(?i)\b([a-z][a-z0-9+.-]*://)[^/\s:@]+:[^/\s@]+@`)

// redactEvent removes credentials before an event is stored. Media titles and
// paths stay readable because they explain what happened on the user's server.
func redactEvent(value string) string {
	value = eventURLCredentials.ReplaceAllString(value, "${1}[redacted]@")
	return eventSecret.ReplaceAllString(value, "${1}[redacted]")
}

// Add queues an event. Info entries are dropped (and counted) when the buffer is
// full; warnings and errors are written synchronously instead of being lost.
func (l *EventLog) Add(level, source, instance, message string, params map[string]any, subject, detail string) {
	if l == nil {
		return
	}
	if !containsString(eventLevels, level) {
		level = "info"
	}
	if !containsString(eventSources, source) {
		source = "system"
	}
	clean := map[string]any{}
	for key, value := range params {
		if text, ok := value.(string); ok {
			value = redactEvent(text)
		}
		clean[key] = value
	}
	e := Event{TS: l.now().UnixMilli(), Level: level, Source: source, Instance: instance, Message: message, Params: clean, Subject: redactEvent(subject), Detail: redactEvent(detail), Repeat: 1}
	line := message
	for key, value := range clean {
		line = strings.ReplaceAll(line, "{"+key+"}", fmt.Sprint(value))
	}
	log.Printf("%s [%s] %s", strings.ToUpper(level), source, strings.TrimSpace(line+" "+e.Subject))
	select {
	case l.queue <- e:
	default:
		if level == "info" {
			l.dropped.Add(1)
			return
		}
		l.write([]Event{e})
	}
}

func (l *EventLog) Info(source, instance, message string, params map[string]any, subject string) {
	l.Add("info", source, instance, message, params, subject, "")
}
func (l *EventLog) Warning(source, instance, message string, params map[string]any, subject, detail string) {
	l.Add("warning", source, instance, message, params, subject, detail)
}
func (l *EventLog) Error(source, instance, message string, params map[string]any, subject, detail string) {
	l.Add("error", source, instance, message, params, subject, detail)
}

// Start runs the writer until ctx ends. It flushes every two seconds or per
// batch and prunes expired entries at startup and every ten minutes.
func (l *EventLog) Start(ctx context.Context) {
	if l == nil || !l.started.CompareAndSwap(false, true) {
		return
	}
	go func() {
		defer close(l.done)
		l.prune()
		flush := time.NewTicker(2 * time.Second)
		prune := time.NewTicker(10 * time.Minute)
		defer flush.Stop()
		defer prune.Stop()
		batch := []Event{}
		write := func() {
			if n := l.dropped.Swap(0); n > 0 {
				batch = append(batch, Event{TS: l.now().UnixMilli(), Level: "warning", Source: "system", Message: "{count} entries dropped under high load", Params: map[string]any{"count": n}, Repeat: 1})
			}
			if len(batch) > 0 {
				l.write(batch)
				batch = []Event{}
			}
		}
		for {
			select {
			case <-ctx.Done():
				for {
					select {
					case e := <-l.queue:
						batch = append(batch, e)
					default:
						write()
						return
					}
				}
			case e := <-l.queue:
				batch = append(batch, e)
				if len(batch) >= eventBatch {
					write()
				}
			case reply := <-l.flushes:
				for drained := false; !drained; {
					select {
					case e := <-l.queue:
						batch = append(batch, e)
					default:
						drained = true
					}
				}
				write()
				close(reply)
			case <-flush.C:
				write()
			case <-prune.C:
				write()
				l.prune()
			}
		}
	}()
}

// Flush writes queued events immediately (before reads and exports). A running
// writer holds a partial batch, so it is asked to drain instead.
func (l *EventLog) Flush() {
	if l == nil {
		return
	}
	if l.started.Load() {
		reply := make(chan struct{})
		select {
		case l.flushes <- reply:
			<-reply
			return
		case <-l.done:
		}
	}
	batch := []Event{}
	for {
		select {
		case e := <-l.queue:
			batch = append(batch, e)
		default:
			l.write(batch)
			return
		}
	}
}

func (l *EventLog) write(batch []Event) {
	if len(batch) == 0 {
		return
	}
	l.writeMu.Lock()
	defer l.writeMu.Unlock()
	tx, err := l.db.Begin()
	if err != nil {
		log.Printf("event log: %v", err)
		return
	}
	defer tx.Rollback()
	for _, e := range batch {
		params, _ := json.Marshal(e.Params)
		if e.Params == nil {
			params = []byte("{}")
		}
		var id int64
		err = tx.QueryRow("SELECT id FROM event_log WHERE ts>=? AND level=? AND source=? AND instance=? AND message=? AND params=? AND subject=? ORDER BY ts DESC LIMIT 1", e.TS-eventMerge.Milliseconds(), e.Level, e.Source, e.Instance, e.Message, string(params), e.Subject).Scan(&id)
		if err == nil {
			_, err = tx.Exec("UPDATE event_log SET ts=?,detail=CASE WHEN ?<>'' THEN ? ELSE detail END,repeat=repeat+? WHERE id=?", e.TS, e.Detail, e.Detail, max(e.Repeat, 1), id)
		} else if err == sql.ErrNoRows {
			_, err = tx.Exec("INSERT INTO event_log(ts,level,source,instance,message,params,subject,detail,repeat) VALUES(?,?,?,?,?,?,?,?,?)", e.TS, e.Level, e.Source, e.Instance, e.Message, string(params), e.Subject, e.Detail, max(e.Repeat, 1))
		}
		if err != nil {
			log.Printf("event log: %v", err)
			return
		}
	}
	if err = tx.Commit(); err != nil {
		log.Printf("event log: %v", err)
		return
	}
	for _, e := range batch {
		if e.Level == "error" && e.TS > l.lastError.Load() {
			l.lastError.Store(e.TS)
		}
	}
}

// prune keeps 24 hours and at most eventLimit rows, removing old info first.
func (l *EventLog) prune() {
	l.writeMu.Lock()
	defer l.writeMu.Unlock()
	if _, err := l.db.Exec("DELETE FROM event_log WHERE ts<?", l.now().Add(-eventRetention).UnixMilli()); err != nil {
		log.Printf("event log: %v", err)
		return
	}
	for _, query := range []string{
		"DELETE FROM event_log WHERE id IN (SELECT id FROM event_log WHERE level='info' ORDER BY ts,id LIMIT ?)",
		"DELETE FROM event_log WHERE id IN (SELECT id FROM event_log ORDER BY ts,id LIMIT ?)",
	} {
		var n int
		if l.db.QueryRow("SELECT count(*) FROM event_log").Scan(&n) != nil || n <= eventLimit {
			return
		}
		if _, err := l.db.Exec(query, n-eventLimit); err != nil {
			log.Printf("event log: %v", err)
			return
		}
	}
}

// Clear removes every entry and records that the log was cleared.
func (l *EventLog) Clear() error {
	l.Flush()
	l.writeMu.Lock()
	_, err := l.db.Exec("DELETE FROM event_log")
	l.writeMu.Unlock()
	if err != nil {
		return err
	}
	l.write([]Event{{TS: l.now().UnixMilli(), Level: "info", Source: "system", Message: "Log cleared", Params: map[string]any{}, Repeat: 1}})
	return nil
}

// LastError reports the newest stored error timestamp in Unix milliseconds.
func (l *EventLog) LastError() int64 {
	if l == nil {
		return 0
	}
	return l.lastError.Load()
}

type eventQuery struct {
	Q                          string
	Levels, Sources, Instances []string
	Sort, Dir                  string
	Limit, Offset              int
	since                      int64
}

func (q eventQuery) where(skip string) (string, []any) {
	clauses := []string{"ts>=?"}
	args := []any{q.since}
	for _, filter := range []struct {
		name, column string
		values       []string
	}{{"level", "level", q.Levels}, {"source", "source", q.Sources}, {"instance", "instance", q.Instances}} {
		if filter.name == skip || len(filter.values) == 0 {
			continue
		}
		marks := make([]string, len(filter.values))
		for n, value := range filter.values {
			marks[n] = "?"
			args = append(args, value)
		}
		clauses = append(clauses, filter.column+" IN ("+strings.Join(marks, ",")+")")
	}
	if term := strings.TrimSpace(q.Q); term != "" {
		clauses = append(clauses, "(instr(lower(message),lower(?))>0 OR instr(lower(params),lower(?))>0 OR instr(lower(subject),lower(?))>0 OR instr(lower(detail),lower(?))>0 OR instr(lower(instance),lower(?))>0)")
		args = append(args, term, term, term, term, term)
	}
	return strings.Join(clauses, " AND "), args
}

func (q eventQuery) order() string {
	dir := "DESC"
	if strings.EqualFold(q.Dir, "asc") {
		dir = "ASC"
	}
	switch q.Sort {
	case "level":
		return "CASE level WHEN 'error' THEN 2 WHEN 'warning' THEN 1 ELSE 0 END " + dir + ",ts DESC,id DESC"
	case "source":
		return "source " + dir + ",ts DESC,id DESC"
	}
	return "ts " + dir + ",id " + dir
}

type eventPage struct {
	Events []Event                   `json:"events"`
	Total  int                       `json:"total"`
	Counts map[string]map[string]int `json:"counts"`
}

func (l *EventLog) query(ctx context.Context, q eventQuery) (eventPage, error) {
	l.Flush()
	q.since = l.now().Add(-eventRetention).UnixMilli()
	out := eventPage{Events: []Event{}, Counts: map[string]map[string]int{"level": {}, "source": {}, "instance": {}}}
	where, args := q.where("")
	if err := l.db.QueryRowContext(ctx, "SELECT count(*) FROM event_log WHERE "+where, args...).Scan(&out.Total); err != nil {
		return out, err
	}
	for _, column := range []string{"level", "source", "instance"} {
		w, a := q.where(column)
		rows, err := l.db.QueryContext(ctx, "SELECT "+column+",count(*) FROM event_log WHERE "+w+" GROUP BY "+column, a...)
		if err != nil {
			return out, err
		}
		for rows.Next() {
			var key string
			var n int
			if err = rows.Scan(&key, &n); err != nil {
				rows.Close()
				return out, err
			}
			if key != "" {
				out.Counts[column][key] = n
			}
		}
		rows.Close()
	}
	limit := q.Limit
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	rows, err := l.db.QueryContext(ctx, "SELECT id,ts,level,source,instance,message,params,subject,detail,repeat FROM event_log WHERE "+where+" ORDER BY "+q.order()+" LIMIT ? OFFSET ?", append(args, limit, max(q.Offset, 0))...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var e Event
		var params string
		if err = rows.Scan(&e.ID, &e.TS, &e.Level, &e.Source, &e.Instance, &e.Message, &params, &e.Subject, &e.Detail, &e.Repeat); err != nil {
			return out, err
		}
		e.Params = map[string]any{}
		_ = json.Unmarshal([]byte(params), &e.Params)
		out.Events = append(out.Events, e)
	}
	return out, rows.Err()
}

// eventText renders one event for the text export in English.
func eventText(e Event, names map[string]string) string {
	message := e.Message
	keys := make([]string, 0, len(e.Params))
	for key := range e.Params {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		message = strings.ReplaceAll(message, "{"+key+"}", fmt.Sprint(e.Params[key]))
	}
	source := e.Source
	if e.Instance != "" {
		name := names[e.Instance]
		if name == "" {
			name = e.Instance
		}
		source += "/" + name
	}
	parts := []string{time.UnixMilli(e.TS).UTC().Format(time.RFC3339), strings.ToUpper(e.Level), "[" + source + "]", message}
	if e.Subject != "" {
		parts = append(parts, "· "+e.Subject)
	}
	if e.Repeat > 1 {
		parts = append(parts, fmt.Sprintf("×%d", e.Repeat))
	}
	if e.Detail != "" {
		parts = append(parts, "· "+strings.ReplaceAll(e.Detail, "\n", " "))
	}
	return strings.Join(parts, " ")
}
