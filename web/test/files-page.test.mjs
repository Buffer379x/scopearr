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
import * as icons from "lucide-preact";
import * as instances from "../src/instances.ts";

// The Files & permissions page on the tool blocks (Phase 5b, task 8;
// docs/STYLEGUIDE.md, Part 1, 11.1): FileCheckPage runs as real code with
// the hook runtime and the real file check rules (filecheck,
// placement-messages, scan-report, tool-list, tool-status, tool-filters);
// the blocks it places are named stubs, so a tree shows what they receive,
// and the requests, questions, downloads and route changes are recorded.

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
const scanReport = loadSource("scan-report.ts");
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

function finding(id, title, rel, extra = {}) {
  return {
    id,
    service: "radarr",
    instance: "Radarr",
    mediaId: id,
    title,
    rel,
    dir: false,
    kind: "permissions",
    fix: "chmod",
    size: id * 100,
    mode: 0o600,
    uid: 0,
    gid: 0,
    mtime: 0,
    note: "",
    jobStatus: "",
    queuePos: null,
    progress: 0,
    message: "",
    updatedAt: "",
    finishedAt: null,
    ...extra,
  };
}
// The C+ findings and two more: an owner to take (a folder), a mode to
// set, a fixed folder, a manual one, a waiting fix and a failed one
// (fixable again).
const ITEMS = () => [
  finding(1, "Tenet", "movies/Tenet (2020)", {
    dir: true,
    kind: "owner",
    fix: "take_ownership",
    mode: 0o755,
  }),
  finding(2, "Her", "movies/Her (2013)/Her.2013.nfo"),
  finding(3, "Dark", "shows/Dark/Season 2", {
    dir: true,
    service: "sonarr",
    instance: "Sonarr",
    jobStatus: "succeeded",
  }),
  finding(4, "Alien", "movies/Alien (1979)/Thumbs.db", {
    kind: "other",
    fix: "manual",
    note: "disk1 unavailable",
  }),
  finding(5, "Up", "movies/Up (2009)/Up.mkv", { jobStatus: "queued" }),
  finding(6, "Heat", "movies/Heat (1995)/Heat.mkv", {
    jobStatus: "failed",
    message: "Operation not permitted",
  }),
];
const fixable = (items) =>
  items.filter((entry) => fileCheck.fileCheckFixable(entry)).map((i) => i.id);
const SCAN = {
  running: false,
  startedAt: "2026-11-01T09:31:48Z",
  finishedAt: "2026-11-01T09:32:00Z",
  duration: 12,
  checked: 1284,
  total: 1284,
  files: 5120,
  findings: 6,
  bytes: 2100,
  kinds: { permissions: 3, owner: 1, other: 1, junk: 0 },
  fixes: { manual: 1 },
  items: 6,
  error: "",
  roots: [],
};
const activityOf = (extra = {}) => ({
  scan: SCAN,
  report: SCAN,
  ready: true,
  error: "",
  physical: true,
  queued: 0,
  running: 0,
  fixed: 1,
  fileWork: "",
  counts: {
    open: 3,
    manual: 1,
    fixed: 1,
    failed: 1,
    "kind:permissions": 4,
    "kind:owner": 1,
    "kind:other": 1,
  },
  ...extra,
});

