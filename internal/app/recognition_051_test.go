package app

import (
	"context"
	"encoding/json"
	"testing"
)

func TestDTSComparisonToleranceIsRuleControlled(t *testing.T) {
	for _, name := range []string{"DTS", "DTS-HD", "DTS-HD-MA"} {
		for _, metadata := range []string{"DTS", "DTS-HD", "DTS-HD MA"} {
			f := File{Filename: "Movie." + name + ".mkv"}
			api := APIInfo{AudioCodec: metadata}
			EnrichWithRules(&f, api, defaultRecognitionEngine)
			if f.Evidence["audio"].Conflict {
				t.Fatal(name, metadata, f.Evidence["audio"])
			}
			applyEmby(&f, []embyStream{{Type: "Audio", Index: 1, Codec: metadata, Language: "eng"}})
			if f.Evidence["audio"].Conflict {
				t.Fatal("Emby", name, metadata)
			}
		}
	}
	rules := DefaultRecognitionRules()
	for i := range rules {
		rules[i].ComparisonPattern = ""
	}
	strict, err := CompileRecognition(rules)
	if err != nil {
		t.Fatal(err)
	}
	f := File{Filename: "Movie.DTS-HD.mkv"}
	EnrichWithRules(&f, APIInfo{AudioCodec: "DTS-HD MA"}, strict)
	applyEmby(&f, []embyStream{{Type: "Audio", Index: 1, Codec: "DTS-HD MA"}})
	if !f.Evidence["audio"].Conflict || f.Audio != "DTS-HD MA" {
		t.Fatal(f.Audio, f.Evidence["audio"])
	}
	EnrichWithRules(&f, APIInfo{AudioCodec: "AC3"}, defaultRecognitionEngine)
	if !f.Evidence["audio"].Conflict {
		t.Fatal("unrelated codec tolerated")
	}
}
func TestSubbedLanguageExcludedByDefaultRules(t *testing.T) {
	for _, name := range []string{"Movie.German.Subbed.mkv", "Movie.German-SUBS.mkv", "Movie.Subbed.German.mkv", "Movie.English.HardSubbed.mkv", "Movie.Japanese.SoftSubbed.mkv"} {
		if got := defaultRecognitionEngine.Recognize(name).Values["language"]; got != "" {
			t.Fatal(name, got)
		}
	}
	if got := defaultRecognitionEngine.Recognize("Movie.German.DTS.English.Subbed.mkv").Values["language"]; got != "Deutsch" {
		t.Fatal(got)
	}
	f := File{Filename: "Movie.German.Subbed.mkv"}
	EnrichWithRules(&f, APIInfo{AudioLanguages: "English"}, defaultRecognitionEngine)
	if f.Evidence["language"].Conflict || f.Language != "Englisch" {
		t.Fatal(f.Language, f.Evidence)
	}
}
func TestSchemaSevenUpgradesOnlyUntouchedRecognitionDefaults(t *testing.T) {
	s := testStore(t)
	rules := DefaultRecognitionRules()
	var edited string
	for i := range rules {
		rules[i].ComparisonPattern = ""
		if rules[i].Field == "language" {
			rules[i].Unless = ""
		}
		if rules[i].Value == "DTS-HD" {
			rules[i].Name = "My strict DTS-HD"
			edited = rules[i].ID
		}
	}
	if _, err := s.SaveRecognition(context.Background(), rules, s.Recognition().Revision); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(RecognitionConfig{Rules: rules})
	s.DB.Exec("UPDATE kv SET value=? WHERE key='recognition'", string(raw))
	s.DB.Exec("PRAGMA user_version=6")
	dir := s.Dir
	s.DB.Close()
	fresh, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer fresh.DB.Close()
	var version int
	fresh.DB.QueryRow("PRAGMA user_version").Scan(&version)
	if version != 16 {
		t.Fatal(version)
	}
	for _, rule := range fresh.Recognition().Rules {
		if rule.ID == edited && rule.ComparisonPattern != "" {
			t.Fatal("customized rule overwritten")
		}
		if rule.Value == "DTS" && rule.ComparisonPattern == "" {
			t.Fatal("default not upgraded")
		}
		if rule.Field == "language" && rule.Unless == "" {
			t.Fatal("subtitle exclusion not upgraded")
		}
	}
}
