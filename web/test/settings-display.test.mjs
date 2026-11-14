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
import { Fragment, h } from "preact";

// Settings → Display on the v2 blocks (Phase 5c, task 6): the band with the
// segment "Display sections" and Save settings, the card "Interface theme"
// (mode, band, palettes and their preview), the general cards, Lists &
// columns with the column editor and its preview, and the two color cards.
// Mode and band are drafts until Save settings (ruling P1). The components
// run as real code with the hook runtime; the blocks they place are named
// stubs, so a tree shows what each one receives. SettingsPage runs with
// the real useSettingsDraft, list preferences and appearance.ts over a
// fake browser.

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
// A node's children, fragments opened.
const kids = (node) =>
  []
    .concat(node?.props?.children ?? [])
    .flat(Infinity)
    .filter(Boolean)
    .flatMap((child) => (child.type === Fragment ? kids(child) : [child]));
const settingsForm = (tree) =>
  ofType(tree, "form").find((form) => form.props.id === "settings-form");
const titleOf = (card) => text(ofType(card, "h2")[0] ?? ofType(card, "h3")[0]);

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
      const tree = runtime.settle(() => component(view.props));
      return tree;
    },
  };
  return view;
}

const themes = loadSource("themes.ts");
const model = loadSource("settings-model.ts", {
  modules: { "./themes": themes, "./event-log": loadSource("event-log.ts") },
});
const COMFORTABLE = { density: "comfortable", stacked: false };
const SETTINGS = {
  pageSize: 25,
  seasonMode: "matches",
  interfaceTheme: "default",
  groupSD: true,
  groupSDLists: false,
  listInfoOrder: ["link", "mux"],
  listInfoVisible: ["link"],
  columnOrder: { radarr: ["title", "year"], sonarr: ["title", "year"] },
  visibleColumns: { radarr: ["title"], sonarr: ["title", "year"] },
  tagColors: {},
  tagTextColors: {},
  hiddenTags: {},
  warningColors: { metadata: "#d9a870", recognition: "#b994f0" },
  instances: [],
};

// --- AppearanceSettings ------------------------------------------------------

function display({
  tab = "general",
  cfg = SETTINGS,
  saved = cfg,
  mode = "dark",
  band = null,
  draftPrefs = COMFORTABLE,
  hidden = false,
  session = {},
} = {}) {
  const log = { cfg: [], prefs: [], looks: [], session: [], confirms: [] };
  const { AppearanceSettings, useDisplayTab } = loadSource(
    "components/AppearanceSettings.tsx",
    {
      modules: {
        "preact/hooks": hooks,
        "../ui": {
          ICON: { button: 16, label: 15 },
          columnLabels: { title: "Title", year: "Year" },
          defaultColumnOrder: ["title", "year"],
          defaultColumns: ["title", "year"],
        },
        "../placement": loadSource("placement.ts"),
        "../filecheck": loadSource("filecheck.ts"),
        "../i18n": {
          t,
          useI18n: () => ({ locale: "en" }),
          catalogs: [
            { locale: "de", name: "Deutsch" },
            { locale: "en", name: "English" },
          ],
        },
        "../browser-storage": {
          readSessionPreference: (key) => session[key] ?? null,
          writeSessionPreference: (key, value) =>
            log.session.push([key, value]),
        },
        "../confirmation": {
          confirmReset: async (message) => (log.confirms.push(message), true),
        },
        "../settings-model": model,
        "./list/Segmented": { Segmented: "Segmented" },
        "./settings/ModeBandCard": { ModeBandCard: "ModeBandCard" },
        "./settings/PalettePicker": { PalettePicker: "PalettePicker" },
        "./settings/ColumnOrderEditor": {
          ColumnOrderEditor: "ColumnOrderEditor",
        },
        "./settings/Card": loadSource("components/settings/Card.tsx"),
        "./settings/Field": loadSource("components/settings/Field.tsx"),
        "./settings/Check": loadSource("components/settings/Check.tsx"),
        "./ListLayoutSettings": {
          ListLayoutSettings: "ListLayoutSettings",
          infoLabels: { link: "Link", mux: "Mux" },
        },
      },
      stubs: PRESENTATION_MODULES,
    },
  );
  const state = { cfg };
  const view = mount(AppearanceSettings, {
    get cfg() {
      return state.cfg;
    },
    saved,
    setCfg: (next) => {
      state.cfg = typeof next === "function" ? next(state.cfg) : next;
      log.cfg.push(data(state.cfg));
    },
    draftLocale: "en",
    setDraftLocale: (locale) => log.prefs.push(locale),
    draftPrefs,
    setDraftPrefs: (prefs) => log.prefs.push(data(prefs)),
    hidden,
    colors: "COLORS",
    tab,
    mode,
    band,
    changeLook: (next) => log.looks.push(data(next)),
  });
  return { view, log, state, useDisplayTab, tree: view.render() };
}

const cardsOf = (tree) =>
  nodes(tree).filter(
    (n) =>
      n.type === "section" &&
      classes(n).includes("v2-card") &&
      classes(n).includes("v2-set-card"),
  );

