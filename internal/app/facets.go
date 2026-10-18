package app

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"

	_ "modernc.org/sqlite"
)

func (s *Store) facets(ctx context.Context, service string) (map[string][]string, error) {
	if !serviceOK(service) {
		return nil, fmt.Errorf("Invalid service")
	}
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	out := map[string][]string{}
	for _, field := range fields {
		if field == "custom" {
			continue
		}
		rows, e := tx.QueryContext(ctx, "SELECT DISTINCT "+field+" FROM files WHERE "+scopePredicate("service", service)+" AND "+s.activePredicate("")+" ORDER BY "+field)
		if e != nil {
			return nil, e
		}
		out[field] = []string{}
		unique := map[string]bool{}
		for rows.Next() {
			var v string
			if e = rows.Scan(&v); e != nil {
				rows.Close()
				return nil, e
			}
			if v == "" {
				v = "__unknown__"
			}
			values := []string{v}
			if field == "language" {
				values = strings.Split(v, ", ")
			}
			if field == "hdr" || field == "audio" || field == "channels" {
				values = strings.Split(v, " + ")
			}
			for _, value := range values {
				if !unique[value] {
					out[field] = append(out[field], value)
					unique[value] = true
				}
			}
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return nil, e
		}
		if field == "audio" || field == "language" {
			var unknown bool
			if e := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM files,json_each(data,'$.unknownTraits') u WHERE "+scopePredicate("service", service)+" AND "+s.activePredicate("")+" AND u.value=?)", field).Scan(&unknown); e != nil {
				return nil, e
			}
			if unknown && !unique["__unknown__"] {
				out[field] = append(out[field], "__unknown__")
			}
		}
		sort.Strings(out[field])
	}
	rows, err := tx.QueryContext(ctx, "SELECT DISTINCT cast(c.tag_id AS TEXT) FROM file_custom c JOIN files f ON f.rowid=c.file_rowid JOIN custom_tags t ON t.id=c.tag_id WHERE "+scopePredicate("f.service", service)+" AND "+s.activePredicate("f.")+" ORDER BY t.name_key")
	if err != nil {
		return nil, err
	}
	out["custom"] = []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		out["custom"] = append(out["custom"], id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	var untagged bool
	if err = tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM files f WHERE "+scopePredicate("f.service", service)+" AND "+s.activePredicate("f.")+" AND NOT EXISTS(SELECT 1 FROM file_custom c WHERE c.file_rowid=f.rowid))").Scan(&untagged); err != nil {
		return nil, err
	}
	if untagged {
		out["custom"] = append(out["custom"], "__unknown__")
	}
	return out, tx.Commit()
}
