package app

import "testing"

func TestShareFixtureSettingsIsolation151(t *testing.T) {
	s, cfg := shareFixture144(t)
	original := s.Config().Instances[0].URL
	// Lock for the mutation so RED demonstrates aliasing deterministically,
	// independently of whether a background reader happens to run now.
	s.mu.Lock()
	cfg.Instances[0].URL = "http://synthetic.invalid"
	s.mu.Unlock()
	if got := s.Config().Instances[0].URL; got != original {
		t.Fatalf("editing returned fixture settings changed the live server: %q", got)
	}
}
