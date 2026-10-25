package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

type placementInfo142 struct {
	name string
	dir  bool
}

func (i placementInfo142) Name() string { return i.name }
func (i placementInfo142) Size() int64 {
	if i.dir {
		return 0
	}
	return 64
}
func (i placementInfo142) Mode() fs.FileMode {
	if i.dir {
		return fs.ModeDir | 0755
	}
	return 0644
}
func (i placementInfo142) ModTime() time.Time { return time.Unix(1700000000, 0) }
func (i placementInfo142) IsDir() bool        { return i.dir }
func (i placementInfo142) Sys() any           { return &syscall.Stat_t{Uid: 99, Gid: 100} }

type placementMetadata142 struct{ names []os.DirEntry }

func (m placementMetadata142) ReadDir(p string) ([]os.DirEntry, error) {
	if strings.Contains(p, "/disk3/") {
		return m.names, nil
	}
	return nil, nil
}
func (m placementMetadata142) Lstat(p string) (os.FileInfo, error) {
	return placementInfo142{filepath.Base(p), true}, nil
}
func (m placementMetadata142) EvalSymlinks(p string) (string, error) { return p, nil }
func (m placementMetadata142) WalkDir(p string, f fs.WalkDirFunc) error {
	if e := f(p, fs.FileInfoToDirEntry(placementInfo142{filepath.Base(p), true}), nil); e != nil {
		return e
	}
	e := f(filepath.Join(p, "Film.mkv"), fs.FileInfoToDirEntry(placementInfo142{"Film.mkv", false}), nil)
	if e == fs.SkipAll {
		return nil
	}
	return e
}

func TestPerformance50KPlacement142(t *testing.T) {
	if os.Getenv("SCOPEARR_PERF") != "1" {
		t.Skip("explicit large-fixture check")
	}
	count := 50000
	if raw := os.Getenv("SCOPEARR_PLACEMENT_ROWS"); raw != "" {
		n, e := strconv.Atoi(raw)
		if e != nil || n < 1 || n > 100000 {
			t.Fatal("invalid fixture size")
		}
		count = n
	}
	s, cfg := placementFixture130(t)
	if e := os.MkdirAll(filepath.Join(cfg.Unraid.ShareRoot, "movies"), 0755); e != nil {
		t.Fatal(e)
	}
	type folder struct {
		ID    int    `json:"id"`
		Title string `json:"title"`
		Path  string `json:"path"`
	}
	folders := make([]folder, count)
	names := make([]os.DirEntry, count)
	for n := range folders {
		name := fmt.Sprintf("Film %06d", n+1)
		folders[n] = folder{n + 1, name, "/arr/movies/" + name}
		names[n] = fs.FileInfoToDirEntry(placementInfo142{name, true})
	}
	arr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "rootfolder") {
			w.Write([]byte(`[{"path":"/arr/movies"}]`))
			return
		}
		json.NewEncoder(w).Encode(folders)
	}))
	defer arr.Close()
	cfg.Instances[0].URL = arr.URL
	s.mu.Lock()
	s.settings = cfg
	s.mu.Unlock()
	s.Placement.metadata = placementMetadata142{names}
	started := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	s.Placement.runScan(ctx, cfg)
	scan := s.Placement.scanStatus()
	if scan.Error != "" || scan.OK != count || scan.Checked != count {
		t.Fatal(scan.Error, scan.OK, scan.Checked)
	}
	var rows, files, maxLength int
	if e := s.Store.DB.QueryRow("SELECT count(*),sum(json_array_length(files)),max(length(files)) FROM placement_items").Scan(&rows, &files, &maxLength); e != nil {
		t.Fatal(e)
	}
	if rows != count || files != 0 || maxLength != 2 {
		t.Fatal("OK rows must stay compact", rows, files, maxLength)
	}
	request := httptest.NewRecorder()
	s.placementListHTTP(request, httptest.NewRequest("GET", "/api/placement/items?q=Film%20000010", nil))
	var result struct {
		Total    int
		HiddenOK int
	}
	if e := json.Unmarshal(request.Body.Bytes(), &result); e != nil {
		t.Fatal(e)
	}
	if request.Code != 200 || result.Total != 0 || result.HiddenOK != 1 {
		t.Fatal("large compact scan is not searchable", request.Code, request.Body.String())
	}
	t.Logf("%d one-disk rows, no stored file lists, scan and search in %s", count, time.Since(started))
}
