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

// The Muxing page on the tool blocks (Phase 5b, task 6; docs/STYLEGUIDE.md,
// Part 1, 11.1): MuxPage runs as real code with the hook runtime and the
// real mux rules (mux-spec, mux-selection, tool-list, tool-status,
// tool-table, tool-filters); the blocks it places are named stubs, so a
// tree shows what they receive, and the requests, questions, toasts and
// route changes are recorded.

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
    "./placement-messages": loadSource("placement-messages.ts"),
    "./tool-columns": columns,
  },
});
const toolTable = loadSource("tool-table.ts");
const fileSelection = await import("../src/file-selection.ts");
const muxSelection = loadSource("mux-selection.ts", {
  modules: { "./file-selection.ts": fileSelection },
});
const ICON = {
  arrow: 11,
  label: 15,
  row: 15,
  button: 16,
  large: 18,
  empty: 28,
};
const ui = { ICON, bytes: (n) => n + " B", count: (n) => String(n) };
const { CountTool } = loadSource("components/list/TableCard.tsx", {
  modules: {
    "preact/hooks": createHookRuntime().hooks,
    "../../hooks/useTableOverflow": { useTableOverflow: () => false },
    "../../ui": ui,
  },
});

const ok = {
  workWritable: true,
  workFreeSpace: true,
  exists: true,
  readable: true,
  writable: true,
  freeSpace: true,
  sizeMatches: true,
  unchanged: true,
};
let created = 0;
function job(id, status, title, extra = {}) {
  return {
    id,
    service: "radarr",
    fileId: 900 + id,
    title,
    sourceName: title + ".mkv",
    status,
    revision: 1,
    spec: { outputName: title, tracks: {} },
    source: { size: id * 1000, tracks: [] },
    check: ok,
    progress: status === "running" ? 64 : 0,
    backupName: "",
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, ++created)).toISOString(),
    ...extra,
  };
}
// One job per status, as C+ shows them.
const JOBS = () => [
  job(1, "running", "Arrival"),
  job(2, "queued", "Dune"),
  job(3, "failed", "Heat"),
  job(4, "succeeded", "Alien"),
  job(5, "ready", "Tenet"),
  job(6, "draft", "Her"),
  job(7, "needs_attention", "Up"),
  job(8, "cancelled", "Elf"),
];

