package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func muxQueue125(t *testing.T, handler http.HandlerFunc) (*Server, MuxJob, string) {
	t.Helper()
	s, _ := muxServer120(t)
	dir := muxTempDir120(t)
	src := filepath.Join(dir, "Movie.mkv")
	if e := os.WriteFile(src, []byte("original"), 0600); e != nil {
		t.Fatal(e)
	}
	source, spec := muxFixture120()
	st, _ := os.Stat(src)
	source.ModTime = st.ModTime()
	spec.DeleteOriginal = false
	arr := httptest.NewServer(handler)
	t.Cleanup(arr.Close)
	s.mu.Lock()
	s.settings.Instances = []ServiceConfig{{ID: "radarr", Type: "radarr", Enabled: true, URL: arr.URL, APIKey: "test"}}
	s.settings.Mux.Mappings = "/arr => " + dir
	s.settings.Mux.NotifyMedia = false
	s.mu.Unlock()
	s.Mux.testRunner = &fakeMux120{source: source}
	f := sample(1, "Movie.mkv")
	f.Size = 8
	f.MediaID = 10
	f.SourcePath = "/arr/Movie.mkv"
	if e := s.Store.Replace("radarr", []File{f}, SyncStatus{}); e != nil {
		t.Fatal(e)
	}
	j := MuxJob{Service: "radarr", FileID: 1, MediaID: 10, SourceName: "Movie.mkv", Status: "queued", Source: source, Spec: spec}
	if e := s.Store.muxSave(&j); e != nil {
		t.Fatal(e)
	}
	old := muxSpace
	muxSpace = func(string) (uint64, error) { return 10 << 30, nil }
	t.Cleanup(func() { muxSpace = old })
	return s, j, src
}
func TestMuxRemovedLongAudio125(t *testing.T) {
	source, spec := muxFixture120()
	source.DurationNS = int64(7921 * time.Second)
	output := source
	output.DurationNS = int64(7880 * time.Second)
	output.Tracks = output.Tracks[:2]
	if e := verifyMux(source, output, spec); e != nil {
		t.Fatal("valid shorter retained tracks rejected:", e)
	}
}
func TestMuxFinalRevision125(t *testing.T) {
	var s *Server
	var j MuxJob
	s, j, _ = muxQueue125(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v3/command":
			fmt.Fprint(w, `{"id":3}`)
		case "/api/v3/command/3":
			if _, e := s.Store.DB.Exec("UPDATE mux_jobs SET revision=revision+1 WHERE id=?", j.ID); e != nil {
				t.Error(e)
			}
			json.NewEncoder(w).Encode(map[string]any{"id": 3, "status": "completed"})
		default:
			http.Error(w, "unexpected", 404)
		}
	})
	s.Mux.processOne(context.Background())
	got, e := s.Store.muxJob(j.ID)
	if e != nil || got.Status != "succeeded" {
		t.Fatalf("worker ended but job remained %s: %v", got.Status, e)
	}
}

