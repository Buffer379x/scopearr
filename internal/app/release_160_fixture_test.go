package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"scopearr"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// TestUIFixture160 serves synthetic data only; opt in explicitly and stop its
// dedicated container after browser QA. It never opens a user's Appdata.
func TestUIFixture160(t *testing.T) {
	if os.Getenv("SCOPEARR_UI160") != "1" {
		t.Skip("set SCOPEARR_UI160=1 for the synthetic browser fixture")
	}
	base := os.Getenv("SCOPEARR_UI160_ROOT")
	if base == "" {
		base = "/fixture"
	}
	if err := os.MkdirAll(base, 0755); err != nil {
		t.Fatal(err)
	}
	store, err := OpenStore(filepath.Join(base, "appdata"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.DB.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	data, err := os.ReadFile("testdata/mediainfo/avc.json")
	if err != nil {
		data = []byte(`{"media":{"track":[{"@type":"General","Format":"Matroska","FileName":"Synthetic fixture","Duration":"5400"},{"@type":"Video","Format":"AVC","Encoded_Library_Name":"x264","Width":"1920","Height":"1080","BitDepth":"8"},{"@type":"Audio","Format":"AC-3","Channels":"2","ChannelLayout":"L R","Language":"de"},{"@type":"Text","Format":"UTF-8","Language":"en"}]}}`)
	}
	toolBase := filepath.Join(store.Dir, "tools", "mediainfo")
	toolRoot := filepath.Join(toolBase, "fixture")
	arch := "x86_64"
	if runtime.GOARCH == "arm64" {
		arch = "aarch64"
	}
	write := func(path string, body []byte, mode os.FileMode) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, body, mode); err != nil {
			t.Fatal(err)
		}
	}
	write(filepath.Join(toolRoot, "lib", "ld-musl-"+arch+".so.1"), []byte("#!/bin/sh\nshift 2\nexec \"$@\"\n"), 0755)
	write(filepath.Join(toolRoot, "usr", "bin", "mediainfo"), []byte("#!/bin/sh\nif [ \"$1\" = \"--Version\" ]; then echo 'MediaInfo Command line, MediaInfoLib - v26.10'; exit 0; fi\n/bin/cat '"+filepath.Join(toolBase, "fixture.json")+"'\n"), 0755)
	write(filepath.Join(toolBase, "fixture.json"), data, 0644)
	if err := os.Symlink("fixture", filepath.Join(toolBase, "current")); err != nil && !os.IsExist(err) {
		t.Fatal(err)
	}
	state, _ := json.Marshal(ToolStatus{Installed: true, Version: "26.10", Package: "26.10-r0", Channel: "stable", Branch: "v3.22", Arch: arch, Available: "26.10", Upstream: "26.10", SizeBytes: 4200000})
	write(filepath.Join(toolBase, "state.json"), state, 0644)
	static := scopearr.Assets()
	if webRoot := os.Getenv("SCOPEARR_UI160_WEB"); webRoot != "" {
		static = os.DirFS(webRoot)
	}
	server, err := NewServer(ctx, store, static, "1.6.0-fixture")
	if err != nil {
		t.Fatal(err)
	}
	defer server.Sync.Shutdown()
	if !server.Security.Initialized() {
		if err := server.Security.Setup("admin", "Synthetic-160-password!", server.Security.setupToken); err != nil {
			t.Fatal(err)
		}
	}
	cfg := DefaultSettings()
	cfg.Mux.Enabled = true
	cfg.Mux.NotifyMedia = false
	cfg.MediaInfo = MediaInfoSettings{Enabled: true, Channel: "stable"}
	cfg.Unraid.Enabled = true
	cfg.Unraid.DiskRoot = filepath.Join(base, "devices")
	cfg.Unraid.ShareRoot = filepath.Join(base, "share")
	cfg.Unraid.StateDir = filepath.Join(base, "unraid-state")
	uid, gid := 1000, 100
	cfg.Unraid.OwnerUID, cfg.Unraid.OwnerGID = &uid, &gid
	cfg.FileCheck.OwnerUID, cfg.FileCheck.OwnerGID = 1000, 100
	cfg.Unraid.ReserveGB = 0
	cfg.Mux.Mappings = "/movies => " + filepath.Join(cfg.Unraid.ShareRoot, "movies") + "\n/shows => " + filepath.Join(cfg.Unraid.ShareRoot, "shows")
	cfg.FileCheck.IncludeVideo = true
	for _, disk := range []string{"disk1", "disk2", "cache", "user"} {
		if err := os.MkdirAll(filepath.Join(cfg.Unraid.DiskRoot, disk), 0755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.MkdirAll(cfg.Unraid.StateDir, 0755); err != nil {
		t.Fatal(err)
	}
	write(filepath.Join(cfg.Unraid.StateDir, "var.ini"), []byte("mdState=\"STARTED\"\nmdResync=\"0\"\n"), 0644)
	// User-share files model the union without symlinks, keeping path safety real.
	type fixtureFile struct {
		file   File
		disk   string
		api    APIInfo
		video  *MediaVideo
		tracks []AudioTrack
	}
	items := []fixtureFile{
		{file: File{ID: 160, MediaID: 160, Service: "radarr", Title: "Megan 2.0", Filename: "Megan.2.0.2025.1080p.WEB-DL.mkv", SourcePath: "/movies/Megan 2.0/Megan.2.0.2025.1080p.WEB-DL.mkv", Size: 1234, Years: []int{2025}}, disk: "disk1", api: APIInfo{Quality: "WEBDL-1080p", VideoCodec: "AVC", AudioCodec: "AC3", AudioChannels: 6}, video: &MediaVideo{Codec: "AVC", Width: 1920, Height: 1080, BitDepth: "8"}, tracks: []AudioTrack{{Index: 1, Codec: "AC3", Channels: 6, ChannelLayout: "5.1", Language: "Deutsch"}}},
		{file: File{ID: 161, MediaID: 161, Service: "radarr", Title: "Codec evidence", Filename: "Codec.Evidence.2026.1080p.x264.AC3.2.0.mkv", SourcePath: "/movies/Codec evidence/Codec.Evidence.2026.1080p.x264.AC3.2.0.mkv", Size: 2048, Years: []int{2026}}, disk: "disk2", api: APIInfo{Quality: "Bluray-1080p", VideoCodec: "HEVC", AudioCodec: "AC3", AudioChannels: 2}, video: &MediaVideo{Codec: "HEVC", Width: 1920, Height: 1080, BitDepth: "8"}, tracks: []AudioTrack{{Index: 1, Codec: "AC3", Channels: 2, ChannelLayout: "2.0", Language: "Deutsch"}}},
		{file: File{ID: 162, MediaID: 162, Service: "radarr", Title: "Already measured", Filename: "Already.Measured.2024.1080p.x264.AC3.2.0.mkv", SourcePath: "/movies/Already measured/Already.Measured.2024.1080p.x264.AC3.2.0.mkv", Size: 3072, Years: []int{2024}}, disk: "disk1", api: APIInfo{VideoCodec: "AVC", AudioCodec: "AC3", AudioChannels: 2}, video: &MediaVideo{Codec: "AVC", Width: 1920, Height: 1080, BitDepth: "8"}, tracks: []AudioTrack{{Index: 1, Codec: "AC3", Channels: 2, ChannelLayout: "2.0", Language: "Deutsch"}}},
		{file: File{ID: 260, MediaID: 260, Service: "sonarr", Title: "Synthetic series", Filename: "Synthetic.Series.S01E01.1080p.x264.AC3.2.0.mkv", SourcePath: "/shows/Synthetic series/Season 01/Synthetic.Series.S01E01.1080p.x264.AC3.2.0.mkv", Size: 4096, Season: 1, Episodes: []Episode{{ID: 2601, Number: 1, Title: "A measured beginning"}}}, disk: "disk2", api: APIInfo{VideoCodec: "AVC", AudioCodec: "AC3", AudioChannels: 2}, video: &MediaVideo{Codec: "AVC", Width: 1920, Height: 1080, BitDepth: "8"}, tracks: []AudioTrack{{Index: 1, Codec: "AC3", Channels: 2, ChannelLayout: "2.0", Language: "Deutsch"}}},
	}
	byService := map[string][]File{}
	for i := range items {
		f := &items[i].file
		Enrich(f, items[i].api)
		f.setMediaMatch("emby", MediaMatch{Status: "matched", Endpoint: "emby", ServerID: "synthetic-emby", ItemID: strconv.Itoa(f.ID), ItemType: map[bool]string{true: "Episode", false: "Movie"}[f.Service == "sonarr"], Video: items[i].video, Tracks: items[i].tracks})
		resolveMediaServers(f)
		rel := strings.TrimPrefix(f.SourcePath, "/")
		body := make([]byte, int(f.Size))
		copy(body, "synthetic fixture media; no real audiovisual content")
		write(filepath.Join(cfg.Unraid.DiskRoot, items[i].disk, rel), body, 0666)
		write(filepath.Join(cfg.Unraid.ShareRoot, rel), body, 0666)
		write(filepath.Join(cfg.Unraid.DiskRoot, "user", rel), body, 0666)
		byService[f.Service] = append(byService[f.Service], *f)
	}
	write(filepath.Join(cfg.Unraid.DiskRoot, "cache", "movies", "Megan 2.0", "Megan.2.0.2025.1080p.WEB-DL.en.srt"), []byte("1\n00:00:01,000 --> 00:00:02,000\nSynthetic subtitle\n"), 0666)
	write(filepath.Join(cfg.Unraid.ShareRoot, "movies", "Megan 2.0", "Megan.2.0.2025.1080p.WEB-DL.en.srt"), []byte("1\n00:00:01,000 --> 00:00:02,000\nSynthetic subtitle\n"), 0666)
	write(filepath.Join(cfg.Unraid.ShareRoot, "movies", "Megan 2.0", "notes.txt"), []byte("manual owner finding"), 0644)
	write(filepath.Join(cfg.Unraid.DiskRoot, "user", "movies", "Megan 2.0", "Megan.2.0.2025.1080p.WEB-DL.en.srt"), []byte("1\n00:00:01,000 --> 00:00:02,000\nSynthetic subtitle\n"), 0666)
	var fixtureMu sync.Mutex
	// Simulate shfs's union view when Arr notices a physical rename. Only fixture
	// copies change; the application still performs the physical move itself.
	syncUnion := func(service string) {
		for i := range byService[service] {
			f := &byService[service][i]
			rel := strings.TrimPrefix(f.SourcePath, "/")
			folder := filepath.Dir(rel)
			physicalNames := map[string]bool{}
			for _, disk := range []string{"disk1", "disk2", "cache"} {
				entries, _ := os.ReadDir(filepath.Join(cfg.Unraid.DiskRoot, disk, folder))
				for _, entry := range entries {
					if entry.IsDir() {
						continue
					}
					physicalNames[entry.Name()] = true
					path := filepath.Join(cfg.Unraid.DiskRoot, disk, folder, entry.Name())
					body, err := os.ReadFile(path)
					if err != nil {
						continue
					}
					for _, root := range []string{cfg.Unraid.ShareRoot, filepath.Join(cfg.Unraid.DiskRoot, "user")} {
						write(filepath.Join(root, folder, entry.Name()), body, 0666)
					}
					if strings.EqualFold(filepath.Ext(entry.Name()), ".mkv") && int64(len(body)) == f.Size {
						f.Filename = entry.Name()
						f.SourcePath = "/" + filepath.ToSlash(filepath.Join(folder, entry.Name()))
					}
				}
			}
			for _, root := range []string{cfg.Unraid.ShareRoot, filepath.Join(cfg.Unraid.DiskRoot, "user")} {
				entries, _ := os.ReadDir(filepath.Join(root, folder))
				for _, entry := range entries {
					if !entry.IsDir() && !physicalNames[entry.Name()] && entry.Name() != "notes.txt" {
						_ = os.Remove(filepath.Join(root, folder, entry.Name()))
					}
				}
			}
		}
	}
	fakeArr := func(service string) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			fixtureMu.Lock()
			defer fixtureMu.Unlock()
			files := byService[service]
			switch {
			case strings.HasSuffix(r.URL.Path, "/rootfolder"):
				root := "/movies"
				if service == "sonarr" {
					root = "/shows"
				}
				jsonOut(w, 200, []map[string]any{{"id": 1, "path": root}})
			case strings.HasSuffix(r.URL.Path, "/system/status"):
				jsonOut(w, 200, map[string]any{"appName": service, "version": "synthetic-1.6.0"})
			case strings.Contains(r.URL.Path, "/command"):
				if r.Method == "POST" {
					syncUnion(service)
				}
				jsonOut(w, 200, map[string]any{"id": 1, "status": "completed"})
			case strings.HasSuffix(r.URL.Path, "/parse"):
				jsonOut(w, 200, map[string]any{"series": map[string]int{"id": 260}, "episodes": []map[string]int{{"id": 2601}}})
			case strings.HasSuffix(r.URL.Path, "/tag"):
				jsonOut(w, 200, []any{})
			case strings.Contains(r.URL.Path, "/moviefile/") || strings.Contains(r.URL.Path, "/episodefile/"):
				id, _ := strconv.Atoi(filepath.Base(r.URL.Path))
				for _, f := range files {
					if f.ID == id {
						jsonOut(w, 200, map[string]any{"id": f.ID, "movieId": f.MediaID, "seriesId": f.MediaID, "path": f.SourcePath, "relativePath": f.Filename, "size": f.Size})
						return
					}
				}
				http.NotFound(w, r)
			case strings.HasSuffix(r.URL.Path, "/moviefile") || strings.HasSuffix(r.URL.Path, "/episodefile"):
				out := []map[string]any{}
				for _, f := range files {
					out = append(out, map[string]any{"id": f.ID, "movieId": f.MediaID, "seriesId": f.MediaID, "path": f.SourcePath, "relativePath": f.Filename, "size": f.Size})
				}
				jsonOut(w, 200, out)
			case strings.HasSuffix(r.URL.Path, "/episode"):
				jsonOut(w, 200, []map[string]any{{"id": 2601, "seriesId": 260, "episodeFileId": 260, "seasonNumber": 1, "episodeNumber": 1, "title": "A measured beginning", "hasFile": true}})
			case strings.Contains(r.URL.Path, "/movie") || strings.Contains(r.URL.Path, "/series"):
				out := []map[string]any{}
				for _, f := range files {
					out = append(out, map[string]any{"id": f.MediaID, "title": f.Title, "year": 2025, "path": filepath.Dir(f.SourcePath), "hasFile": true, "movieFile": map[string]any{"id": f.ID, "path": f.SourcePath, "relativePath": f.Filename, "size": f.Size}, "tags": []int{}})
				}
				if id, err := strconv.Atoi(filepath.Base(r.URL.Path)); err == nil && len(out) > 0 {
					for _, item := range out {
						if item["id"] == id {
							jsonOut(w, 200, item)
							return
						}
					}
					http.NotFound(w, r)
				} else {
					jsonOut(w, 200, out)
				}
			default:
				jsonOut(w, 200, map[string]any{})
			}
		}))
	}
	radarr, sonarr := fakeArr("radarr"), fakeArr("sonarr")
	defer radarr.Close()
	defer sonarr.Close()
	emby := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "System/Info") {
			jsonOut(w, 200, map[string]any{"ServerName": "Synthetic Emby", "Id": "synthetic-emby", "Version": "4.9.0"})
			return
		}
		jsonOut(w, 200, map[string]any{"Items": []any{}, "TotalRecordCount": 0})
	}))
	defer emby.Close()
	cfg.Instances = []ServiceConfig{{ID: "radarr", Type: "radarr", Name: "Movies", Enabled: true, URL: radarr.URL, APIKey: "synthetic-radarr"}, {ID: "sonarr", Type: "sonarr", Name: "Series", Enabled: true, URL: sonarr.URL, APIKey: "synthetic-sonarr"}, {ID: "emby", Type: "emby", Name: "Emby", Enabled: true, URL: emby.URL, APIKey: "synthetic-emby", SourceIDs: "radarr,sonarr"}}
	if err := normalizeSettings(&cfg); err != nil {
		t.Fatal(err)
	}
	if err := normalizeMux(&cfg); err != nil {
		t.Fatal(err)
	}
	if err := normalizeUnraid(&cfg); err != nil {
		t.Fatal(err)
	}
	if err := normalizeFileCheck(&cfg); err != nil {
		t.Fatal(err)
	}
	server.mu.Lock()
	server.settings = cfg
	server.mu.Unlock()
	oldMount := unraidIsMount
	unraidIsMount = func(_, child string) bool { return filepath.Base(child) != "user" }
	defer func() { unraidIsMount = oldMount }()
	now := time.Now().UTC()
	for service, files := range byService {
		if err := store.Replace(service, files, SyncStatus{LastSuccess: &now}); err != nil {
			t.Fatal(err)
		}
	}
	measured, err := parseMediaInfo(data)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []FileKey{{Service: "radarr", ID: 162}, {Service: "sonarr", ID: 260}} {
		f, err := store.muxFile(key.Service, key.ID)
		if err != nil {
			t.Fatal(err)
		}
		if err := store.saveMediaInfo(ctx, f, MediaInfoResult{mediaInfoResult: measured, ScannedAt: time.Now().UnixMilli(), Version: "26.10"}, false); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"Watch later", "Family", "Needs review"} {
		if _, err := store.SaveCustomTag(ctx, CustomTag{Name: name}); err != nil {
			t.Fatal(err)
		}
	}
	// Run the real delayed refresh worker for rename/rescan browser checks.
	server.Webhooks.Start(ctx)
	server.FileCheck.runScan(ctx, cfg)
	server.Placement.runScan(ctx, cfg)
	fmt.Printf("UI160_READY http://localhost:18160 admin / Synthetic-160-password! root=%s\n", base)
	if err := http.ListenAndServe(":18160", server.Handler()); err != nil {
		t.Fatal(err)
	}
}
