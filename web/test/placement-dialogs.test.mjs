import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  componentHarness,
  loadSource,
  nodes,
  text,
} from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";
import { src } from "./helpers/sources.mjs";

// The disk placement dialogs on the v2 modal (Phase 5d, Task 9;
// docs/STYLEGUIDE.md, Part 1, 10.9): Scan, Target disks, the scan report,
// Details, Status and the log. Each runs as real code; Modal, ModalFoot,
// CheckRow, Terminal, KeyValues, StatusTag, ToolDiskTag, ProgressCell and
// the other presentation blocks are named stubs.

const classes = (node) => String(node?.props?.class ?? "").split(" ");
const byClass = (tree, name) =>
  nodes(tree).filter((n) => classes(n).includes(name));
const ofType = (tree, type) => nodes(tree).filter((n) => n.type === type);
const plain = (value) => JSON.parse(JSON.stringify(value ?? null));
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const field = loadSource("components/settings/Field.tsx");
const check = loadSource("components/settings/Check.tsx");
const footButtons = (tree) =>
  ofType(tree.props.foot, "button").map((b) => [
    text(b),
    b.props.disabled ?? false,
    b.props.class,
  ]);
const asFilmSort = (sort, fallback) =>
  sort
    ? { field: sort.field, direction: sort.direction }
    : { field: fallback, direction: "asc" };
const nextTableSort = (current, f) =>
  current?.field !== f
    ? { field: f, direction: "asc" }
    : current.direction === "asc"
      ? { field: f, direction: "desc" }
      : null;
const dialogModules = {
  "../ui": {
    ICON: { label: 15, button: 16 },
    count: String,
    compactBytes: (n) => n + " B",
    percent: (n) => n + " %",
  },
  "../table-sort": { nextTableSort },
  "./list/SortHeader": { asFilmSort, SortHeader: "SortHeader" },
  "./list/PageNav": {
    PageNav: "PageNav",
    itemRange: (page, limit, total) => `${page}/${limit}/${total}`,
  },
  "./dialog/Tabs": { Tabs: "Tabs" },
  "./RootCoverage": { RootScanNotice: "RootScanNotice" },
  "../scan-report": {
    scanReportTime: (scan) =>
      scan.finishedAt && {
        date: "2 Jan 2026",
        iso: scan.finishedAt,
        duration: "1 min",
      },
  },
  "../placement-messages": { placementMessage: (m) => String(m) },
};

function scan(props = {}) {
  const calls = [];
  const options = {
    libraries: ["radarr"],
    seriesGrouping: "series",
    excludedDisks: ["disk2"],
    reserveGB: 10,
  };
  const tree = componentHarness(
    "PlacementScanDialog",
    {
      libraries: [{ id: "radarr", name: "Radarr" }],
      options,
      service: {
        ready: true,
        state: { known: true, mover: false, parity: false },
        disks: [
          { name: "disk1", kind: "array" },
          { name: "disk2", kind: "array" },
          { name: "cache", kind: "pool" },
        ],
      },
      busy: false,
      active: false,
      update: (patch) => calls.push(["update", patch]),
      editDisks: () => calls.push(["edit"]),
      start: async () => calls.push(["start"]),
      close: () => calls.push(["close"]),
      ...props,
    },
    {
      modules: {
        "../instances": { instanceLabel: (c) => c.name },
        "./settings/Field": field,
        "./settings/Check": check,
      },
    },
  );
  return { view: tree, tree: tree.render(), calls };
}

