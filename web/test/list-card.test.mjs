import test from "node:test";
import assert from "node:assert/strict";
import * as preact from "preact";
import { loadSource, nodes, text } from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";
import * as color from "../src/color.ts";
import * as resolution from "../src/resolution-groups.ts";
import * as tagDisplay from "../src/tag-display.ts";
import * as tagLabels from "../src/tag-labels.ts";
import * as units from "../src/units.ts";

// The results card of the lists (Phase 5a, task 5; docs/STYLEGUIDE.md,
// Part 1, 10.5 and 10.10): TableCard with useTableOverflow, FilterBar and
// ChipsRow, built but not mounted yet. Each component runs as real code
// with the hook runtime; browser APIs (ResizeObserver, document) are fakes
// passed in explicitly.

const t = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");
const i18n = { t, getLocale: () => "en", useI18n: () => ({ locale: "en" }) };

// Every module shares one hooks object; it calls the runtime that renders.
let current = createHookRuntime();
const hooks = new Proxy({}, { get: (_, name) => current.hooks[name] });
// The real ui.tsx: ICON and count.
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

// A component with its own runtime; render() renders it again with the same
// state (after a click), as Preact would; flush() runs its effects.
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
  };
  return view;
}
const once = (component, props) => mount(component, props).render();

const classes = (node) => (node?.props?.class ?? "").split(" ");
const byClass = (tree, name) =>
  nodes(tree).filter((n) => classes(n).includes(name));
const one = (tree, name) => {
  const found = byClass(tree, name);
  assert.equal(found.length, 1, "one ." + name);
  return found[0];
};
const ofType = (tree, type) => nodes(tree).filter((n) => n.type === type);
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
// A value of the sandbox as data of this realm.
const data = (value) => JSON.parse(JSON.stringify(value ?? null));

const listModule = (name, modules = {}, browser = {}) =>
  loadSource("components/list/" + name + ".tsx", {
    modules: {
      "preact/hooks": hooks,
      "../../ui": ui,
      "../../i18n": i18n,
      ...modules,
    },
    browser,
  });
const fixedOverflow = (value) => ({ useTableOverflow: () => value });

// --- TableCard ---------------------------------------------------------------

const CARD = {
  id: "movies",
  title: "Your movies",
  count: 1234,
  countTitle: "Items in the list",
  busy: false,
  bar: "BAR",
  chips: "CHIPS",
  density: "comfortable",
  regionLabel: "Your movies",
  foot: "FOOT",
  children: "TABLE",
};
const HINT =
  "Season context is hidden while sorting by another column. Choose the default title order to show season groups again.";

