package app

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"scopearr"
	"sort"
	"strconv"
	"strings"
)

type localeCatalog struct {
	Locale   string            `json:"locale"`
	Messages map[string]string `json:"messages"`
}

var translations = loadTranslations()

func loadTranslations() map[string]map[string]string {
	catalogs := map[string]map[string]string{}
	entries, err := fs.ReadDir(scopearr.Locales(), ".")
	if err != nil {
		panic(err)
	}
	for _, entry := range entries {
		raw, err := fs.ReadFile(scopearr.Locales(), entry.Name())
		if err != nil {
			panic(err)
		}
		var catalog localeCatalog
		if err := json.Unmarshal(raw, &catalog); err != nil {
			panic(err)
		}
		catalogs[strings.ToLower(catalog.Locale)] = catalog.Messages
	}
	return catalogs
}
func requestLocale(r *http.Request) string {
	if locale := strings.ToLower(r.URL.Query().Get("lang")); translations[locale] != nil {
		return locale
	}
	type preference struct {
		tag string
		q   float64
	}
	preferences := []preference{}
	for _, part := range strings.Split(r.Header.Get("Accept-Language"), ",") {
		fields := strings.Split(strings.TrimSpace(part), ";")
		p := preference{tag: strings.ToLower(fields[0]), q: 1}
		for _, parameter := range fields[1:] {
			if strings.HasPrefix(strings.TrimSpace(parameter), "q=") {
				value, err := strconv.ParseFloat(strings.TrimSpace(parameter)[2:], 64)
				if err != nil || value < 0 || value > 1 {
					p.q = 0
				} else {
					p.q = value
				}
			}
		}
		if p.q > 0 {
			preferences = append(preferences, p)
		}
	}
	sort.SliceStable(preferences, func(i, j int) bool { return preferences[i].q > preferences[j].q })
	for _, p := range preferences {
		if translations[p.tag] != nil {
			return p.tag
		}
		base := strings.Split(p.tag, "-")[0]
		if translations[base] != nil {
			return base
		}
	}
	return "en"
}
func localizedMessage(locale, message string) string {
	// Old persisted sync errors may predate English application messages.
	for key, value := range translations["de"] {
		if message == value {
			message = key
			break
		}
	}
	if value := translations[locale][message]; value != "" {
		return value
	}
	for _, prefix := range []string{"Emby enrichment failed: ", "The tag was created, but could not be applied: "} {
		if strings.HasPrefix(message, prefix) {
			translated := translations[locale][prefix]
			if translated == "" {
				translated = prefix
			}
			return translated + localizedMessage(locale, strings.TrimPrefix(message, prefix))
		}
	}
	for _, key := range []string{"Service returned HTTP %d", "Invalid filter operator for %s", "Invalid or empty-matching regular expression in rule %s", "Invalid exclusion expression in rule %s"} {
		marker := "%s"
		if strings.Contains(key, "%d") {
			marker = "%d"
		}
		parts := strings.Split(key, marker)
		if strings.HasPrefix(message, parts[0]) && strings.HasSuffix(message, parts[1]) {
			argument := strings.TrimSuffix(strings.TrimPrefix(message, parts[0]), parts[1])
			template := translations[locale][key]
			if template == "" {
				template = key
			}
			if marker == "%d" {
				if value, err := strconv.Atoi(argument); err == nil {
					return fmt.Sprintf(template, value)
				}
			} else {
				return fmt.Sprintf(template, argument)
			}
		}
	}
	return message
}