test("the placement scan keeps its fields and its footer reason", async () => {
  const { tree, calls, view } = scan();
  assert.equal(tree.type, "Modal");
  assert.equal(tree.props.id, "placementScan");
  assert.equal(tree.props.title, "Scan disk placement");
  assert.equal(tree.props.fitViewport, true);
  assert.equal(tree.props.closeDisabled, false);
  // Sections in 1.7.0 order, in two columns.
  assert.deepEqual(
    plain(byClass(tree.props.children, "v2-modal-h").map(text)),
    ["Services", "TV series", "Target disks"],
  );
  assert.equal(byClass(tree.props.children, "v2-modal-col").length, 2);
  // The services: a checkbox each, the choice written back.
  const [service, ...radios] = ofType(tree.props.children, "input");
  assert.equal(service.props.checked, true);
  service.props.onChange({ currentTarget: { checked: false } });
  assert.deepEqual(plain(calls[0]), ["update", { libraries: [] }]);
  // The grouping: two radios of one name, the chosen one checked.
  assert.deepEqual(
    plain(
      radios
        .slice(0, 2)
        .map((r) => [r.props.type, r.props.name, r.props.checked]),
    ),
    [
      ["radio", "placement-series-grouping", true],
      ["radio", "placement-series-grouping", false],
    ],
  );
  radios[1].props.onChange();
  assert.deepEqual(plain(calls[1]), ["update", { seriesGrouping: "season" }]);
  // The target disks: the included array disks as tags, the excluded count,
  // Edit target disks; the reserve with its literal limits.
  assert.deepEqual(
    plain(byClass(tree.props.children, "v2-tag--disk").map(text)),
    ["disk1"],
  );
  assert.match(
    text(byClass(tree.props.children, "v2-modal-disk-row")[0]),
    /1 excluded/,
  );
  const edit = ofType(tree.props.children, "RowButton")[0];
  assert.equal(edit.props.label, "Edit target disks");
  edit.props.onClick();
  assert.deepEqual(plain(calls[2]), ["edit"]);
  const reserve = ofType(tree.props.children, "input").at(-1);
  assert.deepEqual(
    plain([
      reserve.props.id,
      reserve.props.type,
      reserve.props.min,
      reserve.props.max,
      reserve.props.step,
      reserve.props.value,
    ]),
    ["placement-reserve", "number", "0", "10240", "1", 10],
  );
  reserve.props.onInput({ currentTarget: { valueAsNumber: 25 } });
  assert.deepEqual(plain(calls[3]), ["update", { reserveGB: 25 }]);
  // The foot: Cancel and Scan; the reason's place is always there.
  assert.equal(tree.props.foot.type, "ModalFoot");
  const lead = tree.props.foot.props.lead;
  assert.equal(lead.props["data-reason"], "");
  assert.equal(text(lead), "");
  assert.deepEqual(plain(footButtons(tree)), [
    ["Cancel", false, "v2-btn"],
    ["Scan", false, "v2-btn v2-btn--primary"],
  ]);
  // Scan starts; a failure shows inline as an alert.
  await ofType(tree.props.foot, "button")[1].props.onClick();
  assert.deepEqual(plain(calls[4]), ["start"]);
  const failing = scan({ start: async () => Promise.reject("No") });
  await ofType(failing.tree.props.foot, "button")[1].props.onClick();
  const alert = ofType(failing.view.render().props.children, "p").find(
    (p) => p.props.role === "alert",
  );
  assert.equal(text(alert), "No");
  void view;
});

test("the placement scan names why it cannot start, else the mover or parity", () => {
  const reason = (props) => {
    const { tree } = scan(props);
    const [, scanButton] = ofType(tree.props.foot, "button");
    return [
      text(tree.props.foot.props.lead),
      scanButton.props.disabled,
      scanButton.props.title,
    ];
  };
  assert.deepEqual(plain(reason({ active: true })), [
    "Finish or cancel moves first",
    true,
    "Finish or cancel moves first",
  ]);
  assert.deepEqual(
    plain(
      reason({
        service: { ready: false, error: "Unraid is offline", disks: [] },
      }),
    ),
    ["Unraid is offline", true, "Unraid is offline"],
  );
  assert.deepEqual(plain(reason({ service: { ready: false, disks: [] } })), [
    "Enable the MKVToolNix service and configure path mappings first",
    true,
    "Enable the MKVToolNix service and configure path mappings first",
  ]);
  // The mover and a parity operation only inform: Scan stays enabled.
  const state = (mover, parity) => ({
    service: { ready: true, state: { known: true, mover, parity }, disks: [] },
  });
  assert.deepEqual(plain(reason(state(true, false))), [
    "Mover is running",
    false,
    null,
  ]);
  assert.deepEqual(plain(reason(state(false, true))), [
    "Parity operation in progress",
    false,
    null,
  ]);
  // A hard reason comes before the mover note.
  assert.equal(
    reason({ active: true, ...state(true, false) })[0],
    "Finish or cancel moves first",
  );
  // Busy locks the fields, Cancel and the head's Close.
  const { tree } = scan({ busy: true });
  assert.equal(tree.props.closeDisabled, true);
  assert.ok(
    ofType(tree.props.children, "input").every((i) => i.props.disabled),
  );
  assert.equal(ofType(tree.props.foot, "button")[0].props.disabled, true);
  assert.equal(
    ofType(tree.props.children, "RowButton")[0].props.disabled,
    true,
  );
  assert.equal(
    text(
      byClass(scan({ libraries: [] }).tree.props.children, "v2-modal-hint")[0],
    ),
    "No enabled libraries",
  );
});

