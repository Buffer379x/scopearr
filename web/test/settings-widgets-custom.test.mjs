import test from "node:test";
import assert from "node:assert/strict";
import {
  loadSource,
  nodes,
  PRESENTATION_MODULES,
  text,
} from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";
import { squash, src } from "./helpers/sources.mjs";
import { Fragment } from "preact";

// Settings → Widgets and Custom tags on the v2 blocks (Phase 5c, task 7,
// R3). Widgets: a v2-set-grid of the cards "Dashboard widgets" (the
// OrderList, Restore defaults in its head) and "Storage colors" (a v2
// table), then the card "Storage" with an inset card per library service.
// Custom tags: its own band (SettingsHeader, Save settings saves the
// colors) and the card "Tags", a TableCard with the creation in its head.
// The components run as real code with the hook runtime; the blocks they
// place are named stubs, so a tree shows what each one receives.

const t = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");
const f = () => {};
const tick = () => new Promise((resolve) => setImmediate(resolve));
const data = (value) => JSON.parse(JSON.stringify(value ?? null));
const classes = (node) => String(node?.props?.class ?? "").split(" ");
const byClass = (tree, name) =>
  nodes(tree).filter((n) => classes(n).includes(name));
const ofType = (tree, type) => nodes(tree).filter((n) => n.type === type);
const one = (tree, type) => {
  const found = ofType(tree, type);
  assert.equal(found.length, 1, "one " + String(type?.name ?? type));
  return found[0];
};
const kids = (node) =>
  []
    .concat(node?.props?.children ?? [])
    .flat(Infinity)
    .filter(Boolean)
    .flatMap((child) => (child.type === Fragment ? kids(child) : [child]));
const named = (tree, label) =>
  nodes(tree).filter((n) => n.props?.["aria-label"] === label);
const button = (tree, label) => {
  const found = nodes(tree).filter(
    (n) =>
      (n.type === "button" && n.props["aria-label"] === label) ||
      (n.type === "RowButton" && n.props.label === label),
  );
  assert.equal(found.length, 1, "one button " + label);
  return found[0];
};
const titleOf = (card) => text(ofType(card, "h2")[0] ?? ofType(card, "h3")[0]);
const settingsCards = (tree) =>
  nodes(tree).filter(
    (n) => n.type === "section" && classes(n).includes("v2-set-card"),
  );

let current = createHookRuntime();
const hooks = new Proxy(
  {},
  {
    get: (_, name) =>
      name === "useId" ? () => "settings-form" : current.hooks[name],
  },
);
function mount(component, props) {
  const runtime = createHookRuntime();
  const view = {
    runtime,
    props,
    render() {
      current = runtime;
      return runtime.settle(() => component(view.props));
    },
  };
  return view;
}

const themes = loadSource("themes.ts");
const model = loadSource("settings-model.ts", {
  modules: { "./themes": themes, "./event-log": loadSource("event-log.ts") },
});
const settingsBlocks = (i18n) => ({
  "./settings/Card": loadSource("components/settings/Card.tsx"),
  "./settings/Check": loadSource("components/settings/Check.tsx"),
  "./settings/Field": loadSource("components/settings/Field.tsx"),
  "../i18n": i18n,
});

// --- Widgets -----------------------------------------------------------------

const WIDGETS = {
  instances: [
    { id: "radarr", type: "radarr", name: "", enabled: true },
    { id: "sonarr-4k", type: "sonarr", name: "Series 4K", enabled: true },
    { id: "emby", type: "emby", name: "", enabled: true },
    { id: "radarr-old", type: "radarr", name: "Old", enabled: false },
  ],
  widgets: {
    order: ["codec", "resolution", "source", "audio", "language", "storage"],
    visible: ["codec", "resolution"],
    colors: { used: "#111111", free: "#222222" },
    storage: {
      radarr: [
        { path: "/mnt/b", sharedGroup: "", name: "Bee" },
        { path: "/mnt/a", sharedGroup: "pool", name: "Ay" },
      ],
    },
  },
};
const disk = (path, total, free) => ({
  path,
  label: path,
  totalSpace: total,
  freeSpace: free,
});
// The storage answer: the service reports /mnt/c first, then both chosen
// paths; the second service an error.
const STORAGE = {
  services: {
    radarr: {
      disks: [disk("/mnt/c", 3e12, 1e12), disk("/mnt/a", 2e12, 5e11)],
      error: "",
    },
    "sonarr-4k": { disks: [], error: "Could not read storage" },
  },
  areas: {},
};

function widgets({ settings = WIDGETS, demo = false } = {}) {
  const log = { changed: [], confirms: [], api: [] };
  let answer;
  const storage = new Promise((resolve) => (answer = resolve));
  const api = async (path, method = "GET", body) => {
    log.api.push([method, path, data(body)]);
    if (path === "storage") return storage;
    if (path === "storage/refresh") return structuredClone(STORAGE);
    throw new Error("unexpected " + path);
  };
  const { WidgetsSettings } = loadSource("components/WidgetsSettings.tsx", {
    modules: {
      "preact/hooks": hooks,
      "../api": { api },
      "../confirmation": {
        confirmReset: async (message) => (log.confirms.push(message), true),
      },
      "../dashboard-widgets": loadSource("dashboard-widgets.ts"),
      "../dashboard-model": { storageBytes: (n) => n / 1e12 + " TB" },
      "../instances": loadSource("instances.ts"),
      "../settings-model": model,
      "../ui": { ICON: { button: 16, label: 15 } },
      "./list/HelpTip": { HelpTip: "HelpTip" },
      "./settings/ColumnOrderEditor": { OrderList: "OrderList" },
      ...settingsBlocks({ t, useI18n: () => ({ locale: "en" }) }),
    },
    stubs: PRESENTATION_MODULES,
  });
  const state = { settings };
  const view = mount(WidgetsSettings, {
    get settings() {
      return state.settings;
    },
    changed: (next) => {
      state.settings = next;
      log.changed.push(data(next));
    },
    demo,
  });
  const w = {
    log,
    state,
    tree: view.render(),
    render: () => (w.tree = view.render()),
    async answer(value = STORAGE) {
      answer(structuredClone(value));
      await tick();
      return w.render();
    },
  };
  return w;
}

