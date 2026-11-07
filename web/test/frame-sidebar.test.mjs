import test from "node:test";
import assert from "node:assert/strict";
import * as icons from "lucide-preact";
import { jsx } from "preact/jsx-runtime";
import {
  componentHarness,
  loadSource,
  nodes,
} from "./helpers/component-harness.mjs";
import { fakeWindow } from "./helpers/fake-window.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";

// The sidebar, its rail flyout and the drawer as components
// (components/frame/, hooks/useSidebar.ts). They render the nav model
// (nav-model.ts) and run the flyout machine (flyout.ts); NavLink and
// BrandMark are stubbed presentation modules, so the tree shows their props.

// --- The nav model, built like frame-model.test.mjs ---------------------------

const storage = loadSource("browser-storage.ts");
const toolRoute = loadSource("tool-route.ts", {
  modules: { "./browser-storage": storage },
});
const instances = loadSource("instances.ts");
const frameStatus = loadSource("frame-status.ts", {
  modules: {
    "./instances": instances,
    "./tool-route": toolRoute,
    "./tool-table": loadSource("tool-table.ts"),
    "./mux-spec": loadSource("mux-spec.ts", {
      modules: { "./languages.ts": { audioLanguage: () => "" } },
    }),
    "./placement": loadSource("placement.ts"),
    "./filecheck": loadSource("filecheck.ts"),
  },
});
const router = loadSource("router.ts", {
  modules: {
    "./event-log": loadSource("event-log.ts"),
    "./tool-route": toolRoute,
  },
});
const navModel = loadSource("nav-model.ts", {
  modules: {
    "./instances": instances,
    "./frame-status": frameStatus,
    "./router": router,
    "./tool-route": toolRoute,
  },
});

const instance = (id, type, name = "") => ({
  id,
  type,
  name,
  enabled: true,
  url: "http://" + id,
  hasKey: true,
  interval: 60,
});
const settings = {
  instances: [
    instance("radarr", "radarr"),
    instance("radarr-4k", "radarr", "Radarr 4K"),
    instance("sonarr", "sonarr"),
  ],
};
const statusWith = (mux = 3) => ({
  demo: false,
  mux: { enabled: true, installed: true, pending: mux, running: 0, failed: 0 },
  unraid: { enabled: false },
  files: { available: true, pending: 0, running: 0, failed: 2 },
  sync: {
    radarr: { count: 10 },
    "radarr-4k": { count: 5 },
    sonarr: { count: 20 },
  },
});
const sections = (hash, status = statusWith()) =>
  navModel.navModel({
    route: router.parseRoute(hash),
    settings,
    status,
    translate: (key) => key,
  });
const allEntries = (model) =>
  model
    .flatMap((section) => section.nodes)
    .flatMap((node) => [node, ...node.children]);

// --- Rendering ---------------------------------------------------------------

const t = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");
const ui = { ICON: { button: 16, label: 15 }, count: String };
// Values cross a VM realm; compare their JSON shape.
const plain = (value) => JSON.parse(JSON.stringify(value));
// The href of a target, as linkHref would give it.
const hrefOf = (target) => "#/" + JSON.stringify(target);
// The flyout is its own module; the sidebar hands it props.
const flyoutStub = { SidebarFlyout: "SidebarFlyout", FLYOUT_ID: "v2-fly" };

function baseProps(overrides = {}) {
  const calls = [];
  return {
    calls,
    props: {
      mode: "expanded",
      sections: sections("#/movies?instance=radarr-4k"),
      groups: { movies: true, series: true, settings: false },
      toggleGroup: (group) => calls.push(["toggleGroup", group]),
      toggleMode: () => calls.push(["toggleMode"]),
      drawerOpen: false,
      closeDrawer: () => calls.push(["closeDrawer"]),
      hrefOf,
      open: (target) => calls.push(["open", plain(target)]),
      version: "2.0.0",
      ...overrides,
    },
  };
}

// A document that keeps one listener per event type.
function fakeDocument() {
  return {
    activeElement: null,
    listeners: new Map(),
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    },
    removeEventListener(type) {
      this.listeners.delete(type);
    },
  };
}
// Computed visibility, as a fake element states it.
const getComputedStyle = (element) => ({
  visibility: element.visibility ?? "visible",
});
function sidebar(
  props,
  {
    browser = {
      window: fakeWindow().window,
      document: fakeDocument(),
      getComputedStyle,
    },
    timers,
  } = {},
) {
  const runtime = createHookRuntime();
  const flyout = loadSource("flyout.ts", timers ? { browser: timers } : {});
  const harness = componentHarness("frame/Sidebar", props, {
    exportName: "Sidebar",
    modules: {
      "preact/hooks": runtime.hooks,
      "../../i18n": { t },
      "../../ui": ui,
      "../../flyout": flyout,
      "./SidebarFlyout": flyoutStub,
    },
    browser,
  });
  return { runtime, render: () => runtime.settle(harness.render) };
}
const render = (props, options) => sidebar(props, options).render();

