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
var muxAbsolutePath = regexp.MustCompile(`(^|[\s"'(=])((?:[A-Za-z]:)?/[^\s"'<>]+)`)

func redactMuxLine(line string, paths []string) string {
	paths = append([]string{}, paths...)
	sort.SliceStable(paths, func(i, j int) bool { return len(paths[i]) > len(paths[j]) })
	for _, p := range paths {
		if p != "" && p != "/" {
			line = strings.ReplaceAll(line, p, filepath.Base(p))
		}
	}
	line = muxAbsolutePath.ReplaceAllStringFunc(line, func(p string) string {
		parts := muxAbsolutePath.FindStringSubmatch(p)
		return parts[1] + filepath.Base(parts[2])
	})
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
		failure(w, r, http.StatusNotFound, errors.New("Not found"))
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

func classifyMuxFailure(lines []string) string {
	text := strings.ToLower(strings.Join(lines, "\n"))
	switch {
	case strings.Contains(text, "malloc() returned nullptr"):
		return "The source file appears to be damaged: MKVToolNix read an invalid data size. Repair or replace the file. A newer MKVToolNix (package channel “Current (edge)”) may handle it."
	case strings.Contains(text, "no space left on device"):
		return "Not enough free space on the target disk."
	case strings.Contains(text, "permission denied"):
		return "MKVToolNix cannot write the output file. Check permissions for UID 99 / GID 100."
	case strings.Contains(text, "could not be opened for reading"), strings.Contains(text, "not recognized"):
		return "MKVToolNix cannot read the source file format."
	default:
		return "MKVToolNix failed"
	}
}
func muxFailureLines(ctx context.Context, lines []string) []string {
	if live, ok := ctx.Value(muxLogKey{}).(*muxLiveLog); ok {
		live.mu.Lock()
		defer live.mu.Unlock()
		out := strings.Split(string(live.ring), "\n")
		for _, line := range lines {
			out = append(out, redactMuxLine(line, live.paths))
		}
		return out
	}
	out := []string{}
	for _, line := range lines {
		out = append(out, redactMuxLine(line, nil))
	}
	return out
}
