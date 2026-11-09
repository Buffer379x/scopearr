import test from "node:test";
import assert from "node:assert/strict";
import * as preact from "preact";
import {
  loadSource,
  nodes,
  PRESENTATION_MODULES,
  stubModule,
  text,
} from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";
import * as color from "../src/color.ts";
import * as resolution from "../src/resolution-groups.ts";
import * as tagDisplay from "../src/tag-display.ts";
import * as tagLabels from "../src/tag-labels.ts";
import * as units from "../src/units.ts";

// The v2 building blocks of the tool pages (Phase 5b, task 4;
// docs/STYLEGUIDE.md, Part 1, 10.2, 10.3, 10.5, 10.7 and 10.10), built but
// not mounted yet: StatusTag, ProgressCell, ToolDiskTag and DiskTagCell,
// ToolKpis, DiskCards, ScanButton and ReportButton, and CheckField. Each
// component runs as real code with the hook runtime; each module is loaded
// inside its test, so a missing one fails only its own cases. Their rules
// are pinned in stylesheet-guards.test.mjs ("the tool blocks keep their
// measured and fixed sizes").

const t = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");
const i18n = { t, getLocale: () => "en", useI18n: () => ({ locale: "en" }) };

let current = createHookRuntime();
const hooks = new Proxy({}, { get: (_, name) => current.hooks[name] });
// The real ui.tsx: ICON, count, percent and the byte formats.
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
const spec = loadSource("mux-spec.ts", {
  modules: { "./languages.ts": { audioLanguage: () => null } },
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
const status = loadSource("tool-status.ts", {
  modules: {
    "./filecheck": fileCheck,
    "./mux-spec": spec,
    "./placement": placement,
    "./placement-messages": loadSource("placement-messages.ts"),
    "./tool-columns": columns,
  },
});
const list = loadSource("tool-list.ts", {
  modules: {
    "./i18n": i18n,
    "./mux-spec": spec,
    "./tool-filters": loadSource("tool-filters.ts"),
  },
});

const block = (path, { browser, ...modules } = {}) =>
  loadSource("components/" + path + ".tsx", {
    modules: {
      "preact/hooks": hooks,
      "../../ui": ui,
      "../../i18n": i18n,
      "../../placement": placement,
      "../../tool-list": list,
      ...modules,
    },
    browser,
    stubs: PRESENTATION_MODULES,
  });

// A component with its own runtime; render() renders it again with the
// same state, as Preact would.
function mount(component, props) {
  const runtime = createHookRuntime();
  return {
    runtime,
    render(next = props) {
      current = runtime;
      return runtime.render(() => component(next));
    },
  };
}
const once = (component, props) => mount(component, props).render();
const ofClass = (tree, name) =>
  nodes(tree).filter((n) =>
    String(n.props?.class ?? "")
      .split(" ")
      .includes(name),
  );
const ofType = (tree, type) => nodes(tree).filter((n) => n.type === type);
const classes = (node) => String(node.props.class).split(" ");
// The text a screen reader reads: aria-hidden parts drop out.
function spoken(tree) {
  if (Array.isArray(tree)) return tree.map(spoken).join("");
  if (tree && typeof tree === "object")
    return tree.props?.["aria-hidden"] === "true" ||
      tree.props?.["aria-hidden"] === true
      ? ""
      : spoken(tree.props?.children);
  return tree == null || typeof tree === "boolean" ? "" : String(tree);
}
const ok = { readable: true, writable: true };
const check = (state = {}) => ({
  state: { mover: false, parity: false, ...state },
  reachable: true,
  writable: true,
  freeSpace: true,
  unchanged: true,
  noConflict: true,
  readable: true,
  removable: true,
});

test("the tool blocks are presentation modules", () => {
  for (const path of [
    "components/tools/StatusTag",
    "components/tools/ProgressCell",
    "components/tools/ToolDiskTag",
  ]) {
    assert.ok(PRESENTATION_MODULES.includes(path), path);
    const name = path.split("/").pop();
    assert.equal(stubModule(path)[name], name);
  }
  assert.equal(
    stubModule("components/tools/ToolDiskTag").DiskTagCell,
    "DiskTagCell",
  );
});

test("status tags carry tone, short text and the long text", () => {
  const { StatusTag } = block("tools/StatusTag");
  const running = status.muxStatusView({ status: "running", check: ok }, t);
  const tag = once(StatusTag, { view: running });
  assert.equal(tag.type, "span");
  assert.deepEqual(classes(tag), ["v2-st"]);
  assert.equal(tag.props["data-tone"], "running");
  assert.equal(tag.props.title, running.long);
  assert.equal(text(tag), "Running");
  const [dot] = ofClass(tag, "v2-st-dot");
  assert.equal(dot.type, "span");
  assert.equal(dot.props["aria-hidden"], "true");
  assert.equal(ofClass(tag, "v2-dot--warn").length, 0);

  // A stored check with a blocker: the title ends on it, a warning dot sits
  // at the corner, the text stays the short one.
  const held = status.placementStatusView(
    {
      scanStatus: "split",
      jobStatus: "",
      message: "",
      check: check({ mover: true }),
    },
    t,
  );
  assert.equal(held.blocker, "Mover is running");
  const opened = [];
  const button = once(StatusTag, {
    view: held,
    open: () => opened.push("checks"),
    openLabel: t("Status: {label}. Show checks", { label: held.text }),
  });
  assert.equal(button.type, "button");
  assert.equal(button.props.type, "button");
  assert.deepEqual(classes(button), ["v2-st-btn"]);
  const [inner] = ofClass(button, "v2-st");
  assert.ok(inner.props.title.endsWith("Last check: Mover is running"));
  assert.ok(inner.props.title.startsWith(held.long));
  const [warn] = ofClass(inner, "v2-dot--warn");
  assert.deepEqual(classes(warn), ["v2-dot", "v2-dot--warn"]);
  assert.equal(warn.props["aria-hidden"], "true");
  assert.equal(text(inner), held.text);
  // Named after the text it shows (ruling I7), titled alike.
  assert.equal(
    button.props["aria-label"],
    "Status: " + held.text + ". Show checks",
  );
  assert.equal(button.props.title, button.props["aria-label"]);
  // The name hides the tag's title: the long text with the blocker is the
  // button's description, a hidden span it names.
  const description = nodes(button).find(
    (n) => n.props?.id && n.props.id === button.props["aria-describedby"],
  );
  assert.ok(description, "a description");
  assert.equal(description.props.hidden, true);
  assert.equal(text(description), inner.props.title);
  assert.ok(!spoken(inner).includes("Last check"));
  assert.ok(button.props["aria-label"].includes(spoken(inner)));
  button.props.onClick();
  assert.deepEqual(opened, ["checks"]);

  const mux = once(StatusTag, {
    view: running,
    open() {},
    openLabel: t("Status: {label}. Show checks", { label: running.text }),
  });
  assert.equal(mux.props["aria-label"], "Status: Running. Show checks");
});

test("progress shows a bar only while waiting or running", () => {
  const { ProgressCell } = block("tools/ProgressCell");
  const label = "Progress of Dune";
  for (const done of ["succeeded", "failed", "", "ready"]) {
    const cell = once(ProgressCell, { status: done, value: 100, label });
    assert.equal(text(cell), "—", done);
    assert.equal(
      nodes(cell).some((n) => n.props?.role),
      false,
      done,
    );
  }
  const queued = once(ProgressCell, { status: "queued", value: 40, label });
  assert.equal(queued.type, "div");
  assert.deepEqual(classes(queued), ["v2-progress"]);
  assert.equal(queued.props.role, "progressbar");
  assert.equal(queued.props["aria-label"], label);
  assert.equal(queued.props["aria-valuemin"], 0);
  assert.equal(queued.props["aria-valuemax"], 100);
  assert.equal(queued.props["aria-valuenow"], undefined);
  assert.equal(queued.props.style["--v"], "0");
  assert.equal(text(ofClass(queued, "v2-progress-pct")[0]), "—");

  const running = once(ProgressCell, { status: "running", value: 64, label });
  assert.equal(running.props["aria-valuenow"], 64);
  assert.equal(running.props.style["--v"], "64");
  const [bar] = ofClass(running, "v2-progress-bar");
  assert.equal(bar.type, "span");
  assert.equal(ofType(bar, "span").length, 2, "the bar and its fill");
  assert.equal(text(ofClass(running, "v2-progress-pct")[0]), "64 %");
  // Out of range values stay in the bar.
  const over = once(ProgressCell, { status: "running", value: 140, label });
  assert.equal(over.props["aria-valuenow"], 100);
});

test("disk tags name the disk, its role and its size", () => {
  const { ToolDiskTag, DiskTagCell } = block("tools/ToolDiskTag");
  const item = {
    id: 7,
    title: "Breaking Bad",
    scanStatus: "split",
    target: "disk2",
    disks: {
      disk1: { bytes: 3e9, files: 12, dirs: 0 },
      disk2: { bytes: 5e9, files: 20, dirs: 2 },
      disk3: { bytes: 1e9, files: 4, dirs: 0 },
    },
  };
  const parts = (tree) => {
    const [tag] = ofClass(tree, "v2-tag");
    const described = nodes(tree).find(
      (n) => n.props?.id && n.props.id === tag.props["aria-describedby"],
    );
    return { tag, described };
  };
  const target = parts(once(ToolDiskTag, { item, disk: "disk2" }));
  assert.equal(target.tag.type, "span");
  assert.deepEqual(classes(target.tag), ["v2-tag", "v2-tag--disk"]);
  assert.equal(text(target.tag), "disk2");
  const long = "disk2 · Target disk · 5 GB · 20 files · 2 folders";
  assert.equal(target.tag.props.title, long);
  // Ruling I8: no focus, no aria-label; the explanation is its description.
  assert.equal(target.tag.props.tabIndex, undefined);
  assert.equal(target.tag.props.tabindex, undefined);
  assert.equal(target.tag.props["aria-label"], undefined);
  assert.ok(target.described, "a description");
  assert.deepEqual(classes(target.described), ["v2-sr-only"]);
  assert.equal(text(target.described), long);

  const source = parts(once(ToolDiskTag, { item, disk: "disk1" }));
  assert.deepEqual(classes(source.tag), ["v2-tag", "v2-tag--disk-src"]);
  assert.equal(source.tag.props.title, "disk1 · Source disk · 3 GB · 12 files");
  // Two tags never share a description.
  assert.notEqual(
    source.tag.props["aria-describedby"],
    target.tag.props["aria-describedby"],
  );
  // A compact scan knows only where the item is.
  const compact = parts(
    once(ToolDiskTag, {
      item: {
        ...item,
        scanStatus: "empty",
        disks: { disk4: { bytes: 0, files: 0, dirs: 0 } },
        target: "",
      },
      disk: "disk4",
    }),
  );
  assert.equal(compact.tag.props.title, "Located on disk4");
  assert.equal(text(compact.described), "Located on disk4");
  // A target the item has no data on stays untoned, as in 1.7.0; every
  // disk tag is monospace through data-disk.
  const away = parts(
    once(ToolDiskTag, { item: { ...item, target: "disk9" }, disk: "disk9" }),
  );
  assert.deepEqual(classes(away.tag), ["v2-tag"]);
  assert.equal(away.tag.props.title, "disk9 · Target disk · 0 B · 0 files");
  for (const tag of [target.tag, source.tag, compact.tag, away.tag])
    assert.equal(tag.props["data-disk"], "");

  // The cell: two tags by size, then +n, which opens Details.
  const more = [];
  const cell = once(DiskTagCell, { item, more: () => more.push(item.id) });
  assert.equal(cell.type, "div");
  assert.deepEqual(classes(cell), ["v2-table-items"]);
  const shown = ofType(cell, ToolDiskTag);
  assert.deepEqual(
    shown.map((n) => n.props.disk),
    ["disk2", "disk1"],
  );
  const [plus] = ofType(cell, "button");
  assert.deepEqual(classes(plus), ["v2-tag", "v2-tag--more"]);
  assert.equal(plus.props.type, "button");
  assert.equal(text(plus), "+1");
  // Named by what it shows and what it does (WCAG 2.5.3).
  assert.equal(
    plus.props["aria-label"],
    "+1 · Show all disks for Breaking Bad",
  );
  assert.ok(plus.props["aria-label"].startsWith(text(plus)));
  assert.equal(plus.props.title, "disk3 · 1 GB");
  plus.props.onClick();
  assert.deepEqual(more, [7]);
  // Two disks: no +n; none: a dash.
  const two = once(DiskTagCell, {
    item: {
      ...item,
      disks: { disk1: item.disks.disk1, disk2: item.disks.disk2 },
    },
    more() {},
  });
  assert.equal(ofType(two, "button").length, 0);
  assert.equal(ofType(two, ToolDiskTag).length, 2);
  assert.equal(
    text(once(DiskTagCell, { item: { ...item, disks: {} }, more() {} })),
    "—",
  );
});

test("KPI cards press, release and keep a hero", () => {
  const { ToolKpis } = block("tools/ToolKpis");
  const jobs = [
    { id: 1, status: "running", sourceName: "a.mkv", check: ok },
    { id: 2, status: "failed", sourceName: "b.mkv", check: ok },
  ];
  const kpis = list.muxKpis(jobs);
  const chosen = [];
  const choose = (kpi) => chosen.push(kpi.key);
  const row = once(ToolKpis, { kpis, statuses: [], choose });
  assert.equal(row.type, "section");
  assert.deepEqual(classes(row), ["v2-dash-kpis"]);
  assert.equal(row.props["aria-label"], "Overview");
  const cards = ofClass(row, "v2-kpi");
  assert.equal(cards.length, 4);
  assert.deepEqual(
    cards.map((card) => card.type),
    ["button", "button", "button", "button"],
  );
  assert.deepEqual(classes(cards[0]), [
    "v2-kpi",
    "v2-kpi--compact",
    "v2-kpi--hero",
  ]);
  assert.deepEqual(classes(cards[1]), ["v2-kpi", "v2-kpi--compact"]);
  for (const card of cards) {
    assert.equal(card.props.type, "button");
    assert.equal(card.props["aria-pressed"], false);
    assert.equal(ofClass(card, "v2-kpi-go").length, 0, "no arrow");
    assert.equal(ofClass(card, "v2-kpi-hint").length, 0, "no detail");
    const [tile] = ofClass(card, "v2-tile");
    assert.equal(tile.props["aria-hidden"], "true");
  }
  // Named by what it shows: label and value.
  assert.deepEqual(
    cards.map((card) => spoken(card).replace(/\s+/g, " ").trim()),
    ["Open 2", "Running 1", "Failed 1", "Successful 0"],
  );
  assert.deepEqual(
    cards.map((card) => card.props.title),
    [
      "Show only Open",
      "Show only Running",
      "Show only Failed",
      "Show only Successful",
    ],
  );
  assert.ok(classes(ofClass(cards[1], "v2-tile")[0]).includes("v2-tile--grad"));
  assert.ok(
    !classes(ofClass(cards[0], "v2-tile")[0]).includes("v2-tile--grad"),
  );
  cards[2].props.onClick();
  assert.deepEqual(chosen, ["failed"]);

  // Pressed while the status filter is exactly the card's set.
  const pressed = once(ToolKpis, { kpis, statuses: ["failed"], choose });
  const [, , failed, done] = ofClass(pressed, "v2-kpi");
  assert.equal(failed.props["aria-pressed"], true);
  assert.equal(failed.props.title, "Reset filters");
  assert.equal(done.props["aria-pressed"], false);
  failed.props.onClick();
  assert.deepEqual(chosen, ["failed", "failed"]);

  // Before the data: "—" at the same place.
  const empty = once(ToolKpis, {
    kpis: list.muxKpis(null),
    statuses: [],
    choose,
  });
  assert.deepEqual(
    ofClass(empty, "v2-kpi-value").map((n) => text(n)),
    ["—", "—", "—", "—"],
  );

  // Files & permissions: the hero without a filter is a div without a role.
  const files = once(ToolKpis, {
    kpis: list.fileCheckKpis({
      counts: { open: 3, fixed: 1, manual: 2 },
      report: { checked: 1284 },
    }),
    statuses: [],
    choose,
  });
  const [hero, ...rest] = ofClass(files, "v2-kpi");
  assert.equal(hero.type, "div");
  assert.deepEqual(classes(hero), [
    "v2-kpi",
    "v2-kpi--compact",
    "v2-kpi--hero",
  ]);
  for (const key of ["role", "aria-pressed", "title", "onClick", "type"])
    assert.equal(hero.props[key], undefined, key);
  assert.equal(spoken(hero).replace(/\s+/g, " ").trim(), "Items checked 1,284");
  assert.deepEqual(
    rest.map((card) => card.type),
    ["button", "button", "button"],
  );
});

test("disk cards keep their row while they load", () => {
  const { DiskCards } = block("tools/DiskCards");
  for (const disks of [null, []]) {
    const row = once(DiskCards, { disks });
    assert.equal(row.type, "section");
    assert.deepEqual(classes(row), ["v2-disks"]);
    const cards = ofType(row, "article");
    assert.equal(cards.length, list.DISK_PLACEHOLDERS);
    assert.equal(cards.length, 3);
    for (const card of cards) {
      assert.deepEqual(classes(card), ["v2-card", "v2-disk", "v2-disk--ph"]);
      assert.equal(card.props["aria-hidden"], "true");
      assert.equal(card.props["aria-label"], undefined);
    }
  }
  const models = list.diskCardModels(
    [
      {
        name: "cache",
        kind: "pool",
        total: 1e12,
        free: 4e11,
        writable: true,
        excluded: false,
        standby: true,
      },
      {
        name: "disk2",
        kind: "array",
        total: 1e12,
        free: 1e11,
        writable: true,
        excluded: false,
        standby: true,
      },
      {
        name: "disk1",
        kind: "array",
        total: 4e12,
        free: 1e12,
        writable: true,
        excluded: false,
        standby: false,
      },
    ],
    [{ target: "disk1", jobStatus: "running" }],
  );
  const row = once(DiskCards, { disks: models });
  const cards = ofType(row, "article");
  assert.deepEqual(
    cards.map((card) => card.props["aria-label"]),
    [
      "disk1 · 75 % used · 1 TB free",
      "disk2 · 90 % used · 100 GB free · Standby",
      "cache · 60 % used · 400 GB free · Standby",
    ],
  );
  for (const card of cards) {
    assert.deepEqual(classes(card), ["v2-card", "v2-disk"]);
    assert.equal(card.props["aria-hidden"], undefined);
  }
  const [active, asleep, pool] = cards;
  const tile = (card) => classes(ofClass(card, "v2-tile")[0]);
  const state = (card) => text(ofClass(card, "v2-disk-state")[0]);
  // Active: a gradient tile, no state text, the target mark.
  assert.deepEqual(tile(active), ["v2-tile", "v2-tile--md", "v2-tile--grad"]);
  assert.equal(state(active), "");
  const [mark] = ofClass(active, "v2-tag");
  assert.deepEqual(classes(mark), ["v2-tag", "v2-tag--disk"]);
  assert.equal(text(mark), "Target");
  assert.equal(text(ofClass(active, "v2-disk-name")[0]), "disk1");
  assert.equal(text(ofClass(active, "v2-disk-free")[0]), "1 TB free");
  assert.equal(text(ofClass(active, "v2-disk-meta")[0]), "75 % used1 TB free");
  // Standby: a muted tile, a moon and "Standby"; it blocks nothing.
  assert.deepEqual(tile(asleep), ["v2-tile", "v2-tile--md"]);
  assert.equal(state(asleep), "Standby");
  assert.ok(
    nodes(ofClass(asleep, "v2-disk-state")[0]).some(
      (n) =>
        typeof n.type === "function" && n.props?.["aria-hidden"] === "true",
    ),
    "the moon is hidden",
  );
  assert.equal(ofClass(asleep, "v2-tag").length, 0);
  // From 85 % the bar takes the warning tone; its fill reads --v.
  const bar = (card) => ofClass(card, "v2-disk-bar")[0];
  assert.equal(bar(asleep).props["data-warn"], "");
  assert.equal(bar(active).props["data-warn"], undefined);
  assert.equal(bar(asleep).props.style["--v"], "90");
  assert.equal(bar(active).props["aria-hidden"], "true");
  // A pool says it is no target, in standby too; standby is then only in
  // its title, the muted tile and the card's name.
  assert.equal(state(pool), "Pool (not a target)");
  assert.equal(
    ofClass(pool, "v2-disk-state")[0].props.title,
    "Pool (not a target) · Standby",
  );
  assert.deepEqual(tile(pool), ["v2-tile", "v2-tile--md"]);
  assert.equal(ofClass(active, "v2-disk-state")[0].props.title, undefined);
  // Every card holds the same parts, so all are as high.
  for (const card of cards)
    for (const part of [
      "v2-disk-top",
      "v2-disk-name",
      "v2-disk-state",
      "v2-disk-bar",
      "v2-disk-meta",
      "v2-disk-free",
    ])
      assert.equal(ofClass(card, part).length, 1, part);
});

// Ruling I9: the row is a focusable named region only while it overflows
// (the TableCard pattern); focused, it stays one until focus leaves.
test("the disk row is a focusable named region only while it overflows", () => {
  const observers = [];
  class ResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.watched = [];
      observers.push(this);
    }
    observe(element) {
      this.watched.push(element);
    }
    disconnect() {
      this.watched = [];
    }
  }
  const { DiskCards } = block("tools/DiskCards", {
    browser: { ResizeObserver },
  });
  const models = list.diskCardModels(
    [
      {
        name: "disk1",
        kind: "array",
        total: 2e12,
        free: 1e12,
        writable: true,
        excluded: false,
      },
    ],
    [],
  );
  const view = mount(DiskCards, { disks: models });
  const region = { scrollWidth: 600, clientWidth: 600 };
  let row = view.render();
  row.ref.current = region;
  view.runtime.flush();
  row = view.render();
  const off = (tree) => {
    assert.equal(tree.props.role, undefined);
    assert.equal(tree.props["aria-label"], undefined);
    assert.equal(tree.props.tabIndex, undefined);
    assert.equal(tree.props["data-overflow"], undefined);
  };
  off(row);
  assert.equal(observers.length, 1);
  assert.deepEqual(observers[0].watched, [region]);

  region.scrollWidth = 900;
  observers[0].callback();
  row = view.render();
  assert.equal(row.props.role, "region");
  assert.equal(row.props["aria-label"], "Disks and pools");
  assert.equal(row.props.tabIndex, 0);
  assert.equal(row.props["data-overflow"], "");

  row.props.onFocus();
  region.scrollWidth = 600;
  observers[0].callback();
  row = view.render();
  assert.equal(row.props["data-overflow"], undefined);
  assert.equal(row.props.role, "region", "focused, it stays a region");
  assert.equal(row.props.tabIndex, 0);
  row.props.onBlur();
  off(view.render());
  view.runtime.unmount();
  assert.deepEqual(observers[0].watched, []);
});

