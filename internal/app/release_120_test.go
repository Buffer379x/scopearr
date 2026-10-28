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
	"reflect"
	"strings"
	"testing"
	"time"
)

func muxFixture120() (MuxSource, MuxSpec) {
	source := MuxSource{Container: "Matroska", DurationNS: int64(10 * time.Second), Size: 8, Tracks: []MuxTrack{{ID: 0, Type: "video", Codec: "AVC", Language: "und", Default: true}, {ID: 1, Type: "audio", Codec: "AAC", Language: "en", Default: true}, {ID: 2, Type: "audio", Codec: "AAC", Language: "de"}}}
	spec := MuxSpec{OutputName: "Movie", DeleteOriginal: true, Chapters: true, Attachments: true, Tracks: map[int]MuxTrackSpec{0: {Keep: true, Language: "und", Default: true}, 1: {Keep: true, Language: "en", Default: true}, 2: {Keep: false, Language: "de"}}}
	return source, spec
}
func TestMuxArguments120(t *testing.T) {
	source, spec := muxFixture120()
	args, e := buildMuxArgs("/media/source.mp4", "/media/.Movie.partial", source, spec)
	if e != nil {
		t.Fatal(e)
	}
	joined := strings.Join(args, " ")
	for _, part := range []string{"--video-tracks 0", "--audio-tracks 1", "--no-subtitles", "/media/source.mp4"} {
		if !strings.Contains(joined, part) {
			t.Fatal(joined)
		}
	}
	if strings.Contains(joined, "--language") {
		t.Fatal("unchanged language rewritten")
	}
	p := spec.Tracks[1]
	p.Language = "de"
	p.Name = "German audio"
	p.Default = false
	p.Forced = true
	spec.Tracks[1] = p
	spec.Chapters = false
	spec.Attachments = false
	args, e = buildMuxArgs("/media/src", "/media/out", source, spec)
	if e != nil {
		t.Fatal(e)
	}
	joined = strings.Join(args, " ")
	for _, part := range []string{"--language 1:de", "--track-name 1:German audio", "--default-track-flag 1:0", "--forced-display-flag 1:1", "--no-chapters", "--no-attachments"} {
		if !strings.Contains(joined, part) {
			t.Fatal(joined)
		}
	}
	for _, name := range []string{"", "../x", ".x", "a/b", "a\\b", "a\x00b", "a\nb", strings.Repeat("a", 201), "x.partial", "x.scopearr-backup-1"} {
		if _, e := muxOutputName(name); e == nil {
			t.Errorf("accepted %q", name)
		}
	}
	if n, e := muxOutputName("Movie.MKV"); e != nil || n != "Movie" {
		t.Fatal(n, e)
	}
	for _, scenario := range []string{"none", "no-video", "defaults", "language", "name", "extra"} {
		t.Run(scenario, func(t *testing.T) {
			source, spec := muxFixture120()
			switch scenario {
			case "none":
				for id, p := range spec.Tracks {
					p.Keep = false
					spec.Tracks[id] = p
				}
			case "no-video":
				p := spec.Tracks[0]
				p.Keep = false
				spec.Tracks[0] = p
			case "defaults":
				p := spec.Tracks[2]
				p.Keep = true
				p.Default = true
				spec.Tracks[2] = p
			case "language":
				p := spec.Tracks[1]
				p.Language = "../not-a-language"
				spec.Tracks[1] = p
			case "name":
				p := spec.Tracks[1]
				p.Name = "bad\nname"
				spec.Tracks[1] = p
			case "extra":
				spec.Tracks[88] = MuxTrackSpec{Keep: true, Language: "en"}
			}
			if _, e := buildMuxArgs("/src", "/out", source, spec); e == nil {
				t.Fatal("invalid specification accepted")
			}
		})
	}
}
func muxTempDir120(t *testing.T) string {
	t.Helper()
	dir, e := os.MkdirTemp("/var/tmp", "scopearr-mux-test-")
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	return dir
}
func TestMuxPathsAndChecks120(t *testing.T) {
	root := muxTempDir120(t)
	file := filepath.Join(root, "Movie.mkv")
	os.WriteFile(file, []byte("original"), 0600)
	m := defaultMuxSettings()
	m.Mappings = "/arr => " + root + "\n/arr/movies => " + root
	if p, e := resolveLocalPath(m, "/arr/movies/Movie.mkv"); e != nil || p != file {
		t.Fatal(p, e)
	}
	if _, e := resolveLocalPath(m, "/unmapped/Movie.mkv"); e == nil {
		t.Fatal("missing mapping accepted")
	}
	os.Symlink("/etc/passwd", filepath.Join(root, "escape.mkv"))
	if _, e := resolveLocalPath(m, "/arr/escape.mkv"); e == nil {
		t.Fatal("escaping symlink accepted")
	}
	for _, v := range []string{"/data/media", "/proc", "/sys/a", "/etc", "/usr/a", "/tmp/a"} {
		m.Mappings = "/arr => " + v
		cfg := DefaultSettings()
		cfg.Mux = m
		if normalizeMux(&cfg) == nil {
			t.Fatal("forbidden root", v)
		}
	}
	old := muxSpace
	defer func() { muxSpace = old }()
	muxSpace = func(string) (uint64, error) { return 2 << 30, nil }
	st, _ := os.Stat(file)
	source := MuxSource{Size: st.Size(), ModTime: st.ModTime()}
	if !checkMuxFile(file, 8, source).Ready() {
		t.Fatal("valid source rejected")
	}
	if checkMuxFile(file, 9, source).SizeMatches {
		t.Fatal("size mismatch accepted")
	}
	os.Chmod(root, 0555)
	if checkMuxFile(file, 8, source).Writable {
		t.Fatal("read-only directory accepted")
	}
	os.Chmod(root, 0700)
	muxSpace = func(string) (uint64, error) { return 1, nil }
	if checkMuxFile(file, 8, source).FreeSpace {
		t.Fatal("insufficient free space accepted")
	}
}

