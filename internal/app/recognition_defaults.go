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

// addDefaultRules200 appends each 2.0.0 default that is neither present by ID
// nor covered by an equivalent rule (same field and value, recognizing the
// probe filename, even when disabled). skipped lists defaults that did not fit
// within the 256 rule limit.
func addDefaultRules200(rules []RecognitionRule) (next []RecognitionRule, added, skipped []RecognitionRule) {
	next = append([]RecognitionRule{}, rules...)
	probes := map[string]string{"default-hdr-sdr": "Example.SDR.mkv", "default-channels-1-0": "Example.1.0.mkv", "default-channels-6-1": "Example.6.1.mkv"}
	for _, rule := range defaultRules200() {
		if hasEquivalentRule200(next, rule, probes[rule.ID]) {
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
	var marker string
	err := s.DB.QueryRowContext(ctx, "SELECT value FROM kv WHERE key=?", recognitionDefaultsMarker).Scan(&marker)
	if err == nil {
		return nil
	}
	if err != sql.ErrNoRows {
		return err
	}
	next, added, skipped := addDefaultRules200(s.recognition.Load().config.Rules)
	// Warn only once the marker is committed. A failed start is retried and
	// would otherwise repeat the same warnings.
	warnSkipped := func() {
		for _, rule := range skipped {
			s.Events.Add("warning", "system", "", "Default rule {name} was not added: at most 256 recognition rules are allowed", map[string]any{"name": rule.Name}, "", "")
		}
	}
	if len(added) == 0 {
		if _, err = s.DB.ExecContext(ctx, "INSERT INTO kv(key,value) VALUES(?, 'true') ON CONFLICT(key) DO UPDATE SET value=excluded.value", recognitionDefaultsMarker); err != nil {
			return err
		}
		warnSkipped()
		return nil
	}
	engine, err := CompileRecognition(next)
	if err != nil {
		return err
	}
	if err = s.BackupContext(ctx); err != nil {
		return err
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
	for _, key := range []string{recognitionDefaultsMarker, "derivedRefresh:2.0.0"} {
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
