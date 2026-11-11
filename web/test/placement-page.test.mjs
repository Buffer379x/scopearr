import test from "node:test";
import assert from "node:assert/strict";
import {
  loadSource,
  nodes,
  PRESENTATION_MODULES,
  text,
} from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";
import { src } from "./helpers/sources.mjs";
import * as instances from "../src/instances.ts";

// The Disk placement page on the tool blocks (Phase 5b, task 7;
// docs/STYLEGUIDE.md, Part 1, 11.1 and 11.2): DiskPlacementPage runs as
// real code with the hook runtime and the real placement rules
// (placement, placement-messages, tool-list, tool-status, tool-filters);
// the blocks it places are named stubs, so a tree shows what they receive,
// and the requests, questions, toasts and route changes are recorded.

const plain = (value) =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value));
// Values cross a VM realm; compare their JSON shape.
const same = (actual, expected, message) =>
  assert.deepEqual(plain(actual), plain(expected), message);
// t keeps a placeholder without its value, as CountTool's text needs.
const t = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (match, name) =>
    name in values ? String(values[name]) : match,
  );
const i18n = { t, useI18n: () => ({ locale: "en" }) };
const spec = loadSource("mux-spec.ts", {
  modules: { "./languages.ts": { audioLanguage: () => null } },
});
const toolFilters = loadSource("tool-filters.ts");
const toolList = loadSource("tool-list.ts", {
  modules: {
    "./i18n": i18n,
    "./mux-spec": spec,
    "./tool-filters": toolFilters,
  },
});
const placement = loadSource("placement.ts");
const messages = loadSource("placement-messages.ts");
const fileCheck = loadSource("filecheck.ts");
const columns = loadSource("tool-columns.ts", {
  modules: {
    "./filecheck": fileCheck,
    "./mux-spec": spec,
    "./placement": placement,
    "./ui": { ICON: { arrow: 11 } },
  },
});
const toolStatus = loadSource("tool-status.ts", {
  modules: {
    "./filecheck": fileCheck,
    "./mux-spec": spec,
    "./placement": placement,
    "./placement-messages": messages,
    "./tool-columns": columns,
  },
});
const ICON = {
  arrow: 11,
  chip: 12,
  label: 15,
  row: 15,
  button: 16,
  large: 18,
  empty: 28,
};
const ui = {
  ICON,
  compactBytes: (n) => n + " B",
  count: (n) => String(n),
};
// The real band buttons, for what they show and how they are named.
const band = loadSource("components/tools/ScanButton.tsx", {
  modules: { "../../i18n": i18n, "../../ui": ui },
});

const disks = (...entries) =>
  Object.fromEntries(
    entries.map(([disk, bytes]) => [disk, { bytes, files: 1, dirs: 1 }]),
  );
function item(id, title, extra = {}) {
  return {
    id,
    itemKey: "item" + id,
    service: "sonarr",
    instance: "Sonarr",
    mediaId: id,
    season: 0,
    title,
    rel: "shows/" + title,
    scanStatus: "split",
    kind: "media_files",
    target: "disk1",
    totalBytes: id * 1000,
    moveBytes: id * 100,
    moveFiles: id,
    disks: disks(["disk1", 20], ["disk3", 10]),
    warnings: [],
    jobStatus: "",
    progress: 0,
    bytesDone: 0,
    message: "",
    updatedAt: "",
    ...extra,
  };
}
// The C+ rows and two more: startable, on one disk, waiting for the mover,
// moved (without an Arr entry), moving, failed (startable again).
const ITEMS = () => [
  item(1, "Breaking Bad"),
  item(2, "Dark", {
    scanStatus: "ok",
    target: "",
    disks: disks(["disk2", 5]),
  }),
  item(3, "Severance", {
    jobStatus: "queued",
    message: "Waiting: mover is running",
    disks: disks(["disk1", 9], ["disk2", 8], ["disk4", 7]),
  }),
  item(4, "Dune: Part Two", {
    jobStatus: "succeeded",
    service: "",
    instance: "",
    rel: "movies/Dune Part Two (2024)",
    disks: disks(["disk3", 6]),
  }),
  item(5, "The Bear", {
    jobStatus: "running",
    progress: 64,
    target: "disk2",
    disks: disks(["disk2", 30], ["cache", 3]),
  }),
  item(6, "Lost", { jobStatus: "failed" }),
];
const startable = (items) =>
  items.filter((entry) => placement.placementStartable(entry)).map((i) => i.id);
const SCAN = {
  running: false,
  startedAt: "2026-11-01T09:29:48Z",
  finishedAt: "2026-11-01T09:30:00Z",
  duration: 12,
  checked: 6,
  total: 6,
  several: 4,
  unstartable: 0,
  disk: "",
  counts: { all: 6, several: 4, one_disk: 1 },
  options: { shareDirs: {} },
};
const activityOf = (extra = {}) => ({
  scan: SCAN,
  report: SCAN,
  queued: 0,
  running: 0,
  moved: 1,
  bytesDone: 0,
  totalBytes: 0,
  fileWork: "",
  counts: { all: 6, several: 4, one_disk: 1, open: 3 },
  ...extra,
});
const serviceOf = (extra = {}) => ({
  enabled: true,
  ready: true,
  disks: [
    {
      name: "cache",
      kind: "pool",
      total: 500,
      free: 345,
      writable: true,
      excluded: false,
    },
    {
      name: "disk2",
      kind: "array",
      total: 1000,
      free: 320,
      writable: true,
      excluded: false,
      standby: true,
    },
    {
      name: "disk1",
      kind: "array",
      total: 1000,
      free: 100,
      writable: true,
      excluded: false,
      standby: false,
    },
  ],
  state: { known: true, mover: false, parity: false },
  fileWork: "",
  ...extra,
});