const classes = (node) => String(node?.props?.class ?? "").split(/\s+/);
const hasClass = (node, name) => classes(node).includes(name);
const byClass = (tree, name) => nodes(tree).filter((n) => hasClass(n, name));
const hidden = (node) =>
  node?.props?.["aria-hidden"] === "true" ||
  node?.props?.["aria-hidden"] === true;
// The accessible name: aria-label (NavLink: label), else the text without
// aria-hidden parts. Lucide icons are hidden from assistive technology.
function accessibleName(node) {
  const label = node.props["aria-label"] ?? node.props.label;
  if (label !== undefined) return label;
  const walk = (child) => {
    if (Array.isArray(child)) return child.map(walk).join("");
    if (child === null || child === undefined || typeof child === "boolean")
      return "";
    if (typeof child !== "object") return String(child);
    if (hidden(child) || typeof child.type === "function") return "";
    return walk(child.props?.children);
  };
  return walk(node.props.children).trim();
}
const navLinks = (tree) =>
  nodes(tree).filter(
    (n) =>
      n.type === "NavLink" &&
      (hasClass(n, "v2-nav-item") || hasClass(n, "v2-nav-sub")),
  );
const button = (tree, name) =>
  nodes(tree).find((n) => n.type === "button" && accessibleName(n) === name);

// --- The brief's cases -------------------------------------------------------

test("sidebar entries come from the nav model", () => {
  const model = sections("#/movies?instance=radarr-4k");
  const entries = allEntries(model);
  // Settings is a group button; its areas are links.
  const linked = model
    .flatMap((section) => section.nodes)
    .flatMap((node) =>
      node.group === "settings" ? node.children : [node, ...node.children],
    );
  assert.ok(
    entries.some((entry) => entry.current),
    "a current entry",
  );
  for (const mode of ["expanded", "rail", "drawer"]) {
    const tree = render(baseProps({ mode, sections: model }).props);
    const links = navLinks(tree);
    assert.deepEqual(
      links.map((link) => [
        link.props.href,
        !!link.props.current,
        accessibleName(link),
      ]),
      plain(
        linked.map((entry) => [
          hrefOf(entry.target),
          entry.current,
          entry.label,
        ]),
      ),
      mode,
    );
    // The group labels name the sections in every mode.
    assert.deepEqual(
      nodes(tree)
        .filter((n) => n.type === "p" && hasClass(n, "v2-nav-group"))
        .map(accessibleName),
      ["Library", "Tools", "System"],
      mode,
    );
    const settingsButton = button(tree, "Settings");
    assert.ok(settingsButton, mode + ": Settings is a button");
    assert.ok(hasClass(settingsButton, "v2-nav-item"), mode);
    // In the rail the text is visually hidden and stays the name.
    for (const link of links.filter((l) => hasClass(l, "v2-nav-item"))) {
      const text = byClass(link, "v2-nav-text");
      assert.equal(text.length, 1, mode);
      assert.equal(hasClass(text[0], "v2-sr-only"), mode === "rail", mode);
    }
    // One navigation landmark, named as in 1.7.0.
    const navs = nodes(tree).filter((n) => n.type === "nav");
    assert.equal(navs.length, 1, mode);
    assert.equal(navs[0].props["aria-label"], "Main navigation");
    assert.ok(hasClass(navs[0], "v2-nav"));
    const root = nodes(tree).find((n) => hasClass(n, "v2-sidebar"));
    assert.equal(root.props["data-mode"], mode);
    assert.equal(root.type, "div");
  }

  // The brand links to the dashboard by name.
  const tree = render(baseProps().props);
  const brand = nodes(tree).find(
    (n) => n.type === "NavLink" && hasClass(n, "v2-brand-home"),
  );
  assert.equal(brand.props.href, hrefOf({ view: "statistics" }));
  assert.equal(brand.props.label, "Scopearr home");
  assert.ok(nodes(brand).some((n) => n.type === "BrandMark"));
  // The link's visible text is its name's start, "Scopearr" (WCAG 2.5.3):
  // the version is shown beside the link in the brand row, not inside it.
  const texts = (node) =>
    nodes(node)
      .map((n) =>
        typeof n.props?.children === "string" ? n.props.children : "",
      )
      .join(" ");
  assert.match(texts(brand), /Scopearr/);
  assert.doesNotMatch(texts(brand), /2\.0\.0/);
  const row = nodes(tree).find(
    (n) => n.type === "div" && hasClass(n, "v2-brand"),
  );
  const version = nodes(row).find((n) => hasClass(n, "v2-brand-version"));
  assert.equal(version?.props.children, "2.0.0");
  assert.ok(
    (Array.isArray(row.props.children)
      ? row.props.children
      : [row.props.children]
    ).includes(version),
    "the version is a child of the brand row",
  );
});

