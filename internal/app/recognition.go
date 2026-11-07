package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"scopearr/internal/langdata"
	"sort"
	"strconv"
	"strings"
)

// Rules affect filenames only. API normalization and Emby track attribution remain separate.
type RecognitionRule struct {
	Tag               *bool  `json:"tag,omitempty"`
	ID                string `json:"id"`
	Name              string `json:"name"`
	Field             string `json:"field"`
	Match             string `json:"match"`
	Pattern           string `json:"pattern"`
	Value             string `json:"value"`
	Mode              string `json:"mode"`
	Priority          int    `json:"priority"`
	Enabled           bool   `json:"enabled"`
	Consume           bool   `json:"consume"`
	Unless            string `json:"unless,omitempty"`
	ComparisonPattern string `json:"comparisonPattern,omitempty"`
}
type RecognitionConfig struct {
	Rules    []RecognitionRule `json:"rules"`
	Revision string            `json:"revision"`
}
type RecognitionConflict struct {
	Field     string   `json:"field"`
	Values    []string `json:"values"`
	Rules     []string `json:"rules"`
	RuleNames []string `json:"ruleNames"`
}
type compiledRule struct {
	RecognitionRule
	re, unless, comparison *regexp.Regexp
}
type RecognitionEngine struct {
	hasInformationRules bool
	ruleCatalog         map[string]compiledRule
	config              RecognitionConfig
	groups              map[string][]compiledRule
	names               map[string]string
	comparisons         map[string]*regexp.Regexp
}
type RecognitionResult struct {
	Values    map[string]string     `json:"values"`
	Matches   map[string][]string   `json:"matches"`
	Origins   map[string]string     `json:"origins"`
	Conflicts []RecognitionConflict `json:"conflicts"`
}

