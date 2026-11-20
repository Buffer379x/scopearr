package app

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http/httptest"
	"os"
	"reflect"
	"slices"
	"strings"
	"testing"
)

const unknownSettingWarning200 = "Unknown setting {setting} value {value} was reset to the default"

// steadySettings200 returns stored settings that NewServer loads without the
// one-time layout migration, so a later start must not write them again.
func steadySettings200(t *testing.T) Settings {
	t.Helper()
	s := testStore(t)
	if err := s.Put("settings", DefaultSettings()); err != nil {
		t.Fatal(err)
	}
	server := startServer200(t, s)
	server.Sync.Shutdown()
	var cfg Settings
	if err := s.Get("settings", &cfg); err != nil {
		t.Fatal(err)
	}
	return cfg
}

func cloneSettings200(t *testing.T, cfg Settings) Settings {
	t.Helper()
	b, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	var out Settings
	if err = json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func startServer200(t *testing.T, s *Store) *Server {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	server, err := NewServer(ctx, s, nil, "test")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Sync.Shutdown)
	return server
}

func rawSettings200(t *testing.T, s *Store) string {
	t.Helper()
	var raw string
	if err := s.DB.QueryRow("SELECT value FROM kv WHERE key='settings'").Scan(&raw); err != nil {
		t.Fatal(err)
	}
	return raw
}

// resetWarnings200 lists setting=value for every startup reset warning.
func resetWarnings200(t *testing.T, s *Store) []string {
	t.Helper()
	s.Events.Flush()
	rows, err := s.DB.Query("SELECT level,source,json_extract(params,'$.setting'),json_extract(params,'$.value'),repeat FROM event_log WHERE message=? ORDER BY id", unknownSettingWarning200)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var level, source, setting, value string
		var repeat int
		if err = rows.Scan(&level, &source, &setting, &value, &repeat); err != nil {
			t.Fatal(err)
		}
		if level != "warning" || source != "system" {
			t.Fatal("reset warning level or source", level, source)
		}
		for range repeat {
			out = append(out, setting+"="+value)
		}
	}
	return out
}

func withValue200(list []string, at int, value string) []string {
	return slices.Insert(slices.Clone(list), at, value)
}