type fakeMux120 struct {
	fail   bool
	cancel bool
	source MuxSource
}

func (f *fakeMux120) Version(context.Context) (string, error) { return "96.0", nil }
func (f *fakeMux120) Identify(_ context.Context, path string) (MuxSource, error) {
	s := f.source
	st, e := os.Stat(path)
	if e != nil {
		return s, e
	}
	s.Size = st.Size()
	s.ModTime = st.ModTime()
	if strings.HasSuffix(path, ".partial") {
		s.Tracks = s.Tracks[:2]
	}
	return s, nil
}
func (f *fakeMux120) Mux(ctx context.Context, args []string, progress func(int)) ([]string, error) {
	var out string
	for i, a := range args {
		if a == "-o" {
			out = args[i+1]
		}
	}
	if e := os.WriteFile(out, []byte("new-data"), 0600); e != nil {
		return nil, e
	}
	progress(50)
	if f.fail {
		return nil, errors.New("fake mux failed")
	}
	if f.cancel {
		<-ctx.Done()
		return nil, ctx.Err()
	}
	return nil, nil
}
func muxServer120(t *testing.T) (*Server, context.CancelFunc) {
	t.Helper()
	store := testStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	s, e := NewServer(ctx, store, nil, "1.2.0-test")
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { cancel(); s.Sync.Shutdown() })
	s.mu.Lock()
	s.settings.Mux = defaultMuxSettings()
	s.settings.Mux.Enabled = true
	s.mu.Unlock()
	s.Mux.tool.Installed = true
	return s, cancel
}
func TestMuxFinalize120(t *testing.T) {
	for _, scenario := range []string{"renamed-delete", "same-delete", "same-backup", "delete-error", "identity-mismatch", "existing-target"} {
		t.Run(scenario, func(t *testing.T) {
			s, _ := muxServer120(t)
			dir := muxTempDir120(t)
			src := filepath.Join(dir, "Movie.mkv")
			tmp := filepath.Join(dir, ".Movie.partial")
			os.WriteFile(src, []byte("original"), 0600)
			os.WriteFile(tmp, []byte("new-data"), 0600)
			source, spec := muxFixture120()
			j := MuxJob{Service: "radarr", FileID: 1, MediaID: 10, Title: "Movie", SourceName: "Movie.mkv", Status: "running", Spec: spec, Source: source}
			if e := s.Store.muxSave(&j); e != nil {
				t.Fatal(e)
			}
			deletes := 0
			arr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == "GET" {
					size := 8
					if scenario == "identity-mismatch" {
						size = 9
					}
					json.NewEncoder(w).Encode(map[string]any{"path": "/arr/Movie.mkv", "size": size})
					return
				}
				if r.Method != "DELETE" || r.URL.Path != "/api/v3/moviefile/1" {
					t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
				}
				deletes++
				if scenario == "delete-error" {
					w.WriteHeader(500)
					return
				}
				if scenario != "renamed-delete" {
					if _, e := os.Stat(tmp); e != nil {
						t.Error("temporary output missing before deletion")
					}
				}
				os.Remove(src)
				w.WriteHeader(200)
			}))
			defer arr.Close()
			s.mu.Lock()
			s.settings.Instances = []ServiceConfig{{ID: "radarr", Type: "radarr", Enabled: true, URL: arr.URL, APIKey: "secret"}}
			s.mu.Unlock()
			f := File{ID: 1, Service: "radarr", MediaID: 10, Size: 8, SourcePath: "/arr/Movie.mkv"}
			final := src
			if scenario == "renamed-delete" || scenario == "existing-target" {
				final = filepath.Join(dir, "New.mkv")
			}
			if scenario == "same-backup" {
				j.Spec.DeleteOriginal = false
			}
			if scenario == "existing-target" {
				os.WriteFile(final, []byte("keep"), 0600)
			}
			e := s.Mux.finalize(context.Background(), &j, f, src, tmp, final)
			if scenario == "existing-target" {
				if e == nil || deletes != 0 {
					t.Fatal(e, deletes)
				}
				b, _ := os.ReadFile(final)
				if string(b) != "keep" {
					t.Fatal("target overwritten")
				}
				return
			}
			if e != nil {
				t.Fatal(e)
			}
			b, _ := os.ReadFile(final)
			if string(b) != "new-data" {
				t.Fatal("output lost", string(b))
			}
			if _, e := os.Stat(tmp); !os.IsNotExist(e) {
				t.Fatal("temporary output remains")
			}
			if scenario == "same-backup" || scenario == "delete-error" || scenario == "identity-mismatch" {
				b, _ := os.ReadFile(filepath.Join(dir, j.BackupName))
				if string(b) != "original" {
					t.Fatal("backup lost")
				}
			}
			if scenario == "delete-error" || scenario == "identity-mismatch" {
				if j.Status != "needs_attention" {
					t.Fatal(j.Status)
				}
			}
			if scenario == "identity-mismatch" && deletes != 0 {
				t.Fatal("deleted changed identity")
			}
		})
	}
}
func TestMuxExecutionFailureAndRecovery120(t *testing.T) {
	s, _ := muxServer120(t)
	dir := muxTempDir120(t)
	src := filepath.Join(dir, "Movie.mkv")
	os.WriteFile(src, []byte("original"), 0600)
	source, spec := muxFixture120()
	st, _ := os.Stat(src)
	source.ModTime = st.ModTime()
	f := sample(1, "Movie.mkv")
	f.SourcePath = "/arr/Movie.mkv"
	f.Size = 8
	f.MediaID = 10
	s.Store.Replace("radarr", []File{f}, SyncStatus{})
	s.mu.Lock()
	s.settings.Mux.Mappings = "/arr => " + dir
	s.mu.Unlock()
	s.Mux.testRunner = &fakeMux120{fail: true, source: source}
	j := MuxJob{Service: "radarr", FileID: 1, MediaID: 10, SourceName: "Movie.mkv", Title: "Movie", Source: source, Spec: spec, Status: "running"}
	s.Store.muxSave(&j)
	if e := s.Mux.execute(context.Background(), &j); e == nil {
		t.Fatal("mux failure lost")
	}
	if _, e := os.Stat(muxTemp(src, j)); !os.IsNotExist(e) {
		t.Fatal("partial output remains")
	}
	b, _ := os.ReadFile(src)
	if string(b) != "original" {
		t.Fatal("original changed")
	}
	j.Status = "running"
	j.Message = "Muxing"
	s.Store.muxSave(&j)
	os.WriteFile(muxTemp(src, j), []byte("partial"), 0600)
	s.Mux.recoverJobs()
	j, _ = s.Store.muxJob(j.ID)
	if j.Status != "failed" {
		t.Fatal(j.Status)
	}
	if _, e := os.Stat(muxTemp(src, j)); !os.IsNotExist(e) {
		t.Fatal("orphan remains")
	}
	j.Status = "running"
	j.Message = "Replacing"
	s.Store.muxSave(&j)
	os.WriteFile(muxTemp(src, j), []byte("verified"), 0600)
	os.Remove(src)
	s.Mux.recoverJobs()
	j, _ = s.Store.muxJob(j.ID)
	if j.Status != "needs_attention" {
		t.Fatal(j.Status)
	}
	b, _ = os.ReadFile(muxTemp(src, j))
	if string(b) != "verified" {
		t.Fatal("verified replacement lost on restart")
	}
	w := httptest.NewRecorder()
	s.muxHTTP(w, httptest.NewRequest("DELETE", fmt.Sprintf("/api/mux/jobs?id=%d", j.ID), nil))
	if w.Code != 409 {
		t.Fatal("recovery job was removed", w.Code, w.Body.String())
	}
	if _, e := s.Store.muxJob(j.ID); e != nil {
		t.Fatal("recovery metadata lost", e)
	}

}
func TestMuxWriterAllowlistAndRescan120(t *testing.T) {
	s, _ := muxServer120(t)
	calls := []string{}
	arr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.Method+" "+r.URL.Path)
		if r.Header.Get("X-Api-Key") != "secret" {
			t.Error("missing auth")
		}
		if r.Method == "POST" {
			var body map[string]any
			json.NewDecoder(r.Body).Decode(&body)
			if body["name"] != "RescanMovie" || body["movieId"] != float64(10) {
				t.Error(body)
			}
			fmt.Fprint(w, `{"id":7}`)
		} else {
			fmt.Fprint(w, `{"id":7,"status":"completed"}`)
		}
	}))
	defer arr.Close()
	c := ServiceConfig{ID: "radarr", Type: "radarr", Enabled: true, URL: arr.URL, APIKey: "secret"}
	client := NewArr(c)
	for _, v := range []struct {
		method, path string
		body         any
	}{{"DELETE", "movie/1", nil}, {"DELETE", "episodefile/1", nil}, {"DELETE", "moviefile/0", nil}, {"GET", "command/../1", nil}, {"POST", "command", map[string]any{"name": "RefreshMovie", "movieId": 10}}, {"POST", "command", map[string]any{"name": "RescanMovie"}}} {
		if e := client.muxRequest(context.Background(), v.method, v.path, v.body, nil); e == nil {
			t.Error("allowlist accepted", v)
		}
	}
	if len(calls) > 0 {
		t.Fatal("invalid request reached upstream")
	}
	s.mu.Lock()
	s.settings.Instances = []ServiceConfig{c}
	s.settings.Mux.NotifyMedia = false
	s.mu.Unlock()
	if e := s.Mux.finishSync(context.Background(), &MuxJob{Service: "radarr", MediaID: 10, Spec: MuxSpec{OutputName: "Movie"}}, File{SourcePath: "/arr/Movie.mkv"}); e != nil {
		t.Fatal(e)
	}
	var job WebhookJob
	if e := s.Store.Get("webhook-job:radarr:10", &job); e != nil || !job.InternalMux || !job.All || job.Source != tagEndpoint(c) {
		t.Fatal(job, e)
	}
	if e := s.Webhooks.Enqueue(WebhookJob{Service: "radarr", MediaID: 10, FileIDs: []int{1}, Source: tagEndpoint(c)}); e != nil {
		t.Fatal(e)
	}
	if e := s.Store.Get("webhook-job:radarr:10", &job); e != nil || !job.InternalMux || !job.All {
		t.Fatal("incoming webhook lost internal mux sync", job, e)
	}

}
func TestMuxStoreRevisionHTTPAndRedaction120(t *testing.T) {
	s, _ := muxServer120(t)
	source, spec := muxFixture120()
	j := MuxJob{Service: "radarr", FileID: 1, MediaID: 10, Title: "Movie", SourceName: "Movie.mkv", Spec: spec, Source: source, Status: "draft", Log: "#GUI#warning /media/secret/movie.mkv"}
	if e := s.Store.muxSave(&j); e != nil {
		t.Fatal(e)
	}
	duplicate := j
	duplicate.ID = 0
	if s.Store.muxSave(&duplicate) == nil {
		t.Fatal("duplicate file accepted")
	}
	stale := j
	if e := s.Store.muxSave(&j); e != nil {
		t.Fatal(e)
	}
	if !errors.Is(s.Store.muxSave(&stale), errMuxRevision) {
		t.Fatal("stale revision accepted")
	}
	s.Store.DB.Exec("INSERT INTO sessions(token,csrf,expires) VALUES(?,?,?)", tokenHash("mux-session"), "mux-csrf", time.Now().Add(time.Hour).Unix())
	request := func(method, route, body, csrf string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, route, strings.NewReader(body))
		r.AddCookie(&http.Cookie{Name: "scopearr_session", Value: "mux-session"})
		r.Header.Set("X-CSRF-Token", csrf)
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		return w
	}
	if w := request("PUT", fmt.Sprintf("/api/mux/jobs?id=%d", j.ID), `{}`, ""); w.Code != 403 {
		t.Fatal(w.Code, w.Body.String())
	}
	w := request("GET", "/api/mux/jobs", "", "")
	if w.Code != 200 || strings.Contains(w.Body.String(), "/media/") || !strings.Contains(w.Body.String(), "local mux log") {
		t.Fatal(w.Code, w.Body.String())
	}
	body, _ := json.Marshal(map[string]any{"spec": spec, "revision": stale.Revision})
	if w := request("PUT", fmt.Sprintf("/api/mux/jobs?id=%d", j.ID), string(body), "mux-csrf"); w.Code != 409 {
		t.Fatal(w.Code, w.Body.String())
	}
	w = request("POST", "/api/mux/run", fmt.Sprintf(`{"ids":[%d,999999]}`, j.ID), "mux-csrf")
	if w.Code != 200 || !strings.Contains(w.Body.String(), "999999") {
		t.Fatal(w.Code, w.Body.String())
	}
	j, _ = s.Store.muxJob(j.ID)
	j.Status = "succeeded"
	if e := s.Store.muxSave(&j); e != nil {
		t.Fatal(e)
	}
	if w := request("POST", fmt.Sprintf("/api/mux/jobs/identify?id=%d", j.ID), "{}", "mux-csrf"); w.Code != 409 {
		t.Fatal("completed source can be replaced", w.Code, w.Body.String())
	}
	s.mu.Lock()
	s.settings.Mux.Enabled = false
	s.mu.Unlock()
	if w := request("GET", "/api/mux/jobs", "", ""); w.Code != 404 {
		t.Fatal(w.Code)
	}
}
func TestMuxIdentifyAndVerification120(t *testing.T) {
	raw := []byte(`{"container":{"recognized":true,"type":"Matroska","properties":{"duration":10000000000}},"tracks":[{"id":0,"type":"video","codec":"AVC","properties":{"language":"eng","language_ietf":"en-US","default_track":true,"enabled_track":true,"pixel_dimensions":"1920x1080"}}],"chapters":[{"num_entries":3}],"attachments":[{}]}`)
	s, e := parseMuxSource(raw)
	if e != nil || s.Tracks[0].Language != "en-US" || s.Chapters != 3 || s.Attachments != 1 {
		t.Fatal(s, e)
	}
	source, spec := muxFixture120()
	out := source
	out.Tracks = out.Tracks[:2]
	if e := verifyMux(source, out, spec); e != nil {
		t.Fatal(e)
	}
	out.DurationNS += int64(2 * time.Second)
	if verifyMux(source, out, spec) == nil {
		t.Fatal("wrong duration accepted")
	}
	if got := muxVersionPattern.FindStringSubmatch("mkvmerge v96.0 ('It's My Life') 64-bit"); !reflect.DeepEqual(got, []string{"mkvmerge v96.0", "96.0"}) {
		t.Fatal(got)
	}
}