test("groups open only by their arrow", () => {
  const { calls, props } = baseProps({
    groups: { movies: false, series: true, settings: false },
  });
  const view = sidebar(props);
  let tree = view.render();
  // Route changes re-render the entries but never touch the groups.
  for (const hash of ["#/dashboard", "#/settings/system", "#/movies"]) {
    props.sections = sections(hash);
    tree = view.render();
  }
  assert.deepEqual(calls, []);

  // The movies arrow is named Instances and controls the collapsed list.
  const arrows = nodes(tree).filter(
    (n) => n.type === "button" && n.props["aria-label"] === "Instances",
  );
  assert.equal(arrows.length, 1, "only movies has more than one instance");
  const [arrow] = arrows;
  assert.equal(arrow.props.title, "Instances");
  assert.equal(arrow.props["aria-expanded"], false);
  const list = nodes(tree).find(
    (n) => n.props?.id === arrow.props["aria-controls"],
  );
  assert.ok(list, "the arrow controls the sub-entries");
  assert.equal(list.props.inert, true, "a closed group is inert");
  assert.equal(list.props["data-open"], undefined);
  assert.ok(nodes(list).some((n) => n.type === "ul"));
  assert.ok(
    nodes(list)
      .filter((n) => n.type === "li")
      .every((li) => nodes(li).some((n) => hasClass(n, "v2-nav-sub"))),
  );
  arrow.props.onClick({ detail: 1 });
  assert.deepEqual(calls, [["toggleGroup", "movies"]]);

  // The Movies link opens the library, not the group.
  const movies = navLinks(tree).find((l) => accessibleName(l) === "Movies");
  movies.props.open();
  assert.deepEqual(calls.at(-1), [
    "open",
    { view: "library", service: "radarr", instance: "" },
  ]);
  assert.equal(calls.filter(([name]) => name === "toggleGroup").length, 1);

  // The Settings parent is the arrow of its own group.
  const settingsButton = button(tree, "Settings");
  assert.equal(settingsButton.props["aria-expanded"], false);
  const areas = nodes(tree).find(
    (n) => n.props?.id === settingsButton.props["aria-controls"],
  );
  assert.ok(areas && nodes(areas).some((n) => hasClass(n, "v2-nav-sub")));
  settingsButton.props.onClick({ detail: 1, currentTarget: {} });
  assert.deepEqual(calls.at(-1), ["toggleGroup", "settings"]);

  // An open group shows its list and is not inert.
  props.groups = { movies: true, series: true, settings: true };
  tree = view.render();
  const open = nodes(tree).find(
    (n) => n.props?.id === arrow.props["aria-controls"],
  );
  assert.equal(open.props.inert, false);
  assert.equal(open.props["data-open"], "");
  assert.equal(button(tree, "Settings").props["aria-expanded"], true);
});

test("one toggle button follows the mode", () => {
  const head = jsx("div", { class: "test-head" });
  const extras = jsx("div", { class: "test-extras" });
  const footer = jsx("div", { class: "test-footer" });
  const slots = { drawerHead: head, drawerExtras: extras, footer };
  for (const [mode, name, Icon, expanded] of [
    ["expanded", "Collapse navigation", icons.PanelLeftClose, true],
    ["rail", "Expand navigation", icons.PanelLeftOpen, false],
  ]) {
    const { calls, props } = baseProps({ mode, ...slots });
    const tree = render(props);
    const toggles = byClass(tree, "v2-nav-toggle");
    assert.equal(toggles.length, 1, mode);
    const [toggle] = toggles;
    assert.equal(toggle.type, "button");
    assert.equal(toggle.props.type, "button");
    assert.equal(accessibleName(toggle), name);
    assert.equal(toggle.props["aria-expanded"], expanded);
    assert.ok(
      nodes(toggle).some((n) => n.type === Icon),
      mode + " icon",
    );
    assert.ok(
      !nodes(toggle).some(
        (n) => n.type === icons.PanelLeftClose && Icon !== n.type,
      ),
    );
    toggle.props.onClick({ detail: 1, currentTarget: {} });
    assert.deepEqual(calls, [["toggleMode"]]);
    // No close button and no drawer parts outside the drawer.
    assert.equal(button(tree, "Close"), undefined, mode);
    assert.equal(byClass(tree, "test-head").length, 0, mode);
    assert.equal(byClass(tree, "test-extras").length, 0, mode);
    // The footer (the sync card) belongs to the expanded sidebar only.
    assert.equal(byClass(tree, "test-footer").length, +(mode === "expanded"));
    const root = nodes(tree).find((n) => hasClass(n, "v2-sidebar"));
    assert.equal(root.props.role, undefined);
  }

  // The drawer has no toggle; it has a close button, its head and extras.
  for (const drawerOpen of [false, true]) {
    const { calls, props } = baseProps({
      mode: "drawer",
      drawerOpen,
      ...slots,
    });
    const tree = render(props);
    assert.equal(byClass(tree, "v2-nav-toggle").length, 0);
    const close = button(tree, "Close");
    assert.ok(close, "a close button");
    assert.equal(close.props["aria-label"], "Close");
    assert.equal(close.props.title, "Close");
    assert.ok(nodes(close).some((n) => n.type === icons.X));
    close.props.onClick({});
    assert.deepEqual(calls, [["closeDrawer"]]);
    assert.equal(byClass(tree, "test-head").length, 1);
    assert.equal(byClass(tree, "test-extras").length, 1);
    assert.equal(byClass(tree, "test-footer").length, 0);
    // The extras sit in the navigation, after the sections.
    const nav = nodes(tree).find((n) => n.type === "nav");
    assert.equal(byClass(nav, "test-extras").length, 1);
    const root = nodes(tree).find((n) => hasClass(n, "v2-sidebar"));
    assert.equal(root.props.role, drawerOpen ? "dialog" : undefined);
    assert.equal(root.props["aria-modal"], drawerOpen ? "true" : undefined);
    assert.equal(
      root.props["aria-label"],
      drawerOpen ? "Main navigation" : undefined,
    );
    assert.equal(root.props["data-open"], drawerOpen ? "" : undefined);
    // The scrim closes the drawer.
    const scrim = nodes(tree).find((n) => hasClass(n, "v2-scrim"));
    assert.ok(scrim, "a scrim");
    assert.equal(scrim.props["aria-hidden"], "true");
    assert.equal(scrim.props["data-open"], drawerOpen ? "" : undefined);
    scrim.props.onClick({});
    assert.deepEqual(calls, [["closeDrawer"], ["closeDrawer"]]);
  }
});

