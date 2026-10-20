package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestMuxMappings123(t *testing.T) {
	cfg := DefaultSettings()
	cfg.Instances = []ServiceConfig{{ID: "radarr", Type: "radarr"}, {ID: "sonarr", Type: "sonarr"}}
	cfg.Mux.PathMappings = map[string]string{"sonarr": "/documentaries => /media/other\n/shows => /media/shows", "radarr": "/documentaries => /media/documentaries\n/movies => /media/movies\n/movies => /media/movies"}
	if e := normalizeMux(&cfg); e != nil {
		t.Fatal(e)
	}
	want := "/documentaries => /media/documentaries\n/movies => /media/movies\n/shows => /media/shows"
	if cfg.Mux.Mappings != want || cfg.Mux.PathMappings["radarr"] != want || cfg.Mux.PathMappings["sonarr"] != want {
		t.Fatal(cfg.Mux)
	}
	root := muxTempDir120(t)
	os.WriteFile(filepath.Join(root, "movie.mkv"), []byte("x"), 0600)
	cfg.Mux.Mappings = "/documentaries => " + root
	for _, id := range []string{"radarr", "sonarr"} {
		p, e := resolveLocalPath(cfg.Mux, id, "/documentaries/movie.mkv")
		if e != nil || p != filepath.Join(root, "movie.mkv") {
			t.Fatal(id, p, e)
		}
	}
	for _, value := range []string{"invalid", "/a => /media/a\n/a => /media/b", "/a => /etc", "/a => /data/a", "C:/a => /media/a"} {
		cfg.Mux.Mappings = value
		if normalizeMux(&cfg) == nil {
			t.Fatal(value)
		}
	}
	cfg.Mux.Mappings = "/ok => /media/ok"
	cfg.Mux.PathMappings = map[string]string{"removed": "nonsense"}
	if e := normalizeMux(&cfg); e != nil || len(cfg.Mux.PathMappings) != 2 {
		t.Fatal(cfg.Mux, e)
	}
}
func TestMuxColumns123(t *testing.T) {
	cfg := Settings{}
	if e := normalizeMuxColumns(&cfg); e != nil || !reflect.DeepEqual(cfg.MuxColumnOrder, defaultMuxColumns()) {
		t.Fatal(cfg, e)
	}
	for _, kind := range []string{"unknown", "duplicate", "select", "missing", "hidden-filename", "hidden-select"} {
		t.Run(kind, func(t *testing.T) {
			cfg := Settings{}
			normalizeMuxColumns(&cfg)
			switch kind {
			case "unknown":
				cfg.MuxColumnOrder[2] = "what"
			case "duplicate":
				cfg.MuxColumnOrder[2] = "buttons"
			case "select":
				cfg.MuxColumnOrder[0], cfg.MuxColumnOrder[1] = cfg.MuxColumnOrder[1], cfg.MuxColumnOrder[0]
			case "missing":
				cfg.MuxColumnOrder = cfg.MuxColumnOrder[:7]
			case "hidden-filename":
				cfg.MuxVisibleColumns = []string{"select"}
			case "hidden-select":
				cfg.MuxVisibleColumns = []string{"filename"}
			}
			if normalizeMuxColumns(&cfg) == nil {
				t.Fatal(kind)
			}
		})
	}
}
func TestMuxPathDraft123(t *testing.T) {
	s, _ := muxServer120(t)
	root := muxTempDir120(t)
	old := muxMediaRoot
	muxMediaRoot = root
	t.Cleanup(func() { muxMediaRoot = old })
	os.Mkdir(filepath.Join(root, "documentaries"), 0700)
	arr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v3/rootfolder" || r.Header.Get("X-Api-Key") != "key" {
			t.Error(r.URL.Path)
			http.Error(w, "bad", 400)
			return
		}
		fmt.Fprint(w, `[{"path":"/documentaries/"},{"path":"/missing"}]`)
	}))
	defer arr.Close()
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Error(w, "private-path", 401) }))
	defer bad.Close()
	s.mu.Lock()
	s.settings.Instances = []ServiceConfig{{ID: "radarr", Type: "radarr", Name: "Radarr", Enabled: true, URL: arr.URL, APIKey: "key"}, {ID: "sonarr", Type: "sonarr", Name: "Sonarr", Enabled: true, URL: arr.URL, APIKey: "key"}, {ID: "radarr-bad", Type: "radarr", Name: "Broken", Enabled: true, URL: bad.URL}}
	s.mu.Unlock()
	roots := s.muxRootFolders(context.Background(), "")
	if len(roots.Folders) != 2 || len(roots.Folders[0].Instances) != 2 || roots.Folders[0].Suggestion != filepath.Join(root, "documentaries") || len(roots.Errors) != 1 || strings.Contains(roots.Errors[0].Error, "private") {
		t.Fatal(roots)
	}
	file := filepath.Join(root, "documentaries", "secret-movie.mkv")
	os.WriteFile(file, []byte("source"), 0600)
	f := sample(1, "secret-movie.mkv")
	f.Size = 6
	f.SourcePath = "/documentaries/secret-movie.mkv"
	s.Store.Replace("radarr", []File{f}, SyncStatus{})
	readonly := filepath.Join(root, "readonly")
	os.Mkdir(readonly, 0500)
	draft := "/documentaries => " + filepath.Join(root, "documentaries") + "\nBAD\n/readonly => " + readonly + "\n/absent => " + filepath.Join(root, "absent") + "\n/forbidden => /data/x"
	request := func(route string, body any) *httptest.ResponseRecorder {
		b, _ := json.Marshal(body)
		w := httptest.NewRecorder()
		s.muxHTTP(w, httptest.NewRequest("POST", "/api/mux/"+route, bytes.NewReader(b)))
		return w
	}
	w := request("check-paths", map[string]string{"mappings": draft, "workDir": readonly})
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var result struct {
		Syntax      muxSyntax
		Mappings    []muxMappingCheck
		RootFolders []muxRootFolder
		Samples     []muxSampleCheck
		WorkDir     MuxWorkCheck
	}
	json.Unmarshal(w.Body.Bytes(), &result)
	if result.Syntax.OK || result.Syntax.Line != 2 || len(result.Mappings) != 4 || len(result.Samples) != 3 || result.Samples[0].Reachable != 1 || result.WorkDir.Writable || !result.RootFolders[0].Mapped || result.RootFolders[1].Mapped || strings.Contains(w.Body.String(), "secret-movie") {
		t.Fatal(w.Body.String())
	}
	for _, c := range result.Mappings {
		if c.ArrPath == "/readonly" && c.Writable || c.ArrPath == "/absent" && c.Exists || c.ArrPath == "/forbidden" && (c.Exists || c.Error == "") {
			t.Fatal(c)
		}
	}
	w = request("root-folders", map[string]string{"mappings": "/documentaries => " + filepath.Join(root, "documentaries")})
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"mapped":true`) {
		t.Fatal(w.Body.String())
	}
}
func TestMuxReadyAndFresh123(t *testing.T) {
	s, _ := muxServer120(t)
	source, spec := muxFixture120()
	j := MuxJob{Service: "radarr", FileID: 1, Status: "draft", Source: source, Spec: spec}
	s.Store.muxSave(&j)
	request := func(method, route string, in any) *httptest.ResponseRecorder {
		b, _ := json.Marshal(in)
		w := httptest.NewRecorder()
		s.muxHTTP(w, httptest.NewRequest(method, "/api/mux/"+route, bytes.NewReader(b)))
		return w
	}
	w := request("POST", "run", map[string]any{"ids": []int64{j.ID}})
	if !strings.Contains(w.Body.String(), "Save the mux options first") {
		t.Fatal(w.Body.String())
	}
	for _, status := range []string{"draft", "failed", "cancelled"} {
		j, _ = s.Store.muxJob(j.ID)
		j.Status = status
		s.Store.muxSave(&j)
		w = request("PUT", fmt.Sprintf("jobs?id=%d", j.ID), map[string]any{"spec": spec, "revision": j.Revision})
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"status":"ready"`) {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	s.Mux.mu.Lock()
	s.Mux.checks[j.ID] = muxCheckCache{check: MuxCheck{Exists: true}, at: time.Now()}
	s.Mux.mu.Unlock()
	w = request("GET", fmt.Sprintf("jobs?id=%d", j.ID), nil)
	if !strings.Contains(w.Body.String(), `"exists":true`) {
		t.Fatal(w.Body.String())
	}
	w = request("GET", fmt.Sprintf("jobs?id=%d&fresh=1", j.ID), nil)
	if strings.Contains(w.Body.String(), `"exists":true`) {
		t.Fatal(w.Body.String())
	}
}
func TestMuxLiveLog123(t *testing.T) {
	s, _ := muxServer120(t)
	source, spec := muxFixture120()
	j := MuxJob{Service: "radarr", FileID: 1, Status: "running", Source: source, Spec: spec}
	s.Store.muxSave(&j)
	os.MkdirAll(s.Mux.toolBase(), 0700)
	f, e := os.Create(s.Mux.logPath(j.ID))
	if e != nil {
		t.Fatal(e)
	}
	defer f.Close()
	log := &muxLiveLog{file: f, paths: []string{"/media/root/source movie.mkv", "/work/temp/output.partial", "/media/root/final.mkv", "/work/temp", "/media/root", "/arr/root"}}
	log.line("Scopearr mux log")
	log.line("#GUI#warning /media/root/source movie.mkv /work/temp/output.partial /media/root/final.mkv /work/temp /media/root /arr/root /unknown/private/file.mkv")
	log.line("#GUI#progress 42%")
	for i := 0; i < 500; i++ {
		log.line(strings.Repeat("x", 1024))
	}
	if len(log.ring) > 256<<10 {
		t.Fatal(len(log.ring))
	}
	offset := int64(0)
	full := ""
	for i := 0; i < 20; i++ {
		w := httptest.NewRecorder()
		s.muxHTTP(w, httptest.NewRequest("GET", fmt.Sprintf("/api/mux/jobs/log?id=%d&offset=%d", j.ID, offset), nil))
		var out struct {
			Text    string
			Offset  int64
			Running bool
		}
		if json.Unmarshal(w.Body.Bytes(), &out) != nil || len(out.Text) > 64<<10 || !out.Running {
			t.Fatal(w.Body.String())
		}
		if out.Offset == offset {
			break
		}
		offset = out.Offset
		full += out.Text
	}
	if strings.Contains(full, "/media") || strings.Contains(full, "/work") || strings.Contains(full, "/unknown") || strings.Contains(full, "#GUI#progress") || !strings.Contains(full, "Warning:") {
		t.Fatal(full[:min(500, len(full))])
	}
	j, _ = s.Store.muxJob(j.ID)
	j.Status = "cancelled"
	s.Store.muxSave(&j)
	w := httptest.NewRecorder()
	s.muxHTTP(w, httptest.NewRequest("DELETE", fmt.Sprintf("/api/mux/jobs?id=%d", j.ID), nil))
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if _, e := os.Stat(s.Mux.logPath(j.ID)); !os.IsNotExist(e) {
		t.Fatal(e)
	}
}
