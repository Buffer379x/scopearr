import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as icons from "lucide-preact";
import {
  loadSource,
  nodes,
  PRESENTATION_MODULES,
  text,
} from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";

// The v2 settings building blocks (Phase 5c, task 3; docs/STYLEGUIDE.md,
// Part 1, 10.4, 10.6, 10.8, 10.10 and 10.11), built but not mounted yet,
// and the props they add to the 5a blocks: Segmented kind "radio" and its
// items' dirty and dot, FilterBar without a preset and TableCard without
// chips or foot. Each component runs as real code with the hook runtime;
// the blocks it places are named stubs, so a tree shows what they receive.
// Without the new props the 5a blocks render the VNodes recorded at the
// BASE of this task (goldens/).

const t = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");
const i18n = { t, getLocale: () => "en", useI18n: () => ({ locale: "en" }) };
const ui = { ICON: { label: 15, button: 16 }, count: (n) => String(n) };

// Every module shares one hooks object; it calls the runtime that renders.
let current = createHookRuntime();
const hooks = new Proxy({}, { get: (_, name) => current.hooks[name] });

const eventLog = loadSource("event-log.ts");
const themes = loadSource("themes.ts");
const THEMES = [...themes.interfaceThemes];
const model = loadSource("settings-model.ts", {
  modules: { "./themes": themes, "./event-log": eventLog },
});

// A component with its own runtime; render() renders it again with the
// same state and the current props, as Preact would; flush() runs its
// effects.
function mount(component, props) {
  const runtime = createHookRuntime();
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
    unmount() {
      current = runtime;
      runtime.unmount();
    },
  };
  return view;
}
const once = (component, props) => mount(component, props).render();
// A value of the sandbox as data of this realm.
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
const byRole = (tree, role) =>
  nodes(tree).filter((n) => n.props?.role === role);
// The text a screen reader reads: aria-hidden parts drop out.
function spoken(tree) {
  if (Array.isArray(tree)) return tree.map(spoken).join("");
  if (tree && typeof tree === "object")
    return [true, "true"].includes(tree.props?.["aria-hidden"])
      ? ""
      : spoken(tree.props?.children);
  return tree == null || typeof tree === "boolean" ? "" : String(tree);
}

// The shape of a VNode tree, as goldens/ records it: every prop, an
// undefined one and a function by a marker, so a new prop key shows even
// when its value is undefined.
function shape(node) {
  if (Array.isArray(node)) return node.map(shape);
  if (node == null || typeof node === "boolean") return null;
  if (typeof node !== "object") return String(node);
  const type =
    typeof node.type === "function"
      ? "fn:" + (node.type.displayName || node.type.name)
      : node.type;
  const props = {};
  for (const [key, value] of Object.entries(node.props ?? {})) {
    if (key === "children") continue;
    props[key] =
      value === undefined
        ? "<undefined>"
        : typeof value === "function"
          ? "<function>"
          : value;
  }
  return {
    type,
    key: node.key ?? null,
    props,
    children: shape(node.props?.children),
  };
}
const golden = (name) =>
  JSON.parse(
    readFileSync(new URL("./goldens/" + name, import.meta.url), "utf8"),
  );
const GOLDEN = golden("settings-blocks-bfeaebb.json");
const LIST_GOLDEN = golden("list-blocks-c5b92c6.json");

const listModule = (name, modules = {}) =>
  loadSource("components/list/" + name + ".tsx", {
    modules: {
      "preact/hooks": hooks,
      "../../ui": ui,
      "../../i18n": i18n,
      "../frame/NavLink": { NavLink: "NavLink" },
      ...modules,
    },
  });
const settingsModule = (name, { modules = {}, browser = {} } = {}) =>
  loadSource("components/settings/" + name + ".tsx", {
    modules: {
      "preact/hooks": hooks,
      "../../ui": ui,
      "../../i18n": i18n,
      "../../settings-model": model,
      "../../themes": themes,
      "../list/Segmented": { Segmented: "Segmented" },
      ...modules,
    },
    browser,
    stubs: PRESENTATION_MODULES,
  });
const f = () => {};

// --- SettingsHeader and SaveDock -------------------------------------------------

const portal = { createPortal: (vnode, target) => ({ portal: vnode, target }) };
const header = (browser = {}) =>
  settingsModule("SettingsHeader", {
    modules: { "preact/compat": portal },
    browser,
  });
const SAVE = { busy: false, disabled: false, dirty: false };
const saveButton = (tree) =>
  nodes(tree).find((n) => n.type === "button" && /Save settings/.test(text(n)));
const actionsOf = (tree) => one(tree, "PageHeader").props.actions;