test("plaques never change the size of their host", () => {
  for (const jobs of [0, 3, 9, 10, 99, 100]) {
    const model = sections("#/mux", statusWith(jobs));
    for (const mode of ["rail", "expanded", "drawer"]) {
      const tree = render(baseProps({ mode, sections: model }).props);
      const mux = navLinks(tree).find((l) => accessibleName(l) === "Muxing");
      assert.ok(mux, mode);
      const tile = mux.props.children.find((child) =>
        hasClass(child, "v2-tile"),
      );
      assert.ok(tile, "the tile is a direct child of the entry");
      assert.ok(hidden(tile), "the tile is decorative");
      const plaques = byClass(mux, "v2-plaque");
      if (mode !== "rail" || !jobs) {
        assert.equal(plaques.length, 0, mode + " " + jobs);
        continue;
      }
      // The plaque is a child of the tile, never in the text flow.
      assert.equal(plaques.length, 1, String(jobs));
      assert.ok(
        [tile.props.children].flat().includes(plaques[0]),
        "the plaque sits in the tile",
      );
      assert.ok(
        ![mux.props.children].flat().includes(plaques[0]),
        "not beside the text",
      );
      assert.equal(plaques[0].props.children, String(jobs));
      assert.equal(accessibleName(mux), "Muxing");
    }
    // Expanded, the count is a pill after the text, hidden from the name.
    const tree = render(baseProps({ sections: model }).props);
    const mux = navLinks(tree).find((l) => accessibleName(l) === "Muxing");
    const counts = byClass(mux, "v2-count");
    assert.equal(counts.length, jobs ? 1 : 0);
    if (jobs) {
      assert.ok(hidden(counts[0]));
      assert.equal(counts[0].props.children, String(jobs));
    }
  }
});

// A matchMedia over a width that a test changes; change listeners hear it.
function mediaWindow(width) {
  const listeners = new Set();
  let current = width;
  const matchMedia = (query) => {
    const [, side, px] = /\((max|min)-width: (\d+)px\)/.exec(query);
    return {
      media: query,
      get matches() {
        return side === "max" ? current <= +px : current >= +px;
      },
      addEventListener: (_type, listener) => listeners.add(listener),
      removeEventListener: (_type, listener) => listeners.delete(listener),
    };
  };
  return {
    window: { matchMedia },
    listeners,
    resize(next) {
      current = next;
      for (const listener of [...listeners]) listener({ matches: true });
    },
  };
}
function fakeStorage(entries = {}) {
  const values = new Map(Object.entries(entries)),
    writes = [];
  return {
    writes,
    localStorage: {
      getItem: (key) => (values.has(key) ? values.get(key) : null),
      setItem(key, value) {
        writes.push([key, String(value)]);
        values.set(key, String(value));
      },
      removeItem: (key) => values.delete(key),
    },
  };
}
function sidebarHook(width, entries) {
  const runtime = createHookRuntime(),
    media = mediaWindow(width),
    store = fakeStorage(entries);
  const browserStorage = loadSource("browser-storage.ts", {
    browser: { localStorage: store.localStorage },
  });
  const state = loadSource("sidebar-state.ts", {
    modules: { "./browser-storage": browserStorage },
  });
  const { useSidebar } = loadSource("hooks/useSidebar.ts", {
    modules: { "preact/hooks": runtime.hooks, "../sidebar-state": state },
    browser: { window: media.window },
  });
  return { runtime, media, store, useSidebar };
}

