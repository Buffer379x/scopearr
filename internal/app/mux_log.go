package app

import (
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type muxLogKey struct{}
type muxLiveLog struct {
	mu    sync.Mutex
	file  *os.File
	ring  []byte
	paths []string
}

func (m *MuxManager) logPath(id int64) string {
	return filepath.Join(m.toolBase(), "mux-"+strconv.FormatInt(id, 10)+".log")
}

// Redact longest known paths first, then unrecognized absolute paths in tool diagnostics.
var muxAbsolutePath = regexp.MustCompile(`(?:[A-Za-z]:)?/[^\s"'<>]+`)

func redactMuxLine(line string, paths []string) string {
	paths = append([]string{}, paths...)
	sort.SliceStable(paths, func(i, j int) bool { return len(paths[i]) > len(paths[j]) })
	for _, p := range paths {
		if p != "" && p != "/" {
			line = strings.ReplaceAll(line, p, filepath.Base(p))
		}
	}
	line = muxAbsolutePath.ReplaceAllStringFunc(line, func(p string) string { return filepath.Base(p) })
	if strings.HasPrefix(line, "#GUI#warning") {
		line = "Warning: " + strings.TrimSpace(strings.TrimPrefix(line, "#GUI#warning"))
	}
	if strings.HasPrefix(line, "#GUI#error") {
		line = "Error: " + strings.TrimSpace(strings.TrimPrefix(line, "#GUI#error"))
	}
	return line
}
func (l *muxLiveLog) line(value string) {
	if strings.HasPrefix(value, "#GUI#progress") {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	value = redactMuxLine(value, l.paths)
	if value != "Scopearr mux log" {
		value = time.Now().Format("15:04:05") + " " + value
	}
	value += "\n"
	l.ring = append(l.ring, []byte(value)...)
	if len(l.ring) > 256<<10 {
		l.ring = append([]byte{}, l.ring[len(l.ring)-(256<<10):]...)
	}
	if l.file != nil {
		l.file.WriteString(value)
	}
}
func muxLogLine(ctx context.Context, line string) {
	if log, ok := ctx.Value(muxLogKey{}).(*muxLiveLog); ok {
		log.line(line)
	}
}
func (s *Server) muxLogHTTP(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.URL.Query().Get("id"), 10, 64)
	j, e := s.Store.muxJob(id)
	if e != nil {
		http.NotFound(w, r)
		return
	}
	offset, _ := strconv.ParseInt(r.URL.Query().Get("offset"), 10, 64)
	if offset < 0 {
		offset = 0
	}
	text := ""
	if f, e := os.Open(s.Mux.logPath(id)); e == nil {
		defer f.Close()
		header := make([]byte, len("Scopearr mux log\n"))
		n, _ := f.ReadAt(header, 0)
		if string(header[:n]) != "Scopearr mux log\n" {
			clean := safeMuxLog(j.Log)
			if offset > int64(len(clean)) {
				offset = 0
			}
			end := min(int64(len(clean)), offset+(64<<10))
			text = clean[offset:end]
			offset = end
		} else {
			if st, e := f.Stat(); e == nil && offset > st.Size() {
				offset = 0
			}
			f.Seek(offset, io.SeekStart)
			b := make([]byte, 64<<10)
			n, _ := f.Read(b)
			text = string(b[:n])
			offset += int64(n)
		}
	}

	jsonOut(w, 200, map[string]any{"text": text, "offset": offset, "running": j.Status == "running", "progress": j.Progress, "message": j.Message})
}

func muxLogPaths(ctx context.Context, paths ...string) {
	if live, ok := ctx.Value(muxLogKey{}).(*muxLiveLog); ok {
		live.mu.Lock()
		live.paths = append(live.paths, paths...)
		live.mu.Unlock()
	}
}
func (m *MuxManager) openJobLog(ctx context.Context, j MuxJob, appendLog bool) (context.Context, func(), error) {
	if e := os.MkdirAll(m.toolBase(), 0700); e != nil {
		return ctx, func() {}, errors.New("Could not open mux log")
	}
	flags := os.O_CREATE | os.O_WRONLY | os.O_TRUNC
	if appendLog {
		flags = os.O_CREATE | os.O_WRONLY | os.O_APPEND
	}
	f, e := os.OpenFile(m.logPath(j.ID), flags, 0600)
	if e != nil {
		return ctx, func() {}, errors.New("Could not open mux log")
	}
	// Legacy files may contain unredacted data. Never append a trusted header to one.
	if appendLog {
		header := make([]byte, len("Scopearr mux log\n"))
		old, err := os.Open(m.logPath(j.ID))
		if err == nil {
			old.Read(header)
			old.Close()
		}
		if string(header) != "Scopearr mux log\n" {
			f.Truncate(0)
		}
	}
	mappings, _ := parsePathMappings(m.s.Config().Mux.Mappings)
	paths := []string{m.s.Config().Mux.WorkDir}
	for _, p := range mappings {
		paths = append(paths, p.arr, p.emby)
	}
	live := &muxLiveLog{file: f, paths: paths}
	if st, _ := f.Stat(); st != nil && st.Size() == 0 {
		live.line("Scopearr mux log")
	}
	return context.WithValue(ctx, muxLogKey{}, live), func() { f.Close() }, nil
}