test("the card keeps a place for its spinner and hint", () => {
  const { TableCard } = listModule("TableCard", {
    "../../hooks/useTableOverflow": fixedOverflow(false),
  });
  const idle = once(TableCard, CARD);
  const busy = once(TableCard, { ...CARD, busy: true, hint: HINT });

  for (const tree of [idle, busy]) {
    // section > head, chips row, table region, foot, in this order.
    assert.equal(tree.type, "section");
    assert.deepEqual(classes(tree), ["v2-card", "v2-table-card"]);
    assert.equal(tree.props["aria-labelledby"], "movies-title");
    assert.deepEqual(
      data(
        tree.props.children.map((child) =>
          typeof child === "string" ? child : classes(child)[0],
        ),
      ),
      ["v2-tc-head", "CHIPS", "v2-table-scroll", "v2-tc-foot"],
    );
    // The heading names the card: the title, then its count.
    const title = ofType(tree, "h2")[0];
    assert.equal(title.props.id, "movies-title");
    assert.deepEqual(classes(title), ["v2-tc-title"]);
    assert.equal(spoken(title), "Your movies1,234");
    const total = one(title, "v2-count");
    assert.deepEqual(classes(total), ["v2-count", "v2-count--on"]);
    assert.equal(total.props.title, "Items in the list");
    // The head carries the filter bar after title and hint.
    const head = one(tree, "v2-tc-head");
    assert.equal(head.props.children.at(-1), "BAR");
    assert.equal(text(one(tree, "v2-tc-foot")), "FOOT");
  }

  // The spinner place is always there and hidden from assistive technology;
  // busy only shows it (and lets it turn).
  const [rest, turning] = [idle, busy].map((tree) =>
    one(one(tree, "v2-tc-head"), "v2-tc-busy"),
  );
  assert.deepEqual(classes(rest), ["v2-tc-busy"]);
  assert.deepEqual(classes(turning), ["v2-tc-busy", "v2-tc-busy--on"]);
  for (const place of [rest, turning]) {
    assert.equal(place.props["aria-hidden"], "true");
    assert.equal(typeof place.props.children.type, "function", "the spinner");
  }
  assert.equal(rest.props.children.props.class, undefined);
  assert.equal(turning.props.children.props.class, "v2-spin");

  // The hint line is always there; without a hint it is empty.
  const [none, shown] = [idle, busy].map((tree) => one(tree, "v2-tc-hint"));
  assert.equal(none.type, "p");
  assert.equal(text(none), "");
  assert.equal(none.props.title, undefined);
  assert.equal(shown.type, "p");
  assert.equal(text(shown), HINT);
  assert.equal(shown.props.title, HINT, "a cut hint keeps its full text");

  // The region is busy while results load; the card carries its density.
  assert.equal(one(idle, "v2-table-scroll").props["aria-busy"], false);
  assert.equal(one(busy, "v2-table-scroll").props["aria-busy"], true);
  // A tool's activity turns the spinner without dimming the rows (Phase
  // 5b, Task 10: a dimmed table fails its contrast for a whole move).
  const active = once(TableCard, { ...CARD, busy: true, dimmed: false });
  assert.deepEqual(classes(one(one(active, "v2-tc-head"), "v2-tc-busy")), [
    "v2-tc-busy",
    "v2-tc-busy--on",
  ]);
  assert.equal(one(active, "v2-table-scroll").props["aria-busy"], false);
  assert.equal(text(one(idle, "v2-table-scroll")), "TABLE");
  assert.equal(idle.props["data-density"], "comfortable");
  assert.equal(
    once(TableCard, { ...CARD, density: "compact" }).props["data-density"],
    "compact",
  );
});

// A ResizeObserver fake: it records what it watches; fire() calls back.
function fakeResizeObserver() {
  const made = [];
  class FakeResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.watched = new Set();
      this.disconnected = false;
      made.push(this);
    }
    observe(element) {
      this.watched.add(element);
    }
    unobserve(element) {
      this.watched.delete(element);
    }
    disconnect() {
      this.watched.clear();
      this.disconnected = true;
    }
    fire() {
      this.callback([]);
    }
  }
  return { ResizeObserver: FakeResizeObserver, made };
}
// A box of a given width, as getBoundingClientRect reads it.
const box = (width) => ({
  width,
  getBoundingClientRect() {
    return { width: this.width };
  },
});
// A table region: a box with a style whose overflow-x: scroll shows a
// horizontal scrollbar of `bar` pixels (0: overlay scrollbars), and the
// table its querySelector finds.
function regionBox(width, bar = 0) {
  const region = box(width);
  region.table = null;
  region.querySelector = (selector) => {
    assert.equal(selector, "table");
    return region.table;
  };
  region.style = {
    overflowX: "",
    set: [],
    setProperty(name, value) {
      this.set.push([name, value]);
    },
  };
  Object.defineProperties(region, {
    offsetHeight: { get: () => 300 },
    clientHeight: {
      get: () => (region.style.overflowX === "scroll" ? 300 - bar : 300),
    },
  });
  return region;
}
// A TableCard with the real useTableOverflow and a ResizeObserver fake.
function cardWithRegion(region) {
  const { ResizeObserver, made } = fakeResizeObserver();
  const overflow = loadSource("hooks/useTableOverflow.ts", {
    modules: { "preact/hooks": hooks },
    browser: { ResizeObserver },
  });
  const { TableCard } = listModule("TableCard", {
    "../../hooks/useTableOverflow": overflow,
  });
  const card = mount(TableCard, CARD);
  const scroll = () => one(card.render(), "v2-table-scroll");
  scroll().ref.current = region;
  card.flush();
  return { card, scroll, observer: made[0], made };
}