// The paths of an instance card, in order, with their size line.
const pathRows = (card) =>
  byClass(card, "v2-set-paths").flatMap((list) =>
    kids(list).map((item) => [
      text(ofType(item, "label")[0]),
      text(ofType(item, "small")[0]),
    ]),
  );

test("widgets keep order, visibility, storage colors and storage paths", async () => {
  const w = widgets();
  const [grid, storage] = kids(w.tree);
  // Dashboard widgets and Storage colors side by side, Storage below.
  assert.deepEqual(classes(grid), ["v2-set-grid"]);
  const [order, colors] = kids(grid);
  for (const card of [order, colors, storage])
    assert.deepEqual(classes(card), ["v2-card", "v2-set-card"]);
  assert.deepEqual([order, colors, storage].map(titleOf), [
    "Dashboard widgets",
    "Storage colors",
    "Storage",
  ]);
  assert.equal(order.props["aria-labelledby"], "dashboard-widgets-title");
  // No card head carries an icon (one pattern for the area, T6-M4).
  for (const card of settingsCards(w.tree))
    assert.equal(
      ofType(ofType(card, "h2")[0] ?? ofType(card, "h3")[0], "svg").length,
      0,
    );

  // The order list: order, visibility and the names of 1.7.0.
  const list = one(order, "OrderList").props;
  assert.deepEqual(list.order, WIDGETS.widgets.order);
  assert.deepEqual(list.visible, WIDGETS.widgets.visible);
  assert.equal(list.ariaPrefix, "Dashboard widgets");
  assert.equal(list.labels.resolution, "Resolution");
  assert.equal(list.labels.storage, "Storage");
  list.change(["resolution", "codec"], ["resolution"]);
  assert.deepEqual(w.log.changed.at(-1).widgets.order, ["resolution", "codec"]);
  assert.deepEqual(w.log.changed.at(-1).widgets.visible, ["resolution"]);
  assert.deepEqual(
    w.log.changed.at(-1).widgets.storage,
    WIDGETS.widgets.storage,
    "the rest of the widgets stays",
  );
  // Without a stored order the list shows the defaults.
  const fresh = widgets({
    settings: {
      ...WIDGETS,
      widgets: { ...WIDGETS.widgets, order: undefined, visible: undefined },
    },
  });
  const defaults = loadSource("dashboard-widgets.ts").dashboardOrder;
  assert.deepEqual(data(one(fresh.tree, "OrderList").props.order), [
    ...defaults,
  ]);
  assert.deepEqual(data(one(fresh.tree, "OrderList").props.visible), [
    ...defaults,
  ]);
  // Restore defaults in the head asks, then sets order and visibility.
  w.render();
  const restore = button(byClass(w.tree, "v2-set-head")[0], "Restore defaults");
  assert.ok(classes(restore).includes("v2-icon-btn"));
  assert.equal(restore.props.type, "button");
  assert.equal(restore.props.title, "Restore defaults");
  await restore.props.onClick();
  assert.equal(w.log.confirms.at(-1), "Restore defaults?");
  assert.deepEqual(w.log.changed.at(-1).widgets.order, [...defaults]);
  assert.deepEqual(w.log.changed.at(-1).widgets.visible, [...defaults]);

  // Storage colors: a v2 table of used and free space, each with its
  // swatch, color and Restore defaults with the question.
  w.render();
  const table = one(kids(w.tree)[0], "table");
  assert.deepEqual(classes(table), ["v2-table"]);
  assert.deepEqual(
    ofType(table, "th").map((th) => [text(th), th.props.scope]),
    [
      ["Tag preview", "col"],
      ["Color", "col"],
      ["Reset", "col"],
    ],
  );
  const rows = ofType(table, "tr").slice(1);
  assert.deepEqual(
    rows.map((row) => text(ofType(row, "td")[0])),
    ["Used space", "Free space"],
  );
  assert.equal(
    byClass(rows[0], "v2-dot")[0].props.style.background,
    "#111111",
    "the swatch shows the draft",
  );
  const used = one(rows[0], "input");
  assert.equal(used.props.type, "color");
  assert.ok(classes(used).includes("v2-color"));
  assert.equal(used.props["aria-label"], "Used space");
  assert.equal(used.props.value, "#111111");
  assert.equal(one(rows[1], "input").props["aria-label"], "Free space");
  used.props.onInput({ currentTarget: { value: "#abcdef" } });
  assert.deepEqual(w.log.changed.at(-1).widgets.colors, {
    used: "#abcdef",
    free: "#222222",
  });
  for (const [at, initial] of [
    [0, "#729acb"],
    [1, "#62b69d"],
  ]) {
    w.render();
    const reset = one(
      ofType(one(kids(w.tree)[0], "table"), "tr")[at + 1],
      "RowButton",
    );
    assert.equal(reset.props.label, "Restore defaults");
    await reset.props.onClick();
    assert.equal(w.log.confirms.at(-1), "Restore defaults?");
    assert.equal(
      w.log.changed.at(-1).widgets.colors[at ? "free" : "used"],
      initial,
    );
  }

  // Storage: its 1.7.0 description, then an inset card per enabled library
  // service (not the media servers), named by its h3.
  w.render();
  const card = kids(w.tree)[1];
  assert.equal(
    text(kids(card)[1]),
    "Select the filesystems included in the dashboard. Paths are reported by the service, not by Unraid share settings.",
  );
  const insets = settingsCards(card).filter((n) =>
    classes(n).includes("v2-card--inset"),
  );
  assert.deepEqual(
    insets.map((n) => [text(one(n, "h3")), n.props["aria-labelledby"]]),
    [
      ["Radarr", "storage-radarr-title"],
      ["Series 4K", "storage-sonarr-4k-title"],
    ],
  );
  await w.answer();
  const [radarr, sonarr] = settingsCards(kids(w.tree)[1]).filter((n) =>
    classes(n).includes("v2-card--inset"),
  );
  // Refresh storage in each head: it posts the service and turns its icon
  // while it runs; locked in the demo.
  const refresh = ofType(radarr, "button").find(
    (n) => text(n) === "Refresh storage",
  );
  assert.deepEqual(classes(refresh), ["v2-btn", "v2-btn--sm"]);
  assert.equal(refresh.props.disabled, false);
  const run = refresh.props.onClick();
  w.render();
  const spinning = ofType(kids(w.tree)[1], "button").find(
    (n) => text(n) === "Refresh storage",
  );
  assert.equal(spinning.props.disabled, true, "one refresh at a time");
  assert.ok(
    classes(byClass(spinning, "v2-btn-icon")[0].props.children).includes(
      "v2-spin",
    ),
  );
  await run;
  assert.deepEqual(w.log.api.at(-1), [
    "POST",
    "storage/refresh",
    { service: "radarr" },
  ]);
  const demo = widgets({ demo: true });
  for (const n of ofType(demo.tree, "button").filter(
    (b) => text(b) === "Refresh storage",
  ))
    assert.equal(n.props.disabled, true, "locked in the demo");
  // The error of a service as an error notice; without paths the 1.7.0
  // hint.
  assert.deepEqual(
    byClass(sonarr, "v2-notice").map((n) => [classes(n), text(n)]),
    [[["v2-notice", "v2-notice--error"], "Could not read storage"]],
  );
  assert.equal(
    text(ofType(sonarr, "p").at(-1)),
    "Refresh storage to load available paths.",
  );
  // Each path: its checkbox and its size or the unavailable line.
  assert.deepEqual(pathRows(radarr), [
    ["/mnt/b", "A selected storage path is unavailable"],
    ["/mnt/a", "2 TB total · 0.5 TB free"],
    ["/mnt/c", "3 TB total · 1 TB free"],
  ]);
  // A chosen path: Name, Shared storage and, while shared, its group with
  // the HelpTip of 1.7.0.
  const items = kids(byClass(radarr, "v2-set-paths")[0]);
  // The path's checkbox: the item's first label.
  const box = (item) => one(ofType(item, "label")[0], "input");
  assert.equal(box(items[0]).props.checked, true);
  assert.equal(box(items[2]).props.checked, false);
  assert.equal(byClass(items[2], "v2-form").length, 0);
  const fields = (item) =>
    byClass(item, "v2-field").map((field) => [
      text(one(field, "label")),
      one(field, "input").props.value,
    ]);
  assert.deepEqual(fields(items[0]), [["Name", "Bee"]]);
  assert.deepEqual(fields(items[1]), [
    ["Name", "Ay"],
    ["Shared storage group", "pool"],
  ]);
  const shared = (item) =>
    ofType(item, "label")
      .filter((n) => classes(n).includes("v2-ff-check"))
      .find((n) => text(n) === "Shared storage");
  assert.equal(one(shared(items[0]), "input").props.checked, false);
  assert.equal(one(shared(items[1]), "input").props.checked, true);
  const help = one(items[1], "HelpTip").props;
  assert.equal(help.label, "Shared storage group");
  assert.equal(
    help.text,
    "Use the same group name only for duplicate paths reporting the same filesystem capacity. Each selected area has its own chart; overlapping shares are not added.",
  );
  // Every field names its input (label for, the input's id).
  for (const field of byClass(radarr, "v2-field"))
    assert.equal(one(field, "label").props.for, one(field, "input").props.id);
  // The edits of 1.7.0: choose a path, rename, share, set the group.
  box(items[2]).props.onChange({ currentTarget: { checked: true } });
  assert.deepEqual(w.log.changed.at(-1).widgets.storage.radarr.at(-1), {
    path: "/mnt/c",
    sharedGroup: "",
    name: "/mnt/c",
  });
  w.render();
  let now = kids(byClass(kids(w.tree)[1], "v2-set-paths")[0]);
  one(byClass(now[0], "v2-field")[0], "input").props.onInput({
    currentTarget: { value: "Media" },
  });
  assert.deepEqual(
    w.log.changed
      .at(-1)
      .widgets.storage.radarr.find((d) => d.path === "/mnt/b"),
    { path: "/mnt/b", sharedGroup: "", name: "Media" },
  );
  w.render();
  now = kids(byClass(kids(w.tree)[1], "v2-set-paths")[0]);
  one(shared(now[0]), "input").props.onChange({
    currentTarget: { checked: true },
  });
  assert.equal(
    w.log.changed.at(-1).widgets.storage.radarr.find((d) => d.path === "/mnt/b")
      .sharedGroup,
    "shared",
  );
  w.render();
  now = kids(byClass(kids(w.tree)[1], "v2-set-paths")[0]);
  one(byClass(now[1], "v2-field")[1], "input").props.onChange({
    currentTarget: { value: "  " },
  });
  assert.equal(
    w.log.changed.at(-1).widgets.storage.radarr.find((d) => d.path === "/mnt/a")
      .sharedGroup,
    "shared",
    "an empty group falls back to shared",
  );
  // Unchecking drops the path from the draft.
  w.render();
  now = kids(byClass(kids(w.tree)[1], "v2-set-paths")[0]);
  box(now[1]).props.onChange({ currentTarget: { checked: false } });
  assert.equal(
    w.log.changed
      .at(-1)
      .widgets.storage.radarr.some((d) => d.path === "/mnt/a"),
    false,
  );
});

