import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./helpers/component-harness.mjs";

// The dashboard's cards as data (Phase 5a, task 2): KPI targets,
// distribution rows, the widget split and the storage ring.

let locale = "en";
const model = loadSource("dashboard-model.ts", {
  modules: {
    "./i18n": { getLocale: () => locale, t: (key) => key },
    "./dashboard-widgets": loadSource("dashboard-widgets.ts"),
  },
});
// Values from the module's own realm, compared as plain data.
const plain = (value) => JSON.parse(JSON.stringify(value));

// rc.4 R1: TV series opens the collapsed series view, Episodes the
// expanded one, and Media files (both libraries) opens nothing.
test("KPI cards lead to their unfiltered lists", () => {
  const statistics = { movies: 120, series: 8, episodes: 300, files: 420 };
  assert.deepEqual(plain(model.kpiModels(statistics)), [
    {
      key: "movies",
      label: "Movies",
      detail: "with existing files",
      value: 120,
      hero: false,
      target: { view: "library", service: "radarr", query: "" },
    },
    {
      key: "series",
      label: "TV series",
      detail: "with existing episodes",
      value: 8,
      hero: false,
      target: {
        view: "library",
        service: "sonarr",
        query: "",
        seriesView: true,
      },
    },
    {
      key: "episodes",
      label: "Episodes",
      detail: "including specials and multi-episode files",
      value: 300,
      hero: false,
      target: {
        view: "library",
        service: "sonarr",
        query: "",
        seriesView: false,
      },
    },
    {
      key: "files",
      label: "Media files",
      detail: "movie and episode files",
      value: 420,
      hero: true,
      target: null,
    },
  ]);
  // Zero is a value: only missing data is null.
  assert.deepEqual(
    plain(model.kpiModels({ movies: 0, series: 0, episodes: 0, files: 0 })).map(
      (kpi) => kpi.value,
    ),
    [0, 0, 0, 0],
  );
  // Without data the cards stay, with no value yet.
  assert.deepEqual(
    plain(model.kpiModels(null)).map((kpi) => [kpi.key, kpi.value, kpi.hero]),
    [
      ["movies", null, false],
      ["series", null, false],
      ["episodes", null, false],
      ["files", null, true],
    ],
  );
});

test("distribution rows show five, then all", () => {
  assert.equal(model.DISTRIBUTION_ROWS, 5);
  const buckets = [
    { value: "x264", count: 5 },
    { value: "", count: 2 },
    { value: "x265", count: 20 },
    { value: "AV1", count: 5 },
    { value: "VC-1", count: 1 },
    { value: "MPEG-2", count: 3 },
    { value: "HEVC", count: 4 },
  ];
  // Largest first, ties by value; the share is of the given total (the
  // audio card counts files, not values).
  const all = [
    { value: "x265", count: 20, share: 40, unknown: false },
    { value: "AV1", count: 5, share: 10, unknown: false },
    { value: "x264", count: 5, share: 10, unknown: false },
    { value: "HEVC", count: 4, share: 8, unknown: false },
    { value: "MPEG-2", count: 3, share: 6, unknown: false },
    { value: "", count: 2, share: 4, unknown: true },
    { value: "VC-1", count: 1, share: 2, unknown: false },
  ];
  assert.deepEqual(plain(model.distributionRows(buckets, 50, false)), {
    rows: all.slice(0, 5),
    hidden: 2,
  });
  assert.deepEqual(plain(model.distributionRows(buckets, 50, true)), {
    rows: all,
    hidden: 2,
  });
  assert.deepEqual(
    plain(
      model.distributionRows(
        [
          { value: "__unknown__", count: 1 },
          { value: "DTS", count: 3 },
        ],
        4,
        false,
      ),
    ),
    {
      rows: [
        { value: "DTS", count: 3, share: 75, unknown: false },
        { value: "__unknown__", count: 1, share: 25, unknown: true },
      ],
      hidden: 0,
    },
  );
  // Five values need no More; the sixth is the first hidden one.
  const values = (n) =>
    Array.from({ length: n }, (_, i) => ({ value: "v" + i, count: 10 - i }));
  assert.deepEqual(
    [
      plain(model.distributionRows(values(5), 50, false)),
      plain(model.distributionRows(values(6), 50, false)),
      plain(model.distributionRows(values(6), 50, true)),
    ].map(({ rows, hidden }) => [rows.length, hidden]),
    [
      [5, 0],
      [5, 1],
      [6, 1],
    ],
  );
  assert.deepEqual(plain(model.distributionRows([], 0, false)), {
    rows: [],
    hidden: 0,
  });
  assert.deepEqual(
    plain(model.distributionRows([{ value: "DTS", count: 3 }], 0, false)).rows,
    [{ value: "DTS", count: 3, share: 0, unknown: false }],
  );
  // The input stays as it was.
  assert.equal(buckets[0].value, "x264");
});

test("the storage widget leaves the grid", () => {
  assert.deepEqual(
    plain(
      model.dashboardWidgets(
        ["storage", "language", "resolution", "codec", "source", "audio"],
        ["codec", "storage", "language", "audio"],
      ),
    ),
    { distributions: ["language", "codec", "audio"], storage: true },
  );
  assert.deepEqual(
    plain(model.dashboardWidgets(["resolution", "storage"], ["resolution"])),
    { distributions: ["resolution"], storage: false },
  );
  // Values the dashboard does not know make no card.
  assert.deepEqual(
    plain(model.dashboardWidgets(["hdr", "source"], ["hdr", "source"])),
    { distributions: ["source"], storage: false },
  );
  assert.deepEqual(plain(model.dashboardWidgets([], [])), {
    distributions: [],
    storage: false,
  });
});

test("the storage ring needs a total", () => {
  const area = {
    key: "radarr:/movies",
    label: "radarr · Movies",
    paths: ["/movies"],
    total: 4e12,
    free: 3e12,
    used: 1e12,
    error: "",
  };
  assert.equal(model.storageRing(undefined), null);
  assert.equal(
    model.storageRing({ ...area, total: 0, used: 0, free: 0 }),
    null,
  );
  assert.deepEqual(plain(model.storageRing(area)), {
    used: 1e12,
    free: 3e12,
    total: 4e12,
    share: 25,
  });
  assert.equal(model.storageRing({ ...area, used: 5e12 }).share, 100);
});

test("storage bytes read as before", () => {
  // The strings StorageWidget showed in 1.7.0.
  locale = "en";
  assert.equal(model.storageBytes(0), "0 GB");
  assert.equal(model.storageBytes(123.44e9), "123.4 GB");
  assert.equal(model.storageBytes(999.96e9), "1,000 GB");
  assert.equal(model.storageBytes(1e12), "1 TB");
  assert.equal(model.storageBytes(1.5e12), "1.5 TB");
  locale = "de";
  assert.equal(model.storageBytes(1.5e12), "1,5 TB");
  assert.equal(model.storageBytes(1.234e12), "1,2 TB");
  assert.equal(model.storageBytes(12345e12), "12.345 TB");
  locale = "en";
});
