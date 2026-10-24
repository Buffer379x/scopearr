package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestShareDirsSettings144(t *testing.T) {
	for _, tc := range []struct {
		name, value string
		valid       bool
	}{
		{"nested", `{"//documentaries//":"media/documentaries","/skip":"-","/auto":""}`, true},
		{"escape", `{"/movies":"../Fotos"}`, false},
		{"absolute", `{"/movies":"/Fotos"}`, false},
		{"hidden", `{"/movies":"media/.private"}`, false},
		{"system", `{"/movies":"system"}`, false},
		{"user0", `{"/movies":"user0/movies"}`, false},
		{"bad root", `{"relative":"movies"}`, false},
		{"root traversal", `{"/movies/../other":"movies"}`, false},
		{"colliding roots", `{"/movies":"movies","//movies/":"other"}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := DefaultSettings()
			if err := json.Unmarshal([]byte(`{"shareDirs":`+tc.value+`}`), &cfg.Unraid); err != nil {
				t.Fatal(err)
			}
			err := normalizeUnraid(&cfg)
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v, error=%v", tc.valid, err)
			}
			if !tc.valid {
				return
			}
			raw, _ := json.Marshal(cfg.Unraid)
			var result struct {
				ShareDirs map[string]string `json:"shareDirs"`
			}
			json.Unmarshal(raw, &result)
			if result.ShareDirs["/documentaries"] != "media/documentaries" || result.ShareDirs["/skip"] != "-" {
				t.Fatalf("share choices lost: %s", raw)
			}
		})
	}
}

func TestShareDirsSnapshots144(t *testing.T) {
	s, cfg := placementFixture130(t)
	cfg.Unraid.ShareDirs = map[string]string{"/movies": "movies"}
	s.settings = cfg
	snapshot := s.Config()
	snapshot.Unraid.ShareDirs["/movies"] = "changed"
	if s.Config().Unraid.ShareDirs["/movies"] != "movies" {
		t.Error("Config leaked mutable share choices")
	}
	cfg.Unraid.ShareDirs = map[string]string{"/movies": "movies"}
	scan := PlacementScan{Options: cfg.Unraid}
	copied := clonePlacementScan(scan)
	copied.Options.ShareDirs["/movies"] = "changed"
	if scan.Options.ShareDirs["/movies"] != "movies" {
		t.Error("scan snapshot leaked mutable share choices")
	}
	cfg.Unraid.ShareDirs = map[string]string{"/movies": "movies"}
	normalized := cfg
	if err := normalizeUnraid(&normalized); err != nil {
		t.Fatal(err)
	}
	normalized.Unraid.ShareDirs["/movies"] = "normalized"
	if cfg.Unraid.ShareDirs["/movies"] != "movies" {
		t.Fatal("normalization changed its input map")
	}
	changed := s.Config()
	changed.Unraid.ShareDirs = map[string]string{"/movies": "other"}
	if placementMappingHash(cfg) == placementMappingHash(changed) {
		t.Error("share change did not invalidate the plan")
	}
}

// The metadata spy observes real filesystem access; identity aliases model bind mounts.
type shareMetadata144 struct {
	placementOSMetadata
	reads   []string
	aliases map[string]string
}

func (m *shareMetadata144) ReadDir(p string) ([]os.DirEntry, error) {
	m.reads = append(m.reads, p)
	return os.ReadDir(p)
}
func (m *shareMetadata144) Lstat(p string) (os.FileInfo, error) {
	if alias := m.aliases[p]; alias != "" {
		p = alias
	}
	return os.Lstat(p)
}

func TestShareResolution144(t *testing.T) {
	for _, tc := range []struct{ name, arr, selection, mapped, alias, want, status, source string }{
		{"name", "/documentaries", "", "", "", "documentaries", "resolved", "name"},
		{"saved nested", "/documentaries", "media/documentaries", "", "", "media/documentaries", "resolved", "saved"},
		{"disabled wins", "/documentaries", "-", "", "", "", "disabled", "saved"},
		{"missing saved does not guess", "/documentaries", "missing", "", "", "", "unresolved", "saved"},
		{"direct nested identity", "/docs", "", "media/documentaries", "media/documentaries", "media/documentaries", "resolved", "identity"},
		{"top level identity", "/docs", "", "alias", "documentaries", "documentaries", "resolved", "identity"},
		{"nested identity never searched", "/docs", "", "alias", "media/documentaries", "", "unresolved", ""},
		{"missing", "/missing", "", "", "", "", "unresolved", ""},
		{"blocked", "/system", "", "", "", "", "unresolved", ""},
		{"symlink selected", "/docs", "link", "", "", "", "unresolved", "saved"},
		{"symlink ancestor", "/docs", "link/child", "", "", "", "unresolved", "saved"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, cfg := placementFixture130(t)
			user := filepath.Join(cfg.Unraid.DiskRoot, "user")
			for _, dir := range []string{"documentaries", "media/documentaries", "Fotos/private", "system", "real/child"} {
				if e := os.MkdirAll(filepath.Join(user, dir), 0755); e != nil {
					t.Fatal(e)
				}
			}
			if e := os.Symlink(filepath.Join(user, "real"), filepath.Join(user, "link")); e != nil {
				t.Fatal(e)
			}
			cfg.Unraid.ShareDirs = map[string]string{tc.arr: tc.selection}
			root := muxRootFolder{ArrPath: tc.arr}
			metadata := &shareMetadata144{aliases: map[string]string{}}
			if tc.mapped != "" {
				root.Mapped = true
				root.LocalPath = filepath.Join(cfg.Unraid.ShareRoot, tc.mapped)
				if e := os.MkdirAll(filepath.Dir(root.LocalPath), 0755); e != nil {
					t.Fatal(e)
				}
				metadata.aliases[root.LocalPath] = filepath.Join(user, tc.alias)
			}
			got := resolveShareRoot(context.Background(), cfg, root, metadata)
			if got.ShareDir != tc.want || got.Status != tc.status || got.Source != tc.source {
				t.Fatalf("got %+v, want %s/%s/%s", got, tc.want, tc.status, tc.source)
			}
			for _, p := range metadata.reads {
				if p != user {
					t.Fatalf("resolver read share contents: %s", p)
				}
			}
		})
	}
}

func TestShareResolutionRejectsAncestorSymlinks144(t *testing.T) {
	_, cfg := placementFixture130(t)
	base := filepath.Dir(cfg.Unraid.DiskRoot)
	outside := filepath.Join(base, "outside")
	if e := os.MkdirAll(filepath.Join(outside, "user", "movies"), 0755); e != nil {
		t.Fatal(e)
	}
	link := filepath.Join(base, "linked")
	if e := os.Symlink(outside, link); e != nil {
		t.Fatal(e)
	}
	cfg.Unraid.DiskRoot = link
	cfg.Unraid.ShareDirs = map[string]string{"/movies": "movies"}
	metadata := &shareMetadata144{}
	got := resolveShareRoot(context.Background(), cfg, muxRootFolder{ArrPath: "/movies"}, metadata)
	if got.Status != "unresolved" || len(metadata.reads) != 0 {
		t.Fatalf("followed configured ancestor: %+v %v", got, metadata.reads)
	}
}

func TestShareRootsSelectedAndMerged144(t *testing.T) {
	s, cfg := placementFixture130(t)
	calls := map[string]int{}
	arr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls[r.URL.Path]++
		switch r.URL.Path {
		case "/a/api/v3/rootfolder":
			json.NewEncoder(w).Encode([]map[string]string{{"path": "//documentaries//"}, {"path": "/media"}})
		case "/b/api/v3/rootfolder":
			json.NewEncoder(w).Encode([]map[string]string{{"path": "/docs"}, {"path": "/media/documentaries"}})
		default:
			t.Errorf("unselected or non-root request: %s", r.URL.Path)
			http.Error(w, "unexpected", 500)
		}
	}))
	defer arr.Close()
	cfg.Instances = []ServiceConfig{
		{ID: "radarr-a", Type: "radarr", Name: "Movies", Enabled: true, URL: arr.URL + "/a"},
		{ID: "sonarr-b", Type: "sonarr", Name: "Shows", Enabled: true, URL: arr.URL + "/b"},
		{ID: "radarr-c", Type: "radarr", Enabled: true, URL: arr.URL + "/unselected"},
		{ID: "sonarr-d", Type: "sonarr", Enabled: false, URL: arr.URL + "/disabled"},
	}
	cfg.Unraid.ShareDirs = map[string]string{"/docs": "documentaries", "/media/documentaries": "media/documentaries"}
	for _, rel := range []string{"documentaries", "media/documentaries", "Fotos/private"} {
		if e := os.MkdirAll(filepath.Join(cfg.Unraid.DiskRoot, "user", rel), 0755); e != nil {
			t.Fatal(e)
		}
	}
	metadata := &shareMetadata144{}
	got := s.resolveShareRoots(context.Background(), cfg, []string{"radarr-a", "sonarr-b"}, metadata)
	if len(got.Errors) != 0 || len(got.Folders) != 4 || len(got.Directories) != 3 {
		t.Fatalf("unexpected roots: %+v", got)
	}
	for _, dir := range got.Directories {
		if dir.ShareDir == "documentaries" && (!reflect.DeepEqual(dir.InstanceIDs, []string{"radarr-a", "sonarr-b"}) || !reflect.DeepEqual(dir.ArrPaths, []string{"/docs", "/documentaries"})) {
			t.Fatalf("lost provenance: %+v", dir)
		}
		if dir.ShareDir == "media" && !reflect.DeepEqual(dir.ExcludeDirs, []string{"documentaries"}) {
			t.Fatalf("missing nested exclusion: %+v", dir)
		}
	}
	for _, p := range metadata.reads {
		if p != filepath.Join(cfg.Unraid.DiskRoot, "user") {
			t.Fatalf("foreign traversal %s", p)
		}
	}
}

func TestShareSettingsHTTP144(t *testing.T) {
	s, cfg := placementFixture130(t)
	calls := 0
	arr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/api/v3/rootfolder" {
			t.Errorf("unexpected endpoint %s", r.URL.Path)
		}
		json.NewEncoder(w).Encode([]map[string]string{{"path": "/documentaries"}, {"path": "/archive"}})
	}))
	defer arr.Close()
	cfg.Instances[0].URL = arr.URL
	// The settings chooser lists enabled services even when the scan filter excludes them.
	cfg.Unraid.Libraries = []string{"radarr"}
	s.settings = cfg
	user := filepath.Join(cfg.Unraid.DiskRoot, "user")
	for _, rel := range []string{"documentaries", "media/Documentaries/Deep", "media/.hidden", "Fotos/private", "system", ".hidden", "user0", "remotes"} {
		if e := os.MkdirAll(filepath.Join(user, rel), 0755); e != nil {
			t.Fatal(e)
		}
	}
	if e := os.Symlink(filepath.Join(user, "Fotos"), filepath.Join(user, "linked")); e != nil {
		t.Fatal(e)
	}
	before, _ := json.Marshal(s.Config())
	request := func(route string, body any) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(body)
		w := httptest.NewRecorder()
		s.unraidHTTP(w, httptest.NewRequest("POST", route, bytes.NewReader(raw)))
		return w
	}
	draft := cfg.Unraid
	draft.ShareDirs = map[string]string{"/archive": "-"}
	w := request("/api/unraid/shares", map[string]any{"unraid": draft, "mappings": ""})
	if w.Code != 200 {
		t.Fatalf("shares: %d %s", w.Code, w.Body.String())
	}
	var result struct {
		ShareRoots
		Choices []string `json:"choices"`
	}
	if e := json.Unmarshal(w.Body.Bytes(), &result); e != nil {
		t.Fatal(e)
	}
	if len(result.Folders) != 2 || result.Folders[0].Status != "disabled" || result.Folders[1].ShareDir != "documentaries" {
		t.Fatalf("root choices: %s", w.Body.String())
	}
	if !reflect.DeepEqual(result.Choices, []string{"Fotos", "documentaries", "media"}) {
		t.Fatalf("unsafe choices: %v", result.Choices)
	}
	if calls != 1 {
		t.Fatalf("root requests=%d", calls)
	}
	w = request("/api/unraid/share-dirs", map[string]any{"parent": "media"})
	var children struct {
		Parent      string   `json:"parent"`
		Directories []string `json:"directories"`
	}
	json.Unmarshal(w.Body.Bytes(), &children)
	if w.Code != 200 || children.Parent != "media" || !reflect.DeepEqual(children.Directories, []string{"media/Documentaries"}) {
		t.Fatalf("children: %d %s", w.Code, w.Body.String())
	}
	if calls != 1 {
		t.Fatal("child chooser queried Arr")
	}
	for _, parent := range []string{"", "../", "/etc", "linked", "linked/private", ".hidden", "system", "media/.hidden"} {
		w = request("/api/unraid/share-dirs", map[string]any{"parent": parent})
		if w.Code != 400 {
			t.Errorf("unsafe parent %q: %d %s", parent, w.Code, w.Body.String())
		}
	}
	after, _ := json.Marshal(s.Config())
	if !bytes.Equal(before, after) {
		t.Fatal("read-only endpoints mutated settings")
	}
	s.Demo = true
	for _, route := range []string{"/api/unraid/shares", "/api/unraid/share-dirs"} {
		w = request(route, map[string]any{"unraid": draft, "parent": "media"})
		if w.Code != 403 {
			t.Fatalf("demo listing allowed: %d %s", w.Code, w.Body.String())
		}
	}
	if calls != 1 {
		t.Fatal("demo queried Arr")
	}
}

func TestShareResolutionAmbiguousIdentity144(t *testing.T) {
	_, cfg := placementFixture130(t)
	user := filepath.Join(cfg.Unraid.DiskRoot, "user")
	for _, name := range []string{"first", "second"} {
		if err := os.MkdirAll(filepath.Join(user, name), 0755); err != nil {
			t.Fatal(err)
		}
	}
	local := filepath.Join(cfg.Unraid.ShareRoot, "alias")
	metadata := &shareMetadata144{aliases: map[string]string{local: filepath.Join(user, "first"), filepath.Join(user, "second"): filepath.Join(user, "first")}}
	got := resolveShareRoot(context.Background(), cfg, muxRootFolder{ArrPath: "/missing", Mapped: true, LocalPath: local}, metadata)
	if got.Status != "unresolved" || got.ShareDir != "" {
		t.Fatalf("guessed an ambiguous identity: %+v", got)
	}
}

func TestShareResolverAndChooserReadBoundaries144(t *testing.T) {
	_, cfg := placementFixture130(t)
	user := filepath.Join(cfg.Unraid.DiskRoot, "user")
	for _, rel := range []string{"media/docs/deep", "Fotos/private"} {
		if err := os.MkdirAll(filepath.Join(user, rel), 0755); err != nil {
			t.Fatal(err)
		}
	}
	metadata := &shareMetadata144{}
	dirs, err := listShareDirectories(context.Background(), cfg.Unraid, "media", metadata)
	if err != nil || !reflect.DeepEqual(dirs, []string{"media/docs"}) || !reflect.DeepEqual(metadata.reads, []string{filepath.Join(user, "media")}) {
		t.Fatalf("chooser escaped requested level: %v %v %v", dirs, err, metadata.reads)
	}
	metadata.reads = nil
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	got := resolveShareRoot(ctx, cfg, muxRootFolder{ArrPath: "/media"}, metadata)
	if got.Status != "unresolved" || len(metadata.reads) != 0 {
		t.Fatalf("cancelled resolver touched shares: %+v %v", got, metadata.reads)
	}
}

func TestShareRootErrorsRemainVisible144(t *testing.T) {
	s, cfg := placementFixture130(t)
	arr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Error(w, "unavailable", 500) }))
	defer arr.Close()
	cfg.Instances[0].URL = arr.URL
	got := s.resolveShareRoots(context.Background(), cfg, nil, &shareMetadata144{})
	if len(got.Errors) != 1 || got.Errors[0].Instance != "Movies" || len(got.Folders) != 0 || len(got.Directories) != 0 {
		t.Fatalf("lost Arr failure: %+v", got)
	}
}

func TestShareSettingsAuthentication144(t *testing.T) {
	s, _ := placementFixture130(t)
	if _, err := s.Store.DB.Exec("INSERT INTO sessions(token,csrf,expires) VALUES(?,?,?)", tokenHash("shares-session"), "shares-csrf", time.Now().Add(time.Hour).Unix()); err != nil {
		t.Fatal(err)
	}
	for _, route := range []string{"/api/unraid/shares", "/api/unraid/share-dirs"} {
		for _, authenticated := range []bool{false, true} {
			request := httptest.NewRequest("POST", route, strings.NewReader("{}"))
			want := 401
			if authenticated {
				request.AddCookie(&http.Cookie{Name: "scopearr_session", Value: "shares-session"})
				want = 403
			}
			w := httptest.NewRecorder()
			s.Handler().ServeHTTP(w, request)
			if w.Code != want {
				t.Fatalf("%s auth=%v returned %d", route, authenticated, w.Code)
			}
		}
	}
}