func TestMuxTrackDuration125(t *testing.T) {
	for _, tc := range []struct {
		value string
		want  int64
	}{{"02:11:20.123456789", int64(7880*time.Second) + 123456789}, {"", 0}, {"bad", 0}, {"01:60:00", 0}, {"-01:00:00", 0}, {"999999999999:00:00", 0}} {
		raw := fmt.Sprintf(`{"container":{"recognized":true,"type":"Matroska"},"tracks":[{"id":0,"type":"video","properties":{"tag_duration":%q}}]}`, tc.value)
		s, e := parseMuxSource([]byte(raw))
		if e != nil || s.Tracks[0].DurationNS != tc.want {
			t.Fatal(tc, s, e)
		}
	}
	source, spec := muxFixture120()
	source.DurationNS = int64(7921 * time.Second)
	source.Tracks[0].DurationNS = int64(7880 * time.Second)
	source.Tracks[1].DurationNS = int64(7880 * time.Second)
	source.Tracks[2].DurationNS = source.DurationNS
	output := source
	output.Tracks = output.Tracks[:2]
	output.DurationNS = int64(7880 * time.Second)
	if e := verifyMux(source, output, spec); e != nil {
		t.Fatal(e)
	}
	for _, duration := range []time.Duration{7923 * time.Second, 7600 * time.Second, 0} {
		output.DurationNS = int64(duration)
		e := verifyMux(source, output, spec)
		var detail *muxVerificationError
		if !errors.As(e, &detail) || !strings.Contains(detail.detail, "source 2:12:01") {
			t.Fatal("missing verification values", e)
		}
	}
	// No removed tracks retains the original one-second bound.
	for id, p := range spec.Tracks {
		p.Keep = true
		spec.Tracks[id] = p
	}
	output = source
	output.DurationNS = source.DurationNS - int64(2*time.Second)
	if verifyMux(source, output, spec) == nil {
		t.Fatal("unremoved tracks weakened duration check")
	}
}
func TestMuxFinalRetryAndPending125(t *testing.T) {
	for _, pending := range []bool{false, true} {
		t.Run(fmt.Sprint(pending), func(t *testing.T) {
			s, j, _ := muxQueue125(t, func(w http.ResponseWriter, r *http.Request) {
				if r.Method == "POST" {
					fmt.Fprint(w, `{"id":3}`)
				} else {
					fmt.Fprint(w, `{"id":3,"status":"completed"}`)
				}
			})
			attempts := 0
			s.Mux.testFinishDelay = time.Millisecond
			s.Mux.testFinishBudget = 10 * time.Millisecond
			s.Mux.testFinish = func(j *MuxJob) error {
				attempts++
				if pending || attempts <= 2 {
					return errors.New("database is locked (SQLITE_BUSY)")
				}
				return s.Store.muxFinish(j)
			}
			s.Mux.processOne(context.Background())
			got, _ := s.Store.muxJob(j.ID)
			if pending {
				if got.Status != "running" || s.Mux.pendingFinal[j.ID].Status != "succeeded" {
					t.Fatal(got, s.Mux.pendingFinal)
				}
				pending = false
				s.Mux.processOne(context.Background())
				got, _ = s.Store.muxJob(j.ID)
			}
			if got.Status != "succeeded" || got.FinishedAt == nil || len(s.Mux.pendingFinal) > 0 || attempts < 3 {
				t.Fatal(got, attempts)
			}
		})
	}
}
func TestMuxWatchdog125(t *testing.T) {
	for _, tc := range []struct {
		message, want string
		active        bool
	}{{"Muxing", "failed", false}, {"Replacing", "needs_attention", false}, {"Waiting for Radarr rescan (queued)", "needs_attention", false}, {"Rescanning", "running", true}} {
		s, _ := muxServer120(t)
		source, spec := muxFixture120()
		j := MuxJob{Service: "radarr", FileID: 1, Source: source, Spec: spec, Status: "running"}
		s.Store.muxSave(&j)
		s.Store.DB.Exec("UPDATE mux_jobs SET message=?,updated_at=? WHERE id=?", tc.message, time.Now().Add(-2*time.Minute).UTC().Format(time.RFC3339Nano), j.ID)
		if tc.active {
			s.Mux.active = j.ID
		}
		s.Mux.processOne(context.Background())
		got, _ := s.Store.muxJob(j.ID)
		if got.Status != tc.want {
			t.Fatal(tc, got)
		}
		if !tc.active && !strings.HasPrefix(got.Message, "Job state was lost") {
			t.Fatal(got.Message)
		}
	}
}

type muxRunner125 struct {
	fakeMux120
	outputTimeout, invalid bool
}