test("the storage card keeps its paths in place while it loads", async () => {
  // The pure order: what was shown keeps its place, new paths follow.
  assert.deepEqual([...model.keepOrder([], ["/b", "/a", "/b"])], ["/b", "/a"]);
  assert.deepEqual(
    [...model.keepOrder(["/b", "/a"], ["/c", "/a", "/b", "/d"])],
    ["/b", "/a", "/c", "/d"],
  );
  assert.deepEqual(
    [...model.keepOrder(["/b", "/a", "/c"], ["/c", "/b"])],
    ["/b", "/c"],
  );
  const w = widgets();
  // Before the answer: the chosen paths, in their stored order, with "—"
  // for their size; no hint, so the card does not swap content.
  const radarr = () =>
    settingsCards(kids(w.tree)[1]).filter((n) =>
      classes(n).includes("v2-card--inset"),
    )[0];
  assert.deepEqual(pathRows(radarr()), [
    ["/mnt/b", "—"],
    ["/mnt/a", "—"],
  ]);
  // After it: the same two first, the reported path after them.
  await w.answer();
  assert.deepEqual(
    pathRows(radarr()).map(([path]) => path),
    ["/mnt/b", "/mnt/a", "/mnt/c"],
  );
  // Choosing or dropping a path moves no row.
  const items = kids(byClass(radarr(), "v2-set-paths")[0]);
  one(ofType(items[2], "label")[0], "input").props.onChange({
    currentTarget: { checked: true },
  });
  w.render();
  one(
    ofType(kids(byClass(radarr(), "v2-set-paths")[0])[0], "label")[0],
    "input",
  ).props.onChange({ currentTarget: { checked: false } });
  w.render();
  assert.deepEqual(
    pathRows(radarr()).map(([path]) => path),
    ["/mnt/b", "/mnt/a", "/mnt/c"].filter((path) => path !== "/mnt/b"),
    "an unchosen path the service does not report leaves; the rest stay",
  );
  assert.deepEqual(
    kids(byClass(radarr(), "v2-set-paths")[0]).map((item) => item.key),
    ["/mnt/a", "/mnt/c"],
  );
});