test("the scan button keeps both labels and names the shown one", () => {
  const { ScanButton } = block("tools/ScanButton");
  const pressed = [];
  const idle = once(ScanButton, {
    scanning: false,
    ready: false,
    disabled: false,
    press: () => pressed.push("scan"),
  });
  assert.equal(idle.type, "button");
  assert.equal(idle.props.type, "button");
  assert.deepEqual(classes(idle), ["v2-btn", "v2-btn--band-primary"]);
  const labels = (tree) =>
    ofType(tree, "span").map((n) => [
      text(n),
      n.props.class,
      n.props["aria-hidden"],
    ]);
  assert.deepEqual(labels(idle), [
    ["Scan", undefined, undefined],
    ["Cancel scan", "v2-btn-alt", "true"],
  ]);
  assert.equal(spoken(idle), "Scan");
  assert.equal(idle.props["aria-label"], undefined, "named by its content");
  idle.props.onClick();
  assert.deepEqual(pressed, ["scan"]);

  const scanning = once(ScanButton, {
    scanning: true,
    ready: true,
    disabled: true,
    press() {},
  });
  assert.deepEqual(labels(scanning), [
    ["Cancel scan", undefined, undefined],
    ["Scan", "v2-btn-alt", "true"],
  ]);
  assert.equal(spoken(scanning), "Cancel scan");
  assert.equal(scanning.props.disabled, true);
  // Ready (a changed share mapping) marks the primary.
  assert.deepEqual(classes(scanning), [
    "v2-btn",
    "v2-btn--band-primary",
    "v2-btn--ready",
  ]);
});