function disks(props = {}) {
  const calls = [];
  const tree = componentHarness(
    "dialog/TargetDisksDialog",
    {
      disks: [
        { name: "disk1", kind: "array", total: 1000, free: 400 },
        { name: "disk2", kind: "array", total: 1000, free: 900 },
        { name: "cache", kind: "pool", total: 500, free: 100 },
      ],
      excluded: ["disk2"],
      busy: false,
      change: (value) => calls.push(["change", value]),
      close: () => calls.push(["close"]),
      ...props,
    },
    {
      exportName: "TargetDisksDialog",
      modules: {
        "../../ui": {
          ICON: { label: 15, button: 16 },
          compactBytes: (n) => n + " B",
        },
        "../../i18n": {
          t: (key, values = {}) =>
            key.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? ""),
        },
        "../settings/Check": check,
      },
    },
  ).render();
  return { tree, calls };
}

test("target disks keep their choice and usage", () => {
  const { tree, calls } = disks();
  assert.equal(tree.props.id, "targetDisks");
  assert.equal(tree.props.title, "Target disks");
  // Only an array disk has a checkbox; checked = a target.
  const inputs = ofType(tree.props.children, "input");
  assert.deepEqual(plain(inputs.map((i) => i.props.checked)), [true, false]);
  inputs[0].props.onChange({ currentTarget: { checked: false } });
  inputs[1].props.onChange({ currentTarget: { checked: true } });
  assert.deepEqual(plain(calls), [
    ["change", ["disk2", "disk1"]],
    ["change", []],
  ]);
  // A pool is a plain line, "not a target".
  assert.match(
    text(ofType(tree.props.children, "li")[2]),
    /cache · Pool \(not a target\)/,
  );
  // The bar is named by its disk and filled with the used share.
  const bars = byClass(tree.props.children, "v2-disk-bar");
  assert.deepEqual(
    plain(bars.map((b) => [b.props["aria-label"], b.props.style["--v"]])),
    [
      ["Used space on disk1", "60"],
      ["Used space on disk2", "10"],
      ["Used space on cache", "80"],
    ],
  );
  assert.match(
    text(ofType(tree.props.children, "li")[0]),
    /600 B \/ 1000 B · 400 B free/,
  );
  // Done closes; busy locks the boxes.
  assert.deepEqual(plain(footButtons(tree)), [["Done", false, "v2-btn"]]);
  ofType(tree.props.foot, "button")[0].props.onClick();
  assert.deepEqual(plain(calls.at(-1)), ["close"]);
  assert.ok(
    ofType(disks({ busy: true }).tree.props.children, "input").every(
      (i) => i.props.disabled,
    ),
  );
});