// The page with its boundaries recorded in `log`. `poll()` answers the
// page's mux/jobs request with `jobs`; `render()` settles the page.
function muxPage({
  jobs = JOBS(),
  installed = true,
  filters = {},
  marking = {},
  answers = {},
  rejected = {},
  pageSize = 100,
} = {}) {
  const log = [];
  const runtime = createHookRuntime();
  const route = {
    filters: { q: "", statuses: [], targets: [], kinds: [], ...filters },
    sort: null,
    page: 1,
  };
  const mux = {
    working: null,
    done: 0,
    total: 0,
    marked: 0,
    removable: 0,
    run: async (remove) => log.push(["run", remove]),
    ...marking,
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
        if (path === "mux/jobs" && method === "GET") return h.jobs;
        log.push(["api", path, method, plain(body ?? null)]);
        return path === "mux/run" ? { rejected } : {};
      },
    },
    "../confirmation": {
      confirmAction: (...args) => answer("confirmAction", ...args),
      confirmDeletion: (...args) => answer("confirmDeletion", ...args),
      confirmDiscard: (...args) => answer("confirmDiscard", ...args),
    },
    "../event-log": { openLog: (filter) => log.push(["openLog", filter]) },
    "../hooks/useLazyChunk": {
      useLazyChunk: (chunk, open, close) => {
        lazy.push({ chunk, open, close });
        return open ? "Drawer" : null;
      },
    },
    "../hooks/useMuxSelection": {
      useMuxSelection(args) {
        h.selectionArgs = args;
        return mux;
      },
    },
    "../hooks/usePolling": {
      usePolling: (load) => {
        poll = load;
      },
    },
    "../hooks/useRowRemoval": {
      useRowRemoval: () => h.removal,
    },
    "../hooks/useToolPageState": {
      useToolPageState: (tool, allowed, options) => {
        h.pageState = { tool, allowed, options };
        return {
          filters: route.filters,
          setFilters: (next) => {
            log.push(["filters", plain(next)]);
            route.filters = next;
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
      useToolPresets: (service, query, apply) => {
        h.presetArgs = { service, query: String(query), apply };
        return h.presets;
      },
    },
    "../i18n": i18n,
    "../browser-storage": {
      removePreference: (key) => log.push(["removePreference", key]),
    },
    "../mux-selection": muxSelection,
    "../mux-spec": spec,
    "../notifications": {
      notify: (message, kind = "info") => log.push(["toast", message, kind]),
    },
    "../tool-filters": toolFilters,
    "../tool-list": toolList,
    "../tool-status": toolStatus,
    "../tool-table": toolTable,
    "../ui": ui,
    "../use-tool-table": {
      useToolColumnStyle: (...args) => {
        h.styleArgs = args;
        return { "--tt-min": "900px" };
      },
    },
    "./list/TableCard": { CountTool: "CountTool" },
    "./MuxOptionsDialog": { MuxOptionsDialog: "MuxOptionsDialog" },
    "./MuxStatusDialog": { MuxStatusDialog: "MuxStatusDialog" },
    "./MuxTerminalDialog": { MuxTerminalDialog: "MuxTerminalDialog" },
    "./Pagination": {
      itemRange: (page, limit, total) => `${page}:${limit}:${total}`,
    },
    "./tools/drawer-chunk": { toolDrawerChunk: "toolDrawerChunk" },
    "./tools/ToolCard": { ToolCard: "ToolCard" },
    "./tools/ToolKpis": { ToolKpis: "ToolKpis" },
    "./tools/ToolTable": { ToolTable: "ToolTable" },
  };
  const { MuxPage } = loadSource("components/MuxPage.tsx", {
    modules,
    browser: { document },
    stubs: PRESENTATION_MODULES,
  });
  const props = {
    changed: async () => log.push(["changed"]),
    names: { radarr: "Radarr 4K" },
    installed,
    setup: () => log.push(["setup"]),
    settings: { pageSize, mux: { workDir: "/work" } },
    route: { query: "", fromHistory: false, replace() {} },
  };
  const h = {
    log,
    mux,
    route,
    lazy,
    document,
    props,
    jobs,
    removal: {
      removing: new Set(),
      hidden: new Set(),
      remove: async (id, request) => {
        log.push(["removal", id]);
        await request();
      },
    },
    presets: {
      presets: [{ id: 3, name: "Failed", query: "status=failed" }],
      selectedPreset: undefined,
      applyPreset() {},
      reset() {},
      savePreset() {},
      deletePreset() {},
      dialogs: null,
    },
    render: () => (h.tree = runtime.settle(() => MuxPage(props))),
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
const card = (h) => one(h.tree, "ToolCard");
const table = (h) => one(card(h).props.children, "ToolTable");
const column = (h, key) =>
  table(h).props.columns.find((entry) => entry.key === key);
const rowOf = (h, id) => h.jobs.find((j) => j.id === id);
const cell = (h, key, id) => column(h, key).cell(rowOf(h, id));
const buttons = (tree) =>
  ofType(tree, "RowButton").map((button) => button.props);
const tools = (h) => card(h).props.tools;
// What a CountTool shows, as the real one renders it: its label and its
// count, without the hidden widest number (its accessible name).
function shown(props) {
  const visible = (node) => {
    if (Array.isArray(node)) return node.map(visible).join("");
    if (!node || typeof node !== "object")
      return node == null ? "" : String(node);
    if (classes(node).includes("v2-count-max")) return "";
    return visible(node.props?.children);
  };
  return visible(CountTool(props).props.children).replace(/\s+/g, " ").trim();
}
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

test("the mux page builds its KPI row, setup notice and card from the tool blocks", async () => {
  const h = muxPage({ installed: false });
  // The 1.7.0 page state, presets and the obsolete preference.
  assert.equal(h.pageState.tool, "mux");
  same(plain(h.pageState.options), { resetPageOnSort: false });
  assert.equal(h.presetArgs.service, "tool:mux");
  same(h.log, [["removePreference", "scopearr-mux-filter-collapsed"]]);
  // Header → page: the KPI row, the notice, the card, in this order.
  const header = one(h.tree, "PageHeader");
  assert.equal(header.props.title, "Muxing");
  assert.equal(header.props.metaTitle, "Open items");
  const log = header.props.actions;
  assert.equal(log.type, "button");
  assert.equal(log.props.class, "v2-btn v2-btn--on-band");
  assert.equal(text(log), "Show in log");
  log.props.onClick();
  same(plain(h.log.at(-1)), ["openLog", { source: ["mux"] }]);
  const [page] = byClass(h.tree, "v2-list-page");
  const blocks = [page.props.children].flat().filter(Boolean);
  same(
    blocks.map((block) =>
      block.type === "div" ? block.props.class : block.type,
    ),
    ["ToolKpis", "v2-notice v2-notice--setup", "ToolCard"],
  );
  const notice = blocks[1];
  assert.match(text(notice), /^Install MKVToolNix first/);
  const settings = ofType(notice, "button")[0];
  assert.equal(text(settings), "Open settings");
  assert.equal(settings.props.class, "v2-btn v2-btn--primary");
  settings.props.onClick();
  same(h.log.at(-1), ["setup"]);
  // Before the first answer: KPI values “—” (null), the placeholder empty
  // state of the same height and the busy card.
  const kpis = one(h.tree, "ToolKpis");
  same(plain(kpis.props.kpis.map((kpi) => [kpi.label, kpi.value, kpi.hero])), [
    ["Open", null, true],
    ["Running", null, false],
    ["Failed", null, false],
    ["Successful", null, false],
  ]);
  let empty = one(card(h).props.children, "ListEmpty");
  assert.equal(empty.props.pending, true);
  assert.equal(empty.props.title, "No mux jobs.");
  assert.equal(card(h).props.busy, true);
  // The card: Jobs with the count of the list, the search and presets of
  // 1.7.0, the help, the pager.
  await h.poll();
  const c = card(h).props;
  assert.equal(c.id, "mux");
  assert.equal(c.title, "Jobs");
  assert.equal(c.total, 8);
  assert.equal(c.busy, false);
  assert.equal(c.allLabel, "All jobs");
  same(plain(c.search), {
    label: "Filename",
    placeholder: "Search filename …",
    value: "",
  });
  assert.equal(c.csv, undefined);
  same(plain(c.help.map((section) => section.heading)), ["How muxing works"]);
  assert.equal(c.pager.summary, "1:100:8");
  assert.equal(ofType(c.children, "ListEmpty").length, 0);
  // The KPI row counts the jobs its filters show (effective statuses).
  same(
    plain(one(h.tree, "ToolKpis").props.kpis.map((kpi) => kpi.value)),
    [6, 1, 1, 1],
  );
  // The table: the 1.7.0 columns without the selection, which ToolTable
  // adds; the widths from the labels and the tool's status texts.
  same(
    table(h).props.columns.map((entry) => [entry.key, entry.label]),
    [
      ["buttons", "Info"],
      ["filename", "Filename"],
      ["size", "Size"],
      ["origin", "Source service"],
      ["status", "Status"],
      ["progress", "Progress"],
      ["actions", "Actions"],
    ],
  );
  same(plain(table(h).props.style), { "--tt-min": "900px" });
  same(plain(h.styleArgs.slice(0, 2)), [plain(spec.muxColumns), "mux"]);
  same(plain(h.styleArgs[3]), {
    info: 2,
    actions: 2,
    infoPhone: 1,
    actionsPhone: 1,
  });
  // The Info header is visible and never sorts (release-163, 1.7.0); the
  // sortable columns are the 1.7.0 sort fields.
  assert.equal(column(h, "buttons").sort, undefined);
  assert.equal(column(h, "buttons").info, true);
  same(
    table(h)
      .props.columns.filter((entry) => entry.sort)
      .map((entry) => entry.sort),
    ["filename", "size", "origin", "status", "progress"],
  );
  assert.equal(column(h, "filename").grow, true);
  assert.equal(column(h, "size").numeric, true);
  // Filename and title, the size and the service by its name.
  const name = cell(h, "filename", 1);
  same([name].flat().length ? text(name) : "", "Arrival.mkvArrival");
  assert.equal(cell(h, "size", 3), "3000 B");
  assert.equal(cell(h, "origin", 1), "Radarr 4K");
  // Sorting goes to the route (useToolPageState).
  table(h).props.onSort("size");
  same(h.log.at(-1), ["sort", "size"]);
  // Without filters and jobs: the 1.7.0 empty state; with filters its
  // matching variant.
  h.jobs = [];
  await h.poll();
  empty = one(card(h).props.children, "ListEmpty");
  assert.equal(empty.props.pending, false);
  assert.equal(empty.props.title, "No mux jobs.");
  assert.equal(text(empty), "Mark a file in its details to add a mux job.");
  // With MKVToolNix there is no notice; no 1.7.0 page part is built.
  const installed = muxPage();
  await installed.poll();
  const [list] = byClass(installed.tree, "v2-list-page");
  same(
    [list.props.children]
      .flat()
      .filter(Boolean)
      .map((block) => block.type),
    ["ToolKpis", "ToolCard"],
  );
  const built = allClasses(installed.tree);
  for (const legacy of [
    "filter-panel",
    "results-heading",
    "tool-table",
    "library-section",
    "page-notice",
  ])
    assert.ok(!built.includes(legacy), legacy);
  assert.ok(built.includes("v2-list-page"));
});

// Carry-forward (Task 2 review): a cancelled job with a failed check is a
// warning, so the Open card counts it; the header's “{count} open” counts
// the same, one number on the page.
test("the header counts open jobs as the Open card does", async () => {
  const failed = { ...ok, writable: false };
  const h = muxPage({
    jobs: [
      job(1, "cancelled", "Elf", { check: failed }),
      job(2, "cancelled", "Big"),
      job(3, "draft", "Her", { check: failed }),
      job(4, "succeeded", "Alien", { check: failed }),
      job(5, "running", "Up"),
    ],
  });
  await h.poll();
  const open = one(h.tree, "ToolKpis").props.kpis[0];
  assert.equal(open.key, "open");
  assert.equal(open.value, 3);
  assert.equal(one(h.tree, "PageHeader").props.meta, "3 open");
  assert.equal(toolTable.muxOpenJobs(h.jobs), open.value);
  // Without a check (the bell's status counts), a cancelled job stays
  // closed, as in 1.7.0.
  assert.equal(
    toolTable.muxOpenJobs([{ status: "cancelled" }, { status: "ready" }]),
    1,
  );
});

test("mux KPI cards filter by their statuses", async () => {
  const h = muxPage({ filters: { q: "dune" } });
  await h.poll();
  const kpis = () => one(h.tree, "ToolKpis").props;
  const failed = kpis().kpis.find((kpi) => kpi.label === "Failed");
  same(plain(kpis().statuses), []);
  // A press replaces the status filter with the card's statuses and keeps
  // the search; the page's filter change returns to page 1.
  kpis().choose(failed);
  same(h.log.at(-1), [
    "filters",
    { q: "dune", statuses: ["failed"], targets: [], kinds: [] },
  ]);
  h.render();
  same(plain(kpis().statuses), ["failed"]);
  same(h.log.at(-1), ["page", 1]);
  // A second press clears it.
  kpis().choose(kpis().kpis.find((kpi) => kpi.label === "Failed"));
  same(h.log.filter(([kind]) => kind === "filters").at(-1), [
    "filters",
    { q: "dune", statuses: [], targets: [], kinds: [] },
  ]);
  // Open filters by every open effective status.
  kpis().choose(kpis().kpis[0]);
  same(h.log.filter(([kind]) => kind === "filters").at(-1)[1].statuses, [
    "warning",
    "draft",
    "ready",
    "queued",
    "running",
    "failed",
    "needs_review",
    "needs_attention",
  ]);
});

test("mux rows offer options, terminal, status, start and removal", async () => {
  const h = muxPage();
  await h.poll();
  // Info: Details only on phones, Mux options and Terminal above 739.
  same(
    buttons(cell(h, "buttons", 1)).map((b) => [b.label, b.title, b.only]),
    [
      ["Details for Arrival", "Details", "phone"],
      ["Mux options for Arrival", "Mux options", "desk"],
      ["Terminal for Arrival", "Terminal", "desk"],
    ],
  );
  const [details, options, terminal] = buttons(cell(h, "buttons", 1));
  options.onClick();
  h.render();
  assert.equal(one(h.tree, "MuxOptionsDialog").props.job.id, 1);
  terminal.onClick();
  h.render();
  assert.equal(one(h.tree, "MuxTerminalDialog").props.job.id, 1);
  details.onClick();
  h.render();
  assert.equal(one(h.tree, "MuxStatusDialog").props.job.id, 1);
  assert.equal(one(h.tree, "MuxStatusDialog").props.workDir, true);
  // Status: the tag of the effective status, a button named by the text
  // it shows (ruling I7) that opens the checks.
  const status = one(cell(h, "status", 1), "StatusTag").props;
  same(plain(status.view), {
    tone: "running",
    text: "Running",
    long: "Running",
  });
  assert.equal(status.openLabel, "Status: Running. Show checks");
  assert.equal(
    one(cell(h, "status", 7), "StatusTag").props.openLabel,
    "Status: Attention. Show checks",
  );
  h.render();
  // Progress: the progress cell of the job.
  same(plain(one(cell(h, "progress", 1), "ProgressCell").props), {
    status: "running",
    value: 64,
    label: "Progress",
  });
  // Start (ruling R-F) only for startable jobs; Retry's icon for failed
  // and cancelled ones.
  const start = (id) => buttons(cell(h, "actions", id))[0];
  assert.equal(start(3).label, "Start item Heat");
  assert.equal(start(3).disabled, false);
  assert.equal(start(5).disabled, false);
  assert.equal(start(8).disabled, false);
  for (const id of [1, 2, 4, 6, 7]) assert.equal(start(id).disabled, true, id);
  assert.equal(start(3).only, "desk");
  start(3).onClick();
  await new Promise((resolve) => setTimeout(resolve));
  same(h.log.filter(([kind]) => kind === "api").at(-1), [
    "api",
    "mux/run",
    "POST",
    { ids: [3] },
  ]);
  assert.equal(
    h.log.filter(([kind]) => kind === "confirmAction").length,
    0,
    "one job starts without a question",
  );
  // Without MKVToolNix nothing starts.
  const missing = muxPage({ installed: false });
  await missing.poll();
  assert.equal(buttons(cell(missing, "actions", 3))[0].disabled, true);
});

test("mux row removal keeps its 1.7.0 rules", async () => {
  const h = muxPage({
    jobs: [
      job(1, "running", "Arrival"),
      job(2, "queued", "Dune"),
      job(3, "failed", "Heat", { backupName: "Heat.mkv.scopearr-backup" }),
      job(4, "succeeded", "Alien"),
      job(5, "ready", "Tenet"),
      job(7, "needs_attention", "Up"),
    ],
  });
  await h.poll();
  const removal = (id) => buttons(cell(h, "actions", id))[1];
  const icon = (id) => removal(id).icon.type;
  // Running: Cancel with Square; waiting: Cancel with X.
  assert.equal(removal(1).label, "Cancel mux job: Arrival.mkv");
  assert.equal(removal(1).title, "Cancel mux job: Arrival.mkv");
  assert.equal(removal(1).tone, "danger");
  assert.equal(icon(1), icons.Square);
  assert.equal(removal(2).label, "Cancel mux job: Dune.mkv");
  assert.equal(icon(2), icons.X);
  // A kept backup locks Delete and says why.
  assert.equal(removal(3).label, "Delete mux job: Heat.mkv");
  assert.equal(removal(3).disabled, true);
  assert.equal(
    removal(3).title,
    "Delete or keep the preserved backup in the mux options first",
  );
  assert.equal(removal(4).label, "Remove Alien.mkv from the list");
  assert.equal(removal(5).label, "Delete mux job: Tenet.mkv");
  assert.equal(removal(5).disabled, false);
  assert.equal(icon(5), icons.Trash2);
  // An action needed has no removing action.
  assert.equal(buttons(cell(h, "actions", 7)).length, 1);
  // Cancel asks and cancels; Delete asks and fades the row; Remove of a
  // successful job does not ask.
  removal(1).onClick();
  await new Promise((resolve) => setTimeout(resolve));
  same(h.log.filter(([kind]) => kind === "confirmDeletion").at(-1), [
    "confirmDeletion",
    "Cancel this mux job? The original remains unchanged before replacement.",
  ]);
  same(h.log.filter(([kind]) => kind === "api").at(-1), [
    "api",
    "mux/cancel?id=1",
    "POST",
    null,
  ]);
  removal(5).onClick();
  await new Promise((resolve) => setTimeout(resolve));
  same(h.log.filter(([kind]) => kind === "confirmDeletion").at(-1), [
    "confirmDeletion",
    "Delete this mux job? The media file is not changed.",
  ]);
  same(h.log.filter(([kind]) => kind === "removal").at(-1), ["removal", 5]);
  same(h.log.filter(([kind]) => kind === "api").at(-1), [
    "api",
    "mux/jobs?id=5",
    "DELETE",
    null,
  ]);
  const asked = h.log.filter(([kind]) => kind === "confirmDeletion").length;
  removal(4).onClick();
  await new Promise((resolve) => setTimeout(resolve));
  assert.equal(
    h.log.filter(([kind]) => kind === "confirmDeletion").length,
    asked,
  );
  same(h.log.filter(([kind]) => kind === "api").at(-1), [
    "api",
    "mux/jobs?id=4",
    "DELETE",
    null,
  ]);
  // A row being removed turns its icon and fades (ToolTable removing).
  h.removal.removing = new Set([5]);
  h.render();
  assert.equal(removal(5).icon.props.class, "v2-spin");
  assert.equal(table(h).props.removing.has(5), true);
});

// Ruling I14: polling changes a job's status, and its row buttons stay in
// place: Info always holds its three buttons, Actions always starts with
// Start (locked while the job cannot start) and keeps the removing action
// second, so a missing one (an action needed) moves nothing.
test("mux row buttons keep their places while a job's status changes", async () => {
  const h = muxPage({ jobs: [job(1, "ready", "Arrival")] });
  await h.poll();
  const shape = () => ({
    info: buttons(cell(h, "buttons", 1)).map((b) => [b.label, b.only]),
    actions: [cell(h, "actions", 1)].flat().map((node) => node.props.class),
    first: buttons(cell(h, "actions", 1))[0].label,
  });
  const before = shape();
  same(before.actions, ["v2-table-items"]);
  assert.equal(before.first, "Start item Arrival");
  for (const status of [
    "queued",
    "running",
    "succeeded",
    "failed",
    "cancelled",
    "warning",
    "draft",
    "needs_review",
    "needs_attention",
  ]) {
    h.jobs = [{ ...h.jobs[0], status }];
    await h.poll();
    same(shape(), before, status);
    const actions = buttons(cell(h, "actions", 1));
    assert.equal(actions.length, status === "needs_attention" ? 1 : 2, status);
    assert.equal(
      actions[0].disabled,
      !["failed", "cancelled"].includes(status),
      status,
    );
  }
  // The columns' widths never see the rows: the style is the same.
  same(plain(h.styleArgs[0]), plain(spec.muxColumns));
});

test("mux selection starts only startable jobs and confirms more than one", async () => {
  const h = muxPage({
    rejected: { 5: "The source file changed. Check the job again." },
  });
  await h.poll();
  const selection = () => table(h).props.selection;
  const startSelected = () =>
    ofType(tools(h), "CountTool").find(
      (tool) => tool.props.text === "Start selected",
    ).props;
  // Every row is selectable, named as in 1.7.0.
  assert.equal(selection().allLabel, "Select all");
  assert.equal(selection().rowLabel(rowOf(h, 3)), "Select job 3");
  assert.equal(
    h.jobs.every((j) => selection().selectable(j)),
    true,
  );
  assert.equal(startSelected().disabled, true);
  assert.equal(startSelected().count, 0);
  assert.equal(startSelected().max, 100);
  // Two startable (Heat failed, Tenet ready) and two that cannot start.
  selection().set([1, 3, 5, 6]);
  h.render();
  // In the page's order (running, waiting, then the newest).
  same(plain(selection().selected), [1, 6, 5, 3]);
  assert.equal(startSelected().count, 2);
  assert.equal(startSelected().disabled, false);
  assert.equal(shown(startSelected()), "Start selected 2");
  startSelected().onClick();
  await new Promise((resolve) => setTimeout(resolve));
  same(h.log.filter(([kind]) => kind === "confirmAction").at(-1), [
    "confirmAction",
    "You are about to start 2 jobs.",
    "Start",
  ]);
  same(h.log.filter(([kind]) => kind === "api").at(-1), [
    "api",
    "mux/run",
    "POST",
    { ids: [3, 5] },
  ]);
  // Rejections are warnings; the selection clears.
  same(h.log.filter(([kind]) => kind === "toast").at(-1), [
    "toast",
    "The source file changed. Check the job again.",
    "warning",
  ]);
  h.render();
  same(plain(selection().selected), []);
  // A declined question starts nothing.
  const no = muxPage({ answers: { confirmAction: false } });
  await no.poll();
  table(no).props.selection.set([3, 5]);
  no.render();
  ofType(tools(no), "CountTool")
    .find((tool) => tool.props.text === "Start selected")
    .props.onClick();
  await new Promise((resolve) => setTimeout(resolve));
  assert.equal(no.log.filter(([kind]) => kind === "api").length, 0);
  // A filter change clears the selection; a reload trims it to the page.
  selection().set([3, 5]);
  h.render();
  h.route.filters = { ...h.route.filters, q: "e" };
  h.render();
  same(plain(selection().selected), []);
  selection().set([3, 5]);
  h.render();
  h.jobs = h.jobs.filter((j) => j.id !== 5);
  await h.poll();
  same(plain(selection().selected), [3]);
  // Locked while an action runs.
  h.selectionArgs.busyChanged(true);
  h.render();
  assert.equal(selection().disabled, true);
});

test("remove mux marking uses the shared mux selection", async () => {
  const h = muxPage({ marking: { marked: 2, removable: 2 } });
  await h.poll();
  table(h).props.selection.set([4, 5, 6]);
  h.render();
  // The selected jobs' files (in the page's order), the jobs and
  // MKVToolNix go to the hook.
  same(plain(h.selectionArgs.files), [
    { service: "radarr", id: 906 },
    { service: "radarr", id: 905 },
    { service: "radarr", id: 904 },
  ]);
  assert.equal(h.selectionArgs.jobs, h.jobs);
  assert.equal(h.selectionArgs.installed, true);
  const remove = () =>
    ofType(tools(h), "CountTool").find(
      (tool) => tool.props.text === "Remove mux marking ({count})",
    ).props;
  // A count tool named by what it shows (ruling I5).
  assert.equal(remove().count, 2);
  assert.equal(remove().max, 100);
  assert.equal(remove().disabled, false);
  assert.equal(shown(remove()), "Remove mux marking 2");
  assert.equal(remove().title, "Remove mux marking (2) · Remove mux marking");
  remove().onClick();
  same(h.log.at(-1), ["run", true]);
  // Its result reloads the jobs and clears the selection.
  await h.selectionArgs.changed();
  h.render();
  same(plain(table(h).props.selection.selected), []);
  same(h.log.at(-1), ["changed"]);
  // The 1.7.0 locks and reasons.
  Object.assign(h.mux, { marked: 0, removable: 0 });
  h.render();
  assert.equal(remove().disabled, true);
  assert.equal(
    remove().title,
    "Remove mux marking (0) · Select entries first.",
  );
  table(h).props.selection.set([4]);
  h.render();
  assert.equal(
    remove().title,
    "Remove mux marking (0) · None of the selected files is marked.",
  );
  Object.assign(h.mux, { marked: 1, removable: 0 });
  h.render();
  assert.equal(
    remove().title,
    "Remove mux marking (1) · None of the selected jobs can be removed.",
  );
  assert.equal(remove().disabled, true);
  // Ruling I6: while it runs, the slot counts the files handled (on), the
  // icon turns, the title counts them, and a polite live region announces
  // the run at each quarter.
  Object.assign(h.mux, { working: "remove", done: 3, total: 12, removable: 1 });
  h.render();
  same([remove().count, remove().on], [3, true]);
  assert.equal(remove().icon.props.class, "v2-spin");
  assert.match(remove().title, /^Removing … 3\/12 · /);
  assert.equal(remove().disabled, true);
  assert.equal(shown(remove()), "Remove mux marking 3");
  const announced = (done) => {
    Object.assign(h.mux, { done });
    h.render();
    const regions = byClass(tools(h), "v2-sr-only");
    assert.equal(regions.length, 1);
    assert.equal(regions[0].props["aria-live"], "polite");
    return text(regions[0]);
  };
  assert.equal(announced(0), "");
  assert.equal(announced(2), "");
  assert.equal(announced(3), "Removing … 3/12");
  assert.equal(announced(5), "Removing … 3/12");
  assert.equal(announced(6), "Removing … 6/12");
  assert.equal(announced(12), "Removing … 12/12");
  Object.assign(h.mux, { working: null });
  h.render();
  same(byClass(tools(h), "v2-sr-only"), []);
});

test("start all and remove completed keep their 1.7.0 rules", async () => {
  const h = muxPage({
    jobs: [
      ...JOBS(),
      job(9, "succeeded", "Kept", { backupName: "Kept.scopearr-backup" }),
    ],
    filters: { statuses: ["running"] },
  });
  await h.poll();
  const [startAll, removeCompleted] = ofType(tools(h), "button");
  assert.equal(text(startAll), "Start all");
  assert.equal(startAll.props.class, "v2-btn v2-btn--sm");
  assert.equal(
    startAll.props.title,
    "Starts all ready jobs, including filtered ones",
  );
  assert.equal(byClass(startAll, "v2-tc-label").length, 1);
  assert.equal(startAll.props.disabled, false);
  // All startable jobs, the filtered ones included; more than one asks.
  startAll.props.onClick();
  await new Promise((resolve) => setTimeout(resolve));
  same(h.log.filter(([kind]) => kind === "confirmAction").at(-1), [
    "confirmAction",
    "You are about to start 3 jobs.",
    "Start",
  ]);
  same(h.log.filter(([kind]) => kind === "api").at(-1), [
    "api",
    "mux/run",
    "POST",
    { ids: [3, 5, 8] },
  ]);
  // Remove completed: successful jobs without a kept backup, no question.
  assert.equal(text(removeCompleted), "Remove completed");
  assert.equal(removeCompleted.props.disabled, false);
  const asked = h.log.filter(([kind]) => kind.startsWith("confirm")).length;
  removeCompleted.props.onClick();
  await new Promise((resolve) => setTimeout(resolve));
  assert.equal(
    h.log.filter(([kind]) => kind.startsWith("confirm")).length,
    asked,
  );
  same(
    h.log.filter(([kind, path]) => kind === "api" && path !== "mux/run"),
    [["api", "mux/jobs?id=4", "DELETE", null]],
  );
  // Locked without such jobs, and without MKVToolNix for Start all.
  const none = muxPage({
    installed: false,
    jobs: [job(9, "succeeded", "Kept", { backupName: "x" })],
  });
  await none.poll();
  const [all, completed] = ofType(tools(none), "button");
  assert.equal(all.props.disabled, true);
  assert.equal(completed.props.disabled, true);
});

test("the mux drawer counts its draft locally and applies once", async () => {
  const h = muxPage({ filters: { q: "a" } });
  await h.poll();
  // The drawer chunk preloads at idle and opens through useLazyChunk.
  assert.equal(h.lazy.at(-1).chunk, "toolDrawerChunk");
  assert.equal(h.lazy.at(-1).open, false);
  assert.equal(ofType(h.tree, "Drawer").length, 0);
  const filters = () => card(h).props.filters;
  same(plain(filters()), { count: 0, expanded: false });
  const trigger = { isConnected: true, focus: (o) => h.log.push(["focus", o]) };
  filters().open(trigger);
  h.render();
  assert.equal(h.lazy.at(-1).open, true);
  assert.equal(filters().expanded, true);
  const drawer = () => one(h.tree, "Drawer").props;
  assert.equal(drawer().subtitle, "Jobs");
  // The Status values in the 1.7.0 order with their counts.
  assert.equal(drawer().groups.length, 1);
  assert.equal(drawer().groups[0].key, "statuses");
  assert.equal(drawer().groups[0].label, "Status");
  same(
    plain(drawer().groups[0].options.map((o) => [o.value, o.label, o.count])),
    [
      ["ready", "Ready", 1],
      ["queued", "Waiting", 1],
      ["running", "Running", 1],
      ["succeeded", "Completed", 1],
      ["failed", "Failed", 1],
      ["cancelled", "Cancelled", 1],
      ["warning", "Warning", 0],
      ["draft", "Not configured", 1],
      ["needs_review", "Review needed", 0],
      ["needs_attention", "Action needed", 1],
    ],
  );
  same(plain(drawer().initial), {
    statuses: [],
    kinds: [],
    targets: [],
    shares: [],
  });
  assert.equal(drawer().countPath, undefined);
  // Counted locally, by the list's own filter with the search: of the
  // failed and ready jobs only Heat.mkv holds an "a".
  const draft = {
    statuses: ["failed", "ready"],
    kinds: [],
    targets: [],
    shares: [],
  };
  assert.equal(
    drawer().localCount(draft),
    toolList.muxDraftCount(h.jobs, "a", draft),
  );
  assert.equal(drawer().localCount(draft), 1);
  const before = h.log.filter(([kind]) => kind === "filters").length;
  drawer().apply(draft);
  const applied = h.log.filter(([kind]) => kind === "filters");
  assert.equal(applied.length, before + 1, "one route change");
  same(applied.at(-1), [
    "filters",
    { q: "a", statuses: ["failed", "ready"], targets: [], kinds: [] },
  ]);
  // A history step brings other filters: the draft starts from them (M16).
  h.route.filters = { ...h.route.filters, statuses: ["queued"] };
  h.render();
  same(plain(drawer().initial.statuses), ["queued"]);
  assert.equal(filters().count, 1);
  // Closing hands focus back to the Filters button.
  h.document.activeElement = h.document.body;
  drawer().close();
  h.render();
  assert.equal(ofType(h.tree, "Drawer").length, 0);
  same(plain(h.log.at(-1)), ["focus", { preventScroll: true }]);
});

test("mux presets show Custom selection for unknown filters", async () => {
  const h = muxPage({ filters: { statuses: ["draft"] } });
  await h.poll();
  const c = card(h).props;
  assert.equal(c.presets, h.presets);
  assert.equal(c.active, true);
  // No preset holds this filter: the select shows Custom selection.
  const choice = toolList.toolPresetChoice(
    c.allLabel,
    c.presets.presets,
    c.presets.selectedPreset,
    c.active,
  );
  assert.equal(choice.custom, true);
  assert.equal(choice.value, "all");
  same(plain(choice.options.map((o) => o.label)), ["All jobs", "Failed"]);
  // The preset query is the 1.7.0 one; applying sets the filters.
  assert.equal(h.presetArgs.query, "q=&status=draft");
  h.presetArgs.apply(new URLSearchParams("q=x&status=failed"));
  same(h.log.at(-1), [
    "filters",
    { q: "x", statuses: ["failed"], targets: [], kinds: [] },
  ]);
  // The chips: Status, then Search, as in 1.7.0; Reset clears them.
  h.route.filters = { q: "x", statuses: ["failed"], targets: [], kinds: [] };
  h.render();
  same(
    card(h).props.chips.map((chip) => chip.label),
    ["Status: Failed", "Search: x"],
  );
  card(h).props.chips[0].remove();
  same(h.log.at(-1), [
    "filters",
    { q: "x", statuses: [], targets: [], kinds: [] },
  ]);
  card(h).props.reset();
  same(h.log.at(-1), [
    "filters",
    { statuses: [], targets: [], kinds: [], q: "" },
  ]);
  // Without filters nothing is active.
  const none = muxPage();
  await none.poll();
  assert.equal(card(none).props.active, false);
});

test("muxing drops the transition sheet", () => {
  const { sheetPage } = loadSource("nav-model.ts", {
    modules: {
      "./frame-status": {},
      "./instances": instances,
      "./router": { SETTINGS_SECTIONS: [] },
      "./tool-route": { TOOLS: {} },
    },
  });
  assert.equal(sheetPage({ view: "mux", query: "" }), false);
  assert.equal(sheetPage({ view: "mux", query: "status=failed" }), false);
  // Disk placement left it too (Task 7); Files & permissions keeps it.
  assert.equal(sheetPage({ view: "disks", query: "" }), false, "disks");
  assert.equal(sheetPage({ view: "files", query: "" }), true, "files");
  // The 1.7.0 mux parts are gone with it.
  for (const gone of ["MuxTable", "MuxSelectionActions"])
    assert.throws(() => src("components/" + gone + ".tsx"), /ENOENT/, gone);
});