test("the report button names its notices", () => {
  const { ReportButton } = block("tools/ScanButton");
  const opened = [];
  const plain = once(ReportButton, {
    notices: false,
    disabled: false,
    open: () => opened.push("report"),
  });
  assert.equal(plain.type, "button");
  assert.deepEqual(classes(plain), ["v2-btn", "v2-btn--on-band"]);
  assert.equal(spoken(plain), "Scan report");
  assert.equal(plain.props.title, "Scan report");
  assert.equal(ofClass(plain, "v2-dot").length, 0);
  plain.props.onClick();
  assert.deepEqual(opened, ["report"]);

  const notices = once(ReportButton, {
    notices: true,
    disabled: false,
    open() {},
  });
  assert.equal(notices.props["aria-label"], "Scan report · contains notices");
  assert.equal(notices.props.title, "Scan report · contains notices");
  assert.equal(text(notices), "Scan report", "the dot adds no text");
  const [dot] = ofClass(notices, "v2-dot");
  assert.deepEqual(classes(dot), ["v2-dot", "v2-dot--warn"]);
  assert.equal(dot.props["aria-hidden"], "true");
  // Locked without a report.
  assert.equal(
    once(ReportButton, { notices: false, disabled: true, open() {} }).props
      .disabled,
    true,
  );
});