function dialog(name, props, extra = {}) {
  const runtime = createHookRuntime(),
    requests = [];
  const view = componentHarness("PlacementDialogs", props, {
    exportName: name,
    browser: { AbortController },
    modules: {
      ...dialogModules,
      "preact/hooks": runtime.hooks,
      "../api": {
        api: async (path) => {
          requests.push(path);
          return extra.report ?? { shares: [] };
        },
      },
      "../hooks/usePolling": {
        usePolling: (run, next, deps) => requests.push(["poll", deps]),
      },
      "../tool-status": {
        placementStatusView: (item) => ({
          tone: "ok",
          text: item.scanStatus,
          long: "",
        }),
      },
      "../placement": {
        placementCompact: (item) => item.scanStatus === "ok",
        placementDuration: (n) => Math.round(n) + " s",
        placementItemStatus: (item) => item.jobStatus || item.scanStatus,
        placementStatusLabels: { split: "Several disks" },
      },
    },
  });
  return { requests, render: () => runtime.settle(() => view.render()) };
}

const scanReport = (extra = {}) => ({
  startedAt: "2026-01-02T03:00:00Z",
  finishedAt: "2026-01-02T03:01:00Z",
  checked: 12,
  several: 3,
  smallFiles: 1,
  moveBytes: 1000,
  unstartable: 2,
  counts: { several: 4 },
  targets: [
    {
      target: "disk1",
      items: 3,
      smallFiles: 1,
      mediaFiles: 2,
      moveBytes: 900,
      sources: { disk2: 600 },
    },
  ],
  roots: [
    {
      arrPath: "/tv",
      instances: ["sonarr"],
      share: "tv",
      items: 5,
      scanned: 5,
      one_disk: 1,
      several_disks: 2,
      seasons_spread: 1,
    },
  ],
  ...extra,
});

function report(props = {}, extra = {}) {
  const calls = [];
  const d = dialog(
    "PlacementSummaryDialog",
    {
      scan: scanReport(),
      scanning: false,
      counts: undefined,
      busy: false,
      close: () => calls.push(["close"]),
      filter: (target) => calls.push(["filter", target]),
      select: (target) => calls.push(["select", target]),
      rootFilter: (share, status) => calls.push(["rootFilter", share, status]),
      openSettings: () => calls.push(["settings"]),
      ...props,
    },
    extra,
  );
  return { ...d, tree: d.render(), calls };
}

test("the placement report keeps filters, selection and shares", async () => {
  const { tree, calls } = report({ scanning: true });
  assert.equal(tree.props.id, "placementReport");
  assert.equal(tree.props.title, "Scan report");
  // The scan time first, with its ISO value as title, then the numbers.
  const [keyValues] = ofType(tree.props.children, "KeyValues");
  const rows = keyValues.props.rows;
  assert.deepEqual(plain(rows.map((r) => [r.key, r.label])), [
    ["scanned", "Scanned at"],
    ["duration", "Duration"],
    ["checked", "Items checked"],
    ["several", "Several disks"],
    ["small", "Small files only"],
    ["size", "Move size"],
    ["duration-estimate", "Estimated duration"],
    ["unstartable", "Cannot move"],
  ]);
  assert.equal(rows[0].value.props.title, "2026-01-02T03:01:00Z");
  assert.equal(rows[3].value, "4");
  assert.equal(rows[6].value, "≈ 0 s");
  // The notice of a scan running behind the report.
  assert.match(
    text(byClass(tree.props.children, "v2-notice")[0]),
    /A new scan is running\. This report shows the previous scan\./,
  );
  assert.equal(byClass(report().tree.props.children, "v2-notice").length, 0);
  // The live count of several disks wins over the scan's.
  assert.equal(
    report({ counts: { several: 9 } }).tree.props.children.props.children[0]
      .props.rows[3].value,
    "9",
  );
  // Folders: a table with a count button that filters by root.
  const buttons = ofType(tree.props.children, "button");
  const count = buttons.find((b) => text(b) === "3");
  count.props.onClick();
  assert.deepEqual(plain(calls[0]), ["rootFilter", "tv", "several"]);
  assert.ok(ofType(tree.props.children, "RootScanNotice").length > 0);
  // By target disk: the tag filters, Select all selects (busy locks it).
  const target = ofType(tree.props.children, "ToolDiskTag")[0];
  assert.equal(target.props.disk, "disk1");
  buttons
    .find(
      (b) =>
        classes(b).includes("v2-text-btn") && ofType(b, "ToolDiskTag").length,
    )
    .props.onClick();
  assert.deepEqual(plain(calls[1]), ["filter", "disk1"]);
  const select = buttons.find((b) => text(b) === "Select all");
  select.props.onClick({ stopPropagation() {} });
  assert.deepEqual(plain(calls[2]), ["select", "disk1"]);
  assert.equal(
    ofType(report({ busy: true }).tree.props.children, "button").find(
      (b) => text(b) === "Select all",
    ).props.disabled,
    true,
  );
  assert.equal(ofType(tree.props.children, "TableScroll").length, 2);
  // Close.
  assert.deepEqual(plain(footButtons(tree)), [["Close", false, "v2-btn"]]);
  // A share-first scan hands its shares to the shares report.
  const first = report({
    scan: scanReport({ shares: [{ shareDir: "tv" }] }),
  }).tree;
  assert.ok(nodes(first).some((n) => n.type?.name === "PlacementSharesReport"));
  assert.equal(byClass(first, "v2-modal-h").length, 1);
});

