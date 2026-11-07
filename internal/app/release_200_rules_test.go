package app

import (
	"context"
	"fmt"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

// defaultRuleCount170 is len(DefaultRecognitionRules()) in v1.7.0, measured with
// `git show v1.7.0:internal/app/recognition.go` and a scratch program. The demo
// shows one more rule ("Demo UHD source").
const defaultRuleCount170 = 61

func rules170() []RecognitionRule {
	return append([]RecognitionRule{}, DefaultRecognitionRules()[:defaultRuleCount170]...)
}

func ruleIDs200(rules []RecognitionRule) map[string]bool {
	ids := map[string]bool{}
	for _, r := range rules {
		ids[r.ID] = true
	}
	return ids
}

func fillerRules200(count int) []RecognitionRule {
	rules := []RecognitionRule{}
	for i := range count {
		rules = append(rules, customRule(fmt.Sprintf("filler-%d", i), "codec", fmt.Sprintf("filler%d", i), fmt.Sprintf("F%d", i), "direct", 100))
	}
	return rules
}

// seedRules170 leaves the state of a 1.7.0 store: the given saved rules, one
// cached file parsed with them, active HDR tag sync and only the pre-2.0.0
// markers.
func seedRules170(t *testing.T, dir string, rules []RecognitionRule, sourcePath ...string) {
	t.Helper()
	s, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.DB.Close()
	engine, err := CompileRecognition(rules)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Put("recognition", engine.Config()); err != nil {
		t.Fatal(err)
	}
	s.recognition.Store(engine)
	f := File{ID: 1, MediaID: 1, Service: "radarr", Title: "Synthetic SDR", Filename: "X.2020.SDR.6.1.mkv", Size: 4096}
	if len(sourcePath) > 0 {
		f.SourcePath = sourcePath[0]
	}
	EnrichWithRules(&f, APIInfo{}, engine)
	if err = s.Replace("radarr", []File{f}, SyncStatus{Count: 1}); err != nil {
		t.Fatal(err)
	}
	var hdr, channels string
	if err = s.DB.QueryRow("SELECT hdr,channels FROM files").Scan(&hdr, &channels); err != nil || hdr != "" || channels != "" {
		t.Fatal("1.7.0 rules must not recognize SDR or 6.1", hdr, channels, err)
	}
	if err = s.Put("settings", Settings{Instances: []ServiceConfig{{ID: "radarr", Type: "radarr", Enabled: true, TagSync: TagGroups{HDR: true}}}}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.DB.Exec("DELETE FROM kv WHERE key IN ('recognitionDefaults:2.0.0','derivedRefresh:2.0.0') OR key LIKE 'tagSyncDirty:%'"); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"derivedRefresh:1.5.0", "derivedRefresh:1.5.1"} {
		var value bool
		if err = s.Get(key, &value); err != nil || !value {
			t.Fatal("pre-2.0.0 marker missing", key, err)
		}
	}
}

func backups200(t *testing.T, dir string) []string {
	t.Helper()
	files, err := filepath.Glob(filepath.Join(dir, "backups", "*.db"))
	if err != nil {
		t.Fatal(err)
	}
	return files
}

func TestDefaultRules200(t *testing.T) {
	t.Run("new installations get the rules after the 1.7.0 defaults", func(t *testing.T) {
		rules := DefaultRecognitionRules()
		if len(rules) != defaultRuleCount170+3 {
			t.Fatalf("len = %d, want %d", len(rules), defaultRuleCount170+3)
		}
		if rules[len(rules)-4].ID != "default-source-uhd-bluray" {
			t.Fatal("fourth from last", rules[len(rules)-4].ID)
		}
		want := []RecognitionRule{
			{ID: "default-hdr-sdr", Name: "HDR / SDR", Field: "hdr", Match: "regex", Pattern: token(`sdr`).String(), Value: "SDR", Mode: "direct", Priority: 100, Enabled: true},
			{ID: "default-channels-1-0", Name: "Channels / 1.0", Field: "channels", Match: "regex", Pattern: token(`1\.0`).String(), Value: "1.0", Mode: "direct", Priority: 100, Enabled: true},
			{ID: "default-channels-6-1", Name: "Channels / 6.1", Field: "channels", Match: "regex", Pattern: token(`6\.1`).String(), Value: "6.1", Mode: "direct", Priority: 100, Enabled: true},
		}
		if got := rules[len(rules)-3:]; !reflect.DeepEqual(got, want) {
			t.Fatalf("last rules\n got %+v\nwant %+v", got, want)
		}
		for _, r := range want {
			if !ruleIsTag(r) {
				t.Fatal("default rules are tags", r.ID)
			}
		}
		if _, changed := upgradeDefaultRules(DefaultRecognitionRules()); changed {
			t.Fatal("upgradeDefaultRules must leave the current defaults unchanged")
		}
	})

	t.Run("recognizes SDR, 1.0 and 6.1", func(t *testing.T) {
		if _, err := CompileRecognition(defaultRules200()); err != nil {
			t.Fatal(err)
		}
		for _, c := range []struct{ filename, hdr, channels string }{
			{"Movie.2020.1080p.BluRay.SDR.DTS.6.1.x264.mkv", "SDR", "6.1"},
			{"Old.Movie.1950.DVDRip.AC3.1.0.mkv", "", "1.0"},
			{"Movie.Version.1.05.mkv", "", ""},
		} {
			values := defaultRecognitionEngine.Recognize(c.filename).Values
			if values["hdr"] != c.hdr || values["channels"] != c.channels {
				t.Errorf("%s: hdr %q channels %q, want %q %q", c.filename, values["hdr"], values["channels"], c.hdr, c.channels)
			}
		}
	})

	t.Run("track layouts keep the 1.7.0 channel names", func(t *testing.T) {
		for _, c := range []struct {
			track AudioTrack
			want  string
		}{
			{AudioTrack{ChannelLayout: "mono"}, "1.0"},
			{AudioTrack{ChannelLayout: "stereo"}, "2.0"},
			{AudioTrack{ChannelLayout: "6.1"}, "6.1"},
			{AudioTrack{Channels: 6}, "6 ch"},
		} {
			if got := mediaChannelLayout(c.track); got != c.want {
				t.Errorf("%+v: %q, want %q", c.track, got, c.want)
			}
		}
	})

	t.Run("addition is pure and skips present or equivalent rules", func(t *testing.T) {
		input := rules170()
		next, added, skipped := addDefaultRules200(input)
		if len(input) != defaultRuleCount170 || len(added) != 3 || len(skipped) != 0 || !reflect.DeepEqual(next, DefaultRecognitionRules()) {
			t.Fatal(len(input), len(added), len(skipped), len(next))
		}
		if next, added, skipped = addDefaultRules200(DefaultRecognitionRules()); len(added) != 0 || len(skipped) != 0 || !reflect.DeepEqual(next, DefaultRecognitionRules()) {
			t.Fatal("present IDs must not be added again", added, skipped)
		}
		edited := DefaultRecognitionRules()
		edited[len(edited)-3].Pattern, edited[len(edited)-3].Value = "standard[ ._-]dynamic[ ._-]range", "Standard"
		if _, added, _ = addDefaultRules200(edited); len(added) != 0 {
			t.Fatal("an edited default keeps its ID and is not added again", added)
		}
		renamed := rules170()
		renamed = append(renamed, RecognitionRule{ID: "my-61", Name: "Six one", Field: "channels", Match: "regex", Pattern: `(?:^|[ .])6[ .]1(?:$|[ .])`, Value: "6.1", Mode: "fallback", Priority: 7, Enabled: false})
		renamed = append(renamed, RecognitionRule{ID: "my-mono", Name: "Mono", Field: "channels", Match: "token", Pattern: "mono", Value: "1.0", Mode: "direct", Priority: 100, Enabled: true})
		_, added, _ = addDefaultRules200(renamed)
		if len(added) != 2 || added[0].ID != "default-hdr-sdr" || added[1].ID != "default-channels-1-0" {
			t.Fatal("only rules that recognize the probe count as equivalent", added)
		}
	})

	t.Run("upgrade adds missing defaults once", func(t *testing.T) {
		dir := t.TempDir()
		seedRules170(t, dir, rules170())
		before := backups200(t, dir)
		s, err := OpenStore(dir)
		if err != nil {
			t.Fatal(err)
		}
		defer s.DB.Close()
		ids := ruleIDs200(s.Recognition().Rules)
		for _, id := range []string{"default-hdr-sdr", "default-channels-1-0", "default-channels-6-1"} {
			if !ids[id] {
				t.Fatal("missing", id)
			}
		}
		if !reflect.DeepEqual(s.Recognition().Rules, compileConfig200(t, DefaultRecognitionRules()).Rules) {
			t.Fatal("the upgraded rules must equal the 2.0.0 defaults")
		}
		var hdr, channels string
		if err = s.DB.QueryRow("SELECT hdr,channels FROM files").Scan(&hdr, &channels); err != nil || hdr != "SDR" || channels != "6.1" {
			t.Fatal(hdr, channels, err)
		}
		for _, key := range []string{"recognitionDefaults:2.0.0", "derivedRefresh:2.0.0", "tagSyncDirty:radarr"} {
			var value bool
			if err = s.Get(key, &value); err != nil || !value {
				t.Fatal(key, value, err)
			}
		}
		if after := backups200(t, dir); len(after) != len(before)+1 {
			t.Fatal("expected exactly one backup", before, after)
		}
	})

	t.Run("the rule addition reads no media files", func(t *testing.T) {
		// A FIFO blocks any open for reading; only the cached database may be used.
		dir := t.TempDir()
		media := filepath.Join(t.TempDir(), "X.2020.SDR.6.1.mkv")
		if err := exec.Command("mkfifo", media).Run(); err != nil {
			t.Skip("mkfifo unavailable", err)
		}
		seedRules170(t, dir, rules170(), media)
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
			t.Fatal("the rule addition opened a media file")
		}
		defer s.DB.Close()
		var hdr string
		if err := s.DB.QueryRow("SELECT hdr FROM files").Scan(&hdr); err != nil || hdr != "SDR" {
			t.Fatal(hdr, err)
		}
	})

	t.Run("deleted defaults stay deleted", func(t *testing.T) {
		dir := t.TempDir()
		seedRules170(t, dir, rules170())
		s, err := OpenStore(dir)
		if err != nil {
			t.Fatal(err)
		}
		config := s.Recognition()
		kept := []RecognitionRule{}
		for _, r := range config.Rules {
			if r.ID != "default-hdr-sdr" {
				kept = append(kept, r)
			}
		}
		if _, err = s.SaveRecognition(context.Background(), kept, config.Revision); err != nil {
			t.Fatal(err)
		}
		s.DB.Close()
		before := backups200(t, dir)
		s, err = OpenStore(dir)
		if err != nil {
			t.Fatal(err)
		}
		defer s.DB.Close()
		if ruleIDs200(s.Recognition().Rules)["default-hdr-sdr"] {
			t.Fatal("a deleted default came back")
		}
		if after := backups200(t, dir); len(after) != len(before) {
			t.Fatal("a later start must not back up again", before, after)
		}
	})

	t.Run("equivalent user rules are kept", func(t *testing.T) {
		dir := t.TempDir()
		user := RecognitionRule{ID: "user-sdr", Name: "My SDR", Field: "hdr", Match: "token", Pattern: "SDR", Value: "sdr", Mode: "direct", Priority: 100, Enabled: false}
		seedRules170(t, dir, append(rules170(), user))
		s, err := OpenStore(dir)
		if err != nil {
			t.Fatal(err)
		}
		defer s.DB.Close()
		rules := s.Recognition().Rules
		ids := ruleIDs200(rules)
		if ids["default-hdr-sdr"] || !ids["user-sdr"] || !ids["default-channels-1-0"] || !ids["default-channels-6-1"] {
			t.Fatal(ids)
		}
		for _, r := range rules {
			if r.ID == "user-sdr" && r != user {
				t.Fatal("the user rule changed", r)
			}
		}
	})

	t.Run("the 256 limit skips with a warning", func(t *testing.T) {
		dir := t.TempDir()
		seedRules170(t, dir, append(rules170(), fillerRules200(255-defaultRuleCount170)...))
		s, err := OpenStore(dir)
		if err != nil {
			t.Fatal(err)
		}
		defer s.DB.Close()
		rules := s.Recognition().Rules
		ids := ruleIDs200(rules)
		if len(rules) != 256 || !ids["default-hdr-sdr"] || ids["default-channels-1-0"] || ids["default-channels-6-1"] {
			t.Fatal(len(rules), ids["default-hdr-sdr"], ids["default-channels-1-0"], ids["default-channels-6-1"])
		}
		var marker bool
		if err = s.Get("recognitionDefaults:2.0.0", &marker); err != nil || !marker {
			t.Fatal(marker, err)
		}
		s.Events.Flush()
		names := []string{}
		rows, err := s.DB.Query("SELECT json_extract(params,'$.name') FROM event_log WHERE level='warning' AND message='Default rule {name} was not added: at most 256 recognition rules are allowed' ORDER BY id")
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		for rows.Next() {
			var name string
			if err = rows.Scan(&name); err != nil {
				t.Fatal(err)
			}
			names = append(names, name)
		}
		if !reflect.DeepEqual(names, []string{"Channels / 1.0", "Channels / 6.1"}) {
			t.Fatal(names)
		}
	})

	t.Run("limit warnings follow a successful write only", func(t *testing.T) {
		const warning = "Default rule {name} was not added: at most 256 recognition rules are allowed"
		warnings := func(s *Store) int {
			t.Helper()
			s.Events.Flush()
			var count int
			if err := s.DB.QueryRow("SELECT coalesce(sum(repeat),0) FROM event_log WHERE message=?", warning).Scan(&count); err != nil {
				t.Fatal(err)
			}
			return count
		}
		for _, c := range []struct {
			name  string
			rules []RecognitionRule
			want  int
		}{
			{"rules added", append(rules170(), fillerRules200(255-defaultRuleCount170)...), 2},
			{"marker only", append(rules170(), fillerRules200(256-defaultRuleCount170)...), 3},
		} {
			t.Run(c.name, func(t *testing.T) {
				s := testStore(t)
				engine, err := CompileRecognition(c.rules)
				if err != nil {
					t.Fatal(err)
				}
				s.recognition.Store(engine)
				if _, err = s.DB.Exec("DELETE FROM kv WHERE key=?", recognitionDefaultsMarker); err != nil {
					t.Fatal(err)
				}
				if _, err = s.DB.Exec("CREATE TRIGGER block_defaults_marker BEFORE INSERT ON kv WHEN NEW.key='recognitionDefaults:2.0.0' BEGIN SELECT RAISE(ABORT,'blocked'); END"); err != nil {
					t.Fatal(err)
				}
				before := warnings(s)
				if err = s.ensureDefaultRules200(context.Background()); err == nil {
					t.Fatal("the blocked marker write must fail")
				}
				if got := warnings(s); got != before {
					t.Fatal("a failed write must not log limit warnings; the next start repeats them", got-before)
				}
				if _, err = s.DB.Exec("DROP TRIGGER block_defaults_marker"); err != nil {
					t.Fatal(err)
				}
				if err = s.ensureDefaultRules200(context.Background()); err != nil {
					t.Fatal(err)
				}
				if got := warnings(s); got-before != c.want {
					t.Fatal("warnings after the successful write", got-before, c.want)
				}
			})
		}
	})

	t.Run("fresh stores need no second write", func(t *testing.T) {
		dir := t.TempDir()
		s, err := OpenStore(dir)
		if err != nil {
			t.Fatal(err)
		}
		defer s.DB.Close()
		var marker bool
		if err = s.Get("recognitionDefaults:2.0.0", &marker); err != nil || !marker {
			t.Fatal(marker, err)
		}
		if !reflect.DeepEqual(s.Recognition(), compileConfig200(t, DefaultRecognitionRules())) {
			t.Fatal("a fresh store keeps the default configuration")
		}
		if files := backups200(t, dir); len(files) != 0 {
			t.Fatal("a fresh store needs no backup", files)
		}
	})
}

func compileConfig200(t *testing.T, rules []RecognitionRule) RecognitionConfig {
	t.Helper()
	engine, err := CompileRecognition(rules)
	if err != nil {
		t.Fatal(err)
	}
	return engine.Config()
}
