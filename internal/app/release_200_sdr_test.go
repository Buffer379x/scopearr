package app

import (
	"encoding/json"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func sdrVideo200(fields ...map[string]string) mediaInfoResult {
	result := mediaInfoResult{Video: &MediaVideo{Width: 1920, Height: 1080, Resolution: "1080p", Codec: "AVC"}}
	for _, f := range fields {
		result.Tracks = append(result.Tracks, mediaInfoTrack{Type: "Video", Fields: f})
	}
	return result
}

func sdrEngine200(t *testing.T) *RecognitionEngine {
	t.Helper()
	engine, err := CompileRecognition(append(DefaultRecognitionRules(), customRule("user-sdr", "hdr", "SDR", "SDR", "direct", 100)))
	if err != nil {
		t.Fatal(err)
	}
	return engine
}

func TestMeasuredSDR200(t *testing.T) {
	t.Run("mediainfo BT.709 without HDR format is SDR", func(t *testing.T) {
		result := sdrVideo200(map[string]string{"transfer_characteristics": "BT.709"})
		if got := result.videoRange(); got != "SDR" {
			t.Fatalf("videoRange = %q", got)
		}
		f := File{Filename: "Movie.2020.1080p.BluRay.x264.mkv"}
		Enrich(&f, APIInfo{})
		applyMediaInfo(&f, result)
		if f.HDR != "SDR" || f.Evidence["hdr"].MediaInfo != "SDR" {
			t.Fatal(f.HDR, f.Evidence["hdr"])
		}
	})

	t.Run("explicit measurements only", func(t *testing.T) {
		ambiguous := sdrVideo200(map[string]string{"transfer_characteristics": "BT.709"})
		ambiguous.Ambiguous = true
		profile := sdrVideo200(map[string]string{"transfer_characteristics": "BT.709"})
		profile.HDR = "HDR10"
		noVideo := sdrVideo200(map[string]string{"transfer_characteristics": "BT.709"})
		noVideo.Video = nil
		for name, c := range map[string]struct {
			result mediaInfoResult
			want   string
		}{
			"missing field":             {sdrVideo200(map[string]string{"Format": "AVC"}), ""},
			"BT.601":                    {sdrVideo200(map[string]string{"transfer_characteristics": "BT.601"}), ""},
			"SMPTE 170M":                {sdrVideo200(map[string]string{"transfer_characteristics": "SMPTE 170M"}), ""},
			"BT.709 with HDR format":    {sdrVideo200(map[string]string{"transfer_characteristics": "BT.709", "HDR_Format": "SMPTE ST 2086"}), ""},
			"measured profile":          {profile, "HDR10"},
			"ambiguous":                 {ambiguous, ""},
			"two videos, no default":    {sdrVideo200(map[string]string{"transfer_characteristics": "BT.709"}, map[string]string{"transfer_characteristics": "BT.709"}), ""},
			"no video":                  {noVideo, ""},
			"two defaults":              {sdrVideo200(map[string]string{"transfer_characteristics": "BT.709", "Default": "Yes"}, map[string]string{"transfer_characteristics": "BT.709", "Default": "Yes"}), ""},
			"trimmed, case-insensitive": {sdrVideo200(map[string]string{"transfer_characteristics": " bt.709 "}), "SDR"},
		} {
			if got := c.result.videoRange(); got != c.want {
				t.Errorf("%s: videoRange = %q, want %q", name, got, c.want)
			}
		}
		f := File{Filename: "Movie.2020.1080p.BluRay.x264.mkv"}
		EnrichWithRules(&f, APIInfo{VideoDynamicRange: ""}, sdrEngine200(t))
		if f.HDR != "" {
			t.Fatal("an empty Arr dynamic range must not become SDR", f.HDR)
		}
	})

	t.Run("the default video track decides", func(t *testing.T) {
		result := sdrVideo200(map[string]string{"transfer_characteristics": "PQ"}, map[string]string{"transfer_characteristics": "BT.709", "Default": "Yes"})
		if got := result.videoRange(); got != "SDR" {
			t.Fatalf("videoRange = %q", got)
		}
	})

	t.Run("emby reports SDR only as its range type", func(t *testing.T) {
		for name, c := range map[string]struct {
			stream embyStream
			want   []string
		}{
			"range type":         {embyStream{VideoRangeType: "SDR"}, []string{"SDR"}},
			"range type and DV":  {embyStream{VideoRangeType: "SDR", ExtendedVideoType: "DolbyVision"}, []string{"Dolby Vision"}},
			"empty":              {embyStream{}, nil},
			"extended type None": {embyStream{ExtendedVideoType: "None"}, nil},
		} {
			hdr := map[string]bool{}
			addVideoHDR(c.stream, hdr)
			if len(hdr) != len(c.want) {
				t.Errorf("%s: %v, want %v", name, hdr, c.want)
				continue
			}
			for _, v := range c.want {
				if !hdr[v] {
					t.Errorf("%s: %v, want %v", name, hdr, c.want)
				}
			}
		}
	})

	t.Run("SDR never coexists with a profile", func(t *testing.T) {
		for _, c := range []struct {
			in   []string
			want string
		}{
			{[]string{"SDR", "HDR10"}, "HDR10"},
			{[]string{"HDR10", "SDR"}, "HDR10"},
			{[]string{"SDR"}, "SDR"},
			{[]string{"SDR", "SDR"}, "SDR"},
			{[]string{"Dolby Vision + HDR10", ""}, "Dolby Vision + HDR10"},
			{[]string{"SDR + HLG"}, "HLG"},
		} {
			if got := mergeHDR(c.in...); got != c.want {
				t.Errorf("mergeHDR(%q) = %q, want %q", c.in, got, c.want)
			}
		}
		f := File{Filename: "Movie.2160p.HDR10.SDR.mkv"}
		EnrichWithRules(&f, APIInfo{}, sdrEngine200(t))
		if f.HDR != "HDR10" {
			t.Fatal(f.HDR, f.Evidence["hdr"])
		}
	})

	t.Run("measured SDR against a filename profile is a disagreement", func(t *testing.T) {
		f := File{Filename: "Movie.2160p.HDR10.mkv"}
		Enrich(&f, APIInfo{})
		applyMediaInfo(&f, sdrVideo200(map[string]string{"transfer_characteristics": "BT.709"}))
		if f.HDR != "HDR10" || !f.Evidence["hdr"].Conflict || !f.Conflict || f.Evidence["hdr"].MediaInfo != "SDR" {
			t.Fatal("mediainfo", f.HDR, f.Evidence["hdr"], f.Conflict)
		}
		f = File{Filename: "Movie.2160p.HDR10.mkv"}
		Enrich(&f, APIInfo{})
		applyEmbyMetadata(&f, embyMetadata{hdr: "SDR"})
		if f.HDR != "HDR10" || !f.Evidence["hdr"].Conflict || !f.Conflict {
			t.Fatal("media server", f.HDR, f.Evidence["hdr"], f.Conflict)
		}
		f = File{Filename: "Movie.2160p.HDR10.mkv"}
		Enrich(&f, APIInfo{})
		applyEmbyMetadata(&f, embyMetadata{hdr: "Dolby Vision"})
		if f.HDR != "Dolby Vision + HDR10" || f.Evidence["hdr"].Conflict || f.Conflict {
			t.Fatal("profiles stay additive", f.HDR, f.Evidence["hdr"], f.Conflict)
		}
		if equivalentValue("hdr", "SDR", "HDR10", nil, nil) {
			t.Fatal("SDR and HDR10 must not be equivalent")
		}
		if !equivalentValue("hdr", "HDR10", "Dolby Vision", nil, nil) {
			t.Fatal("profiles must remain additive")
		}
		if hdrContradicts("SDR", "SDR") || hdrContradicts("HDR10", "Dolby Vision") || !hdrContradicts(" SDR ", "Dolby Vision + HDR10") || !hdrContradicts("HLG", "SDR") {
			t.Fatal("hdrContradicts")
		}
	})

	t.Run("missing HDR stays unknown and complete", func(t *testing.T) {
		f := File{Filename: "Movie.2020.1080p.BluRay.x264.DTS.German.mkv"}
		Enrich(&f, APIInfo{})
		if f.HDR != "" || f.MetadataIncomplete || f.Evidence["hdr"].Origin != "unknown" {
			t.Fatal(f.HDR, f.MetadataIncomplete, f.Evidence["hdr"], f.UnknownTraits)
		}
	})

	t.Run("existing measurements gain SDR once at start", func(t *testing.T) {
		dir := t.TempDir()
		seedMeasuredStore200(t, dir, "/movies/Movie/Movie.2020.1080p.BluRay.x264.mkv")
		before, _ := filepath.Glob(filepath.Join(dir, "backups", "*.db"))
		s, err := OpenStore(dir)
		if err != nil {
			t.Fatal(err)
		}
		var hdr, raw string
		if err = s.DB.QueryRow("SELECT hdr,data FROM files").Scan(&hdr, &raw); err != nil || hdr != "SDR" {
			t.Fatal("files.hdr", hdr, err)
		}
		var file File
		if err = json.Unmarshal([]byte(raw), &file); err != nil || file.HDR != "SDR" || file.Evidence["hdr"].MediaInfo != "SDR" {
			t.Fatal(file.HDR, file.Evidence["hdr"], err)
		}
		for _, key := range []string{"derivedRefresh:2.0.0", "tagSyncDirty:radarr"} {
			var value bool
			if err = s.Get(key, &value); err != nil || !value {
				t.Fatal(key, value, err)
			}
		}
		after, _ := filepath.Glob(filepath.Join(dir, "backups", "*.db"))
		if len(after) != len(before)+1 {
			t.Fatal("expected one backup", before, after)
		}
		s.DB.Close()
		s, err = OpenStore(dir)
		if err != nil {
			t.Fatal(err)
		}
		defer s.DB.Close()
		again, _ := filepath.Glob(filepath.Join(dir, "backups", "*.db"))
		if len(again) != len(after) {
			t.Fatal("second start repeated the refresh backup", after, again)
		}
	})

	t.Run("the start refresh reads no media files", func(t *testing.T) {
		// A FIFO blocks any open for reading; only DB-cached measurements may be used.
		dir := t.TempDir()
		media := filepath.Join(t.TempDir(), "Movie.2020.1080p.BluRay.x264.mkv")
		if err := exec.Command("mkfifo", media).Run(); err != nil {
			t.Skip("mkfifo unavailable", err)
		}
		seedMeasuredStore200(t, dir, media)
		done := make(chan error, 1)
		var s *Store
		go func() {
			var err error
			s, err = OpenStore(dir)
			done <- err
		}()
		select {
		case err := <-done:
			if err != nil {
				t.Fatal(err)
			}
		case <-time.After(30 * time.Second):
			t.Fatal("the start refresh opened a media file")
		}
		defer s.DB.Close()
		var hdr string
		if err := s.DB.QueryRow("SELECT hdr FROM files").Scan(&hdr); err != nil || hdr != "SDR" {
			t.Fatal(hdr, err)
		}
	})
}

// seedMeasuredStore200 writes the state a 1.7.0 store has after a MediaInfo read
// of a BT.709 file: a saved measurement, a file record without HDR and all
// pre-2.0.0 refresh markers.
func seedMeasuredStore200(t *testing.T, dir, sourcePath string) {
	t.Helper()
	s, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.DB.Close()
	f := File{ID: 1, MediaID: 1, Service: "radarr", Title: "Synthetic SDR", Filename: filepath.Base(sourcePath), SourcePath: sourcePath, Size: 4096}
	Enrich(&f, APIInfo{})
	if err = s.Replace("radarr", []File{f}, SyncStatus{Count: 1}); err != nil {
		t.Fatal(err)
	}
	if err = s.Put("settings", Settings{Instances: []ServiceConfig{{ID: "radarr", Type: "radarr", Enabled: true, TagSync: TagGroups{HDR: true}}}}); err != nil {
		t.Fatal(err)
	}
	measured := MediaInfoResult{mediaInfoResult: sdrVideo200(map[string]string{"transfer_characteristics": "BT.709"}), ScannedAt: 1, Version: "26.10"}
	raw, err := json.Marshal(measured)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.DB.Exec("INSERT INTO mediainfo_results VALUES(?,?,?,?,?,?,?)", "radarr", 1, sourcePath, 4096, 1, "26.10", string(raw)); err != nil {
		t.Fatal(err)
	}
	f.MediaInfo = &measured
	data, err := json.Marshal(f)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.DB.Exec("UPDATE files SET hdr='',data=? WHERE id=1", string(data)); err != nil {
		t.Fatal(err)
	}
	if _, err = s.DB.Exec("DELETE FROM kv WHERE key='derivedRefresh:2.0.0' OR key LIKE 'tagSyncDirty:%'"); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"derivedRefresh:1.5.0", "derivedRefresh:1.5.1"} {
		var value bool
		if err = s.Get(key, &value); err != nil || !value {
			t.Fatal("pre-2.0.0 marker missing", key, err)
		}
	}
}

