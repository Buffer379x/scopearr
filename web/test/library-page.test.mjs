import test from "node:test";
import assert from "node:assert/strict";
import * as preact from "preact";
import { loadSource, nodes, text } from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";
import { src, squash } from "./helpers/sources.mjs";
import * as color from "../src/color.ts";
import * as filters from "../src/library-filters.ts";
import * as languages from "../src/languages.ts";
import * as resolution from "../src/resolution-groups.ts";
import * as tagDisplay from "../src/tag-display.ts";
import * as tagLabels from "../src/tag-labels.ts";
import * as units from "../src/units.ts";

// The libraries on the list blocks (Phase 5a, task 8; docs/STYLEGUIDE.md,
// Part 1, 10.5, 10.10 and 11.1): LibraryPage with its setup notice,
// instance segment, filter bar, chips row and page tools, table, pager and
// lazy drawer; useLibraryState's drawer, filters and facets; the shared
// mux selection logic (useMuxSelection) and SelectionTools; sheetPage. Each
// runs as real code with the hook runtime; the blocks of earlier tasks are
// named stubs, so a tree shows what they receive.

const t = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "{" + name + "}");
let locale = "en";
const i18n = {
  t,
  getLocale: () => locale,
  useI18n: () => ({ locale }),
};
const plain = (value) => JSON.parse(JSON.stringify(value ?? null));
const classes = (node) => (node?.props?.class ?? "").split(" ");
const byClass = (tree, name) =>
  nodes(tree).filter((n) => classes(n).includes(name));
const ofType = (tree, type) => nodes(tree).filter((n) => n.type === type);
const kids = (node) =>
  [node?.props?.children]
    .flat(Infinity)
    .filter((child) => child !== null && child !== false && child !== "");

// Every module shares one hooks object; it calls the runtime that renders.
let current = createHookRuntime();
const hooks = new Proxy({}, { get: (_, name) => current.hooks[name] });
const ui = loadSource("ui.tsx", {
  modules: {
    "./units": units,
    "./i18n": i18n,
    "./resolution-groups": resolution,
    "./tag-labels": tagLabels,
    "./color": color,
    "./tag-display": tagDisplay,
    preact,
    "preact/compat": { createPortal: (vnode) => vnode },
    "preact/hooks": hooks,
  },
});
const instances = loadSource("instances.ts");
const fileSelection = loadSource("file-selection.ts");

// --- the transition sheet ---------------------------------------------------

test("no page uses the transition sheet", () => {
  // The function, the attribute and the shell rules left with the last
  // 1.7.0 settings page (Phase 5c, task 10; stylesheet-guards.test.mjs
  // covers the shell rules).
  assert.doesNotMatch(src("nav-model.ts"), /sheetPage|REBUILT_SETTINGS/);
  const shell = squash(src("components/AppShell.tsx"));
  assert.doesNotMatch(shell, /sheetPage|data-sheet/);
  assert.match(shell, /<main id="main" class="v2-main" tabIndex=\{-1\}/);
});

// --- useMuxSelection ---------------------------------------------------------

function muxSelection({ files, jobs = [], installed = true, answer = true }) {
  const runtime = createHookRuntime();
  const log = [];
  const { useMuxSelection } = loadSource("hooks/useMuxSelection.ts", {
    modules: {
      "preact/hooks": runtime.hooks,
      "../api": {
        async api(path, method, body) {
          log.push(["api", path, method, plain(body)]);
          if (body?.fileId === 13) throw new Error("locked");
          return {};
        },
      },
      "../confirmation": {
        async confirmAction(message, label) {
          log.push(["confirm", message, label]);
          return answer;
        },
        async confirmDeletion(message, danger, label) {
          log.push(["confirm delete", message, label]);
          return answer;
        },
      },
      "../file-selection": fileSelection,
      "../i18n": i18n,
      "../mux-selection": loadSource("mux-selection.ts", {
        modules: { "./file-selection.ts": fileSelection },
      }),
      "../notifications": {
        notify: (message, tone = "info") => log.push(["toast", message, tone]),
      },
    },
  });
  const props = {
    files,
    jobs,
    installed,
    changed: async () => log.push(["changed"]),
    busyChanged: (busy) => log.push(["busy", busy]),
  };
  const h = {
    log,
    render: () => (h.current = runtime.settle(() => useMuxSelection(props))),
  };
  h.render();
  return h;
}
const key = (id) => ({ service: "radarr", id });