test("display builds the band segment, the theme card and the general cards", async () => {
  const { tree } = display();
  // The panel of the band's segment: a v2-set column.
  assert.equal(tree.type, "div");
  assert.deepEqual(classes(tree), ["v2-set"]);
  assert.equal(tree.props.role, "tabpanel");
  assert.equal(tree.props.id, "display-panel-general");
  assert.equal(tree.props["aria-labelledby"], "display-tab-general");
  assert.equal(tree.props.hidden, false);
  // The theme card first and full width, then the grid of the other cards.
  const [theme, grid] = kids(tree);
  assert.equal(theme.type, "section");
  assert.equal(theme.props["aria-labelledby"], "interface-theme-title");
  assert.equal(titleOf(theme), "Interface theme");
  assert.equal(one(theme, "h2").props.id, "interface-theme-title");
  assert.equal(
    text(byClass(theme, "v2-set-head")[0]),
    "Interface theme" +
      "Applied after saving. Every theme supports dark and light mode; layout and tag colors stay unchanged.",
  );
  const [left, right] = kids(byClass(theme, "v2-set-theme")[0]);
  assert.deepEqual(
    kids(left).map((n) => n.type),
    ["ModeBandCard", "PalettePicker"],
  );
  assert.equal(text(kids(right)[0]), "Preview");
  assert.equal(kids(right)[1].type, "PalettePreview");
  assert.deepEqual(classes(grid), ["v2-set-grid"]);
  assert.deepEqual(cardsOf(grid).map(titleOf), [
    "Interface language",
    "TV view",
    "Pagination",
    "Row density",
    "Resolution groups",
  ]);
  // Every card is a section named by its title.
  for (const card of cardsOf(tree)) {
    const id = card.props["aria-labelledby"];
    assert.ok(id, titleOf(card));
    assert.equal(ofType(card, "h2")[0].props.id, id);
  }
  const [language, tv, pages, , groups] = cardsOf(grid);
  const languageSelect = one(language, "select");
  assert.equal(languageSelect.props.class, "v2-select");
  assert.equal(languageSelect.props["aria-label"], "Interface language");
  assert.deepEqual(
    data(ofType(languageSelect, "option").map((o) => [o.props.value, text(o)])),
    [
      ["de", "Deutsch"],
      ["en", "English"],
    ],
  );
  assert.equal(
    text(one(language, "small")),
    "Applied after saving in this browser. Media names and filter values stay unchanged.",
  );
  assert.equal(
    languageSelect.props["aria-describedby"],
    one(language, "small").props.id,
  );
  // TV view keeps its icon and its field; Pagination its number field.
  assert.equal(text(one(tv, "label")), "Results with active filters");
  assert.equal(one(tv, "select").props.class, "v2-select");
  const entries = one(pages, "input");
  assert.equal(text(one(pages, "label")), "Entries per page");
  assert.equal(one(pages, "label").props.for, entries.props.id);
  assert.deepEqual(
    [
      entries.props.type,
      entries.props.min,
      entries.props.max,
      entries.props.required,
    ],
    ["number", "1", "1000", true],
  );
  assert.equal(entries.props.class, "v2-input");
  assert.equal(entries.props.value, 25);
  // Resolution groups: two checkboxes, the second depends on the first.
  const boxes = ofType(groups, "input");
  assert.deepEqual(
    byClass(groups, "v2-ff-check").map((label) => text(label)),
    [
      "Group resolutions below 720p as SD on the dashboard",
      "Also group SD in library lists and resolution filters",
    ],
  );
  assert.deepEqual(
    boxes.map((box) => [box.props.checked, box.props.disabled]),
    [
      [true, false],
      [false, false],
    ],
  );
  const view = display({
    cfg: { ...SETTINGS, groupSD: false, groupSDLists: false },
  });
  const off = ofType(cardsOf(view.tree)[5], "input");
  assert.equal(off[1].props.disabled, true);
  off[0].props.onChange({ currentTarget: { checked: true } });
  assert.deepEqual(
    [view.log.cfg.at(-1).groupSD, view.log.cfg.at(-1).groupSDLists],
    [true, false],
  );
  // The band: SettingsPage renders the one SettingsHeader with the segment.
  const p = await page();
  const head = one(p.tree, "SettingsHeader").props;
  assert.equal(head.section, "appearance");
  assert.deepEqual(data(head.save), {
    form: "settings-form",
    busy: false,
    disabled: true,
    dirty: false,
  });
  assert.deepEqual(data({ ...head.segment, select: undefined }), {
    label: "Display sections",
    idPrefix: "display",
    value: "general",
    items: [
      { value: "general", label: "General", dirty: false },
      { value: "lists", label: "Lists & columns", dirty: false },
      { value: "colors", label: "Colors", dirty: false },
    ],
  });
  assert.equal(ofType(p.tree, "PageHeader").length, 0);
  assert.equal(ofType(p.tree, "SettingsSectionHeading").length, 0);
  const form = settingsForm(p.tree);
  assert.equal(form.props.class, "v2-set");
  head.segment.select("lists");
  assert.deepEqual(p.tabs, ["lists"]);
  // The tab follows the route, else the session key, else General.
  const tabOf = (route, session) => {
    const { useDisplayTab: use } = display({ session });
    current = createHookRuntime();
    return current.render(() => use(route, f))[0];
  };
  assert.equal(tabOf("", {}), "general");
  assert.equal(tabOf("", { "scopearr-display-tab": "colors" }), "colors");
  assert.equal(tabOf("lists", { "scopearr-display-tab": "colors" }), "lists");
  assert.equal(tabOf("nope", { "scopearr-display-tab": "x" }), "general");
});

// --- SettingsPage with the real draft ------------------------------------------