test("the table region knows when it overflows", () => {
  const { ResizeObserver, made } = fakeResizeObserver();
  const overflow = loadSource("hooks/useTableOverflow.ts", {
    modules: { "preact/hooks": hooks },
    browser: { ResizeObserver },
  });
  const { TableCard } = listModule("TableCard", {
    "../../hooks/useTableOverflow": overflow,
  });
  const card = mount(TableCard, CARD);
  const scroll = () => one(card.render(), "v2-table-scroll");

  // Before it is measured the region is neither a region nor focusable.
  const first = scroll();
  for (const name of ["role", "aria-label", "tabIndex", "data-overflow"])
    assert.equal(first.props[name], undefined, name);

  // The table fits: no overflow; the hook watches the region and the table.
  const region = regionBox(800);
  let table = box(800);
  region.querySelector = (selector) => {
    assert.equal(selector, "table");
    return table;
  };
  first.ref.current = region;
  card.flush();
  assert.equal(made.length, 1);
  const [observer] = made;
  assert.deepEqual([...observer.watched], [region, table]);
  assert.equal(card.runtime.changed, false);
  assert.equal(scroll().props["data-overflow"], undefined);

  // Wider than its region: a focusable named region that scrolls sideways.
  table.width = 960;
  observer.fire();
  assert.equal(card.runtime.changed, true);
  let wide = scroll();
  assert.equal(wide.props["data-overflow"], "");
  assert.equal(wide.props.role, "region");
  assert.equal(wide.props["aria-label"], "Your movies");
  assert.equal(wide.props.tabIndex, 0);

  // A sub-pixel difference is no overflow.
  table.width = 800.4;
  observer.fire();
  assert.equal(scroll().props["data-overflow"], undefined);
  assert.equal(scroll().props.role, undefined);

  // A narrower card overflows as well; a wider one again does not.
  table.width = 800;
  region.width = 640;
  observer.fire();
  assert.equal(scroll().props["data-overflow"], "");
  region.width = 1000;
  table.width = 1000;
  observer.fire();
  wide = scroll();
  for (const name of ["role", "aria-label", "tabIndex", "data-overflow"])
    assert.equal(wide.props[name], undefined, name);

  // A new table (an empty state and back) is watched instead of the old one.
  const old = table;
  table = box(1200);
  observer.fire();
  assert.deepEqual([...observer.watched], [region, table]);
  assert.ok(!observer.watched.has(old));
  assert.equal(scroll().props["data-overflow"], "");
  table = null;
  observer.fire();
  assert.deepEqual([...observer.watched], [region]);
  assert.equal(scroll().props["data-overflow"], undefined);

  // Unmounting stops watching.
  card.runtime.unmount();
  assert.equal(observer.disconnected, true);
  assert.equal(observer.watched.size, 0);
  assert.equal(made.length, 1, "one observer for the card's life");
});

test("the region keeps the place of its scrollbar", () => {
  // A classic scrollbar of 12: measured once with overflow-x: scroll, then
  // reserved below the table while it fits; the style is restored.
  const classic = regionBox(800, 12);
  classic.table = box(800);
  const { card, scroll, observer } = cardWithRegion(classic);
  assert.deepEqual(classic.style.set, [["--tc-gutter", "12px"]]);
  assert.equal(classic.style.overflowX, "");
  classic.table.width = 960;
  observer.fire();
  assert.equal(scroll().props["data-overflow"], "");
  classic.table.width = 800;
  observer.fire();
  assert.deepEqual(classic.style.set, [["--tc-gutter", "12px"]], "once");
  card.runtime.unmount();

  // Overlay scrollbars take no place: nothing is reserved.
  const overlay = regionBox(800, 0);
  overlay.table = box(800);
  cardWithRegion(overlay);
  assert.deepEqual(overlay.style.set, [["--tc-gutter", "0px"]]);
  assert.equal(overlay.style.overflowX, "");
});

