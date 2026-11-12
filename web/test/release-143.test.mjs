import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { visibleGroupKeys, pageSelection } from "../src/file-selection.ts";
import { appShellSources } from "./helpers/sources.mjs";
const src = (p) =>
  readFileSync(new URL("../src/" + p, import.meta.url), "utf8");
test("selection is scoped to page and group membership is instance-aware", () => {
  const keys = [
    { service: "sonarr", id: 1, mediaId: 10, season: 1 },
    { service: "sonarr", id: 2, mediaId: 10, season: 2 },
    { service: "sonarr-b", id: 1, mediaId: 10, season: 1 },
  ];
  assert.deepEqual(visibleGroupKeys(keys, "sonarr", 10), keys.slice(0, 2));
  assert.deepEqual(visibleGroupKeys(keys, "sonarr", 10, 1), keys.slice(0, 1));
  const saved = {
    scope: "page1",
    values: { "sonarr:1": keys[0], "sonarr:99": { service: "sonarr", id: 99 } },
  };
  assert.deepEqual(pageSelection(saved, "page2", keys), {});
  assert.deepEqual(Object.keys(pageSelection(saved, "page1", keys)), [
    "sonarr:1",
  ]);
});
test("library has no selection bar or global selection request", () => {
  assert.doesNotMatch(
    appShellSources(),
    /selection-bar|selectionQuery|results.groups/,
  );
  assert.doesNotMatch(
    src("hooks/useFileSelection.ts"),
    /files\/selection|selectionLimit/,
  );
  assert.match(
    src("hooks/useLibraryState.ts"),
    /page.*movieSort|movieSort.*page/s,
  );
});
test("tool activity stays inline and row progress remains available", () => {
  for (const page of ["DiskPlacementPage", "FileCheckPage"]) {
    const code = src("components/" + page + ".tsx");
    assert.doesNotMatch(code, /tool-progress|placement-overall-progress/);
    // Phase 5b: the activity is the card's hint line and the row progress
    // the v2 progress cell.
    assert.match(code, /<ProgressCell/);
    assert.match(code, /activity=\{hint\}/);
  }
});
test("one sectioned help replaces separate scan information controls", () => {
  assert.match(src("components/HelpPopover.tsx"), /sections/);
  assert.doesNotMatch(src("components/ToolFilters.tsx"), /info\??:|\{info\}/);
  for (const p of ["DiskPlacementPage", "FileCheckPage"]) {
    assert.doesNotMatch(
      src("components/" + p + ".tsx"),
      /label="Scan information"/,
    );
    assert.match(src("components/" + p + ".tsx"), /heading: "Last scan"/);
  }
  assert.match(src("components/MuxPage.tsx"), /How muxing works/);
});
test("fixed ordered-list hints are inline and title labels are not duplicated", () => {
  assert.doesNotMatch(src("ui.tsx"), /Title \/ Episode \(always visible\)/);
});
test("settings share heading and move rule guidance into help", () => {
  // Custom tags has the v2 band since Phase 5c (task 7): the shared
  // SettingsHeader, whose Save settings saves the colors; Tag rules since
  // task 8, whose Save settings saves the rules, the rule guidance in its
  // HelpTip. System keeps the 1.7.0 heading until its task.
  assert.match(src("components/SettingsPage.tsx"), /<SettingsSectionHeading/);
  assert.match(
    src("components/RecognitionPage.tsx"),
    /<SettingsHeader\s+section="recognition"/,
  );
  assert.match(
    src("components/RecognitionPage.tsx"),
    /<HelpTip label="Tag rules help"/,
  );
  assert.match(
    src("components/CustomTagsSettings.tsx"),
    /<SettingsHeader\s+section="custom"/,
  );
  assert.doesNotMatch(src("components/CustomTagsSettings.tsx"), /Save colors/);
});
test("mux marking has one short confirmation and no result dialog or cap", () => {
  // The logic is useMuxSelection's; both views (the library's selection
  // tools and the mux page's Remove mux marking, Phase 5b) show its run
  // as the running label, marking or removing. The mux page has a progress
  // column, so its view is checked for the dialog and the cap only.
  const code = src("hooks/useMuxSelection.ts");
  assert.doesNotMatch(code, /Modal|slice\(0, 200\)|cancel.current|progress/);
  assert.match(code, /You are about to mark \{count\} items for muxing\./);
  assert.match(code, /if \(n > 1\)/);
  for (const [path, unwanted, running] of [
    [
      "components/library/SelectionTools.tsx",
      /Modal|slice\(0, 200\)|cancel.current|progress/,
      /Marking … \{done\}\/\{total\}/,
    ],
    [
      "components/MuxPage.tsx",
      /<Modal|slice\(0, 200\)|cancel.current/,
      /Removing … \{done\}\/\{total\}/,
    ],
  ]) {
    const view = src(path);
    assert.doesNotMatch(view, unwanted, path);
    assert.match(view, running, path);
  }
});
test("mux batch is sequential, skips existing and protected jobs, retains first error", async () => {
  const { processMuxSelection } = await import("../src/mux-selection.ts");
  const files = Array.from({ length: 250 }, (_, n) => ({
    service: "radarr",
    id: n + 1,
  }));
  const calls = [];
  let active = 0,
    peak = 0;
  const result = await processMuxSelection(
    files,
    [{ service: "radarr", fileId: 1 }],
    false,
    async (_p, _m, body) => {
      calls.push(body.fileId);
      peak = Math.max(peak, ++active);
      await Promise.resolve();
      active--;
      if (body.fileId === 4) throw new Error("first reason");
      if (body.fileId === 6) throw new Error("later reason");
    },
    () => {},
  );
  assert.equal(peak, 1);
  assert.equal(calls.length, 249);
  assert.equal(result.ok, 247);
  assert.equal(result.failed, 2);
  assert.equal(result.reason, "first reason");
  assert.equal(result.done, 250);
  const protectedJobs = [
    { service: "radarr", fileId: 1, id: 1, status: "queued" },
    {
      service: "radarr",
      fileId: 2,
      id: 2,
      status: "draft",
      backupName: "backup",
    },
    { service: "radarr", fileId: 3, id: 3, status: "draft" },
  ];
  const removed = [];
  const out = await processMuxSelection(
    files.slice(0, 3),
    protectedJobs,
    true,
    async (path) => removed.push(path),
    () => {},
  );
  assert.deepEqual(removed, ["mux/jobs?id=3"]);
  assert.equal(out.skipped, 2);
  assert.equal(out.ok, 1);
  const duplicate = await processMuxSelection(
    files.slice(0, 1),
    protectedJobs,
    false,
    async () => assert.fail("duplicate posted"),
    () => {},
  );
  assert.equal(duplicate.ok, 0);
  assert.equal(duplicate.failed, 0);
});
test("root mismatch describes the most frequent missing-item reason", async () => {
  const { scanCoverageReason } = await import("../src/scan-coverage.ts");
  assert.equal(
    scanCoverageReason({ items: 11, scanned: 0, unselected: 1 }),
    "Path warning",
  );
  assert.equal(
    scanCoverageReason({
      items: 11,
      scanned: 0,
      unselected: 6,
      outside_share: 3,
    }),
    "Instance not selected",
  );
  assert.equal(
    scanCoverageReason({
      items: 11,
      scanned: 0,
      unselected: 1,
      outside_share: 6,
    }),
    "Outside the share",
  );
});