test("the settings header puts the description and Save on the band", () => {
  const { SettingsHeader } = header();
  const services = once(SettingsHeader, {
    section: "connections",
    save: { ...SAVE, form: "settings-form", dirty: true },
  });
  const head = one(services, "PageHeader");
  const description =
    "Configure connections, synchronization intervals and optional outbound tags.";
  assert.equal(head.props.title, "Services");
  assert.equal(head.props.meta, description);
  assert.equal(head.props.metaTitle, description);
  // Save: the band's primary, a submit button of the settings form, with
  // the check in its icon place.
  const save = saveButton(actionsOf(services));
  assert.equal(save.props.class, "v2-btn v2-btn--band-primary");
  assert.equal(save.props.type, "submit");
  assert.equal(save.props.form, "settings-form");
  assert.equal(save.props.disabled, false);
  assert.equal(text(save), "Save settings");
  const slot = byClass(save, "v2-btn-icon");
  assert.equal(slot.length, 1);
  assert.equal(slot[0].props["aria-hidden"], "true");
  assert.equal(ofType(slot[0], icons.Check).length, 1);
  assert.equal(ofType(slot[0], icons.LoaderCircle).length, 0);
  // Busy: the spinner takes the check's place, the text stays; locked.
  const busy = saveButton(
    actionsOf(
      once(SettingsHeader, {
        section: "connections",
        save: { ...SAVE, form: "settings-form", dirty: true, busy: true },
      }),
    ),
  );
  assert.equal(text(busy), "Save settings");
  assert.equal(busy.props.disabled, true);
  const spinner = ofType(byClass(busy, "v2-btn-icon"), icons.LoaderCircle);
  assert.equal(spinner.length, 1);
  assert.equal(spinner[0].props.class, "v2-spin");
  assert.equal(ofType(busy, icons.Check).length, 0);
  // Locked without a change.
  assert.equal(
    saveButton(
      actionsOf(
        once(SettingsHeader, {
          section: "widgets",
          save: { ...SAVE, form: "settings-form", disabled: true },
        }),
      ),
    ).props.disabled,
    true,
  );
  // Without a form: a plain button with the area's action.
  let saved = 0;
  const custom = saveButton(
    actionsOf(
      once(SettingsHeader, {
        section: "custom",
        save: { ...SAVE, dirty: true, action: () => saved++ },
      }),
    ),
  );
  assert.equal(custom.props.type, "button");
  assert.equal(custom.props.form, undefined);
  custom.props.onClick();
  assert.equal(saved, 1);
  // Without save: no button and no dock; System has its segment on the
  // band.
  let chosen = "";
  const system = once(SettingsHeader, {
    section: "system",
    segment: {
      label: "System sections",
      idPrefix: "system-settings",
      value: "info",
      items: [
        { value: "info", label: "Info" },
        { value: "log", label: "Log" },
      ],
      select: (value) => (chosen = value),
    },
  });
  assert.equal(one(system, "PageHeader").props.title, "System");
  assert.equal(saveButton(actionsOf(system)), undefined);
  assert.equal(nodes(system).filter((n) => n.portal).length, 0);
  const segment = one(actionsOf(system), "Segmented");
  assert.equal(segment.props.kind, "tabs");
  assert.equal(segment.props.onBand, true);
  assert.equal(segment.props.label, "System sections");
  assert.equal(segment.props.idPrefix, "system-settings");
  assert.equal(segment.props.value, "info");
  segment.props.select("log");
  assert.equal(chosen, "log");
  // Display: the segment comes before Save.
  const display = actionsOf(
    once(SettingsHeader, {
      section: "appearance",
      save: { ...SAVE, form: "settings-form" },
      segment: { ...segment.props, label: "Display sections" },
    }),
  );
  const order = nodes(display).filter(
    (n) => n.type === "Segmented" || n === saveButton(display),
  );
  assert.deepEqual(
    order.map((n) => n.type),
    ["Segmented", "button"],
  );
});

test("the save dock appears only with unsaved changes off screen", () => {
  const observers = [];
  class IntersectionObserver {
    constructor(callback, options) {
      this.callback = callback;
      this.options = options;
      observers.push(this);
    }
    observe(target) {
      this.target = target;
    }
    disconnect() {
      this.off = true;
    }
  }
  const main = { id: "main" };
  const { SaveDock } = header({
    IntersectionObserver,
    document: { getElementById: (id) => (id === "main" ? main : null) },
  });
  const target = { id: "band-save" };
  let saved = 0;
  const view = mount(SaveDock, {
    target,
    save: { ...SAVE, dirty: true, action: () => saved++ },
  });
  // In view (before the first report too): nothing.
  assert.equal(view.render(), null);
  view.flush();
  assert.equal(observers.length, 1);
  assert.equal(observers[0].target, target);
  assert.equal(observers[0].options.threshold, 0);
  observers[0].callback([{ isIntersecting: true }]);
  assert.equal(view.render(), null);
  // Out of view with unsaved changes: the same button in main.
  observers[0].callback([{ isIntersecting: false }]);
  const shown = view.render();
  assert.equal(shown.target, main);
  const dock = shown.portal;
  assert.equal(dock.props.class, "v2-save-dock");
  const button = saveButton(dock);
  assert.equal(button.props.class, "v2-btn v2-btn--primary");
  assert.equal(button.props.type, "button");
  assert.equal(text(button), "Save settings");
  assert.equal(ofType(byClass(button, "v2-btn-icon"), icons.Check).length, 1);
  button.props.onClick();
  assert.equal(saved, 1);
  // The form's submit button, busy: the spinner, locked.
  view.props = {
    target,
    save: { ...SAVE, dirty: true, busy: true, form: "settings-form" },
  };
  const busy = saveButton(view.render().portal);
  assert.equal(busy.props.type, "submit");
  assert.equal(busy.props.form, "settings-form");
  assert.equal(busy.props.disabled, true);
  assert.equal(ofType(busy, icons.LoaderCircle).length, 1);
  // Out of view without unsaved changes: nothing.
  view.props = { target, save: { ...SAVE } };
  assert.equal(view.render(), null);
  // A new target gets a new observer; the old one is disconnected.
  view.props = { target: { id: "other" }, save: { ...SAVE, dirty: true } };
  view.render();
  view.flush();
  assert.equal(observers[0].off, true);
  assert.equal(observers.length, 2);
  view.unmount();
  assert.equal(observers[1].off, true);
  // Without a target nothing is observed.
  const none = mount(SaveDock, {
    target: null,
    save: { ...SAVE, dirty: true },
  });
  assert.equal(none.render(), null);
  none.flush();
  assert.equal(observers.length, 2);
});

