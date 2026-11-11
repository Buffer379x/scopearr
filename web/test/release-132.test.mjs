import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { muxFilterJobs } from "../src/mux-spec.ts";
import { parseToolFilters } from "../src/browser-storage.ts";
import {
  filterChips,
  toggleFilter,
  toolFilterQuery,
} from "../src/tool-filters.ts";
import { placementDiskTone } from "../src/placement.ts";
import { appShellSources } from "./helpers/sources.mjs";
const src = (path) =>
  readFileSync(new URL("../src/" + path, import.meta.url), "utf8");

test("mux filters use effective status OR, case-insensitive filenames and AND between groups", () => {
  const jobs = [
    { id: 1, status: "ready", sourceName: "Film.MKV", check: { ok: true } },
    { id: 2, status: "failed", sourceName: "Another.mkv", check: { ok: true } },
    {
      id: 3,
      status: "ready",
      sourceName: "Film warning.mkv",
      check: { ok: false },
    },
  ];
  const ids = (filters) => muxFilterJobs(jobs, filters).map((j) => j.id);
  assert.deepEqual(ids({ statuses: [], q: "" }), [1, 2, 3]);
  assert.deepEqual(ids({ statuses: ["ready", "failed"], q: "" }), [1, 2]);
  assert.deepEqual(ids({ statuses: [], q: "FILM" }), [1, 3]);
  assert.deepEqual(ids({ statuses: ["warning", "failed"], q: "film" }), [3]);
  assert.deepEqual(ids({ statuses: ["failed"], q: "" }), [2]);
});
test("tool preferences tolerate malformed JSON and fields", () => {
  const empty = { statuses: [], targets: [], kinds: [], q: "" };
  for (const value of [
    null,
    "{",
    "[]",
    '"str"',
    '{"statuses":42}',
    '{"statuses":[true]}',
    '{"statuses":["open"],"kinds":7}',
  ])
    assert.deepEqual(parseToolFilters(value), empty, value);
  assert.deepEqual(
    parseToolFilters('{"statuses":["open","open"],"q":"Film"}'),
    { ...empty, statuses: ["open"], q: "Film" },
  );
});
test("filter chips follow option order and repeated API values survive serialization", () => {
  const removed = [];
  const chips = filterChips(
    "Status",
    [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ],
    ["b", "a"],
    (v) => removed.push(v),
  );
  assert.deepEqual(
    chips.map((c) => c.label),
    ["Status: A", "Status: B"],
  );
  chips[1].remove();
  assert.deepEqual(removed, ["b"]);
  assert.deepEqual(toggleFilter(["a"], "a", true), ["a"]);
  const query = toolFilterQuery("A&B", {
    status: ["a", "b"],
    kind: ["junk", "orphan"],
  });
  assert.deepEqual(query.getAll("status"), ["a", "b"]);
  assert.equal(query.get("q"), "A&B");
});
test("all four disks have visible tags with one target and three sources", () => {
  const item = {
    target: "disk4",
    disks: {
      disk1: { bytes: 1 },
      disk2: { bytes: 2 },
      disk3: { bytes: 3 },
      disk4: { bytes: 4 },
    },
  };
  assert.deepEqual(
    Object.keys(item.disks).map((d) => placementDiskTone(item, d)),
    ["source", "source", "source", "target"],
  );
});
test("tool pages share filters and reserve progress/removal columns", () => {
  // Muxing, Disk placement and Files & permissions (Phase 5b): the tool
  // card's chips row and the tool drawer's value lists take the place of
  // ActiveFilterBar and FilterCheckList.
  for (const [page, chips, values] of [
    ["DiskPlacementPage", /<ToolCard/, /useLazyChunk\(toolDrawerChunk/],
    ["FileCheckPage", /<ToolCard/, /useLazyChunk\(toolDrawerChunk/],
    ["MuxPage", /<ToolCard/, /useLazyChunk\(toolDrawerChunk/],
  ]) {
    const code = src("components/" + page + ".tsx");
    assert.match(code, chips);
    assert.match(code, values);
    assert.doesNotMatch(code, /placement-chips/);
  }
  assert.match(src("components/HelpPopover.tsx"), /"info"/);
  assert.doesNotMatch(appShellSources(), /brand-caption|LIBRARY EXPLORER/);
  assert.match(src("i18n.tsx"), /document.title = "Scopearr"/);
  const removed = [
    "LIBRARY EXPLORER",
    "Scopearr · Your library at a glance",
    "YOUR LIBRARY. CLEARLY FILTERED.",
    "The details make",
    "the difference.",
    "Movies and series from Radarr and Sonarr.",
    "Every attribute. One clear overview.",
    "Stored locally · No media scans",
  ];
  for (const key of removed) {
    assert.ok(!src("components/Login.tsx").includes(key));
    for (const locale of ["en", "de", "es", "it"]) {
      assert.ok(
        !(key in JSON.parse(src("locales/" + locale + ".json")).messages),
      );
    }
  }
});

test("tool filter messages are in every locale; the expand/collapse labels left with FilterRow", () => {
  for (const locale of ["en", "de", "es", "it"]) {
    const messages = JSON.parse(src("locales/" + locale + ".json")).messages;
    for (const key of [
      "Show",
      "Search filename …",
      "Starts all ready jobs, including filtered ones",
      "No matching jobs.",
      "Change the filters.",
    ])
      assert.ok(messages[key], locale + ": " + key);
    // The 1.7.0 filter panel's collapse control left in Phase 5b, Task 9:
    // the tool cards have no collapsed state (the drawer holds the filters).
    for (const key of ["Expand filters", "Collapse filters"])
      assert.ok(!(key in messages), locale + ": " + key);
  }
});

test("obsolete or unknown saved tool values cannot hide the reset control behind an invalid API filter", () => {
  assert.deepEqual(
    parseToolFilters(
      '{"statuses":["unknown","open"],"kinds":["gone","junk"]}',
      { statuses: ["open"], kinds: ["junk"] },
    ),
    { statuses: ["open"], kinds: ["junk"], targets: [], q: "" },
  );
});
