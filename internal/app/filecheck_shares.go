package app

import (
	"context"
	"errors"
	"net/url"
	"strings"
)

// Shares count findings, matching the page's status/kind count basis.
func (s *Server) fileCheckShares(ctx context.Context) map[string]int {
	roots := s.FileCheck.scanStatus().Roots
	out := map[string]int{}
	for _, root := range roots {
		if root.Share != "" {
			out[root.Share] = 0
		}
	}
	rows, err := s.Store.DB.QueryContext(ctx, "SELECT root,count(*) FROM filecheck_items GROUP BY root")
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var path string
		var count int
		if rows.Scan(&path, &count) != nil {
			continue
		}
		if share := fileCheckShare(roots, path); share != "" {
			out[share] += count
		}
	}
	return out
}

// The same validated share restriction is used for list rows and bulk IDs.
func (s *Server) fileCheckListFilter(_ context.Context, q url.Values) (string, []any, error) {
	return fileCheckFilterForRoots(q, s.FileCheck.scanStatus().Roots)
}

func fileCheckFilterForRoots(q url.Values, roots []ScanRoot) (string, []any, error) {
	where, args, err := fileCheckFilterValues(q)
	if err != nil {
		return "", nil, err
	}
	if len(q["share"]) == 0 {
		return where, args, nil
	}
	known := map[string]bool{}
	for _, root := range roots {
		if root.Share != "" {
			known[root.Share] = true
		}
	}
	clauses := []string{}
	for _, share := range q["share"] {
		if _, ok := known[share]; !ok {
			return "", nil, errors.New("Invalid filter")
		}
		for _, root := range roots {
			if root.Share == share && root.LocalPath != "" {
				clauses = append(clauses, "(root=? OR substr(root,1,length(?)+1)=?||'/')")
				args = append(args, root.LocalPath, root.LocalPath, root.LocalPath)
			}
		}
	}
	if len(clauses) == 0 {
		return "", nil, errors.New("Invalid filter")
	}
	if len(clauses) > 0 {
		where += " AND (" + strings.Join(clauses, " OR ") + ")"
	}
	return where, args, nil
}

func fileCheckShare(roots []ScanRoot, path string) string {
	best := -1
	for n, root := range roots {
		if root.Share != "" && root.LocalPath != "" && pathWithin(root.LocalPath, path) && (best < 0 || len(root.LocalPath) > len(roots[best].LocalPath)) {
			best = n
		}
	}
	if best < 0 {
		return ""
	}
	return roots[best].Share
}