var recognitionFields = []string{"resolution", "codec", "source", "processing", "hdr", "bitDepth", "audio", "channels", "language", "custom"}
var ruleIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,80}$`)

func CompileRecognition(rules []RecognitionRule) (*RecognitionEngine, error) {
	if len(rules) > 256 {
		return nil, fmt.Errorf("At most 256 recognition rules are allowed")
	}
	rules = append([]RecognitionRule{}, rules...)
	sort.Slice(rules, func(i, j int) bool {
		if rules[i].Priority != rules[j].Priority {
			return rules[i].Priority < rules[j].Priority
		}
		return rules[i].ID < rules[j].ID
	})
	engine := &RecognitionEngine{config: RecognitionConfig{Rules: rules}, groups: map[string][]compiledRule{}, names: map[string]string{}, comparisons: map[string]*regexp.Regexp{}}
	engine.ruleCatalog = map[string]compiledRule{}
	ids := map[string]bool{}
	for _, r := range rules {
		validField := false
		for _, f := range recognitionFields {
			validField = validField || f == r.Field
		}
		if !ruleIDPattern.MatchString(r.ID) || ids[r.ID] || !validField || strings.TrimSpace(r.Name) == "" || len(r.Name) > 80 || r.Pattern == "" || len(r.Pattern) > 500 || strings.TrimSpace(r.Value) == "" || len(r.Value) > 80 || len(r.Unless) > 500 || len(r.ComparisonPattern) > 500 || r.Priority < 0 || r.Priority > 10000 {
			return nil, fmt.Errorf("Invalid recognition rule")
		}
		if r.Field == "custom" {
			id, err := strconv.ParseInt(r.Value, 10, 64)
			if err != nil || id <= 0 {
				return nil, fmt.Errorf("Invalid custom tag")
			}
		}
		ids[r.ID] = true
		if r.Mode != "direct" && r.Mode != "fallback" && r.Mode != "override" {
			return nil, fmt.Errorf("Invalid recognition rule mode")
		}
		pattern := r.Pattern
		switch r.Match {
		case "token":
			// A separator already written into a literal token supplies its boundary.
			// Do not require an additional dot around tokens such as .Ultra.HD.
			prefix, suffix := `(?:^|[ ._\[\]()/,;|+-])`, `(?:$|[ ._\[\]()/,;|+-])`
			if strings.ContainsRune(" ._[]()/,;|+-", rune(pattern[0])) {
				prefix = ""
			}
			if strings.ContainsRune(" ._[]()/,;|+-", rune(pattern[len(pattern)-1])) {
				suffix = ""
			}
			pattern = prefix + regexp.QuoteMeta(pattern) + suffix
		case "regex":
		default:
			return nil, fmt.Errorf("Invalid recognition match type")
		}
		re, err := regexp.Compile("(?i)" + pattern)
		if err != nil || re.MatchString("") {
			return nil, fmt.Errorf("Invalid or empty-matching regular expression in rule %s", r.Name)
		}
		var unless *regexp.Regexp
		if r.Unless != "" {
			unless, err = regexp.Compile("(?i)" + r.Unless)
			if err != nil {
				return nil, fmt.Errorf("Invalid exclusion expression in rule %s", r.Name)
			}
		}
		var comparison *regexp.Regexp
		if r.ComparisonPattern != "" {
			if r.Field != "audio" {
				return nil, fmt.Errorf("Metadata comparison is only supported for audio rules")
			}
			comparison, err = regexp.Compile("(?i)" + r.ComparisonPattern)
			if err != nil || comparison.MatchString("") {
				return nil, fmt.Errorf("Invalid metadata comparison expression in rule %s", r.Name)
			}
		}
		compiled := compiledRule{r, re, unless, comparison}
		engine.names[r.ID] = r.Name
		engine.ruleCatalog[r.ID] = compiled
		engine.hasInformationRules = engine.hasInformationRules || r.Enabled && !ruleIsTag(r)
		if r.Enabled {
			if comparison != nil {
				engine.comparisons[r.ID] = comparison
			}
			engine.groups[r.Field+":"+r.Mode] = append(engine.groups[r.Field+":"+r.Mode], compiled)
		}
	}
	raw, _ := json.Marshal(rules)
	sum := sha256.Sum256(append(raw, []byte("\nISO:"+langdata.Revision)...))
	engine.config.Revision = hex.EncodeToString(sum[:])
	return engine, nil
}
func (e *RecognitionEngine) Config() RecognitionConfig {
	return RecognitionConfig{Rules: append([]RecognitionRule{}, e.config.Rules...), Revision: e.config.Revision}
}
func normalizeRuleValue(field, value string) string {
	value = strings.TrimSpace(value)
	switch field {
	case "resolution":
		return normResolution(value)
	case "codec":
		return normCodec(value)
	case "language":
		return normLanguage(value)
	}
	return value
}
func (e *RecognitionEngine) Recognize(filename string) RecognitionResult {
	result := RecognitionResult{Values: map[string]string{}, Matches: map[string][]string{}, Origins: map[string]string{}, Conflicts: []RecognitionConflict{}}
	for _, field := range recognitionFields {
		if field == "custom" {
			seen := map[string]bool{}
			values, ids := []string{}, []string{}
			for _, mode := range []string{"direct", "fallback", "override"} {
				for _, r := range e.groups[field+":"+mode] {
					matched := false
					for _, match := range r.re.FindAllStringIndex(filename, -1) {
						if match[0] != match[1] {
							matched = true
							break
						}
					}
					if (r.unless == nil || !r.unless.MatchString(filename)) && matched {
						if !seen[r.Value] {
							values = append(values, r.Value)
							seen[r.Value] = true
						}
						ids = append(ids, r.ID)
					}
				}
			}
			if len(values) == 0 {
				continue
			}
			sort.Strings(values)
			result.Values[field] = strings.Join(values, " + ")
			result.Matches[field] = ids
			result.Origins[field] = "filename"
			continue
		}
		compound := field == "hdr" || field == "audio" || field == "language" || field == "custom"
		for _, mode := range []string{"direct", "fallback", "override"} {
			if mode == "fallback" && result.Values[field] != "" {
				continue
			}
			group := e.groups[field+":"+mode]
			if len(group) == 0 {
				continue
			}
			input := filename
			if field == "audio" {
				input = strings.NewReplacer("/", " ", ",", " ", ";", " ", "|", " ").Replace(input)
			}
			values, ids := []string{}, []string{}
			seen := map[string]bool{}
			for _, r := range group {
				if r.unless != nil && r.unless.MatchString(filename) {
					continue
				}
				matches := r.re.FindAllStringSubmatchIndex(input, -1)
				matched := false
				for _, match := range matches {
					if match[0] == match[1] {
						continue
					}
					matched = true
					value := r.Value
					if r.Match == "regex" {
						value = string(r.re.ExpandString(nil, r.Value, input, match))
					}
					value = normalizeRuleValue(field, value)
					if value != "" && !seen[value] {
						values = append(values, value)
						seen[value] = true
					}
				}
				if matched {
					ids = append(ids, r.ID)
					if r.Consume {
						for i := 0; i < 16 && r.re.MatchString(input); i++ {
							next := r.re.ReplaceAllString(input, " ")
							if len(next) >= len(input) {
								break
							}
							input = next
						}
					}
				}
			}
			if len(values) == 0 {
				continue
			}
			value := values[0]
			if compound {
				sep := " + "
				if field == "language" {
					sep = ", "
					sort.Strings(values)
				}
				value = strings.Join(values, sep)
			}
			result.Values[field] = value
			result.Matches[field] = ids
			result.Origins[field] = "filename"
			if mode != "direct" {
				result.Origins[field] = "rule"
			}
			// Direct and fallback conflicts are ignored only when an explicit override resolves them.
			kept := result.Conflicts[:0]
			for _, c := range result.Conflicts {
				if c.Field != field {
					kept = append(kept, c)
				}
			}
			result.Conflicts = kept
			compatible := field == "codec"
			for _, v := range values {
				compatible = compatible && family(v) == family(values[0])
			}
			if !compound && !compatible && len(values) > 1 {
				names := []string{}
				for _, id := range ids {
					names = append(names, e.names[id])
				}
				result.Conflicts = append(result.Conflicts, RecognitionConflict{field, values, ids, names})
			}
		}
	}
	return result
}

func DefaultRecognitionRules() []RecognitionRule {
	rules := []RecognitionRule{}
	add := func(field, pattern, value string, priority int) {
		rules = append(rules, RecognitionRule{ID: fmt.Sprintf("default-%s-%d", field, len(rules)), Name: ruleFieldName(field) + " / " + value, Field: field, Match: "regex", Pattern: pattern, Value: value, Mode: "direct", Priority: priority, Enabled: true})
	}
	for _, v := range []string{"480p", "480i", "576p", "576i", "720p", "1080p", "1080i", "1440p", "2160p", "4320p", "4k", "8k"} {
		add("resolution", token(regexp.QuoteMeta(v)).String(), normResolution(v), 100)
	}
	for _, v := range []struct{ pattern, value string }{{`x[ ._-]?264`, "x264"}, {`x[ ._-]?265`, "x265"}, {`h[ ._-]?264|avc`, "AVC"}, {`h[ ._-]?265|hevc`, "HEVC"}, {`av1`, "AV1"}, {`xvid`, "XviD"}, {`divx`, "DivX"}, {`mpeg[ ._-]?2`, "MPEG-2"}, {`vc[ ._-]?1`, "VC-1"}} {
		add("codec", token(v.pattern).String(), v.value, 100)
	}
	for i, m := range sourceMatchers {
		add("source", m.re.String(), m.label, 100+i)
	}
	add("processing", remuxRE.String(), "Remux", 100)
	for _, v := range []struct {
		re    *regexp.Regexp
		value string
	}{{dolbyRE, "Dolby Vision"}, {hdr10PlusRE, "HDR10+"}, {hdr10RE, "HDR10"}, {hlgRE, "HLG"}, {hdrRE, "HDR"}} {
		add("hdr", v.re.String(), v.value, 100)
		if v.value == "HDR" {
			rules[len(rules)-1].Unless = token(`hdr10(?:\+|plus)?`).String()
		}
	}
	for _, v := range []string{"8", "10", "12"} {
		add("bitDepth", token(v+`[ ._-]?bit`).String(), v, 100)
	}
	for i, m := range audioMatchers {
		add("audio", m.re.String(), m.label, 100+i)
		rules[len(rules)-1].Consume = true
		if m.label == "DTS" || m.label == "DTS-HD" || m.label == "DTS-HD MA" {
			rules[len(rules)-1].ComparisonPattern = `^DTS(?:-HD(?: MA)?)?$`
		}
	}
	for _, v := range []string{"2.0", "2.1", "5.1", "7.1"} {
		add("channels", token(regexp.QuoteMeta(v)).String(), v, 100)
	}
	for _, m := range languageMatchers {
		add("language", m.re.String(), m.label, 100)
		aliases := map[string]string{"Deutsch": "german|deutsch", "Englisch": "english", "Französisch": "french", "Japanisch": "japanese"}[m.label]
		marker := `(?:subbed|subs?|subtitles|hard[ ._-]?subbed|soft[ ._-]?subbed)`
		rules[len(rules)-1].Unless = `(?:^|[ ._\[\]()-])(?:(?:` + aliases + `)[ ._-]+` + marker + `|` + marker + `[ ._-]+(?:` + aliases + `))(?:$|[ ._\[\]()-])`
	}
	rules = append(rules, uhdbdDefaultRule(), uhdBluRayDefaultRule())
	rules = append(rules, defaultRules200()...)
	return rules
}

var defaultRecognitionEngine = func() *RecognitionEngine {
	e, err := CompileRecognition(DefaultRecognitionRules())
	if err != nil {
		panic(err)
	}
	return e
}()

// Comparison tolerances belong to matching filename rules, not global codec normalization.
func (e *RecognitionEngine) containsAudio(actual, expected string, ruleIDs []string) bool {
	for _, want := range strings.Split(expected, " + ") {
		found := false
		for _, got := range strings.Split(actual, " + ") {
			if got == want {
				found = true
				break
			}
			for _, id := range ruleIDs {
				if comparison := e.comparisons[id]; comparison != nil && comparison.MatchString(want) && comparison.MatchString(got) {
					found = true
					break
				}
			}

		}
		if !found {
			return false
		}
	}
	return true
}
func upgradeDefaultRules(rules []RecognitionRule) ([]RecognitionRule, bool) {
	next := append([]RecognitionRule{}, rules...)
	changed := false
	for _, updated := range DefaultRecognitionRules() {
		old := updated
		old.ComparisonPattern = ""
		if old.Field == "language" {
			old.Unless = ""
		}
		if old == updated {
			continue
		}
		for i, rule := range next {
			historical := old
			historical.Name = old.Field + " · " + old.Value
			if rule == old || rule == historical {
				next[i] = updated
				changed = true
			}
		}
	}
	return next, changed
}

func uhdbdDefaultRule() RecognitionRule {
	return RecognitionRule{ID: "default-source-uhdbd", Name: "Source / UHD (UHDBD)", Field: "source", Match: "token", Pattern: "UHDBD", Value: "UHD", Mode: "override", Priority: 95, Enabled: true}
}
func addUHDBDDefault(rules []RecognitionRule) ([]RecognitionRule, bool) {
	for _, r := range rules {
		if r.ID == "default-source-uhdbd" {
			return rules, false
		}
		if r.Field == "source" && strings.EqualFold(r.Value, "UHD") {
			if r.Match == "token" && strings.EqualFold(r.Pattern, "UHDBD") || r.Pattern == token("uhdbd").String() {
				return rules, false
			}
			probe := r
			probe.Enabled = true
			if engine, e := CompileRecognition([]RecognitionRule{probe}); e == nil && strings.EqualFold(engine.Recognize("Example.UHDBD.mkv").Values["source"], "UHD") {
				return rules, false
			}
		}
	}
	return append(append([]RecognitionRule{}, rules...), uhdbdDefaultRule()), true
}
