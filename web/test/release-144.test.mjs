import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { placementCompact, placementReportNotices } from "../src/placement.ts";
import {
  autoReloads,
  eventQuery,
  levelTag,
  openLog,
  takeLogFilter,
} from "../src/event-log.ts";
const src = (p) =>
  readFileSync(new URL("../src/" + p, import.meta.url), "utf8");
const between = (code, from, to) => {
  const start = code.indexOf(from);
  assert.ok(start >= 0, from);
  const end = code.indexOf(to, start);
  assert.ok(end > start, to);
  return code.slice(start, end);
};

test("one-device placement rows are compact and show no size", () => {
  assert.equal(
    placementCompact({
      scanStatus: "ok",
      disks: { disk3: { bytes: 0, files: 0, dirs: 0 } },
    }),
    true,
  );
  assert.equal(
    placementCompact({
      scanStatus: "ok",
      disks: { disk3: { bytes: 10, files: 1, dirs: 1 } },
    }),
    false,
  );
  assert.equal(
    placementCompact({
      scanStatus: "split",
      disks: { disk3: { bytes: 0, files: 0, dirs: 0 } },
    }),
    false,
  );
  const page = src("components/DiskPlacementPage.tsx");
  assert.match(page, /placementCompact\(item\)\s*\?\s*"—"/);
  assert.match(page, /No Radarr\/Sonarr entry/);
  assert.match(page, /"no_arr", "Without Arr entry"/);
});

test("the report explains shares and its icon marks notices", () => {
  const finished = { finishedAt: "2026-10-24T00:00:00Z" };
  assert.equal(placementReportNotices(undefined), false);
  assert.equal(
    placementReportNotices({
      ...finished,
      shares: [{ shareDir: "documentaries", deviceErrors: [] }],
      rootFolders: [{ status: "resolved" }],
    }),
    false,
  );
  assert.equal(
    placementReportNotices({
      ...finished,
      shares: [],
      rootFolders: [{ status: "unresolved" }],
    }),
    true,
  );
  assert.equal(
    placementReportNotices({
      ...finished,
      shares: [{ shareDir: "x", notice: "empty", deviceErrors: [] }],
      rootFolders: [],
    }),
    true,
  );
  const dialogs = src("components/PlacementDialogs.tsx");
  for (const label of [
    "Share folder",
    "Folders on disks",
    "On several disks",
    "Without Arr entry",
    "Arr entries without folder",
  ])
    assert.match(dialogs, new RegExp('"' + label + '"'));
  assert.match(dialogs, /Open in settings/);
});

