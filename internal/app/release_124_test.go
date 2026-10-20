package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMuxGlobalDeletionPolicy124(t *testing.T) {
	for _, scenario := range []string{"changed-after-create", "client-override", "different-name"} {
		t.Run(scenario, func(t *testing.T) {
			s, _ := muxServer120(t)
			dir := muxTempDir120(t)
			src := filepath.Join(dir, "Movie.mkv")
			if e := os.WriteFile(src, []byte("original"), 0600); e != nil {
				t.Fatal(e)
			}
			source, _ := muxFixture120()
			s.Mux.testRunner = &fakeMux120{source: source}
			f := sample(1, "Movie.mkv")
			f.Size = 8
			f.SourcePath = "/arr/Movie.mkv"
			if e := s.Store.Replace("radarr", []File{f}, SyncStatus{}); e != nil {
				t.Fatal(e)
			}
			s.mu.Lock()
			s.settings.Instances = []ServiceConfig{{ID: "radarr", Type: "radarr", Enabled: true}}
			s.settings.Mux.Mappings = "/arr => " + dir
			s.settings.Mux.DeleteOriginal = scenario != "client-override"
			s.mu.Unlock()
			oldSpace := muxSpace
			muxSpace = func(string) (uint64, error) { return 10 << 30, nil }
			defer func() { muxSpace = oldSpace }()
			request := func(method, route string, body any) *httptest.ResponseRecorder {
				b, _ := json.Marshal(body)
				w := httptest.NewRecorder()
				s.muxHTTP(w, httptest.NewRequest(method, "/api/mux/"+route, bytes.NewReader(b)))
				if w.Code >= 300 {
					t.Fatalf("%s %s: %d %s", method, route, w.Code, w.Body.String())
				}
				return w
			}
			w := request("POST", "jobs", map[string]any{"service": "radarr", "fileId": 1})
			var j MuxJob
			if e := json.Unmarshal(w.Body.Bytes(), &j); e != nil {
				t.Fatal(e)
			}
			originalPolicy := j.Spec.DeleteOriginal
			if originalPolicy != (scenario != "client-override") {
				t.Fatal("creation did not copy the global deletion policy")
			}
			s.mu.Lock()
			s.settings.Mux.DeleteOriginal = false
			s.mu.Unlock()
			spec := j.Spec
			spec.DeleteOriginal = !originalPolicy // Every client value must be ignored, in both directions.
			if scenario == "different-name" {
				spec.OutputName = "New"
			}
			request("PUT", fmt.Sprintf("jobs?id=%d", j.ID), map[string]any{"spec": spec, "revision": j.Revision})
			j, _ = s.Store.muxJob(j.ID)
			if j.Spec.DeleteOriginal != originalPolicy {
				t.Fatal("PUT changed the stored deletion policy")
			}
			w = request("POST", "run", map[string]any{"ids": []int64{j.ID}})
			if !strings.Contains(w.Body.String(), fmt.Sprintf(`"accepted":[%d]`, j.ID)) {
				t.Fatal(w.Body.String())
			}
			j, _ = s.Store.muxJob(j.ID)
			if j.Status != "queued" || j.Spec.DeleteOriginal {
				t.Fatal("queue did not snapshot the current global policy", j)
			}
			// A later settings change must not alter this job's replacement behavior.
			s.mu.Lock()
			s.settings.Mux.DeleteOriginal = true
			s.mu.Unlock()
			j, _ = s.Store.muxJob(j.ID)
			tmp := filepath.Join(dir, ".verified.partial")
			if e := os.WriteFile(tmp, []byte("new-data"), 0600); e != nil {
				t.Fatal(e)
			}
			final := src
			if scenario == "different-name" {
				final = filepath.Join(dir, "New.mkv")
			}
			if e := s.Mux.finalize(context.Background(), &j, f, src, tmp, final); e != nil {
				t.Fatal(e)
			}
			preserved := src
			if final == src {
				preserved = filepath.Join(dir, j.BackupName)
				if j.BackupName == "" {
					t.Fatal("missing backup")
				}
			}
			if b, e := os.ReadFile(preserved); e != nil || string(b) != "original" {
				t.Fatal("original not preserved", string(b), e)
			}
			if b, e := os.ReadFile(final); e != nil || string(b) != "new-data" {
				t.Fatal("output not published", string(b), e)
			}
		})
	}
}