test("the shares report reads the live report and offers the settings", async () => {
  const calls = [];
  const d = dialog(
    "PlacementSharesReport",
    {
      scan: scanReport({
        shares: [
          { shareDir: "tv", devices: ["disk1"], deviceErrors: [], notice: "" },
        ],
        rootFolders: [
          {
            arrPath: "/x",
            instances: ["sonarr"],
            shareDir: "",
            status: "disabled",
          },
        ],
      }),
      rootFilter: (share, status) => calls.push(["rootFilter", share, status]),
      openSettings: () => calls.push(["settings"]),
    },
    {
      report: {
        shares: [
          {
            shareDir: "tv",
            cache: { useCache: "yes" },
            counts: {
              all: 5,
              several: 2,
              one_disk: 3,
              empty: 0,
              no_arr: 0,
              not_found: 0,
            },
          },
        ],
      },
    },
  );
  let tree = d.render();
  assert.deepEqual(d.requests, ["placement/report"]);
  assert.match(text(tree), /Loading …/);
  await settle();
  tree = d.render();
  assert.match(text(tree), /Cache: Yes/);
  ofType(tree, "button")
    .find((b) => text(b) === "Open in settings")
    .props.onClick();
  const count = ofType(tree, "button").find((b) => text(b) === "2");
  count.props.onClick();
  assert.deepEqual(plain(calls), [
    ["settings"],
    ["rootFilter", "tv", "several"],
  ]);
  assert.match(text(tree), /Root folder \/x \(sonarr\) is not scanned\./);
  assert.ok(ofType(tree, "th").some((n) => text(n) === "Share folder"));
  assert.equal(ofType(tree, "TableScroll").length, 2);
});

const placementItem = (extra = {}) => ({
  id: 5,
  title: "Breaking Bad · Series folder",
  season: -1,
  rel: "tv/Breaking Bad",
  scanStatus: "split",
  target: "disk1",
  moveBytes: 300,
  message: "",
  warnings: ["Careful"],
  disks: {
    disk1: { bytes: 700, files: 2, dirs: 0 },
    disk2: { bytes: 300, files: 2, dirs: 0 },
  },
  files: [
    { disk: "disk1", rel: "b.mkv", size: 5 },
    { disk: "disk1", rel: "a.mkv", size: 9 },
    { disk: "disk2", rel: "c.mkv", size: 1 },
  ],
  ...extra,
});

function details(item = placementItem(), props = {}) {
  const calls = [];
  const d = dialog("PlacementDetailDialog", {
    item,
    disks: [{ name: "disk1", free: 5000 }],
    diskRoot: "/unraid",
    start: () => calls.push(["start"]),
    terminal: () => calls.push(["terminal"]),
    disabled: false,
    close: () => calls.push(["close"]),
    ...props,
  });
  return { ...d, tree: d.render(), calls };
}