func TestMuxRealIntegration120(t *testing.T) {
	binary := os.Getenv("SCOPEARR_MKVMERGE")
	if binary == "" {
		t.Skip("Set SCOPEARR_MKVMERGE to <apk-root>/usr/bin/mkvmerge")
	}
	root := filepath.Dir(filepath.Dir(filepath.Dir(binary)))
	base := t.TempDir()
	os.MkdirAll(filepath.Join(base, "tmp"), 0700)
	os.MkdirAll(filepath.Join(base, "home"), 0700)
	runner := &toolRunner{root: root, base: base}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	if _, e := runner.Version(ctx); e != nil {
		t.Fatal(e)
	}
	wav, e := filepath.Abs("testdata/mux120.wav")
	if e != nil {
		t.Fatal(e)
	}
	src := filepath.Join(base, "input.mkv")
	if _, e = runner.output(ctx, 64<<10, "-o", src, "--language", "0:en", wav, "--language", "0:de", wav); e != nil {
		t.Fatal(e)
	}
	source, e := runner.Identify(ctx, src)
	if e != nil || len(source.Tracks) != 2 {
		t.Fatal(source, e)
	}
	spec := MuxSpec{OutputName: "output", Tracks: map[int]MuxTrackSpec{}, Chapters: true, Attachments: true}
	for i, track := range source.Tracks {
		spec.Tracks[track.ID] = MuxTrackSpec{Keep: i == 0, Language: track.Language, Name: track.Name, Default: track.Default, Forced: track.Forced}
	}
	output := filepath.Join(base, "output.mkv")
	args, e := buildMuxArgs(src, output, source, spec)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = runner.Mux(ctx, args, func(int) {}); e != nil {
		t.Fatal(e)
	}
	result, e := runner.Identify(ctx, output)
	if e != nil {
		t.Fatal(e)
	}
	if e = verifyMux(source, result, spec); e != nil {
		t.Fatal(e)
	}
	t.Logf("Real MKVToolNix: %d -> %d tracks, %d -> %d bytes", len(source.Tracks), len(result.Tracks), source.Size, result.Size)
}
func TestMuxMediaNotification120(t *testing.T) {
	s, _ := muxServer120(t)
	arr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" {
			fmt.Fprint(w, `{"id":1}`)
		} else {
			fmt.Fprint(w, `{"id":1,"status":"completed"}`)
		}
	}))
	defer arr.Close()
	var got map[string][]map[string]string
	media := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.Path != "/Library/Media/Updated" || r.Header.Get("X-Emby-Token") != "media-key" {
			t.Error("unexpected media request", r.Method, r.URL.Path)
		}
		json.NewDecoder(r.Body).Decode(&got)
		w.WriteHeader(204)
	}))
	defer media.Close()
	s.mu.Lock()
	s.settings.Instances = []ServiceConfig{{ID: "radarr", Type: "radarr", Enabled: true, URL: arr.URL, APIKey: "arr-key"}, {ID: "jellyfin", Type: "jellyfin", Enabled: true, URL: media.URL, APIKey: "media-key", SourceIDs: "radarr", PathMappings: "/arr => /server"}, {ID: "jellyfin-other", Type: "jellyfin", Enabled: true, URL: "http://invalid.invalid", SourceIDs: "sonarr"}}
	s.mu.Unlock()
	j := MuxJob{Service: "radarr", MediaID: 10, Spec: MuxSpec{OutputName: "New"}}
	if e := s.Mux.finishSync(context.Background(), &j, File{SourcePath: "/arr/Old.mkv"}); e != nil {
		t.Fatal(e)
	}
	if fmt.Sprint(got["Updates"]) != "[map[Path:/server/Old.mkv UpdateType:Deleted] map[Path:/server/New.mkv UpdateType:Created]]" {
		t.Fatal(got)
	}
	s.mu.Lock()
	s.settings.Instances[1].PathMappings = "C:/arr => /server"
	s.mu.Unlock()
	if e := s.Mux.finishSync(context.Background(), &j, File{SourcePath: `C:\arr\Old.mkv`}); e != nil {
		t.Fatal(e)
	}
	if fmt.Sprint(got["Updates"]) != "[map[Path:/server/Old.mkv UpdateType:Deleted] map[Path:/server/New.mkv UpdateType:Created]]" {
		t.Fatal("Windows source mapping", got)
	}

}
func TestMuxSchema15Backup120(t *testing.T) {
	dir := t.TempDir()
	store, e := OpenStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = store.DB.Exec("DROP TABLE mux_jobs; ALTER TABLE files DROP COLUMN source_path; PRAGMA user_version=15"); e != nil {
		t.Fatal(e)
	}
	store.DB.Close()
	store, e = OpenStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer store.DB.Close()
	var version int
	store.DB.QueryRow("PRAGMA user_version").Scan(&version)
	backups, _ := filepath.Glob(filepath.Join(dir, "backups", "*.db"))
	if version != 18 || len(backups) != 1 {
		t.Fatal(version, backups)
	}
}