test("useSidebar resolves the mode from the width and remembers the choice", () => {
  const { runtime, media, store, useSidebar } = sidebarHook(1599);
  // The first render already has the mode: the frame paints once.
  let sidebar = runtime.render(useSidebar);
  assert.equal(sidebar.mode, "rail");
  assert.deepEqual(
    { ...sidebar.groups },
    {
      movies: true,
      series: true,
      settings: false,
    },
  );
  runtime.flush();
  assert.ok(media.listeners.size > 0, "listens to the width");
  media.resize(1600);
  sidebar = runtime.settle(useSidebar);
  assert.equal(sidebar.mode, "expanded");
  media.resize(1599);
  sidebar = runtime.settle(useSidebar);
  assert.equal(sidebar.mode, "rail");

  // The button stores the choice, which holds from 740 on.
  sidebar.toggleMode();
  sidebar = runtime.settle(useSidebar);
  assert.equal(sidebar.mode, "expanded");
  assert.deepEqual(store.writes, [["scopearr-sidebar", "expanded"]]);
  media.resize(740);
  sidebar = runtime.settle(useSidebar);
  assert.equal(sidebar.mode, "expanded");
  sidebar.toggleMode();
  sidebar = runtime.settle(useSidebar);
  assert.equal(sidebar.mode, "rail");
  assert.deepEqual(store.writes.at(-1), ["scopearr-sidebar", "rail"]);

  // Groups toggle and are stored as JSON.
  sidebar.toggleGroup("settings");
  sidebar = runtime.settle(useSidebar);
  assert.equal(sidebar.groups.settings, true);
  assert.deepEqual(JSON.parse(store.writes.at(-1)[1]), {
    movies: true,
    series: true,
    settings: true,
  });
  assert.equal(store.writes.at(-1)[0], "scopearr-sidebar-groups");

  // A phone gets the drawer; the button does nothing there.
  media.resize(739);
  sidebar = runtime.settle(useSidebar);
  assert.equal(sidebar.mode, "drawer");
  const writes = store.writes.length;
  sidebar.toggleMode();
  sidebar = runtime.settle(useSidebar);
  assert.equal(sidebar.mode, "drawer");
  assert.equal(store.writes.length, writes);

  // A mode change closes the drawer and returns no focus.
  const more = {
    focused: 0,
    focus() {
      this.focused++;
    },
  };
  assert.equal(sidebar.drawerOpen, false);
  sidebar.openDrawer(more);
  sidebar = runtime.settle(useSidebar);
  assert.equal(sidebar.drawerOpen, true);
  media.resize(800);
  sidebar = runtime.settle(useSidebar);
  assert.equal(sidebar.mode, "rail");
  assert.equal(sidebar.drawerOpen, false);
  media.resize(375);
  sidebar = runtime.settle(useSidebar);
  assert.equal(sidebar.drawerOpen, false, "it stays closed");
  assert.equal(more.focused, 0);

  // Closing returns focus to the control that opened the drawer, once.
  sidebar.openDrawer(more);
  sidebar = runtime.settle(useSidebar);
  sidebar.closeDrawer();
  sidebar.closeDrawer();
  sidebar = runtime.settle(useSidebar);
  assert.equal(sidebar.drawerOpen, false);
  assert.equal(more.focused, 1);
  // Only the drawer opens: outside it openDrawer does nothing.
  media.resize(1200);
  sidebar = runtime.settle(useSidebar);
  sidebar.openDrawer(more);
  sidebar = runtime.settle(useSidebar);
  assert.equal(sidebar.drawerOpen, false);
  sidebar.closeDrawer();
  sidebar = runtime.settle(useSidebar);
  assert.equal(more.focused, 1, "nothing opened, so nothing returns focus");

  runtime.unmount();
  assert.equal(media.listeners.size, 0, "unmount stops listening");

  // A stored choice and stored groups apply on the first render.
  const stored = sidebarHook(1700, {
    "scopearr-sidebar": "rail",
    "scopearr-sidebar-groups": '{"movies":false}',
  });
  const first = stored.runtime.render(stored.useSidebar);
  assert.equal(first.mode, "rail");
  assert.equal(first.groups.movies, false);
  assert.equal(stored.store.writes.length, 0, "reading writes nothing");
  // So does the width: wide is expanded, a phone the drawer.
  for (const [width, mode] of [
    [1600, "expanded"],
    [739, "drawer"],
    [740, "rail"],
  ]) {
    const view = sidebarHook(width);
    assert.equal(view.runtime.render(view.useSidebar).mode, mode, width);
  }
});