test("placement details keep tabs, sort, pages and start", () => {
  const d = details();
  let tree = d.tree;
  assert.equal(tree.props.id, "placementDetails");
  assert.equal(tree.props.title, "Breaking Bad · Series folder");
  assert.equal(
    text(byClass(tree.props.children, "v2-path")[0]),
    "tv/Breaking Bad",
  );
  // The disks as tabs with their size; the panel is named by the tab.
  const [tabs] = ofType(tree.props.children, "Tabs");
  assert.equal(tabs.props.id, "placement-disks");
  assert.equal(tabs.props.label, "Disks");
  assert.equal(tabs.props.value, "disk1");
  assert.deepEqual(
    plain(tabs.props.items.map((i) => [i.value, text(i.label)])),
    [
      ["disk1", "disk1700 B"],
      ["disk2", "disk2300 B"],
    ],
  );
  assert.deepEqual(
    plain(
      tabs.props.items.map((i) => byClass(i.label, "v2-tabs-count").length),
    ),
    [1, 1],
  );
  const panel = nodes(tree).find((n) => n.props?.role === "tabpanel");
  assert.equal(panel.props.id, "placement-disks-panel-disk1");
  assert.equal(panel.props["aria-labelledby"], "placement-disks-tab-disk1");
  // Sorted by path, each press of a header sorts and returns to page 1.
  const paths = (t) =>
    ofType(ofType(t, "tbody")[0], "tr").map((r) => text(ofType(r, "td")[0]));
  assert.deepEqual(paths(tree), ["a.mkv", "b.mkv"]);
  const headers = ofType(tree, "SortHeader");
  assert.deepEqual(plain(headers.map((h) => [h.props.field, h.props.label])), [
    ["path", "Relative path"],
    ["size", "Size"],
    ["placement", "Placement"],
  ]);
  headers[1].props.onSort("size");
  tree = d.render();
  assert.deepEqual(paths(tree), ["b.mkv", "a.mkv"]);
  assert.deepEqual(plain(ofType(tree, "SortHeader")[1].props.sort), {
    field: "size",
    direction: "asc",
  });
  ofType(tree, "SortHeader")[1].props.onSort("size");
  assert.deepEqual(paths(d.render()), ["a.mkv", "b.mkv"]);
  // The pager counts the files of the disk, 100 to a page.
  const [pager] = ofType(tree, "PageNav");
  assert.equal(pager.props.pages, 1);
  assert.equal(pager.props.summary, "1/100/2");
  // Another disk: its files, page 1.
  ofType(tree, "Tabs")[0].props.change("disk2");
  tree = d.render();
  assert.deepEqual(paths(tree), ["c.mkv"]);
  // Key values: the target, the move size and the free space before and
  // after; the warnings below.
  const keys = ofType(tree, "KeyValues")[0].props.rows;
  assert.deepEqual(plain(keys.map((r) => [r.key, text(r.value)])), [
    ["target", ""],
    ["size", "300 B"],
    ["before", "5000 B"],
    ["after", "4700 B"],
  ]);
  assert.match(text(byClass(tree, "v2-modal-list").at(-1)), /Careful/);
  // The foot: Terminal, Close, Start (primary); Start locked as in 1.7.0.
  assert.deepEqual(plain(footButtons(tree)), [
    ["Terminal", false, "v2-btn"],
    ["Close", false, "v2-btn"],
    ["Start", false, "v2-btn v2-btn--primary"],
  ]);
  const [terminal, , start] = ofType(tree.props.foot, "button");
  terminal.props.onClick();
  start.props.onClick();
  assert.deepEqual(plain(d.calls), [["terminal"], ["start"]]);
  assert.equal(
    ofType(
      details(placementItem(), { disabled: true }).tree.props.foot,
      "button",
    )[2].props.disabled,
    true,
  );
  // A compact entry has no tabs, only where it is located.
  const compact = details(
    placementItem({
      scanStatus: "ok",
      disks: { disk1: { bytes: 0, files: 0, dirs: 0 } },
    }),
  ).tree;
  assert.equal(ofType(compact, "Tabs").length, 0);
  assert.match(
    text(ofType(compact, "KeyValues")[0].props.rows[0].value),
    /Located on disk1/,
  );
  // A folder that was not found lists the paths checked.
  const missing = details(
    placementItem({ scanStatus: "not_found", message: "Gone" }),
  ).tree;
  assert.match(
    text(byClass(missing, "v2-modal-list")[0]),
    /\/unraid\/disk1\/tv\/Breaking Bad/,
  );
});