func TestMuxRealQueueAndInternalSync120(t *testing.T) { testMuxRealQueue(t, "") }
func testMuxRealQueue(t *testing.T, workDir string) {
	binary := os.Getenv("SCOPEARR_MKVMERGE")
	if binary == "" {
		t.Skip("Set SCOPEARR_MKVMERGE for real queue integration")
	}
	s, _ := muxServer120(t)
	dir := muxTempDir120(t)
	root := filepath.Dir(filepath.Dir(filepath.Dir(binary)))
	base := t.TempDir()
	os.MkdirAll(filepath.Join(base, "home"), 0700)
	os.MkdirAll(filepath.Join(base, "tmp"), 0700)
	runner := &toolRunner{root: root, base: base}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	wav, _ := filepath.Abs("testdata/mux120.wav")
	src := filepath.Join(dir, "Movie.mkv")
	if _, e := runner.output(ctx, 64<<10, "-o", src, "--language", "0:en", wav, "--language", "0:de", wav); e != nil {
		t.Fatal(e)
	}
	source, e := runner.Identify(ctx, src)
	if e != nil {
		t.Fatal(e)
	}
	requests := []string{}
	arr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests = append(requests, r.Method+" "+r.URL.Path)
		switch r.Method + " " + r.URL.Path {
		case "GET /api/v3/moviefile/1":
			json.NewEncoder(w).Encode(map[string]any{"path": "/arr/Movie.mkv", "size": source.Size})
		case "DELETE /api/v3/moviefile/1":
			if e := os.Remove(src); e != nil {
				t.Error(e)
			}
			w.WriteHeader(200)
		case "POST /api/v3/command":
			fmt.Fprint(w, `{"id":3}`)
		case "GET /api/v3/command/3":
			fmt.Fprint(w, `{"id":3,"status":"completed"}`)
		case "GET /api/v3/movie/10":
			fmt.Fprint(w, `{"id":10,"title":"Movie"}`)
		case "GET /api/v3/moviefile":
			st, e := os.Stat(src)
			if e != nil {
				t.Error(e)
				w.WriteHeader(500)
				return
			}
			json.NewEncoder(w).Encode([]map[string]any{{"id": 2, "movieId": 10, "path": "/arr/Movie.mkv", "size": st.Size()}})
		default:
			t.Error("unexpected request", r.Method, r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer arr.Close()
	cfg := ServiceConfig{ID: "radarr", Type: "radarr", Enabled: true, URL: arr.URL, APIKey: "local-test-key", WebhookEnabled: false}
	s.mu.Lock()
	s.settings.Instances = []ServiceConfig{cfg}
	s.settings.Mux.Mappings = "/arr => " + dir
	s.settings.Mux.NotifyMedia = false
	s.settings.Mux.WorkDir = workDir
	s.mu.Unlock()
	s.Mux.testRunner = runner
	f := sample(1, "Movie.mkv")
	f.SourcePath = "/arr/Movie.mkv"
	f.MediaID = 10
	f.Size = source.Size
	if e = s.Store.Replace("radarr", []File{f}, SyncStatus{}); e != nil {
		t.Fatal(e)
	}
	spec := MuxSpec{OutputName: "Movie", DeleteOriginal: true, Chapters: true, Attachments: true, Tracks: map[int]MuxTrackSpec{}}
	for i, track := range source.Tracks {
		spec.Tracks[track.ID] = MuxTrackSpec{Keep: i == 0, Language: track.Language, Name: track.Name, Default: track.Default, Forced: track.Forced}
	}
	j := MuxJob{Service: "radarr", FileID: 1, MediaID: 10, SourceName: "Movie.mkv", Title: "Movie", Status: "queued", Source: source, Spec: spec}
	if e = s.Store.muxSave(&j); e != nil {
		t.Fatal(e)
	}
	s.Mux.processOne(ctx)
	j, e = s.Store.muxJob(j.ID)
	if e != nil || j.Status != "succeeded" || j.Progress != 100 {
		t.Fatal(j, e)
	}
	result, e := runner.Identify(ctx, src)
	if e != nil || len(result.Tracks) != 1 {
		t.Fatal(result, e)
	}
	s.Webhooks.processOne(ctx)
	f, e = s.Store.muxFile("radarr", 2)
	if e != nil || f.SourcePath != "/arr/Movie.mkv" {
		t.Fatal("internal delta did not run with webhooks disabled", f, e, requests)
	}
	if workDir != "" {
		if _, e := os.Stat(muxWorkDir(s.Config().Mux, j)); !os.IsNotExist(e) {
			t.Fatal("work output remains")
		}
	}
	t.Log("Real queue: verified replacement, Arr deletion/rescan and internal delta with incoming webhooks disabled")
}

func TestMuxCancellation120(t *testing.T) {
	s, _ := muxServer120(t)
	dir := muxTempDir120(t)
	src := filepath.Join(dir, "Movie.mkv")
	os.WriteFile(src, []byte("original"), 0600)
	source, spec := muxFixture120()
	st, _ := os.Stat(src)
	source.ModTime = st.ModTime()
	f := sample(1, "Movie.mkv")
	f.SourcePath = "/arr/Movie.mkv"
	f.Size = 8
	s.Store.Replace("radarr", []File{f}, SyncStatus{})
	s.mu.Lock()
	s.settings.Mux.Mappings = "/arr => " + dir
	s.mu.Unlock()
	s.Mux.testRunner = &fakeMux120{source: source, cancel: true}
	j := MuxJob{Service: "radarr", FileID: 1, Title: "Movie", Source: source, Spec: spec, Status: "running"}
	s.Store.muxSave(&j)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if e := s.Mux.execute(ctx, &j); e == nil {
		t.Fatal("cancelled mux succeeded")
	}
	b, _ := os.ReadFile(src)
	if string(b) != "original" {
		t.Fatal("cancel changed original")
	}
	if _, e := os.Stat(muxTemp(src, j)); !os.IsNotExist(e) {
		t.Fatal("cancel left temporary output")
	}
}

func TestMuxLanguageCodes120(t *testing.T) {
	for _, code := range []string{"en", "eng", "und", "en-US", "zh-Hant-TW", "de-DE"} {
		if !muxLanguageValid(code) {
			t.Error("valid language rejected", code)
		}
	}
	for _, code := range []string{"English", "Deutsch", "../de", "zzzz", "en_foo", "", "de\n"} {
		if muxLanguageValid(code) {
			t.Error("invalid language accepted", code)
		}
	}
}