test("a plain click on a sidebar link opens its target", () => {
  const navLink = (props) =>
    componentHarness("frame/NavLink", props, {
      exportName: "NavLink",
      modules: { "../../nav-link": loadSource("nav-link.ts") },
    }).render();
  const done = [];
  const click = (event = {}) => ({
    button: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: () => done.push("preventDefault"),
    ...event,
  });
  const link = navLink({
    href: "#/mux",
    open: () => done.push("open"),
    class: "v2-nav-item",
    current: true,
    children: "Muxing",
    "data-parent": "",
  });
  assert.equal(link.type, "a");
  assert.equal(link.props.href, "#/mux");
  assert.equal(link.props.class, "v2-nav-item");
  assert.equal(link.props["aria-current"], "page");
  assert.equal(link.props["data-parent"], "", "other attributes pass through");
  assert.equal(link.props["aria-label"], undefined, "the text is the name");
  link.props.onClick(click());
  assert.deepEqual(done, ["preventDefault", "open"]);
  // Modified and middle clicks keep the browser's link (a new tab).
  for (const event of [
    { button: 1 },
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
  ])
    link.props.onClick(click(event));
  assert.deepEqual(done, ["preventDefault", "open"]);
  // Not current: no aria-current; a label names an icon-only link.
  const home = navLink({
    href: "#/dashboard",
    open: () => {},
    label: "Scopearr home",
    children: "x",
  });
  assert.equal(home.props["aria-current"], undefined);
  assert.equal(home.props["aria-label"], "Scopearr home");
  assert.equal(home.props.title, "Scopearr home");

  // In the sidebar each entry's link opens its own target.
  const model = sections("#/dashboard");
  const { calls, props } = baseProps({ sections: model });
  const tree = render(props);
  const links = navLinks(tree);
  for (const link of links) link.props.open();
  assert.deepEqual(
    calls.map(([, target]) => target),
    plain(
      model
        .flatMap((section) => section.nodes)
        .flatMap((node) =>
          node.group === "settings" ? node.children : [node, ...node.children],
        )
        .map((entry) => entry.target),
    ),
  );
  // A link in the drawer closes the drawer, then opens its target.
  const drawer = baseProps({
    mode: "drawer",
    drawerOpen: true,
    sections: model,
  });
  const drawerTree = render(drawer.props);
  navLinks(drawerTree)
    .find((l) => accessibleName(l) === "Muxing")
    .props.open();
  assert.deepEqual(drawer.calls, [["closeDrawer"], ["open", { view: "mux" }]]);
});

// --- Additions: the rail flyout wiring (flyout.ts header, STYLEGUIDE 10.1) ---

// An element of the rail (or, with rail: false, of the page): focus,
// hover, a rectangle and its computed visibility.
function element(
  name,
  { focusVisible = false, rail = true, visibility = "visible" } = {},
) {
  return {
    name,
    rail,
    visibility,
    focused: 0,
    focusVisible,
    matches: (selector) =>
      selector === ":focus-visible" ? focusVisible : false,
    focus() {
      this.focused++;
    },
    getBoundingClientRect: () => ({ top: 100, height: 46, bottom: 146 }),
    getClientRects: () => [{}],
    closest: () => null,
  };
}
// The sidebar's root element: it contains the rail elements, and its
// focusable elements are `focusables`, in document order.
function railRoot() {
  return {
    focusables: [],
    contains: (node) => !!node?.rail,
    matches: () => false,
    querySelectorAll() {
      return this.focusables;
    },
  };
}
function railView(props) {
  const fake = fakeWindow();
  const document = fakeDocument();
  const root = railRoot();
  const view = sidebar(props, {
    browser: { window: fake.window, document, getComputedStyle },
    timers: fake.window,
  });
  // As Preact would, attach the root element to the sidebar's ref.
  const state = () => {
    const tree = view.render();
    const sidebarNode = nodes(tree).find((n) => hasClass(n, "v2-sidebar"));
    sidebarNode.ref.current = root;
    const fly = nodes(tree).find((n) => n.type === "SidebarFlyout");
    return { tree, fly };
  };
  return { fake, document, root, view, state };
}
const entry = (tree, name) =>
  nodes(tree).find(
    (n) =>
      (n.type === "NavLink" || n.type === "button") &&
      hasClass(n, "v2-nav-item") &&
      accessibleName(n) === name,
  );
const pointer = (target, type = "mouse") => ({
  pointerType: type,
  currentTarget: target,
});