test("a dock that goes while it holds focus hands it to the band heading", () => {
  const observers = [];
  class IntersectionObserver {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe() {}
    disconnect() {}
  }
  const body = { id: "body" };
  const page = { activeElement: body, body };
  const focused = [];
  const heading = { tabIndex: 0, focus: () => focused.push(heading.tabIndex) };
  const target = {
    closest: (selector) =>
      selector === ".v2-page-head"
        ? {
            querySelector: (query) =>
              query === ".v2-page-title" ? heading : null,
          }
        : null,
  };
  const { SaveDock } = header({
    IntersectionObserver,
    document: {
      getElementById: () => ({ id: "main" }),
      get activeElement() {
        return page.activeElement;
      },
      get body() {
        return page.body;
      },
    },
  });
  const run = (steps) => {
    observers.length = 0;
    focused.length = 0;
    heading.tabIndex = 0;
    page.activeElement = body;
    const view = mount(SaveDock, { target, save: { ...SAVE, dirty: true } });
    view.render();
    view.flush();
    observers[0].callback([{ isIntersecting: false }]);
    const dock = view.render().portal;
    view.flush();
    steps(dock);
    // A successful save: the draft is clean, the dock goes.
    view.props = { target, save: { ...SAVE } };
    assert.equal(view.render(), null);
    view.flush();
    return [...focused];
  };
  // Focus in the dock, dropped to the page (its button was disabled while
  // saving, then removed): the heading takes it, focusable by script.
  assert.deepEqual(
    run((dock) => {
      dock.props.onFocusIn();
      dock.props.onFocusOut({ relatedTarget: null });
    }),
    [-1],
  );
  assert.equal(heading.tabIndex, -1);
  // Focus moved on to another element: nothing is taken from it.
  assert.deepEqual(
    run((dock) => {
      dock.props.onFocusIn();
      dock.props.onFocusOut({ relatedTarget: { id: "field" } });
    }),
    [],
  );
  assert.deepEqual(
    run((dock) => {
      dock.props.onFocusIn();
      page.activeElement = { id: "dialog button" };
    }),
    [],
  );
  // Never focused: the dock goes without touching focus.
  assert.deepEqual(
    run(() => {}),
    [],
  );
});

// --- ServiceCard, KeyValues, Switch, ServiceStatus --------------------------------

test("a service card shows its status before its sections", () => {
  const { ServiceCard, ServiceSection } = settingsModule("ServiceCard");
  const status = { tone: "ok", text: "Ready", long: "Last sync: today" };
  let active;
  const card = once(ServiceCard, {
    id: "radarr-1",
    icon: "ICON",
    name: "Radarr 4K",
    sub: "Radarr",
    status,
    actions: "ACTIONS",
    active: {
      label: "Enable service",
      checked: true,
      disabled: false,
      change: (on) => (active = on),
    },
    children: [
      { type: ServiceSection, props: { title: "Status", children: "ROWS" } },
      { type: ServiceSection, props: { title: "Connection", children: "F" } },
    ],
  });
  assert.equal(card.type, "section");
  assert.equal(card.props.class, "v2-card v2-svc");
  assert.equal(card.props.role, "tabpanel");
  assert.equal(card.props.id, "service-settings-panel-radarr-1");
  assert.equal(card.props["aria-labelledby"], "service-settings-tab-radarr-1");
  const [head, ...sections] = [card.props.children].flat();
  assert.equal(head.props.class, "v2-svc-head");
  // The head: the 40 tile, the name with its provider, the status tag,
  // the actions and the switch, in this order.
  const parts = [head.props.children].flat().filter(Boolean);
  const tile = parts[0];
  assert.equal(tile.props.class, "v2-tile v2-tile--grad v2-tile--md");
  assert.equal(tile.props["aria-hidden"], "true");
  assert.equal(text(tile), "ICON");
  const name = parts[1];
  assert.equal(name.type, "h2");
  assert.equal(name.props.class, "v2-svc-name");
  assert.equal(text(name), "Radarr 4KRadarr");
  assert.equal(byClass(name, "v2-svc-sub").length, 1);
  assert.equal(parts[2].type, "StatusTag");
  assert.equal(parts[2].props.view, status);
  assert.equal(parts[3].props.class, "v2-svc-actions");
  assert.equal(text(parts[3]), "ACTIONS");
  assert.equal(parts[4].props.class, "v2-svc-switch");
  const toggle = one(parts[4], "Switch");
  assert.equal(toggle.props.label, "Enable service");
  assert.equal(toggle.props.checked, true);
  assert.equal(toggle.props.disabled, false);
  toggle.props.change(false);
  assert.equal(active, false);
  // Status first: the first section is the status, its heading an h3.
  const children = sections.flat();
  assert.equal(children[0].props.title, "Status");
  const first = once(ServiceSection, children[0].props);
  assert.equal(first.type, "section");
  assert.equal(first.props.class, "v2-svc-sec");
  const secHead = byClass(first, "v2-svc-sec-head")[0];
  assert.equal(one(secHead, "h3").props.children, "Status");
  assert.equal(text(first), "StatusROWS");
  const tools = once(ServiceSection, {
    title: "Tool and updates",
    actions: "TOOLS",
    children: "X",
  });
  assert.equal(
    text(byClass(tools, "v2-svc-sec-head")[0]),
    "Tool and updatesTOOLS",
  );
  // Without a name of its own no provider line; without actions an empty
  // place.
  const plain = once(ServiceCard, {
    id: "mux",
    icon: "I",
    name: "MKVToolNix",
    status,
    active: {
      label: "Enable service",
      checked: false,
      disabled: true,
      change: f,
    },
    children: [],
  });
  assert.equal(byClass(plain, "v2-svc-sub").length, 0);
  assert.equal(text(byClass(plain, "v2-svc-actions")[0]), "");
});