test("a focused region keeps its focus when the overflow ends", () => {
  const region = regionBox(800);
  region.table = box(960);
  const { card, scroll, observer } = cardWithRegion(region);
  const named = (node) =>
    data([node.props.role, node.props["aria-label"], node.props.tabIndex]);
  assert.deepEqual(named(scroll()), ["region", "Your movies", 0]);

  // Focus on the region, then the card grows: the table fits, the region
  // no longer scrolls, but keeps its name and its place in the tab order
  // until focus leaves it, so focus never falls to the page.
  scroll().props.onFocus();
  region.width = 1000;
  observer.fire();
  const fitted = scroll();
  assert.equal(fitted.props["data-overflow"], undefined);
  assert.deepEqual(named(fitted), ["region", "Your movies", 0]);
  fitted.props.onBlur();
  assert.deepEqual(named(scroll()), [null, null, null]);

  // Without focus the overflow alone decides.
  region.width = 800;
  observer.fire();
  assert.deepEqual(named(scroll()), ["region", "Your movies", 0]);
  region.width = 1000;
  observer.fire();
  assert.deepEqual(named(scroll()), [null, null, null]);
  card.runtime.unmount();
});

// --- FilterBar ---------------------------------------------------------------

const OPTIONS = [
  { value: "all", label: "All files" },
  { value: "7", label: "HEVC only" },
];
function bar({ filters = {}, preset = {}, search = {} } = {}) {
  return {
    search: {
      label: "Title or filename",
      placeholder: "Search movie or file …",
      value: "",
      change() {},
      ...search,
    },
    preset: {
      label: "Filter preset",
      value: "all",
      options: OPTIONS,
      custom: false,
      choose() {},
      ...preset,
    },
    filters: { count: 0, expanded: false, open() {}, ...filters },
  };
}

test("the filter button carries its count and state", () => {
  const { FilterBar } = listModule("FilterBar");
  const opened = [];
  const closed = once(
    FilterBar,
    bar({ filters: { open: (anchor) => opened.push(anchor) } }),
  );
  assert.deepEqual(classes(closed), ["v2-filter-bar"]);
  const [button] = ofType(closed, "button");
  assert.equal(button.props.type, "button");
  assert.deepEqual(classes(button), ["v2-btn"]);
  assert.equal(button.props["aria-haspopup"], "dialog");
  assert.equal(button.props["aria-expanded"], false);
  // Named "Filters"; the count shows in a slot and is not part of the name.
  assert.equal(spoken(button), "Filters");
  const zero = one(button, "v2-count");
  assert.deepEqual(classes(zero), ["v2-count"]);
  assert.equal(zero.props["aria-hidden"], "true");
  assert.equal(text(zero), "0");
  // A press opens the drawer from this button.
  const anchor = { name: "the Filters button" };
  button.props.onClick({ currentTarget: anchor });
  assert.deepEqual(opened, [anchor]);

  const open = once(
    FilterBar,
    bar({ filters: { count: 12, expanded: true, open() {} } }),
  );
  const [shown] = ofType(open, "button");
  assert.equal(shown.props["aria-expanded"], true);
  assert.equal(spoken(shown), "Filters");
  const twelve = one(shown, "v2-count");
  assert.deepEqual(classes(twelve), ["v2-count", "v2-count--on"]);
  assert.equal(text(twelve), "12");
  assert.equal(
    text(one(once(FilterBar, bar({ filters: { count: 1234 } })), "v2-count")),
    "1,234",
  );

  // The search: a field group named by its label, with its placeholder.
  const typed = [];
  const field = once(
    FilterBar,
    bar({ search: { value: "arri", change: (value) => typed.push(value) } }),
  );
  const group = one(field, "v2-input-group");
  const [input] = ofType(group, "input");
  assert.deepEqual(classes(input), ["v2-input"]);
  assert.equal(input.props["aria-label"], "Title or filename");
  assert.equal(input.props.placeholder, "Search movie or file …");
  assert.equal(input.props.value, "arri");
  input.props.onInput({ currentTarget: { value: "arriv" } });
  assert.deepEqual(typed, ["arriv"]);
  // Its icon comes first and is decorative.
  const [icon] = group.props.children;
  assert.equal(typeof icon.type, "function");
  assert.equal(icon.props.class, "v2-input-icon");
  // Search, preset, Filters: in this order.
  assert.deepEqual(
    data(field.props.children.filter(Boolean).map((child) => child.type)),
    ["div", "select", "button"],
  );
});

