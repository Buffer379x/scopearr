package app

import (
	"encoding/json"
	"net/url"
	"path/filepath"
	"reflect"
	"testing"
)

func TestMultipleAudioAndHDR(t *testing.T) {
	cases := []struct{ filename, audio, hdr string }{
		{"Film.DTS.AC3.German.English.DV.HDR10.mkv", "AC-3 + DTS", "Dolby Vision + HDR10"},
		{"Film.DTS-HD.MA.E-AC-3.mkv", "DTS-HD MA + E-AC-3", ""},
		{"Film.DTS-HD.DTS-HD.mkv", "DTS-HD", ""},
		{"Film.TrueHD.AC3.TrueHD.mkv", "TrueHD + AC-3", ""},
		{"Film.DV.HDR10+.HDR10.HLG.mkv", "", "Dolby Vision + HDR10+ + HDR10 + HLG"},
		{"Film.DV.mkv", "", "Dolby Vision"},
		{"Film.HDR10+.mkv", "", "HDR10+"},
		{"Film.NotDTS.AACache.HDR101.mkv", "", ""},
	}
	for _, c := range cases {
		f := File{Filename: c.filename}
		Enrich(&f, APIInfo{})
		if f.Audio != c.audio || f.HDR != c.hdr {
			t.Fatalf("%s: audio=%q hdr=%q", c.filename, f.Audio, f.HDR)
		}
	}
	f := File{Filename: "Film.DTS.AC3.mkv"}
	Enrich(&f, APIInfo{AudioCodec: "DTS", AudioLanguages: "ger / eng / deu", AudioStreamCount: 2})
	if f.Evidence["audio"].Conflict || f.AudioStreamCount != 2 || f.Language != "Deutsch, Englisch" {
		t.Fatal(f)
	}
	Enrich(&f, APIInfo{AudioCodec: "AAC"})
	if !f.Evidence["audio"].Conflict {
		t.Fatal("different API codec was not flagged")
	}
	f = File{Filename: "Film.mkv"}
	Enrich(&f, APIInfo{AudioCodec: "DTS / AC3 / DTS", VideoDynamicRangeType: "DV HDR10"})
	if f.Audio != "AC-3 + DTS" || f.HDR != "Dolby Vision + HDR10" {
		t.Fatal(f)
	}
	f = File{Filename: "Film.DV.mkv"}
	Enrich(&f, APIInfo{VideoDynamicRangeType: "DV HDR10"})
	if f.HDR != "Dolby Vision + HDR10" || f.Evidence["hdr"].Conflict || f.Evidence["hdr"].Origin != "combined" {
		t.Fatal("API HDR profile was hidden", f)
	}
}