func TestStartupTolerance200(t *testing.T) {
	steady := steadySettings200(t)

	t.Run("unknown values start with defaults", func(t *testing.T) {
		placementWithoutKind := slices.DeleteFunc(defaultPlacementColumns(), func(k string) bool { return k == "kind" })
		for _, c := range []struct {
			name   string
			mutate func(*Settings)
			check  func(Settings) bool
			want   string
		}{
			{"interface theme", func(cfg *Settings) { cfg.InterfaceTheme = "aurora" }, func(got Settings) bool { return got.InterfaceTheme == "default" }, "interfaceTheme=aurora"},
			{"dashboard widgets", func(cfg *Settings) {
				cfg.Widgets.Order = withValue200(defaultDashboardOrder(), 2, "hdr-future")
				cfg.Widgets.Visible = withValue200(defaultDashboardOrder(), 6, "hdr-future")
			}, func(got Settings) bool {
				return reflect.DeepEqual(got.Widgets.Order, defaultDashboardOrder()) && reflect.DeepEqual(got.Widgets.Visible, defaultDashboardOrder())
			}, "widgets=hdr-future"},
			{"library columns", func(cfg *Settings) {
				cfg.ColumnOrder["radarr"] = withValue200(defaultColumnOrder()["radarr"], 11, "tracks")
				cfg.VisibleColumns["radarr"] = withValue200(defaultVisibleColumns()["radarr"], 3, "tracks")
			}, func(got Settings) bool {
				return reflect.DeepEqual(got.ColumnOrder, defaultColumnOrder()) && reflect.DeepEqual(got.VisibleColumns, defaultVisibleColumns()) && len(got.ColumnOrder["radarr"]) == len(libraryColumns)
			}, "columns.radarr=tracks"},
			{"library column service", func(cfg *Settings) { cfg.VisibleColumns["lidarr"] = []string{"title"} }, func(got Settings) bool {
				return reflect.DeepEqual(got.VisibleColumns, defaultVisibleColumns())
			}, "columns=lidarr"},
			{"info actions", func(cfg *Settings) { cfg.ListInfoOrder = withValue200(cfg.ListInfoOrder, 1, "preview") }, func(got Settings) bool {
				return reflect.DeepEqual(got.ListInfoOrder, defaultListInfoOrder()) && reflect.DeepEqual(got.ListInfoVisible, defaultListInfoOrder())
			}, "listInfo=preview"},
			{"placement columns", func(cfg *Settings) { cfg.PlacementColumnOrder = withValue200(defaultPlacementColumns(), 4, "eta") }, func(got Settings) bool {
				return reflect.DeepEqual(got.PlacementColumnOrder, defaultPlacementColumns()) && reflect.DeepEqual(got.PlacementVisibleColumns, defaultPlacementColumns())
			}, "placementColumns=eta"},
			{"placement order regains a missing column", func(cfg *Settings) {
				cfg.PlacementColumnOrder = withValue200(placementWithoutKind, 4, "eta")
			}, func(got Settings) bool {
				return reflect.DeepEqual(got.PlacementColumnOrder, append(slices.Clone(placementWithoutKind), "kind"))
			}, "placementColumns=eta"},
			{"file check columns", func(cfg *Settings) { cfg.FileCheckVisibleColumns = withValue200(defaultFileCheckColumns(), 5, "hash") }, func(got Settings) bool {
				return reflect.DeepEqual(got.FileCheckVisibleColumns, defaultFileCheckColumns()) && reflect.DeepEqual(got.FileCheckColumnOrder, defaultFileCheckColumns())
			}, "filecheckColumns=hash"},
			{"file check order keeps selection first", func(cfg *Settings) {
				cfg.FileCheckColumnOrder = withValue200(slices.DeleteFunc(defaultFileCheckColumns(), func(k string) bool { return k == "select" }), 0, "hash")
			}, func(got Settings) bool {
				return reflect.DeepEqual(got.FileCheckColumnOrder, defaultFileCheckColumns())
			}, "filecheckColumns=hash"},
		} {
			t.Run(c.name, func(t *testing.T) {
				s := testStore(t)
				cfg := cloneSettings200(t, steady)
				c.mutate(&cfg)
				if err := s.Put("settings", cfg); err != nil {
					t.Fatal(err)
				}
				before := rawSettings200(t, s)
				value := strings.SplitN(c.want, "=", 2)[1]
				if !strings.Contains(before, `"`+value+`"`) {
					t.Fatal("fixture lacks the unknown value", before)
				}
				server := startServer200(t, s)
				if got := server.Config(); !c.check(got) {
					t.Fatalf("not reset: %+v", got)
				}
				if got := resetWarnings200(t, s); !reflect.DeepEqual(got, []string{c.want}) {
					t.Fatal("warnings", got)
				}
				if after := rawSettings200(t, s); after != before {
					t.Fatal("startup rewrote the stored settings", after)
				}
				if files := backups200(t, s.Dir); len(files) != 0 {
					t.Fatal("startup made a backup", files)
				}
			})
		}
	})

	t.Run("one warning per value and start, also in the system log", func(t *testing.T) {
		s := testStore(t)
		cfg := cloneSettings200(t, steady)
		cfg.InterfaceTheme = "aurora"
		cfg.Widgets.Order = withValue200(defaultDashboardOrder(), 0, "hdr-future")
		cfg.Widgets.Visible = slices.Concat([]string{"hdr-future", "hdr-future"}, defaultDashboardOrder())
		if err := s.Put("settings", cfg); err != nil {
			t.Fatal(err)
		}
		var buf bytes.Buffer
		log.SetOutput(&buf)
		server := startServer200(t, s)
		log.SetOutput(os.Stderr)
		lines := strings.Count(buf.String(), "Unknown setting interfaceTheme value aurora was reset to the default")
		widgetLines := strings.Count(buf.String(), "Unknown setting widgets value hdr-future was reset to the default")
		if lines != 1 || widgetLines != 1 {
			t.Fatal("log lines", lines, widgetLines, buf.String())
		}
		for range 3 {
			w := httptest.NewRecorder()
			server.settingsHTTP(w, httptest.NewRequest("GET", "/api/settings", nil))
			if w.Code != 200 || strings.Contains(w.Body.String(), "aurora") || strings.Contains(w.Body.String(), "hdr-future") {
				t.Fatal(w.Code, w.Body)
			}
		}
		if got := resetWarnings200(t, s); !reflect.DeepEqual(got, []string{"interfaceTheme=aurora", "widgets=hdr-future"}) {
			t.Fatal("warnings", got)
		}
	})

	t.Run("valid settings start without warnings", func(t *testing.T) {
		for name, stored := range map[string]any{"defaults": DefaultSettings(), "saved": steady} {
			t.Run(name, func(t *testing.T) {
				s := testStore(t)
				if err := s.Put("settings", stored); err != nil {
					t.Fatal(err)
				}
				before := rawSettings200(t, s)
				startServer200(t, s)
				if got := resetWarnings200(t, s); len(got) != 0 {
					t.Fatal(got)
				}
				if name == "saved" && rawSettings200(t, s) != before {
					t.Fatal("steady settings were rewritten")
				}
			})
		}
		s := testStore(t)
		startServer200(t, s)
		if got := resetWarnings200(t, s); len(got) != 0 {
			t.Fatal("fresh store", got)
		}
	})

	t.Run("legacy layouts migrate as before", func(t *testing.T) {
		legacy := func() Settings {
			cfg := cloneSettings200(t, steady)
			cfg.ColumnOrder = map[string][]string{"radarr": {"title", "year", "resolution", "codec", "source", "size", "hdr", "bitDepth", "language", "channels"}}
			cfg.VisibleColumns = map[string][]string{"radarr": {"title", "language", "size"}}
			cfg.ListInfoOrder = []string{"details", "link", "metadata", "recognition"}
			cfg.ListInfoVisible = []string{"link", "recognition"}
			cfg.MuxInfo = nil
			return cfg
		}
		// The expected layout is what the unchanged normalizer makes of it.
		want := legacy()
		if err := normalizeVisibleColumns(&want); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(want.VisibleColumns["radarr"], []string{"title", "audio", "size"}) || !containsColumn(want.ColumnOrder["radarr"], "audio") || containsColumn(want.ColumnOrder["radarr"], "language") {
			t.Fatal("fixture no longer exercises the audio migration", want.VisibleColumns, want.ColumnOrder)
		}
		for _, c := range []struct {
			name     string
			mutate   func(*Settings)
			warnings []string
		}{
			{"known legacy names", func(*Settings) {}, []string{}},
			{"with an unknown column", func(cfg *Settings) {
				cfg.ColumnOrder["radarr"] = withValue200(cfg.ColumnOrder["radarr"], 3, "tracks")
				cfg.VisibleColumns["radarr"] = append(cfg.VisibleColumns["radarr"], "tracks")
			}, []string{"columns.radarr=tracks"}},
		} {
			t.Run(c.name, func(t *testing.T) {
				s := testStore(t)
				cfg := legacy()
				c.mutate(&cfg)
				if err := s.Put("settings", cfg); err != nil {
					t.Fatal(err)
				}
				got := startServer200(t, s).Config()
				for _, field := range []struct {
					name      string
					got, want any
				}{
					{"visibleColumns", got.VisibleColumns, want.VisibleColumns},
					{"columnOrder", got.ColumnOrder, want.ColumnOrder},
					{"listInfoOrder", got.ListInfoOrder, want.ListInfoOrder},
					{"listInfoVisible", got.ListInfoVisible, want.ListInfoVisible},
				} {
					if !reflect.DeepEqual(field.got, field.want) {
						t.Fatalf("%s: got %v want %v", field.name, field.got, field.want)
					}
				}
				if warnings := resetWarnings200(t, s); !reflect.DeepEqual(warnings, c.warnings) {
					t.Fatal("warnings", warnings)
				}
			})
		}
	})

	t.Run("a failed layout persist logs no reset", func(t *testing.T) {
		// The reset warnings follow the one-time layout persist: a start that
		// fails there must not report resets the next start reports again.
		s := testStore(t)
		cfg := cloneSettings200(t, steady)
		cfg.ColumnOrder = map[string][]string{"radarr": {"title", "year", "tracks", "resolution", "codec", "source", "size", "hdr", "bitDepth", "language", "channels"}}
		cfg.VisibleColumns = map[string][]string{"radarr": {"title", "language", "size", "tracks"}}
		cfg.ListInfoOrder = []string{"details", "link", "metadata", "recognition"}
		cfg.ListInfoVisible = []string{"link", "recognition"}
		cfg.MuxInfo = nil
		if err := s.Put("settings", cfg); err != nil {
			t.Fatal(err)
		}
		before := rawSettings200(t, s)
		if _, err := s.DB.Exec("CREATE TRIGGER block_settings_persist BEFORE UPDATE ON kv WHEN NEW.key='settings' BEGIN SELECT RAISE(ABORT,'synthetic persist failure'); END"); err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		server, err := NewServer(ctx, s, nil, "test")
		if server != nil {
			server.Sync.Shutdown()
		}
		if err == nil || !strings.Contains(err.Error(), "synthetic persist failure") {
			t.Fatal("the persist must fail", err)
		}
		if rawSettings200(t, s) != before {
			t.Fatal("failed start changed the stored settings")
		}
		if got := resetWarnings200(t, s); len(got) != 0 {
			t.Fatal("failed persist logged a reset", got)
		}
		if _, err = s.DB.Exec("DROP TRIGGER block_settings_persist"); err != nil {
			t.Fatal(err)
		}
		startServer200(t, s)
		if got := resetWarnings200(t, s); !reflect.DeepEqual(got, []string{"columns.radarr=tracks"}) {
			t.Fatal("warnings after the successful persist", got)
		}
	})

	t.Run("saving stays strict", func(t *testing.T) {
		s := testStore(t)
		cfg := cloneSettings200(t, steady)
		cfg.InterfaceTheme = "aurora"
		if err := s.Put("settings", cfg); err != nil {
			t.Fatal(err)
		}
		server := startServer200(t, s)
		get := httptest.NewRecorder()
		server.settingsHTTP(get, httptest.NewRequest("GET", "/api/settings", nil))
		put := func(change func(map[string]any)) *httptest.ResponseRecorder {
			t.Helper()
			var body map[string]any
			if err := json.Unmarshal(get.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			change(body)
			b, _ := json.Marshal(body)
			w := httptest.NewRecorder()
			server.settingsHTTP(w, httptest.NewRequest("PUT", "/api/settings", bytes.NewReader(b)))
			return w
		}
		for _, c := range []struct {
			name   string
			change func(map[string]any)
			want   string
		}{
			{"theme", func(b map[string]any) { b["interfaceTheme"] = "aurora" }, "Invalid interface theme"},
			{"visible column", func(b map[string]any) {
				b["visibleColumns"].(map[string]any)["radarr"] = []string{"title", "tracks"}
			}, "Invalid column selection"},
			{"column order", func(b map[string]any) {
				b["columnOrder"].(map[string]any)["radarr"] = withValue200(defaultColumnOrder()["radarr"], 0, "tracks")
			}, "Column order must include all columns"},
			{"widget", func(b map[string]any) {
				b["widgets"].(map[string]any)["visible"] = []string{"hdr-future"}
			}, "Invalid dashboard widget selection"},
		} {
			before := rawSettings200(t, s)
			w := put(c.change)
			var failure struct{ Error string }
			json.Unmarshal(w.Body.Bytes(), &failure)
			if w.Code != 400 || failure.Error != c.want {
				t.Fatal(c.name, w.Code, w.Body)
			}
			if rawSettings200(t, s) != before || server.Config().InterfaceTheme != "default" {
				t.Fatal(c.name, "rejected save changed settings")
			}
		}
		// Saving the reset settings stores the defaults and ends the warning.
		if w := put(func(map[string]any) {}); w.Code != 200 {
			t.Fatal(w.Code, w.Body)
		}
		var stored Settings
		if err := s.Get("settings", &stored); err != nil || stored.InterfaceTheme != "default" {
			t.Fatal(stored.InterfaceTheme, err)
		}
		server.Sync.Shutdown()
		startServer200(t, s)
		if got := resetWarnings200(t, s); !reflect.DeepEqual(got, []string{"interfaceTheme=aurora"}) {
			t.Fatal("warnings after saving", got)
		}
	})

	t.Run("other invalid settings still stop the start", func(t *testing.T) {
		for _, c := range []struct {
			name  string
			raw   func() string
			error string
		}{
			{"corrupt JSON", func() string { return `{"interfaceTheme":"aurora"` }, "Could not load settings: unexpected end of JSON input"},
			{"warning color", func() string {
				cfg := cloneSettings200(t, steady)
				cfg.InterfaceTheme = "aurora"
				cfg.WarningColors["metadata"] = "red"
				b, _ := json.Marshal(settingsForStorage(cfg))
				return string(b)
			}, "Invalid warning color"},
			{"storage color", func() string {
				cfg := cloneSettings200(t, steady)
				cfg.Widgets.Colors["used"] = "blue"
				b, _ := json.Marshal(settingsForStorage(cfg))
				return string(b)
			}, "Invalid storage color"},
			{"file check type", func() string {
				cfg := cloneSettings200(t, steady)
				cfg.FileCheck.Kinds = append(cfg.FileCheck.Kinds, "checksum")
				b, _ := json.Marshal(settingsForStorage(cfg))
				return string(b)
			}, "Unknown file check"},
			{"title column hidden", func() string {
				cfg := cloneSettings200(t, steady)
				cfg.VisibleColumns["radarr"] = []string{"size"}
				b, _ := json.Marshal(settingsForStorage(cfg))
				return string(b)
			}, "Title or episode must remain visible"},
		} {
			t.Run(c.name, func(t *testing.T) {
				s := testStore(t)
				raw := c.raw()
				if _, err := s.DB.Exec("INSERT INTO kv(key,value) VALUES('settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", raw); err != nil {
					t.Fatal(err)
				}
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				server, err := NewServer(ctx, s, nil, "test")
				if server != nil {
					server.Sync.Shutdown()
				}
				if err == nil || err.Error() != c.error {
					t.Fatalf("got %v want %s", err, c.error)
				}
				if rawSettings200(t, s) != raw {
					t.Fatal("failed start changed the stored settings")
				}
				if got := resetWarnings200(t, s); len(got) != 0 {
					t.Fatal("failed start logged a reset", got)
				}
			})
		}
	})
}