test("the storage card keeps its rows steady around the answer", async () => {
  // Fix round 1 (I-1, M1–M3). Before the answer: a service without chosen
  // paths holds its hint invisible (the same line, no misleading text).
  const w = widgets();
  const insets = () =>
    settingsCards(kids(w.tree)[1]).filter((n) =>
      classes(n).includes("v2-card--inset"),
    );
  const pending = ofType(insets()[1], "p").at(-1);
  assert.equal(text(pending), "Refresh storage to load available paths.");
  assert.deepEqual(classes(pending), ["v2-set-wait"]);
  // The inset cards share a grid (two columns from 1120, as 1.7.0).
  const grids = byClass(kids(w.tree)[1], "v2-set-grid");
  assert.equal(grids.length, 1);
  assert.deepEqual(
    kids(grids[0]).map((n) => n.props["aria-labelledby"]),
    ["storage-radarr-title", "storage-sonarr-4k-title"],
  );
  // Unticking a chosen path before the answer keeps its row, unticked.
  one(
    ofType(kids(byClass(insets()[0], "v2-set-paths")[0])[1], "label")[0],
    "input",
  ).props.onChange({ currentTarget: { checked: false } });
  w.render();
  assert.deepEqual(
    kids(byClass(insets()[0], "v2-set-paths")[0]).map((item) => [
      item.key,
      one(ofType(item, "label")[0], "input").props.checked,
    ]),
    [
      ["/mnt/b", true],
      ["/mnt/a", false],
    ],
  );
  // After the answer: the hint is visible, and an error notice follows the
  // paths or the hint, so nothing above a shown row changes.
  await w.answer();
  const [radarr, sonarr] = insets();
  assert.deepEqual(classes(ofType(sonarr, "p").at(-1)), [""]);
  const order = (card) =>
    kids(card)
      .slice(1)
      .map((n) =>
        classes(n).includes("v2-notice")
          ? "notice"
          : classes(n).includes("v2-set-paths")
            ? "paths"
            : n.type,
      );
  assert.deepEqual(order(sonarr), ["p", "notice"]);
  assert.deepEqual(order(radarr), ["paths"]);
  assert.deepEqual(
    kids(byClass(radarr, "v2-set-paths")[0]).map((item) => item.key),
    ["/mnt/b", "/mnt/a", "/mnt/c"],
    "the unticked reported path keeps its place",
  );
  const failing = widgets();
  await failing.answer({
    ...STORAGE,
    services: {
      ...STORAGE.services,
      radarr: { ...STORAGE.services.radarr, error: "Down" },
    },
  });
  const first = settingsCards(kids(failing.tree)[1]).filter((n) =>
    classes(n).includes("v2-card--inset"),
  )[0];
  assert.deepEqual(order(first), ["paths", "notice"]);
  // M1: an edit keeps the stored entry in place; only a new path appends.
  failing.render();
  const rows = kids(
    byClass(
      settingsCards(kids(failing.tree)[1]).filter((n) =>
        classes(n).includes("v2-card--inset"),
      )[0],
      "v2-set-paths",
    )[0],
  );
  one(byClass(rows[0], "v2-field")[0], "input").props.onInput({
    currentTarget: { value: "Bee 2" },
  });
  assert.deepEqual(failing.log.changed.at(-1).widgets.storage.radarr, [
    { path: "/mnt/b", sharedGroup: "", name: "Bee 2" },
    { path: "/mnt/a", sharedGroup: "pool", name: "Ay" },
  ]);
});

