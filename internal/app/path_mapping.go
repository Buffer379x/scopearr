package app

import (
	"fmt"
	"sort"
	"strings"
)

type pathMapping struct{ arr, emby string }

func cleanMediaPath(value string) string {
	value = strings.ReplaceAll(strings.TrimSpace(value), "\\", "/")
	for strings.Contains(value, "//") {
		value = strings.ReplaceAll(value, "//", "/")
	}
	return strings.TrimRight(value, "/")
}
func parsePathMappings(value string) ([]pathMapping, error) {
	if len(value) > 8192 {
		return nil, fmt.Errorf("Too many path mappings")
	}
	out := []pathMapping{}
	seen := map[string]bool{}
	for _, line := range strings.Split(value, "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		left, right, ok := strings.Cut(line, "=>")
		left, right = cleanMediaPath(left), cleanMediaPath(right)
		absolute := func(v string) bool { return strings.HasPrefix(v, "/") || (len(v) > 2 && v[1] == ':' && v[2] == '/') }
		if !ok || left == "" || right == "" || !absolute(left) || !absolute(right) || seen[left] || strings.ContainsAny(left+right, "\r\x00") || strings.Contains(right, "=>") {
			return nil, fmt.Errorf("Path mappings require unique absolute paths: Arr path => Emby path")
		}
		seen[left] = true
		out = append(out, pathMapping{left, right})
	}
	sort.SliceStable(out, func(i, j int) bool { return len(out[i].arr) > len(out[j].arr) })
	return out, nil
}
func mappedPathMatches(arrPath, embyPath string, mappings []pathMapping) bool {
	arrPath, embyPath = cleanMediaPath(arrPath), cleanMediaPath(embyPath)
	for _, mapping := range mappings {
		if arrPath == mapping.arr || strings.HasPrefix(arrPath, mapping.arr+"/") {
			return mapping.emby+strings.TrimPrefix(arrPath, mapping.arr) == embyPath
		}
	}
	return false
}