function status(item, props = {}) {
  const calls = [];
  const d = dialog("PlacementStatusDialog", {
    item,
    service: {
      ready: true,
      state: { known: true, mover: false, parity: false },
    },
    busy: false,
    recheck: () => calls.push(["recheck"]),
    close: () => calls.push(["close"]),
    openFiles: (path) => calls.push(["files", path]),
    ...props,
  });
  return { ...d, tree: d.render(), calls };
}

test("placement status keeps its checks, reasons and links", () => {
  const unchecked = status(placementItem()).tree;
  assert.equal(unchecked.props.id, "placementStatus");
  assert.equal(unchecked.props.title, "Status");
  // Nine checks stand in their rows before and after a check.
  let rows = ofType(unchecked.props.children, "CheckRow");
  assert.equal(rows.length, 9);
  assert.deepEqual(
    plain(
      rows
        .slice(0, 3)
        .map((r) => [
          r.props.label,
          r.props.ok,
          r.props.warning,
          r.props.detail,
        ]),
    ),
    [
      ["Unraid reachable", true, null, null],
      ["Target writable", false, true, "Not checked"],
      ["Enough free space", false, true, "Not checked"],
    ],
  );
  assert.equal(rows.at(-1).props.label, "Mover / parity state");
  assert.equal(rows.at(-1).props.detail, "Idle");
  assert.match(text(unchecked.props.children), /Not checked yet/);
  assert.equal(ofType(unchecked.props.children, "StatusTag").length, 1);
  const check = {
    reachable: true,
    writable: true,
    freeSpace: true,
    unchanged: true,
    noConflict: true,
    readable: true,
    removable: false,
    owner: true,
    ownerChanges: 3,
    checkedAt: "2026-01-02T03:04:05Z",
    moreFiles: 4,
    files: [
      {
        disk: "disk2",
        rel: "z.mkv",
        uid: 1,
        gid: 2,
        mode: 0o644,
        reason: "special",
      },
      {
        disk: "disk1",
        rel: "a.mkv",
        uid: 0,
        gid: 0,
        mode: 0o600,
        reason: "unreadable",
      },
    ],
  };
  const d = status(placementItem({ check }));
  rows = ofType(d.tree.props.children, "CheckRow");
  assert.equal(rows.length, 9);
  assert.deepEqual(plain(rows.map((r) => r.props.ok)), [
    true,
    true,
    true,
    true,
    true,
    true,
    false,
    true,
    true,
  ]);
  assert.equal(rows[7].props.warning, true);
  assert.match(rows[7].props.detail, /3 files will be owned by 99:100/);
  assert.match(text(d.tree.props.children), /… and 4 more/);
  // The reasons are sortable and listed as a table of 50 at most.
  const files = (tree) =>
    ofType(ofType(tree, "tbody")[0], "tr").map((r) => text(ofType(r, "td")[1]));
  assert.deepEqual(files(d.tree), ["z.mkv", "a.mkv"]);
  const heads = ofType(d.tree, "SortHeader");
  assert.deepEqual(plain(heads.map((h) => h.props.field)), [
    "disk",
    "file",
    "owner",
    "permissions",
    "reason",
  ]);
  heads[1].props.onSort("file");
  assert.deepEqual(files(d.render()), ["a.mkv", "z.mkv"]);
  ofType(d.render(), "SortHeader")[1].props.onSort("file");
  assert.deepEqual(files(d.render()), ["z.mkv", "a.mkv"]);
  // The foot: Check in Files & permissions (closes, then opens), Check
  // again, Close.
  assert.deepEqual(plain(footButtons(d.tree).map((b) => b[0])), [
    "Check in Files & permissions",
    "Check again",
    "Close",
  ]);
  const [link, again] = ofType(d.tree.props.foot, "button");
  link.props.onClick();
  again.props.onClick();
  assert.deepEqual(plain(d.calls), [
    ["close"],
    ["files", "tv/Breaking Bad"],
    ["recheck"],
  ]);
  assert.deepEqual(
    plain(footButtons(status(placementItem()).tree).map((b) => b[0])),
    ["Check again", "Close"],
  );
  assert.equal(
    ofType(status(placementItem(), { busy: true }).tree.props.foot, "button")[0]
      .props.disabled,
    true,
  );
});

