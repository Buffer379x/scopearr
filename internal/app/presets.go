package app

import (
	"context"
	"net/url"
	"sort"
	"strconv"
	"strings"
)

// Compare effective filters, never page, ordering, display context or unused operators.
func canonicalPresetQuery(raw, service string) (string, error) {
	q, err := url.ParseQuery(raw)
	if err != nil {
		return "", err
	}
	q.Set("service", service)
	if _, _, err := where(q); err != nil {
		return "", err
	}
	out := url.Values{}
	if q.Get("instance") != "" {
		out.Set("instance", q.Get("instance"))
	}
	for _, field := range fields {
		seen := map[string]bool{}
		for _, value := range q[field] {
			if field == "language" && value != "__unknown__" {
				value = normLanguage(value)
			}
			if value == "" {
				value = "__unknown__"
			}
			seen[value] = true
		}
		values := make([]string, 0, len(seen))
		for v := range seen {
			values = append(values, v)
		}
		sort.Strings(values)
		for _, value := range values {
			out.Add(field, value)
		}
		op := q.Get(field + "Op")
		if len(values) == 1 {
			if op == "all" {
				op = "eq"
			}
			if op == "notAll" {
				op = "not"
			}
		}
		if len(values) > 0 && op != "" && op != "eq" {
			out.Set(field+"Op", op)
		}
	}
	terms := map[string]bool{}
	for _, term := range strings.Fields(strings.ToLower(q.Get("q"))) {
		terms[term] = true
	}
	search := []string{}
	for term := range terms {
		search = append(search, term)
	}
	sort.Strings(search)
	if len(search) > 0 {
		out.Set("q", strings.Join(search, " "))
	}
	for _, key := range []string{"yearMin", "yearMax", "sizeMin", "sizeMax"} {
		if q.Get(key) != "" {
			number, _ := strconv.ParseInt(q.Get(key), 10, 64)
			out.Set(key, strconv.FormatInt(number, 10))
		}
	}
	for _, key := range []string{"conflict", "ruleConflict", "metadata", "embyMatch", "seasonOutlier", "languageOutlier"} {
		if v := q.Get(key); v != "" {
			out.Set(key, v)
		}
	}
	for key := range mediaStateFilters {
		if v := q.Get(key); v != "" {
			out.Set(key, v)
		}
	}

	for _, key := range []string{"unknownYear", "unknownSize"} {
		if q.Get(key) == "true" {
			out.Set(key, "true")
		}
	}
	return out.Encode(), nil
}

func (s *Store) SavePreset(ctx context.Context, preset Preset) (Preset, *Preset, error) {
	s.presetMu.Lock()
	defer s.presetMu.Unlock()
	key, err := canonicalPresetQuery(preset.Query, preset.Service)
	if err != nil {
		return Preset{}, nil, err
	}
	rows, err := s.DB.QueryContext(ctx, "SELECT id,name,service,query FROM presets WHERE service=?", preset.Service)
	if err != nil {
		return Preset{}, nil, err
	}
	var duplicate *Preset
	for rows.Next() {
		var existing Preset
		if err = rows.Scan(&existing.ID, &existing.Name, &existing.Service, &existing.Query); err != nil {
			rows.Close()
			return Preset{}, nil, err
		}
		existingKey, valid := canonicalPresetQuery(existing.Query, existing.Service)
		if valid == nil && key == existingKey {
			copy := existing
			duplicate = &copy
			break
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return Preset{}, nil, err
	}
	if duplicate != nil {
		return Preset{}, duplicate, nil
	}
	// Keep existing presets untouched; new records store a stable, normalized query.
	normalized, _ := url.ParseQuery(key)
	normalized.Set("service", preset.Service)
	preset.Query = normalized.Encode()
	result, err := s.DB.ExecContext(ctx, "INSERT INTO presets(name,service,query) VALUES(?,?,?)", strings.TrimSpace(preset.Name), preset.Service, preset.Query)
	if err != nil {
		return Preset{}, nil, err
	}
	preset.ID, err = result.LastInsertId()
	return preset, nil, err
}

func duplicatePresetResponse(p Preset) map[string]any {
	// Only public preset data is returned, never configuration or credentials.
	return map[string]any{"error": "These filters are already saved.", "preset": p}
}
