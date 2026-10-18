package app

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"reflect"
	"strings"
	"testing"
)

type catalogTableScan struct{ db *sql.DB }

func (q catalogTableScan) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return q.db.QueryContext(ctx, strings.Replace(query, " INDEXED BY "+catalogCountIndex, " NOT INDEXED", 1), args...)
}

func assertCatalogIndexCounts110(t *testing.T, db *sql.DB) {
	t.Helper()
	ctx := context.Background()
	got, origins, err := allTraitCounts(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	want, wantOrigins, err := allTraitCounts(ctx, catalogTableScan{db})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) || !reflect.DeepEqual(origins, wantOrigins) {
		t.Fatalf("indexed catalog differs from table scan: %v / %v; origins %v / %v", got, want, origins, wantOrigins)
	}
}

func TestCatalogCoveringIndexCountsAndUpdates110(t *testing.T) {
	s := testStore(t)
	files := []File{
		sample(1, "One.1080p.x264.BluRay.mkv"),
		sample(2, "Two.2160p.x265.UHD.Remux.HDR10.10bit.mkv"),
		sample(3, "Three.mkv"),
	}
	if err := s.Replace("radarr-index", files, SyncStatus{}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec(`UPDATE files SET audio='DTS + AC-3 + DTS',channels='5.1',data=json_set(data,'$.unknownTraits',json('["audio","channels"]'),'$.evidence.audio.origin','mediaServer','$.evidence.audio.emby','DTS + AC-3','$.evidence.codec.origin','combined','$.evidence.codec.emby','HEVC') WHERE id=1`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec(`UPDATE files SET audio='DTS',data=json_set(data,'$.evidence.audio.origin','emby','$.evidence.audio.emby','DTS') WHERE id=2`); err != nil {
		t.Fatal(err)
	}
	// An unreadable legacy JSON row must neither break index maintenance nor
	// introduce metadata provenance; its normalized scalar traits still count.
	if _, err := s.DB.Exec(`UPDATE files SET data='invalid JSON' WHERE id=3`); err != nil {
		t.Fatal(err)
	}
	assertCatalogIndexCounts110(t, s.DB)
	counts, origins, err := allTraitCounts(context.Background(), s.DB)
	if err != nil || counts["audio"]["DTS"] != 2 || counts["audio"]["AC-3"] != 1 || counts["audio"]["__unknown__"] != 3 || !origins["codec:HEVC"] || !origins["family:H.265/HEVC"] || !origins["audio:AC-3"] {
		t.Fatalf("unexpected indexed counts/provenance: %v / %v / %v", counts, origins, err)
	}
	if _, err := s.DB.Exec(`UPDATE files SET audio='Opus',data=json_set(data,'$.unknownTraits',json('[]'),'$.evidence.audio.emby','Opus') WHERE id=1`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec(`DELETE FROM files WHERE id=2`); err != nil {
		t.Fatal(err)
	}
	assertCatalogIndexCounts110(t, s.DB)
	counts, origins, err = allTraitCounts(context.Background(), s.DB)
	if err != nil || counts["audio"]["DTS"] != 0 || counts["audio"]["Opus"] != 1 || origins["audio:DTS"] || !origins["audio:Opus"] {
		t.Fatalf("stale indexed update/delete: %v / %v / %v", counts, origins, err)
	}
}

func TestCatalogIndexPlanAvoidsTableJSONAndTemporaryGrouping110(t *testing.T) {
	s := testStore(t)
	rows, err := s.DB.Query("EXPLAIN QUERY PLAN " + catalogCountsQuery())
	if err != nil {
		t.Fatal(err)
	}
	used := false
	for rows.Next() {
		var id, parent, unused int
		var detail string
		if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
			t.Fatal(err)
		}
		used = used || strings.Contains(detail, catalogCountIndex)
		if strings.Contains(detail, "TEMP B-TREE") {
			t.Fatalf("catalog grouping spills to temporary B-tree: %s", detail)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	rows.Close()
	if !used {
		t.Fatal("catalog does not scan its expression index")
	}
	// SQLite can report USING INDEX instead of USING COVERING INDEX for expression
	// indexes. Verify the bytecode never reads a column from the files table cursor.
	var rootPage int
	if err := s.DB.QueryRow(`SELECT rootpage FROM sqlite_schema WHERE name='files'`).Scan(&rootPage); err != nil {
		t.Fatal(err)
	}
	rows, err = s.DB.Query("EXPLAIN " + catalogCountsQuery())
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	tableCursors := map[int]bool{}
	for rows.Next() {
		var addr, p1, p2, p3, p5 int
		var opcode string
		var p4, comment any
		if err := rows.Scan(&addr, &opcode, &p1, &p2, &p3, &p4, &p5, &comment); err != nil {
			t.Fatal(err)
		}
		if opcode == "OpenRead" && p2 == rootPage && p3 == 0 {
			tableCursors[p1] = true
		}
		if opcode == "Column" && tableCursors[p1] {
			t.Fatalf("catalog reads files table column %d instead of compact index", p2)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
}

func TestCatalogIndexEnsuredForExistingSchema15Store110(t *testing.T) {
	dir := t.TempDir()
	s, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.DB.Exec(`DROP INDEX ` + catalogCountIndex + `; CREATE INDEX files_catalog_counts ON files(` + catalogCountProjection() + `)`); err != nil {
		t.Fatal(err)
	}
	s.DB.Close()
	s, err = OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.DB.Close()
	var present int
	if err := s.DB.QueryRow(`SELECT count(*) FROM sqlite_schema WHERE type='index' AND name=?`, catalogCountIndex).Scan(&present); err != nil || present != 1 {
		t.Fatalf("schema15 did not acquire catalog index: %d, %v", present, err)
	}
	if err := s.DB.QueryRow(`SELECT count(*) FROM sqlite_schema WHERE type='index' AND name='files_catalog_counts'`).Scan(&present); err != nil || present != 0 {
		t.Fatalf("superseded unscoped index remains: %d, %v", present, err)
	}
}

func TestCatalogPartialIndexIncludesEmptyData110(t *testing.T) {
	s := testStore(t)
	if err := s.Replace("radarr-index", []File{sample(1, "Empty.1080p.x264.mkv")}, SyncStatus{}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec(`UPDATE files SET data=''`); err != nil {
		t.Fatal(err)
	}
	assertCatalogIndexCounts110(t, s.DB)
	counts, _, err := allTraitCounts(context.Background(), s.DB)
	if err != nil || counts["resolution"]["1080p"] != 1 || counts["codec"]["x264"] != 1 {
		t.Fatalf("empty data excluded by partial index: %v / %v", counts, err)
	}
}

func TestCatalogIndexReplacementRollsBackOnFailure110(t *testing.T) {
	s := testStore(t)
	if _, err := s.DB.Exec(`DROP INDEX ` + catalogCountIndex + `; CREATE INDEX files_catalog_counts ON files(` + catalogCountProjection() + `); CREATE TABLE ` + catalogCountIndex + `(value TEXT)`); err != nil {
		t.Fatal(err)
	}
	if err := ensureCatalogCountIndex(context.Background(), s.DB); err == nil {
		t.Fatal("index replacement unexpectedly succeeded despite conflicting table")
	}
	var present int
	if err := s.DB.QueryRow(`SELECT count(*) FROM sqlite_schema WHERE type='index' AND name='files_catalog_counts'`).Scan(&present); err != nil || present != 1 {
		t.Fatalf("failed replacement removed original index: %d, %v", present, err)
	}
	if _, err := s.DB.Exec(`DROP TABLE ` + catalogCountIndex); err != nil {
		t.Fatal(err)
	}
	if err := ensureCatalogCountIndex(context.Background(), s.DB); err != nil {
		t.Fatal(err)
	}
	assertCatalogIndexCounts110(t, s.DB)
}

func TestCatalogPartialIndexCannotHijackListPlans110(t *testing.T) {
	s := testStore(t)
	for _, service := range []string{"radarr", "sonarr"} {
		q := url.Values{"service": {service}, "resolution": {"1080p"}, "codec": {"x264"}}
		filter, args, err := s.scopedWhere(q)
		if err != nil {
			t.Fatal(err)
		}
		order, err := displayOrder(q)
		if err != nil {
			t.Fatal(err)
		}
		for _, query := range []string{
			`SELECT count(*) FROM files f WHERE ` + filter,
			`SELECT f.rowid FROM files f WHERE ` + filter + ` ORDER BY ` + order + ` LIMIT 100`,
			`SELECT f.rowid,f.service,f.media_id,f.season FROM files f WHERE ` + filter,
		} {
			rows, err := s.DB.Query("EXPLAIN QUERY PLAN "+query, args...)
			if err != nil {
				t.Fatal(err)
			}
			for rows.Next() {
				var id, parent, unused int
				var detail string
				if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
					t.Fatal(err)
				}
				if strings.Contains(detail, "files_catalog_counts") {
					t.Fatalf("catalog index selected by %s list: %s", service, detail)
				}
			}
			if err := rows.Err(); err != nil {
				t.Fatal(err)
			}
			rows.Close()
		}
		// The partial predicate must make the index ineligible, independently of
		// current cardinality/statistics and planner cost estimates.
		rows, err := s.DB.Query(`EXPLAIN QUERY PLAN SELECT f.rowid FROM files f INDEXED BY `+catalogCountIndex+` WHERE `+filter, args...)
		if err == nil {
			rows.Close()
			t.Fatal("non-catalog filter can access the catalog-only partial index")
		}
	}
}

func BenchmarkCatalogIndexWrites110(b *testing.B) {
	files := make([]File, 1000)
	for i := range files {
		files[i] = sample(i+1, fmt.Sprintf("Film.%04d.1080p.x264.BluRay.DTS.5.1.mkv", i))
	}
	for _, indexed := range []bool{false, true} {
		b.Run(fmt.Sprintf("index=%v", indexed), func(b *testing.B) {
			s, err := OpenStore(b.TempDir())
			if err != nil {
				b.Fatal(err)
			}
			defer s.DB.Close()
			if !indexed {
				if _, err := s.DB.Exec(`DROP INDEX ` + catalogCountIndex); err != nil {
					b.Fatal(err)
				}
			}
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if err := s.Replace("radarr-index", files, SyncStatus{}); err != nil {
					b.Fatal(err)
				}
			}
			b.ReportMetric(float64(len(files)), "files/op")
		})
	}
}
