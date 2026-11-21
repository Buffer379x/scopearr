package app

import (
	"context"
	"database/sql"
)

// execer runs a statement inside a transaction: the *sql.Tx itself, or a
// stmtCache for a loop that writes many files.
type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// stmtCache prepares each statement of a transaction once and reuses it, so
// a loop over many files does not compile the same SQL for every row.
// Results are those of tx.ExecContext. Close it before the transaction ends.
type stmtCache struct {
	tx    *sql.Tx
	stmts map[string]*sql.Stmt
}

func newStmtCache(tx *sql.Tx) *stmtCache {
	return &stmtCache{tx: tx, stmts: map[string]*sql.Stmt{}}
}

func (c *stmtCache) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	st, ok := c.stmts[query]
	if !ok {
		var err error
		if st, err = c.tx.PrepareContext(ctx, query); err != nil {
			return nil, err
		}
		c.stmts[query] = st
	}
	return st.ExecContext(ctx, args...)
}

func (c *stmtCache) Close() {
	for _, st := range c.stmts {
		st.Close()
	}
	clear(c.stmts)
}