// The page with its boundaries recorded in `log`. `poll()` answers the
// page's three requests (placement/scan, unraid/status, placement/items)
// with h.activity, h.service and h.items; `render()` settles the page.
function placementPage({
  items = ITEMS(),
  activity = activityOf(),
  service = serviceOf(),
  filters = {},
  sort = null,
  settings = {},
  answers = {},
  results = {},
} = {}) {
  const log = [];
  const runtime = createHookRuntime();
  const route = {
    filters: { q: "", statuses: [], targets: [], kinds: [], ...filters },
    sort,
    page: 1,
  };
  let poll;
  const lazy = [];
  const document = { activeElement: null, body: { tag: "body" } };
  const answer = async (kind, ...args) => {
    log.push([kind, ...args]);
    return answers[kind] ?? true;
  };
  const modules = {
    "preact/hooks": runtime.hooks,
    "../api": {
      api: async (path, method = "GET", body) => {
        if (method === "GET" && path === "placement/scan") return h.activity;
        if (method === "GET" && path === "unraid/status") return h.service;
        if (method === "GET" && path.startsWith("placement/items?")) {
          h.lists.push(path);
          if (h.answer) return h.answer(path);
          return {
            items: h.items,
            total: h.items.length,
            selectableIds: startable(h.items),
            shares: { movies: 4, tv: 2 },
            ...h.results,
          };
        }
        log.push(["api", path, method, plain(body ?? null)]);
        const id = /^placement\/items\/(\d+)$/.exec(path)?.[1];
        if (method === "GET" && id)
          return { ...h.items.find((entry) => entry.id === Number(id)) };
        return {};
      },
    },
    "../browser-storage": {
      removePreference: (key) => log.push(["removePreference", key]),
    },
    "../confirmation": {
      confirmAction: (...args) => answer("confirmAction", ...args),
    },
    // The real focus return of the drawer (F-M4), on the page's document.
    "../hooks/useDrawerAnchor": loadSource("hooks/useDrawerAnchor.ts", {
      modules: { "preact/hooks": runtime.hooks },
      browser: { document },
    }),
    "../hooks/useLazyChunk": {
      useLazyChunk: (chunk, open, close) => {
        lazy.push({ chunk, open, close });
        return open ? "Drawer" : null;
      },
    },
    "../hooks/usePolling": {
      usePolling: (load, interval, deps, options) => {
        poll = load;
        h.polling = { interval, deps, options };
      },
    },
    "../hooks/useRowRemoval": { useRowRemoval: () => h.removal },
    "../hooks/useToolPageState": {
      useToolPageState: (tool, allowed, options) => {
        h.pageState = { tool, allowed, options };
        return {
          filters: route.filters,
          changeFilters: (patch) => {
            log.push(["filters", plain(patch)]);
            route.filters = { ...route.filters, ...patch };
            route.page = 1;
          },
          sort: route.sort,
          sortBy: (field) => log.push(["sort", field]),
          page: route.page,
          setPage: (page) => {
            log.push(["page", page]);
            route.page = page;
          },
        };
      },
    },
    "../hooks/useToolPresets": {
      useToolPresets: (service, query, apply, shares) => {
        h.presetArgs = { service, query: String(query), apply, shares };
        return h.presets;
      },
    },
    "../i18n": i18n,
    "../instances": instances,
    "../placement": placement,
    "../placement-messages": messages,
    "../tool-feedback": {
      reportError: (error) => log.push(["reportError", String(error)]),
      useScanErrorToast: (...args) => {
        h.scanToast = args;
      },
    },
    "../tool-filters": toolFilters,
    "../tool-list": toolList,
    "../tool-status": toolStatus,
    "../ui": ui,
    "../use-tool-table": {
      useToolColumnStyle: (...args) => {
        h.styleArgs = args;
        return { "--tt-min": "1200px" };
      },
    },
    "./list/TableCard": { CountTool: "CountTool" },
    "./Pagination": {
      itemRange: (page, limit, total) => `${page}:${limit}:${total}`,
    },
    "./PlacementDialogs": {
      PlacementDetailDialog: "PlacementDetailDialog",
      PlacementLogDialog: "PlacementLogDialog",
      PlacementStatusDialog: "PlacementStatusDialog",
      PlacementSummaryDialog: "PlacementSummaryDialog",
    },
    "./PlacementScanDialog": { PlacementScanDialog: "PlacementScanDialog" },
    "./SortableHeader": {
      formatTableSort: (sort) =>
        sort ? sort.field + ":" + sort.direction : "",
    },
    "./tools/DiskCards": { DiskCards: "DiskCards" },
    "./tools/drawer-chunk": { toolDrawerChunk: "toolDrawerChunk" },
    "./tools/ScanButton": {
      ReportButton: "ReportButton",
      ScanButton: "ScanButton",
    },
    "./tools/ToolCard": { ToolCard: "ToolCard" },
    "./tools/ToolTable": { ToolTable: "ToolTable" },
  };
  const { DiskPlacementPage } = loadSource("components/DiskPlacementPage.tsx", {
    modules,
    browser: { document, clearTimeout },
    stubs: PRESENTATION_MODULES,
  });
  const props = {
    settings: { pageSize: 50, ...settings },
    changed: async () => log.push(["changed"]),
    setup: () => log.push(["setup"]),
    openFiles: (path) => log.push(["openFiles", path]),
    route: { query: "", fromHistory: false, replace() {} },
  };
  const h = {
    log,
    route,
    lazy,
    document,
    props,
    items,
    activity,
    service,
    results,
    lists: [],
    removal: {
      removing: new Set(),
      hidden: new Set(),
      remove: async (id, request) => {
        log.push(["removal", id]);
        await request();
      },
    },
    presets: {
      presets: [{ id: 3, name: "Split", query: "status=several" }],
      selectedPreset: undefined,
      applyPreset() {},
      reset() {},
      savePreset() {},
      deletePreset() {},
      dialogs: null,
    },
    render: () => (h.tree = runtime.settle(() => DiskPlacementPage(props))),
    async poll() {
      await poll(new AbortController().signal);
      return h.render();
    },
    unmount: () => runtime.unmount(),
  };
  h.render();
  return h;
}

const ofType = (tree, type) => nodes(tree).filter((n) => n.type === type);
const one = (tree, type) => {
  const found = ofType(tree, type);
  assert.equal(found.length, 1, type);
  return found[0];
};
const classes = (node) =>
  typeof node?.props?.class === "string" ? node.props.class.split(" ") : [];
const byClass = (tree, name) =>
  nodes(tree).filter((n) => classes(n).includes(name));
const header = (h) => one(h.tree, "PageHeader");
const actions = (h) => header(h).props.actions;
const scanButton = (h) => one(actions(h), "ScanButton").props;
const reportButton = (h) => one(actions(h), "ReportButton").props;
const card = (h) => one(h.tree, "ToolCard");
const table = (h) => one(card(h).props.children, "ToolTable");
const column = (h, key) =>
  table(h).props.columns.find((entry) => entry.key === key);
const rowOf = (h, id) => h.items.find((entry) => entry.id === id);
const cell = (h, key, id) => column(h, key).cell(rowOf(h, id));
const buttons = (tree) =>
  ofType(tree, "RowButton").map((button) => button.props);
const tools = (h) => nodes(card(h).props.tools);
const tool = (h, name) =>
  tools(h).find(
    (node) =>
      (node.type === "CountTool" && node.props.text === name) ||
      (node.type === "button" && node.props.title === name),
  );
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
// Every class name the tree builds, the blocks' props included.
function allClasses(value, seen = new Set()) {
  if (Array.isArray(value)) value.forEach((v) => allClasses(v, seen));
  else if (value && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    for (const name of classes(value)) seen.add("class:" + name);
    for (const prop of Object.values(value.props ?? {}))
      if (prop && typeof prop === "object") allClasses(prop, seen);
  }
  return [...seen].filter((v) => typeof v === "string").map((v) => v.slice(6));
}

