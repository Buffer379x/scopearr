import test from "node:test";
import assert from "node:assert/strict";
import {
  appShellSources,
  between,
  readSources,
  src,
} from "./helpers/sources.mjs";
import { loadSource } from "./helpers/component-harness.mjs";
import { placementCompact, placementReportNotices } from "../src/placement.ts";
import {
  autoReloads,
  eventQuery,
  levelTag,
  logQuery,
  openLog,
  parseLogQuery,
} from "../src/event-log.ts";

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
    assert.ok(end > 0, "library-section");
    const sectionEnd = code.lastIndexOf("</section>", end);
    assert.ok(sectionEnd >= 0, "preceding </section>");
    const flow = code.slice(sectionEnd, end);
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
  assert.match(src("hooks/useLibraryState.ts"), /setSavePreset\(false\)/);
  assert.match(
    src("components/FileCheckNamesDialog.tsx"),
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
  const page = src("components/SettingsPage.tsx");
  const system = src("components/SystemSettings.tsx");
  assert.match(system, /<SegmentedTabs\s+id="system"/);
  assert.match(system, /value: "info", label: t\("Info"\)/);
  assert.match(system, /SYSTEM_TAB_KEY/);
  assert.match(page, /systemTab === "log" && \(/);
  assert.match(
    system,
    /<EventLogViewer\n\s+key=\{revision\}\n\s+status=\{status\}\n\s+demo=\{demo\}\n\s+query=\{query\}\n\s+setQuery=\{setQuery\}\n\s+sort=\{sort\}\n\s+setSort=\{setSort\}\n\s+\/>/,
  );
  const form = between(
    page,
    "<form\n            id={settingsFormId}",
    "</form>",
  );
  assert.match(form, /<SystemSettingsInfo/);
  assert.doesNotMatch(form, /EventLogViewer|SystemSettingsLog/);
  assert.match(
    between(page, "</form>", 'id="password-form"'),
    /systemTab === "log" && \(\s*<SystemSettingsLog/,
  );
  assert.doesNotMatch(
    between(
      system,
      "export function SystemSettingsInfo",
      "export function SystemSettingsLog",
    ),
    /EventLogViewer/,
  );
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

test("openLog writes a hash that parseRoute reads as System → Log", () => {
  const { parseRoute } = loadSource("router.ts", {
    modules: {
      "./event-log": loadSource("event-log.ts"),
      "./tool-route": loadSource("tool-route.ts", {
        modules: { "./browser-storage": loadSource("browser-storage.ts") },
      }),
    },
  });
  // The link event lets the router start the shown route again; it is not
  // cancelled here, so openLog sets the hash.
  const links = [];
  let cancel = false;
  globalThis.window = {
    location: { hash: "#/movies" },
    dispatchEvent(event) {
      links.push([event.type, event.detail, event.cancelable]);
      if (cancel) event.preventDefault();
      return !event.defaultPrevented;
    },
  };
  try {
    for (const [filter, hash] of [
      [
        { source: ["sync"], instance: ["radarr"] },
        "#/settings/system/log?source=sync&instance=radarr",
      ],
      [
        { q: "A & B #1", level: ["error", "warning"], source: ["mux"] },
        "#/settings/system/log?q=A+%26+B+%231&level=error&level=warning&source=mux",
      ],
      [{}, "#/settings/system/log"],
    ]) {
      openLog(filter);
      assert.deepEqual(links.at(-1), ["scopearr:link", hash, true]);
      assert.equal(window.location.hash, hash);
      const route = JSON.parse(JSON.stringify(parseRoute(hash)));
      assert.deepEqual(route, {
        view: "settings",
        section: "system",
        tab: "log",
        query: logQuery(filter),
      });
      assert.deepEqual(parseLogQuery(route.query), filter);
    }
    openLog();
    assert.equal(window.location.hash, "#/settings/system/log");
    // A cancelled link (the router started the shown route again) leaves
    // the hash alone.
    cancel = true;
    openLog({ level: ["error"] });
    assert.equal(window.location.hash, "#/settings/system/log");
    assert.deepEqual(links.at(-1), [
      "scopearr:link",
      "#/settings/system/log?level=error",
      true,
    ]);
  } finally {
    delete globalThis.window;
  }
});

test("deep links open System → Log with a filter and errors mark the header", () => {
  assert.match(src("components/Notifications.tsx"), /Show in log/);
  assert.match(
    src("hooks/useStatus.ts"),
    /source: \["sync"\], instance: \[service\]/,
  );
  const library = appShellSources();
  assert.doesNotMatch(library, /useUnseenErrors/);
  assert.doesNotMatch(library, /notification-dot error/);
  assert.doesNotMatch(
    readSources([
      "components/SettingsPage.tsx",
      "components/SystemSettings.tsx",
      "hooks/useSettingsDraft.ts",
    ]),
    /New errors in the log/,
  );
});