test("key values keep one row per key with a dash for missing values", () => {
  const { KeyValues } = settingsModule("KeyValues");
  const { ServiceStatus } = settingsModule("ServiceStatus");
  const status = once(ServiceStatus, {
    kind: "arr",
    values: { status: "Ready", files: "12 files in cache", tags: 0 },
  });
  // ServiceStatus: KeyValues in two columns with the fixed rows of the kind.
  assert.equal(status.type, "KeyValues");
  assert.equal(status.props.columns, 2);
  const list = once(KeyValues, status.props);
  assert.equal(list.type, "dl");
  assert.equal(list.props.class, "v2-kv v2-kv--2");
  const rows = [list.props.children].flat();
  assert.deepEqual(
    rows.map((row) => row.key),
    ["status", "files", "next", "webhook", "external", "tags"],
  );
  assert.deepEqual(
    rows.map((row) => text(one(row, "dt"))),
    [
      "Status",
      "Files",
      "Next sync",
      "Realtime updates",
      "External tags",
      "Tag synchronization",
    ],
  );
  assert.deepEqual(
    rows.map((row) => text(one(row, "dd"))),
    ["Ready", "12 files in cache", "—", "—", "—", "0"],
  );
  for (const row of rows) assert.equal(row.type, "div");
  // Every kind keeps its rows.
  for (const [kind, count] of [
    ["media", 4],
    ["mux", 6],
    ["mediainfo", 6],
    ["unraid", 3],
  ])
    assert.equal(
      once(ServiceStatus, { kind, values: {} }).props.rows.length,
      count,
      kind,
    );
  // One column by default; an empty value reads "—".
  const single = once(KeyValues, {
    rows: [
      { key: "a", label: "A", value: "" },
      { key: "b", label: "B", value: null },
      { key: "c", label: "C", value: false },
      { key: "d", label: "D", value: "x" },
    ],
  });
  assert.equal(single.props.class, "v2-kv");
  assert.deepEqual(
    [single.props.children].flat().map((row) => text(one(row, "dd"))),
    ["—", "—", "—", "x"],
  );
});

test("the switch is a labelled checkbox with the switch role", () => {
  const { Switch } = settingsModule("Switch");
  let value;
  const tree = once(Switch, {
    label: "Enable service",
    checked: true,
    change: (on) => (value = on),
  });
  assert.equal(tree.type, "label");
  assert.equal(tree.props.class, "v2-switch");
  const [input, track, label] = [tree.props.children].flat();
  assert.equal(input.type, "input");
  assert.equal(input.props.type, "checkbox");
  assert.equal(input.props.role, "switch");
  assert.equal(input.props.checked, true);
  assert.equal(input.props.disabled, false);
  assert.equal(track.type, "span");
  assert.equal(track.props.class, "v2-switch-track");
  assert.equal(track.props["aria-hidden"], "true");
  assert.equal(label, "Enable service");
  assert.equal(spoken(tree), "Enable service");
  input.props.onChange({ currentTarget: { checked: false } });
  assert.equal(value, false);
  const locked = once(Switch, {
    label: "Enable Unraid disk placement",
    checked: false,
    disabled: true,
    change: f,
  });
  const box = byRole(locked, "switch")[0];
  assert.equal(box.props.disabled, true);
  assert.equal(box.props.checked, false);
});

// --- ModeBandCard, PalettePicker, PalettePreview ----------------------------------