// --- Custom tags -------------------------------------------------------------

const TAGS = [
  { id: 1, name: "Favorites", count: 0, manual: true },
  {
    id: 2,
    name: "Kids",
    displayName: "Children",
    count: 4,
    sources: ["radarr"],
  },
  {
    id: 3,
    name: "NoDE",
    count: 0,
    protected: true,
    rules: ["radarr · Rule A", "radarr · Rule B"],
  },
  { id: 4, name: "Rule", count: 0, localRule: true },
];
const CUSTOM_SETTINGS = {
  instances: [{ id: "radarr", type: "radarr", name: "", enabled: true }],
  tagColors: { "custom:1": "#ff0000" },
  tagTextColors: { "custom:1": "#000000" },
};

function custom({
  tags = TAGS,
  settings = CUSTOM_SETTINGS,
  colorsDirty = false,
  savingColors = false,
  failing = false,
} = {}) {
  const log = {
    api: [],
    notes: [],
    settings: [],
    dirty: [],
    confirms: [],
    changed: 0,
    saves: 0,
  };
  const api = async (path, method = "GET", body) => {
    log.api.push([method, path, data(body)]);
    if (failing) throw new Error("no");
    if (path === "custom-tags/batch")
      return body.tags.map((tag) =>
        tag.id === -1 ? { ...tag, id: 9, count: 0 } : tag,
      );
    throw new Error("unexpected " + path);
  };
  const { CustomTagsSettings } = loadSource(
    "components/CustomTagsSettings.tsx",
    {
      browser: { structuredClone },
      modules: {
        "preact/hooks": hooks,
        "../api": { api },
        "../color": { colorStyle: (bg, fg) => ({ bg, fg }) },
        "../confirmation": {
          confirmReset: async (message) => (log.confirms.push(message), true),
          confirmDeletion: async (message) => (
            log.confirms.push(message),
            true
          ),
        },
        "../instances": loadSource("instances.ts"),
        "../notifications": {
          notify: (message, kind) => log.notes.push([message, kind]),
        },
        "../ui": {
          ICON: { button: 16, label: 15, empty: 28 },
          HiddenTags: { Provider: "HiddenTags" },
          TagColors: { Provider: "TagColors" },
          TagTextColors: { Provider: "TagTextColors" },
          defaultColor: (kind, value) => "#def" + value,
        },
        "./AutoTagMark": { autoTagHint: (tag) => "auto: " + tag.name },
        "./list/HelpTip": { HelpTip: "HelpTip" },
        "./list/TableCard": { TableCard: "TableCard" },
        "./settings/SettingsHeader": { SettingsHeader: "SettingsHeader" },
        ...settingsBlocks({ t, useI18n: () => ({ locale: "en" }) }),
      },
      stubs: PRESENTATION_MODULES,
    },
  );
  const state = { settings };
  const view = mount(CustomTagsSettings, {
    tags,
    get settings() {
      return state.settings;
    },
    setSettings: (next) => {
      state.settings = next;
      log.settings.push(data(next));
    },
    saveColors: () => log.saves++,
    colorsDirty,
    savingColors,
    changed: async () => {
      log.changed++;
    },
    onDirty: (value) => log.dirty.push(value),
  });
  const c = {
    log,
    state,
    view,
    tree: view.render(),
    render: () => (c.tree = view.render()),
    get card() {
      return one(c.tree, "TableCard");
    },
    get bar() {
      return c.card.props.bar;
    },
    get rows() {
      return ofType(one(c.card, "table"), "tr").slice(1);
    },
  };
  return c;
}