test("the placement page builds its disk row and card from the tool blocks", async () => {
  const h = placementPage();
  // The 1.7.0 page state, presets, scan error toast and the obsolete
  // preference.
  assert.equal(h.pageState.tool, "placement");
  same(h.pageState.options, { resetPageOnSort: true });
  same(h.pageState.allowed.kinds, ["small_files", "media_files"]);
  assert.equal(h.presetArgs.service, "tool:placement");
  assert.ok(
    h.log.some(
      ([kind, key]) =>
        kind === "removePreference" && key === "scopearr-placement-collapsed",
    ),
  );
  assert.equal(h.scanToast[0], "scopearr-placement-seen-scan-error");
  same(h.scanToast[3], { source: ["placement"] });
  assert.equal(
    h.scanToast[2]("disk1 unavailable"),
    messages.placementMessage("disk1 unavailable", t),
  );
  // Polling as in 1.7.0: 1s while a scan or a move runs, else 10s.
  assert.equal(h.polling.interval(activityOf()), 10000);
  assert.equal(h.polling.interval(activityOf({ queued: 1 })), 1000);
  assert.equal(
    h.polling.interval(activityOf({ scan: { ...SCAN, running: true } })),
    1000,
  );
  // The band: the title, its summary and Scan report, then Scan.
  assert.equal(header(h).props.title, "Disk placement");
  assert.equal(header(h).props.metaTitle, "Open items");
  same(
    nodes(actions(h))
      .filter(
        (node) => typeof node.type === "string" && /^[A-Z]/.test(node.type),
      )
      .map((node) => node.type),
    ["ReportButton", "ScanButton"],
  );
  // Header → page: the disk row, then the card “Items”.
  const [page] = byClass(h.tree, "v2-list-page");
  same(
    [page.props.children]
      .flat()
      .filter(Boolean)
      .map((block) => block.type),
    ["DiskCards", "ToolCard"],
  );
  // Before the first answer: placeholder disk cards, the pending empty
  // state of the same height and the busy card.
  assert.equal(one(h.tree, "DiskCards").props.disks, null);
  let empty = one(card(h).props.children, "ListEmpty");
  assert.equal(empty.props.pending, true);
  assert.equal(card(h).props.busy, true);
  assert.equal(header(h).props.meta, "0 open");
  await h.poll();
  assert.equal(header(h).props.meta, "3 open");
  const c = card(h).props;
  assert.equal(c.id, "placement");
  assert.equal(c.title, "Items");
  assert.equal(c.total, 6);
  assert.equal(c.busy, false);
  assert.equal(c.activity, "");
  assert.equal(c.allLabel, "All items");
  same(c.search, {
    label: "Title or folder",
    placeholder: "Search title or folder …",
    value: "",
  });
  same(c.csv, { href: "/api/placement/export.csv?q=", enabled: true });
  // Help: “Last scan” (raw: the mover and parity state, the time and the
  // duration) and “How scanning works”.
  same(
    c.help.map((section) => [section.heading, !!section.raw]),
    [
      ["Last scan", true],
      ["How scanning works", false],
    ],
  );
  assert.match(
    c.help[0].text,
    /^Mover and parity are idle\nLast scan: .+ \(12 s\)$/,
  );
  assert.equal(
    c.help[1].text,
    "Reads folder metadata only. Disks may spin up if their directory data is not cached.",
  );
  assert.equal(c.pager.summary, "1:50:6");
  same([c.pager.page, c.pager.pages], [1, 1]);
  assert.equal(ofType(c.children, "ListEmpty").length, 0);
  // The table: the 1.7.0 columns of the settings without the selection,
  // which ToolTable adds; Remove is named Actions (ruling R-E).
  same(
    table(h).props.columns.map((entry) => [entry.key, entry.label]),
    [
      ["actions", "Info"],
      ["title", "Title"],
      ["service", "Service"],
      ["size", "Size"],
      ["disks", "Disks"],
      ["target", "Target"],
      ["move", "Move"],
      ["kind", "Kind"],
      ["status", "Status"],
      ["progress", "Progress"],
      ["remove", "Actions"],
    ],
  );
  same(
    table(h)
      .props.columns.filter((entry) => entry.sort)
      .map((entry) => entry.sort),
    [...placement.placementSortable],
  );
  assert.equal(column(h, "actions").info, true);
  assert.equal(column(h, "title").grow, true);
  same(
    table(h)
      .props.columns.filter((entry) => entry.wide)
      .map((entry) => entry.key),
    ["disks", "status"],
  );
  same(
    table(h)
      .props.columns.filter((entry) => entry.numeric)
      .map((entry) => entry.key),
    ["size", "move"],
  );
  // The widths from the labels and the tool's status texts.
  same(table(h).props.style, { "--tt-min": "1200px" });
  same(h.styleArgs[0], placement.placementOrderedColumns(null));
  assert.equal(h.styleArgs[1], "placement");
  assert.equal(h.styleArgs[2], placement.placementColumnLabels);
  same(h.styleArgs[3], { info: 2, actions: 2, infoPhone: 1, actionsPhone: 1 });
  // The settings' columns, in their order.
  const custom = placementPage({
    settings: {
      placementColumnOrder: ["title", "status", "actions", "remove"],
      placementVisibleColumns: ["select", "title", "status", "remove"],
    },
  });
  await custom.poll();
  same(
    table(custom).props.columns.map((entry) => entry.key),
    ["title", "status", "remove"],
  );
  // Sorting goes to the route (useToolPageState).
  table(h).props.onSort("size");
  same(h.log.at(-1), ["sort", "size"]);
  // Without a scan: only “How scanning works”.
  const fresh = placementPage({
    activity: activityOf({ scan: { running: false }, report: undefined }),
  });
  await fresh.poll();
  same(
    card(fresh).props.help.map((section) => section.heading),
    ["How scanning works"],
  );
  // No 1.7.0 page part is built.
  const built = allClasses(h.tree);
  for (const legacy of [
    "filter-panel",
    "placement-panel",
    "results-heading",
    "results-tools",
    "tool-table",
    "placement-table",
    "library-section",
    "tool-activity",
    "scan-ready",
    "notice",
  ])
    assert.ok(!built.includes(legacy), legacy);
  assert.ok(built.includes("v2-list-page"));
});

test("disk cards show usage, pools, the target and standby", async () => {
  const h = placementPage();
  assert.equal(one(h.tree, "DiskCards").props.disks, null);
  await h.poll();
  const cards = () => one(h.tree, "DiskCards").props.disks;
  // diskCardModels of the status and the shown page: the array by number,
  // then the pools; the targets of the running and the waiting move.
  same(cards(), toolList.diskCardModels(h.service.disks, h.items));
  same(
    cards().map((disk) => [
      disk.name,
      disk.pool,
      disk.share,
      disk.free,
      disk.target,
      disk.standby,
    ]),
    [
      ["disk1", false, 90, 100, true, false],
      ["disk2", false, 68, 320, true, true],
      ["cache", true, 31, 345, false, null],
    ],
  );
  // Only the shown page marks a target: without its moves none is marked.
  h.items = [item(1, "Breaking Bad"), item(2, "Dark", { jobStatus: "" })];
  await h.poll();
  same(
    cards().map((disk) => disk.target),
    [false, false, false],
  );
  // Without the state directory the status says nothing about standby.
  h.service = serviceOf({
    disks: serviceOf().disks.map(({ standby, ...disk }) => disk),
  });
  await h.poll();
  same(
    cards().map((disk) => disk.standby),
    [null, null, null],
  );
});