test("mode and band toggles are radio groups that report a draft", () => {
  // The card loads without appearance.ts: it sets nothing itself.
  const { ModeBandCard } = settingsModule("ModeBandCard");
  const changes = [];
  const card = (props) =>
    once(ModeBandCard, { change: (next) => changes.push(next), ...props });
  const groupsOf = (tree) => ofType(tree, "Segmented");
  const useDefault = (tree) =>
    nodes(tree).find((n) => n.type === "button" && text(n) === "Use default");
  // Dark without a stored band: the band shows Muted, Use default is
  // locked.
  const dark = card({ mode: "dark", band: null });
  const [mode, band] = groupsOf(dark);
  assert.equal(mode.props.kind, "radio");
  assert.equal(mode.props.label, "Mode");
  assert.equal(mode.props.value, "dark");
  assert.deepEqual(data(mode.props.items), [
    { value: "dark", label: "Dark theme" },
    { value: "light", label: "Light theme" },
  ]);
  assert.equal(band.props.kind, "radio");
  assert.equal(band.props.label, "Accent band");
  assert.equal(band.props.value, "muted");
  assert.deepEqual(data(band.props.items), [
    { value: "strong", label: "Strong" },
    { value: "muted", label: "Muted" },
  ]);
  for (const group of byClass(dark, "v2-mode")) assert.equal(group.type, "div");
  assert.equal(byClass(dark, "v2-mode").length, 2);
  const reset = useDefault(dark);
  assert.equal(reset.props.class, "v2-text-btn");
  assert.equal(reset.props.type, "button");
  assert.equal(reset.props.disabled, true);
  assert.match(
    text(dark),
    /Default: dark muted, light strong – one choice applies to dark and light\./,
  );
  // A choice reports the next draft and keeps the other half.
  mode.props.select("light");
  band.props.select("strong");
  assert.deepEqual(data(changes.splice(0)), [
    { mode: "light", band: null },
    { mode: "dark", band: "strong" },
  ]);
  // Light without a stored band shows Strong; a stored band shows itself
  // in both modes and Use default withdraws it.
  assert.equal(
    groupsOf(card({ mode: "light", band: null }))[1].props.value,
    "strong",
  );
  for (const shown of ["dark", "light"]) {
    const stored = card({ mode: shown, band: "muted" });
    assert.equal(groupsOf(stored)[0].props.value, shown);
    assert.equal(groupsOf(stored)[1].props.value, "muted");
    const button = useDefault(stored);
    assert.equal(button.props.disabled, false);
    button.props.onClick();
    // A mode change keeps the drafted band.
    groupsOf(stored)[0].props.select(shown === "dark" ? "light" : "dark");
  }
  assert.deepEqual(data(changes.splice(0)), [
    { mode: "dark", band: null },
    { mode: "light", band: "muted" },
    { mode: "light", band: null },
    { mode: "dark", band: "muted" },
  ]);
  // The radio segment: a named radiogroup of radios with aria-checked, a
  // roving tabindex, and ←/→, Home and End that choose and focus.
  const { Segmented } = listModule("Segmented");
  const chosen = [];
  const focused = [];
  const radios = mount(Segmented, {
    ...band.props,
    select: (value) => chosen.push(value),
  });
  const group = radios.render();
  assert.equal(group.type, "div");
  assert.equal(group.props.role, "radiogroup");
  assert.equal(group.props["aria-label"], "Accent band");
  const items = byRole(group, "radio");
  assert.deepEqual(
    items.map((item) => [
      item.type,
      item.props["aria-checked"],
      item.props.tabIndex,
      text(item),
    ]),
    [
      ["button", false, -1, "Strong"],
      ["button", true, 0, "Muted"],
    ],
  );
  assert.equal(byRole(group, "tab").length, 0);
  items[0].props.onClick();
  const buttons = [0, 1].map((at) => ({ focus: () => focused.push(at) }));
  // The root's ref, as Preact sets it.
  group.ref.current = {
    querySelectorAll: (selector) => {
      assert.equal(selector, '[role="radio"]');
      return buttons;
    },
  };
  for (const key of ["ArrowRight", "ArrowLeft", "Home", "End", "x"])
    group.props.onKeyDown({ key, preventDefault: f });
  assert.deepEqual(chosen, ["strong", "strong", "strong", "strong", "muted"]);
  assert.deepEqual(focused, [0, 0, 0, 1]);
  // A radio group moves with ↓ and ↑ like → and ← (WAI-ARIA); a tablist
  // keeps ←/→ only.
  chosen.length = focused.length = 0;
  for (const key of ["ArrowDown", "ArrowUp"])
    group.props.onKeyDown({ key, preventDefault: f });
  assert.deepEqual(chosen, ["strong", "strong"]);
  assert.deepEqual(focused, [0, 0]);
  const tabs = mount(Segmented, {
    ...band.props,
    kind: "tabs",
    select: (value) => chosen.push(value),
  }).render();
  let prevented = 0;
  for (const key of ["ArrowDown", "ArrowUp"])
    tabs.props.onKeyDown({ key, preventDefault: () => prevented++ });
  assert.deepEqual(chosen, ["strong", "strong"], "a tablist ignores ↓/↑");
  assert.equal(prevented, 0);
});

