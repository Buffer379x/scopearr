import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./helpers/component-harness.mjs";

// The tool pages as data (Phase 5b, task 2; docs/STYLEGUIDE.md, Part 1,
// 10.2, 10.5 and 11.1): KPI cards, disk cards, the drawer's draft and live
// count path, the chips and the preset select.

const spec = loadSource("mux-spec.ts", {
  modules: { "./languages.ts": { audioLanguage: () => null } },
});
const filters = loadSource("tool-filters.ts");
const list = loadSource("tool-list.ts", {
  modules: {
    "./i18n": { t: (key) => key },
    "./mux-spec": spec,
    "./tool-filters": filters,
  },
});
// Values from the module's own realm, compared as plain data.
const plain = (value) => JSON.parse(JSON.stringify(value));

const ok = { readable: true, writable: true };
const job = (id, status, sourceName = "Job " + id + ".mkv", check = ok) => ({
  id,
  status,
  sourceName,
  check,
});
const jobs = [
  job(1, "running", "Dune (2021).mkv"),
  job(2, "queued"),
  job(3, "failed"),
  job(4, "succeeded"),
  // Ready with a failed check: its effective status is warning.
  job(5, "ready", "Arrival.mkv", { readable: false, writable: true }),
];

test("KPI cards count what their filter shows", () => {
  assert.deepEqual(
    [...list.MUX_OPEN_STATUSES],
    [
      "warning",
      "draft",
      "ready",
      "queued",
      "running",
      "failed",
      "needs_review",
      "needs_attention",
    ],
  );
  const kpis = plain(list.muxKpis(jobs));
  assert.deepEqual(kpis, [
    {
      key: "open",
      label: "Open",
      value: 4,
      hero: true,
      statuses: [...list.MUX_OPEN_STATUSES],
    },
    {
      key: "running",
      label: "Running",
      value: 1,
      hero: false,
      statuses: ["running"],
    },
    {
      key: "failed",
      label: "Failed",
      value: 1,
      hero: false,
      statuses: ["failed"],
    },
    {
      key: "succeeded",
      label: "Successful",
      value: 1,
      hero: false,
      statuses: ["succeeded"],
    },
  ]);
  // Each value is the number of rows its filter shows.
  for (const kpi of list.muxKpis(jobs))
    assert.equal(
      kpi.value,
      spec.muxFilterJobs(jobs, { statuses: [...kpi.statuses], q: "" }).length,
      kpi.key,
    );
  // Before the data every value is null; no jobs count 0.
  assert.deepEqual(plain(list.muxKpis(null).map((kpi) => kpi.value)), [
    null,
    null,
    null,
    null,
  ]);
  assert.deepEqual(
    plain(list.muxKpis([]).map((kpi) => kpi.value)),
    [0, 0, 0, 0],
  );
});

test("a KPI press filters and a second press clears", () => {
  const [open, running, failed] = list.muxKpis(jobs);
  assert.deepEqual(plain(list.kpiChoice([], failed)), ["failed"]);
  assert.deepEqual(plain(list.kpiChoice(["failed"], failed)), []);
  assert.deepEqual(plain(list.kpiChoice(["failed", "running"], failed)), [
    "failed",
  ]);
  assert.deepEqual(plain(list.kpiChoice(["running"], failed)), ["failed"]);
  // Pressed means exactly the card's set, in any order.
  assert.equal(list.kpiPressed(["failed"], failed), true);
  assert.equal(list.kpiPressed(["running", "failed"], failed), false);
  assert.equal(list.kpiPressed([], failed), false);
  assert.equal(list.kpiPressed(["running"], running), true);
  assert.equal(
    list.kpiPressed([...list.MUX_OPEN_STATUSES].reverse(), open),
    true,
  );
  assert.equal(list.kpiPressed(list.MUX_OPEN_STATUSES.slice(1), open), false);
  assert.deepEqual(
    plain(list.kpiChoice([...list.MUX_OPEN_STATUSES], open)),
    [],
  );
  // A hero without statuses filters nothing and is never pressed.
  const [checked] = list.fileCheckKpis(null);
  assert.equal(list.kpiPressed([], checked), false);
  assert.deepEqual(plain(list.kpiChoice(["open"], checked)), ["open"]);
});

