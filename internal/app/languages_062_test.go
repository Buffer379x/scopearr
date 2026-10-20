package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"scopearr/internal/langdata"
	"testing"
)

func TestISOLanguageCodesAndUnknowns(t *testing.T) {
	for _, tc := range []struct{ in, want string }{{"ger/deu/de", "Deutsch"}, {"cze/ces/cs", "Czech"}, {"chi/zho/zh", "Chinese"}, {"tur/tr", "Turkish"}, {"kor/ko", "Korean"}, {"gre/ell/el", "Modern Greek (1453-)"}, {"en-US", "Englisch"}, {"und", ""}, {"zxx", "No linguistic content"}, {"qzz", "qzz"}} {
		if got := normLanguage(tc.in); got != tc.want {
			t.Errorf("%s: got %q want %q", tc.in, got, tc.want)
		}
	}
	if langdata.Canonical("aaa") == "" {
		t.Fatal("full ISO 639-3 lookup missing")
	}
}
func TestSchemaElevenNormalizesExistingAPIAndEmbyLanguages(t *testing.T) {
	s := testStore(t)
	f := sample(1, "Movie.BluRay.mkv")
	EnrichWithRules(&f, APIInfo{AudioLanguages: "cze"}, s.recognition.Load())
	f.Language = "cze"
	f.RecognitionRevision = "old-language-registry"
	second := sample(2, "Movie2.BluRay.mkv")
	EnrichWithRules(&second, APIInfo{}, s.recognition.Load())
	second.Language = "tur"
	second.EmbyMatch = "matched"
	second.AudioTracks = []AudioTrack{{Language: "tur", Codec: "DTS", Channels: 2}}
	second.RecognitionRevision = "old-language-registry"
	if err := s.Replace("radarr", []File{f, second}, SyncStatus{}); err != nil {
		t.Fatal(err)
	}
	// Restore old raw cache values after the current replacement logic normalized them.
	for _, old := range []File{f, second} {
		raw, _ := json.Marshal(old)
		if _, err := s.DB.Exec("UPDATE files SET language=?,data=? WHERE id=?", old.Language, string(raw), old.ID); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.DB.Exec("PRAGMA user_version=10"); err != nil {
		t.Fatal(err)
	}
	dir := s.Dir
	s.DB.Close()
	reopened, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.DB.Close()
	var version int
	reopened.DB.QueryRow("PRAGMA user_version").Scan(&version)
	if version != 16 {
		t.Fatal(version)
	}
	var one, two, raw string
	reopened.DB.QueryRow("SELECT language FROM files WHERE id=1").Scan(&one)
	reopened.DB.QueryRow("SELECT language,data FROM files WHERE id=2").Scan(&two, &raw)
	if one != "Czech" || two != "Turkish" {
		t.Fatal(one, two)
	}
	var saved File
	json.Unmarshal([]byte(raw), &saved)
	if saved.AudioTracks[0].Language != "Turkish" {
		t.Fatal("track language stale", saved.AudioTracks)
	}
	entries, _ := os.ReadDir(filepath.Join(dir, "backups"))
	if len(entries) == 0 {
		t.Fatal("migration needs a consistent backup")
	}
}