test("palette tiles are radios named by their palette", () => {
  const { PalettePicker } = settingsModule("PalettePicker");
  const picked = [];
  const tree = once(PalettePicker, {
    labelledBy: "interface-theme-title",
    value: "catppuccin",
    mode: "dark",
    change: (theme) => picked.push(theme),
  });
  assert.equal(tree.props.role, "radiogroup");
  assert.equal(tree.props["aria-labelledby"], "interface-theme-title");
  assert.equal(tree.props.class, "v2-pal-grid");
  const tiles = byClass(tree, "v2-pal");
  assert.equal(tiles.length, 18);
  const inputs = tiles.map((tile) => one(tile, "input"));
  assert.deepEqual(
    inputs.map((input) => input.props.value),
    [...themes.interfaceThemes],
  );
  // Each tile is a label: the radio, four dots hidden from assistive
  // technology, the palette's name and, when chosen, the check.
  assert.deepEqual(
    tiles.map((tile) => spoken(tile)),
    THEMES.map((key) => themes.themeLabels[key]),
  );
  assert.equal(spoken(tiles[1]), "Nordic");
  for (const [at, tile] of tiles.entries()) {
    assert.equal(tile.type, "label");
    assert.equal(inputs[at].props.type, "radio");
    assert.equal(inputs[at].props.name, "interfaceTheme");
    const dots = byClass(tile, "v2-pal-dots")[0];
    assert.equal(dots.props["aria-hidden"], "true");
    const key = THEMES[at];
    assert.deepEqual(
      data(nodes(dots.props.children).map((dot) => dot.props.style.background)),
      [...model.paletteDots(key, "dark")],
    );
    assert.equal(byClass(tile, "v2-pal-name").length, 1);
  }
  assert.deepEqual(
    inputs.map((input) => input.props.checked),
    THEMES.map((key) => key === "catppuccin"),
  );
  assert.deepEqual(
    tiles.map((tile) => byClass(tile, "v2-pal-check").length),
    THEMES.map((key) => (key === "catppuccin" ? 1 : 0)),
  );
  inputs[1].props.onChange();
  assert.deepEqual(picked, ["nord"]);
  // The dots follow the mode; an unknown value chooses no tile but default.
  const light = once(PalettePicker, {
    labelledBy: "x",
    value: "unknown",
    mode: "light",
    change: f,
  });
  const lightTiles = byClass(light, "v2-pal");
  assert.deepEqual(
    data(
      nodes(byClass(lightTiles[1], "v2-pal-dots")[0].props.children).map(
        (dot) => dot.props.style.background,
      ),
    ),
    [...model.paletteDots("nord", "light")],
  );
  assert.deepEqual(
    lightTiles.map((tile) => one(tile, "input").props.checked),
    THEMES.map((key) => key === "default"),
  );
});

test("the palette preview scopes both modes", () => {
  const { PalettePreview } = settingsModule("PalettePreview");
  const blocksOf = (tree) => byClass(tree, "v2-pal-prev");
  const preview = once(PalettePreview, { theme: "nord", band: null });
  const blocks = blocksOf(preview);
  assert.equal(blocks.length, 2);
  // Each mode its scope, its palette, its default band and the inline
  // palette and status tokens.
  assert.deepEqual(
    blocks.map((block) => [
      block.props["data-palette-scope"],
      block.props["data-palette"],
      block.props["data-theme"],
      block.props["data-band"],
      block.props["aria-hidden"],
    ]),
    [
      ["", "nord", "dark", "muted", "true"],
      ["", "nord", "light", "strong", "true"],
    ],
  );
  for (const [at, mode] of ["dark", "light"].entries()) {
    const style = data(blocks[at].props.style);
    assert.deepEqual(style, data(model.previewStyle("nord", mode)));
    assert.ok(style["--accent"]);
    assert.ok(style["--status-info"]);
  }
  // A drafted band holds for both modes.
  assert.deepEqual(
    blocksOf(once(PalettePreview, { theme: "nord", band: "strong" })).map(
      (block) => block.props["data-band"],
    ),
    ["strong", "strong"],
  );
  assert.deepEqual(
    blocksOf(once(PalettePreview, { theme: "nord", band: "muted" })).map(
      (block) => block.props["data-band"],
    ),
    ["muted", "muted"],
  );
  // The mini band, the head with mode and palette, the table and the two
  // surfaces drawn as buttons, never controls.
  const [dark] = blocks;
  assert.equal(text(byClass(dark, "v2-pal-prev-band")[0]), "Movie library");
  assert.equal(text(byClass(dark, "v2-pal-prev-head")[0]), "Dark themeNordic");
  assert.equal(
    text(byClass(blocks[1], "v2-pal-prev-head")[0]),
    "Light themeNordic",
  );
  const table = byClass(dark, "v2-pal-prev-table")[0];
  const rows = byClass(table, "v2-pal-prev-row");
  assert.equal(rows.length, 2);
  assert.equal(text(rows[0]), "TitleResolutionAudio tracks");
  assert.match(text(rows[1]), /^Arrival/);
  assert.deepEqual(
    ofType(rows[1], "MediaTag").map((tag) => [
      tag.props.value,
      tag.props.forceTag,
    ]),
    [
      ["1080p", true],
      ["DTS · 5.1", true],
    ],
  );
  const buttons = byClass(dark, "v2-pal-prev-btns")[0];
  assert.equal(text(buttons), "SaveCancel");
  assert.equal(ofType(dark, "button").length, 0);
  assert.equal(ofType(dark, "input").length, 0);
  // An unknown palette is the default, as applyInterfaceTheme treats it.
  const unknown = blocksOf(once(PalettePreview, { theme: "x", band: null }));
  assert.equal(unknown[0].props["data-palette"], "default");
  assert.equal(
    text(byClass(unknown[0], "v2-pal-prev-head")[0]),
    "Dark themeDefault",
  );
});

// --- ColumnOrderEditor and OrderList ------------------------------------------------

const LABELS = { title: "Title", year: "Year", audio: "Audio tracks" };
const editorProps = (change) => ({
  list: "Movies",
  order: ["title", "year", "audio"],
  visible: ["year"],
  labels: LABELS,
  fixed: ["title"],
  change,
});