test("custom tags keep create, rename, colors and protected deletes", async () => {
  const c = custom();
  // The card "Tags": a TableCard without chips and footer, its count, the
  // 1.7.0 hint and the creation in its head.
  const card = c.card.props;
  assert.equal(card.id, "custom-tags");
  assert.equal(card.title, "Tags");
  assert.equal(card.count, 4);
  assert.equal(card.countTitle, "Items in the list");
  assert.equal(card.busy, false);
  assert.equal(
    card.hint,
    "Names are saved when you press Enter or leave the field.",
  );
  assert.equal(card.regionLabel, "Custom tags");
  assert.equal(card.chips, undefined);
  assert.equal(card.foot, undefined);
  assert.deepEqual(classes(kids(c.tree)[1]), ["v2-set"]);
  // The head: Tag name, Add tag (locked while empty) and the help.
  assert.equal(c.bar.type, "form");
  assert.ok(classes(c.bar).includes("v2-filter-bar"));
  const field = () => named(c.bar, "Tag name")[0];
  const add = () => ofType(c.bar, "button").find((n) => text(n) === "Add tag");
  assert.equal(field().props.required, true);
  assert.equal(field().props.maxLength, 80);
  assert.equal(add().props.type, "submit");
  assert.equal(add().props.disabled, true);
  const help = one(c.bar, "HelpTip").props;
  assert.equal(help.label, "Custom tags help");
  assert.deepEqual(data(help.sections.map((s) => s.heading)), [
    "Management",
    "Count",
    "Name",
    "Colors",
    "Creating tags",
  ]);
  assert.equal(help.sections[0].raw, true);
  assert.match(help.sections[0].text, /^Manual · Created in Scopearr\./);
  assert.match(help.sections[0].text, /\n\nRadarr\/Sonarr Auto-Tag · /);
  // A duplicate name (any case) warns and sends nothing.
  field().props.onInput({ currentTarget: { value: " favorites " } });
  c.render();
  assert.equal(add().props.disabled, false);
  assert.equal(c.log.dirty.at(-1), true, "a typed name is unsaved");
  await c.bar.props.onSubmit({ preventDefault: f });
  assert.deepEqual(c.log.notes.at(-1), [
    "A custom tag with this name already exists",
    "warning",
  ]);
  assert.equal(c.log.api.length, 0);
  // A new name is saved with the 1.7.0 request; the field empties.
  field().props.onInput({ currentTarget: { value: "New" } });
  c.render();
  await c.bar.props.onSubmit({ preventDefault: f });
  await tick();
  c.render();
  assert.deepEqual(c.log.api.at(-1), [
    "PUT",
    "custom-tags/batch",
    { original: data(TAGS), tags: [...data(TAGS), { id: -1, name: "New" }] },
  ]);
  assert.deepEqual(c.log.notes.at(-1), ["Settings saved.", undefined]);
  assert.equal(c.log.changed, 1);
  assert.equal(field().props.value, "");
  assert.equal(c.log.dirty.at(-1), false);

  // The table: Name, Management, Count, Color, Text, Reset, Actions.
  const fresh = custom();
  const table = one(fresh.card, "table");
  assert.deepEqual(classes(table), ["v2-table"]);
  assert.deepEqual(
    ofType(table, "th").map((th) => [text(th), th.props.scope]),
    [
      ["Name", "col"],
      ["Management", "col"],
      ["Count", "col"],
      ["Color", "col"],
      ["Text", "col"],
      ["Reset", "col"],
      ["Actions", "col"],
    ],
  );
  // Every cell names its column for the card rows of a narrow card.
  for (const row of fresh.rows)
    assert.deepEqual(
      ofType(row, "td").map((td) => td.props["data-label"]),
      ["Name", "Management", "Count", "Color", "Text", "Reset", "Actions"],
    );
  // The previews take the draft colors and show hidden values too.
  const colors = one(fresh.card, "TagColors").props.value;
  assert.deepEqual(data(colors), CUSTOM_SETTINGS.tagColors);
  assert.deepEqual(
    data(one(fresh.card, "TagTextColors").props.value),
    CUSTOM_SETTINGS.tagTextColors,
  );
  assert.deepEqual(data(one(fresh.card, "HiddenTags").props.value), {});
  const [favorites, kids2, protectedTag, rule] = fresh.rows;
  const preview = one(favorites, "CustomTag").props;
  assert.equal(preview.tag.id, 1);
  assert.equal(preview.settings, fresh.state.settings);
  // Management as in 1.7.0: the auto tag's services, else the kind.
  assert.deepEqual(
    fresh.rows.map((row) => text(ofType(row, "td")[1])),
    ["Manual", "Shared", "Radarr Auto-Tag", "Scopearr rule"],
  );
  assert.equal(
    ofType(ofType(protectedTag, "td")[1], "span")[0].props.title,
    "auto: NoDE",
  );
  assert.deepEqual(
    fresh.rows.map((row) => text(ofType(row, "td")[2])),
    ["0", "4", "0", "0"],
  );
  // Rename: the field "Tag name: {name}" shows the display name; Enter
  // leaves it, leaving saves it once with the display name.
  const nameField = (row) => named(row, "Tag name: Kids")[0] ?? row;
  const input = nameField(kids2);
  assert.equal(input.props.value, "Children");
  assert.equal(input.props.maxLength, 80);
  input.props.onInput({ currentTarget: { value: "Little ones" } });
  fresh.render();
  assert.equal(fresh.log.dirty.at(-1), true, "a renamed tag is unsaved");
  let blurred = false,
    prevented = false;
  named(fresh.rows[1], "Tag name: Kids")[0].props.onKeyDown({
    key: "Enter",
    preventDefault: () => (prevented = true),
    currentTarget: { blur: () => (blurred = true) },
  });
  assert.ok(prevented && blurred, "Enter leaves the field");
  await named(fresh.rows[1], "Tag name: Kids")[0].props.onBlur({
    currentTarget: { value: "Little ones" },
  });
  assert.deepEqual(fresh.log.api.at(-1)[2].tags[1], {
    ...TAGS[1],
    displayName: "Little ones",
  });
  // Colors: the color, the text cycle and Reset with its question.
  fresh.render();
  const swatch = named(fresh.rows[0], "Color for Favorites")[0];
  assert.equal(swatch.props.type, "color");
  assert.ok(classes(swatch).includes("v2-color"));
  assert.equal(swatch.props.value, "#ff0000");
  assert.equal(
    named(fresh.rows[1], "Color for Kids")[0].props.value,
    "#def2",
    "the default color without an override",
  );
  swatch.props.onInput({ currentTarget: { value: "#00ff00" } });
  assert.equal(fresh.log.settings.at(-1).tagColors["custom:1"], "#00ff00");
  const textButton = (row) =>
    ofType(row, "RowButton").find((n) =>
      n.props.label.startsWith("Text color for "),
    );
  for (const [stored, shown, next] of [
    ["#000000", "Black", "#ffffff"],
    ["#ffffff", "White", undefined],
    [undefined, "Automatic", "#000000"],
  ]) {
    const tags = { ...CUSTOM_SETTINGS.tagTextColors };
    if (stored) tags["custom:1"] = stored;
    else delete tags["custom:1"];
    fresh.state.settings = { ...CUSTOM_SETTINGS, tagTextColors: tags };
    fresh.render();
    const cycle = textButton(fresh.rows[0]);
    assert.equal(cycle.props.label, "Text color for Favorites: " + shown);
    assert.equal(cycle.props.title, shown);
    cycle.props.onClick();
    assert.equal(fresh.log.settings.at(-1).tagTextColors["custom:1"], next);
  }
  fresh.state.settings = CUSTOM_SETTINGS;
  fresh.render();
  const reset = button(fresh.rows[0], "Default color for Favorites");
  assert.equal(reset.props.disabled, false);
  assert.equal(
    button(fresh.rows[1], "Default color for Kids").props.disabled,
    true,
    "locked without an override",
  );
  await reset.props.onClick();
  assert.equal(
    fresh.log.confirms.at(-1),
    "Reset background and text colors for Favorites?",
  );
  assert.equal(fresh.log.settings.at(-1).tagColors["custom:1"], undefined);
  assert.equal(fresh.log.settings.at(-1).tagTextColors["custom:1"], undefined);
  // Delete: a danger row button, locked with entries or protected (the
  // auto tag's explanation as its title), with the 1.7.0 question.
  fresh.render();
  const del = (row, name) => button(row, "Delete tag: " + name);
  assert.equal(del(fresh.rows[0], "Favorites").props.tone, "danger");
  assert.equal(del(fresh.rows[0], "Favorites").props.disabled, false);
  assert.equal(del(fresh.rows[1], "Kids").props.disabled, true);
  assert.equal(del(fresh.rows[2], "NoDE").props.disabled, true);
  assert.equal(del(fresh.rows[2], "NoDE").props.title, "auto: NoDE");
  assert.equal(del(fresh.rows[3], "Rule").props.disabled, false);
  await del(fresh.rows[3], "Rule").props.onClick();
  assert.equal(
    fresh.log.confirms.at(-1),
    "Delete Rule, its assignments and matching filename rules?",
  );
  assert.deepEqual(
    fresh.log.api.at(-1)[2].tags.map((tag) => tag.id),
    [1, 2, 3],
  );
  // Empty: the 1.7.0 text as the list's empty state, no table.
  const empty = custom({ tags: [] });
  assert.equal(ofType(empty.card, "table").length, 0);
  assert.equal(one(empty.card, "ListEmpty").props.title, "No custom tags yet.");
  // While a request runs, every edit and the creation are locked.
  const busy = custom();
  named(busy.bar, "Tag name")[0].props.onInput({
    currentTarget: { value: "Late" },
  });
  busy.render();
  const sending = busy.bar.props.onSubmit({ preventDefault: f });
  busy.render();
  assert.equal(busy.card.props.busy, true);
  assert.equal(named(busy.bar, "Tag name")[0].props.disabled, true);
  assert.equal(
    button(busy.rows[0], "Delete tag: Favorites").props.disabled,
    true,
  );
  await sending;
});