test("scan and scan report sit on the band and keep their width", async () => {
  const h = placementPage({
    activity: activityOf({ scan: { running: false }, report: undefined }),
  });
  await h.poll();
  // Without a report: Scan report locked, no notices; Scan ready to open
  // its options dialog.
  same([reportButton(h).notices, reportButton(h).disabled], [false, true]);
  same(
    [scanButton(h).scanning, scanButton(h).ready, scanButton(h).disabled],
    [false, false, false],
  );
  scanButton(h).press();
  h.render();
  const dialog = one(h.tree, "PlacementScanDialog").props;
  assert.equal(dialog.active, false);
  dialog.close();
  h.render();
  assert.equal(ofType(h.tree, "PlacementScanDialog").length, 0);
  // A report with notices: the dot and the name say so; the report opens.
  h.activity = activityOf({
    report: { ...SCAN, rootFolders: [{ status: "unresolved" }], shares: [] },
  });
  await h.poll();
  same([reportButton(h).notices, reportButton(h).disabled], [true, false]);
  reportButton(h).open();
  h.render();
  assert.equal(
    one(h.tree, "PlacementSummaryDialog").props.scan.rootFolders[0].status,
    "unresolved",
  );
  // While a scan runs, the button cancels it.
  h.activity = activityOf({ scan: { ...SCAN, running: true } });
  await h.poll();
  assert.equal(scanButton(h).scanning, true);
  scanButton(h).press();
  await settle();
  same(
    h.log.find(([kind, path]) => kind === "api" && path === "placement/scan"),
    ["api", "placement/scan", "DELETE", null],
  );
  // A share mapping changed since the last scan: Scan is highlighted.
  const changed = placementPage({
    settings: { unraid: { shareDirs: { movies: "films" }, libraries: [] } },
  });
  await changed.poll();
  assert.equal(scanButton(changed).ready, true);
  // Both labels are always there, the hidden one invisible, so the button
  // keeps its width; it is named by the one it shows.
  for (const scanning of [false, true]) {
    const button = band.ScanButton({
      scanning,
      ready: true,
      disabled: false,
      press() {},
    });
    assert.equal(
      button.props.class,
      "v2-btn v2-btn--band-primary v2-btn--ready",
    );
    const [shown, alt] = ofType(button, "span");
    same(
      [text(shown), text(alt), alt.props.class, alt.props["aria-hidden"]],
      [
        scanning ? "Cancel scan" : "Scan",
        scanning ? "Scan" : "Cancel scan",
        "v2-btn-alt",
        "true",
      ],
    );
  }
  const notices = band.ReportButton({
    notices: true,
    disabled: false,
    open() {},
  });
  same(
    [notices.props["aria-label"], text(notices)],
    ["Scan report · contains notices", "Scan report"],
  );
  assert.equal(one(notices, "span").props.class, "v2-dot v2-dot--warn");
});

test("placement rows offer details, terminal, start, status and removal", async () => {
  const h = placementPage();
  await h.poll();
  // Info: Details (at every width) and Terminal (above 739).
  same(
    buttons(cell(h, "actions", 1)).map((b) => [b.label, b.title, b.only]),
    [
      ["Details for Breaking Bad", "Details", undefined],
      ["Terminal for Breaking Bad", "Terminal", "desk"],
    ],
  );
  buttons(cell(h, "actions", 1))[0].onClick();
  await settle();
  h.render();
  same(h.log.at(-1), ["api", "placement/items/1", "GET", null]);
  let dialog = one(h.tree, "PlacementDetailDialog").props;
  assert.equal(dialog.item.id, 1);
  assert.equal(dialog.disabled, false);
  assert.equal(dialog.diskRoot, "/unraid");
  same(dialog.disks, h.service.disks);
  dialog.terminal();
  h.render();
  assert.equal(one(h.tree, "PlacementLogDialog").props.item.id, 1);
  one(h.tree, "PlacementLogDialog").props.close();
  buttons(cell(h, "actions", 2))[1].onClick();
  h.render();
  assert.equal(one(h.tree, "PlacementLogDialog").props.item.id, 2);
  one(h.tree, "PlacementLogDialog").props.close();
  h.render();
  // The title (a series folder translated) and its folder; without an Arr
  // entry the folder says so.
  same(
    ofType([cell(h, "title", 1)].flat(), "div").map((d) => [
      d.props.class,
      text(d),
    ]),
    [
      ["v2-table-name", "Breaking Bad"],
      ["v2-table-sub", "shows/Breaking Bad"],
    ],
  );
  const noArr = ofType([cell(h, "title", 4)].flat(), "div")[1];
  same(
    [text(noArr), noArr.props.title],
    [
      "No Radarr/Sonarr entry · movies/Dune Part Two (2024)",
      "No Radarr/Sonarr entry · movies/Dune Part Two (2024)",
    ],
  );
  assert.equal(
    text(
      ofType(
        [
          column(h, "title").cell(
            item(9, "Fargo · Series folder", { season: -1 }),
          ),
        ].flat(),
        "div",
      )[0],
    ),
    "Fargo · Series folder",
  );
  // The data cells: service, size (a compact one-disk scan has none), the
  // disks (DiskTagCell, “+n” opens Details), the target, the move, the kind.
  // The service is user data: a clipped cell with its name as title
  // (F-I2); the plain text columns clip.
  same(
    [text(cell(h, "service", 1)), cell(h, "service", 1).props.title],
    ["Sonarr", "Sonarr"],
  );
  assert.equal(cell(h, "service", 4), "—");
  same(
    table(h)
      .props.columns.filter((entry) => entry.clip)
      .map((entry) => entry.key),
    ["service", "size", "move", "kind"],
  );
  assert.equal(cell(h, "size", 3), "3000 B");
  assert.equal(
    column(h, "size").cell(
      item(9, "Up", {
        scanStatus: "ok",
        disks: { disk1: { bytes: 0, files: 0, dirs: 0 } },
      }),
    ),
    "—",
  );
  const tags = cell(h, "disks", 3);
  assert.equal(tags.type, "DiskTagCell");
  assert.equal(tags.props.item.id, 3);
  tags.props.more();
  await settle();
  h.render();
  assert.equal(one(h.tree, "PlacementDetailDialog").props.item.id, 3);
  one(h.tree, "PlacementDetailDialog").props.close();
  h.render();
  const target = cell(h, "target", 5);
  same([target.type, target.props.disk], ["ToolDiskTag", "disk2"]);
  assert.equal(cell(h, "target", 2), "—");
  assert.equal(text([cell(h, "move", 2)].flat()), "200 B2 files");
  assert.equal(cell(h, "kind", 1), "Media files");
  assert.equal(
    column(h, "kind").cell(item(9, "Up", { kind: "small_files" })),
    "Small files",
  );
  // The status button names the text it shows (ruling I7) and opens the
  // checks.
  const status = cell(h, "status", 1);
  assert.equal(status.type, "StatusTag");
  same(status.props.view, toolStatus.placementStatusView(rowOf(h, 1), t));
  assert.equal(status.props.openLabel, "Status: Split. Show checks");
  status.props.open();
  await settle();
  h.render();
  dialog = one(h.tree, "PlacementStatusDialog").props;
  assert.equal(dialog.item.id, 1);
  dialog.openFiles("/media/shows");
  same(h.log.at(-1), ["openFiles", "/media/shows"]);
  await dialog.recheck();
  same(
    h.log.find(([, path]) => path === "placement/items/1/recheck"),
    ["api", "placement/items/1/recheck", "POST", null],
  );
  dialog.close();
  h.render();
  // Progress: the progress cell of the job.
  same(
    [cell(h, "progress", 5).type, cell(h, "progress", 5).props],
    ["ProgressCell", { status: "running", value: 64, label: "Progress" }],
  );
  // Actions: Start for every row (locked unless it can start), Remove only
  // for a moved item.
  for (const id of [1, 2, 3, 4, 5, 6]) {
    const list = buttons(cell(h, "remove", id));
    assert.equal(list[0].label, "Start item " + rowOf(h, id).title, id);
    assert.equal(list[0].title, "Start", id);
    assert.equal(list[0].only, "desk", id);
    assert.equal(
      list[0].disabled,
      !placement.placementSelectable(rowOf(h, id)),
      id,
    );
    assert.equal(list.length, id === 4 ? 2 : 1, id);
  }
  const [start, remove] = buttons(cell(h, "remove", 4));
  same(
    [remove.label, remove.tone, remove.only, remove.disabled],
    ["Remove Dune: Part Two from the list", "danger", undefined, false],
  );
  assert.equal(start.disabled, true);
  await remove.onClick();
  await settle();
  same(h.log.slice(-2), [
    ["removal", 4],
    ["api", "placement/items/4", "DELETE", null],
  ]);
  // Start of one item without an owner change asks nothing.
  buttons(cell(h, "remove", 1))[0].onClick();
  await settle();
  same(h.log.at(-1), ["api", "placement/start", "POST", { ids: [1] }]);
  assert.ok(!h.log.some(([kind]) => kind === "confirmAction"));
});