test("the column editor lists, locks and moves entries", () => {
  const { ColumnOrderEditor, OrderList } = settingsModule("ColumnOrderEditor");
  const changes = [];
  const editor = once(
    ColumnOrderEditor,
    editorProps((order, visible) => changes.push([order, visible])),
  );
  assert.equal(editor.props.class, "v2-set-cols");
  const list = one(editor, OrderList);
  assert.equal(list.props.ariaPrefix, "Movies");
  const ol = once(OrderList, list.props);
  assert.equal(ol.type, "ol");
  assert.equal(ol.props.class, "v2-order");
  const items = byClass(ol, "v2-order-item");
  assert.deepEqual(
    items.map((item) => [item.type, item.key]),
    [
      ["li", "title"],
      ["li", "year"],
      ["li", "audio"],
    ],
  );
  const box = (item) => one(item, "input");
  const moves = (item) =>
    byClass(item, "v2-order-move").flatMap((n) => ofType(n, "button"));
  assert.deepEqual(
    items.map((item) => box(item).props["aria-label"]),
    ["Movies: Title", "Movies: Year", "Movies: Audio tracks"],
  );
  assert.deepEqual(
    items.flatMap((item) => moves(item).map((b) => b.props["aria-label"])),
    [
      "Movies: Title · Move up",
      "Movies: Title · Move down",
      "Movies: Year · Move up",
      "Movies: Year · Move down",
      "Movies: Audio tracks · Move up",
      "Movies: Audio tracks · Move down",
    ],
  );
  // The fixed entry: its hint and lock; it cannot move and nothing moves
  // above it.
  assert.equal(text(byClass(items[0], "v2-order-hint")[0]), "always first");
  assert.equal(byClass(items[0], "v2-order-lock").length, 1);
  assert.equal(byClass(items[1], "v2-order-lock").length, 0);
  assert.equal(byClass(items[1], "v2-order-hint").length, 0);
  assert.deepEqual(
    items.map((item) => moves(item).map((b) => b.props.disabled)),
    [
      [true, true],
      [true, false],
      [false, true],
    ],
  );
  assert.deepEqual(
    items.map((item) => [box(item).props.checked, box(item).props.disabled]),
    [
      [false, false],
      [true, false],
      [false, false],
    ],
  );
  assert.equal(byClass(ol, "v2-check").length, 3);
  // Moving and showing report the new order and visibility.
  moves(items[1])[1].props.onClick();
  box(items[2]).props.onChange({ currentTarget: { checked: true } });
  box(items[1]).props.onChange({ currentTarget: { checked: false } });
  assert.deepEqual(data(changes), [
    [["title", "audio", "year"], ["year"]],
    [
      ["title", "year", "audio"],
      ["year", "audio"],
    ],
    [["title", "year", "audio"], []],
  ]);
  // Always visible: checked and locked, with its hint and lock; icons
  // sit before the name.
  const icons = once(OrderList, {
    ariaPrefix: "Icons",
    order: ["link", "file"],
    visible: [],
    labels: { link: "Media server link", file: "File" },
    icons: { link: "LINK", file: "FILE" },
    alwaysVisible: ["file"],
    change: f,
  });
  const [link, file] = byClass(icons, "v2-order-item");
  assert.equal(text(byClass(file, "v2-order-hint")[0]), "always visible");
  assert.equal(byClass(file, "v2-order-lock").length, 1);
  assert.deepEqual(
    [box(file).props.checked, box(file).props.disabled],
    [true, true],
  );
  assert.match(text(link), /^LINKMedia server link/);
});

test("the column preview follows the order", () => {
  const { ColumnOrderEditor } = settingsModule("ColumnOrderEditor");
  const preview = (props) =>
    byClass(once(ColumnOrderEditor, props), "v2-colprev")[0];
  const cells = (tree) =>
    byClass(tree, "v2-colprev-cell").map((cell) => [
      cell.key,
      text(byClass(cell, "v2-colprev-n")[0]),
      text(cell),
    ]);
  const base = editorProps(f);
  assert.deepEqual(cells(preview({ ...base, visible: ["year", "title"] })), [
    ["title", "1", "1Title"],
    ["year", "2", "2Year"],
  ]);
  assert.deepEqual(
    cells(
      preview({
        ...base,
        order: ["audio", "year", "title"],
        visible: ["title", "audio"],
      }),
    ),
    [
      ["audio", "1", "1Audio tracks"],
      ["title", "2", "2Title"],
    ],
  );
  // Always visible entries count as visible.
  assert.deepEqual(
    cells(preview({ ...base, visible: [], alwaysVisible: ["audio"] })),
    [["audio", "1", "1Audio tracks"]],
  );
});

// --- The 5a blocks' new props ---------------------------------------------------------