test("tool pages render no result-dependent box between filters and results", () => {
  for (const page of ["DiskPlacementPage", "FileCheckPage"]) {
    const code = src("components/" + page + ".tsx");
    const end = code.indexOf('<section class="library-section">');
    const flow = code.slice(code.lastIndexOf("</section>", end), end);
    assert.doesNotMatch(flow, /SkippedRootsNotice|class="notice"/);
    assert.doesNotMatch(code, /setError\(/);
    assert.match(code, /useScanErrorToast\(/);
    assert.match(code, /notification-dot/);
    assert.match(code, /Scan report · contains notices/);
  }
  const files = src("components/FileCheckPage.tsx");
  const report = between(files, 'title={t("Scan report")}', "By kind");
  assert.match(report, /SkippedRootsNotice/);
  assert.doesNotMatch(
    src("components/DiskPlacementPage.tsx"),
    /SkippedRootsNotice/,
  );
});

test("the shares card lists only Arr root folders and saves choices", () => {
  const card = src("components/UnraidShares.tsx");
  assert.match(card, /"unraid\/shares"/);
  assert.match(card, /"unraid\/share-dirs"/);
  assert.match(card, /Do not scan/);
  assert.match(card, /Choose subfolder …/);
  assert.match(src("components/UnraidSettings.tsx"), /<UnraidShares/);
});

test("dialogs close after a successful save", () => {
  const mux = src("components/MuxPage.tsx");
  assert.match(
    mux,
    /await save\(job\);[\s\S]{0,120}setDialog\(undefined\)/,
    "mux options close after saving",
  );
  assert.match(
    src("components/RecognitionPage.tsx"),
    /if \(ok\) setEditing\(null\)/,
  );
  assert.match(src("hooks/useToolPresets.tsx"), /setOpen\(false\)/);
  assert.match(src("components/Library.tsx"), /setSavePreset\(false\)/);
  assert.match(
    src("components/FileCheckPage.tsx"),
    /save\(lines\(allowed\), lines\(ignore\)\);\s*close\(\);/,
  );
});

test("tool pages share one rhythm and card titles align", () => {
  for (const page of ["DiskPlacementPage", "FileCheckPage"])
    assert.doesNotMatch(src("components/" + page + ".tsx"), /control-lg/);
  assert.match(src("components/MuxPage.tsx"), /notice page-notice/);
  const library = src("styles/library.css");
  assert.match(
    library,
    /\.results-heading \{[^}]*min-height: var\(--control-md\)/,
  );
  assert.match(library, /\.page-notice \{\s*margin: 0 0 var\(--space-6\)/);
  assert.match(
    library,
    /\.filter-always-visible \.preset-toolbar select \{[^}]*width: var\(--layout-200\)/,
  );
  assert.match(library, /\.results-tools \{[^}]*gap: var\(--space-2\)/);
  assert.match(
    src("styles/base.css"),
    /\.card-heading \{[^}]*min-height: var\(--control-md\)/,
  );
  assert.match(
    src("styles/settings-and-filters.css"),
    /\.settings-content \.card-title \{[^}]*min-height: var\(--control-md\)/,
  );
});

test("system shows Info and Log tabs with the log outside the settings form", () => {
  const dialog = src("components/SettingsDialog.tsx");
  assert.match(dialog, /<SegmentedTabs\s+id="system"/);
  assert.match(dialog, /value: "info", label: t\("Info"\)/);
  assert.match(dialog, /SYSTEM_TAB_KEY/);
  assert.match(dialog, /systemTab === "log" && \(/);
  assert.match(dialog, /<EventLogViewer status=\{status\} demo=\{demo\} \/>/);
  const form = between(
    dialog,
    "<form\n            id={settingsFormId}",
    "</form>",
  );
  assert.doesNotMatch(form, /EventLogViewer/);
});

test("the log viewer puts compact filters above a four-column table", () => {
  const viewer = src("components/EventLogViewer.tsx");
  const filters = viewer.indexOf('class="compact-filter-row"');
  const table = viewer.indexOf('class="data-table event-log-table"');
  assert.ok(filters > 0 && table > filters, "filters precede the table");
  for (const name of ["event-level", "event-source", "event-instance"])
    assert.match(
      viewer,
      new RegExp('name="' + name + '"[\\s\\S]{0,140}includeOnly'),
    );
  assert.match(viewer, /header\("ts", "Time"/);
  assert.match(viewer, /header\("level", "Level"/);
  assert.match(viewer, /header\("source", "Source"/);
  assert.match(viewer, /<th scope="col">\{t\("Message"\)\}<\/th>/);
  assert.match(viewer, /title=\{t\("Log entry"\)\}/);
  assert.match(viewer, /No entries in the last 24 hours\./);
  assert.match(viewer, /No matching entries\./);
  assert.match(viewer, /e\.detail \|\| e\.subject \?/);
  assert.match(viewer, /You are about to clear the log\./);
  assert.deepEqual(levelTag, {
    error: "status-error",
    warning: "status-warn",
    info: "status-info",
  });
});

test("the log reloads only the newest page and builds filtered queries", () => {
  assert.equal(autoReloads(true, null, 1), true);
  assert.equal(autoReloads(true, { field: "ts", direction: "desc" }, 1), true);
  assert.equal(autoReloads(true, { field: "ts", direction: "asc" }, 1), false);
  assert.equal(
    autoReloads(true, { field: "level", direction: "desc" }, 1),
    false,
  );
  assert.equal(autoReloads(true, null, 2), false);
  assert.equal(autoReloads(false, null, 1), false);
  const query = new URLSearchParams(
    eventQuery(
      { q: " dune ", level: ["error", "warning"], source: ["mux"] },
      null,
      3,
    ),
  );
  assert.equal(query.get("q"), "dune");
  assert.deepEqual(query.getAll("level"), ["error", "warning"]);
  assert.equal(query.get("sort"), "ts");
  assert.equal(query.get("dir"), "desc");
  assert.equal(query.get("offset"), "50");
});

test("deep links open System → Log with a filter and errors mark the header", () => {
  const seen = [];
  globalThis.window = {
    dispatchEvent: (event) => seen.push(event.type),
  };
  globalThis.CustomEvent = class {
    constructor(type) {
      this.type = type;
    }
  };
  openLog({ source: ["sync"], instance: ["radarr"] });
  assert.deepEqual(seen, ["scopearr-open-log"]);
  assert.deepEqual(takeLogFilter(), { source: ["sync"], instance: ["radarr"] });
  assert.equal(takeLogFilter(), undefined);
  delete globalThis.window;
  delete globalThis.CustomEvent;
  assert.match(src("components/Notifications.tsx"), /Show in log/);
  assert.match(
    src("hooks/useStatus.ts"),
    /source: \["sync"\], instance: \[service\]/,
  );
  const library = src("components/Library.tsx");
  assert.doesNotMatch(library, /useUnseenErrors/);
  assert.doesNotMatch(library, /notification-dot error/);
  assert.doesNotMatch(src("components/SettingsDialog.tsx"), /New errors in the log/);
});
