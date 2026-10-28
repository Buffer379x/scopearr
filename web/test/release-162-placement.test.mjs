import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src = (path) =>
  readFileSync(new URL("../src/" + path, import.meta.url), "utf8");

test("scan report time formats the completed scan and elapsed minutes and seconds", async () => {
  const { scanReportTime } = await import("../src/scan-report.ts");
  const scan = {
    startedAt: "2026-10-26T10:00:00Z",
    finishedAt: "2026-10-26T10:02:03Z",
  };
  const report = scanReportTime(scan, "de");
  assert.equal(report.date, new Date(scan.finishedAt).toLocaleString("de"));
  assert.equal(report.iso, "2026-10-26T10:02:03.000Z");
  assert.equal(report.duration, "2 min 3 s");
  assert.equal(scanReportTime({}, "en"), undefined);
  assert.equal(scanReportTime({ finishedAt: "bad" }, "en"), undefined);
  assert.equal(
    scanReportTime({ finishedAt: scan.finishedAt }, "en").duration,
    "",
  );
  assert.equal(
    scanReportTime({ ...scan, startedAt: "bad" }, "en").duration,
    "",
  );
  assert.equal(
    scanReportTime({ ...scan, startedAt: "2026-10-26T10:03:00Z" }, "en")
      .duration,
    "",
  );
});