test("mux selection keeps its rules", async () => {
  // One file: no question, one toast.
  let h = muxSelection({ files: [key(1)] });
  await h.current.run(false);
  assert.deepEqual(plain(h.log), [
    ["busy", true],
    ["api", "mux/jobs", "POST", { service: "radarr", fileId: 1 }],
    ["toast", "Marked for muxing.", "success"],
    ["changed"],
    ["busy", false],
  ]);
  // More than one asks first; a decline marks nothing.
  h = muxSelection({ files: [key(1), key(2)], answer: false });
  await h.current.run(false);
  assert.deepEqual(plain(h.log), [
    ["busy", true],
    ["confirm", "You are about to mark 2 items for muxing.", "Mark"],
    ["busy", false],
  ]);
  // Marking skips a file with a job; counts and done follow the files.
  h = muxSelection({
    files: [key(1), key(2), key(3)],
    jobs: [{ service: "radarr", fileId: 2, id: 9, status: "draft" }],
  });
  assert.equal(h.current.marked, 1);
  assert.equal(h.current.removable, 1);
  await h.current.run(false);
  h.render();
  assert.deepEqual(
    plain(h.log.filter(([kind]) => kind === "api").map(([, , , b]) => b)),
    [
      { service: "radarr", fileId: 1 },
      { service: "radarr", fileId: 3 },
    ],
  );
  assert.deepEqual(plain(h.log.filter(([kind]) => kind === "toast")), [
    ["toast", "2 items marked for muxing.", "success"],
  ]);
  assert.equal(h.current.done, 3);
  assert.equal(h.current.total, 3);
  assert.equal(h.current.working, null);
  // Running, queued and backed-up jobs are locked: they are marked, but
  // none can be removed.
  const locked = [
    { service: "radarr", fileId: 1, id: 1, status: "running" },
    { service: "radarr", fileId: 2, id: 2, status: "queued" },
    { service: "radarr", fileId: 3, id: 3, status: "done", backupName: "b" },
  ];
  h = muxSelection({ files: [key(1), key(2), key(3)], jobs: locked });
  assert.equal(h.current.marked, 3);
  assert.equal(h.current.removable, 0);
  // Removing asks with its own words and toasts the skipped jobs once.
  h = muxSelection({
    files: [key(1), key(4), key(5)],
    jobs: [
      locked[0],
      { service: "radarr", fileId: 4, id: 4, status: "draft" },
      { service: "radarr", fileId: 5, id: 5, status: "failed" },
    ],
  });
  await h.current.run(true);
  assert.deepEqual(plain(h.log.filter(([kind]) => kind !== "api")), [
    ["busy", true],
    [
      "confirm delete",
      "You are about to remove mux marking for 3 items.",
      "Remove",
    ],
    [
      "toast",
      "2 mux markings removed. 1 running, queued or backed-up jobs skipped.",
      "info",
    ],
    ["changed"],
    ["busy", false],
  ]);
  // A failure is one warning with the first reason.
  h = muxSelection({ files: [key(12), key(13)] });
  await h.current.run(false);
  assert.deepEqual(plain(h.log.filter(([kind]) => kind === "toast")), [
    ["toast", "1 marked, 1 not possible: locked", "warning"],
  ]);
  // Without MKVToolNix nothing is marked; one run at a time.
  h = muxSelection({ files: [key(1)], installed: false });
  await h.current.run(false);
  assert.deepEqual(plain(h.log), []);
  h = muxSelection({ files: [key(1)] });
  const first = h.current.run(false);
  await h.current.run(false);
  await first;
  assert.equal(h.log.filter(([kind]) => kind === "api").length, 1);
  // Both views use it: the mux page's Remove mux marking (Phase 5b) and
  // the library's selection tools. The mux page asks confirmAction for
  // its own Start selected, never for marking.
  for (const [path, unwanted] of [
    [
      "components/MuxPage.tsx",
      /processMuxSelection|mark \{count\} items|remove mux marking for/,
    ],
    [
      "components/library/SelectionTools.tsx",
      /processMuxSelection|confirmAction/,
    ],
  ]) {
    const code = src(path);
    assert.match(code, /useMuxSelection\(\{/, path);
    assert.doesNotMatch(code, unwanted, path);
  }
});

// --- SelectionTools and the count tools --------------------------------------

const list = (path, modules = {}) =>
  loadSource(path, {
    modules: {
      preact,
      "preact/hooks": hooks,
      "../../i18n": i18n,
      "../../ui": ui,
      ...modules,
    },
  });
function mount(component, props, contexts = new Map()) {
  const runtime = createHookRuntime({ contexts });
  const view = {
    runtime,
    props,
    render() {
      current = runtime;
      return runtime.render(() => component(view.props));
    },
    flush() {
      current = runtime;
      runtime.flush();
    },
  };
  return view;
}

test("count tools split their catalog text around a fixed count slot", () => {
  const card = list("components/list/TableCard.tsx", {
    "../../hooks/useTableOverflow": { useTableOverflow: () => false },
  });
  // The four catalogs put the count last in brackets; the slot frames it.
  assert.deepEqual(plain(card.countParts("Set tag ({count})")), [
    "Set tag",
    "",
  ]);
  assert.deepEqual(plain(card.countParts("Tag setzen ({count})")), [
    "Tag setzen",
    "",
  ]);
  assert.deepEqual(plain(card.countParts("{count} files to mark")), [
    "",
    " files to mark",
  ]);
  assert.deepEqual(plain(card.countParts("No count")), ["No count", ""]);
  const tree = mount(card.CountTool, {
    icon: "icon",
    text: "Set tag ({count})",
    count: 12,
    max: 100,
    title: "Set tag (12) · Set tags for selected files",
    disabled: false,
    onClick() {},
  }).render();
  assert.equal(tree.type, "button");
  assert.equal(tree.props.class, "v2-btn v2-btn--sm");
  // Named by what it shows (the test "a count tool is named by what it
  // shows"), titled with the catalog text.
  assert.equal(tree.props["aria-label"], undefined);
  assert.equal(tree.props.title, "Set tag (12) · Set tags for selected files");
  const [icon, label, space, slot] = kids(tree);
  assert.equal(space, " ");
  assert.equal(icon, "icon");
  assert.deepEqual(
    [label.props.class, text(label)],
    ["v2-tc-label", "Set tag"],
  );
  // The number never sits in the label: it is the count slot's, part of
  // the name. The slot also holds, hidden, the largest number the tool can
  // show, so it is as wide as that from 0 to the page size.
  assert.equal(slot.props.class, "v2-count v2-count--on");
  assert.equal(slot.props["aria-hidden"], undefined);
  const [number, widest] = kids(slot);
  assert.deepEqual(
    [number.props.class, text(number), widest.props.class, text(widest)],
    ["v2-count-num", "12", "v2-count-max", "100"],
  );
  assert.equal(kids(tree).length, 4);
  // A zero is muted, in the same slot.
  const zero = mount(card.CountTool, {
    icon: "icon",
    text: "Set tag ({count})",
    count: 0,
    max: 50,
    title: "Set tag (0) · Select entries first.",
    disabled: true,
    onClick() {},
  }).render();
  assert.equal(byClass(zero, "v2-count")[0].props.class, "v2-count");
  assert.equal(text(byClass(zero, "v2-count-max")[0]), "50");
  // A run's count is on, also at 0.
  const running = mount(card.CountTool, {
    icon: "icon",
    text: "Mark for muxing ({count})",
    count: 0,
    max: 50,
    on: true,
    title: "Marking … 0/12",
    disabled: true,
    onClick() {},
  }).render();
  assert.equal(
    byClass(running, "v2-count")[0].props.class,
    "v2-count v2-count--on",
  );
  assert.equal(zero.props.disabled, true);
  // A count above it (never from a page's selection) widens the slot.
  const above = mount(card.CountTool, {
    icon: "icon",
    text: "Set tag ({count})",
    count: 120,
    max: 100,
    title: "Set tag (120)",
    disabled: false,
    onClick() {},
  }).render();
  assert.equal(text(byClass(above, "v2-count-max")[0]), "120");
});

// Task 9 ruling D (WCAG 2.5.3): a count tool is named by what it shows,
// its label and its number ("Set tag 12"), not by an aria-label: a space
// text node parts them in its name (not rendered between flex items), the
// slot is in the name, and the hidden widest number is not (visibility).
test("a count tool is named by what it shows", () => {
  const card = list("components/list/TableCard.tsx", {
    "../../hooks/useTableOverflow": { useTableOverflow: () => false },
  });
  const tree = mount(card.CountTool, {
    icon: "icon",
    text: "Set tag ({count})",
    count: 12,
    max: 100,
    title: "Set tag (12) · Set tags for selected files",
    disabled: false,
    onClick() {},
  }).render();
  assert.equal(tree.props["aria-label"], undefined);
  assert.equal(tree.props.title, "Set tag (12) · Set tags for selected files");
  const [, label, space, slot] = kids(tree);
  assert.equal(text(label), "Set tag");
  assert.equal(space, " ");
  assert.equal(slot.props.class, "v2-count v2-count--on");
  assert.equal(slot.props["aria-hidden"], undefined);
});

function selectionTools(props = {}) {
  const calls = [];
  const mux = {
    working: null,
    done: 0,
    total: 0,
    marked: 1,
    removable: 1,
    run: async (remove) => calls.push(["run", remove]),
  };
  const tools = list("components/library/SelectionTools.tsx", {
    "../../hooks/useMuxSelection": {
      useMuxSelection(args) {
        calls.push(["hook", plain(args)]);
        return mux;
      },
    },
    "../list/TableCard": { CountTool: "CountTool" },
  });
  const view = mount(tools.SelectionTools, {
    selection: { keys: [key(1), key(2)] },
    muxJobs: [],
    installed: true,
    changed: async () => {},
    busyChanged() {},
    editTags: () => calls.push(["tags"]),
    working: false,
    capacity: 100,
    ...props,
  });
  return { calls, mux, view };
}

test("selection tools name their counts and keep the 1.7.0 locks", () => {
  const { calls, mux, view } = selectionTools();
  let tools = ofType(view.render(), "CountTool");
  assert.deepEqual(
    tools.map((tool) => tool.props.max),
    [100, 100, 100],
  );
  assert.deepEqual(
    tools.map((tool) => [
      tool.props.text,
      tool.props.count,
      tool.props.name,
      tool.props.title,
      tool.props.disabled,
    ]),
    // Named by what they show (CountTool: label and count), titled with
    // the catalog text, its count and the reason.
    [
      [
        "Mark for muxing ({count})",
        2,
        undefined,
        "Mark for muxing (2) · Mark selected files for muxing",
        false,
      ],
      [
        "Remove mux marking ({count})",
        1,
        undefined,
        "Remove mux marking (1) · Remove mux marking",
        false,
      ],
      [
        "Set tag ({count})",
        2,
        undefined,
        "Set tag (2) · Set tags for selected files",
        false,
      ],
    ],
  );
  assert.deepEqual(calls[0], [
    "hook",
    {
      files: [key(1), key(2)],
      jobs: [],
      installed: true,
    },
  ]);
  tools[0].props.onClick();
  tools[1].props.onClick();
  tools[2].props.onClick();
  assert.deepEqual(calls.slice(-3), [["run", false], ["run", true], ["tags"]]);
  // Idle: no live region, every slot off unless it counts.
  const live = (tree) => byClass(tree, "v2-sr-only");
  assert.deepEqual(live(view.render()), []);
  assert.deepEqual(
    tools.map((tool) => tool.props.on),
    [false, false, undefined],
  );
  // While marking (L21): its slot shows the files handled (on), as 1.7.0
  // showed "Marking … 3/12"; its icon turns, its title counts them (its
  // name is its label and slot), and every tool is locked. The other slots keep their counts.
  Object.assign(mux, { working: "mark", done: 3, total: 12 });
  let tree = view.render();
  tools = ofType(tree, "CountTool");
  assert.equal(
    tools[0].props.title,
    "Marking … 3/12 · Mark selected files for muxing",
  );
  assert.deepEqual([tools[0].props.count, tools[0].props.on], [3, true]);
  assert.deepEqual([tools[1].props.count, tools[1].props.on], [1, false]);
  assert.equal(tools[2].props.count, 2);
  assert.equal(tools[0].props.max, 100);
  assert.equal(tools[0].props.icon.props.class, "v2-spin");
  assert.deepEqual(
    tools.map((tool) => tool.props.disabled),
    [true, true, true],
  );
  // A polite live region, there only during the run, announces the count
  // at each quarter of the run, not at every file.
  const announced = (state) => {
    Object.assign(mux, state);
    const regions = live(view.render());
    assert.equal(regions.length, 1);
    assert.equal(regions[0].type, "span");
    assert.equal(regions[0].props["aria-live"], "polite");
    return text(regions[0]);
  };
  assert.equal(announced({ done: 0 }), "");
  assert.equal(announced({ done: 2 }), "");
  assert.equal(announced({ done: 3 }), "Marking … 3/12");
  assert.equal(announced({ done: 5 }), "Marking … 3/12");
  assert.equal(announced({ done: 6 }), "Marking … 6/12");
  assert.equal(announced({ done: 11 }), "Marking … 9/12");
  assert.equal(announced({ done: 12 }), "Marking … 12/12");
  assert.equal(announced({ done: 1, total: 3 }), "Marking … 1/3");
  assert.equal(announced({ done: 2, total: 3 }), "Marking … 2/3");
  // Removing counts in the remove tool's slot (here 2 of 3, while one
  // selected file is marked).
  Object.assign(mux, { working: "remove", done: 2, total: 3 });
  tools = ofType(view.render(), "CountTool");
  assert.deepEqual(
    tools.map((tool) => [tool.props.count, tool.props.on]),
    [
      [2, false],
      [2, true],
      [2, undefined],
    ],
  );
  assert.equal(mux.marked, 1);
  assert.equal(tools[1].props.title, "Removing … 2/3 · Remove mux marking");
  assert.equal(announced({}), "Removing … 2/3");
  Object.assign(mux, { working: null, done: 0, total: 0 });
  assert.deepEqual(live(view.render()), []);
  // Another selection action locks them too; nothing selected, nothing
  // marked or not installed lock their tools with their reason.
  Object.assign(mux, { working: null, marked: 0, removable: 0 });
  view.props = { ...view.props, working: true };
  assert.deepEqual(
    ofType(view.render(), "CountTool").map((tool) => tool.props.disabled),
    [true, true, true],
  );
  view.props = {
    ...view.props,
    working: false,
    installed: false,
    selection: { keys: [] },
  };
  tools = ofType(view.render(), "CountTool");
  assert.deepEqual(
    tools.map((tool) => [tool.props.disabled, tool.props.title]),
    [
      [true, "Mark for muxing (0) · Select entries first."],
      [true, "Remove mux marking (0) · Select entries first."],
      [true, "Set tag (0) · Select entries first."],
    ],
  );
  view.props = { ...view.props, selection: { keys: [key(1)] } };
  tools = ofType(view.render(), "CountTool");
  assert.deepEqual(
    tools.map((tool) => [tool.props.disabled, tool.props.title]),
    [
      [true, "Mark for muxing (1) · Install MKVToolNix first."],
      [true, "Remove mux marking (0) · None of the selected files is marked."],
      [false, "Set tag (1) · Set tags for selected files"],
    ],
  );
  Object.assign(mux, { marked: 1 });
  assert.equal(
    ofType(view.render(), "CountTool")[1].props.title,
    "Remove mux marking (1) · None of the selected jobs can be removed.",
  );
});

// --- InstanceSegment ----------------------------------------------------------

test("the library header carries the instance segment", () => {
  const segment = list("components/library/InstanceSegment.tsx", {
    "../list/Segmented": { Segmented: "Segmented" },
  });
  const opened = [];
  const view = mount(segment.InstanceSegment, {
    service: "radarr",
    instances: [
      { id: "radarr", name: "Radarr" },
      { id: "radarr-4k", name: "Radarr 4K" },
    ],
    current: "radarr-4k",
    hrefOf: (target) =>
      "#/movies" + (target.instance ? "?instance=" + target.instance : ""),
    open: (target) => opened.push(plain(target)),
  });
  let tree = view.render();
  assert.equal(tree.type, "Segmented");
  assert.equal(tree.props.label, "Instances");
  assert.equal(tree.props.kind, "links");
  assert.equal(tree.props.onBand, true);
  assert.equal(tree.props.value, "radarr-4k");
  assert.deepEqual(plain(tree.props.items), [
    { value: "", label: "All", href: "#/movies" },
    { value: "radarr", label: "Radarr", href: "#/movies?instance=radarr" },
    {
      value: "radarr-4k",
      label: "Radarr 4K",
      href: "#/movies?instance=radarr-4k",
    },
  ]);
  tree.props.select("radarr");
  tree.props.select("");
  assert.deepEqual(opened, [
    { view: "library", service: "radarr", instance: "radarr" },
    { view: "library", service: "radarr", instance: "" },
  ]);
  // An instance filter the settings do not know leaves All current.
  view.props = { ...view.props, current: "gone" };
  tree = view.render();
  assert.equal(tree.props.value, "");
});

// --- LibraryPage ---------------------------------------------------------------

const settingsWith = (list) => ({
  instances: list,
  visibleColumns: { radarr: ["title"], sonarr: ["title"] },
  columnOrder: { radarr: ["title", "year"], sonarr: ["title", "year"] },
  pageSize: 50,
  seasonMode: "season",
  mediaInfo: { enabled: true },
  listInfoVisible: [],
});
const radarr = (id, name, enabled = true) => ({
  id,
  type: "radarr",
  name,
  enabled,
});
const movie = {
  service: "radarr",
  id: 1,
  mediaId: 1,
  filename: "Arrival.mkv",
  title: "Arrival",
};
function libraryState(overrides = {}) {
  const calls = [];
  const state = {
    setCustomOpen: (open) => calls.push(["custom", open]),
    setSingleCustom() {},
    results: {
      files: [movie],
      total: 1,
      displayTotal: 1,
      page: 1,
      pageSize: 50,
    },
    loaded: true,
    facets: null,
    drawer: null,
    openDrawer: (anchor) => calls.push(["open", anchor]),
    closeDrawer: () => calls.push(["close"]),
    setFilename() {},
    busy: false,
    setSavePreset: (value) => calls.push(["save", value]),
    setPresetError: (value) => calls.push(["error", value]),
    query: "",
    q: new URLSearchParams(""),
    libraryInstances: [radarr("radarr", "")],
    syncCount: 120,
    setRenameRevision() {},
    configured: true,
    visibleColumns: ["title"],
    columnOrder: ["title", "year"],
    displayColumns: ["title"],
    change: (key, values) => calls.push(["change", key, plain(values)]),
    replaceFilters: (query) => calls.push(["replace", query]),
    applyFilters: (query) => calls.push(["apply", query]),
    applyPreset: (preset) => calls.push(["preset", preset.id]),
    reset: () => calls.push(["reset"]),
    muxJobs: [],
    loadMuxJobs: async () => {},
    exportQuery: new URLSearchParams(
      "service=radarr&lang=en&sort=title&dir=asc",
    ),
    selectionWorking: false,
    setSelectionWorking() {},
    selection: { keys: [], selected: {} },
    active: [],
    selectedPreset: undefined,
    deletePreset: async () => calls.push(["delete"]),
    pages: 1,
    ...overrides,
  };
  if (overrides.query !== undefined && !overrides.q)
    state.q = new URLSearchParams(overrides.query);
  return { state, calls };
}
const setSettingsStub = () => {};
function libraryPage({
  library = libraryState(),
  settings = settingsWith([radarr("radarr", "")]),
  status = { demo: false, mux: { installed: true } },
  navigation = {},
  presets = [],
  drawer = null,
  browser = {},
} = {}) {
  const lazy = [];
  const nav = {
    service: "radarr",
    page: 1,
    setPage() {},
    movieSort: { field: "title", direction: "asc" },
    sortLibrary() {},
    openMuxFile() {},
    openSettings: () => library.calls.push(["settings"]),
    canLeaveRules: async () => {
      library.calls.push(["ask"]);
      return true;
    },
    linkHref: (target) => "#href:" + JSON.stringify(target),
    openLink: async (target) => library.calls.push(["link", plain(target)]),
    ...navigation,
  };
  const page = loadSource("components/LibraryPage.tsx", {
    browser,
    modules: {
      preact,
      "preact/hooks": hooks,
      "../i18n": i18n,
      "../instances": instances,
      "../languages": languages,
      "../library-filters": filters,
      "../tag-labels": tagLabels,
      "../ui": ui,
      "../hooks/useLazyChunk": {
        useLazyChunk(chunk, open, close) {
          lazy.push([chunk, open, close]);
          return open ? drawer : null;
        },
      },
      "../hooks/useListPrefs": {
        useListPrefs: () => ({
          density: "compact",
          stacked: { radarr: true, sonarr: false },
          filename: { radarr: true, sonarr: false },
        }),
      },
      "./AppDataProvider": {
        useAppData: () => ({ presets, setSettings: setSettingsStub }),
      },
      "./CustomBulk": { CustomBulk: "CustomBulk" },
      "../file-rename": { renamedRow: () => null },
      "../file-paging": loadSource("file-paging.ts"),
      "../hooks/useFilePager": { useFilePager: () => undefined },
      "../series-collapse": loadSource("series-collapse.ts", {
        modules: { "preact/hooks": hooks },
      }),
      "./library/file-dialog-chunk": { fileDialogChunk: "fileDialogChunk" },
      "./PageHeader": { PageHeader: "PageHeader" },
      "./SavePresetDialog": { SavePresetDialog: "SavePresetDialog" },
      "./library/drawer-chunk": { drawerChunk: "drawerChunk" },
      "./library/ColumnsMenu": { ColumnsMenu: "ColumnsMenu" },
      "./library/InstanceSegment": { InstanceSegment: "InstanceSegment" },
      "./library/MediaTable": { MediaTable: "MediaTable" },
      "./library/SelectionTools": { SelectionTools: "SelectionTools" },
      "./list/ChipsRow": { ChipsRow: "ChipsRow" },
      "./list/FilterBar": { FilterBar: "FilterBar" },
      "./list/ListEmpty": { ListEmpty: "ListEmpty" },
      "./list/PageNav": { PageNav: "PageNav" },
      "./list/TableCard": { TableCard: "TableCard" },
    },
  });
  const view = mount(
    page.LibraryPage,
    {
      status,
      refresh: async () => {},
      settings,
      library: library.state,
      navigation: nav,
    },
    new Map([[ui.TagLabels, {}]]),
  );
  const tree = view.render();
  return { tree, view, lazy, calls: library.calls };
}
const listPage = (tree) => kids(tree).find((n) => n.type === "div");
const card = (tree) => ofType(tree, "TableCard")[0];
const tools = (tree) => kids(card(tree).props.chips.props.tools);

test("the library page builds its card from the list blocks", () => {
  const { tree, lazy } = libraryPage();
  const [header, page, drawer] = kids(tree);
  assert.equal(header.type, "PageHeader");
  assert.equal(header.props.title, "Movie library");
  assert.deepEqual(kids(header.props.meta), ["120", " ", "files in cache"]);
  assert.equal(header.props.actions, false);
  assert.equal(page.props.class, "v2-list-page");
  assert.equal(drawer, undefined);
  // The card: the head (title, count, busy, hint, filter bar), the chips
  // row, the table and the pager, in that order.
  const [table] = kids(page);
  assert.equal(table.type, "TableCard");
  const p = table.props;
  assert.deepEqual(
    [p.id, p.title, p.count, p.countTitle, p.busy, p.hint, p.density],
    [
      "library",
      "Your movies",
      1,
      "Items in the list",
      false,
      undefined,
      "compact",
    ],
  );
  assert.equal(p.regionLabel, "Your movies");
  assert.equal(p.bar.type, "FilterBar");
  assert.equal(p.chips.type, "ChipsRow");
  assert.equal(p.foot.type, "PageNav");
  assert.deepEqual(
    kids(table).map((n) => n.type),
    ["MediaTable"],
  );
  const media = kids(table)[0].props;
  assert.deepEqual(
    [
      media.service,
      media.columns,
      media.placeholders,
      media.stacked,
      media.filename,
    ],
    ["radarr", ["title"], 0, true, true],
  );
  // The pager keeps the 1.7.0 summary.
  assert.deepEqual(
    [p.foot.props.page, p.foot.props.pages, text(p.foot.props.summary)],
    [1, 1, "1–1 of 1 files"],
  );
  // The drawer is the lazy chunk, preloaded by useLazyChunk and closed.
  assert.deepEqual(lazy[0].slice(0, 2), ["drawerChunk", false]);
  // No 1.7.0 library parts are left.
  const code = src("components/LibraryPage.tsx");
  assert.doesNotMatch(
    code,
    /filter-panel|results-heading|library-section|table-wrap|connect-card|heading-count|FilterPanel|LibraryTable|<EmptyState|<Pagination/,
  );
});

test("an unconfigured library shows the setup notice first", async () => {
  const unconfigured = () =>
    libraryState({ configured: false, libraryInstances: [] });
  let library = unconfigured();
  const { tree } = libraryPage({ library, settings: settingsWith([]) });
  const [notice, table] = kids(listPage(tree));
  assert.equal(notice.props.class, "v2-notice v2-notice--setup");
  assert.equal(table.type, "TableCard");
  assert.equal(
    text(byClass(notice, "v2-notice-body")),
    "Connect your movie library.An address and API key are enough. Scopearr only reads existing data.",
  );
  const button = ofType(notice, "button")[0];
  assert.equal(button.props.class, "v2-btn v2-btn--primary");
  assert.equal(text(button), "Set up service");
  // A named action after canLeaveRules(), as before.
  await button.props.onClick();
  assert.deepEqual(library.calls, [["ask"], ["settings"]]);
  // TV series name their library; the demo and missing settings show none.
  library = unconfigured();
  const series = libraryPage({
    library,
    settings: settingsWith([]),
    navigation: { service: "sonarr" },
  }).tree;
  assert.match(text(listPage(series)), /^Connect your TV library\./);
  for (const options of [
    { status: { demo: true, mux: {} } },
    { settings: null },
  ]) {
    const { tree } = libraryPage({ library: unconfigured(), ...options });
    assert.deepEqual(
      kids(listPage(tree)).map((n) => n.type),
      ["TableCard"],
    );
  }
});

test("the library page puts the instance segment in its header", () => {
  const two = settingsWith([
    radarr("radarr", ""),
    radarr("radarr-4k", "4K"),
    radarr("radarr-old", "Old", false),
  ]);
  const library = libraryState({
    query: "instance=radarr-4k",
    libraryInstances: [radarr("radarr", ""), radarr("radarr-4k", "4K")],
  });
  const { tree, calls } = libraryPage({ library, settings: two });
  const segment = kids(tree)[0].props.actions;
  assert.equal(segment.type, "InstanceSegment");
  // The enabled instances, as the sidebar's sub-entries.
  assert.deepEqual(
    [
      segment.props.service,
      plain(segment.props.instances),
      segment.props.current,
    ],
    [
      "radarr",
      [
        { id: "radarr", name: "Radarr" },
        { id: "radarr-4k", name: "4K" },
      ],
      "radarr-4k",
    ],
  );
  assert.equal(
    segment.props.hrefOf({ view: "library", service: "radarr", instance: "" }),
    '#href:{"view":"library","service":"radarr","instance":""}',
  );
  segment.props.open({ view: "library", service: "radarr", instance: "" });
  assert.deepEqual(calls, [
    ["link", { view: "library", service: "radarr", instance: "" }],
  ]);
  // The card title names the filtered instance.
  assert.equal(card(tree).props.title, "Your movies · 4K");
  // One enabled instance is the whole library: no segment.
  const one = libraryPage({
    settings: settingsWith([
      radarr("radarr", ""),
      radarr("radarr-4k", "4K", false),
    ]),
  });
  assert.equal(kids(one.tree)[0].props.actions, false);
});

test("CSV export keeps filters, sort and language", () => {
  const exportQuery = new URLSearchParams(
    "resolution=1080p&q=Tenet&service=radarr&lang=de&sort=year&dir=desc",
  );
  let { tree } = libraryPage({ library: libraryState({ exportQuery }) });
  const csv = tools(tree).at(-1);
  assert.deepEqual(
    [csv.type, csv.props.class, csv.props.href, csv.props.download],
    [
      "a",
      "v2-icon-btn",
      "/api/export?resolution=1080p&q=Tenet&service=radarr&lang=de&sort=year&dir=desc",
      true,
    ],
  );
  assert.deepEqual(
    [csv.props["aria-label"], csv.props.title],
    ["Export CSV", "Export CSV"],
  );
  // Without results it is a disabled link without a target.
  ({ tree } = libraryPage({
    library: libraryState({
      exportQuery,
      results: { files: [], total: 0, displayTotal: 0, page: 1, pageSize: 50 },
    }),
  }));
  const off = tools(tree).at(-1);
  assert.deepEqual(
    [off.type, off.props.role, off.props["aria-disabled"], off.props.href],
    ["span", "link", "true", undefined],
  );
  // The state hook builds the query as 1.7.0 did.
  assert.match(
    squash(src("hooks/useLibraryState.ts")),
    /const exportQuery = new URLSearchParams\(query\); exportQuery\.set\("service", service\); exportQuery\.set\("lang", getLocale\(\)\); exportQuery\.set\("sort", movieSort\.field\); exportQuery\.set\("dir", movieSort\.direction\);/,
  );
});

test("the page tools come in the 1.7.0 order with their names", async () => {
  const preset = {
    id: 7,
    service: "radarr",
    name: "UHD",
    query: "resolution=2160p",
  };
  const library = libraryState({ selectedPreset: preset });
  const { tree, calls } = libraryPage({ library, presets: [preset] });
  const row = card(tree).props.chips.props;
  assert.deepEqual([row.label, row.empty], ["Filters", "No active filters"]);
  const shown = tools(tree);
  assert.deepEqual(
    shown.map((n) =>
      n.type === "SelectionTools"
        ? "selection"
        : n.type === "ColumnsMenu"
          ? "columns"
          : n.type === "span" && n.props.class === "v2-tc-sep"
            ? "|"
            : n.props["aria-label"],
    ),
    [
      "selection",
      "|",
      "columns",
      "|",
      "Save preset",
      "Delete selected preset",
      "|",
      "Export CSV",
    ],
  );
  const [selection, , columns, , save, remove] = shown;
  assert.equal(selection.props.installed, true);
  assert.equal(selection.props.working, false);
  // The page size sets the width of the count slots.
  assert.equal(selection.props.capacity, 50);
  selection.props.editTags();
  // The column menu (rc.3 K1) gets the saved columns of the service and
  // saves through the app data; its link opens Display.
  assert.deepEqual(
    [
      columns.key,
      columns.props.service,
      plain(columns.props.order),
      plain(columns.props.visible),
      columns.props.saved === setSettingsStub,
    ],
    ["radarr", "radarr", ["title", "year"], ["title"], true],
  );
  columns.props.open({ view: "settings", section: "appearance", tab: "lists" });
  assert.equal(save.props.title, "Save filters as a permanent preset");
  save.props.onClick();
  assert.equal(remove.props.disabled, false);
  await remove.props.onClick();
  assert.deepEqual(calls, [
    ["custom", true],
    ["link", { view: "settings", section: "appearance", tab: "lists" }],
    ["error", ""],
    ["save", true],
    ["delete"],
  ]);
  // Without a chosen preset, Delete selected preset is locked.
  const none = libraryPage();
  assert.equal(tools(none.tree)[5].props.disabled, true);
});

test("the column menu saves a column at once and links to Display", async () => {
  const requests = [];
  const stored = [];
  const savedWith = [];
  let fail = false;
  const base = {
    visibleColumns: { radarr: ["title", "year"], sonarr: ["title"] },
    columnOrder: { radarr: ["info", "title", "year"], sonarr: [] },
    muxColumnOrder: ["legacy"],
  };
  const menu = list("components/library/ColumnsMenu.tsx", {
    "../../api": {
      api: async (path, method = "GET", body) => {
        requests.push([path, method, plain(body)]);
        if (method === "PUT" && fail) throw new Error("Request failed");
        return method === "GET" ? { ...base, fresh: true } : {};
      },
    },
    "../../browser-storage": {
      writeSessionPreference: (key, value) => stored.push([key, value]),
    },
    "../../nav-link": loadSource("nav-link.ts"),
    "../../settings-payload": loadSource("settings-payload.ts"),
    "../frame/Popover": { Popover: "Popover" },
    "../settings/Check": loadSource("components/settings/Check.tsx", {
      modules: { preact },
    }),
  });
  const opened = [];
  const view = mount(menu.ColumnsMenu, {
    service: "radarr",
    settings: base,
    order: ["info", "title", "year"],
    visible: ["title", "year"],
    saved: (settings) => savedWith.push(settings),
    hrefOf: (target) => "#href:" + JSON.stringify(target),
    open: (target) => opened.push(plain(target)),
  });
  let tree = view.render();
  const [button] = kids(tree);
  assert.deepEqual(
    [
      button.props.class,
      button.props["aria-label"],
      button.props.title,
      button.props["aria-haspopup"],
      button.props["aria-expanded"],
    ],
    ["v2-icon-btn", "Columns", "Columns", "dialog", false],
  );
  const anchor = { focus() {} };
  button.props.onClick({ currentTarget: anchor });
  tree = view.render();
  const pop = ofType(tree, "Popover")[0];
  assert.deepEqual(
    [pop.props.role, pop.props.label, pop.props.anchor === anchor],
    ["dialog", "Columns", true],
  );
  assert.equal(kids(tree)[0].props["aria-expanded"], true);
  const boxes = () =>
    nodes(view.render()).filter((n) => n.props?.type === "checkbox");
  // Every column but the title, in the saved order.
  assert.deepEqual(
    nodes(view.render())
      .filter((n) => n.type === "label")
      .map((n) => text(n)),
    ["Info", "Year"],
  );
  assert.deepEqual(
    boxes().map((n) => n.props.checked),
    [false, true],
  );
  boxes()[0].props.onChange({ currentTarget: { checked: true } });
  assert.deepEqual(
    boxes().map((n) => n.props.checked),
    [true, true],
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  view.flush();
  // The existing settings save: the whole settings without the obsolete
  // mux columns, the new visible columns in the saved order.
  assert.deepEqual(requests, [
    [
      "settings",
      "PUT",
      {
        visibleColumns: {
          radarr: ["info", "title", "year"],
          sonarr: ["title"],
        },
        columnOrder: base.columnOrder,
        tagApprovals: {},
      },
    ],
    ["settings", "GET", null],
  ]);
  assert.deepEqual(plain(savedWith), [{ ...base, fresh: true }]);
  // A failed save shows the saved columns again (its toast is the
  // request's own).
  fail = true;
  requests.length = 0;
  boxes()[1].props.onChange({ currentTarget: { checked: false } });
  assert.deepEqual(
    boxes().map((n) => n.props.checked),
    [false, false],
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  view.flush();
  assert.equal(requests.length, 1);
  assert.deepEqual(
    boxes().map((n) => n.props.checked),
    [false, true],
  );
  // The link writes the list's tab, closes and opens Display › Lists.
  const link = nodes(view.render()).find((n) => n.type === "a");
  assert.equal(
    link.props.href,
    '#href:{"view":"settings","section":"appearance","tab":"lists"}',
  );
  assert.match(text(link), /Order under Display/);
  let prevented = false;
  link.props.onClick({
    button: 0,
    preventDefault: () => (prevented = true),
  });
  assert.equal(prevented, true);
  assert.deepEqual(stored, [["scopearr-columns-tab", "radarr"]]);
  assert.deepEqual(opened, [
    { view: "settings", section: "appearance", tab: "lists" },
  ]);
  assert.equal(ofType(view.render(), "Popover").length, 0);
});

test("the filter bar searches at once and opens the drawer", () => {
  const preset = {
    id: 7,
    service: "radarr",
    name: "UHD",
    query: "resolution=2160p",
  };
  const other = {
    id: 8,
    service: "sonarr",
    name: "Anime",
    query: "language=Japanisch",
  };
  const library = libraryState({
    query:
      "q=Tenet&resolution=1080p&resolutionOp=not&hdr=HDR10&hdr=Dolby+Vision&hdrOp=all",
    active: [
      ["q", "Tenet"],
      ["resolution", "1080p"],
    ],
  });
  const { tree, calls } = libraryPage({ library, presets: [preset, other] });
  const bar = card(tree).props.bar.props;
  // The search shows the filters as typed (not the debounced route) and
  // writes them at once, as 1.7.0 did.
  assert.deepEqual(
    [bar.search.label, bar.search.placeholder, bar.search.value],
    ["Title or filename", "Search movie or file …", "Tenet"],
  );
  bar.search.change("Tenet 2");
  bar.search.change("");
  // Presets of the service; filters that match none show Custom selection.
  assert.deepEqual(
    [bar.preset.label, bar.preset.value, bar.preset.custom],
    ["Filter preset", "all", true],
  );
  assert.deepEqual(plain(bar.preset.options), [
    { value: "all", label: "All files" },
    { value: "7", label: "UHD" },
  ]);
  bar.preset.choose("7");
  bar.preset.choose("all");
  // The Filters button counts the chips without the search.
  assert.deepEqual([bar.filters.count, bar.filters.expanded], [2, false]);
  bar.filters.open("anchor");
  // Chips name and remove their filter at once.
  const chips = card(tree).props.chips.props.chips;
  assert.deepEqual(
    chips.map((chip) => [chip.key, chip.label, chip.excluded]),
    [
      ["q=Tenet", "Search: Tenet", false],
      ["resolution=1080p", "Resolution ≠ 1080p", true],
      ["hdr", "HDR contains all: HDR10 + Dolby Vision", false],
    ],
  );
  chips[1].remove();
  card(tree).props.chips.props.reset();
  assert.deepEqual(calls, [
    ["change", "q", ["Tenet 2"]],
    ["change", "q", []],
    ["preset", 7],
    ["reset"],
    ["open", "anchor"],
    [
      "replace",
      "q=Tenet&resolutionOp=not&hdr=HDR10&hdr=Dolby+Vision&hdrOp=all",
    ],
    ["reset"],
  ]);
  // A chosen preset shows; TV series have their own placeholder.
  const chosen = libraryPage({
    library: libraryState({
      selectedPreset: preset,
      active: [["resolution", "2160p"]],
    }),
    presets: [preset],
    navigation: { service: "sonarr" },
  });
  const series = card(chosen.tree).props.bar.props;
  assert.deepEqual(
    [series.preset.value, series.preset.custom, series.search.placeholder],
    ["7", false, "Series, episode or file …"],
  );
});

// Final review I3 (ruling): the instance segment is navigation, not a
// filter. An instance alone reads "All files" with no filter counted and
// no "Custom selection"; with a filter beside it, it is a custom
// selection, and its chip stays (E14).
test("an instance alone is no filter selection", () => {
  const bar = (query, extra = {}) =>
    card(
      libraryPage({
        library: libraryState({
          query,
          active: [...new URLSearchParams(query)].filter(
            ([key]) => !key.endsWith("Op"),
          ),
          ...extra,
        }),
      }).tree,
    ).props.bar.props;
  const only = bar("instance=radarr-4k");
  assert.deepEqual(
    [only.preset.value, only.preset.custom, only.filters.count],
    ["all", false, 0],
  );
  const filtered = bar("instance=radarr-4k&codec=x265");
  assert.deepEqual(
    [filtered.preset.value, filtered.preset.custom, filtered.filters.count],
    ["all", true, 1],
  );
  const searched = bar("instance=radarr-4k&q=Tenet");
  assert.deepEqual([searched.preset.custom, searched.filters.count], [true, 0]);
});

test("the drawer opens from the Filters button with the page's filters", () => {
  const Drawer = "LibraryFilterDrawer";
  const library = libraryState({
    drawer: "anchor",
    query: "resolution=1080p",
    facets: { resolution: ["1080p"] },
  });
  const { tree, lazy, calls } = libraryPage({ library, drawer: Drawer });
  assert.deepEqual(lazy.at(-1).slice(0, 2), ["drawerChunk", true]);
  assert.equal(lazy.at(-1)[2], library.state.closeDrawer);
  const drawer = kids(tree).at(-1);
  assert.equal(drawer.type, Drawer);
  assert.deepEqual(
    [
      drawer.props.service,
      drawer.props.title,
      drawer.props.query,
      plain(drawer.props.facets),
      drawer.props.mediaInfoEnabled,
    ],
    [
      "radarr",
      "Your movies",
      "resolution=1080p",
      { resolution: ["1080p"] },
      true,
    ],
  );
  assert.equal(card(tree).props.bar.props.filters.expanded, true);
  drawer.props.apply("resolution=2160p");
  drawer.props.close();
  assert.deepEqual(calls, [["apply", "resolution=2160p"], ["close"]]);
  // A track chip's choice is one apply of the page's filters.
  const media = kids(listPage(tree))[0];
  const table = kids(media)[0];
  table.props.onTrackFilter({ kind: "codec", value: "DTS" });
  assert.deepEqual(calls.at(-1), ["apply", "resolution=1080p&audio=DTS"]);
  // The drawer is its own chunk, never in the page's static imports.
  const code = src("components/LibraryPage.tsx");
  assert.match(code, /useLazyChunk\(drawerChunk, !!drawer, closeDrawer\)/);
  assert.doesNotMatch(code, /from "\.\/library\/LibraryFilterDrawer"/);
});

test("placeholders hold the table until the first results and empty states follow", () => {
  // Until a service's first results: the page or the cached files.
  let { tree } = libraryPage({
    library: libraryState({
      loaded: false,
      busy: true,
      results: { files: [], total: 0, displayTotal: 0, page: 1, pageSize: 100 },
      syncCount: 12,
    }),
  });
  let table = kids(card(tree));
  assert.deepEqual(
    table.map((n) => n.type),
    ["MediaTable"],
  );
  assert.equal(table[0].props.placeholders, 12);
  // Loaded without matches: reset the filters; without any: the settings.
  const none = { files: [], total: 0, displayTotal: 0, page: 1, pageSize: 50 };
  const filtered = libraryState({ results: none, active: [["q", "x"]] });
  ({ tree } = libraryPage({ library: filtered }));
  table = kids(card(tree));
  const empty = table[1];
  assert.equal(empty.type, "ListEmpty");
  assert.equal(empty.props.title, "No matching files.");
  const reset = ofType(empty, "button")[0];
  assert.equal(text(reset), "Reset filters");
  reset.props.onClick();
  assert.deepEqual(filtered.calls, [["reset"]]);
  const blank = libraryState({ results: none });
  ({ tree } = libraryPage({ library: blank }));
  const start = kids(card(tree))[1];
  assert.equal(start.props.title, "Your overview starts here.");
  assert.equal(text(ofType(start, "button")[0]), "Open settings");
  // Busy shows no empty state.
  ({ tree } = libraryPage({
    library: libraryState({ results: none, busy: true }),
  }));
  assert.equal(kids(card(tree)).length, 1);
});

// --- useLibraryState -------------------------------------------------------------

function libraryHook(
  overrides = {},
  { presets = [], api = () => new Promise(() => {}) } = {},
) {
  const runtime = createHookRuntime();
  const seen = { query: [], facets: [] };
  const navigation = {
    view: "library",
    service: "radarr",
    filters: { radarr: "", sonarr: "" },
    setFilters(next) {
      navigation.filters =
        typeof next === "function" ? next(navigation.filters) : next;
    },
    page: 3,
    setPage(page) {
      navigation.page = page;
    },
    movieSort: { field: "title", direction: "asc" },
    settingsOpen: false,
    libraryEntry: 0,
    ...overrides,
  };
  const { useLibraryState } = loadSource("hooks/useLibraryState.ts", {
    modules: {
      "preact/hooks": runtime.hooks,
      "./useFileSelection": loadSource("hooks/useFileSelection.ts", {
        modules: {
          "preact/hooks": runtime.hooks,
          "../file-selection": fileSelection,
        },
      }),
      "../instances": instances,
      "../confirmation": {},
      "../i18n": i18n,
      "../notifications": { notify() {} },
      "../api": { api, ApiError: class {} },
      "../dashboard-filter": loadSource("dashboard-filter.ts"),
      "../library-filters": filters,
      "./useLibraryQuery": {
        useFacets(enabled, service, revision, setFacets) {
          seen.facets.push({ enabled, service, setFacets });
        },
        useLibraryQuery(args) {
          seen.query.push(args);
        },
      },
      "../preset-query": loadSource("preset-query.ts", {
        modules: { "./languages.ts": languages },
      }),
      "../ui": {
        defaultColumnOrder: [],
        defaultColumns: [],
        emptyResults: {
          files: [],
          total: 0,
          displayTotal: 0,
          page: 1,
          pageSize: 100,
        },
      },
    },
  });
  const data = {
    settings: null,
    presets,
    loadPresets: async () => {},
    customRevision: 0,
  };
  const h = {
    navigation,
    seen,
    render() {
      runtime.flush();
      h.current = runtime.settle(
        () => useLibraryState({ status: {}, navigation, data }),
        { max: 10 },
      );
      return h.current;
    },
    results(files) {
      seen.query.at(-1).setResults({
        files,
        total: files.length,
        displayTotal: files.length,
        page: 1,
        pageSize: 100,
      });
      return h.render();
    },
  };
  h.render();
  return h;
}

test("a library entry clears the selection and closes the drawer", () => {
  const h = libraryHook();
  assert.ok(!("collapsed" in h.current) && !("setCollapsed" in h.current));
  h.results([movie]);
  const pick = () => {
    h.current.selection.toggle([movie], true);
    h.current.openDrawer("filters");
    h.render();
    assert.equal(h.current.selection.keys.length, 1);
    assert.equal(h.current.drawer, "filters");
  };
  pick();
  h.render();
  assert.equal(h.current.drawer, "filters");
  // A library entry (a link or an action) starts the library again.
  h.navigation.libraryEntry = 1;
  h.render();
  assert.deepEqual(plain(h.current.selection.keys), []);
  assert.equal(h.current.drawer, null);
  pick();
  h.current.closeDrawer();
  h.render();
  assert.equal(h.current.drawer, null);
  // Back or Forward to another page or service closes it as well.
  for (const change of [
    { view: "statistics" },
    { service: "sonarr" },
    { settingsOpen: true },
  ]) {
    h.current.openDrawer("filters");
    h.render();
    assert.equal(h.current.drawer, "filters");
    Object.assign(h.navigation, change);
    h.render();
    assert.equal(h.current.drawer, null, JSON.stringify(change));
    Object.assign(h.navigation, {
      view: "library",
      service: "radarr",
      settingsOpen: false,
    });
    h.render();
  }
});

// Final review I3: a preset without an instance still matches on an
// instance (the segment is navigation); one with an instance matches only
// there. An instance alone matches no preset. Choosing a preset or Reset
// replaces the instance, as in 1.7.0.
test("presets match beside the instance and replace it", () => {
  const uhd = {
      id: 7,
      service: "radarr",
      name: "UHD",
      query: "resolution=2160p",
    },
    hd = {
      id: 8,
      service: "radarr",
      name: "HD on 4K",
      query: "instance=radarr-4k&resolution=1080p",
    };
  const h = libraryHook(
    { filters: { radarr: "instance=radarr-4k", sonarr: "" } },
    { presets: [uhd, hd] },
  );
  assert.equal(h.current.selectedPreset, undefined);
  for (const [filters, id] of [
    ["instance=radarr-4k&resolution=2160p", 7],
    ["resolution=2160p&instance=radarr-hd", 7],
    ["resolution=2160p", 7],
    ["instance=radarr-4k&resolution=1080p", 8],
    ["instance=radarr-hd&resolution=1080p", undefined],
    ["resolution=1080p", undefined],
    ["instance=radarr-4k&resolution=2160p&codec=x265", undefined],
  ]) {
    h.navigation.filters = { radarr: filters, sonarr: "" };
    h.render();
    assert.equal(h.current.selectedPreset?.id, id, filters);
  }
  // Applying a preset or Reset replaces the instance (1.7.0).
  h.navigation.filters = {
    radarr: "instance=radarr-4k&codec=x265",
    sonarr: "",
  };
  h.render();
  h.current.applyPreset(uhd);
  assert.equal(h.navigation.filters.radarr, "resolution=2160p");
  h.navigation.filters = {
    radarr: "instance=radarr-4k&codec=x265",
    sonarr: "",
  };
  h.render();
  h.current.reset();
  assert.equal(h.navigation.filters.radarr, "");
});

test("Apply replaces the drawer's filters once and keeps the search", () => {
  const h = libraryHook({
    filters: { radarr: "q=Ten&instance=radarr-4k&codec=hevc", sonarr: "q=x" },
  });
  // A search typed after the drawer opened stays; every other key is the
  // draft's, on page 1.
  h.current.openDrawer("filters");
  h.render();
  h.navigation.filters.radarr = "q=Tenet&instance=radarr-4k&codec=hevc";
  h.current.applyFilters(
    "q=Ten&instance=radarr&resolution=1080p&resolutionOp=not",
  );
  assert.deepEqual(plain(h.navigation.filters), {
    radarr: "q=Tenet&instance=radarr-4k&resolution=1080p&resolutionOp=not",
    sonarr: "q=x",
  });
  assert.equal(h.navigation.page, 1);
  // A chip replaces the filters as they are.
  h.navigation.page = 4;
  h.current.replaceFilters("q=Tenet");
  assert.deepEqual(plain(h.navigation.filters), {
    radarr: "q=Tenet",
    sonarr: "q=x",
  });
  assert.equal(h.navigation.page, 1);
});

test("a deep link with more than 16 track combinations reads the first 16", () => {
  const tracks = Array.from(
    { length: 17 },
    (_, n) => "track=" + encodeURIComponent(`||${n + 1}.0`),
  );
  const h = libraryHook({
    filters: { radarr: ["q=x", ...tracks].join("&"), sonarr: "" },
  });
  const first16 = ["q=x", ...tracks.slice(0, 16)].join("&");
  assert.equal(h.current.query, first16);
  assert.equal(h.seen.query.at(-1).filters.radarr, first16);
  assert.equal(
    h.current.exportQuery.getAll("track").length,
    16,
    "the CSV export",
  );
  // Writing them back keeps 16.
  h.current.replaceFilters(["q=y", ...tracks].join("&"));
  assert.equal(
    new URLSearchParams(h.navigation.filters.radarr).getAll("track").length,
    16,
  );
  h.current.applyFilters(tracks.join("&"));
  assert.equal(
    new URLSearchParams(h.navigation.filters.radarr).getAll("track").length,
    16,
  );
});

test("facets load only while the drawer is open and stay while they reload", () => {
  const h = libraryHook();
  assert.equal(h.seen.facets.at(-1).enabled, false);
  assert.equal(h.current.facets, null);
  h.current.openDrawer("filters");
  h.render();
  assert.equal(h.seen.facets.at(-1).enabled, true);
  // Null until they arrive (the drawer shows placeholders).
  assert.equal(h.current.facets, null);
  h.seen.facets.at(-1).setFacets({ resolution: ["1080p"] });
  h.render();
  assert.deepEqual(plain(h.current.facets), { resolution: ["1080p"] });
  // Closed: no loading; opened again: the last ones while they reload.
  h.current.closeDrawer();
  h.render();
  assert.equal(h.seen.facets.at(-1).enabled, false);
  h.current.openDrawer("filters");
  h.render();
  assert.equal(h.seen.facets.at(-1).enabled, true);
  assert.deepEqual(plain(h.current.facets), { resolution: ["1080p"] });
  // Another service never shows them.
  h.navigation.service = "sonarr";
  h.render();
  assert.equal(h.current.facets, null);
  // useFacets itself no longer empties them before a load.
  assert.doesNotMatch(src("hooks/useLibraryQuery.ts"), /setFacets\(\{\}\)/);
});

test("results remember their service and placeholders wait for them", () => {
  const h = libraryHook();
  assert.equal(h.current.loaded, false);
  h.results([movie]);
  assert.equal(h.current.loaded, true);
  // Another service is not loaded until its own results arrive.
  h.navigation.service = "sonarr";
  h.render();
  assert.equal(h.current.loaded, false);
  assert.deepEqual(plain(h.current.results.files), []);
  h.navigation.service = "radarr";
  h.render();
  assert.equal(h.current.loaded, true);
});

// rc.5 S1: a page of series (every episode of its series) is not drawn in
// the expanded view while that view's page of files loads, nor a page of
// files in the collapsed view: each paging waits for its own answer.
test("results remember their paging and wait for the other view's", () => {
  const h = libraryHook({
    service: "sonarr",
    page: 1,
    seriesView: true,
  });
  assert.equal(h.seen.query.at(-1).bySeries, true);
  h.results([movie]);
  assert.equal(h.current.loaded, true);
  h.navigation.seriesView = false;
  h.render();
  assert.equal(h.seen.query.at(-1).bySeries, false);
  assert.equal(h.current.loaded, false);
  assert.deepEqual(plain(h.current.results.files), []);
  h.results([movie]);
  assert.equal(h.current.loaded, true);
  h.navigation.seriesView = true;
  h.render();
  assert.equal(h.current.loaded, false);
  // Another order lists files in both views: nothing to wait for.
  h.navigation.movieSort = { field: "year", direction: "asc" };
  h.render();
  assert.equal(h.seen.query.at(-1).bySeries, false);
  assert.equal(h.current.loaded, true);
  h.navigation.seriesView = false;
  h.render();
  assert.equal(h.current.loaded, true);
});

// Ruling P11/M14: a page past the end (fewer results after a change, a
// stale deep link) returns to the last page once its results are there.
test("a page past the end returns to the last page", () => {
  const h = libraryHook();
  h.navigation.page = 5;
  h.render();
  const results = (page, displayTotal) => {
    h.seen.query.at(-1).setResults({
      files: [movie],
      total: displayTotal,
      displayTotal,
      page,
      pageSize: 100,
    });
    h.render();
  };
  // Results of another page than the shown one change nothing.
  results(4, 150);
  assert.equal(h.navigation.page, 5);
  results(5, 150);
  assert.equal(h.current.pages, 2);
  assert.equal(h.navigation.page, 2);
  // Within the pages nothing moves.
  h.navigation.page = 2;
  results(2, 150);
  assert.equal(h.navigation.page, 2);
});

// Review M1: the instance chip names the instance as 1.7.0 did
// (instanceLabel: its name, else its service's name), never its raw id.
test("the instance chip names the instance by its label", () => {
  const library = libraryState({
    query: "instance=radarr-2&instance=gone",
    libraryInstances: [radarr("radarr-2", ""), radarr("radarr-4k", "4K")],
  });
  const { tree } = libraryPage({ library });
  assert.deepEqual(
    card(tree).props.chips.props.chips.map((chip) => chip.label),
    ["Service: Radarr", "Service: gone"],
  );
  const named = libraryPage({
    library: libraryState({
      query: "instance=radarr-4k",
      libraryInstances: [radarr("radarr-2", ""), radarr("radarr-4k", "4K")],
    }),
  });
  assert.deepEqual(
    card(named.tree).props.chips.props.chips.map((chip) => chip.label),
    ["Service: 4K"],
  );
});

// Review M2: a history step inside the library keeps the drawer open (as
// dialogs stay open on Back) and hands it the filters the step brought.
test("Back inside the library keeps the drawer and hands it the new filters", () => {
  const h = libraryHook({ filters: { radarr: "codec=hevc", sonarr: "" } });
  h.current.openDrawer("filters");
  h.render();
  h.navigation.filters = { radarr: "resolution=1080p", sonarr: "" };
  h.render();
  assert.equal(h.current.drawer, "filters");
  assert.equal(h.current.query, "resolution=1080p");
});

// The dialog route (Phase 5d, E17, R-H): file=<service>:<id> lives in the
// route only. The library's filters come without it, so the files query,
// the CSV export and a saved preset never carry it.
test("the file key never reaches presets, export or the files query", async () => {
  const storage = loadSource("browser-storage.ts");
  const { parseRoute } = loadSource("router.ts", {
    modules: {
      "./event-log": loadSource("event-log.ts"),
      "./tool-route": loadSource("tool-route.ts", {
        modules: { "./browser-storage": storage },
      }),
    },
  });
  const route = parseRoute("#/movies?q=Arrival&file=radarr%3A42&codec=x265");
  assert.equal(route.file, "radarr:42");
  const posts = [];
  const h = libraryHook(
    {
      route,
      file: route.file,
      filters: { radarr: route.filters, sonarr: "" },
    },
    {
      api: async (path, method, body) => {
        if (method === "POST") posts.push([path, plain(body)]);
        return { id: 9, ...body };
      },
    },
  );
  const query = h.seen.query.at(-1);
  assert.equal(query.filters.radarr, "q=Arrival&codec=x265");
  assert.equal(
    h.current.exportQuery.toString(),
    "q=Arrival&codec=x265&service=radarr&lang=en&sort=title&dir=asc",
  );
  h.current.setPresetName("Arrival");
  h.render();
  await h.current.doSavePreset({ preventDefault() {} });
  assert.deepEqual(posts, [
    [
      "presets",
      { name: "Arrival", service: "radarr", query: "q=Arrival&codec=x265" },
    ],
  ]);
  for (const text of [
    query.filters.radarr,
    h.current.exportQuery.toString(),
    JSON.stringify(posts),
  ])
    assert.doesNotMatch(text, /file|radarr%3A42|radarr:42/);
});

test("the TV library collapses a series for the session (rc.3 K3)", () => {
  const episode = (id, mediaId, series) => ({
    service: "sonarr",
    id,
    mediaId,
    series,
    season: 1,
    filename: series + id + ".mkv",
    title: "Episode " + id,
  });
  const files = [episode(1, 21, "Dark"), episode(2, 22, "Lost")];
  const library = libraryState({
    results: { files, total: 2, displayTotal: 2, page: 1, pageSize: 50 },
  });
  const { view } = libraryPage({
    library,
    navigation: { service: "sonarr" },
    browser: { document: { activeElement: null } },
  });
  const render = () => {
    view.flush();
    return view.render();
  };
  const tableOf = (tree) => ofType(tree, "MediaTable")[0].props;
  const region = (tree) =>
    nodes(tree).filter((n) => n.type === "p" && n.props["aria-live"]);
  let tree = render();
  // Every series starts expanded; the live region is there, empty.
  assert.deepEqual([...tableOf(tree).collapsed], []);
  // The TV library reads its own list's switches (movies: stacked, with
  // the filename; series: neither stacked nor with the filename).
  assert.deepEqual(
    [tableOf(tree).stacked, tableOf(tree).filename],
    [false, false],
  );
  assert.equal(region(tree).length, 1);
  assert.equal(region(tree)[0].props.class, "v2-sr-only");
  assert.equal(text(region(tree)[0]), "");
  // The toggle hides a series and says so, and shows it again.
  tableOf(tree).toggleSeries("sonarr/21", "Dark", false);
  tree = render();
  assert.deepEqual([...tableOf(tree).collapsed], ["sonarr/21"]);
  assert.equal(text(region(tree)[0]), "Episodes hidden: Dark");
  tableOf(tree).toggleSeries("sonarr/21", "Dark", true);
  tree = render();
  assert.deepEqual([...tableOf(tree).collapsed], []);
  assert.equal(text(region(tree)[0]), "Episodes shown: Dark");
  // A search for a series' title (quick search) expands it once.
  tableOf(tree).toggleSeries("sonarr/22", "Lost", false);
  tree = render();
  assert.deepEqual([...tableOf(tree).collapsed], ["sonarr/22"]);
  view.props = {
    ...view.props,
    library: { ...library.state, q: new URLSearchParams("q=lost") },
  };
  render();
  tree = render();
  assert.deepEqual([...tableOf(tree).collapsed], []);
  tableOf(tree).toggleSeries("sonarr/22", "Lost", false);
  render();
  tree = render();
  assert.deepEqual([...tableOf(tree).collapsed], ["sonarr/22"]);
  // Movies have no region.
  const movies = libraryPage().tree;
  assert.equal(region(movies).length, 0);
});

// The collapsed series view (rc.4 R2, rc.5 S2): the page tools' switch, right
// before Columns, holds "Collapse all series" or "Expand all series" (TV
// library only, locked outside the title order); the table gets every series of the page as
// collapsed but the ones opened there, and the pager counts series.
test("the TV library switches to a page of collapsed series (rc.4 R2)", () => {
  const episode = (id, mediaId, series) => ({
    service: "sonarr",
    id,
    mediaId,
    series,
    season: 1,
    filename: series + id + ".mkv",
    title: "Episode " + id,
  });
  const files = [
    episode(1, 31, "Dark"),
    episode(2, 31, "Dark"),
    episode(3, 32, "Lost"),
  ];
  const switched = [];
  const results = {
    files,
    total: 3,
    displayTotal: 5,
    page: 1,
    pageSize: 2,
    pagedBy: "series",
    offset: 0,
  };
  const library = libraryState({ results, seriesView: true, pages: 3 });
  const { view } = libraryPage({
    library,
    navigation: {
      service: "sonarr",
      seriesView: true,
      seriesViewEntry: 0,
      setSeriesView: (on) => switched.push(on),
    },
    browser: { document: { activeElement: null } },
  });
  const render = () => {
    view.flush();
    return view.render();
  };
  const tableOf = (tree) => ofType(tree, "MediaTable")[0].props;
  let tree = render();
  const switchOf = (t) =>
    tools(t).find((n) => n.props?.["data-series-view"] !== undefined);
  const button = switchOf(tree);
  assert.equal(button.props["aria-label"], "Expand all series");
  const list = tools(tree);
  assert.equal(
    list[list.indexOf(button) + 1].type,
    "ColumnsMenu",
    "the switch stands right before Columns",
  );
  assert.equal(button.props.disabled, false);
  button.props.onClick();
  assert.deepEqual(switched, [false]);
  assert.deepEqual([...tableOf(tree).collapsed].sort(), [
    "sonarr/31",
    "sonarr/32",
  ]);
  assert.equal(
    text(card(tree).props.foot.props.summary),
    "1–2 of 5 series · by series and season",
  );
  // A chevron opens one series on the page; the others stay collapsed.
  tableOf(tree).toggleSeries("sonarr/32", "Lost", true);
  tree = render();
  assert.deepEqual([...tableOf(tree).collapsed], ["sonarr/31"]);
  // A new entry into the view starts it again, all collapsed.
  view.props = {
    ...view.props,
    navigation: { ...view.props.navigation, seriesViewEntry: 1 },
  };
  render();
  tree = render();
  assert.deepEqual([...tableOf(tree).collapsed].sort(), [
    "sonarr/31",
    "sonarr/32",
  ]);
  // The expanded view counts files; movies have no switch.
  const expanded = libraryPage({
    library: libraryState({ results: { ...results, pagedBy: undefined } }),
    navigation: { service: "sonarr", seriesView: false, seriesViewEntry: 0 },
    browser: { document: { activeElement: null } },
  }).tree;
  assert.equal(switchOf(expanded).props["aria-label"], "Collapse all series");
  assert.match(text(card(expanded).props.foot.props.summary), /of 5 files/);
  assert.equal(switchOf(libraryPage().tree), undefined);
});