test("the rail flyout follows the pointer and steps back with the keyboard", () => {
  const { calls, props } = baseProps({ mode: "rail" });
  const { fake, document, state } = railView(props);
  let { tree, fly } = state();
  assert.equal(fly.props.visible, false);
  const movies = element("movies");
  entry(tree, "Movies").props.onPointerEnter(pointer(movies));
  fake.advance(149);
  assert.equal(state().fly.props.visible, false, "hover intent waits");
  fake.advance(1);
  ({ tree, fly } = state());
  assert.equal(fly.props.visible, true);
  assert.equal(fly.props.anchor, movies);
  assert.equal(fly.props.content.label, "Movies");
  assert.deepEqual(
    plain(fly.props.content.entries.map((child) => child.label)),
    ["Radarr", "Radarr 4K"],
  );
  assert.equal(fly.props.content.head.key, "movies", "the head opens all");
  // The trigger announces its flyout.
  assert.equal(entry(tree, "Movies").props["aria-expanded"], true);
  assert.equal(entry(tree, "Movies").props["aria-controls"], "v2-fly");
  assert.equal(entry(tree, "Dashboard").props["aria-expanded"], undefined);

  // Moving to another entry switches at once; a plain entry has a label.
  const dashboard = element("dashboard");
  entry(tree, "Movies").props.onPointerLeave(pointer(movies));
  entry(tree, "Dashboard").props.onPointerEnter(pointer(dashboard));
  ({ fly } = state());
  assert.equal(fly.props.visible, true);
  assert.equal(fly.props.content.label, "Dashboard");
  assert.equal(fly.props.content.entries, undefined);

  // Leaving waits 220ms; entering the flyout keeps it (the bridge).
  entry(tree, "Dashboard").props.onPointerLeave(pointer(dashboard));
  fake.advance(200);
  fly.props.send({ type: "flyoutenter" });
  fake.advance(100);
  assert.equal(state().fly.props.visible, true);
  fly.props.send({ type: "leave" });
  fake.advance(220);
  assert.equal(state().fly.props.visible, false);

  // → on a group opens it and asks the flyout to focus its entry.
  ({ tree } = state());
  const settingsButton = element("settings", { focusVisible: true });
  const before = state().fly.props.focusRequest;
  entry(tree, "Settings").props.onKeyDown({
    key: "ArrowRight",
    preventDefault() {},
    currentTarget: settingsButton,
  });
  ({ tree, fly } = state());
  assert.equal(fly.props.visible, true);
  assert.equal(fly.props.content.label, "Settings");
  assert.equal(fly.props.content.head, undefined, "Settings has no page");
  assert.equal(fly.props.focusRequest, before + 1);
  // A click on Settings opens it, never closes it.
  entry(tree, "Settings").props.onClick({
    detail: 1,
    currentTarget: settingsButton,
  });
  assert.equal(state().fly.props.visible, true);
  assert.deepEqual(calls, [], "in the rail Settings toggles no group");

  // ← or Escape: back to the entry, which stays closed under focus.
  document.activeElement = settingsButton;
  state().fly.props.back();
  ({ tree, fly } = state());
  assert.equal(fly.props.visible, false);
  assert.equal(settingsButton.focused, 1, "focus returns to the entry");
  entry(tree, "Settings").props.onFocus({ currentTarget: settingsButton });
  assert.equal(state().fly.props.visible, false, "suppressed after back");
  entry(tree, "Settings").props.onBlur({});
  // Focus from a pointer (not :focus-visible) opens nothing.
  entry(tree, "Settings").props.onFocus({ currentTarget: element("click") });
  assert.equal(state().fly.props.visible, false, "pointer focus is no input");
  entry(tree, "Settings").props.onFocus({ currentTarget: settingsButton });
  assert.equal(state().fly.props.visible, true, "visible focus opens again");

  // Escape anywhere closes it.
  const escape = document.listeners.get("keydown");
  assert.ok(escape, "Escape is heard while the flyout shows");
  escape({ key: "Escape", defaultPrevented: false, preventDefault() {} });
  assert.equal(state().fly.props.visible, false);

  // A flyout entry opens its target and closes the flyout.
  entry(state().tree, "Movies").props.onPointerEnter(pointer(movies));
  fake.advance(150);
  ({ fly } = state());
  fly.props.pick({ view: "library", service: "radarr", instance: "radarr-4k" });
  assert.equal(state().fly.props.visible, false);
  assert.deepEqual(calls.at(-1), [
    "open",
    { view: "library", service: "radarr", instance: "radarr-4k" },
  ]);
});

test("a tap opens a rail group first and resize closes the flyout", () => {
  const { calls, props } = baseProps({ mode: "rail" });
  const { fake, state } = railView(props);
  let { tree } = state();
  const movies = element("movies");
  // Touch sends no hover; the first tap opens the group, the second goes.
  const link = entry(tree, "Movies");
  link.props.onPointerEnter(pointer(movies, "touch"));
  fake.advance(500);
  assert.equal(state().fly.props.visible, false, "touch does not hover");
  link.props.onPointerDown(pointer(movies, "touch"));
  link.props.open();
  assert.equal(state().fly.props.visible, true, "the first tap opens");
  assert.deepEqual(calls, []);
  ({ tree } = state());
  entry(tree, "Movies").props.onPointerDown(pointer(movies, "touch"));
  entry(tree, "Movies").props.open();
  assert.equal(state().fly.props.visible, false);
  assert.deepEqual(calls, [
    ["open", { view: "library", service: "radarr", instance: "" }],
  ]);
  // A tap on an entry without a group goes at once.
  ({ tree } = state());
  entry(tree, "Dashboard").props.onPointerDown(pointer(element("d"), "touch"));
  entry(tree, "Dashboard").props.open();
  assert.deepEqual(calls.at(-1), ["open", { view: "statistics" }]);

  // A resize closes an open flyout.
  ({ tree } = state());
  entry(tree, "Settings").props.onClick({
    detail: 1,
    currentTarget: element("settings"),
  });
  assert.equal(state().fly.props.visible, true);
  fake.window.dispatchEvent({ type: "resize" });
  assert.equal(state().fly.props.visible, false);
});