func TestCompoundOperators(t *testing.T) {
	for _, field := range []string{"hdr", "audio", "language"} {
		t.Run(field, func(t *testing.T) {
			store := testStore(t)
			values := []string{"HDR10", "Dolby Vision"}
			separator := " + "
			if field == "audio" {
				values = []string{"DTS", "AC-3"}
			}
			if field == "language" {
				values = []string{"Deutsch", "Englisch"}
				separator = ", "
			}
			files := []File{sample(1, "A.mkv"), sample(2, "B.mkv"), sample(3, "C.mkv"), sample(4, "D.mkv")}
			for i, v := range []string{values[0] + separator + values[1], values[0], values[1], ""} {
				switch field {
				case "hdr":
					files[i].HDR = v
				case "audio":
					files[i].Audio = v
				case "language":
					files[i].Language = v
				}
				files[i].Series = "Series"
				files[i].Season = 1
			}
			for _, service := range []string{"radarr", "sonarr"} {
				if err := store.Replace(service, files, SyncStatus{}); err != nil {
					t.Fatal(err)
				}
				for _, c := range []struct {
					op  string
					ids []int
				}{{"eq", []int{1, 2, 3}}, {"all", []int{1}}, {"not", []int{4}}, {"notAll", []int{2, 3, 4}}} {
					q := url.Values{"service": {service}, field: values, field + "Op": {c.op}}
					for _, all := range []bool{false, true} {
						result, err := store.Query(q, "season", all)
						if err != nil {
							t.Fatal(err)
						}
						ids := []int{}
						for _, f := range result.Files {
							if f.Matched {
								ids = append(ids, f.ID)
							}
						}
						if !reflect.DeepEqual(ids, c.ids) {
							t.Fatalf("%s %s %v got %v", service, c.op, all, ids)
						}
						if all && len(result.Files) != len(c.ids) {
							t.Fatal("export includes context")
						}
					}
					q.Del(field)
					r, err := store.Query(q, "matches", false)
					if err != nil || r.Total != 4 {
						t.Fatal("empty selection", err, r.Total)
					}
				}
				facets, err := store.Facets(service)
				if err != nil || len(facets[field]) != 3 {
					t.Fatal("individual facets", facets, err)
				}
				q := url.Values{"service": {service}, field: {values[0], "__unknown__"}, field + "Op": {"all"}}
				r, err := store.Query(q, "matches", false)
				if err != nil || r.Total != 0 {
					t.Fatal("unknown AND known", r, err)
				}
				q.Set(field+"Op", "notAll")
				r, err = store.Query(q, "matches", false)
				if err != nil || r.Total != 4 {
					t.Fatal("NOT(unknown AND known)", r, err)
				}
			}
		})
	}
	for _, field := range []string{"source", "codec", "resolution"} {
		if _, _, err := where(url.Values{"service": {"radarr"}, field + "Op": {"all"}}); err == nil {
			t.Fatal("scalar all accepted")
		}
	}
}

func TestTraitMigrationPreservesCacheAndSettings(t *testing.T) {
	dir := t.TempDir()
	store, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	f := sample(1, "Film.DTS.AC3.German.English.DV.HDR10.mkv")
	// Simulate the old single-codec cache, with untouched API evidence.
	f.Audio = "AC-3"
	f.Language = "German, English"
	f.Evidence["audio"] = Evidence{Filename: "AC-3", API: "DTS", Origin: "filename", Conflict: true}
	f.Conflict = true
	if err = store.Replace("radarr", []File{f}, SyncStatus{Count: 1}); err != nil {
		t.Fatal(err)
	}
	cfg := DefaultSettings()
	cfg.TagColors = map[string]string{"audio:DTS": "#123456"}
	if err = store.Put("settings", cfg); err != nil {
		t.Fatal(err)
	}
	if _, err = store.DB.Exec("INSERT INTO presets(name,service,query) VALUES('kept','radarr','audio=DTS'); PRAGMA user_version=2"); err != nil {
		t.Fatal(err)
	}
	store.DB.Close()
	store, err = OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer store.DB.Close()
	result, err := store.Query(url.Values{"service": {"radarr"}, "audio": {"DTS", "AC-3"}, "audioOp": {"all"}}, "matches", false)
	if err != nil || result.Total != 1 || result.Files[0].Conflict {
		t.Fatal(result, err)
	}
	var after Settings
	if err = store.Get("settings", &after); err != nil || !reflect.DeepEqual(after, settingsForStorage(cfg)) {
		t.Fatal("settings changed", after, err)
	}
	presets, err := store.Presets()
	if err != nil || len(presets) != 1 {
		t.Fatal("presets changed", err)
	}
	backups, _ := filepath.Glob(filepath.Join(dir, "backups", "*.db"))
	if len(backups) != 1 {
		t.Fatal("migration backup missing")
	}
	var raw string
	store.DB.QueryRow("SELECT data FROM files").Scan(&raw)
	var saved File
	json.Unmarshal([]byte(raw), &saved)
	if saved.Audio != result.Files[0].Audio || saved.Evidence["audio"].API != "DTS" {
		t.Fatal("JSON / indexed columns mismatch")
	}
}