test("placement row buttons keep their places while an item's status changes", async () => {
  const h = placementPage({ items: [item(1, "Breaking Bad")] });
  await h.poll();
  const shape = () => ({
    info: buttons(cell(h, "actions", 1)).map((b) => [b.label, b.only]),
    actions: [cell(h, "remove", 1)].flat().map((node) => node.props.class),
    first: buttons(cell(h, "remove", 1))[0].label,
  });
  const before = shape();
  same(before.actions, ["v2-table-items"]);
  assert.equal(before.first, "Start item Breaking Bad");
  for (const jobStatus of [
    "queued",
    "running",
    "succeeded",
    "failed",
    "cancelled",
    "needs_review",
    "needs_attention",
    "",
  ]) {
    h.items = [{ ...h.items[0], jobStatus }];
    await h.poll();
    same(shape(), before, jobStatus);
    const list = buttons(cell(h, "remove", 1));
    assert.equal(list.length, jobStatus === "succeeded" ? 2 : 1, jobStatus);
    assert.equal(
      list[0].disabled,
      !["", "failed"].includes(jobStatus),
      jobStatus,
    );
  }
  // The columns' widths never see the rows: the same columns go in.
  same(h.styleArgs[0], placement.placementOrderedColumns(null));
});

test("placement selection keeps only startable items across pages", async () => {
  const h = placementPage();
  await h.poll();
  const selection = () => table(h).props.selection;
  same(
    [selection().allLabel, selection().rowLabel(rowOf(h, 1))],
    ["Select all visible items", "Select item Breaking Bad"],
  );
  assert.equal(selection().keepOthers, true);
  assert.equal(selection().disabled, false);
  same(
    h.items.filter((entry) => selection().selectable(entry)).map((i) => i.id),
    [1, 6],
  );
  const selected = tool(h, "Start selected");
  same(
    [selected.props.count, selected.props.max, selected.props.disabled],
    [0, 50, true],
  );
  // Its slot holds the largest selection: the page size, or every item of
  // the last scan when it found more, so a selection across pages never
  // widens it. It never follows the filtered total, which changes with
  // every filter, poll and removal (F-I1): 9 → 10, 99 → 100 and 999 →
  // 1,000 matches keep its width.
  const totals = [9, 10, 99, 100, 999, 1000, 999];
  for (const total of totals) {
    h.results = { total };
    await h.poll();
    assert.equal(tool(h, "Start selected").props.max, 50, String(total));
  }
  h.activity = activityOf({ report: { ...SCAN, total: 1200 } });
  for (const total of totals) {
    h.results = { total };
    await h.poll();
    assert.equal(tool(h, "Start selected").props.max, 1200, String(total));
  }
  const across = Array.from({ length: 105 }, (_, i) => 1000 + i);
  selection().set(across);
  h.render();
  same(
    [
      tool(h, "Start selected").props.count,
      tool(h, "Start selected").props.max,
    ],
    [105, 1200],
  );
  h.route.page = 3;
  await h.poll();
  same(
    [
      tool(h, "Start selected").props.count,
      tool(h, "Start selected").props.max,
    ],
    [105, 1200],
  );
  selection().set([]);
  h.results = {};
  h.activity = activityOf();
  await h.poll();
  assert.equal(tool(h, "Start selected").props.max, 50);
  selection().set([1, 6]);
  h.render();
  same(selection().selected, [1, 6]);
  same(
    [
      tool(h, "Start selected").props.count,
      tool(h, "Start selected").props.disabled,
    ],
    [2, false],
  );
  // Page 2 keeps the selection (the page box adds to it, keepOthers).
  h.route.page = 2;
  h.items = [item(7, "Fargo")];
  await h.poll();
  same(selection().selected, [1, 6]);
  assert.equal(tool(h, "Start selected").props.count, 2);
  // While a scan runs the boxes and Start selected are locked; a scan that
  // ends clears the selection and opens its report.
  h.activity = activityOf({ scan: { ...SCAN, running: true } });
  await h.poll();
  assert.equal(selection().disabled, true);
  assert.equal(tool(h, "Start selected").props.disabled, true);
  h.activity = activityOf({
    scan: { ...SCAN, finishedAt: "2026-11-01T10:00:00Z" },
  });
  await h.poll();
  same(selection().selected, []);
  assert.equal(ofType(h.tree, "PlacementSummaryDialog").length, 1);
  // A filter change clears it, and so does a share change.
  selection().set([7]);
  h.render();
  card(h).props.chips;
  h.route.filters = { ...h.route.filters, statuses: ["several"] };
  h.render();
  same(selection().selected, []);
  selection().set([7]);
  h.render();
  const drawerOpen = { isConnected: true, focus() {} };
  card(h).props.filters.open(drawerOpen);
  h.render();
  one(h.tree, "Drawer").props.apply({
    statuses: ["several"],
    kinds: [],
    targets: [],
    shares: ["tv"],
  });
  h.render();
  same(selection().selected, []);
});

