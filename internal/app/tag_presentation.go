package app

import (
	"context"
	"strings"
)

// Labels never replace canonical filter/color keys or stored comparison traits.
type TagPresentation struct {
	Tags   map[string][]string `json:"tags"`
	Labels map[string]string   `json:"labels"`
}

func (s *Store) TagPresentation(ctx context.Context) (TagPresentation, error) {
	tx, rules, err := s.beginRecognitionRead(ctx)
	if err != nil {
		return TagPresentation{}, err
	}
	defer tx.Rollback()
	tags, err := displayTags(ctx, tx, rules)
	if err != nil {
		return TagPresentation{}, err
	}
	return TagPresentation{Tags: tags, Labels: ruleDisplayLabels(rules)}, nil
}
func ruleDisplayLabels(rules []RecognitionRule) map[string]string {
	labels := map[string]string{}
	// Rules arrive in priority/ID order. Overrides take precedence over direct/fallback labels.
	for _, mode := range []string{"override", "direct", "fallback"} {
		for _, rule := range rules {
			if !rule.Enabled || rule.Mode != mode || rule.Field == "language" || rule.Field == "custom" || strings.Contains(rule.Value, "$") {
				continue
			}
			value := normalizeRuleValue(rule.Field, rule.Value)
			key := rule.Field + ":" + value
			if _, exists := labels[key]; !exists {
				labels[key] = strings.TrimSpace(rule.Value)
			}
		}
	}
	return labels
}

// Virtual presentation group: preserve exact stored values and exclude unknown/malformed values.
const sdResolutionValue = "__sd__"
const sdResolutionSQL = `(length(f.resolution)>1 AND lower(substr(f.resolution,-1)) IN ('p','i') AND substr(f.resolution,1,length(f.resolution)-1) NOT GLOB '*[^0-9]*' AND CAST(f.resolution AS INTEGER)>0 AND CAST(f.resolution AS INTEGER)<720)`

func isSDResolution(value string) bool {
	if len(value) < 2 || !strings.ContainsAny(value[len(value)-1:], "pPiI") {
		return false
	}
	lines := 0
	for i := 0; i < len(value)-1; i++ {
		if value[i] < '0' || value[i] > '9' {
			return false
		}
		lines = lines*10 + int(value[i]-'0')
		if lines >= 720 {
			return false
		}
	}
	return lines > 0
}