test("the preset select names the shown filters", () => {
  const { FilterBar } = listModule("FilterBar");
  const chosen = [];
  const choose = (value) => chosen.push(value);
  const options = (tree) =>
    ofType(tree, "option").map((o) => [
      o.props.value,
      text(o),
      o.props.disabled ?? false,
    ]);

  // No filters: All files.
  const all = once(FilterBar, bar({ preset: { choose } }));
  const [select] = ofType(all, "select");
  assert.deepEqual(classes(select), ["v2-select"]);
  assert.equal(select.props["aria-label"], "Filter preset");
  assert.equal(select.props.value, "all");
  assert.deepEqual(options(all), [
    ["all", "All files", false],
    ["7", "HEVC only", false],
  ]);
  select.props.onChange({ currentTarget: { value: "7" } });
  assert.deepEqual(chosen, ["7"]);

  // The filters of a preset: that preset.
  const preset = once(FilterBar, bar({ preset: { value: "7" } }));
  assert.equal(ofType(preset, "select")[0].props.value, "7");
  assert.equal(options(preset).length, 2);

  // Filters that match no preset: the disabled Custom selection, last.
  const custom = once(FilterBar, bar({ preset: { custom: true, choose } }));
  const [mixed] = ofType(custom, "select");
  assert.deepEqual(options(custom), [
    ["all", "All files", false],
    ["7", "HEVC only", false],
    ["", "Custom selection", true],
  ]);
  assert.equal(mixed.props.value, "", "Custom selection is the shown one");
  mixed.props.onChange({ currentTarget: { value: "all" } });
  assert.deepEqual(chosen, ["7", "all"]);

  // A service without presets keeps the select, with All files only.
  const alone = once(
    FilterBar,
    bar({ preset: { options: [OPTIONS[0]], custom: true } }),
  );
  assert.deepEqual(options(alone), [
    ["all", "All files", false],
    ["", "Custom selection", true],
  ]);
  assert.equal(ofType(alone, "select")[0].props.disabled, undefined);
});

// --- ChipsRow ----------------------------------------------------------------

const chip = (key, label, excluded, removed) => ({
  key,
  label,
  excluded,
  remove: () => removed.push(key),
});
const ROW = { label: "Filters", empty: "No active filters", tools: "TOOLS" };

