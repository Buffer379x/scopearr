package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"regexp"
	"strings"
)

// recognitionDefaultsMarker records that the 2.0.0 defaults were offered once.
// Without it a default the user deleted would return on every start.
const recognitionDefaultsMarker = "recognitionDefaults:2.0.0"

// defaultRules200 returns the 2.0.0 default rules. Their IDs are fixed and they
// follow every 1.7.0 default: the positional IDs before them must not shift.
func defaultRules200() []RecognitionRule {
	rule := func(id, field, pattern, value string) RecognitionRule {
		return RecognitionRule{ID: id, Name: ruleFieldName(field) + " / " + value, Field: field, Match: "regex", Pattern: pattern, Value: value, Mode: "direct", Priority: 100, Enabled: true}
	}
	return []RecognitionRule{
		rule("default-hdr-sdr", "hdr", token(`sdr`).String(), "SDR"),
		rule("default-channels-1-0", "channels", token(regexp.QuoteMeta("1.0")).String(), "1.0"),
		rule("default-channels-6-1", "channels", token(regexp.QuoteMeta("6.1")).String(), "6.1"),
	}
}

// recognitionDubbedMarker records that the dubbed-audio defaults (rc.4, D30
// R8) were offered once. They have a marker of their own, so stores that
// already took the first 2.0.0 defaults are offered them too.
const recognitionDubbedMarker = "recognitionDefaults:2.0.0-dubbed"

// defaultRulesDubbed returns the dubbed-audio defaults: German release names
// append a D to the codec of a German dubbed track (AC3D, DTSD), which the
// codec tokens do not match. Each names the codec and the German language.
func defaultRulesDubbed() []RecognitionRule {
	audio := func(id, pattern, value string) RecognitionRule {
		return RecognitionRule{ID: id, Name: ruleFieldName("audio") + " / " + value + " (dubbed)", Field: "audio", Match: "regex", Pattern: token(pattern).String(), Value: value, Mode: "direct", Priority: 100, Enabled: true, Consume: true}
	}
	dts := audio("default-audio-dtsd", `dtsd`, "DTS")
	dts.ComparisonPattern = `^DTS(?:-HD(?: MA)?)?$`
	return []RecognitionRule{
		dts,
		audio("default-audio-ac3d", `ac3d`, "AC-3"),
		{ID: "default-language-dubbed", Name: ruleFieldName("language") + " / Deutsch (dubbed)", Field: "language", Match: "regex", Pattern: token(`dtsd|ac3d`).String(), Value: "Deutsch", Mode: "direct", Priority: 100, Enabled: true},
	}
}

// defaultRuleSet is one batch of defaults offered once under its marker;
// probes holds a filename each rule must recognize for an equivalent rule.
type defaultRuleSet struct {
	marker string
	rules  func() []RecognitionRule
	probes map[string]string
}

var (
	defaultSet200    = defaultRuleSet{recognitionDefaultsMarker, defaultRules200, map[string]string{"default-hdr-sdr": "Example.SDR.mkv", "default-channels-1-0": "Example.1.0.mkv", "default-channels-6-1": "Example.6.1.mkv"}}
	defaultSetDubbed = defaultRuleSet{recognitionDubbedMarker, defaultRulesDubbed, map[string]string{"default-audio-dtsd": "Example.German.DTSD.DL.mkv", "default-audio-ac3d": "Example.German.AC3D.mkv", "default-language-dubbed": "Example.DTSD.mkv"}}
)

// addDefaultRuleSet appends each default of set that is neither present by ID
// nor covered by an equivalent rule (same field and value, recognizing the
// probe filename, even when disabled). skipped lists defaults that did not fit
// within the 256 rule limit.
func addDefaultRuleSet(rules []RecognitionRule, set defaultRuleSet) (next []RecognitionRule, added, skipped []RecognitionRule) {
	next = append([]RecognitionRule{}, rules...)
	for _, rule := range set.rules() {
		if hasEquivalentRule200(next, rule, set.probes[rule.ID]) {
			continue
		}
		if len(next) >= 256 {
			skipped = append(skipped, rule)
			continue
		}
		next = append(next, rule)
		added = append(added, rule)
	}
	return next, added, skipped
}

func hasEquivalentRule200(rules []RecognitionRule, rule RecognitionRule, probe string) bool {
	for _, r := range rules {
		if r.ID == rule.ID {
			return true
		}
		if r.Field != rule.Field || !strings.EqualFold(strings.TrimSpace(r.Value), rule.Value) {
			continue
		}
		candidate := r
		candidate.Enabled = true
		if engine, err := CompileRecognition([]RecognitionRule{candidate}); err == nil && strings.EqualFold(engine.Recognize(probe).Values[rule.Field], rule.Value) {
			return true
		}
	}
	return false
}

// ensureDefaultRules200 offers the 2.0.0 defaults once. It reads only the
// database: the changed revision reparses cached files, which also applies
// the 2.0.0 derived refresh, so both markers are written in one transaction.
func (s *Store) ensureDefaultRules200(ctx context.Context) error {
	// Every batch whose marker is missing is offered in one pass: one backup,
	// one reparse and one transaction that writes their markers.
	var markers []string
	next := s.recognition.Load().config.Rules
	var added, skipped []RecognitionRule
	for _, set := range []defaultRuleSet{defaultSet200, defaultSetDubbed} {
		var marker string
		err := s.DB.QueryRowContext(ctx, "SELECT value FROM kv WHERE key=?", set.marker).Scan(&marker)
		if err == nil {
			continue
		}
		if err != sql.ErrNoRows {
			return err
		}
		var a, k []RecognitionRule
		next, a, k = addDefaultRuleSet(next, set)
		added, skipped = append(added, a...), append(skipped, k...)
		markers = append(markers, set.marker)
	}
	if len(markers) == 0 {
		return nil
	}
	var err error
	// Warn only once the marker is committed. A failed start is retried and
	// would otherwise repeat the same warnings.
	warnSkipped := func() {
		for _, rule := range skipped {
			s.Events.Add("warning", "system", "", "Default rule {name} was not added: at most 256 recognition rules are allowed", map[string]any{"name": rule.Name}, "", "")
		}
	}
	if len(added) == 0 {
		for _, key := range markers {
			if _, err = s.DB.ExecContext(ctx, "INSERT INTO kv(key,value) VALUES(?, 'true') ON CONFLICT(key) DO UPDATE SET value=excluded.value", key); err != nil {
				return err
			}
		}
		warnSkipped()
		return nil
	}
	engine, err := CompileRecognition(next)
	if err != nil {
		return err
	}
	// A store without files has nothing to protect: like the derived refresh,
	// do not use a retained backup slot for it.
	var hasFiles bool
	if err = s.DB.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM files)").Scan(&hasFiles); err != nil {
		return err
	}
	if hasFiles {
		if err = s.BackupContext(ctx); err != nil {
			return err
		}
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	raw, err := json.Marshal(engine.Config())
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO kv(key,value) VALUES('recognition',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", string(raw)); err != nil {
		return err
	}
	if err = reparseCached(ctx, tx, engine); err != nil {
		return err
	}
	if err = markActiveTagSyncDirty(tx); err != nil {
		return err
	}
	for _, key := range append(markers, "derivedRefresh:2.0.0") {
		if _, err = tx.ExecContext(ctx, "INSERT INTO kv(key,value) VALUES(?, 'true') ON CONFLICT(key) DO UPDATE SET value=excluded.value", key); err != nil {
			return err
		}
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	s.recognition.Store(engine)
	warnSkipped()
	return nil
}