test("file check KPIs read the report and the counts", () => {
  const activity = {
    report: { checked: 1284 },
    counts: { open: 12, fixed: 30, manual: 4, failed: 2, "kind:junk": 7 },
  };
  assert.deepEqual(plain(list.fileCheckKpis(activity)), [
    {
      key: "checked",
      label: "Items checked",
      value: 1284,
      hero: true,
      statuses: null,
    },
    { key: "open", label: "Open", value: 12, hero: false, statuses: ["open"] },
    {
      key: "fixed",
      label: "Fixed",
      value: 30,
      hero: false,
      statuses: ["fixed"],
    },
    {
      key: "manual",
      label: "Manual",
      value: 4,
      hero: false,
      statuses: ["manual"],
    },
  ]);
  // Without a report the hero has no value; a missing count is 0.
  assert.deepEqual(
    plain(list.fileCheckKpis({ counts: { open: 3 } }).map((kpi) => kpi.value)),
    [null, 3, 0, 0],
  );
  assert.deepEqual(plain(list.fileCheckKpis(null).map((kpi) => kpi.value)), [
    null,
    null,
    null,
    null,
  ]);
});

test("disk cards read usage, pools, the target and standby", () => {
  assert.equal(list.DISK_PLACEHOLDERS, 3);
  const disks = [
    { name: "cache", kind: "pool", total: 1e12, free: 4e11 },
    { name: "disk10", kind: "array", total: 4e12, free: 4e12 },
    {
      name: "disk1",
      kind: "array",
      total: 8e12,
      free: 9e11,
      standby: true,
    },
    { name: "disk2", kind: "array", total: 8e12, free: 2e12, standby: false },
    { name: "apps", kind: "pool", total: 0, free: 0 },
  ];
  const items = [
    { target: "disk1", jobStatus: "running" },
    { target: "disk2", jobStatus: "succeeded" },
    { target: "cache", jobStatus: "" },
    { target: "disk10", jobStatus: "queued" },
  ];
  const cards = plain(list.diskCardModels(disks, items));
  // The order of discoverDisks: the array by number, then the pools.
  assert.deepEqual(
    cards.map((card) => card.name),
    ["disk1", "disk2", "disk10", "apps", "cache"],
  );
  assert.deepEqual(cards[0], {
    name: "disk1",
    pool: false,
    used: 7.1e12,
    free: 9e11,
    total: 8e12,
    share: 88.75,
    target: true,
    standby: true,
  });
  assert.deepEqual(
    cards.map((card) => [card.name, card.target, card.standby, card.pool]),
    [
      ["disk1", true, true, false],
      ["disk2", false, false, false],
      ["disk10", true, null, false],
      ["apps", false, null, true],
      ["cache", false, null, true],
    ],
  );
  assert.equal(cards[2].share, 0);
  assert.equal(cards[3].share, 0, "no total, no share");
  assert.equal(cards[4].share, 60);
  assert.deepEqual(plain(list.diskCardModels([], items)), []);
});

test("tool match counts ask for one item", () => {
  const draft = {
    statuses: ["split"],
    kinds: [],
    targets: [],
    shares: ["movies"],
  };
  assert.equal(
    list.toolCountPath("placement", "Dune", draft),
    "placement/items?q=Dune&status=split&share=movies&limit=1",
  );
  assert.equal(
    list.toolCountPath("placement", "", {
      statuses: ["several", "conflict"],
      kinds: ["small_files"],
      targets: ["disk1"],
      shares: ["movies", "tv"],
    }),
    "placement/items?q=&status=several&status=conflict&target=disk1&kind=small_files&share=movies&share=tv&limit=1",
  );
  // Files & permissions asks filecheck/items, without a target (its list
  // has none), and never with sort, dir or offset.
  assert.equal(
    list.toolCountPath("files", "", {
      statuses: ["open"],
      kinds: ["junk"],
      targets: ["disk1"],
      shares: ["tv"],
    }),
    "filecheck/items?q=&status=open&kind=junk&share=tv&limit=1",
  );
  assert.equal(
    list.toolCountPath("files", "a b", {
      statuses: [],
      kinds: [],
      targets: [],
      shares: [],
    }),
    "filecheck/items?q=a+b&limit=1",
  );
});