test("placement filter panel contains only result filters and Scan opens its options dialog", () => {
  const page = src("components/DiskPlacementPage.tsx");
  const panel = page.slice(
    page.indexOf("{!collapsed && ("),
    page.indexOf("<ActiveFilterBar"),
  );
  assert.doesNotMatch(
    panel,
    /options\.|updateOptions|setEditDisks|Group by|Target disks/,
  );
  for (const title of ["Status", "Kind"])
    assert.ok(panel.includes(`t("${title}")`));
  assert.match(panel, /<MultiFilter/);
  assert.match(page, /: setScanDialog\(true\)/);
  assert.doesNotMatch(
    page.slice(
      page.indexOf("const startScan"),
      page.indexOf("// The server queues"),
    ),
    /verifyChecksum/,
  );
  assert.match(page, /<PlacementScanDialog/);
  assert.match(page, /next.report \|\| \(!next.scan.running/);
  assert.match(page, /if \(completed\?\.finishedAt\) setReport\(completed\)/);
  assert.match(page, /<PlacementSummaryDialog[\s\S]*?scan=\{report\}/);
});

test("placement scan options have ordered sections, inline errors and a moves-disabled start", () => {
  const dialog = src("components/PlacementScanDialog.tsx");
  assert.match(dialog, /<Modal[\s\S]*wide[\s\S]*className="scan-dialog"/);
  assert.ok(dialog.indexOf('t("Services")') < dialog.indexOf('t("TV series")'));
  assert.ok(
    dialog.indexOf('t("TV series")') < dialog.indexOf('t("Target disks")'),
  );
  assert.match(dialog, /instanceLabel/);
  assert.match(dialog, /role="alert"/);
  assert.match(dialog, /Finish or cancel moves first/);
  assert.doesNotMatch(dialog, /verifyChecksum/);
});

test("placement report begins with the completed scan time and shows the running notice", () => {
  const dialog = src("components/PlacementDialogs.tsx");
  const summary = dialog.slice(
    dialog.indexOf("export function PlacementSummaryDialog"),
    dialog.indexOf("function PlacementSharesReport"),
  );
  assert.ok(
    summary.indexOf('t("Scanned at")') < summary.indexOf('["Items checked"'),
  );
  assert.match(summary, /title=\{reportTime\.iso\}/);
  assert.match(
    summary,
    /A new scan is running\. This report shows the previous scan\./,
  );
});

// Exercise the real page across activity polls; only the API and browser/runtime
// hooks are external boundaries. A completed scan is a dated snapshot, while its
// remaining split-folder count must follow moves and the same live result data.
import ts from "typescript";
import { runInNewContext } from "node:vm";
import * as placement from "../src/placement.ts";
import * as toolFilters from "../src/tool-filters.ts";
import * as instances from "../src/instances.ts";
import * as toolTable from "../src/tool-table.ts";
function placementPageHarness(initialActivity) {
  const state = [],
    effects = [],
    timers = new Map();
  let cursor = 0,
    firstRender = true,
    activity = initialActivity,
    timerId = 0;
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  runInNewContext(
    ts.transpileModule(src("components/DiskPlacementPage.tsx"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        jsxImportSource: "preact",
      },
    }).outputText,
    {
      exports,
      URLSearchParams,
      AbortController,
      setTimeout(fn, delay) {
        timers.set(++timerId, { fn, delay });
        return timerId;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
      require(path) {
        if (path === "preact/jsx-runtime") return { jsx, jsxs: jsx };
        if (path === "preact/hooks")
          return {
            useState(initial) {
              const slot = cursor++;
              if (!(slot in state))
                state[slot] =
                  typeof initial === "function" ? initial() : initial;
              return [
                state[slot],
                (next) => {
                  state[slot] =
                    typeof next === "function" ? next(state[slot]) : next;
                },
              ];
            },
            useRef(initial) {
              const slot = cursor++;
              if (!(slot in state)) state[slot] = { current: initial };
              return state[slot];
            },
            useEffect(effect) {
              if (firstRender) effects.push(effect);
            },
          };
        if (path === "../api")
          return {
            api: async (url) => {
              if (url === "placement/scan") return activity;
              if (url === "unraid/status")
                return { ready: true, state: {}, disks: [] };
              if (url.startsWith("placement/items?"))
                return { items: [], total: 0, selectableIds: [] };
              throw Error("Unexpected request " + url);
            },
          };
        if (path === "../placement") return placement;
        if (path === "../tool-table") return toolTable;
        if (path === "../tool-filters") return toolFilters;
        if (path === "../instances") return instances;
        if (path === "../browser-storage")
          return {
            readPreference: () => null,
            readSessionPreference: () => null,
            writePreference() {},
            removePreference() {},
            writeSessionPreference() {},
            readToolFilters: () => ({
              q: "",
              statuses: [],
              targets: [],
              kinds: [],
            }),
          };
        if (path === "../i18n")
          return { useI18n: () => ({ locale: "en" }), t: (key) => key };
        if (path === "../ui")
          return { ICON: {}, count: String, compactBytes: String };
        if (path === "../hooks/useToolPresets")
          return { useToolPresets: () => ({ dialogs: null }) };
        if (path === "../hooks/useRowRemoval")
          return { useRowRemoval: () => ({ removing: new Set() }) };
        if (path === "../use-tool-table")
          return { useToolTableStyle: () => ({}) };
        if (path === "../tool-feedback") return { useScanErrorToast() {} };
        if (path === "./SortableHeader")
          return { parseTableSort: () => undefined, formatTableSort: () => "" };
        return new Proxy({}, { get: (_, key) => key });
      },
    },
  );
  const nodes = (tree) =>
    Array.isArray(tree)
      ? tree.flatMap(nodes)
      : tree && typeof tree === "object"
        ? [tree, ...nodes(tree.props?.children)]
        : [];
  return {
    render() {
      cursor = 0;
      const tree = exports.DiskPlacementPage({
        settings: null,
        changed() {},
        setup() {},
        openFiles() {},
      });
      firstRender = false;
      return nodes(tree);
    },
    mount() {
      for (const effect of effects) effect();
    },
    async poll(next = activity) {
      activity = next;
      const [id, timer] = [...timers].find(
        ([, entry]) => entry.delay === 0 || entry.delay === 10000,
      );
      timers.delete(id);
      await timer.fn();
    },
  };
}
test("placement summary keeps the scan date but updates remaining split folders after a move", async () => {
  const completed = {
    running: false,
    finishedAt: "2026-10-26T10:02:03Z",
    checked: 1,
    several: 1,
    counts: { all: 1, several: 1 },
    options: {},
  };
  const activity = {
    scan: completed,
    report: completed,
    counts: { all: 1, several: 1 },
    queued: 0,
    running: 0,
    moved: 0,
  };
  const harness = placementPageHarness(activity);
  harness.render();
  harness.mount();
  await harness.poll();
  const reportButton = harness
    .render()
    .find((node) => node.type === "ActiveFilterBar").props.tools;
  reportButton.props.onClick();
  const summary = () =>
    harness.render().find((node) => node.type === "PlacementSummaryDialog")
      .props;
  assert.equal(summary().counts.several, 1);
  await harness.poll({ ...activity, counts: { all: 1, several: 0 }, moved: 1 });
  assert.equal(
    summary().counts.several,
    0,
    "completed moves must leave the Several disks count",
  );
  assert.equal(summary().scan.finishedAt, "2026-10-26T10:02:03Z");
  await harness.poll({
    ...activity,
    scan: { running: true },
    counts: { all: 1, several: 0 },
    moved: 1,
  });
  assert.equal(summary().counts.several, 0);
  assert.equal(summary().scan.finishedAt, "2026-10-26T10:02:03Z");
  assert.equal(summary().scanning, true);
});