async function page({
  section = "appearance",
  theme = "dark",
  stored = {},
  settings = SETTINGS,
} = {}) {
  const log = [],
    values = new Map(Object.entries(stored)),
    listeners = new Map(),
    confirms = [],
    answers = [],
    dirty = [],
    tabs = [];
  const state = { failing: false, hold: null };
  const window = {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent() {
      return true;
    },
  };
  const localStorage = {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem(key, value) {
      log.push("set " + key + "=" + value);
      values.set(key, String(value));
    },
    removeItem(key) {
      log.push("remove " + key);
      values.delete(key);
    },
  };
  const attributes = { "data-theme": theme };
  const root = {
    setAttribute(name, value) {
      attributes[name] = value;
    },
    getAttribute: (name) => attributes[name] ?? null,
  };
  const storage = loadSource("browser-storage.ts", {
    browser: { localStorage },
  });
  const appearance = loadSource("appearance.ts", {
    modules: { "./browser-storage": storage },
  });
  const listPrefs = loadSource("list-prefs.ts", {
    modules: { "./browser-storage": storage },
    browser: { window, Event },
  });
  const api = async (path, method = "GET", body) => {
    if (path === "tag-catalog") return [];
    log.push(method + " " + path);
    if (method === "PUT") {
      if (state.hold) await state.hold;
      if (state.failing) throw new Error("Could not save settings");
      return {};
    }
    return structuredClone(settings);
  };
  const i18n = {
    t,
    useI18n: () => ({ locale: "en", setLocale: async () => {} }),
  };
  const { useSettingsDraft } = loadSource("hooks/useSettingsDraft.ts", {
    browser: { window, structuredClone },
    modules: {
      "preact/hooks": hooks,
      "../api": { api },
      "../confirmation": {
        confirmDiscard: async (message) => {
          confirms.push(message);
          assert.ok(answers.length, "unexpected confirmation: " + message);
          return answers.shift();
        },
      },
      "../i18n": i18n,
      "../instances": loadSource("instances.ts"),
      "../list-prefs": listPrefs,
      "../notifications": { notify: (message) => log.push(message) },
      "../settings-payload": loadSource("settings-payload.ts"),
      "../tag-policy": loadSource("tag-policy.ts"),
      "./useListPrefs": loadSource("hooks/useListPrefs.ts", {
        modules: { "preact/hooks": hooks, "../list-prefs": listPrefs },
        browser: { window },
      }),
    },
  });
  const { useDisplayTab } = display();
  const guards = [];
  const { SettingsPage } = loadSource("components/SettingsPage.tsx", {
    browser: { window, document: { documentElement: root }, AbortController },
    modules: {
      "preact/hooks": hooks,
      "preact/compat": { lazy: () => "RecognitionPage", Suspense: "Suspense" },
      "./SettingsSectionHeading": {
        SettingsSectionHeading: "SettingsSectionHeading",
      },
      "../ui": { colorFields: ["resolution"] },
      "../instances": loadSource("instances.ts"),
      "../i18n": i18n,
      "../notifications": { notify: (message) => log.push(message) },
      "./AppearanceSettings": {
        AppearanceSettings: "AppearanceSettings",
        useDisplayTab,
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
      "../api": { api },
      "../hooks/useSettingsDraft": { useSettingsDraft },
      // The rules chunk loader (Tag rules only; not opened here).
      "../hooks/useLazyChunk": {
        lazyChunk: () => ({}),
        useLazyChunk: () => null,
      },
      "../appearance": appearance,
      "../settings-model": model,
    },
    stubs: PRESENTATION_MODULES,
  });
  const props = {
    customTags: [],
    customChanged: async () => [],
    settings,
    status: { recognitionRevision: 0, cacheRevision: 0, sync: {} },
    summary: {},
    demo: false,
    saved: async () => log.push("saved"),
    onDirty: (value) => dirty.push(value),
    refresh: async () => {},
    section,
    registerSectionGuard: (guard) => guard && guards.push(guard),
    tab: "",
    setTab: (tab) => tabs.push(tab),
    logQuery: "",
    setLogQuery: f,
    revision: 0,
    theme,
    // AppShell's shown mode follows, as setShownTheme does.
    onTheme: (mode) => {
      log.push("onTheme " + mode);
      props.theme = mode;
    },
  };
  const view = mount(SettingsPage, props);
  const p = {
    props,
    log,
    values,
    attributes,
    confirms,
    answers,
    dirty,
    tabs,
    state,
    tree: view.render(),
    render() {
      p.tree = view.render();
      return p.tree;
    },
    get look() {
      const shown = one(p.tree, "AppearanceSettings").props;
      return { mode: shown.mode, band: shown.band };
    },
    get general() {
      return one(p.tree, "SettingsHeader").props.segment.items[0].dirty;
    },
    get saveLocked() {
      return one(p.tree, "SettingsHeader").props.save.disabled;
    },
    async change(next) {
      one(p.tree, "AppearanceSettings").props.changeLook(next);
      p.render();
    },
    async save() {
      await settingsForm(p.tree).props.onSubmit({ preventDefault: f });
      await tick();
      p.render();
    },
    leaveIsBlocked() {
      let prevented = false;
      const event = {
        returnValue: undefined,
        preventDefault() {
          prevented = true;
        },
      };
      for (const listener of listeners.get("beforeunload") || [])
        listener(event);
      return prevented && event.returnValue === "";
    },
    // The section guard of the draft, as the frame's links ask it.
    guard: (next) => guards.at(-1)(next),
  };
  await tick();
  p.render();
  return p;
}

test("a field named by its card and a field of checkboxes use the field helper", () => {
  // T6-M1: the helper has an aria-label mode (no visible label, the control
  // named like its card) and a group mode (checkboxes and a hint, no single
  // control); Display uses them instead of hand-written div.v2-field.
  const { field, fieldGroup } = loadSource("components/settings/Field.tsx");
  const named = field(
    "row-density",
    "Row density",
    (a) => h("select", { class: "v2-select", ...a }),
    { hint: "Compact rows", aria: true },
  );
  assert.equal(named.props.class, "v2-field");
  assert.deepEqual(
    kids(named).map((n) => n.type),
    ["select", "small"],
  );
  const select = kids(named)[0];
  assert.deepEqual(data(select.props), {
    class: "v2-select",
    "aria-label": "Row density",
    "aria-describedby": "row-density-hint",
  });
  assert.equal(kids(named)[1].props.id, "row-density-hint");
  const group = fieldGroup(["A", "B"]);
  assert.equal(group.type, "div");
  assert.equal(group.props.class, "v2-field");
  assert.deepEqual(group.props.children, ["A", "B"]);
  assert.doesNotMatch(src("components/AppearanceSettings.tsx"), /v2-field/);
});

test("the mode is a draft until saved and the topbar still applies at once", async () => {
  const p = await page({ theme: "dark" });
  assert.deepEqual(p.look, { mode: "dark", band: null });
  assert.equal(p.general, false);
  assert.equal(p.saveLocked, true);
  // A drafted mode shows on the card, marks General and blocks leaving;
  // nothing is stored or applied.
  await p.change({ mode: "light", band: null });
  assert.deepEqual(p.look, { mode: "light", band: null });
  assert.equal(p.general, true);
  assert.equal(p.saveLocked, false);
  assert.equal(p.dirty.at(-1), true);
  assert.equal(p.leaveIsBlocked(), true);
  assert.deepEqual(p.log, []);
  assert.equal(p.attributes["data-theme"], "dark");
  // The drafted mode back to the shown one is no change.
  await p.change({ mode: "dark", band: null });
  assert.equal(p.general, false);
  assert.equal(p.dirty.at(-1), false);
  // The topbar applies at once: its new mode is the base, so the draft
  // of that mode is clean, and nothing asks.
  await p.change({ mode: "light", band: null });
  p.props.theme = "light";
  p.render();
  assert.deepEqual(p.look, { mode: "light", band: null });
  assert.equal(p.general, false);
  assert.equal(p.saveLocked, true);
  // The mode draft is gone: the topbar back to dark shows dark.
  p.props.theme = "dark";
  p.render();
  assert.deepEqual(p.look, { mode: "dark", band: null });
  assert.equal(p.general, false);
  assert.deepEqual(p.confirms, []);
  assert.deepEqual(p.log, []);
  // A failed save keeps the draft and applies nothing.
  await p.change({ mode: "light", band: null });
  p.state.failing = true;
  await p.save();
  assert.deepEqual(p.log, ["PUT settings"]);
  assert.equal(p.attributes["data-theme"], "dark");
  assert.deepEqual(p.look, { mode: "light", band: null });
  assert.equal(p.general, true);
  // A successful save applies it after its PUT and GET, then the shell
  // follows (onTheme), and the draft is clean.
  p.state.failing = false;
  p.log.length = 0;
  await p.save();
  assert.deepEqual(p.log, [
    "PUT settings",
    "GET settings",
    "saved",
    "set scopearr-theme=light",
    "onTheme light",
    "Settings saved.",
  ]);
  assert.equal(p.attributes["data-theme"], "light");
  assert.equal(p.attributes["data-band"], "strong");
  assert.equal(p.props.theme, "light");
  assert.deepEqual(p.look, { mode: "light", band: null });
  assert.equal(p.general, false);
  assert.equal(p.dirty.at(-1), false);
  assert.equal(p.leaveIsBlocked(), false);
});

test("a save applies the mode draft as it stands when the save ends", async () => {
  // T6-M9: the topbar toggled twice while a save runs (dark → light →
  // dark) drops the mode draft; the save then applies no mode, so the
  // user's last topbar choice stays.
  const p = await page({ theme: "dark" });
  await p.change({ mode: "light", band: null });
  let release;
  p.state.hold = new Promise((resolve) => (release = resolve));
  const saving = p.save();
  await tick();
  p.props.theme = "light";
  p.render();
  p.props.theme = "dark";
  p.render();
  release();
  await saving;
  await tick();
  p.render();
  assert.deepEqual(p.log, [
    "PUT settings",
    "GET settings",
    "saved",
    "Settings saved.",
  ]);
  assert.equal(p.props.theme, "dark");
  assert.deepEqual(p.look, { mode: "dark", band: null });
  // A band drafted before the save still applies, with the mode untouched.
  const band = await page({ theme: "dark" });
  await band.change({ mode: "light", band: "muted" });
  let go;
  band.state.hold = new Promise((resolve) => (go = resolve));
  const pending = band.save();
  await tick();
  band.props.theme = "light";
  band.render();
  band.props.theme = "dark";
  band.render();
  go();
  await pending;
  await tick();
  assert.deepEqual(band.log, [
    "PUT settings",
    "GET settings",
    "saved",
    "set scopearr-band=muted",
    "Settings saved.",
  ]);
  assert.equal(band.props.theme, "dark");
});

test("the band is a draft until saved, for both modes, and returns to the default", async () => {
  const p = await page({ theme: "dark" });
  assert.deepEqual(p.look, { mode: "dark", band: null });
  // A drafted band: shown, dirty, nothing stored.
  await p.change({ mode: "dark", band: "strong" });
  assert.deepEqual(p.look, { mode: "dark", band: "strong" });
  assert.equal(p.general, true);
  assert.deepEqual(p.log, []);
  assert.equal(p.attributes["data-band"], undefined);
  // The band is one choice for both modes: a drafted mode keeps it.
  await p.change({ mode: "light", band: "strong" });
  assert.deepEqual(p.look, { mode: "light", band: "strong" });
  await p.change({ mode: "dark", band: "strong" });
  await p.save();
  assert.deepEqual(p.log, [
    "PUT settings",
    "GET settings",
    "saved",
    "set scopearr-band=strong",
    "Settings saved.",
  ]);
  assert.equal(p.values.get("scopearr-band"), "strong");
  assert.equal(p.attributes["data-band"], "strong");
  assert.deepEqual(p.look, { mode: "dark", band: "strong" });
  assert.equal(p.general, false);
  // The stored band again is no change.
  await p.change({ mode: "dark", band: "strong" });
  assert.equal(p.general, false);
  // Use default with a stored band: the draft has no choice, so the card
  // shows the mode's default and locks Use default; General is dirty.
  await p.change({ mode: "dark", band: null });
  assert.deepEqual(p.look, { mode: "dark", band: null });
  assert.equal(p.general, true);
  assert.deepEqual(data(model.bandChoice("dark", p.look.band)), {
    value: "muted",
    stored: false,
  });
  p.log.length = 0;
  await p.save();
  assert.deepEqual(p.log, [
    "PUT settings",
    "GET settings",
    "saved",
    "remove scopearr-band",
    "Settings saved.",
  ]);
  assert.equal(p.values.has("scopearr-band"), false);
  assert.equal(p.attributes["data-band"], "muted");
  assert.equal(p.general, false);
  // Light: its default is strong; a muted band holds for it too.
  const light = await page({ theme: "light" });
  assert.deepEqual(light.look, { mode: "light", band: null });
  await light.change({ mode: "light", band: "muted" });
  await light.save();
  assert.equal(light.values.get("scopearr-band"), "muted");
  assert.equal(light.attributes["data-band"], "muted");
  // A stored band from the start shows itself.
  const stored = await page({
    theme: "light",
    stored: { "scopearr-band": "muted" },
  });
  assert.deepEqual(stored.look, { mode: "light", band: "muted" });
  assert.equal(stored.general, false);
  // Discard drops the band draft too.
  await stored.change({ mode: "light", band: "strong" });
  assert.equal(stored.general, true);
  stored.answers.push(false);
  assert.equal(await stored.guard("widgets"), false);
  stored.render();
  assert.deepEqual(stored.look, { mode: "light", band: "strong" });
  stored.answers.push(true);
  assert.equal(await stored.guard("widgets"), true);
  stored.render();
  assert.deepEqual(stored.confirms, [
    "Discard unsaved settings changes?",
    "Discard unsaved settings changes?",
  ]);
  assert.deepEqual(stored.look, { mode: "light", band: "muted" });
  assert.equal(stored.general, false);
  assert.deepEqual(stored.log, [], "a draft stores nothing");
});

test("a palette is a draft until saved", async () => {
  const view = display({ cfg: { ...SETTINGS, interfaceTheme: "catppuccin" } });
  const picker = one(view.tree, "PalettePicker");
  assert.equal(picker.props.labelledBy, "interface-theme-title");
  assert.equal(picker.props.value, "catppuccin");
  assert.equal(picker.props.mode, "dark");
  assert.equal(one(view.tree, "PalettePreview").props.theme, "catppuccin");
  picker.props.change("nord");
  assert.equal(view.log.cfg.at(-1).interfaceTheme, "nord");
  // The preview shows the draft palette with the drafted mode and band.
  const drafted = display({
    cfg: { ...SETTINGS, interfaceTheme: "nord" },
    mode: "light",
    band: "muted",
  });
  assert.deepEqual(data(one(drafted.tree, "PalettePreview").props), {
    theme: "nord",
    band: "muted",
  });
  assert.equal(one(drafted.tree, "PalettePicker").props.mode, "light");
  const card = one(drafted.tree, "ModeBandCard").props;
  assert.deepEqual([card.mode, card.band], ["light", "muted"]);
  card.change({ mode: "dark", band: "muted" });
  assert.deepEqual(drafted.log.looks, [{ mode: "dark", band: "muted" }]);
  // On the page: General is dirty, nothing applies the palette.
  const p = await page();
  one(p.tree, "AppearanceSettings").props.setCfg((cfg) => ({
    ...cfg,
    interfaceTheme: "nord",
  }));
  p.render();
  assert.equal(p.general, true);
  assert.equal(p.attributes["data-palette"], undefined);
  assert.doesNotMatch(
    src("components/SettingsPage.tsx"),
    /applyInterfaceTheme/,
  );
  assert.doesNotMatch(
    src("components/AppearanceSettings.tsx"),
    /applyInterfaceTheme|setTheme|setBandPreference/,
  );
});

test("row density keeps its select and hint in its final place", () => {
  const view = display({ draftPrefs: { density: "compact", stacked: true } });
  const cards = cardsOf(byClass(view.tree, "v2-set-grid")[0]);
  // Beside Pagination: the fourth card of the grid, after it.
  assert.deepEqual(cards.map(titleOf).slice(2, 4), [
    "Pagination",
    "Row density",
  ]);
  const card = cards[3];
  const select = one(card, "select");
  assert.equal(select.props.class, "v2-select");
  assert.equal(select.props["aria-label"], "Row density");
  assert.equal(select.props.value, "compact");
  assert.deepEqual(
    data(ofType(select, "option").map((o) => [o.props.value, text(o)])),
    [
      ["comfortable", "Comfortable"],
      ["compact", "Compact"],
    ],
  );
  const hint = one(card, "small");
  assert.equal(
    text(hint),
    "Compact rows show more entries at once. Applied after saving in this browser.",
  );
  assert.equal(select.props["aria-describedby"], hint.props.id);
  select.props.onChange({ currentTarget: { value: "comfortable" } });
  select.props.onChange({ currentTarget: { value: "dense" } });
  assert.deepEqual(view.log.prefs, [
    { density: "comfortable", stacked: true },
    { density: "comfortable", stacked: true },
  ]);
  // Hidden (another area shown), the section renders neither option.
  for (const tab of ["general", "lists"]) {
    const hidden = display({ tab, hidden: true });
    assert.equal(hidden.tree.props.hidden, true);
    assert.equal(
      nodes(hidden.tree).some(
        (n) => n.type === "select" && n.props["aria-label"] === "Row density",
      ),
      false,
      tab,
    );
    assert.equal(
      nodes(hidden.tree).some((n) => text(n) === "Show audio tracks stacked"),
      false,
      tab,
    );
  }
});

test("lists and columns edit every list with a preview", async () => {
  const cfg = {
    ...SETTINGS,
    visibleColumns: { radarr: ["title", "year"], sonarr: ["title", "year"] },
  };
  const view = display({ tab: "lists", cfg, saved: SETTINGS });
  const [card] = cardsOf(view.tree);
  assert.equal(titleOf(card), "Lists & columns");
  assert.equal(
    text(ofType(card, "p")[0]),
    "Choose visible icons and columns and move them with the arrows (left to right, including hidden entries). Warnings appear only for affected files. Filters and CSV always include all fields. Changes apply after saving.",
  );
  // The five lists, each with its unsaved-change mark (Movies changed).
  const tabs = one(card, "Segmented").props;
  assert.equal(tabs.label, "Lists & columns");
  assert.equal(tabs.kind, "tabs");
  assert.equal(tabs.idPrefix, "columns");
  assert.equal(tabs.value, "icons");
  assert.deepEqual(data(tabs.items), [
    { value: "icons", label: "Icons", dirty: false },
    { value: "radarr", label: "Movies", dirty: true },
    { value: "sonarr", label: "TV series", dirty: false },
    { value: "filecheck", label: "Files & permissions", dirty: false },
    { value: "placement", label: "Disk placement", dirty: false },
  ]);
  const panel = nodes(card).find((n) => n.props?.role === "tabpanel");
  assert.equal(panel.props.id, "columns-panel-icons");
  assert.equal(panel.props["aria-labelledby"], "columns-tab-icons");
  assert.equal(one(panel, "ListLayoutSettings").props.settings, view.state.cfg);
  const reset = ofType(byClass(card, "v2-set-head")[0], "button")[0];
  assert.equal(reset.props["aria-label"], "Reset order for Icons");
  assert.equal(reset.props.title, "Reset order for Icons");
  await reset.props.onClick();
  assert.deepEqual(view.log.confirms, ["Reset order for Icons?"]);
  assert.deepEqual(
    [view.log.cfg.at(-1).listInfoOrder, view.log.cfg.at(-1).listInfoVisible],
    [
      ["link", "mux"],
      ["link", "mux"],
    ],
  );
  // Movies: the order editor with the fixed selection, Title always visible.
  tabs.select("radarr");
  assert.deepEqual(view.log.session, [["scopearr-columns-tab", "radarr"]]);
  const movies = view.view.render();
  const editor = one(movies, "ColumnOrderEditor").props;
  assert.equal(editor.list, "Movies");
  assert.deepEqual(data(editor.order), ["select", "title", "year"]);
  assert.deepEqual(data(editor.visible), ["select", "title", "year"]);
  assert.deepEqual(data(editor.fixed), ["select"]);
  assert.deepEqual(data(editor.alwaysVisible), ["select", "title"]);
  assert.equal(editor.labels.select, "Selection");
  editor.change(["select", "year", "title"], ["select", "year"]);
  assert.deepEqual(view.log.cfg.at(-1).columnOrder.radarr, ["year", "title"]);
  assert.deepEqual(view.log.cfg.at(-1).visibleColumns.radarr, ["year"]);
  const moviesReset = ofType(
    byClass(cardsOf(movies)[0], "v2-set-head")[0],
    "button",
  )[0];
  assert.equal(moviesReset.props["aria-label"], "Reset order for Movies");
  await moviesReset.props.onClick();
  assert.equal(view.log.confirms.at(-1), "Reset order for Movies?");
  assert.deepEqual(view.log.cfg.at(-1).columnOrder.radarr, ["title", "year"]);
  // The tools' remove column is named Actions.
  for (const [value, list] of [
    ["filecheck", "Files & permissions"],
    ["placement", "Disk placement"],
  ]) {
    tabs.select(value);
    const tool = one(view.view.render(), "ColumnOrderEditor").props;
    assert.equal(tool.list, list);
    assert.equal(tool.labels.remove, "Actions", value);
    assert.deepEqual(data(tool.alwaysVisible), ["select"], value);
  }
  // The session key opens its list.
  const stored = display({
    tab: "lists",
    session: { "scopearr-columns-tab": "sonarr" },
  });
  assert.equal(one(stored.tree, "ColumnOrderEditor").props.list, "TV series");
});

test("stacked tracks sit beside the column preview", () => {
  const view = display({
    tab: "lists",
    draftPrefs: { density: "compact", stacked: false },
  });
  const tabs = one(view.tree, "Segmented").props;
  for (const value of ["icons", "radarr", "sonarr", "filecheck", "placement"]) {
    tabs.select(value);
    const tree = view.view.render();
    const editor = nodes(tree).find((n) =>
      ["ColumnOrderEditor", "ListLayoutSettings"].includes(n.type),
    );
    // The editor's right column holds the card below the preview.
    const [stacked] = kids(editor);
    assert.equal(stacked.type, "section", value);
    assert.deepEqual(
      classes(stacked),
      ["v2-card--inset", "v2-set-card"],
      value,
    );
    assert.equal(titleOf(stacked), "Audio tracks", value);
    const label = one(stacked, "label");
    assert.equal(label.props.class, "v2-ff-check");
    assert.equal(text(label), "Show audio tracks stacked");
    const box = one(label, "input");
    assert.equal(box.props.checked, false);
    assert.equal(
      text(one(stacked, "small")),
      "Stacked shows every audio track on its own line; otherwise up to two show and the others on demand. Applied after saving in this browser.",
    );
    box.props.onChange({ currentTarget: { checked: true } });
  }
  assert.deepEqual(
    view.log.prefs,
    Array(5).fill({ density: "compact", stacked: true }),
  );
  // The real editor: the order list, then one column of the "Preview"
  // label, the numbered cells and the slot.
  const { ColumnOrderEditor, OrderList } = loadSource(
    "components/settings/ColumnOrderEditor.tsx",
    {
      modules: {
        "preact/hooks": hooks,
        "../../ui": { ICON: { label: 15, button: 16 } },
        "../../i18n": { t, useI18n: () => ({ locale: "en" }) },
        "../../settings-model": model,
      },
    },
  );
  current = createHookRuntime();
  const editor = ColumnOrderEditor({
    list: "Movies",
    order: ["title", "year"],
    visible: ["title"],
    labels: { title: "Title", year: "Year" },
    change: f,
    children: "STACKED",
  });
  assert.equal(editor.props.class, "v2-set-cols");
  const [list, side] = kids(editor);
  assert.equal(list.type, OrderList);
  assert.equal(side.type, "div");
  const parts = kids(side);
  assert.equal(text(parts[0]), "Preview");
  assert.deepEqual(classes(parts[1]), ["v2-colprev"]);
  assert.equal(parts[2], "STACKED");
});

// --- The color cards -----------------------------------------------------------

function colorCard(name, props, { api = async () => ({}) } = {}) {
  const log = { confirms: [], calls: [], cfg: [] };
  const exports = loadSource("components/settings/" + name + ".tsx", {
    modules: {
      "preact/hooks": hooks,
      "../../ui": {
        ICON: { button: 16 },
        TagLabels: "TagLabels",
        TagColors: { Provider: "TagColors" },
        TagTextColors: { Provider: "TagTextColors" },
        colorFields: ["resolution", "custom", "language"],
        labels: {
          resolution: "Resolution",
          custom: "Custom tags",
          language: "Language",
        },
        defaultColor: () => "#123456",
        defaultWarningColors: { metadata: "#d9a870", recognition: "#b994f0" },
      },
      "../../i18n": {
        t,
        getLocale: () => "en",
        useI18n: () => ({ locale: "en" }),
      },
      "../../color": {
        colorStyle: (bg, fg) => ({ background: bg, color: fg }),
      },
      "../../confirmation": {
        confirmReset: async (message) => (log.confirms.push(message), true),
        confirmDeletion: async (message) => (log.confirms.push(message), true),
      },
      "../../api": {
        api: async (...args) => (log.calls.push(data(args)), api(...args)),
      },
      "../../notifications": { notify: (message) => log.calls.push(message) },
      "../../tag-labels": { presentedTagLabel: (field, value) => value },
      "../../resolution-groups": { SD_RESOLUTION: "SD" },
      "../../languages": { audioLanguageLabel: (value) => "Lang " + value },
      "../list/HelpTip": { HelpTip: "HelpTip" },
      "../LanguageFlag": { LanguageFlag: "LanguageFlag" },
      "./Field": loadSource("components/settings/Field.tsx"),
      "./Card": loadSource("components/settings/Card.tsx"),
    },
    stubs: PRESENTATION_MODULES,
  });
  const state = { cfg: props.cfg };
  const view = mount(exports[name], {
    ...props,
    get cfg() {
      return state.cfg;
    },
    setCfg: (next) => {
      state.cfg = typeof next === "function" ? next(state.cfg) : next;
      log.cfg.push(data(state.cfg));
    },
  });
  current = view.runtime;
  return { view, log, state, tree: view.render() };
}
const rowButtons = (tree) => ofType(tree, "RowButton");

test("tag and warning colors keep every 1.7.0 control", async () => {
  // Warning colors: preview, color and reset with its question.
  const warn = colorCard("WarningColorsCard", { cfg: SETTINGS });
  const [wcard] = cardsOf(warn.tree);
  assert.equal(titleOf(wcard), "Warning colors");
  assert.equal(
    text(ofType(wcard, "p")[0]),
    "Metadata disagreements and conflicting recognition rules use separate icons.",
  );
  assert.equal(one(wcard, "table").props.class, "v2-table v2-set-colors");
  assert.deepEqual(
    ofType(wcard, "th").map((th) => [text(th), th.props.scope]),
    [
      ["Tag preview", "col"],
      ["Color", "col"],
      ["Reset", "col"],
    ],
  );
  const colors = ofType(wcard, "input");
  assert.deepEqual(
    colors.map((input) => [
      input.props.type,
      input.props.class,
      input.props["aria-label"],
      input.props.value,
    ]),
    [
      ["color", "v2-color", "Metadata warning color", "#d9a870"],
      ["color", "v2-color", "Recognition warning color", "#b994f0"],
    ],
  );
  // The draft color is on the icon only; the name keeps the text color
  // (fix round 1, I-4: contrast in light mode).
  const previews = ofType(wcard, "td")
    .filter((td) => td.props["data-label"] === "Tag preview")
    .map((td) => kids(td)[0]);
  assert.deepEqual(
    previews.map((span) => [
      span.props.style,
      kids(span)[0].props.color,
      text(kids(span)[1]),
    ]),
    [
      [undefined, "#d9a870", "Metadata disagreement"],
      [undefined, "#b994f0", "Conflicting recognition rules"],
    ],
  );
  colors[0].props.onInput({ currentTarget: { value: "#000000" } });
  assert.equal(warn.log.cfg.at(-1).warningColors.metadata, "#000000");
  const restore = rowButtons(warn.view.render());
  assert.deepEqual(
    restore.map((b) => b.props.label),
    [
      "Restore defaults: Metadata disagreement",
      "Restore defaults: Conflicting recognition rules",
    ],
  );
  await restore[0].props.onClick();
  assert.deepEqual(warn.log.confirms, [
    "Reset this warning color to its default?",
  ]);
  assert.equal(warn.log.cfg.at(-1).warningColors.metadata, "#d9a870");

  // Tag colors: the field, the table with its seven columns.
  const customTags = [
    { id: 7, name: "Favorites", count: 0 },
    { id: 8, name: "Kept", count: 2 },
    { id: 9, name: "Auto", count: 0, protected: true },
  ];
  const base = {
    cfg: { ...SETTINGS, tagColors: { "resolution:1080p": "#ff0000" } },
    customTags,
    catalog: [
      { field: "resolution", value: "1080p", count: 3, mediaServer: true },
      { field: "resolution", value: "720p", count: 0 },
    ],
    recognized: {
      resolution: ["720p", "1080p", "SD"],
      custom: ["7", "8", "9"],
    },
    colorField: "resolution",
    setColorField: f,
    customChanged: async () => customTags,
    saved: async () => {},
    refresh: async () => {},
    setCatalog: f,
    setRecognized: f,
  };
  const tags = colorCard("TagColorsCard", base);
  const [tcard] = cardsOf(tags.tree);
  assert.equal(titleOf(tcard), "Tag colors");
  assert.equal(
    text(ofType(tcard, "p")[0]),
    "Custom colors apply to both libraries and themes. They remain saved until reset.",
  );
  const field = one(tcard, "select");
  assert.equal(field.props.class, "v2-select");
  assert.equal(text(one(tcard, "label")), "Tag field");
  assert.deepEqual(
    data(ofType(field, "option").map((o) => [o.props.value, text(o)])),
    [
      ["resolution", "Resolution"],
      ["custom", "Custom tags"],
      ["language", "Language"],
    ],
  );
  assert.deepEqual(
    ofType(tcard, "th").map((th) => [text(th), th.props.scope]),
    [
      ["Tag preview", "col"],
      ["Count", "col"],
      ["Display column", "col"],
      ["Color", "col"],
      ["Text", "col"],
      ["Reset", "col"],
      ["Actions", "col"],
    ],
  );
  const rows = ofType(tcard, "tr").slice(1);
  // Sorted values; the virtual SD stays while SD is grouped.
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((row) => one(row, "MediaTag").props.value),
    ["1080p", "720p", "SD"],
  );
  for (const row of rows) {
    const tag = one(row, "MediaTag").props;
    assert.deepEqual([tag.kind, tag.forceTag], ["resolution", true]);
    assert.deepEqual(
      ofType(row, "td").map((td) => td.props["data-label"]),
      [
        "Tag preview",
        "Count",
        "Display column",
        "Color",
        "Text",
        "Reset",
        "Actions",
      ],
    );
  }
  // The draft colors reach the previews.
  const provider = nodes(tcard).find((n) => n.type === "TagColors");
  assert.deepEqual(data(provider.props.value), {
    "resolution:1080p": "#ff0000",
  });
  // The media server mark is a help tip.
  assert.deepEqual(
    ofType(rows[0], "HelpTip").map((tip) => tip.props.label),
    ["Media server metadata"],
  );
  assert.equal(ofType(rows[1], "HelpTip").length, 0);
  assert.equal(text(ofType(rows[0], "td")[1]), "3");
  // A narrow card's rows give the preview two places; Count is a number.
  assert.deepEqual(
    ofType(rows[0], "td").map((td) => td.props.class ?? null),
    ["v2-table-wide", "v2-table-num", null, null, null, null, null],
  );
  assert.equal(ofType(tcard, "th")[1].props.class, "v2-table-num");
  assert.equal(one(tcard, "table").props.class, "v2-table v2-set-colors");
  const [display, color] = ofType(rows[0], "input");
  assert.deepEqual(
    [
      display.props.type,
      display.props.class,
      display.props["aria-label"],
      display.props.checked,
    ],
    ["checkbox", "v2-check", "Display tag: 1080p", true],
  );
  assert.deepEqual(
    [
      color.props.type,
      color.props.class,
      color.props["aria-label"],
      color.props.value,
    ],
    ["color", "v2-color", "Color for 1080p", "#ff0000"],
  );
  display.props.onChange({ currentTarget: { checked: false } });
  assert.deepEqual(tags.log.cfg.at(-1).hiddenTags, {
    "resolution:1080p": true,
  });
  // The text color cycles Automatic → Black → White → Automatic.
  const names = [];
  for (let step = 0; step < 4; step++) {
    const row = ofType(tags.view.render(), "tr")[1];
    const [text_, reset, remove] = rowButtons(row);
    names.push([text_.props.label, text_.props.title]);
    if (step === 0) {
      assert.equal(reset.props.label, "Default color for 1080p");
      assert.equal(reset.props.disabled, false);
      assert.equal(remove.props.label, "Delete tag: 1080p");
      assert.equal(remove.props.tone, "danger");
      assert.equal(remove.props.disabled, true, "linked values stay");
    }
    if (step < 3) text_.props.onClick();
  }
  assert.deepEqual(names, [
    ["Text color for 1080p: Automatic", "Automatic"],
    ["Text color for 1080p: Black", "Black"],
    ["Text color for 1080p: White", "White"],
    ["Text color for 1080p: Automatic", "Automatic"],
  ]);
  // Reset asks, then drops both colors.
  const [, reset] = rowButtons(ofType(tags.view.render(), "tr")[1]);
  await reset.props.onClick();
  assert.equal(
    tags.log.confirms.at(-1),
    "Reset background and text colors for 1080p?",
  );
  assert.deepEqual(tags.log.cfg.at(-1).tagColors, {});
  // Unlinked 720p deletes from the catalog after its question; the
  // virtual SD never.
  const after = ofType(tags.view.render(), "tr");
  const [, resetFree, remove720] = rowButtons(after[2]);
  assert.equal(resetFree.props.disabled, true);
  assert.equal(remove720.props.disabled, false);
  assert.equal(rowButtons(after[3])[2].props.disabled, true, "virtual SD");
  await remove720.props.onClick();
  assert.equal(tags.log.confirms.at(-1), "Delete tag 720p?");
  assert.deepEqual(tags.log.calls[0], [
    "tag-catalog",
    "DELETE",
    { field: "resolution", value: "720p" },
  ]);
  // Custom tags: protected and used ones stay; others go through the batch.
  const custom = colorCard("TagColorsCard", { ...base, colorField: "custom" });
  const customRows = ofType(custom.tree, "tr").slice(1);
  assert.deepEqual(
    customRows.map((row) => rowButtons(row)[2].props.disabled),
    [false, true, true],
  );
  await rowButtons(customRows[0])[2].props.onClick();
  assert.equal(custom.log.confirms.at(-1), "Delete tag Favorites?");
  assert.equal(custom.log.calls[0][0], "custom-tags/batch");
  assert.equal(custom.log.calls[0][1], "PUT");
  assert.deepEqual(
    custom.log.calls[0][2].tags.map((tag) => tag.id),
    [8, 9],
  );
  // Languages: the flag, no text color; empty lists keep their texts.
  const language = colorCard("TagColorsCard", {
    ...base,
    colorField: "language",
    recognized: { language: ["de", "__unknown__"] },
  });
  const [flagRow] = ofType(language.tree, "tr").slice(1);
  assert.equal(one(flagRow, "LanguageFlag").props.value, "de");
  assert.equal(rowButtons(flagRow)[0].props.disabled, true);
  assert.equal(ofType(language.tree, "tr").length, 2, "unknown is hidden");
  for (const [field, empty] of [
    ["resolution", "No tags detected yet. Sync a library first."],
    [
      "custom",
      "No custom tags assigned yet. Assign tags in your library or add a filename rule.",
    ],
  ]) {
    const none = colorCard("TagColorsCard", {
      ...base,
      colorField: field,
      recognized: {},
    });
    assert.match(text(none.tree), new RegExp(empty.replace(/\./g, "\\.")));
  }
});

test("display drops the transition sheet", () => {
  // The form is the area's v2-set; the demo notice its first block.
  const page = squash(src("components/SettingsPage.tsx"));
  assert.match(
    page,
    /\/\/ Every area is on the v2 blocks \(Phase 5c\);[^]*? const ownBand = section === "custom" \|\| section === "recognition";/,
  );
  assert.match(page, /<form id=\{settingsFormId\} class="v2-set"/);
  assert.match(
    page,
    /\{demo && !ownBand && section !== "system" && \( <div class="v2-notice">/,
  );
});