test("mux drafts count locally", () => {
  assert.equal(list.muxDraftCount(jobs, "", { statuses: ["failed"] }), 1);
  assert.equal(list.muxDraftCount(jobs, "", { statuses: [] }), 5);
  assert.equal(list.muxDraftCount(jobs, "dune", { statuses: [] }), 1);
  assert.equal(list.muxDraftCount(jobs, "DUNE", { statuses: ["running"] }), 1);
  assert.equal(list.muxDraftCount(jobs, "dune", { statuses: ["failed"] }), 0);
  // The effective status counts: the ready job with a failed check.
  assert.equal(list.muxDraftCount(jobs, "", { statuses: ["ready"] }), 0);
  assert.equal(list.muxDraftCount(jobs, "", { statuses: ["warning"] }), 1);
  // The draft starts from the applied filters and the shares, as copies.
  const applied = {
    statuses: ["failed"],
    kinds: ["junk"],
    targets: ["disk1"],
    q: "dune",
  };
  const shares = ["tv"];
  const draft = list.draftOf(applied, shares);
  assert.deepEqual(plain(draft), {
    statuses: ["failed"],
    kinds: ["junk"],
    targets: ["disk1"],
    shares: ["tv"],
  });
  draft.statuses.push("running");
  draft.shares.push("movies");
  assert.deepEqual(applied.statuses, ["failed"]);
  assert.deepEqual(shares, ["tv"]);
});

test("tool chips keep the 1.7.0 labels and order", () => {
  // The chips of Disk placement as DiskPlacementPage builds them (Kind,
  // Share, Status, Target, Search), through chipRow.
  const removed = [];
  const chips = [
    ...filters.filterChips(
      "Kind",
      [
        { value: "small_files", label: "Small files" },
        { value: "media_files", label: "Media files" },
      ],
      ["small_files"],
      (value) => removed.push("kind:" + value),
    ),
    ...filters.filterChips(
      "Share",
      [{ value: "movies", label: "movies" }],
      ["movies"],
      (value) => removed.push("share:" + value),
    ),
    ...filters.filterChips(
      "Status",
      [{ value: "several", label: "Several disks" }],
      ["several"],
      (value) => removed.push("status:" + value),
    ),
    ...filters.filterChips(
      "Target",
      [{ value: "disk1", label: "disk1" }],
      ["disk1"],
      (value) => removed.push("target:" + value),
    ),
    { key: "q", label: "Search: Dune", remove: () => removed.push("q") },
  ];
  const row = filters.chipRow(chips);
  assert.deepEqual(
    row.map((chip) => chip.label),
    [
      "Kind: Small files",
      "Share: movies",
      "Status: Several disks",
      "Target: disk1",
      "Search: Dune",
    ],
  );
  assert.deepEqual(
    row.map((chip) => chip.key),
    ["Kind:small_files", "Share:movies", "Status:several", "Target:disk1", "q"],
  );
  assert.ok(row.every((chip) => chip.excluded === false));
  for (const chip of row) chip.remove();
  assert.deepEqual(removed, [
    "kind:small_files",
    "share:movies",
    "status:several",
    "target:disk1",
    "q",
  ]);
  assert.deepEqual(plain(filters.chipRow([])), []);
});

test("the tool preset select shows Custom selection only for unknown filters", () => {
  const presets = [
    { id: 4, name: "Split movies", query: "status=several&share=movies" },
    { id: 9, name: "Conflicts", query: "status=conflict" },
  ];
  const options = [
    { value: "all", label: "All items" },
    { value: "4", label: "Split movies" },
    { value: "9", label: "Conflicts" },
  ];
  // No filter: the tool's All entry.
  assert.deepEqual(
    plain(list.toolPresetChoice("All items", presets, undefined, false)),
    {
      value: "all",
      options,
      custom: false,
    },
  );
  // Filters that match a preset select it.
  assert.deepEqual(
    plain(list.toolPresetChoice("All items", presets, presets[1], true)),
    { value: "9", options, custom: false },
  );
  // Filters that match none: Custom selection.
  assert.deepEqual(
    plain(list.toolPresetChoice("All items", presets, undefined, true)),
    { value: "all", options, custom: true },
  );
  // Without presets the All entry stays.
  assert.deepEqual(
    plain(list.toolPresetChoice("All jobs", [], undefined, true)),
    {
      value: "all",
      options: [{ value: "all", label: "All jobs" }],
      custom: true,
    },
  );
});