test("custom tags put the band save on their colors", async () => {
  // Their own band: one SettingsHeader, Save settings runs saveColors,
  // locked without unsaved colors and while saving.
  for (const [colorsDirty, savingColors] of [
    [false, false],
    [true, false],
    [true, true],
  ]) {
    const c = custom({ colorsDirty, savingColors });
    const header = one(c.tree, "SettingsHeader").props;
    assert.equal(header.section, "custom");
    assert.equal(header.segment, undefined);
    assert.equal(header.save.form, undefined, "no form: the area's action");
    assert.equal(header.save.disabled, !colorsDirty);
    assert.equal(header.save.dirty, colorsDirty);
    assert.equal(header.save.busy, savingColors);
    header.save.action();
    assert.equal(c.log.saves, 1);
  }
  // Its own guard reports as in 1.7.0: a typed name or a draft rename is
  // unsaved; leaving the area reports clean.
  const c = custom();
  c.render();
  assert.equal(c.log.dirty.at(-1), false);
  named(c.bar, "Tag name")[0].props.onInput({ currentTarget: { value: "x" } });
  c.render();
  assert.equal(c.log.dirty.at(-1), true);
  c.view.runtime.unmount();
  assert.equal(c.log.dirty.at(-1), false);

  // SettingsPage hands it the draft's save, dirty and busy and renders no
  // header of its own for Custom tags.
  const p = page({ section: "custom", dirty: true, busy: true });
  const tags = one(p.tree, "CustomTagsSettings").props;
  assert.equal(tags.colorsDirty, true);
  assert.equal(tags.savingColors, true);
  assert.equal(tags.settings, p.draft.cfg);
  assert.equal(tags.onDirty, p.draft.setCustomDirty);
  tags.saveColors();
  assert.deepEqual(p.log, [["save", p.draft.cfg]]);
  assert.equal(ofType(p.tree, "SettingsHeader").length, 0);
  assert.equal(ofType(p.tree, "PageHeader").length, 0);
  assert.equal(ofType(p.tree, "SettingsSectionHeading").length, 0);
  assert.equal(settingsForm(p.tree).props.hidden, true);
});

// --- SettingsPage ------------------------------------------------------------

const settingsForm = (tree) =>
  ofType(tree, "form").find((form) => form.props.id === "settings-form");