test("chips remove themselves and reset clears all", () => {
  const { ChipsRow } = listModule("ChipsRow");
  const removed = [];
  let resets = 0;
  const chips = [
    chip("resolution=1080p", "Resolution: 1080p", false, removed),
    chip("audio=DTS", "Audio codec ≠ DTS", true, removed),
    chip("hdr", "HDR contains all: HDR10 + Dolby Vision", false, removed),
    chip("q", "Search: arrival: part 2", false, removed),
  ];
  const tree = once(ChipsRow, {
    ...ROW,
    chips,
    reset: () => resets++,
  });
  assert.deepEqual(classes(tree), ["v2-chips-row"]);
  // A named group on the left, the page tools on the right.
  const [group] = byRole(tree, "group");
  assert.equal(group.props["aria-label"], "Filters");
  assert.deepEqual(classes(group), ["v2-chips-group"]);
  const tools = one(tree, "v2-tc-tools");
  assert.equal(text(tools), "TOOLS");
  // The group, Reset filters after it (not in its scroller), the tools.
  const [reset] = byClass(tree, "v2-text-btn");
  const parts = tree.props.children.filter(Boolean);
  assert.equal(parts.length, 3);
  assert.equal(parts[0], group);
  assert.equal(parts[1], reset);
  assert.equal(parts[2], tools);

  // Each chip is a button named by its label; its field name comes first.
  const buttons = byClass(group, "v2-chip");
  assert.deepEqual(
    buttons.map((b) => [b.type, b.props.type, spoken(b), classes(b)]),
    [
      ["button", "button", "Resolution: 1080p", ["v2-chip"]],
      [
        "button",
        "button",
        "Audio codec ≠ DTS",
        ["v2-chip", "v2-chip--excluded"],
      ],
      [
        "button",
        "button",
        "HDR contains all: HDR10 + Dolby Vision",
        ["v2-chip"],
      ],
      ["button", "button", "Search: arrival: part 2", ["v2-chip"]],
    ],
  );
  assert.deepEqual(
    buttons.map((b) => text(one(b, "v2-chip-field"))),
    ["Resolution", "Audio codec", "HDR contains all", "Search"],
  );
  // Each ends in the X icon at the chip size.
  for (const b of buttons) {
    const x = one(b, "v2-chip-x");
    assert.equal(typeof x.type, "function");
    assert.equal(x.props.size, ui.ICON.chip);
    assert.equal(b.props.children.at(-1), x);
  }

  // A press removes that chip's filter, and only that one.
  buttons[1].props.onClick();
  assert.deepEqual(removed, ["audio=DTS"]);
  buttons[3].props.onClick();
  assert.deepEqual(removed, ["audio=DTS", "q"]);

  // Reset filters follows the chips as a text button and clears them all.
  assert.equal(reset.type, "button");
  assert.equal(reset.props.type, "button");
  assert.equal(spoken(reset), "Reset filters");
  assert.equal(byClass(group, "v2-text-btn").length, 0, "outside the group");
  reset.props.onClick();
  assert.equal(resets, 1);
  assert.deepEqual(removed, ["audio=DTS", "q"]);
  assert.equal(byClass(tree, "v2-chips-empty").length, 0);

  // Without a reset action the row shows no Reset filters.
  const plain = once(ChipsRow, { ...ROW, chips });
  assert.equal(byClass(plain, "v2-text-btn").length, 0);
  assert.equal(byClass(plain, "v2-chip").length, 4);
  assert.equal(plain.props.children.filter(Boolean).length, 2);
});

test("twenty chips keep Reset filters in reach", () => {
  const { ChipsRow } = listModule("ChipsRow");
  const removed = [];
  let resets = 0;
  const chips = Array.from({ length: 20 }, (_, n) =>
    chip("resolution=" + n, "Resolution: " + n, n % 2 === 1, removed),
  );
  const tree = once(ChipsRow, { ...ROW, chips, reset: () => resets++ });
  const [group] = byRole(tree, "group");
  assert.equal(byClass(group, "v2-chip").length, 20);
  // The group scrolls sideways; Reset filters is not in it but beside it,
  // before the tools, so no chip count hides it or scrolls it away.
  assert.equal(byClass(group, "v2-text-btn").length, 0);
  assert.deepEqual(
    data(tree.props.children.filter(Boolean).map((part) => classes(part)[0])),
    ["v2-chips-group", "v2-text-btn", "v2-tc-tools"],
  );
  const reset = tree.props.children.filter(Boolean)[1];
  // A plain button in the tab order, after the last chip.
  assert.equal(reset.type, "button");
  assert.equal(reset.props.tabIndex, undefined);
  assert.equal(reset.props.disabled, undefined);
  assert.equal(spoken(reset), "Reset filters");
  reset.props.onClick();
  assert.equal(resets, 1);
  assert.deepEqual(removed, []);
});

test("an empty chips row says so", () => {
  const { ChipsRow } = listModule("ChipsRow");
  const tree = once(ChipsRow, { ...ROW, chips: [], reset() {} });
  const [group] = byRole(tree, "group");
  assert.equal(group.props["aria-label"], "Filters");
  const empty = one(group, "v2-chips-empty");
  assert.equal(empty.type, "span");
  assert.equal(text(group), "No active filters");
  assert.equal(byClass(tree, "v2-chip").length, 0);
  assert.equal(byClass(tree, "v2-text-btn").length, 0, "nothing to reset");
  assert.equal(text(one(tree, "v2-tc-tools")), "TOOLS");
});