test("an entry that leaves takes its focus with it", () => {
  // The flyout machine clears `focused` only on blur: when a focused tool
  // disappears (hidden by the status), the sidebar sends blur itself, so
  // the flyout of another entry still closes after the pointer leaves.
  const { props } = baseProps({
    mode: "rail",
    sections: sections("#/dashboard"),
  });
  const { fake, view, state } = railView(props);
  let { tree } = state();
  const mux = element("mux", { focusVisible: true });
  entry(tree, "Muxing").props.onFocus({ currentTarget: mux });
  assert.equal(state().fly.props.content.label, "Muxing");
  props.sections = sections("#/dashboard", {
    ...statusWith(),
    mux: { enabled: false },
  });
  ({ tree } = state());
  assert.equal(entry(tree, "Muxing"), undefined, "the tool left");
  assert.equal(state().fly.props.visible, false);
  const movies = element("movies");
  entry(tree, "Movies").props.onPointerEnter(pointer(movies));
  fake.advance(150);
  assert.equal(state().fly.props.visible, true);
  entry(tree, "Movies").props.onPointerLeave(pointer(movies));
  fake.advance(220);
  assert.equal(state().fly.props.visible, false, "no stale focus holds it");
  // The tool comes back: its own flyout must not stick under a stale focus.
  props.sections = sections("#/dashboard");
  ({ tree } = state());
  const back = element("mux");
  entry(tree, "Muxing").props.onPointerEnter(pointer(back));
  fake.advance(150);
  assert.equal(state().fly.props.content.label, "Muxing");
  entry(tree, "Muxing").props.onPointerLeave(pointer(back));
  fake.advance(220);
  assert.equal(state().fly.props.visible, false, "the returned tool closes");

  // A mode change closes the flyout and forgets the focus too.
  ({ tree } = state());
  const settingsButton = element("settings", { focusVisible: true });
  entry(tree, "Settings").props.onFocus({ currentTarget: settingsButton });
  assert.equal(state().fly.props.visible, true);
  props.mode = "expanded";
  ({ tree } = state());
  assert.equal(
    nodes(tree).some((n) => n.type === "SidebarFlyout"),
    false,
    "no flyout outside the rail",
  );
  props.mode = "rail";
  ({ tree } = state());
  assert.equal(state().fly.props.visible, false);
  entry(tree, "Settings").props.onPointerEnter(pointer(settingsButton));
  fake.advance(150);
  assert.equal(state().fly.props.visible, true);
  entry(tree, "Settings").props.onPointerLeave(pointer(settingsButton));
  fake.advance(220);
  assert.equal(state().fly.props.visible, false);
  view.runtime.unmount();
});

test("Tab leaves a group flyout for the next shown rail entry", () => {
  // Movies has two instances, so outside the rail it has an arrow. The rail
  // does not render it; a hidden element (visibility: hidden) keeps its
  // boxes but takes no focus, so Tab skips it as well.
  const expanded = render(baseProps().props);
  assert.equal(button(expanded, "Instances").props.title, "Instances");
  const { props } = baseProps({ mode: "rail" });
  const { root, state } = railView(props);
  let { tree, fly } = state();
  assert.equal(button(tree, "Instances"), undefined, "no arrow in the rail");
  const movies = element("movies", { focusVisible: true }),
    hiddenArrow = element("arrow", { visibility: "hidden" }),
    series = element("series"),
    toggle = element("toggle");
  root.focusables = [element("dashboard"), movies, hiddenArrow, series, toggle];
  entry(tree, "Movies").props.onKeyDown({
    key: "ArrowRight",
    preventDefault() {},
    currentTarget: movies,
  });
  ({ fly } = state());
  assert.equal(fly.props.visible, true);
  fly.props.tab(false);
  assert.equal(hiddenArrow.focused, 0, "the hidden element is skipped");
  assert.equal(series.focused, 1, "Tab goes on to the next entry");
  assert.equal(state().fly.props.visible, false);
  // Shift+Tab goes back to the group's own entry.
  ({ tree } = state());
  entry(tree, "Movies").props.onKeyDown({
    key: "ArrowRight",
    preventDefault() {},
    currentTarget: movies,
  });
  state().fly.props.tab(true);
  assert.equal(movies.focused, 1);
  assert.equal(series.focused, 1);
});

test("Escape outside rail and flyout stays the page's", () => {
  const { props } = baseProps({ mode: "rail" });
  const { document, state } = railView(props);
  document.body = { name: "body" };
  const { tree } = state();
  const settingsButton = element("settings");
  entry(tree, "Settings").props.onClick({
    detail: 1,
    currentTarget: settingsButton,
  });
  assert.equal(state().fly.props.visible, true);
  const escape = document.listeners.get("keydown");
  const press = () => {
    const event = {
      key: "Escape",
      defaultPrevented: false,
      prevented: 0,
      preventDefault() {
        this.prevented++;
      },
    };
    document.listeners.get("keydown")?.(event);
    return event.prevented;
  };
  assert.ok(escape, "Escape is heard while the flyout shows");
  // Focus in a dialog of the page: its Escape is not taken.
  document.activeElement = element("search field", { rail: false });
  assert.equal(press(), 0, "not cancelled");
  assert.equal(state().fly.props.visible, true, "the flyout stays");
  // Focus nowhere (body) or in the rail: Escape steps back.
  document.activeElement = document.body;
  assert.equal(press(), 1);
  assert.equal(state().fly.props.visible, false);
  entry(state().tree, "Settings").props.onClick({
    detail: 1,
    currentTarget: settingsButton,
  });
  assert.equal(state().fly.props.visible, true);
  document.activeElement = settingsButton;
  assert.equal(press(), 1);
  assert.equal(state().fly.props.visible, false);
  assert.equal(settingsButton.focused, 1, "focus returns to the entry");
});