// The page with its boundaries recorded in `log`. `poll()` answers the
// page's two requests (filecheck/scan, filecheck/items) with h.activity and
// h.items; `render()` settles the page.
function filesPage({
  items = ITEMS(),
  activity = activityOf(),
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
        if (method === "GET" && path === "filecheck/scan") {
          if (h.fail) throw new Error("offline");
          return h.activity;
        }
        if (method === "GET" && path.startsWith("filecheck/items?")) {
          h.lists.push(path);
          if (h.answer) return h.answer(path);
          return {
            items: h.items,
            total: h.items.length,
            selectableIds: fixable(h.items),
            shares: { movies: 5, shows: 1 },
            ...h.results,
          };
        }
        log.push(["api", path, method, plain(body ?? null)]);
        if (path === "filecheck/commands")
          return { text: "chmod 0666 x\n", hostPaths: true };
        return {};
      },
    },
    "../browser-storage": {
      removePreference: (key) => log.push(["removePreference", key]),
    },
    "../confirmation": {
      confirmDeletion: (...args) => answer("confirmDeletion", ...args),
    },
    "../filecheck": fileCheck,
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
    "../placement-messages": messages,
    "../scan-report": scanReport,
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
    "./FileCheckCommandsDialog": {
      FileCheckCommandsDialog: "FileCheckCommandsDialog",
      downloadFileCheckScript: (script) => log.push(["download", script]),
    },
    "./FileCheckDetailDialog": {
      FileCheckDetailDialog: "FileCheckDetailDialog",
    },
    "./FileCheckScanDialog": { FileCheckScanDialog: "FileCheckScanDialog" },
    "./list/TableCard": { CountTool: "CountTool" },
    "./list/PageNav": {
      itemRange: (page, limit, total) => `${page}:${limit}:${total}`,
    },
    "./RootCoverage": {
      SkippedRootsNotice: "SkippedRootsNotice",
      rootPresentation: (roots, mappings) => ({ roots, mappings }),
    },
    "./SortableHeader": {
      formatTableSort: (sort) =>
        sort ? sort.field + ":" + sort.direction : "",
    },
    "./tools/drawer-chunk": { toolDrawerChunk: "toolDrawerChunk" },
    "./tools/ScanButton": {
      ReportButton: "ReportButton",
      ScanButton: "ScanButton",
    },
    "./tools/ToolCard": { ToolCard: "ToolCard" },
    "./tools/ToolKpis": { ToolKpis: "ToolKpis" },
    "./tools/ToolTable": { ToolTable: "ToolTable" },
  };
  const { FileCheckPage } = loadSource("components/FileCheckPage.tsx", {
    modules,
    browser: { document, clearTimeout },
    stubs: PRESENTATION_MODULES,
  });
  const props = {
    settings: { pageSize: 50, ...settings },
    changed: async () => log.push(["changed"]),
    setup: (service) => log.push(["setup", service]),
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
    results,
    lists: [],
    fail: false,
    removal: {
      removing: new Set(),
      hidden: new Set(),
      remove: async (id, request) => {
        log.push(["removal", id]);
        await request();
      },
    },
    presets: {
      presets: [{ id: 3, name: "Owners", query: "kind=owner" }],
      selectedPreset: undefined,
      applyPreset() {},
      reset() {},
      savePreset() {},
      deletePreset() {},
      dialogs: null,
    },
    render: () => (h.tree = runtime.settle(() => FileCheckPage(props))),
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
const kpis = (h) => one(h.tree, "ToolKpis").props;
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

test("the files page builds its KPI row and card from the tool blocks", async () => {
  const h = filesPage();
  // The 1.7.0 page state, presets, scan error toast and the obsolete
  // preference.
  assert.equal(h.pageState.tool, "filecheck");
  same(h.pageState.options, { resetPageOnSort: true });
  same(h.pageState.allowed.statuses, [
    "open",
    "manual",
    "fixed",
    "failed",
    "active",
  ]);
  same(h.pageState.allowed.kinds, fileCheck.fileCheckKinds);
  same(h.pageState.allowed.sorts, Object.keys(fileCheck.fileCheckSortFields));
  assert.equal(h.presetArgs.service, "tool:filecheck");
  assert.ok(
    h.log.some(
      ([kind, key]) =>
        kind === "removePreference" && key === "scopearr-filecheck-collapsed",
    ),
  );
  assert.equal(h.scanToast[0], "scopearr-filecheck-seen-scan-error");
  same(h.scanToast[3], { source: ["filecheck"] });
  assert.equal(h.scanToast[2]("Scan failed"), "Scan failed");
  // Polling as in 1.7.0: 1s while a scan or a fix runs, else 10s.
  assert.equal(h.polling.interval(activityOf()), 10000);
  assert.equal(h.polling.interval(activityOf({ queued: 1 })), 1000);
  assert.equal(h.polling.interval(activityOf({ running: 1 })), 1000);
  assert.equal(
    h.polling.interval(activityOf({ scan: { ...SCAN, running: true } })),
    1000,
  );
  // The band: the title, its summary and Scan report, then Scan.
  assert.equal(header(h).props.title, "Files & permissions");
  assert.equal(header(h).props.metaTitle, "Open items");
  same(
    nodes(actions(h))
      .filter(
        (node) => typeof node.type === "string" && /^[A-Z]/.test(node.type),
      )
      .map((node) => node.type),
    ["ReportButton", "ScanButton"],
  );
  // Header → page: the KPI row, then the card “Findings”.
  const [page] = byClass(h.tree, "v2-list-page");
  same(
    [page.props.children]
      .flat()
      .filter(Boolean)
      .map((block) => block.type),
    ["ToolKpis", "ToolCard"],
  );
  // Before the first answer: KPI values “—” (null), the pending empty
  // state of the same height and the busy card.
  same(
    kpis(h).kpis.map((kpi) => [kpi.key, kpi.value, kpi.hero]),
    [
      ["checked", null, true],
      ["open", null, false],
      ["fixed", null, false],
      ["manual", null, false],
    ],
  );
  let empty = one(card(h).props.children, "ListEmpty");
  assert.equal(empty.props.pending, true);
  assert.equal(card(h).props.busy, true);
  assert.equal(header(h).props.meta, "0 open");
  await h.poll();
  // Open, manual and failed findings are open (1.7.0).
  assert.equal(header(h).props.meta, "5 open");
  same(kpis(h).kpis, toolList.fileCheckKpis(h.activity));
  same(
    kpis(h).kpis.map((kpi) => kpi.value),
    [1284, 3, 1, 1],
  );
  const c = card(h).props;
  assert.equal(c.id, "filecheck");
  assert.equal(c.title, "Findings");
  assert.equal(c.total, 6);
  assert.equal(c.busy, false);
  assert.equal(c.activity, "");
  assert.equal(c.allLabel, "All findings");
  same(c.search, {
    label: "Title or path",
    placeholder: "Search title or path …",
    value: "",
  });
  same(c.csv, { href: "/api/filecheck/export.csv?q=", enabled: true });
  // Help: “Last scan” (raw: the time and the duration) and “How scanning
  // works”.
  same(
    c.help.map((section) => [section.heading, !!section.raw]),
    [
      ["Last scan", true],
      ["How scanning works", false],
    ],
  );
  assert.match(c.help[0].text, /^Last scan: .+ \(12 s\)$/);
  assert.equal(
    c.help[1].text,
    "Choose services and checks in the Scan dialog. Reads folder metadata only and never opens files. Disks may spin up if their directory data is not cached.",
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
      ["path", "Path"],
      ["kind", "Kind"],
      ["current", "Current"],
      ["fix", "Fix"],
      ["status", "Status"],
      ["progress", "Progress"],
      ["remove", "Actions"],
    ],
  );
  // The sortable columns sort by their column (the route), the server
  // field comes from fileCheckSortFields.
  same(
    table(h)
      .props.columns.filter((entry) => entry.sort)
      .map((entry) => entry.sort),
    ["title", "path", "kind", "current", "fix", "status", "progress"],
  );
  for (const entry of table(h).props.columns.filter((e) => e.sort))
    assert.ok(fileCheck.fileCheckSortFields[entry.sort], entry.sort);
  assert.equal(column(h, "actions").info, true);
  assert.equal(column(h, "title").grow, true);
  // The widths from the labels and the tool's status texts.
  same(table(h).props.style, { "--tt-min": "1200px" });
  same(h.styleArgs[0], fileCheck.fileCheckOrderedColumns(null));
  assert.equal(h.styleArgs[1], "files");
  assert.equal(h.styleArgs[2], fileCheck.fileCheckColumnLabels);
  same(h.styleArgs[3], { info: 2, actions: 2, infoPhone: 1, actionsPhone: 1 });
  // The settings' columns, in their order.
  const custom = filesPage({
    settings: {
      filecheckColumnOrder: ["path", "status", "actions", "remove"],
      filecheckVisibleColumns: ["select", "path", "status", "remove"],
    },
  });
  await custom.poll();
  same(
    table(custom).props.columns.map((entry) => entry.key),
    ["path", "status", "remove"],
  );
  // Sorting goes to the route (useToolPageState).
  table(h).props.onSort("current");
  same(h.log.at(-1), ["sort", "current"]);
  // Without a scan: only “How scanning works”.
  const fresh = filesPage({
    activity: activityOf({ scan: { running: false }, report: undefined }),
  });
  await fresh.poll();
  same(
    card(fresh).props.help.map((section) => section.heading),
    ["How scanning works"],
  );
  // The hero without a report reads “—”.
  assert.equal(kpis(fresh).kpis[0].value, null);
  // No 1.7.0 page part is built.
  const built = allClasses(h.tree);
  for (const legacy of [
    "filter-panel",
    "filecheck-panel",
    "results-heading",
    "results-tools",
    "tool-table",
    "filecheck-table",
    "placement-table",
    "library-section",
    "tool-activity",
    "scan-ready",
    "notice",
  ])
    assert.ok(!built.includes(legacy), legacy);
  assert.ok(built.includes("v2-list-page"));
});

