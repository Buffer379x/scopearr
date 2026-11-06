import test from "node:test";
import assert from "node:assert/strict";
import { between, src } from "./helpers/sources.mjs";

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
  const panel = between(page, "{!collapsed && (", "<ActiveFilterBar");
  assert.doesNotMatch(
    panel,
    /options\.|updateOptions|setEditDisks|Group by|Target disks/,
  );
  for (const title of ["Status", "Kind"])
    assert.ok(panel.includes(`t("${title}")`));
  assert.match(panel, /<MultiFilter/);
  assert.match(page, /: setScanDialog\(true\)/);
  assert.doesNotMatch(
    between(page, "const startScan", "// The server queues"),
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
  const summary = between(
    dialog,
    "export function PlacementSummaryDialog",
    "function PlacementSharesReport",
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
// hooks are external boundaries. The real useToolPageState and usePolling run
// on the same fake hooks and storage as the page. A completed scan is a dated
// snapshot, while its remaining split-folder count must follow moves and the
// same live result data.
import ts from "typescript";
import { loadSource } from "./helpers/component-harness.mjs";
import { runInNewContext } from "node:vm";
import * as placement from "../src/placement.ts";
import * as toolFilters from "../src/tool-filters.ts";
import * as instances from "../src/instances.ts";
import * as toolTable from "../src/tool-table.ts";
function placementPageHarness(initialActivity) {
  const state = [],
    effects = [],
    cleanups = [],
    timers = new Map(),
    signals = [];
  let cursor = 0,
    firstRender = true,
    activity = initialActivity,
    timerId = 0,
    held;
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  const setTimeout = (fn, delay) => {
    timers.set(++timerId, { fn, delay });
    return timerId;
  };
  const clearTimeout = (id) => {
    timers.delete(id);
  };
  const document = {
    hidden: false,
    addEventListener() {},
    removeEventListener() {},
  };
  const hooks = {
    useState(initial) {
      const slot = cursor++;
      if (!(slot in state))
        state[slot] = typeof initial === "function" ? initial() : initial;
      return [
        state[slot],
        (next) => {
          state[slot] = typeof next === "function" ? next(state[slot]) : next;
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
  const storage = {
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
  const sortable = {
    parseTableSort: () => undefined,
    formatTableSort: () => "",
  };
  // The page opens without a route here, so the tool route stays unused.
  const toolRoute = {
    toolRouteState: () => assert.fail("toolRouteState without a route"),
    toolRouteQuery: () => assert.fail("toolRouteQuery without a route"),
  };
  const toolPageState = loadSource("hooks/useToolPageState.ts", {
    modules: {
      "preact/hooks": hooks,
      "../browser-storage": storage,
      "../components/SortableHeader": sortable,
      "../tool-route": toolRoute,
    },
  });
  const polling = loadSource("hooks/usePolling.ts", {
    modules: { "preact/hooks": hooks },
    browser: { document, setTimeout, clearTimeout, AbortController },
  });
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
      setTimeout,
      clearTimeout,
      require(path) {
        if (path === "preact/jsx-runtime") return { jsx, jsxs: jsx };
        if (path === "preact/hooks") return hooks;
        if (path === "../hooks/useToolPageState") return toolPageState;
        if (path === "../hooks/usePolling") return polling;
        if (path === "../api")
          return {
            api: async (url, _method, _body, signal) => {
              signals.push(signal);
              await held;
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
        if (path === "../browser-storage") return storage;
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
        if (path === "./Pagination")
          return { Pagination: "Pagination", itemRange: () => "" };
        if (path === "./SortableHeader") return sortable;
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
      for (const effect of effects) cleanups.push(effect());
    },
    unmount() {
      for (const cleanup of cleanups.splice(0))
        if (typeof cleanup === "function") cleanup();
    },
    async poll(next = activity) {
      activity = next;
      const [id, timer] = [...timers].find(
        ([, entry]) => entry.delay === 0 || entry.delay === 10000,
      );
      timers.delete(id);
      await timer.fn();
    },
    // Keeps API responses pending until the returned release is called.
    hold() {
      let release;
      held = new Promise((resolve) => (release = resolve));
      return () => {
        held = undefined;
        release();
      };
    },
    timers,
    signals,
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
test("leaving the placement page clears its pending poll and aborts its request", async () => {
  const activity = {
    scan: { running: false },
    counts: {},
    queued: 0,
    running: 0,
    moved: 0,
  };
  const waiting = placementPageHarness(activity);
  waiting.render();
  waiting.mount();
  await waiting.poll();
  assert.deepEqual(
    [...waiting.timers.values()].map((timer) => timer.delay),
    [10000],
  );
  waiting.unmount();
  assert.equal(waiting.timers.size, 0, "the next poll must not stay scheduled");

  const loading = placementPageHarness(activity);
  loading.render();
  loading.mount();
  const release = loading.hold();
  const pending = loading.poll();
  assert.equal(loading.signals.length, 3);
  assert.ok(loading.signals.every((signal) => !signal.aborted));
  loading.unmount();
  assert.ok(
    loading.signals.every((signal) => signal.aborted),
    "the in-flight requests must be aborted",
  );
  release();
  await pending;
  assert.equal(loading.timers.size, 0, "an aborted poll schedules nothing");
  assert.equal(loading.signals.length, 3);
});
