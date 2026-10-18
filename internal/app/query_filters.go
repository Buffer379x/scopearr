package app

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"

	_ "modernc.org/sqlite"
)

var fields = []string{"resolution", "codec", "family", "source", "processing", "hdr", "bitDepth", "audio", "channels", "language", "custom"}

func serviceOK(s string) bool { return serviceKind(s) == "radarr" || serviceKind(s) == "sonarr" }
func where(q url.Values) (string, []any, error) {
	if _, e := movieOrder(q); e != nil {
		return "", nil, e
	}
	service := q.Get("service")
	if !serviceOK(service) {
		return "", nil, fmt.Errorf("Invalid service")
	}
	w := []string{"f.service=?"}
	a := []any{service}
	if service == "radarr" || service == "sonarr" {
		w[0] = "(f.service=? OR f.service GLOB '" + service + "-*')"
	}
	if instance := q.Get("instance"); instance != "" {
		if !serviceOK(instance) || serviceKind(instance) != serviceKind(service) {
			return "", nil, fmt.Errorf("Invalid service instance")
		}
		w = append(w, "f.service=?")
		a = append(a, instance)
	}
	if q.Get("_exactInstance") == "true" {
		w = append(w, "f.service=?")
		a = append(a, service)
	}
	if values, ok := q["fileId"]; ok {
		id, e := strconv.Atoi(q.Get("fileId"))
		if len(values) != 1 || e != nil || id <= 0 {
			return "", nil, fmt.Errorf("Invalid file ID")
		}
		w = append(w, "f.id=?")
		a = append(a, id)
	}
	if search := strings.TrimSpace(q.Get("q")); search != "" {
		var terms []string
		for _, v := range strings.Fields(search) {
			terms = append(terms, `"`+strings.ReplaceAll(v, `"`, `""`)+`"*`)
		}
		w = append(w, "f.rowid IN (SELECT rowid FROM search WHERE search MATCH ?)")
		a = append(a, strings.Join(terms, " AND "))
	}
	for _, field := range fields {
		opValues := q[field+"Op"]
		op := q.Get(field + "Op")
		compound := field == "language" || field == "hdr" || field == "audio" || field == "channels" || field == "custom"
		if len(opValues) > 1 || (op != "" && op != "eq" && op != "not" && !(compound && (op == "all" || op == "notAll"))) {
			return "", nil, fmt.Errorf("Invalid filter operator for %s", field)
		}
		negative := op == "not" || op == "notAll"
		values := q[field]
		if field == "custom" && len(values) > 128 {
			return "", nil, fmt.Errorf("At most 128 custom tags are allowed")
		}
		if len(values) == 0 {
			continue
		}
		if compound {
			var parts []string
			for _, v := range values {
				if field == "custom" {
					if v == "__unknown__" {
						parts = append(parts, "NOT EXISTS(SELECT 1 FROM file_custom c WHERE c.file_rowid=f.rowid)")
					} else {
						id, err := strconv.ParseInt(v, 10, 64)
						if err != nil || id <= 0 {
							return "", nil, fmt.Errorf("Invalid custom tag")
						}
						parts = append(parts, "EXISTS(SELECT 1 FROM file_custom c WHERE c.file_rowid=f.rowid AND c.tag_id=?)")
						a = append(a, id)
					}
					continue
				}
				if field == "language" && v != "__unknown__" {
					v = normLanguage(v)
				}
				if v == "__unknown__" || v == "" {
					if field == "language" {
						parts = append(parts, "f.rowid IN (SELECT l.file_rowid FROM file_languages l WHERE l.language='')")
					} else if field == "audio" {
						parts = append(parts, "(f."+field+"='' OR EXISTS(SELECT 1 FROM json_each(f.data,'$.unknownTraits') u WHERE u.value=?))")
						a = append(a, field)
					} else {
						parts = append(parts, "f."+field+"=?")
						a = append(a, "")
					}
					continue
				}
				if field == "language" {
					parts = append(parts, "f.rowid IN (SELECT l.file_rowid FROM file_languages l WHERE l.language=?)")
					a = append(a, v)
				} else {
					parts = append(parts, "(f."+field+"=? OR instr(' + '||f."+field+"||' + ', ' + '||?||' + ')>0)")
					a = append(a, v, v)
				}
			}
			join := " OR "
			if op == "all" || op == "notAll" {
				join = " AND "
			}
			condition := "(" + strings.Join(parts, join) + ")"
			if negative {
				condition = "NOT " + condition
			}
			w = append(w, condition)
			continue
		}
		if field == "resolution" && containsString(values, sdResolutionValue) {
			parts := []string{}
			for _, v := range values {
				if v == sdResolutionValue {
					parts = append(parts, sdResolutionSQL)
				} else {
					if v == "__unknown__" {
						v = ""
					}
					parts = append(parts, "f.resolution=?")
					a = append(a, v)
				}
			}
			condition := "(" + strings.Join(parts, " OR ") + ")"
			if negative {
				condition = "NOT " + condition
			}
			w = append(w, condition)
			continue
		}
		var marks []string
		for _, v := range values {
			if v == "__unknown__" {
				v = ""
			}
			marks = append(marks, "?")
			a = append(a, v)
		}
		operator := " IN "
		if negative {
			operator = " NOT IN "
		}
		w = append(w, "f."+field+operator+"("+strings.Join(marks, ",")+")")
	}
	if state := q.Get("metadata"); state != "" {
		if state != "complete" && state != "incomplete" {
			return "", nil, fmt.Errorf("Invalid metadata status")
		}
		w = append(w, "coalesce(json_extract(f.data,'$.metadataIncomplete'),0)=?")
		a = append(a, state == "incomplete")
	}
	if c := q.Get("conflict"); c != "" {
		if c != "true" && c != "false" {
			return "", nil, fmt.Errorf("Invalid conflict filter")
		}
		w = append(w, "f.conflict=?")
		a = append(a, c == "true")
	}
	if c := q.Get("ruleConflict"); c != "" {
		if c != "true" && c != "false" {
			return "", nil, fmt.Errorf("Invalid recognition conflict filter")
		}
		w = append(w, "f.rule_conflict=?")
		a = append(a, c == "true")
	}
	if state := q.Get("embyMatch"); state != "" {
		switch state {
		case "unmatched":
			w = append(w, "f.emby_match IN ('missing','ambiguous','missing_size','no_tracks','pending','conflicting')")
		case "matched", "missing", "ambiguous", "missing_size", "no_tracks", "pending", "conflicting":
			w = append(w, "f.emby_match=?")
			a = append(a, state)
		case "unconfigured":
			w = append(w, "f.emby_match IN ('','unconfigured')")
		default:
			return "", nil, fmt.Errorf("Invalid Emby match filter")
		}
	}
	if e := appendMediaFilters(q, &w, &a); e != nil {
		return "", nil, e
	}
	if e := appendSeasonFilters(q, &w); e != nil {
		return "", nil, e
	}
	if q.Get("yearMin") != "" || q.Get("yearMax") != "" {
		ys := []string{"y.file_rowid=f.rowid"}
		for _, part := range []struct{ key, op string }{{"yearMin", ">="}, {"yearMax", "<="}} {
			if v := q.Get(part.key); v != "" {
				n, e := strconv.Atoi(v)
				if e != nil || n < 1800 || n > 3000 {
					return "", nil, fmt.Errorf("Invalid year")
				}
				ys = append(ys, "y.year"+part.op+"?")
				a = append(a, n)
			}
		}
		w = append(w, "EXISTS(SELECT 1 FROM years y WHERE "+strings.Join(ys, " AND ")+")")
	}
	if q.Get("unknownYear") == "true" {
		w = append(w, "NOT EXISTS(SELECT 1 FROM years y WHERE y.file_rowid=f.rowid)")
	}
	if q.Get("unknownSize") == "true" {
		w = append(w, "f.size=0")
	}
	for _, part := range []struct{ key, op string }{{"sizeMin", ">="}, {"sizeMax", "<="}} {
		if v := q.Get(part.key); v != "" {
			n, e := strconv.ParseInt(v, 10, 64)
			if e != nil || n < 0 {
				return "", nil, fmt.Errorf("Invalid size")
			}
			w = append(w, "f.size"+part.op+"?")
			a = append(a, n)
		}
	}
	return strings.Join(w, " AND "), a, nil
}