test("check fields lock empty values unless chosen", () => {
  const { CheckField } = block("list/CheckField");
  const changes = [];
  const props = {
    id: "tool-drawer-status",
    label: "Status",
    options: [
      { value: "open", label: "Open", count: 1200 },
      { value: "manual", label: "Manual", count: 0 },
      { value: "failed", label: "Failed", count: 0 },
      { value: "active", label: "Active" },
    ],
    selected: ["failed"],
    change: (values) => changes.push(values),
  };
  const field = once(CheckField, props);
  assert.equal(field.type, "section");
  assert.deepEqual(classes(field), ["v2-drawer-sec"]);
  const [heading] = ofType(field, "h3");
  assert.equal(heading.props.id, "tool-drawer-status");
  assert.equal(text(heading), "Status");
  // M8: the always open value list of the drawer, named by its heading.
  const [list] = ofType(field, "fieldset");
  assert.deepEqual(classes(list), ["v2-ff-list"]);
  assert.equal(list.props["aria-labelledby"], "tool-drawer-status");
  assert.equal(ofClass(field, "v2-ff-grid").length, 0);
  assert.equal(
    nodes(field).some((n) => n.props?.role === "group"),
    false,
  );
  const options = ofType(list, "label");
  assert.equal(options.length, 4);
  const box = (option) => ofType(option, "input")[0];
  for (const option of options) {
    assert.deepEqual(classes(option), ["v2-ff-opt"]);
    assert.equal(box(option).props.type, "checkbox");
    assert.deepEqual(classes(box(option)), ["v2-check"]);
  }
  assert.deepEqual(
    options.map((option) => [
      text(option),
      box(option).props.checked,
      box(option).props.disabled,
      option.props["aria-disabled"],
    ]),
    [
      ["Open1,200", false, false, undefined],
      // Count 0 and not chosen: locked.
      ["Manual0", false, true, "true"],
      // Count 0 but chosen: free, so it can be cleared.
      ["Failed0", true, false, undefined],
      // No count: never locked, no count shown.
      ["Active", false, false, undefined],
    ],
  );
  const [n] = ofClass(options[0], "v2-ff-n");
  assert.equal(n.type, "span");
  assert.equal(ofClass(options[3], "v2-ff-n").length, 0);
  // A change hands over the new list and keeps the order of choice.
  box(options[0]).props.onChange({ currentTarget: { checked: true } });
  box(options[2]).props.onChange({ currentTarget: { checked: false } });
  assert.deepEqual(JSON.parse(JSON.stringify(changes)), [
    ["failed", "open"],
    [],
  ]);
  assert.deepEqual(props.selected, ["failed"], "the props stay untouched");
});
