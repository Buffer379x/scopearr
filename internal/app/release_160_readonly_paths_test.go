package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestMediaInfoPathCheckReadOnly160(t *testing.T) {
	s, _ := muxServer120(t)
	media, work := muxTempDir120(t), muxTempDir120(t)
	if err := os.WriteFile(filepath.Join(media, "Movie.mkv"), []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	arr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v3/rootfolder" {
			t.Error("unexpected Arr request", r.URL.Path)
			w.WriteHeader(404)
			return
		}
		jsonOut(w, 200, []map[string]string{{"path": "/arr"}})
	}))
	defer arr.Close()
	s.mu.Lock()
	s.settings.Mux.Enabled = false
	s.settings.MediaInfo.Enabled = true
	s.settings.Instances = []ServiceConfig{{ID: "radarr", Type: "radarr", Enabled: true, URL: arr.URL}}
	s.mu.Unlock()
	f := sample(1, "Movie.mkv")
	f.SourcePath = "/arr/Movie.mkv"
	f.Size = 8
	if err := s.Store.Replace("radarr", []File{f}, SyncStatus{}); err != nil {
		t.Fatal(err)
	}
	// A write probe followed by unlink still changes the directory timestamp.
	// Using an old fixed timestamp makes that side effect deterministic.
	before := time.Unix(946684800, 0)
	for _, dir := range []string{media, work} {
		if err := os.Chtimes(dir, before, before); err != nil {
			t.Fatal(err)
		}
	}
	oldSpace, spaceCalls := muxSpace, 0
	muxSpace = func(string) (uint64, error) { spaceCalls++; return 12345, nil }
	t.Cleanup(func() { muxSpace = oldSpace })
	body, _ := json.Marshal(map[string]string{"mappings": "/arr => " + media, "workDir": work})
	w := httptest.NewRecorder()
	s.muxPathHTTP(w, httptest.NewRequest("POST", "/api/mediainfo/check-paths", bytes.NewReader(body)), "check-paths-readonly")
	var result struct {
		ReadOnly bool
		Mappings []muxMappingCheck
		Samples  []muxSampleCheck
		WorkDir  MuxWorkCheck
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil {
		t.Fatal(w.Code, w.Body)
	}
	if !result.ReadOnly {
		t.Error("path check did not identify read-only mode", w.Body)
	}
	if spaceCalls != 0 {
		t.Errorf("read-only path check queried free space %d times", spaceCalls)
	}
	if len(result.Mappings) != 1 || !result.Mappings[0].Exists || !result.Mappings[0].IsDir || !result.Mappings[0].Readable {
		t.Fatal("readable mapping rejected", w.Body)
	}
	if result.Mappings[0].Writable || result.Mappings[0].FreeBytes != 0 {
		t.Error("unchecked writable/capacity values were asserted", w.Body)
	}
	if result.WorkDir.Configured || result.WorkDir.Exists || result.WorkDir.Writable || result.WorkDir.FreeBytes != 0 {
		t.Error("read-only check inspected mux workspace", w.Body)
	}
	if len(result.Samples) != 1 || result.Samples[0].Reachable != 1 || result.Samples[0].SizeMatches != 1 {
		t.Error("read-only check lost sample validation", w.Body)
	}
	for _, dir := range []string{media, work} {
		info, err := os.Stat(dir)
		if err != nil || !info.ModTime().Equal(before) {
			t.Errorf("path check changed %s directory metadata: %v", dir, err)
		}
	}
}

func TestMediaInfoOnlyMuxPathGate160(t *testing.T) {
	s, _ := muxServer120(t)
	s.mu.Lock()
	s.settings.Mux.Enabled = false
	s.settings.MediaInfo.Enabled = true
	s.settings.Instances = nil
	s.mu.Unlock()
	for _, tc := range []struct {
		route  string
		status int
	}{{"root-folders", 200}, {"check-paths", 404}} {
		t.Run(tc.route, func(t *testing.T) {
			w := httptest.NewRecorder()
			s.muxHTTP(w, httptest.NewRequest("POST", "/api/mux/"+tc.route, bytes.NewBufferString(`{"mappings":""}`)))
			if w.Code != tc.status {
				t.Fatal("MediaInfo-only mux route", w.Code, w.Body)
			}
		})
	}
}