test("a removed chip passes its focus on", () => {
  const body = { name: "body" };
  const document = { body, activeElement: body };
  const { ChipsRow } = listModule("ChipsRow", {}, { document });
  const focused = [];
  const element = (name) => ({ name, focus: () => focused.push(name) });
  let shown = [];
  const outside = element("outside");
  const groupBox = {
    ...element("group"),
    contains: (node) => shown.includes(node),
    querySelectorAll(selector) {
      assert.equal(selector, ".v2-chip");
      return shown;
    },
  };
  const removed = [];
  const list = (...keys) =>
    keys.map((key) => chip(key, key + ": x", false, removed));
  const row = mount(ChipsRow, {
    ...ROW,
    chips: list("a", "b", "c"),
    reset() {},
  });
  const press = (tree, index) =>
    byClass(tree, "v2-chip")[index].props.onClick();
  const show = (...names) => (shown = names.map(element));
  let tree = row.render();
  byRole(tree, "group")[0].ref.current = groupBox;
  show("a", "b", "c");
  row.flush();
  assert.deepEqual(focused, []);

  // The second chip goes: focus moves to the chip now in its place.
  press(tree, 1);
  tree = row.render();
  row.flush();
  assert.deepEqual(focused, [], "nothing moves before the chip is gone");
  row.props = { ...row.props, chips: list("a", "c") };
  show("a", "c");
  tree = row.render();
  row.flush();
  assert.deepEqual(focused, ["c"]);
  assert.deepEqual(removed, ["b"]);

  // The last chip goes: focus moves to the one before it.
  press(tree, 1);
  row.props = { ...row.props, chips: list("a") };
  show("a");
  tree = row.render();
  row.flush();
  assert.deepEqual(focused, ["c", "a"]);

  // Focus that went elsewhere meanwhile stays there.
  press(tree, 0);
  document.activeElement = outside;
  row.props = { ...row.props, chips: list("d") };
  show("d");
  tree = row.render();
  row.flush();
  assert.deepEqual(focused, ["c", "a"]);
  document.activeElement = body;

  // Reset filters: no chip is left, so the group takes focus.
  byClass(tree, "v2-text-btn")[0].props.onClick();
  row.props = { ...row.props, chips: [] };
  show();
  tree = row.render();
  row.flush();
  assert.deepEqual(focused, ["c", "a", "group"]);
  const [group] = byRole(tree, "group");
  assert.equal(group.props.tabIndex, -1, "the group can take focus");

  // A later change of the chips moves no focus.
  row.props = { ...row.props, chips: list("e") };
  show("e");
  row.render();
  row.flush();
  assert.deepEqual(focused, ["c", "a", "group"]);
});

// --- Texts ---------------------------------------------------------------------

test("custom selection reads the same in every catalog", async () => {
  const { readFile } = await import("node:fs/promises");
  const read = async (locale) =>
    JSON.parse(
      await readFile(new URL(`../src/locales/${locale}.json`, import.meta.url)),
    ).messages;
  assert.deepEqual(
    data(
      await Promise.all(
        ["en", "de", "es", "it"].map(
          async (l) => (await read(l))["Custom selection"],
        ),
      ),
    ),
    [
      "Custom selection",
      "Eigene Auswahl",
      "Selección personalizada",
      "Selezione personalizzata",
    ],
  );
});

test("the preset buttons sit right after the select, before Filters", () => {
  const { FilterBar } = listModule("FilterBar");
  const calls = [];
  const tree = once(
    FilterBar,
    bar({
      preset: {
        save: () => calls.push("save"),
        remove: () => calls.push("remove"),
        removeDisabled: true,
      },
    }),
  );
  const buttons = ofType(tree, "button");
  assert.deepEqual(
    buttons.map((b) => b.props["aria-label"] ?? "filters"),
    ["Save preset", "Delete selected preset", "filters"],
  );
  assert.equal(buttons[0].props.title, "Save filters as a permanent preset");
  assert.equal(buttons[0].props.disabled, undefined);
  assert.equal(buttons[1].props.disabled, true);
  buttons[0].props.onClick();
  assert.deepEqual(calls, ["save"]);
  // Without the actions (the event log) there are none.
  const plain = once(FilterBar, bar());
  assert.equal(ofType(plain, "button").length, 1);
});