// SettingsPage with a fake draft: what it renders per area.
function page({ section, dirty = false, busy = false, demo = true }) {
  const log = [];
  const draft = {
    cfg: { instances: [], tagColors: {}, tagTextColors: {}, hiddenTags: {} },
    setCfg: f,
    draftLocale: "en",
    setDraftLocale: f,
    draftPrefs: { density: "comfortable", stacked: false },
    setDraftPrefs: f,
    savedPrefs: { density: "comfortable", stacked: false },
    look: {},
    setLook: f,
    mode: "dark",
    dirty,
    setRulesDirty: f,
    setCustomDirty: f,
    busy,
    confirmSectionChange: async () => true,
    saveSettings: async (next) => log.push(["save", next]),
    submit: f,
    confirmTags: f,
    tagChanges: null,
    setTagChanges: f,
    tagSaveReview: null,
    setTagSaveReview: f,
  };
  const i18n = { t, useI18n: () => ({ locale: "en" }) };
  const { SettingsPage } = loadSource("components/SettingsPage.tsx", {
    browser: {
      window: { addEventListener: f, removeEventListener: f },
      AbortController,
    },
    modules: {
      "preact/hooks": hooks,
      "preact/compat": { lazy: () => "RecognitionPage", Suspense: "Suspense" },
      "./SettingsSectionHeading": {
        SettingsSectionHeading: "SettingsSectionHeading",
      },
      "../ui": { colorFields: ["resolution"] },
      "../instances": loadSource("instances.ts"),
      "../i18n": i18n,
      "../notifications": { notify: f },
      "./AppearanceSettings": {
        AppearanceSettings: "AppearanceSettings",
        useDisplayTab: () => ["general", f],
      },
      "./ConnectionSettings": { ConnectionSettings: "ConnectionSettings" },
      "./CustomTagsSettings": { CustomTagsSettings: "CustomTagsSettings" },
      "./SystemSettings": {
        SystemSettingsInfo: "SystemSettingsInfo",
        SystemSettingsLog: "SystemSettingsLog",
        useSystemTab: () => ["info", f],
      },
      "./settings/SettingsHeader": { SettingsHeader: "SettingsHeader" },
      "./TagPolicyDialog": { TagPolicyDialog: "TagPolicyDialog" },
      "./TagReview": { TagReview: "TagReview" },
      "./WidgetsSettings": { WidgetsSettings: "WidgetsSettings" },
      "./settings/TagColorsCard": { TagColorsCard: "TagColorsCard" },
      "./settings/WarningColorsCard": {
        WarningColorsCard: "WarningColorsCard",
      },
      "../api": { api: async () => [] },
      "../hooks/useSettingsDraft": { useSettingsDraft: () => draft },
      // The rules chunk loader (Tag rules only; not opened here).
      "../hooks/useLazyChunk": {
        lazyChunk: () => ({}),
        useLazyChunk: () => null,
      },
      "../appearance": {
        setBandPreference: f,
        setTheme: f,
        storedBand: () => null,
      },
      "../settings-model": model,
    },
    stubs: PRESENTATION_MODULES,
  });
  const view = mount(SettingsPage, {
    customTags: [],
    customChanged: async () => [],
    settings: draft.cfg,
    status: { recognitionRevision: 0, cacheRevision: 0, sync: {} },
    summary: {},
    demo,
    saved: async () => {},
    onDirty: f,
    refresh: async () => {},
    section,
    registerSectionGuard: f,
    tab: "",
    setTab: f,
    logQuery: "",
    setLogQuery: f,
    revision: 0,
    theme: "dark",
    onTheme: f,
  });
  return { log, draft, tree: view.render() };
}

test("widgets and custom tags drop the transition sheet", () => {
  const { sheetPage } = loadSource("nav-model.ts", {
    modules: {
      "./frame-status": {},
      "./instances": loadSource("instances.ts"),
      "./router": { SETTINGS_SECTIONS: [] },
      "./tool-route": { TOOLS: {} },
    },
  });
  const route = (section) => ({
    view: "settings",
    section,
    tab: "",
    query: "",
  });
  // Tag rules left it in task 8 (settings-rules.test.mjs).
  for (const section of [
    "connections",
    "appearance",
    "widgets",
    "custom",
    "recognition",
  ])
    assert.equal(sheetPage(route(section)), false, section);
  // System left it in task 9 (settings-system.test.mjs).
  for (const section of ["system"])
    assert.equal(sheetPage(route(section)), false, section);

  // Widgets: the band's SettingsHeader with Save settings for the form, the
  // form its v2-set with the demo notice first, then the widget cards; no
  // 1.7.0 heading, no wrapper of its own.
  const widgetsPage = page({ section: "widgets", dirty: true });
  const header = one(widgetsPage.tree, "SettingsHeader").props;
  assert.equal(header.section, "widgets");
  assert.equal(header.segment, undefined);
  assert.deepEqual(data(header.save), {
    form: "settings-form",
    busy: false,
    disabled: false,
    dirty: true,
  });
  assert.equal(ofType(widgetsPage.tree, "PageHeader").length, 0);
  assert.equal(ofType(widgetsPage.tree, "SettingsSectionHeading").length, 0);
  const form = settingsForm(widgetsPage.tree);
  assert.deepEqual(classes(form), ["v2-set"]);
  assert.equal(form.props.hidden, false);
  const [notice, cards] = kids(form);
  assert.deepEqual(classes(notice), ["v2-notice"]);
  assert.equal(cards.type, "WidgetsSettings");
  assert.equal(cards.props.settings, widgetsPage.draft.cfg);
  assert.equal(cards.props.demo, true);
  assert.equal(byClass(form, "settings-section").length, 0);
  // Elsewhere the widget cards are not mounted (their storage read).
  assert.equal(
    ofType(page({ section: "appearance" }).tree, "WidgetsSettings").length,
    0,
  );
  // System has its band's header since task 9: its segment, no Save
  // settings, no 1.7.0 heading.
  const system = page({ section: "system" });
  assert.equal(one(system.tree, "SettingsHeader").props.section, "system");
  assert.equal(
    one(system.tree, "SettingsHeader").props.segment.label,
    "System sections",
  );
  assert.equal(one(system.tree, "SettingsHeader").props.save, undefined);
  assert.equal(byClass(system.tree, "notice").length, 0);
  assert.equal(byClass(system.tree, "v2-notice").length, 0);
  // The sources: no 1.7.0 parts left in the two areas.
  const code = squash(
    src("components/WidgetsSettings.tsx") +
      src("components/CustomTagsSettings.tsx"),
  );
  assert.doesNotMatch(
    code,
    /OrderedList|HelpPopover|SettingsSectionHeading|CardHeading|class="(?:connection|settings-card|editor-table|icon-button|button|check-field|quiet)"/,
  );
});