test("starting confirms several items and owner changes", async () => {
  const h = placementPage({
    results: { ownerChanges: { 1: 2, 6: 1 } },
    answers: { confirmAction: false },
  });
  await h.poll();
  table(h).props.selection.set([1, 6]);
  h.render();
  // Two items with owner changes: one question with both texts; a no sends
  // nothing.
  await tool(h, "Start selected").props.onClick();
  await settle();
  same(h.log.at(-1), [
    "confirmAction",
    "You are about to move 2 items. 3 files change owner to 99:100.",
    "Move",
  ]);
  assert.ok(!h.log.some(([, path]) => path === "placement/start"));
  // One item with an owner change asks too.
  buttons(cell(h, "remove", 6))[0].onClick();
  await settle();
  same(h.log.at(-1), [
    "confirmAction",
    "You are about to move 1 items. 1 files change owner to 99:100.",
    "Move",
  ]);
  // Yes: the ids go to placement/start, in the server's order.
  const yes = placementPage({ results: { ownerChanges: {} } });
  await yes.poll();
  table(yes).props.selection.set([6, 1]);
  yes.render();
  await tool(yes, "Start selected").props.onClick();
  await settle();
  same(yes.log.slice(-2), [
    ["confirmAction", "You are about to move 2 items.", "Move"],
    ["api", "placement/start", "POST", { ids: [6, 1] }],
  ]);
  yes.render();
  same(table(yes).props.selection.selected, []);
  // Start all takes every startable item of the list, the other pages too.
  yes.results = { selectableIds: [1, 6, 40] };
  await yes.poll();
  const all = tool(yes, "Start all");
  same(
    [text(all), all.props.disabled, all.props.class],
    ["Start all", false, "v2-btn v2-btn--sm"],
  );
  await all.props.onClick();
  await settle();
  same(yes.log.slice(-2), [
    ["confirmAction", "You are about to move 3 items.", "Move"],
    ["api", "placement/start", "POST", { ids: [1, 6, 40] }],
  ]);
  // A single item without an owner change asks nothing.
  const single = placementPage({ items: [item(1, "Breaking Bad")] });
  await single.poll();
  await tool(single, "Start all").props.onClick();
  await settle();
  same(single.log.at(-1), ["api", "placement/start", "POST", { ids: [1] }]);
  assert.ok(!single.log.some(([kind]) => kind === "confirmAction"));
  // Cancel is always there (ruling R-H), locked without moves; Remove
  // completed removes the moved items, locked without them.
  const cancel = tool(single, "Cancel");
  same(
    [text(cancel), cancel.props.disabled, !!cancel.props.hidden],
    ["Cancel", true, false],
  );
  single.activity = activityOf({ queued: 2 });
  await single.poll();
  assert.equal(tool(single, "Cancel").props.disabled, false);
  await tool(single, "Cancel").props.onClick();
  await settle();
  same(single.log.at(-1), ["api", "placement/cancel", "POST", null]);
  const completed = tool(single, "Remove completed");
  assert.equal(completed.props.disabled, false);
  await completed.props.onClick();
  await settle();
  same(single.log.at(-1), ["api", "placement/items?moved=1", "DELETE", null]);
  single.activity = activityOf({ moved: 0 });
  await single.poll();
  assert.equal(tool(single, "Remove completed").props.disabled, true);
  // The tools in the 1.7.0 order.
  same(
    tools(single)
      .filter((node) => node.type === "CountTool" || node.type === "button")
      .map((node) => node.props.title),
    ["Start selected", "Start all", "Cancel", "Remove completed"],
  );
});

test("the placement drawer asks for one item and applies once", async () => {
  const h = placementPage({ filters: { q: "dune", targets: ["disk1"] } });
  await h.poll();
  // The drawer chunk preloads at idle and opens through useLazyChunk.
  assert.equal(h.lazy.at(-1).chunk, "toolDrawerChunk");
  assert.equal(h.lazy.at(-1).open, false);
  assert.equal(ofType(h.tree, "Drawer").length, 0);
  const filters = () => card(h).props.filters;
  same(filters(), { count: 0, expanded: false });
  const trigger = { isConnected: true, focus: (o) => h.log.push(["focus", o]) };
  filters().open(trigger);
  h.render();
  assert.equal(h.lazy.at(-1).open, true);
  assert.equal(filters().expanded, true);
  const drawer = () => one(h.tree, "Drawer").props;
  assert.equal(drawer().subtitle, "Items");
  // Shares (two of them), Status and Kind, in the 1.7.0 order and values.
  same(
    drawer().groups.map((group) => [group.key, group.label]),
    [
      ["shares", "Shares"],
      ["statuses", "Status"],
      ["kinds", "Kind"],
    ],
  );
  same(drawer().groups[0].options, [
    { value: "movies", label: "movies", count: 4 },
    { value: "tv", label: "tv", count: 2 },
  ]);
  same(
    drawer().groups[1].options.map((o) => [o.value, o.label, o.count]),
    [
      ["all", "All scanned", 6],
      ["several", "Several disks", 4],
      ["one_disk", "On one disk", 1],
      ["empty", "Empty folders", 0],
      ["empty_folders", "Empty copies", 0],
      ["not_found", "Not found", 0],
      ["seasons_spread", "Seasons spread", 0],
      ["conflict", "Conflict", 0],
      ["no_space", "No space", 0],
      ["errors", "Errors", 0],
      ["no_arr", "Without Arr entry", 0],
      ["moved", "Completed", 1],
    ],
  );
  same(drawer().groups[2].options, [
    { value: "small_files", label: "Small files" },
    { value: "media_files", label: "Media files" },
  ]);
  same(drawer().initial, {
    statuses: [],
    kinds: [],
    targets: ["disk1"],
    shares: [],
  });
  assert.equal(drawer().localCount, undefined);
  // One item of the draft's results, with the search and the target.
  const draft = {
    statuses: ["several"],
    kinds: ["small_files"],
    targets: ["disk1"],
    shares: ["tv"],
  };
  assert.equal(
    drawer().countPath(draft),
    "placement/items?q=dune&status=several&target=disk1&kind=small_files&share=tv&limit=1",
  );
  // Apply: one route change (statuses and kinds, the target kept, page 1)
  // and the shares, which stay out of the route.
  const before = h.log.filter(([kind]) => kind === "filters").length;
  drawer().apply(draft);
  h.render();
  const applied = h.log.filter(([kind]) => kind === "filters");
  assert.equal(applied.length, before + 1, "one route change");
  same(applied.at(-1), [
    "filters",
    { statuses: ["several"], kinds: ["small_files"] },
  ]);
  same(h.route.filters, {
    q: "dune",
    statuses: ["several"],
    targets: ["disk1"],
    kinds: ["small_files"],
  });
  assert.equal(h.route.page, 1);
  same(drawer().initial.shares, ["tv"]);
  assert.equal(filters().count, 3);
  await h.poll();
  assert.match(h.lists.at(-1), /&share=tv&/);
  // A history step brings other filters: the draft starts from them (M16).
  h.route.filters = { ...h.route.filters, statuses: ["moved"] };
  h.render();
  same(drawer().initial.statuses, ["moved"]);
  // Closing hands focus back to the Filters button.
  h.document.activeElement = h.document.body;
  drawer().close();
  h.render();
  assert.equal(ofType(h.tree, "Drawer").length, 0);
  same(h.log.at(-1), ["focus", { preventScroll: true }]);
  // One share: no Shares group, unless one is chosen (then with a share
  // the results no longer hold, so it can be cleared).
  const single = placementPage();
  single.results = { shares: { movies: 4 } };
  await single.poll();
  card(single).props.filters.open(trigger);
  single.render();
  const groups = () => one(single.tree, "Drawer").props.groups;
  same(
    groups().map((group) => group.key),
    ["statuses", "kinds"],
  );
  one(single.tree, "Drawer").props.apply({
    statuses: [],
    kinds: [],
    targets: [],
    shares: ["tv"],
  });
  single.render();
  same(groups()[0].options, [
    { value: "movies", label: "movies", count: 4 },
    { value: "tv", label: "tv", count: 0 },
  ]);
  // A deep-linked status beyond the list joins it with its name.
  const linked = placementPage({ filters: { statuses: ["several_split"] } });
  await linked.poll();
  card(linked).props.filters.open(trigger);
  linked.render();
  same(
    one(linked.tree, "Drawer")
      .props.groups.find((g) => g.key === "statuses")
      .options.at(-1),
    { value: "several_split", label: "Several disks · Split", count: 0 },
  );
});

