package app

import (
	"context"
	"database/sql"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

type catalogTableScan struct{ db *sql.DB }

func (q catalogTableScan) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return q.db.QueryContext(ctx, strings.Replace(query, " INDEXED BY files_catalog_counts", " NOT INDEXED", 1), args...)
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
		used = used || strings.Contains(detail, "files_catalog_counts")
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
	if _, err = s.DB.Exec(`DROP INDEX files_catalog_counts`); err != nil {
		t.Fatal(err)
	}
	s.DB.Close()
	s, err = OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.DB.Close()
	var present int
	if err := s.DB.QueryRow(`SELECT count(*) FROM sqlite_schema WHERE type='index' AND name='files_catalog_counts'`).Scan(&present); err != nil || present != 1 {
		t.Fatalf("schema15 did not acquire catalog index: %d, %v", present, err)
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
				if _, err := s.DB.Exec(`DROP INDEX files_catalog_counts`); err != nil {
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