// Files with legacy Emby evidence but no MediaServers are reparsed by the
// filename branch of reparseFile, which must keep SDR/profile disagreements.
func TestLegacyEmbyReparseKeepsHDRConflict200(t *testing.T) {
	engine := sdrEngine200(t)
	for _, c := range []struct {
		name, filename, emby, want string
		conflict                   bool
	}{
		{"filename profile, emby SDR", "Movie.2160p.HDR10.mkv", "SDR", "HDR10", true},
		{"filename SDR, emby profile", "Movie.1080p.SDR.mkv", "HDR10", "HDR10", true},
		{"profiles stay additive", "Movie.2160p.HDR10.mkv", "Dolby Vision", "HDR10 + Dolby Vision", false},
	} {
		t.Run(c.name, func(t *testing.T) {
			f := File{Filename: c.filename}
			EnrichWithRules(&f, APIInfo{}, engine)
			e := f.Evidence["hdr"]
			e.Emby = c.emby
			f.Evidence["hdr"] = e
			f.RecognitionRevision = ""
			reparseFile(&f, engine)
			if f.MediaServers.count() != 0 || f.HDR != c.want || f.Evidence["hdr"].Emby != c.emby || f.Evidence["hdr"].Conflict != c.conflict || f.Conflict != c.conflict {
				t.Fatal(f.HDR, f.Evidence["hdr"], f.Conflict)
			}
		})
	}
}