test("the placement log follows its output", () => {
  const polled = [];
  const d = dialog("PlacementLogDialog", {
    item: placementItem({ jobStatus: "running", progress: 40, message: "" }),
    close() {},
  });
  const tree = d.render();
  assert.equal(tree.props.id, "placementLog");
  assert.equal(tree.props.title, "Disk placement log");
  // The terminal, named and empty until output arrives.
  const [terminal] = ofType(tree.props.children, "Terminal");
  assert.equal(terminal.props.label, "Terminal");
  assert.equal(text(terminal), "No output yet.");
  // The status line in the foot: progress and the message.
  const lead = tree.props.foot.props.lead;
  assert.equal(lead.props.role, "status");
  assert.equal(ofType(lead, "ProgressCell")[0].props.status, "running");
  assert.equal(text(lead), "Moving · 40 %");
  // Polling as in 1.7.0: the item's log, the item as its dependency.
  assert.deepEqual(plain(d.requests), [["poll", [5]]]);
  // A finished log shows no progress.
  const done = dialog("PlacementLogDialog", {
    item: placementItem({ jobStatus: "succeeded" }),
    close() {},
  }).render();
  assert.equal(text(done.props.foot.props.lead), "Finished");
  assert.equal(ofType(done.props.foot.props.lead, "ProgressCell").length, 0);
  assert.deepEqual(plain(footButtons(done)), [["Close", false, "v2-btn"]]);
  void polled;
});

test("the library chunk holds no placement dialog code", async () => {
  // The placement dialogs live in their own chunk, imported by the page
  // that opens them, never in the library chunk (Concept, input 6; 5b I2).
  const { build } = await import("vite");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const result = await build({
    root,
    logLevel: "silent",
    build: { write: false },
  });
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap((r) => r.output)
    .filter((o) => o.type === "chunk");
  const library = chunks.find((c) =>
    /^assets\/Library-[\w-]{8}\.js$/.test(c.fileName),
  );
  assert.ok(library, "Library chunk");
  const has = (chunk, path) =>
    chunk.moduleIds.some((id) => id.endsWith("/src/" + path));
  for (const path of [
    "components/PlacementDialogs.tsx",
    "components/PlacementScanDialog.tsx",
    "components/dialog/TargetDisksDialog.tsx",
  ])
    assert.equal(has(library, path), false, path);
  const source = src("components/PlacementDialogs.tsx");
  for (const name of [
    "PlacementSummaryDialog",
    "PlacementDetailDialog",
    "PlacementStatusDialog",
    "PlacementLogDialog",
  ]) {
    assert.match(source, new RegExp("export function " + name));
    assert.doesNotMatch(library.code, new RegExp(name));
  }
});

// Phase 5d, Task 9, fix round 1.
test("details keep the pager above the files so paging moves nothing", () => {
  const tree = details().tree;
  const panel = nodes(tree).find((n) => n.props?.role === "tabpanel");
  const order = nodes(panel.props.children)
    .map((n) => n.type)
    .filter((t) => t === "PageNav" || t === "TableScroll");
  assert.deepEqual(plain(order), ["PageNav", "TableScroll"]);
});

test("the scan coverage help keeps its alert icon", () => {
  assert.match(
    src("components/RootCoverage.tsx"),
    /<HelpTip[^>]*tone="notice"/,
  );
  assert.match(src("components/list/HelpTip.tsx"), /CircleAlert/);
});
