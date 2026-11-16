package app

import (
	"context"
	"testing"
)

// D30 R8: German release names append a D to the codec of a German dubbed
// track (AC3D, DTSD).
func TestDubbedAudioDefaults(t *testing.T) {
	t.Run("recognizes DTSD and AC3D as codec and German", func(t *testing.T) {
		for _, c := range []struct{ filename, audio, language string }{
			{"Movie.2020.German.DTSD.DL.1080p.BluRay.x264.mkv", "DTS", "Deutsch"},
			{"Movie.2020.DTSD.1080p.mkv", "DTS", "Deutsch"},
			{"Movie.2020.German.AC3D.DL.720p.mkv", "AC-3", "Deutsch"},
			{"Movie.2020.DTS.1080p.mkv", "DTS", ""},
			{"Movie.2020.DTS-HD.MA.1080p.mkv", "DTS-HD MA", ""},
		} {
			values := defaultRecognitionEngine.Recognize(c.filename).Values
			if values["audio"] != c.audio || values["language"] != c.language {
				t.Errorf("%s: audio %q language %q, want %q %q", c.filename, values["audio"], values["language"], c.audio, c.language)
			}
		}
	})

	t.Run("a store that took the first 2.0.0 defaults gets them once", func(t *testing.T) {
		s := testStore(t)
		before := append(rules170(), defaultRules200()...)
		engine, err := CompileRecognition(before)
		if err != nil {
			t.Fatal(err)
		}
		s.recognition.Store(engine)
		if _, err = s.DB.Exec("DELETE FROM kv WHERE key=?", recognitionDubbedMarker); err != nil {
			t.Fatal(err)
		}
		if err = s.ensureDefaultRules200(context.Background()); err != nil {
			t.Fatal(err)
		}
		ids := ruleIDs200(s.Recognition().Rules)
		for _, rule := range defaultRulesDubbed() {
			if !ids[rule.ID] {
				t.Fatal("missing", rule.ID)
			}
		}
		if len(s.Recognition().Rules) != len(before)+len(defaultRulesDubbed()) {
			t.Fatal(len(s.Recognition().Rules))
		}
		var marker bool
		if err = s.Get(recognitionDubbedMarker, &marker); err != nil || !marker {
			t.Fatal(marker, err)
		}
		// A deleted default does not return.
		kept := s.Recognition().Rules[:len(before)]
		if engine, err = CompileRecognition(kept); err != nil {
			t.Fatal(err)
		}
		s.recognition.Store(engine)
		if err = s.ensureDefaultRules200(context.Background()); err != nil {
			t.Fatal(err)
		}
		if len(s.Recognition().Rules) != len(before) {
			t.Fatal("a deleted default came back", len(s.Recognition().Rules))
		}
	})
}