func (r *muxRunner125) Identify(ctx context.Context, path string) (MuxSource, error) {
	if strings.HasSuffix(path, ".partial") {
		if r.outputTimeout {
			<-ctx.Done()
			return MuxSource{}, ctx.Err()
		}
		if r.invalid {
			s := r.source
			s.Container = ""
			return s, nil
		}
	}
	output, e := r.fakeMux120.Identify(ctx, path)
	if data, _ := os.ReadFile(path); string(data) == "new-data" && len(output.Tracks) > 2 {
		output.Tracks = output.Tracks[:2]
	}
	return output, e
}
func TestMuxLogAndOutputTimeout125(t *testing.T) {
	for _, scenario := range []string{"success", "mux-error", "verification-error", "output-timeout", "rescan-timeout", "rescan-http"} {
		t.Run(scenario, func(t *testing.T) {
			states := []string{"queued", "started", "completed"}
			index := 0
			s, j, src := muxQueue125(t, func(w http.ResponseWriter, r *http.Request) {
				if scenario == "rescan-http" {
					http.Error(w, "private /absolute/path", 503)
					return
				}
				if r.Method == "POST" {
					fmt.Fprint(w, `{"id":3}`)
					return
				}
				state := states[min(index, len(states)-1)]
				index++
				if scenario == "rescan-timeout" {
					state = "queued"
				}
				fmt.Fprintf(w, `{"id":3,"status":%q}`, state)
			})
			s.Mux.testRunner = &muxRunner125{fakeMux120: fakeMux120{source: j.Source, fail: scenario == "mux-error"}, outputTimeout: scenario == "output-timeout", invalid: scenario == "verification-error"}
			s.Mux.testOutputTimeout = 5 * time.Millisecond
			s.Mux.testRescanPoll = time.Millisecond
			s.Mux.testRescanTimeout = 30 * time.Millisecond
			s.Mux.processOne(context.Background())
			got, _ := s.Store.muxJob(j.ID)
			raw, e := os.ReadFile(s.Mux.logPath(j.ID))
			if e != nil {
				t.Fatal(e)
			}
			text := string(raw)
			if strings.Contains(text, src) || strings.Contains(text, "/absolute/") {
				t.Fatal("path leaked", text)
			}
			if scenario == "success" {
				if got.Status != "succeeded" {
					t.Fatal(got.Message, text)
				}
				previous := -1
				for _, line := range []string{"mkvmerge finished", "Verifying output", "Verified: duration", "Replacing original", "rescan requested", "rescan: queued", "rescan: started", "rescan: completed", "Scopearr library sync queued", "Done: Mux completed"} {
					at := strings.Index(text, line)
					if at <= previous {
						t.Fatal("log missing or out of order", line, text)
					}
					previous = at
				}
			} else {
				if !strings.Contains(text, "Error:") {
					t.Fatal("missing error", text)
				}
				if strings.HasPrefix(scenario, "rescan-") {
					if got.Status != "needs_attention" {
						t.Fatal(got.Status)
					}
				} else {
					if got.Status != "failed" {
						t.Fatal(got.Status)
					}
					b, _ := os.ReadFile(src)
					if string(b) != "original" {
						t.Fatal("original touched")
					}
					if _, e := os.Stat(muxTemp(src, j)); !os.IsNotExist(e) {
						t.Fatal("temporary output retained", e)
					}
				}
				if scenario == "output-timeout" && got.Message != "Output check timed out" {
					t.Fatal(got.Message)
				}
				if scenario == "rescan-timeout" && !strings.Contains(got.Message, "The new file is in place.") {
					t.Fatal(got.Message)
				}
				if scenario == "rescan-http" && !strings.Contains(text, "HTTP 503") {
					t.Fatal(text)
				}
			}
		})
	}
}

func TestMuxRescanFinalRetry125(t *testing.T) {
	var fail atomic.Bool
	fail.Store(true)
	s, j, _ := muxQueue125(t, func(w http.ResponseWriter, r *http.Request) {
		if fail.Load() {
			http.Error(w, "unavailable", 503)
			return
		}
		if r.Method == "POST" {
			fmt.Fprint(w, `{"id":3}`)
		} else {
			fmt.Fprint(w, `{"id":3,"status":"completed"}`)
		}
	})
	s.Mux.testRunner = &muxRunner125{fakeMux120: fakeMux120{source: j.Source}}
	s.Mux.processOne(context.Background())
	got, _ := s.Store.muxJob(j.ID)
	if got.Status != "needs_attention" {
		t.Fatal(got.Message)
	}
	fail.Store(false)
	attempts := 0
	s.Mux.testFinishDelay = time.Millisecond
	s.Mux.testFinish = func(j *MuxJob) error {
		attempts++
		if attempts < 3 {
			return errors.New("database is locked")
		}
		return s.Store.muxFinish(j)
	}
	w := httptest.NewRecorder()
	s.muxHTTP(w, httptest.NewRequest("POST", fmt.Sprintf("/api/mux/jobs/rescan?id=%d", j.ID), nil))
	got, _ = s.Store.muxJob(j.ID)
	if w.Code != 200 || got.Status != "succeeded" || got.FinishedAt == nil || attempts != 3 {
		t.Fatal(w.Code, w.Body.String(), got, attempts)
	}
	log, _ := os.ReadFile(s.Mux.logPath(j.ID))
	if !strings.Contains(string(log), "Error:") || !strings.Contains(string(log), "Done: Mux completed") {
		t.Fatal(string(log))
	}
}

func TestMuxReidentifyDefaults125(t *testing.T) {
	s, j, _ := muxQueue125(t, func(w http.ResponseWriter, r *http.Request) { http.Error(w, "unused", 404) })
	j.Status = "draft"
	j.Source.Tracks[0].Codec = "old codec"
	s.Store.muxSave(&j)
	source, _ := muxFixture120()
	source.Tracks[2].Default = true
	s.Mux.testRunner = &fakeMux120{source: source}
	w := httptest.NewRecorder()
	s.muxHTTP(w, httptest.NewRequest("POST", fmt.Sprintf("/api/mux/jobs/identify?id=%d", j.ID), nil))
	got, _ := s.Store.muxJob(j.ID)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if _, e := buildMuxArgs("/source", "/output", got.Source, got.Spec); e != nil {
		t.Fatal("reidentification produced invalid default tracks", e)
	}
}