test("segmented tabs keep their width with an unsaved-change marker", () => {
  const { Segmented } = listModule("Segmented");
  const items = [
    { value: "info", label: "Info" },
    { value: "log", label: "Log" },
  ];
  const variants = [
    { label: "System sections", kind: "tabs", value: "info", items, select: f },
    {
      label: "System sections",
      kind: "tabs",
      value: "log",
      items,
      select: f,
      onBand: true,
      idPrefix: "system",
    },
    {
      label: "Instances",
      kind: "links",
      value: "a",
      items: [
        { value: "a", label: "All", href: "#/a" },
        { value: "b", label: "B", href: "#/b" },
      ],
      select: f,
      onBand: true,
    },
  ];
  // Without the new props: the VNodes of the BASE.
  assert.deepEqual(
    data(variants.map((props) => shape(once(Segmented, props)))),
    GOLDEN.segmented,
  );
  // dirty: the mark is always rendered and only data-on shows it; the
  // hidden text follows it only while it shows, so the name starts with
  // the label.
  const marked = once(Segmented, {
    ...variants[1],
    items: [
      { value: "info", label: "Info", dirty: true },
      { value: "log", label: "Log", dirty: false },
    ],
  });
  const tabs = byRole(marked, "tab");
  const marks = tabs.map((tab) => byClass(tab, "v2-seg-dirty"));
  assert.deepEqual(
    marks.map((found) => found.length),
    [1, 1],
  );
  assert.deepEqual(
    marks.map(([mark]) => [
      mark.type,
      mark.props["data-on"],
      mark.props["aria-hidden"],
    ]),
    [
      ["span", "", "true"],
      ["span", undefined, "true"],
    ],
  );
  assert.deepEqual(
    tabs.map((tab) => spoken(tab)),
    ["Info Unsaved changes", "Log"],
  );
  assert.deepEqual(
    tabs.map((tab) => byClass(tab, "v2-sr-only").length),
    [1, 0],
  );
  // The mark comes after the label.
  const [label, mark] = [tabs[0].props.children].flat().filter(Boolean);
  assert.equal(label, "Info");
  assert.deepEqual(classes(mark), ["v2-seg-dirty"]);
  // dot: a toned dot before the label, hidden from assistive technology.
  const dotted = once(Segmented, {
    ...variants[0],
    items: [
      { value: "info", label: "Radarr", dot: "ok" },
      { value: "log", label: "Unraid", dot: "error" },
    ],
  });
  const dots = byRole(dotted, "tab").map((tab) => {
    const [dot, name] = [tab.props.children].flat().filter(Boolean);
    assert.deepEqual(classes(dot), ["v2-seg-dot"]);
    assert.equal(dot.props["aria-hidden"], "true");
    return [dot.props["data-tone"], name];
  });
  assert.deepEqual(dots, [
    ["ok", "Radarr"],
    ["error", "Unraid"],
  ]);
  assert.equal(byClass(dotted, "v2-seg-dirty").length, 0);
  // Without the props on one item it keeps the plain label.
  const mixed = once(Segmented, {
    ...variants[0],
    items: [{ value: "info", label: "Info", dirty: false }, items[1]],
  });
  assert.equal(byRole(mixed, "tab")[1].props.children, "Log");
});

test("the filter bar works without a preset", () => {
  const { FilterBar } = listModule("FilterBar");
  const bar = {
    search: { label: "Search", placeholder: "Search …", value: "x", change: f },
    preset: {
      label: "Filter preset",
      value: "1",
      options: [{ value: "1", label: "One" }],
      custom: true,
      choose: f,
    },
    filters: { count: 3, expanded: false, open: f },
  };
  // With a preset: the VNodes of the BASE.
  assert.deepEqual(
    data([
      shape(once(FilterBar, bar)),
      shape(
        once(FilterBar, { ...bar, preset: { ...bar.preset, custom: false } }),
      ),
    ]),
    GOLDEN.filterBar,
  );
  // Without: no select, the search and Filters as before.
  const plain = once(FilterBar, { ...bar, preset: undefined });
  assert.equal(ofType(plain, "select").length, 0);
  const expected = structuredClone(GOLDEN.filterBar[0]);
  expected.children[1] = null;
  assert.deepEqual(data(shape(plain)), expected);
});

test("table cards may leave out the chips row and the footer", () => {
  const { TableCard } = listModule("TableCard", {
    "../../hooks/useTableOverflow": { useTableOverflow: () => false },
  });
  const CARD = {
    id: "jobs",
    title: "Jobs",
    count: 12,
    countTitle: "Items in the list",
    busy: false,
    bar: "BAR",
    chips: "CHIPS",
    density: "comfortable",
    regionLabel: "Jobs",
    foot: "FOOT",
    children: "TABLE",
  };
  // With both: the VNodes recorded in Phase 5b.
  assert.deepEqual(
    data(shape(once(TableCard, CARD))),
    LIST_GOLDEN.tableCard[0],
  );
  // Without chips no chips row, without foot no footer; nothing else
  // changes.
  const { chips: _chips, foot: _foot, ...bare } = CARD;
  const tree = once(TableCard, bare);
  assert.equal(byClass(tree, "v2-tc-foot").length, 0);
  assert.doesNotMatch(text(tree), /CHIPS|FOOT/);
  const expected = structuredClone(LIST_GOLDEN.tableCard[0]);
  expected.children[1] = null;
  expected.children[3] = null;
  assert.deepEqual(data(shape(tree)), expected);
  // Each on its own.
  const footOnly = data(shape(once(TableCard, { ...CARD, chips: undefined })));
  assert.equal(footOnly.children[1], null);
  assert.equal(footOnly.children[3].props.class, "v2-tc-foot");
  const chipsOnly = data(shape(once(TableCard, { ...CARD, foot: undefined })));
  assert.equal(chipsOnly.children[1], "CHIPS");
  assert.equal(chipsOnly.children[3], null);
});