test("placement chips keep the real 1.7.0 order", async () => {
  // The chips as the page builds them (Task 2 review): Kind, Share,
  // Status, Target, Search.
  const h = placementPage({
    filters: {
      q: "Dune",
      statuses: ["several"],
      targets: ["disk1"],
      kinds: ["small_files"],
    },
  });
  await h.poll();
  card(h).props.filters.open({ isConnected: true, focus() {} });
  h.render();
  one(h.tree, "Drawer").props.apply({
    statuses: ["several"],
    kinds: ["small_files"],
    targets: ["disk1"],
    shares: ["movies"],
  });
  await h.poll();
  const chips = () => card(h).props.chips;
  same(
    chips().map((chip) => chip.label),
    [
      "Kind: Small files",
      "Share: movies",
      "Status: Several disks",
      "Target: disk1",
      "Search: Dune",
    ],
  );
  same(
    toolFilters.chipRow(chips()).map((chip) => [chip.key, chip.excluded]),
    [
      ["Kind:small_files", false],
      ["Share:movies", false],
      ["Status:several", false],
      ["Target:disk1", false],
      ["q", false],
    ],
  );
  assert.equal(card(h).props.active, true);
  // Each chip removes its own value; the share goes back to page 1.
  chips()[1].remove();
  h.render();
  same(h.log.at(-1), ["page", 1]);
  assert.ok(!chips().some((chip) => chip.key === "Share:movies"));
  chips()[0].remove();
  same(h.log.at(-1), ["filters", { kinds: [] }]);
  h.render();
  chips().at(-1).remove();
  same(h.log.at(-1), ["filters", { q: "" }]);
  // Reset filters clears every filter and the shares.
  h.render();
  card(h).props.reset();
  same(h.log.at(-1), [
    "filters",
    { statuses: [], targets: [], kinds: [], q: "" },
  ]);
});

test("placement export keeps filters and sort", async () => {
  const h = placementPage({
    filters: { statuses: ["several"] },
    sort: { field: "size", direction: "desc" },
  });
  await h.poll();
  same(card(h).props.csv, {
    href: "/api/placement/export.csv?q=&status=several&sort=size&dir=desc",
    enabled: true,
  });
  // The list asks with the same filters, sort and page.
  assert.equal(
    h.lists.at(-1),
    "placement/items?q=&status=several&sort=size&dir=desc&offset=0&limit=50",
  );
  // Without matches the export is locked.
  h.items = [];
  await h.poll();
  assert.equal(card(h).props.csv.enabled, false);
});

test("the scan report filters, selects targets and opens settings as before", async () => {
  const h = placementPage();
  await h.poll();
  reportButton(h).open();
  h.render();
  const report = () => one(h.tree, "PlacementSummaryDialog").props;
  same(report().counts, activityOf().counts);
  assert.equal(report().scanning, false);
  assert.equal(report().busy, false);
  // Filter by a target: the chip, page 1, the report closes.
  report().filter("disk1");
  h.render();
  same(h.log.slice(-2), [
    ["filters", { targets: ["disk1"] }],
    ["page", 1],
  ]);
  assert.equal(ofType(h.tree, "PlacementSummaryDialog").length, 0);
  // Select a target's items: one request for its startable ids, then the
  // target as a filter; the selection outlives that filter change (1.7.0
  // cleared it again with the filter change, a bug fixed in the 5b fix
  // wave), as a library selection stays through its own action.
  reportButton(h).open();
  h.render();
  h.answer = (path) => {
    h.answer = undefined;
    return { items: [], total: 9, selectableIds: [6, 21, 22] };
  };
  await report().select("disk2");
  h.render();
  assert.equal(h.lists.at(-1), "placement/items?target=disk2&limit=1");
  same(h.log.at(-1), ["filters", { targets: ["disk1", "disk2"] }]);
  same(table(h).props.selection.selected, [6, 21, 22]);
  // The next filter change clears it, as every other one does.
  reportButton(h).open();
  h.render();
  report().filter("disk3");
  h.render();
  same(table(h).props.selection.selected, []);
  // A share and status drilldown sets both, clears the rest.
  reportButton(h).open();
  h.render();
  report().rootFilter("tv", "several");
  h.render();
  same(h.log.at(-1), [
    "filters",
    { statuses: ["several"], q: "", targets: [], kinds: [] },
  ]);
  card(h).props.filters.open({ isConnected: true, focus() {} });
  h.render();
  same(one(h.tree, "Drawer").props.initial.shares, ["tv"]);
  one(h.tree, "Drawer").props.close();
  h.render();
  reportButton(h).open();
  h.render();
  report().rootFilter("", "");
  same(h.log.at(-1), [
    "filters",
    { statuses: ["all"], q: "", targets: [], kinds: [] },
  ]);
  // Open in settings closes the report and opens the settings.
  h.render();
  reportButton(h).open();
  h.render();
  report().openSettings();
  same(h.log.at(-1), ["setup"]);
  h.render();
  assert.equal(ofType(h.tree, "PlacementSummaryDialog").length, 0);
});