test("the activity line names scans and fixes without moving the card", async () => {
  const h = filesPage({
    activity: activityOf({
      scan: { ...SCAN, running: true, checked: 2, total: 6 },
    }),
  });
  await h.poll();
  assert.equal(card(h).props.activity, "Scanning 2 of 6 items");
  assert.equal(card(h).props.busy, true);
  h.activity = activityOf({ queued: 2, running: 1 });
  await h.poll();
  assert.equal(card(h).props.activity, "Fixing · 2 waiting");
  assert.equal(card(h).props.busy, true);
  for (const [work, wait] of [
    ["mux", "Waiting: a mux job is running"],
    ["placement", "Waiting: disk placement is moving files"],
  ]) {
    h.activity = activityOf({ queued: 2, fileWork: work });
    await h.poll();
    assert.equal(card(h).props.activity, "Fixing · 2 waiting · " + wait);
  }
  // Its own fixes are no wait.
  h.activity = activityOf({ queued: 2, fileWork: "files" });
  await h.poll();
  assert.equal(card(h).props.activity, "Fixing · 2 waiting");
  // A fix alone turns the spinner and leaves the rows undimmed; a reload
  // slower than 300 ms dims them, also while the fix runs (review M-1).
  assert.deepEqual([card(h).props.busy, card(h).props.dimmed], [true, false]);
  let release;
  h.answer = () =>
    new Promise((resolve) => {
      release = () =>
        resolve({ items: h.items, total: h.items.length, selectableIds: [] });
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
});

test("file check KPI cards filter by open, fixed and manual findings", async () => {
  const h = filesPage();
  await h.poll();
  const [checked, open, fixed, manual] = kpis(h).kpis;
  // The hero is no filter.
  assert.equal(checked.statuses, null);
  same(
    [open, fixed, manual].map((kpi) => [kpi.label, kpi.statuses]),
    [
      ["Open", ["open"]],
      ["Fixed", ["fixed"]],
      ["Manual", ["manual"]],
    ],
  );
  same(kpis(h).statuses, []);
  // A press shows only its findings, on page 1 (one route change).
  kpis(h).choose(fixed);
  same(h.log.at(-1), ["filters", { statuses: ["fixed"] }]);
  assert.equal(h.route.page, 1);
  h.render();
  same(kpis(h).statuses, ["fixed"]);
  assert.ok(toolList.kpiPressed(kpis(h).statuses, kpis(h).kpis[2]));
  // Another card replaces it; a press on the pressed card clears it.
  kpis(h).choose(kpis(h).kpis[3]);
  same(h.log.at(-1), ["filters", { statuses: ["manual"] }]);
  h.render();
  kpis(h).choose(kpis(h).kpis[3]);
  same(h.log.at(-1), ["filters", { statuses: [] }]);
  h.render();
  kpis(h).choose(kpis(h).kpis[1]);
  same(h.log.at(-1), ["filters", { statuses: ["open"] }]);
  // The list asks for exactly that status.
  h.render();
  await h.poll();
  assert.match(h.lists.at(-1), /^filecheck\/items\?q=&status=open&/);
});

test("finding rows offer details, terminal, fix, status and removal", async () => {
  const h = filesPage();
  await h.poll();
  // Info: Details (at every width) and Terminal (above 739).
  same(
    buttons(cell(h, "actions", 1)).map((b) => [b.label, b.title, b.only]),
    [
      ["Details for movies/Tenet (2020)", "Details", undefined],
      ["Terminal for movies/Tenet (2020)", "Terminal", "desk"],
    ],
  );
  buttons(cell(h, "actions", 1))[0].onClick();
  h.render();
  let dialog = one(h.tree, "FileCheckDetailDialog").props;
  assert.equal(dialog.item.id, 1);
  assert.equal(dialog.disabled, false);
  same(dialog.options, fileCheck.defaultFileCheckSettings);
  await dialog.commands();
  await settle();
  same(h.log.at(-1), ["api", "filecheck/commands", "POST", { ids: [1] }]);
  h.render();
  assert.equal(ofType(h.tree, "FileCheckDetailDialog").length, 0);
  one(h.tree, "FileCheckCommandsDialog").props.close();
  h.render();
  // The row's Terminal: that finding's commands in the dialog.
  await buttons(cell(h, "actions", 2))[1].onClick();
  await settle();
  same(h.log.at(-1), ["api", "filecheck/commands", "POST", { ids: [2] }]);
  h.render();
  same(
    [
      one(h.tree, "FileCheckCommandsDialog").props.text,
      one(h.tree, "FileCheckCommandsDialog").props.hostPaths,
    ],
    ["chmod 0666 x\n", true],
  );
  one(h.tree, "FileCheckCommandsDialog").props.close();
  h.render();
  // The title with its instance (its full text as title: an instance
  // name may be cut, F-I2).
  same(
    ofType([cell(h, "title", 3)].flat(), "div").map((d) => [
      d.props.class,
      d.props.title,
      text(d),
    ]),
    [
      ["v2-table-name", "Dark", "Dark"],
      ["v2-table-sub", "Sonarr", "Sonarr"],
    ],
  );
  // The path: a folder icon for a folder, the whole path as its title and
  // the note below it.
  const path = [cell(h, "path", 1)].flat();
  same(
    [
      ofType(path, "div")[0].props.class,
      ofType(path, "div")[0].props.title,
      ofType(path, icons.Folder).length,
    ],
    ["v2-table-line", "movies/Tenet (2020)", 1],
  );
  assert.equal(text(byClass(path, "v2-table-name")[0]), "movies/Tenet (2020)");
  assert.equal(ofType([cell(h, "path", 2)].flat(), icons.Folder).length, 0);
  same(byClass([cell(h, "path", 4)].flat(), "v2-table-sub").map(text), [
    messages.placementMessage("disk1 unavailable", t),
  ]);
  assert.equal(byClass([cell(h, "path", 2)].flat(), "v2-table-sub").length, 0);
  // Kind with its help as the title.
  const kind = cell(h, "kind", 1);
  same(
    [kind.type, kind.props.title, text(kind)],
    ["span", fileCheck.fileCheckKindHelp.owner, "Owner"],
  );
  // Current: the mode in monospace, owner and size below (a folder has no
  // size).
  same(
    ofType([cell(h, "current", 2)].flat(), "div").map((d) => [
      d.props.class,
      text(d),
    ]),
    [
      ["v2-table-mono", "-rw-------"],
      ["v2-table-sub", "0:0 · 200 B"],
    ],
  );
  assert.equal(text(ofType([cell(h, "current", 1)].flat(), "div")[1]), "0:0");
  // Fix: the fix of the scan's settings; Manual in the warning tone.
  // The plain text columns clip (F-I2: their texts are measured whole).
  same(
    table(h)
      .props.columns.filter((entry) => entry.clip)
      .map((entry) => entry.key),
    ["kind", "current", "fix"],
  );
  assert.equal(cell(h, "fix", 2), "chmod 666");
  assert.equal(cell(h, "fix", 1), "Take ownership");
  assert.equal(
    column(h, "fix").cell(finding(9, "X", "x", { dir: true })),
    "chmod 777",
  );
  const manual = cell(h, "fix", 4);
  same(
    [manual.type, manual.props.class, manual.props["data-tone"], text(manual)],
    ["span", "v2-st", "warn", "Manual"],
  );
  // The status button names the text it shows (ruling I7) and opens the
  // details.
  const status = cell(h, "status", 1);
  assert.equal(status.type, "StatusTag");
  same(status.props.view, toolStatus.fileCheckStatusView(rowOf(h, 1), t));
  assert.equal(status.props.openLabel, "Status: Open. Show details");
  assert.equal(
    cell(h, "status", 4).props.openLabel,
    "Status: Manual. Show details",
  );
  assert.equal(cell(h, "status", 6).props.view.long, "Operation not permitted");
  status.props.open();
  h.render();
  dialog = one(h.tree, "FileCheckDetailDialog").props;
  assert.equal(dialog.item.id, 1);
  dialog.close();
  h.render();
  // Progress: the progress cell of the fix.
  same(
    [cell(h, "progress", 5).type, cell(h, "progress", 5).props],
    ["ProgressCell", { status: "queued", value: 0, label: "Progress" }],
  );
  // Actions: Fix for every row (locked unless it can be fixed), Remove
  // only for a fixed finding.
  for (const { id, rel } of h.items) {
    const list = buttons(cell(h, "remove", id));
    assert.equal(list[0].label, "Fix " + rel, id);
    assert.equal(list[0].title, "Fix", id);
    assert.equal(list[0].only, "desk", id);
    assert.equal(
      list[0].disabled,
      !fileCheck.fileCheckFixable(rowOf(h, id)),
      id,
    );
    assert.equal(list.length, id === 3 ? 2 : 1, id);
  }
  const [fix, remove] = buttons(cell(h, "remove", 3));
  same(
    [remove.label, remove.tone, remove.only, remove.disabled],
    ["Remove shows/Dark/Season 2 from the list", "danger", undefined, false],
  );
  assert.equal(fix.disabled, true);
  await remove.onClick();
  await settle();
  same(h.log.slice(-2), [
    ["removal", 3],
    ["api", "filecheck/items/3", "DELETE", null],
  ]);
  // Fixing one finding asks nothing.
  buttons(cell(h, "remove", 2))[0].onClick();
  await settle();
  same(h.log.at(-1), ["api", "filecheck/fix", "POST", { ids: [2] }]);
  assert.ok(!h.log.some(([kind]) => kind === "confirmDeletion"));
});

test("finding row buttons keep their places while a finding's status changes", async () => {
  const h = filesPage({ items: [finding(2, "Her", "movies/Her.nfo")] });
  await h.poll();
  const shape = () => ({
    info: buttons(cell(h, "actions", 2)).map((b) => [b.label, b.only]),
    actions: [cell(h, "remove", 2)].flat().map((node) => node.props.class),
    first: buttons(cell(h, "remove", 2))[0].label,
  });
  const before = shape();
  same(before.actions, ["v2-table-items"]);
  assert.equal(before.first, "Fix movies/Her.nfo");
  for (const jobStatus of [
    "queued",
    "running",
    "succeeded",
    "failed",
    "cancelled",
    "needs_review",
    "",
  ]) {
    h.items = [{ ...h.items[0], jobStatus }];
    await h.poll();
    same(shape(), before, jobStatus);
    const list = buttons(cell(h, "remove", 2));
    assert.equal(list.length, jobStatus === "succeeded" ? 2 : 1, jobStatus);
    assert.equal(
      list[0].disabled,
      !["", "failed"].includes(jobStatus),
      jobStatus,
    );
  }
  // The columns' widths never see the rows: the same columns go in.
  same(h.styleArgs[0], fileCheck.fileCheckOrderedColumns(null));
});

test("fix selected sends only fixable findings and confirms more than one", async () => {
  const h = filesPage({ answers: { confirmDeletion: false } });
  await h.poll();
  const selection = () => table(h).props.selection;
  same(
    [selection().allLabel, selection().rowLabel(rowOf(h, 1))],
    ["Select all visible findings", "Select finding movies/Tenet (2020)"],
  );
  assert.equal(selection().disabled, false);
  // The page box adds or removes only the page's ids, as in 1.7.0.
  assert.equal(selection().keepOthers, true);
  // Every finding but waiting, running and fixed ones can be chosen
  // (fileCheckSelectable), manual ones too.
  same(
    h.items.filter((entry) => selection().selectable(entry)).map((i) => i.id),
    [1, 2, 4, 6],
  );
  const selected = () => tool(h, "Fix selected");
  same(
    [selected().props.count, selected().props.max, selected().props.disabled],
    [0, 50, true],
  );
  assert.equal(
    selected().props.title,
    "None of the selected findings can be fixed automatically. Use Terminal commands.",
  );
  // A manual finding alone: nothing to fix.
  selection().set([4]);
  h.render();
  same([selected().props.count, selected().props.disabled], [0, true]);
  // With fixable ones: only they count and go.
  selection().set([1, 4, 6]);
  h.render();
  same(
    [selected().props.count, selected().props.disabled, selected().props.title],
    [2, false, "Fix selected"],
  );
  // The selection is the page's (pruned to its rows on every answer), so
  // the page size bounds the slot.
  assert.equal(selected().props.max, 50);
  await selected().props.onClick();
  await settle();
  same(h.log.at(-1), [
    "confirmDeletion",
    "You are about to fix 2 findings.",
    false,
    "Fix",
  ]);
  assert.ok(!h.log.some(([, path]) => path === "filecheck/fix"));
  // Yes: the fixable ids go to filecheck/fix and the selection clears.
  const yes = filesPage();
  await yes.poll();
  table(yes).props.selection.set([6, 1]);
  yes.render();
  await tool(yes, "Fix selected").props.onClick();
  await settle();
  same(yes.log.slice(-2), [
    ["confirmDeletion", "You are about to fix 2 findings.", false, "Fix"],
    ["api", "filecheck/fix", "POST", { ids: [1, 6] }],
  ]);
  yes.render();
  same(table(yes).props.selection.selected, []);
  // Fix all: every fixable match of the filters, the other pages too.
  yes.route.filters = { ...yes.route.filters, kinds: ["owner"] };
  await yes.poll();
  const all = tool(yes, "Fix all");
  same(
    [text(all), all.props.disabled, all.props.class],
    ["Fix all", false, "v2-btn v2-btn--sm"],
  );
  await all.props.onClick();
  await settle();
  same(yes.log.slice(-2), [
    ["confirmDeletion", "You are about to fix 3 findings.", false, "Fix"],
    ["api", "filecheck/fix", "POST", { all: true, query: "q=&kind=owner" }],
  ]);
  // One fixable finding asks nothing.
  const single = filesPage({ items: [finding(2, "Her", "movies/Her.nfo")] });
  await single.poll();
  await tool(single, "Fix all").props.onClick();
  await settle();
  same(single.log.at(-1), [
    "api",
    "filecheck/fix",
    "POST",
    { all: true, query: "q=" },
  ]);
  assert.ok(!single.log.some(([kind]) => kind === "confirmDeletion"));
  // Without fixable findings Fix all is locked.
  single.items = [finding(4, "Alien", "x", { fix: "manual" })];
  await single.poll();
  assert.equal(tool(single, "Fix all").props.disabled, true);
  // While a scan runs the boxes and both fixes are locked; a scan that
  // ends clears the selection and opens its report.
  table(yes).props.selection.set([1]);
  yes.activity = activityOf({ scan: { ...SCAN, running: true } });
  await yes.poll();
  assert.equal(table(yes).props.selection.disabled, true);
  assert.equal(tool(yes, "Fix selected").props.disabled, true);
  assert.equal(tool(yes, "Fix all").props.disabled, true);
  yes.activity = activityOf({
    scan: { ...SCAN, finishedAt: "2026-11-01T10:00:00Z" },
  });
  await yes.poll();
  same(table(yes).props.selection.selected, []);
  assert.equal(
    ofType(yes.tree, "Modal").filter((m) => m.props.title === "Scan report")
      .length,
    1,
  );
  // Cancel is always there (ruling R-H), locked without fixes; Remove
  // completed removes the fixed findings, locked without them.
  const cancel = () => tool(single, "Cancel");
  same(
    [text(cancel()), cancel().props.disabled, !!cancel().props.hidden],
    ["Cancel", true, false],
  );
  single.activity = activityOf({ queued: 2 });
  await single.poll();
  assert.equal(cancel().props.disabled, false);
  await cancel().props.onClick();
  await settle();
  same(single.log.at(-1), ["api", "filecheck/cancel", "POST", null]);
  const completed = tool(single, "Remove completed");
  assert.equal(completed.props.disabled, false);
  await completed.props.onClick();
  await settle();
  same(single.log.at(-1), ["api", "filecheck/items?fixed=1", "DELETE", null]);
  single.activity = activityOf({ fixed: 0 });
  await single.poll();
  assert.equal(tool(single, "Remove completed").props.disabled, true);
  // The tools in the 1.7.0 order.
  same(
    tools(single)
      .filter((node) => node.type === "CountTool" || node.type === "button")
      .map((node) => node.props.text ?? node.props.title),
    [
      "Fix selected",
      "Fix all",
      "Terminal commands",
      "Cancel",
      "Remove completed",
    ],
  );
});

test("terminal commands open the dialog or download every match", async () => {
  const h = filesPage({ filters: { kinds: ["permissions"] } });
  await h.poll();
  const terminal = () => tool(h, "Terminal commands");
  // Without a selection: the dialog that offers every match's download,
  // with the host paths of the activity.
  same(
    [terminal().props.count, terminal().props.max, terminal().props.disabled],
    [0, 50, false],
  );
  terminal().props.onClick();
  h.render();
  let dialog = one(h.tree, "FileCheckCommandsDialog").props;
  same(
    [dialog.text, dialog.hostPaths, dialog.total, dialog.busy],
    ["", true, 6, false],
  );
  await dialog.downloadAll();
  await settle();
  same(h.log.slice(-2), [
    [
      "api",
      "filecheck/commands",
      "POST",
      { all: true, query: "q=&kind=permissions" },
    ],
    ["download", "chmod 0666 x\n"],
  ]);
  dialog.close();
  h.render();
  // Without host paths the dialog says so.
  h.activity = activityOf({ physical: false });
  await h.poll();
  terminal().props.onClick();
  h.render();
  assert.equal(one(h.tree, "FileCheckCommandsDialog").props.hostPaths, false);
  one(h.tree, "FileCheckCommandsDialog").props.close();
  h.render();
  // With a selection: the commands of the chosen findings, manual ones too.
  table(h).props.selection.set([2, 4]);
  h.render();
  same([terminal().props.count, terminal().props.disabled], [2, false]);
  await terminal().props.onClick();
  await settle();
  same(h.log.at(-1), ["api", "filecheck/commands", "POST", { ids: [2, 4] }]);
  h.render();
  dialog = one(h.tree, "FileCheckCommandsDialog").props;
  same([dialog.text, dialog.hostPaths], ["chmod 0666 x\n", true]);
  // Without matches the tool is locked.
  h.items = [];
  await h.poll();
  assert.equal(terminal().props.disabled, true);
});

test("the files drawer asks for one finding and applies once", async () => {
  const h = filesPage({ filters: { q: "dune", statuses: ["active"] } });
  await h.poll();
  // The drawer chunk preloads at idle and opens through useLazyChunk.
  assert.equal(h.lazy.at(-1).chunk, "toolDrawerChunk");
  assert.equal(h.lazy.at(-1).open, false);
  assert.equal(ofType(h.tree, "Drawer").length, 0);
  const filters = () => card(h).props.filters;
  same(filters(), { count: 1, expanded: false });
  const trigger = { isConnected: true, focus: (o) => h.log.push(["focus", o]) };
  filters().open(trigger);
  h.render();
  assert.equal(h.lazy.at(-1).open, true);
  assert.equal(filters().expanded, true);
  const drawer = () => one(h.tree, "Drawer").props;
  assert.equal(drawer().subtitle, "Findings");
  // Shares (two of them), Kind and Status, in the 1.7.0 order and values.
  same(
    drawer().groups.map((group) => [group.key, group.label]),
    [
      ["shares", "Shares"],
      ["kinds", "Kind"],
      ["statuses", "Status"],
    ],
  );
  same(drawer().groups[0].options, [
    { value: "movies", label: "movies", count: 5 },
    { value: "shows", label: "shows", count: 1 },
  ]);
  // Only the kinds the scan found (or a chosen one), with their counts.
  same(drawer().groups[1].options, [
    { value: "permissions", label: "Permissions", count: 4 },
    { value: "owner", label: "Owner", count: 1 },
    { value: "other", label: "Other file", count: 1 },
  ]);
  // Open, Manual, Completed and Failed, and the deep link's Active.
  same(drawer().groups[2].options, [
    { value: "open", label: "Open", count: 3 },
    { value: "manual", label: "Manual", count: 1 },
    { value: "fixed", label: "Completed", count: 1 },
    { value: "failed", label: "Failed", count: 1 },
    { value: "active", label: "Active" },
  ]);
  same(drawer().initial, {
    statuses: ["active"],
    kinds: [],
    targets: [],
    shares: [],
  });
  assert.equal(drawer().localCount, undefined);
  // One finding of the draft's results, with the search.
  const draft = {
    statuses: ["open"],
    kinds: ["owner"],
    targets: [],
    shares: ["movies"],
  };
  assert.equal(
    drawer().countPath(draft),
    "filecheck/items?q=dune&status=open&kind=owner&share=movies&limit=1",
  );
  // Apply: one route change (statuses and kinds, page 1) and the shares,
  // which stay out of the route.
  const before = h.log.filter(([kind]) => kind === "filters").length;
  drawer().apply(draft);
  h.render();
  const applied = h.log.filter(([kind]) => kind === "filters");
  assert.equal(applied.length, before + 1, "one route change");
  same(applied.at(-1), ["filters", { statuses: ["open"], kinds: ["owner"] }]);
  same(h.route.filters, {
    q: "dune",
    statuses: ["open"],
    targets: [],
    kinds: ["owner"],
  });
  assert.equal(h.route.page, 1);
  same(drawer().initial.shares, ["movies"]);
  assert.equal(filters().count, 3);
  await h.poll();
  assert.match(h.lists.at(-1), /&share=movies&/);
  // A history step brings other filters: the draft starts from them (M16).
  h.route.filters = { ...h.route.filters, statuses: ["fixed"] };
  h.render();
  same(drawer().initial.statuses, ["fixed"]);
  // Closing hands focus back to the Filters button.
  h.document.activeElement = h.document.body;
  drawer().close();
  h.render();
  assert.equal(ofType(h.tree, "Drawer").length, 0);
  same(h.log.at(-1), ["focus", { preventScroll: true }]);
  // One share: no Shares group, unless one is chosen (then with a share
  // the results no longer hold, so it can be cleared). A chosen kind the
  // scan did not find stays listed.
  const single = filesPage({ filters: { kinds: ["junk"] } });
  single.results = { shares: { movies: 4 } };
  await single.poll();
  card(single).props.filters.open(trigger);
  single.render();
  const groups = () => one(single.tree, "Drawer").props.groups;
  same(
    groups().map((group) => group.key),
    ["kinds", "statuses"],
  );
  same(
    groups()[0].options.map((option) => [option.value, option.count]),
    [
      ["permissions", 4],
      ["owner", 1],
      ["junk", 0],
      ["other", 1],
    ],
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
  // Before a scan the values have no counts.
  const fresh = filesPage({
    activity: activityOf({ scan: { running: false }, report: undefined }),
  });
  await fresh.poll();
  card(fresh).props.filters.open(trigger);
  fresh.render();
  assert.ok(
    one(fresh.tree, "Drawer")
      .props.groups.find((g) => g.key === "statuses")
      .options.every((option) => option.count === undefined),
  );
});

test("file check chips keep the 1.7.0 order", async () => {
  // Shares, Kind, Status, Search, as the 1.7.0 page built them.
  const h = filesPage({
    filters: { q: "Tenet", statuses: ["open"], kinds: ["owner"] },
  });
  await h.poll();
  card(h).props.filters.open({ isConnected: true, focus() {} });
  h.render();
  one(h.tree, "Drawer").props.apply({
    statuses: ["open"],
    kinds: ["owner"],
    targets: [],
    shares: ["movies"],
  });
  await h.poll();
  const chips = () => card(h).props.chips;
  same(
    chips().map((chip) => chip.label),
    ["Shares: movies", "Kind: Owner", "Status: Open", "Search: Tenet"],
  );
  same(
    toolFilters.chipRow(chips()).map((chip) => [chip.key, chip.excluded]),
    [
      ["Shares:movies", false],
      ["Kind:owner", false],
      ["Status:open", false],
      ["q", false],
    ],
  );
  assert.equal(card(h).props.active, true);
  // Each chip removes its own value; the share goes back to page 1.
  chips()[0].remove();
  h.render();
  same(h.log.at(-1), ["page", 1]);
  assert.ok(!chips().some((chip) => chip.key === "Shares:movies"));
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

test("file check export keeps filters and sort", async () => {
  const h = filesPage({
    filters: { kinds: ["owner"] },
    sort: { field: "current", direction: "asc" },
  });
  await h.poll();
  same(card(h).props.csv, {
    href: "/api/filecheck/export.csv?q=&kind=owner&sort=size&dir=asc",
    enabled: true,
  });
  // The list asks with the same filters, sort and page.
  assert.equal(
    h.lists.at(-1),
    "filecheck/items?q=&kind=owner&sort=size&dir=asc&offset=0&limit=50",
  );
  // Without matches the export is locked.
  h.items = [];
  await h.poll();
  assert.equal(card(h).props.csv.enabled, false);
});

test("the scan report filters by kind and saves mappings as before", async () => {
  const h = filesPage({ settings: { mux: { mappings: "/media:/mnt/user" } } });
  await h.poll();
  same([reportButton(h).notices, reportButton(h).disabled], [false, false]);
  reportButton(h).open();
  h.render();
  const report = () =>
    ofType(h.tree, "Modal").find((m) => m.props.title === "Scan report");
  assert.equal(report().props.className, "placement-summary");
  // The 1.7.0 report: time, duration and the scan's numbers.
  const values = ofType(report(), "dd").map(text);
  same(values.slice(1), [
    "0 min 12 s",
    "1284",
    "5120",
    "6",
    "6",
    "2100 B",
    "1",
  ]);
  // The skipped roots with the mux mappings; a saved mapping highlights
  // Scan and reloads.
  const roots = one(report(), "SkippedRootsNotice").props;
  same(roots.roots, { roots: [], mappings: "/media:/mnt/user" });
  assert.equal(roots.disabled, false);
  roots.setup();
  same(h.log.at(-1), ["setup", "mux"]);
  assert.equal(scanButton(h).ready, false);
  const lists = h.lists.length;
  await roots.saved();
  h.render();
  same(h.log.at(-1), ["changed"]);
  assert.equal(scanButton(h).ready, true);
  same(h.polling.deps.at(-1), 1);
  assert.equal(h.lists.length, lists);
  // “By kind”: a kind with findings filters the list on page 1 and closes.
  const kinds = byClass(report(), "text-button");
  same(kinds.map(text), ["Permissions", "Owner", "Other file"]);
  kinds[1].props.onClick();
  h.render();
  same(h.log.slice(-2), [
    ["filters", { kinds: ["owner"] }],
    ["page", 1],
  ]);
  assert.equal(report(), undefined);
  // A new scan: the report says it shows the previous one; Scan cancels.
  h.activity = activityOf({ scan: { ...SCAN, running: true } });
  await h.poll();
  reportButton(h).open();
  h.render();
  assert.match(
    text(report()),
    /A new scan is running\. This report shows the previous scan\./,
  );
  assert.equal(one(report(), "SkippedRootsNotice").props.disabled, true);
  report().props.close();
  h.render();
  assert.equal(scanButton(h).scanning, true);
  scanButton(h).press();
  await settle();
  same(
    h.log.find(([kind, path]) => kind === "api" && path === "filecheck/scan"),
    ["api", "filecheck/scan", "DELETE", null],
  );
  // Without a scan: no report; Scan opens the scan dialog, which starts it
  // with the options and opens the names in the Unraid settings.
  const fresh = filesPage({
    activity: activityOf({ scan: { running: false }, report: undefined }),
  });
  await fresh.poll();
  assert.equal(reportButton(fresh).disabled, true);
  same(
    [scanButton(fresh).scanning, scanButton(fresh).disabled],
    [false, false],
  );
  scanButton(fresh).press();
  fresh.render();
  const scan = one(fresh.tree, "FileCheckScanDialog").props;
  same([scan.physical, scan.fixesActive, scan.scanning], [true, false, false]);
  await scan.start({ ...scan.options, kinds: ["owner"] });
  same(fresh.log.slice(-2), [
    [
      "api",
      "filecheck/scan",
      "POST",
      plain({ ...scan.options, kinds: ["owner"] }),
    ],
    ["changed"],
  ]);
  fresh.render();
  assert.equal(ofType(fresh.tree, "FileCheckScanDialog").length, 0);
  scanButton(fresh).press();
  fresh.render();
  one(fresh.tree, "FileCheckScanDialog").props.openNames();
  same(fresh.log.at(-1), ["setup", "unraid"]);
  // A report with a root that is not mapped has notices.
  const notices = filesPage({
    activity: activityOf({
      report: { ...SCAN, roots: [{ root: "/x", mapped: false }] },
    }),
  });
  await notices.poll();
  assert.equal(reportButton(notices).notices, true);
});

test("an unready file check shows its reason in the card", async () => {
  const error = "Configure path mappings for Radarr and Sonarr first";
  const h = filesPage({ activity: activityOf({ ready: false, error }) });
  await h.poll();
  // The table has no rows; Scan is locked while not ready.
  same(table(h).props.rows, []);
  assert.equal(scanButton(h).disabled, true);
  const empty = one(card(h).props.children, "ListEmpty");
  same([empty.props.title, !!empty.props.pending], [error, false]);
  const settings = one(empty, "button");
  same(
    [text(settings), settings.props.class],
    ["Open settings", "v2-btn v2-btn--primary"],
  );
  settings.props.onClick();
  same(h.log.at(-1), ["setup", undefined]);
  // Without an error text: the 1.7.0 fallback.
  h.activity = activityOf({ ready: false, error: "" });
  await h.poll();
  assert.equal(
    one(card(h).props.children, "ListEmpty").props.title,
    "Enable the MKVToolNix service and configure path mappings first",
  );
  // A failed first answer is not ready either.
  const failed = filesPage();
  failed.fail = true;
  await failed.poll();
  same(
    [
      !!one(card(failed).props.children, "ListEmpty").props.pending,
      one(card(failed).props.children, "ListEmpty").props.title,
    ],
    [false, "Enable the MKVToolNix service and configure path mappings first"],
  );
  // Ready without rows: no scan yet, everything fine, or no match.
  const empties = [
    [
      { scan: { running: false }, report: undefined },
      "No scan yet",
      "Choose your libraries and checks, then click Scan.",
    ],
    [
      { scan: { ...SCAN, findings: 0 } },
      "Everything looks fine",
      "Change the filters or scan again.",
    ],
    [{}, "No matching findings", "Change the filters or scan again."],
  ];
  for (const [activity, title, sentence] of empties) {
    const page = filesPage({ items: [], activity: activityOf(activity) });
    await page.poll();
    const state = one(card(page).props.children, "ListEmpty");
    assert.equal(state.props.title, title);
    same(ofType(state, "p").map(text), [sentence]);
  }
});

test("files drop the transition sheet", () => {
  // Its 1.7.0 parts left the page.
  const page = src("components/FileCheckPage.tsx");
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
    "SortableHeader,",
    "FileCheckStatusTag",
    "HelpPopover",
  ])
    assert.ok(!page.includes(gone), gone);
  // The selection helpers stay exported.
  assert.match(page, /export function fileCheckSelectable/);
  assert.match(page, /export function fileCheckVisibleSelection/);
});