test("queued moves show the mover and parity waits", async () => {
  const h = placementPage();
  await h.poll();
  let status = cell(h, "status", 3);
  same(
    [status.props.view.tone, status.props.view.text],
    ["wait", "Waiting: mover is running"],
  );
  assert.equal(
    status.props.openLabel,
    "Status: Waiting: mover is running. Show checks",
  );
  h.items = h.items.map((entry) =>
    entry.id === 3
      ? { ...entry, message: "Waiting: parity operation in progress" }
      : entry,
  );
  await h.poll();
  status = cell(h, "status", 3);
  assert.equal(status.props.view.text, "Waiting: parity operation in progress");
  // Without the wait it is the short status again.
  h.items = h.items.map((entry) =>
    entry.id === 3 ? { ...entry, message: "" } : entry,
  );
  await h.poll();
  assert.equal(cell(h, "status", 3).props.view.text, "Queued");
  // The widths cover the waits: the tool's status texts include them.
  for (const wait of columns.PLACEMENT_WAITS)
    assert.ok(columns.toolStatusTexts("placement", t).includes(wait), wait);
});

test("the activity line names scans and moves without moving the card", async () => {
  const h = placementPage({
    activity: activityOf({
      scan: { ...SCAN, running: true, disk: "disk3", checked: 2, total: 6 },
    }),
  });
  await h.poll();
  assert.equal(card(h).props.activity, "Scanning disk3 · 2 of 6 items");
  assert.equal(card(h).props.busy, true);
  h.activity = activityOf({
    scan: { ...SCAN, running: true, checked: 2, total: 6 },
  });
  await h.poll();
  assert.equal(card(h).props.activity, "Scanning … · 2 of 6 items");
  h.activity = activityOf({
    queued: 1,
    running: 1,
    moved: 1,
    bytesDone: 400,
    totalBytes: 900,
  });
  await h.poll();
  // The speed is the bytes since the last answer per second.
  assert.match(
    card(h).props.activity,
    /^Moving 2 of 3 · 400 B of 900 B · [\d.]+ B\/s$/,
  );
  h.activity = { ...h.activity, fileWork: "mux" };
  await h.poll();
  assert.match(card(h).props.activity, / · Waiting: a mux job is running$/);
  // A move alone turns the spinner and leaves the rows undimmed; a reload
  // (a filter or page change) slower than 300 ms dims them, also while the
  // move runs (1.7.0 dimmed on loading; Task 10 review M-1).
  assert.deepEqual([card(h).props.busy, card(h).props.dimmed], [true, false]);
  let release;
  h.answer = () =>
    new Promise((resolve) => {
      release = () =>
        resolve({
          items: h.items,
          total: h.items.length,
          selectableIds: [],
          shares: {},
        });
    });
  const reload = h.poll();
  await new Promise((resolve) => setTimeout(resolve, 350));
  h.render();
  assert.deepEqual([card(h).props.busy, card(h).props.dimmed], [true, true]);
  release();
  await reload;
  h.answer = undefined;
  assert.deepEqual([card(h).props.busy, card(h).props.dimmed], [true, false]);
  // Idle: an empty hint line in its place, no spinner.
  h.activity = activityOf();
  await h.poll();
  same([card(h).props.activity, card(h).props.busy], ["", false]);
  // The hint line is the card's polite live region (TableCard live).
  assert.match(
    src("components/tools/ToolCard.tsx"),
    /hint=\{p\.activity\}\s+live/,
  );
});

test("an unready placement shows its reason in the card", async () => {
  const error =
    "No Unraid disks (disk1, disk2 ...) found in the disk root. Map the host's /mnt to this path.";
  const h = placementPage({
    service: serviceOf({ ready: false, error, disks: [] }),
  });
  await h.poll();
  // The disk row holds its placeholders, the table no rows.
  same(one(h.tree, "DiskCards").props.disks, []);
  same(table(h).props.rows, []);
  const empty = one(card(h).props.children, "ListEmpty");
  same([empty.props.title, !!empty.props.pending], [error, false]);
  const settings = one(empty, "button");
  same(
    [text(settings), settings.props.class],
    ["Open settings", "v2-btn v2-btn--primary"],
  );
  settings.props.onClick();
  same(h.log.at(-1), ["setup"]);
  // Without an error text: the 1.7.0 fallback.
  h.service = serviceOf({ ready: false, disks: [] });
  await h.poll();
  assert.equal(
    one(card(h).props.children, "ListEmpty").props.title,
    "Enable the MKVToolNix service and configure path mappings first",
  );
  // A failed first answer is not ready either.
  const failed = placementPage();
  failed.answer = () => {
    throw new Error("offline");
  };
  await failed.poll();
  same(
    [
      !!one(card(failed).props.children, "ListEmpty").props.pending,
      one(failed.tree, "DiskCards").props.disks,
    ],
    [false, null],
  );
  // Ready without rows: no scan yet, everything on one disk, or no match
  // (with the hidden one-disk rows and Show).
  const empties = [
    [
      { scan: { running: false } },
      {},
      "No scan yet",
      "Choose your libraries and click Scan.",
    ],
    [
      { scan: { ...SCAN, several: 0, unstartable: 0 } },
      {},
      "Everything is on one disk",
      "Change the filters or scan again.",
    ],
    [
      {},
      { hiddenOK: 3 },
      "No matching items",
      "Change the filters or scan again.",
    ],
  ];
  for (const [activity, results, title, sentence] of empties) {
    const page = placementPage({
      items: [],
      activity: activityOf(activity),
      results,
    });
    await page.poll();
    const state = one(card(page).props.children, "ListEmpty");
    assert.equal(state.props.title, title);
    const lines = ofType(state, "p");
    assert.equal(text(lines[0]), sentence);
    assert.equal(lines.length, results.hiddenOK ? 2 : 1, title);
    if (results.hiddenOK) {
      assert.match(
        text(lines[1]),
        /^No matches in this view\. 3 matches on one disk\. Show$/,
      );
      const show = one(lines[1], "button");
      assert.equal(show.props.class, "v2-text-btn");
      show.props.onClick();
      same(page.log.at(-1), ["filters", { statuses: ["ok"] }]);
    }
  }
});

test("placement drops the transition sheet", () => {
  const { sheetPage } = loadSource("nav-model.ts", {
    modules: {
      "./frame-status": {},
      "./instances": instances,
      "./router": { SETTINGS_SECTIONS: [] },
      "./tool-route": { TOOLS: {} },
    },
  });
  assert.equal(sheetPage({ view: "disks", query: "" }), false);
  assert.equal(sheetPage({ view: "disks", query: "status=several" }), false);
  assert.equal(sheetPage({ view: "mux", query: "" }), false);
  // Files & permissions left it too (Task 8).
  assert.equal(sheetPage({ view: "files", query: "" }), false);
  // Its 1.7.0 parts left the page; DiskTag stays for the dialogs.
  const page = src("components/DiskPlacementPage.tsx");
  for (const gone of [
    "FilterRow",
    "CompactProgress",
    "ActiveFilterBar",
    "FilterCheckList",
    "CSVExport",
    "MultiFilter",
    "Pagination,",
    "EmptyState",
    "useToolTableStyle",
    "<DiskTag ",
    "Tooltip",
  ])
    assert.ok(!page.includes(gone), gone);
  assert.match(src("components/PlacementDialogs.tsx"), /<DiskTag/);
});
