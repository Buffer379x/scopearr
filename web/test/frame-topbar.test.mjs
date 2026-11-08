import test from "node:test";
import assert from "node:assert/strict";
import * as icons from "lucide-preact";
import {
  componentHarness,
  loadSource,
  nodes,
  PRESENTATION_MODULES,
} from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";
import { allSources, src } from "./helpers/sources.mjs";

// The topbar, the phone tab bar, the popover and the sync display as
// components (components/frame/, hooks/useScrolled.ts). They are built but
// not mounted yet. NavLink, BrandMark, SyncStatus and Topbar are stubbed
// presentation modules, so a tree shows their props.

// --- The frame model, built like frame-sidebar.test.mjs ----------------------

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
const statusWith = ({ mux = 3, failed = 0, sync } = {}) => ({
  demo: false,
  mux: { enabled: true, installed: true, pending: mux, running: 0, failed },
  unraid: { enabled: false },
  files: { available: true, pending: 0, running: 0, failed: 0 },
  sync: sync ?? {
    radarr: { count: 10, lastSuccess: "2026-11-07T09:41:00Z" },
    "radarr-4k": { count: 5, lastSuccess: "2026-11-07T08:00:00Z" },
    sonarr: { count: 20, lastSuccess: "2026-11-07T07:00:00Z" },
  },
});
const identity = (key) => key;
const input = (hash, status = statusWith()) => ({
  route: router.parseRoute(hash),
  settings,
  status,
  translate: identity,
});

// --- Rendering ---------------------------------------------------------------

const t = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");
const ui = { ICON: { sort: 13, label: 15, button: 16 }, count: String };
const notifications = loadSource("notifications.ts");
const plain = (value) => JSON.parse(JSON.stringify(value));
const hrefOf = (target) => "#/" + JSON.stringify(target);
// The sync summary as the frame passes it: dates through fixed formatters,
// so "no sync yet" would show as a bare "Last sync: ".
const summary = (status = statusWith()) =>
  frameStatus.syncSummary(
    status,
    settings,
    t,
    (iso) => (iso ? "7 Nov" : ""),
    (iso) => (iso ? "09:41" : ""),
  );

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
// Visible text: every string, aria-hidden parts included.
const textOf = (node) =>
  nodes(node)
    .flatMap((n) => [n.props?.children].flat())
    .filter((child) => typeof child === "string" || typeof child === "number")
    .join("");
const buttons = (tree) => nodes(tree).filter((n) => n.type === "button");
const button = (tree, name) =>
  buttons(tree).find((n) => accessibleName(n) === name);

function topbarProps(overrides = {}) {
  const calls = [];
  return {
    calls,
    props: {
      mode: "rail",
      crumbs: navModel.breadcrumbs(input("#/movies?instance=radarr-4k")),
      title: "Movie library",
      scrolled: false,
      demo: true,
      sync: summary(),
      jobs: frameStatus.jobsSummary(statusWith()),
      theme: "dark",
      homeHref: "#/dashboard",
      openHome: () => calls.push(["openHome"]),
      toggleTheme: () => calls.push(["toggleTheme"]),
      signOut: () => calls.push(["signOut"]),
      ...overrides,
    },
  };
}
const topbar = (props) =>
  componentHarness("frame/Topbar", props, {
    exportName: "Topbar",
    modules: { "../../i18n": { t }, "../../ui": ui },
  }).render();
const header = (tree) => nodes(tree).find((n) => hasClass(n, "v2-topbar"));
const syncStatus = (props) =>
  componentHarness("frame/SyncStatus", props, {
    exportName: "SyncStatus",
    modules: { "../../i18n": { t }, "../../ui": ui },
  }).render();
const LONG_DEMO = "Demo · sample data, no connection to your services";

// --- The brief's cases -------------------------------------------------------

test("the topbar shows what its breakpoint allows", () => {
  const sync = summary();
  for (const mode of ["rail", "expanded"]) {
    const tree = topbar(topbarProps({ mode, sync }).props);
    const root = header(tree);
    assert.equal(root.type, "header", "the banner landmark");
    assert.equal(root, tree, "the header is the root");
    // Breadcrumbs, then the end group in a fixed order.
    const crumbs = nodes(tree).find((n) => n.type === "nav");
    assert.equal(crumbs.props["aria-label"], "Breadcrumbs", mode);
    const end = nodes(tree).find((n) => hasClass(n, "v2-topbar-end"));
    assert.ok(end, mode + ": an end group");
    const order = [end.props.children]
      .flat()
      .filter((child) => child && typeof child === "object")
      .map((child) =>
        child.type === "SyncStatus"
          ? "sync"
          : hasClass(child, "v2-pill")
            ? "demo"
            : accessibleName(child),
      );
    assert.deepEqual(
      order,
      [
        "demo",
        ...(mode === "rail" ? ["sync"] : []),
        "Quick search",
        "Tools, 3 open jobs",
        "Light theme",
        "Sign out",
      ],
      mode,
    );
    // Rail: the sync chip; expanded: the sidebar's sync card takes over.
    const chips = nodes(tree).filter((n) => n.type === "SyncStatus");
    if (mode === "rail") {
      assert.equal(chips.length, 1);
      assert.equal(chips[0].props.variant, "chip");
      assert.equal(chips[0].props.summary, sync);
    } else assert.equal(chips.length, 0);
    // No phone parts.
    assert.equal(
      nodes(tree).some((n) => n.type === "NavLink"),
      false,
      mode + ": no brand link",
    );
    assert.equal(byClass(tree, "v2-topbar-title").length, 0, mode);
  }
  // Without sync data the rail shows no chip.
  assert.equal(
    nodes(topbar(topbarProps({ sync: null }).props)).some(
      (n) => n.type === "SyncStatus",
    ),
    false,
  );

  // Phone: brand, demo, bell and theme; the title waits for scrolling.
  const { calls, props } = topbarProps({ mode: "drawer", sync });
  const tree = topbar(props);
  assert.equal(
    nodes(tree).some((n) => n.type === "nav"),
    false,
    "no breadcrumbs",
  );
  assert.equal(button(tree, "Quick search"), undefined, "no search");
  assert.equal(button(tree, "Sign out"), undefined, "no sign out");
  assert.equal(
    nodes(tree).some((n) => n.type === "SyncStatus"),
    false,
    "no chip",
  );
  const home = nodes(tree).find((n) => n.type === "NavLink");
  assert.equal(home.props.label, "Scopearr home");
  assert.equal(home.props.href, "#/dashboard");
  assert.ok(nodes(home).some((n) => n.type === "BrandMark"));
  home.props.open();
  assert.deepEqual(calls, [["openHome"]]);
  assert.equal(byClass(tree, "v2-pill").length, 1, "the demo pill");
  assert.ok(button(tree, "Tools, 3 open jobs"), "the bell");
  assert.ok(button(tree, "Light theme"), "the theme");
  const title = byClass(tree, "v2-topbar-title");
  assert.equal(title.length, 1);
  assert.equal(title[0].type, "span");
  assert.equal(textOf(title[0]), "Movie library");
  // Scrolling only sets the state; the parts stay the same.
  assert.equal(header(tree).props["data-scrolled"], undefined);
  const scrolled = topbar(
    topbarProps({ mode: "drawer", scrolled: true }).props,
  );
  assert.equal(header(scrolled).props["data-scrolled"], "");
  assert.deepEqual(
    nodes(scrolled).map((n) => n.type),
    nodes(tree).map((n) => n.type),
  );
  // The theme button and sign out work as in 1.7.0.
  const light = topbarProps({ theme: "light" });
  const lightTree = topbar(light.props);
  const theme = button(lightTree, "Dark theme");
  assert.equal(theme.props.title, "Dark theme");
  assert.ok(nodes(theme).some((n) => n.type === icons.Moon));
  assert.ok(
    nodes(button(tree, "Light theme")).some((n) => n.type === icons.Sun),
  );
  theme.props.onClick({ currentTarget: {} });
  button(lightTree, "Sign out").props.onClick({ currentTarget: {} });
  assert.deepEqual(light.calls, [["toggleTheme"], ["signOut"]]);
  // Without the demo there is no pill.
  assert.equal(
    byClass(topbar(topbarProps({ demo: false }).props), "v2-pill").length,
    0,
  );
});

test("breadcrumbs end with the current page", () => {
  for (const [hash, expected] of [
    [
      "#/movies?instance=radarr-4k",
      ["Scopearr", "Library", "Movies", "Radarr 4K"],
    ],
    ["#/dashboard", ["Scopearr", "Library", "Dashboard"]],
    ["#/settings/system", ["Scopearr", "Settings", "System"]],
  ]) {
    const crumbs = navModel.breadcrumbs(input(hash));
    const tree = topbar(topbarProps({ crumbs }).props);
    const nav = nodes(tree).find((n) => n.type === "nav");
    assert.equal(nav.props["aria-label"], "Breadcrumbs");
    const list = [nav.props.children].flat().filter(Boolean);
    assert.equal(list.length, 1);
    assert.equal(list[0].type, "ol", "nav > ol");
    const items = [list[0].props.children].flat().filter(Boolean);
    assert.ok(
      items.every((item) => item.type === "li"),
      "ol > li",
    );
    assert.deepEqual(items.map(textOf), expected, hash);
    // Only the last crumb is the current page; crumbs are text, not links.
    assert.deepEqual(
      items.map((item) => item.props["aria-current"]),
      expected.map((_, i) => (i === expected.length - 1 ? "page" : undefined)),
    );
    assert.equal(
      nodes(nav).some((n) => n.type === "a" || n.type === "NavLink"),
      false,
    );
  }
});

test("the demo pill carries the long text as its title", () => {
  for (const mode of ["rail", "expanded", "drawer"]) {
    const tree = topbar(topbarProps({ mode }).props);
    const [pill] = byClass(tree, "v2-pill");
    assert.equal(pill.type, "span", mode + ": static, not a button");
    assert.equal(pill.props.title, LONG_DEMO);
    // Both texts are there; CSS shows one per width. Assistive technology
    // reads the long text only.
    const [long] = byClass(pill, "v2-demo-long");
    const [short] = byClass(pill, "v2-demo-short");
    assert.equal(textOf(long), LONG_DEMO);
    assert.equal(textOf(short), "Demo");
    assert.ok(hidden(short), "the short text is decorative");
    assert.equal(hidden(long), false);
    assert.equal(accessibleName(pill), LONG_DEMO);
  }
});

test("the bell names the open jobs and marks failures", () => {
  for (const [mux, failed] of [
    [0, 0],
    [3, 0],
    [7, 2],
    [9, 1],
    [98, 0],
  ]) {
    const jobs = frameStatus.jobsSummary(statusWith({ mux, failed }));
    const open = mux + failed;
    assert.equal(jobs.count, open, "the bell counts the tools badge");
    for (const scrolled of [false, true]) {
      const tree = topbar(topbarProps({ jobs, scrolled }).props);
      const bell = button(tree, "Tools, " + open + " open jobs");
      assert.ok(bell, String(open));
      assert.equal(bell.props.title, "Tools, " + open + " open jobs");
      assert.ok(hasClass(bell, "v2-bell"), "the plaque's host");
      assert.ok(nodes(bell).some((n) => n.type === icons.Bell));
      const plaques = byClass(bell, "v2-plaque");
      if (!open) {
        assert.equal(plaques.length, 0, "no plaque without jobs");
        continue;
      }
      // The plaque is a child of the button, absolute and decorative.
      assert.equal(plaques.length, 1);
      assert.ok([bell.props.children].flat().includes(plaques[0]));
      assert.ok(hidden(plaques[0]));
      assert.equal(plaques[0].props.children, String(open));
      assert.equal(hasClass(plaques[0], "v2-plaque--error"), failed > 0);
      // Over the band the plaque takes the band's colors.
      assert.equal(hasClass(plaques[0], "v2-plaque--band"), !scrolled);
    }
  }
});

test("triggers without an overlay announce nothing", () => {
  const sync = summary();
  // E15: until their overlays exist, chip, search and bell neither announce
  // a popup nor act.
  const bare = topbar(topbarProps({ sync }).props);
  for (const name of ["Quick search", "Tools, 3 open jobs"]) {
    const trigger = button(bare, name);
    assert.equal(trigger.props["aria-expanded"], undefined, name);
    assert.equal(trigger.props["aria-haspopup"], undefined, name);
    trigger.props.onClick({ currentTarget: {} });
  }
  const chip = nodes(bare).find((n) => n.type === "SyncStatus");
  assert.equal(chip.props.onOpen, undefined);
  // The search names its shortcut either way.
  assert.equal(
    button(bare, "Quick search").props["aria-keyshortcuts"],
    "Control+K Meta+K",
  );
  assert.equal(button(bare, "Quick search").props.title, "Quick search");

  // With handlers they announce their popup and its state.
  const anchors = [];
  for (const open of [null, "sync", "jobs", "search"]) {
    const { props } = topbarProps({
      sync,
      open,
      onSync: (anchor) => anchors.push(["sync", anchor]),
      onJobs: (anchor) => anchors.push(["jobs", anchor]),
      onSearch: () => anchors.push(["search"]),
    });
    const tree = topbar(props);
    const search = button(tree, "Quick search"),
      bell = button(tree, "Tools, 3 open jobs");
    assert.equal(search.props["aria-haspopup"], "dialog");
    assert.equal(search.props["aria-expanded"], open === "search");
    assert.equal(bell.props["aria-haspopup"], "dialog");
    assert.equal(bell.props["aria-expanded"], open === "jobs");
    const syncChip = nodes(tree).find((n) => n.type === "SyncStatus");
    assert.equal(syncChip.props.onOpen, props.onSync);
    assert.equal(syncChip.props.expanded, open === "sync");
    if (open) continue;
    const target = { name: "bell" };
    bell.props.onClick({ currentTarget: target });
    search.props.onClick({ currentTarget: {} });
    assert.deepEqual(anchors, [["jobs", target], ["search"]]);
  }

  // The sync display: a button either way, a popup only with onOpen.
  for (const variant of ["chip", "card", "row"]) {
    const plainButton = syncStatus({ summary: sync, variant });
    assert.equal(plainButton.type, "button", variant);
    assert.equal(plainButton.props.type, "button");
    assert.equal(plainButton.props["aria-haspopup"], undefined, variant);
    assert.equal(plainButton.props["aria-expanded"], undefined, variant);
    plainButton.props.onClick({ currentTarget: {} });
    const opened = [];
    for (const expanded of [false, true]) {
      const trigger = syncStatus({
        summary: sync,
        variant,
        expanded,
        onOpen: (anchor) => opened.push(anchor),
      });
      assert.equal(trigger.props["aria-haspopup"], "dialog", variant);
      assert.equal(trigger.props["aria-expanded"], expanded, variant);
      const anchor = { variant };
      trigger.props.onClick({ currentTarget: anchor });
      assert.equal(opened.at(-1), anchor);
    }
  }
});

// The real Sidebar module gives NAV_ICONS and SIDEBAR_ID.
const sidebarModule = loadSource("components/frame/Sidebar.tsx", {
  modules: {
    "preact/hooks": createHookRuntime().hooks,
    "../../i18n": { t },
    "../../ui": ui,
    "../../flyout": loadSource("flyout.ts"),
    "../../notifications": notifications,
    "./SidebarFlyout": { SidebarFlyout: "SidebarFlyout", FLYOUT_ID: "v2-fly" },
  },
  stubs: PRESENTATION_MODULES,
});
function tabBar(props) {
  const runtime = createHookRuntime();
  const harness = componentHarness("frame/TabBar", props, {
    exportName: "TabBar",
    modules: {
      "preact/hooks": runtime.hooks,
      "../../i18n": { t },
      "../../ui": ui,
      "./Popover": { Popover: "Popover" },
      "./Sidebar": sidebarModule,
    },
  });
  return () => runtime.settle(harness.render);
}

test("the tab bar opens the tools menu with every visible tool", () => {
  const calls = [];
  const props = {
    model: navModel.tabBarModel(input("#/tools/mux")),
    hrefOf,
    open: (target) => calls.push(["open", plain(target)]),
    moreOpen: false,
    openMore: (anchor) => calls.push(["openMore", anchor]),
  };
  const render = tabBar(props);
  let tree = render();
  const nav = nodes(tree).find((n) => n.type === "nav");
  assert.ok(hasClass(nav, "v2-tabbar"));
  assert.equal(nav.props["aria-label"], "Main navigation");
  // Three tabs are links, with the nav model's targets and current state.
  const tabs = nodes(nav).filter((n) => n.type === "NavLink");
  assert.deepEqual(
    tabs.map((tab) => [tab.props.href, !!tab.props.current, tab.props.label]),
    plain(
      props.model.tabs.map((tab) => [
        hrefOf(tab.target),
        tab.current,
        tab.label,
      ]),
    ),
  );
  assert.deepEqual(
    tabs.map((tab) => accessibleName(tab)),
    ["Dashboard", "Movies", "TV series"],
  );
  assert.deepEqual(
    tabs.map((tab) =>
      [icons.LayoutDashboard, icons.Film, icons.Tv].findIndex((icon) =>
        nodes(tab).some((n) => n.type === icon),
      ),
    ),
    [0, 1, 2],
  );
  tabs[1].props.open();
  assert.deepEqual(calls, [
    ["open", { view: "library", service: "radarr", instance: "" }],
  ]);
  calls.length = 0;

  // Tools: a menu button with the open jobs as a plaque on its tile.
  let tools = button(tree, "Tools");
  assert.equal(tools.props.type, "button");
  assert.equal(tools.props["aria-haspopup"], "menu");
  assert.equal(tools.props["aria-expanded"], false);
  assert.equal(tools.props["aria-current"], "page", "a tool page is shown");
  assert.equal(tools.props.title, "Tools");
  const [plaque] = byClass(tools, "v2-plaque");
  assert.equal(plaque.props.children, String(props.model.toolsBadge));
  assert.ok(
    nodes(tools).some(
      (n) => hasClass(n, "v2-tab-tile") && nodes(n).includes(plaque),
    ),
  );
  // More opens the drawer, which is the sidebar.
  const more = button(tree, "More");
  assert.equal(more.props["aria-expanded"], false);
  assert.equal(more.props["aria-controls"], "v2-sidebar");
  assert.equal(more.props["aria-haspopup"], undefined);
  const moreAnchor = { name: "more" };
  more.props.onClick({ currentTarget: moreAnchor });
  assert.deepEqual(calls, [["openMore", moreAnchor]]);
  calls.length = 0;
  props.moreOpen = true;
  assert.equal(button(render(), "More").props["aria-expanded"], true);
  props.moreOpen = false;

  // A click opens the menu at the button: every visible tool, once.
  assert.equal(
    nodes(tree).some((n) => n.type === "Popover"),
    false,
  );
  const anchor = { name: "tools" };
  tools.props.onClick({ currentTarget: anchor });
  tree = render();
  tools = button(tree, "Tools");
  assert.equal(tools.props["aria-expanded"], true);
  const pop = nodes(tree).find((n) => n.type === "Popover");
  assert.equal(pop.props.anchor, anchor);
  assert.equal(pop.props.role, "menu");
  assert.equal(pop.props.placement, "top-end");
  assert.equal(pop.props.label, "Tools");
  const items = nodes(pop).filter((n) => n.type === "NavLink");
  assert.deepEqual(
    items.map((item) => [
      item.props.role,
      item.props.href,
      !!item.props.current,
      accessibleName(item),
    ]),
    plain(
      props.model.tools.map((tool) => [
        "menuitem",
        hrefOf(tool.target),
        tool.current,
        tool.label,
      ]),
    ),
  );
  assert.deepEqual(
    items.map((item) => accessibleName(item)),
    ["Muxing", "Files & permissions"],
    "only visible tools",
  );
  assert.ok(items.every((item) => hasClass(item, "v2-menu-item")));
  // Counts are decorative; the current tool has the gradient tile.
  const muxing = items[0];
  assert.ok(byClass(muxing, "v2-count").every(hidden));
  assert.ok(byClass(muxing, "v2-tile").every((tile) => hidden(tile)));
  assert.ok(hasClass(byClass(muxing, "v2-tile")[0], "v2-tile--grad"));
  assert.equal(
    hasClass(byClass(items[1], "v2-tile")[0], "v2-tile--grad"),
    false,
  );
  // An entry closes the menu and opens its tool.
  items[1].props.open();
  assert.deepEqual(calls, [["open", { view: "files" }]]);
  tree = render();
  assert.equal(
    nodes(tree).some((n) => n.type === "Popover"),
    false,
  );
  assert.equal(button(tree, "Tools").props["aria-expanded"], false);

  // Open again; the button toggles it closed, and close() closes it.
  button(tree, "Tools").props.onClick({ currentTarget: anchor });
  tree = render();
  button(tree, "Tools").props.onClick({ currentTarget: anchor });
  tree = render();
  assert.equal(
    nodes(tree).some((n) => n.type === "Popover"),
    false,
  );
  button(tree, "Tools").props.onClick({ currentTarget: anchor });
  tree = render();
  nodes(tree)
    .find((n) => n.type === "Popover")
    .props.close(true);
  tree = render();
  assert.equal(
    nodes(tree).some((n) => n.type === "Popover"),
    false,
  );

  // The menu closes when the last tool leaves and stays closed when tools
  // come back.
  button(tree, "Tools").props.onClick({ currentTarget: anchor });
  tree = render();
  assert.ok(nodes(tree).some((n) => n.type === "Popover"));
  const withTools = props.model;
  props.model = navModel.tabBarModel(
    input("#/dashboard", {
      ...statusWith(),
      mux: { enabled: false },
      files: { available: false },
    }),
  );
  tree = render();
  props.model = withTools;
  tree = render();
  assert.equal(
    nodes(tree).some((n) => n.type === "Popover"),
    false,
    "a stale menu does not reopen",
  );
  assert.equal(button(tree, "Tools").props["aria-expanded"], false);

  // Without visible tools there is no Tools tab.
  props.model = navModel.tabBarModel(
    input("#/dashboard", {
      ...statusWith(),
      mux: { enabled: false },
      files: { available: false },
    }),
  );
  tree = render();
  assert.equal(props.model.tools.length, 0);
  assert.equal(button(tree, "Tools"), undefined);
  assert.equal(
    nodes(tree).some((n) => n.type === "Popover"),
    false,
  );
  assert.ok(button(tree, "More"));
});

// --- The popover with a fake DOM ---------------------------------------------

// An element: focus, a rectangle, its own children for contains/query and
// the modal it sits in (closest).
function element(name, { rect, children = [], role, modal = null } = {}) {
  return {
    name,
    role,
    rect,
    modal,
    focused: 0,
    style: {},
    offsetWidth: 240,
    offsetHeight: 120,
    children,
    getBoundingClientRect() {
      return this.rect;
    },
    focus() {
      this.focused++;
      dom.activeElement = this;
    },
    contains(node) {
      return node === this || this.children.some((child) => child === node);
    },
    closest(selector) {
      return selector === '[aria-modal="true"]' ? this.modal : null;
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
    },
    querySelectorAll(selector) {
      return selector.includes("menuitem")
        ? this.children.filter((child) => child.role === "menuitem")
        : this.children;
    },
  };
}
// A document that keeps one listener per event type, and a window.
const dom = {
  activeElement: null,
  body: { name: "body" },
  documentElement: { clientWidth: 1440 },
  listeners: new Map(),
  options: new Map(),
  // The toast region, when a test shows one.
  toasts: null,
  querySelector(selector) {
    return selector === ".v2-toasts" ? this.toasts : null;
  },
  addEventListener(type, listener, options) {
    this.listeners.set(type, listener);
    this.options.set(type, options);
  },
  removeEventListener(type) {
    this.listeners.delete(type);
  },
};
const win = {
  innerHeight: 900,
  listeners: new Map(),
  options: new Map(),
  addEventListener(type, listener, options) {
    this.listeners.set(type, listener);
    this.options.set(type, options);
  },
  removeEventListener(type) {
    this.listeners.delete(type);
  },
};
const key = (key, extra = {}) => ({
  key,
  shiftKey: false,
  defaultPrevented: false,
  prevented: 0,
  preventDefault() {
    this.defaultPrevented = true;
    this.prevented++;
  },
  ...extra,
});
// A ResizeObserver that a test triggers by hand.
const observers = [];
class FakeResizeObserver {
  constructor(callback) {
    this.callback = callback;
    this.observed = [];
    observers.push(this);
  }
  observe(target) {
    this.observed.push(target);
  }
  disconnect() {
    this.observed = [];
  }
}
function popover(props, popElement) {
  dom.listeners.clear();
  dom.options.clear();
  win.listeners.clear();
  dom.activeElement = dom.body;
  const runtime = createHookRuntime();
  const harness = componentHarness("frame/Popover", props, {
    exportName: "Popover",
    modules: {
      "preact/hooks": runtime.hooks,
      "../../notifications": notifications,
      "preact/compat": {
        createPortal: (vnode, host) => ({
          type: "Portal",
          props: { host, children: vnode },
        }),
      },
    },
    browser: { document: dom, window: win, ResizeObserver: FakeResizeObserver },
  });
  // As Preact would, attach the element before the layout effects run.
  const tree = runtime.render(harness.render);
  const pop = nodes(tree).find((n) => hasClass(n, "v2-pop"));
  pop.ref.current = popElement;
  runtime.flush();
  return { runtime, tree, pop, rerender: () => runtime.settle(harness.render) };
}

test("a popover closes on Escape and returns focus", () => {
  const calls = [];
  const anchor = element("anchor", {
    rect: { top: 10, bottom: 46, left: 900, right: 936 },
  });
  const first = element("first"),
    second = element("second");
  const panel = element("panel", { children: [first, second] });
  const { tree, pop, runtime } = popover(
    {
      anchor,
      placement: "bottom-end",
      role: "dialog",
      label: "Jobs",
      close: (returnFocus) => calls.push(returnFocus),
      children: "content",
    },
    panel,
  );
  // A portal into body, named, fixed below the anchor's end.
  assert.equal(tree.type, "Portal");
  assert.equal(tree.props.host, dom.body);
  assert.equal(pop.props.role, "dialog");
  assert.equal(pop.props["aria-label"], "Jobs");
  assert.deepEqual(panel.style, { left: 936 - 240 + "px", top: 46 + 6 + "px" });
  // The first element takes focus.
  assert.equal(first.focused, 1);
  assert.equal(dom.activeElement, first);

  // Escape inside: focus returns to the anchor and close(true) runs once.
  const escape = key("Escape");
  dom.listeners.get("keydown")(escape);
  assert.deepEqual(calls, [true]);
  assert.equal(escape.prevented, 1);
  assert.equal(anchor.focused, 1);
  assert.equal(dom.activeElement, anchor);
  // Escape that someone else took, or with focus elsewhere (a dialog), stays
  // theirs.
  dom.listeners.get("keydown")(key("Escape", { defaultPrevented: true }));
  const elsewhere = element("dialog field");
  dom.activeElement = elsewhere;
  const theirs = key("Escape");
  dom.listeners.get("keydown")(theirs);
  assert.equal(theirs.prevented, 0);
  assert.deepEqual(calls, [true]);
  // Escape on body (a click on text inside the popover) closes it.
  dom.activeElement = dom.body;
  dom.listeners.get("keydown")(key("Escape"));
  assert.deepEqual(calls, [true, true]);
  dom.listeners.get("keydown")(key("Enter"));
  assert.deepEqual(calls, [true, true]);

  // A press outside closes without focus; inside or on the anchor does not.
  dom.listeners.get("pointerdown")({ target: second });
  dom.listeners.get("pointerdown")({ target: anchor });
  assert.deepEqual(calls, [true, true]);
  dom.listeners.get("pointerdown")({ target: elsewhere });
  assert.deepEqual(calls, [true, true, false]);
  // A resize closes it too.
  win.listeners.get("resize")({ type: "resize" });
  assert.deepEqual(calls, [true, true, false, false]);
  // Unmounting removes every listener.
  runtime.unmount();
  assert.equal(dom.listeners.size, 0);
  assert.equal(win.listeners.size, 0);
});

// Final review I1 (a): a press in the toast region (a toast's text or its
// dismiss button) is no press outside, so dismissing a toast keeps the
// popover open; a press anywhere else outside still closes it.
test("a press in the toast region keeps a popover open", () => {
  const calls = [];
  const region = element("toast region");
  const toast = element("dismiss");
  toast.closest = (selector) => (selector === ".toast-region" ? region : null);
  popover(
    {
      anchor: element("bell", {
        rect: { top: 10, bottom: 46, left: 900, right: 936 },
      }),
      placement: "bottom-end",
      role: "dialog",
      label: "Jobs",
      close: (returnFocus) => calls.push(returnFocus),
      children: "content",
    },
    element("panel", { children: [element("first")] }),
  );
  dom.listeners.get("pointerdown")({ target: toast });
  assert.deepEqual(calls, []);
  dom.listeners.get("pointerdown")({ target: element("page") });
  assert.deepEqual(calls, [false]);
});

// Final review I1 (b): the toast region (top right, E29) starts --sp-3
// below the open popover while it shares the popover's column and would
// cover it, measured at its own top on each placement and each change of
// the toasts; it moves back when that popover closes, not when one it
// replaced closes later. Only the region's top is touched.
test("toasts stay clear of the open popover", () => {
  // The region at its own top (80) and the 420 wide toast column, or empty.
  const region = (height) => ({
    style: {
      top: "",
      removeProperty(name) {
        this[name] = "";
      },
    },
    getBoundingClientRect: () => ({
      top: 80,
      bottom: 80 + height,
      left: 996,
      right: 1416,
      height,
    }),
  });
  let current;
  const hooks = new Proxy({}, { get: (_, name) => current.hooks[name] });
  const module = loadSource("components/frame/Popover.tsx", {
    modules: {
      "preact/hooks": hooks,
      "../../notifications": notifications,
      "preact/compat": {
        createPortal: (vnode, host) => ({
          type: "Portal",
          props: { host, children: vnode },
        }),
      },
    },
    browser: { document: dom, window: win, ResizeObserver: FakeResizeObserver },
  });
  const open = (name, rect) => {
    const runtime = createHookRuntime();
    current = runtime;
    const tree = runtime.render(() =>
      module.Popover({
        anchor: element(name + " anchor", {
          rect: { top: 40, bottom: 76, left: 1200, right: 1244 },
        }),
        placement: "bottom-end",
        role: "dialog",
        label: name,
        close() {},
        children: "x",
      }),
    );
    nodes(tree).find((n) => hasClass(n, "v2-pop")).ref.current = element(
      name + " panel",
      { rect },
    );
    runtime.flush();
    return runtime;
  };
  const toasts = () => win.listeners.get("scopearr-toasts")({});
  dom.listeners.clear();
  win.listeners.clear();
  // The sync popover below the chip, x 884 to 1244, y 82 to 250.
  const chip = { top: 82, bottom: 250, left: 884, right: 1244 };
  // No toast: the empty region keeps its top.
  dom.toasts = region(0);
  const sync = open("sync", chip);
  assert.equal(dom.toasts.style.top, "");
  // A toast arrives: below the popover.
  dom.toasts = region(60);
  toasts();
  assert.equal(dom.toasts.style.top, "calc(250px + var(--sp-3))");
  // The popover grows (its size or a scroll places it again).
  sync.flush();
  chip.bottom = 300;
  observers.at(-1).callback([]);
  assert.equal(dom.toasts.style.top, "calc(300px + var(--sp-3))");
  // Closing it brings the toasts back.
  current = sync;
  sync.unmount();
  assert.equal(dom.toasts.style.top, "");
  assert.equal(win.listeners.has("scopearr-toasts"), false);

  // Beside the toast column (the card's popover, x 266 to 626) or below
  // the toasts (the tab bar's menu): nothing moves.
  for (const rect of [
    { top: 600, bottom: 800, left: 266, right: 626 },
    { top: 560, bottom: 734, left: 1000, right: 1240 },
  ]) {
    const runtime = open("other", rect);
    assert.equal(dom.toasts.style.top, "", JSON.stringify(rect));
    runtime.unmount();
  }

  // A popover that replaces another (by its owner, after the new one
  // placed): the toasts stay clear of the new one.
  const jobs = open("jobs", { top: 82, bottom: 400, left: 1056, right: 1416 });
  assert.equal(dom.toasts.style.top, "calc(400px + var(--sp-3))");
  const next = open("next", { top: 82, bottom: 200, left: 1056, right: 1416 });
  assert.equal(dom.toasts.style.top, "calc(200px + var(--sp-3))");
  current = jobs;
  jobs.unmount();
  assert.equal(dom.toasts.style.top, "calc(200px + var(--sp-3))");
  current = next;
  next.unmount();
  assert.equal(dom.toasts.style.top, "");
  dom.toasts = null;
});

// Every press outside that closes a popover or menu (pointerdown, click
// and focusin on document) asks inToasts first. The Tooltip closes when the
// pointer leaves its trigger, so it needs none.
test("no outside press counts a press in the toast region", () => {
  const files = new Map();
  for (const path of [
    "components/frame/Popover.tsx",
    "components/frame/Sidebar.tsx",
    "components/MultiFilter.tsx",
    "components/OperatorButton.tsx",
    "components/EvidenceSourceMenu.tsx",
    "components/HelpPopover.tsx",
    "components/MediaServerLink.tsx",
  ])
    files.set(path, src(path));
  const outside =
    /document\.addEventListener\(\s*"(pointerdown|click|focusin)"/g;
  const found = [...allSources().matchAll(outside)].length;
  // Each file above has its listeners; ui.tsx (Tooltip) has one more.
  let listed = 0;
  for (const [path, code] of files) {
    const count = [...code.matchAll(outside)].length;
    assert.ok(count > 0, path + " listens for presses outside");
    listed += count;
    assert.ok(/inToasts\(/.test(code), path + " asks inToasts");
    assert.ok(
      /import \{[^}]*\binToasts\b[^}]*\} from "(\.\.\/)+notifications"/.test(
        code,
      ),
      path + " imports inToasts",
    );
  }
  assert.equal(found, listed + 1, "a new outside press is listed here");
});

// Task 11, carry-forward (a): a popover whose anchor sits in a modal (the
// drawer's sync row) renders inside that modal, so it stays in the modal's
// tree and focus trap. Its Escape listener runs in the capture phase, so it
// closes the popover before the drawer's own Escape closes the drawer.
test("a popover inside a modal renders in it and takes Escape first", () => {
  const calls = [];
  const drawer = { name: "drawer" };
  const row = element("row", {
    rect: { top: 76, bottom: 112, left: 20, right: 296 },
    modal: drawer,
  });
  const first = element("first");
  const panel = element("panel", { children: [first] });
  const { tree, runtime } = popover(
    {
      anchor: row,
      placement: "bottom-end",
      role: "dialog",
      label: "Synchronization",
      close: (returnFocus) => calls.push(returnFocus),
      children: "content",
    },
    panel,
  );
  assert.equal(tree.type, "Portal");
  assert.equal(tree.props.host, drawer, "rendered inside the drawer");
  assert.equal(dom.options.get("keydown"), true, "Escape in the capture phase");
  // Escape inside: the popover closes first and returns focus to its row.
  dom.activeElement = first;
  const escape = key("Escape");
  dom.listeners.get("keydown")(escape);
  assert.equal(escape.prevented, 1, "taken before the drawer sees it");
  assert.deepEqual(calls, [true]);
  assert.equal(dom.activeElement, row);
  runtime.unmount();
  assert.equal(dom.listeners.size, 0);
  // Outside a modal it renders into body, as before.
  const chip = element("chip", {
    rect: { top: 32, bottom: 60, left: 900, right: 928 },
  });
  const outside = popover(
    {
      anchor: chip,
      placement: "bottom-end",
      role: "dialog",
      label: "Synchronization",
      close() {},
      wide: true,
      children: "content",
    },
    element("panel"),
  );
  assert.equal(outside.tree.props.host, dom.body);
  assert.equal(dom.options.get("keydown"), true);
  // A wide popover has the widest popover width (v2-pop--wide); others size
  // to their content.
  assert.equal(outside.pop.props.class, "v2-pop v2-pop--wide");
  assert.equal(
    popover(
      {
        anchor: chip,
        placement: "bottom-end",
        role: "dialog",
        label: "Jobs",
        close() {},
        children: "content",
      },
      element("panel"),
    ).pop.props.class,
    "v2-pop",
  );
});

// Task 11, fix round 1: a button of a dialog popover that locks on its
// press ("Sync now") hands focus to the popover itself. Tab from there goes
// to its first element and Shift+Tab to its last, and the popover stays
// open; without any element to focus, Tab leaves as before. A menu always
// leaves.
test("Tab from the popover itself reaches its elements", () => {
  const calls = [];
  const anchor = element("chip", {
    rect: { top: 32, bottom: 60, left: 900, right: 928 },
  });
  const first = element("first"),
    second = element("second");
  const panel = element("panel", { children: [first, second] });
  const { pop } = popover(
    {
      anchor,
      placement: "bottom-end",
      role: "dialog",
      label: "Synchronization",
      close: (returnFocus) => calls.push(returnFocus),
      children: "content",
    },
    panel,
  );
  const press = (shiftKey) => {
    const event = key("Tab", { shiftKey });
    pop.props.onKeyDown(event);
    return event;
  };
  // Focus on the popover (its pressed button locked): Tab to the first.
  dom.activeElement = panel;
  assert.equal(press(false).prevented, 1);
  assert.equal(dom.activeElement, first);
  // Shift+Tab from the popover: to the last.
  dom.activeElement = panel;
  assert.equal(press(true).prevented, 1);
  assert.equal(dom.activeElement, second);
  assert.deepEqual(calls, [], "it stays open");
  // Between its elements, Tab is the browser's.
  dom.activeElement = first;
  assert.equal(press(false).prevented, 0);
  assert.equal(dom.activeElement, first);
  assert.deepEqual(calls, []);
  // After its last element Tab still leaves from the anchor.
  dom.activeElement = second;
  assert.equal(press(false).prevented, 0);
  assert.equal(dom.activeElement, anchor);
  assert.deepEqual(calls, [false]);

  // Nothing to focus (every button locked, as in the demo): Tab leaves.
  const empty = element("panel", { children: [] });
  const locked = popover(
    {
      anchor,
      placement: "bottom-end",
      role: "dialog",
      label: "Synchronization",
      close: (returnFocus) => calls.push(returnFocus),
      children: "content",
    },
    empty,
  );
  dom.activeElement = empty;
  const tab = key("Tab");
  locked.pop.props.onKeyDown(tab);
  assert.equal(tab.prevented, 0);
  assert.equal(dom.activeElement, anchor);
  assert.deepEqual(calls, [false, false]);

  // A menu leaves on Tab, also from the menu itself.
  const items = ["a", "b"].map((name) => element(name, { role: "menuitem" }));
  const menuPanel = element("menu", { children: items });
  const menu = popover(
    {
      anchor,
      placement: "top-end",
      role: "menu",
      label: "Tools",
      close: (returnFocus) => calls.push(returnFocus),
      children: "items",
    },
    menuPanel,
  );
  dom.activeElement = menuPanel;
  const menuTab = key("Tab");
  menu.pop.props.onKeyDown(menuTab);
  assert.equal(menuTab.prevented, 0);
  assert.equal(dom.activeElement, anchor);
  assert.deepEqual(calls, [false, false, false]);
});

test("a popover stays in the viewport and a menu moves with the arrows", () => {
  const calls = [];
  const items = ["a", "b", "c"].map((name) =>
    element(name, { role: "menuitem" }),
  );
  const panel = element("menu", { children: items });
  // Above the tab bar, from the end of the Tools tab.
  const tab = element("tools", {
    rect: { top: 740, bottom: 804, left: 220, right: 290 },
  });
  const { pop } = popover(
    {
      anchor: tab,
      placement: "top-end",
      role: "menu",
      label: "Tools",
      close: (returnFocus) => calls.push(returnFocus),
      children: "items",
    },
    panel,
  );
  assert.ok(hasClass(pop, "v2-menu"), "a menu");
  assert.deepEqual(panel.style, {
    left: 290 - 240 + "px",
    top: 740 - 6 - 120 + "px",
  });
  assert.equal(items[0].focused, 1);
  // ↓, ↑, Home and End move between the entries and wrap.
  const press = (name) => {
    const event = key(name);
    pop.props.onKeyDown(event);
    return event;
  };
  assert.equal(press("ArrowDown").prevented, 1);
  assert.equal(dom.activeElement, items[1]);
  press("End");
  assert.equal(dom.activeElement, items[2]);
  press("ArrowDown");
  assert.equal(dom.activeElement, items[0]);
  press("ArrowUp");
  assert.equal(dom.activeElement, items[2]);
  press("Home");
  assert.equal(dom.activeElement, items[0]);
  // Tab leaves a menu from its button; Shift+Tab lands on the button.
  const tabKey = press("Tab");
  assert.equal(tabKey.prevented, 0, "Tab goes on from the button");
  assert.equal(dom.activeElement, tab);
  assert.deepEqual(calls, [false]);
  dom.activeElement = items[1];
  const back = key("Tab", { shiftKey: true });
  pop.props.onKeyDown(back);
  assert.equal(back.prevented, 1);
  assert.equal(dom.activeElement, tab);
  assert.deepEqual(calls, [false, false]);

  // Clamped to the viewport (8 from its edges); flipped when it does not fit.
  const near = element("panel", { children: [] });
  popover(
    {
      anchor: element("edge", {
        rect: { top: 850, bottom: 886, left: 10, right: 40 },
      }),
      placement: "bottom-end",
      role: "dialog",
      label: "Sync",
      close() {},
      children: "x",
    },
    near,
  );
  assert.deepEqual(near.style, { left: "8px", top: 850 - 6 - 120 + "px" });
  // Nothing to focus: the popover itself takes focus.
  assert.equal(near.focused, 1);
  const side = element("panel", { children: [] });
  popover(
    {
      anchor: element("card", {
        rect: { top: 700, bottom: 780, left: 28, right: 260 },
      }),
      placement: "right-end",
      role: "dialog",
      label: "Sync",
      close() {},
      children: "x",
    },
    side,
  );
  assert.deepEqual(side.style, { left: 260 + 6 + "px", top: 780 - 120 + "px" });

  // Content that grows after opening (jobs load on open) keeps the popover
  // at its anchor's end: it is placed again when its size changes.
  const growing = element("panel", { children: [] });
  const { runtime } = popover(
    {
      anchor: element("bell", {
        rect: { top: 10, bottom: 46, left: 900, right: 936 },
      }),
      placement: "bottom-end",
      role: "dialog",
      label: "Jobs",
      close() {},
      children: "x",
    },
    growing,
  );
  const observer = observers.at(-1);
  assert.deepEqual(observer.observed, [growing], "watches its own size");
  growing.offsetWidth = 360;
  observer.callback([]);
  assert.deepEqual(growing.style, {
    left: 936 - 360 + "px",
    top: 46 + 6 + "px",
  });
  assert.equal(growing.focused, 1, "placing again moves no focus");
  runtime.unmount();
  assert.deepEqual(observer.observed, [], "stops watching");
});

test("a popover follows its anchor while the page scrolls and when its placement changes", () => {
  const calls = [];
  // The bell in the sticky topbar, before the page scrolls.
  const bell = element("bell", {
    rect: { top: 32, bottom: 68, left: 900, right: 936 },
  });
  const first = element("first");
  const panel = element("panel", { children: [first] });
  const props = {
    anchor: bell,
    placement: "bottom-end",
    role: "dialog",
    label: "Jobs",
    close: (returnFocus) => calls.push(returnFocus),
    children: "x",
  };
  const { runtime, rerender } = popover(props, panel);
  assert.deepEqual(panel.style, { left: 936 - 240 + "px", top: 68 + 6 + "px" });
  // Any scroll (capture, passive) places it again: the topbar moves up 16px
  // until it sticks.
  const scroll = win.listeners.get("scroll");
  assert.ok(scroll, "listens to scrolling");
  assert.equal(win.options.get("scroll")?.capture, true);
  assert.equal(win.options.get("scroll")?.passive, true);
  bell.rect = { top: 16, bottom: 52, left: 900, right: 936 };
  scroll({ type: "scroll" });
  assert.deepEqual(panel.style, { left: 936 - 240 + "px", top: 52 + 6 + "px" });
  assert.deepEqual(calls, [], "scrolling closes nothing");
  // A new placement places it again and moves no focus.
  props.placement = "right-end";
  rerender();
  assert.deepEqual(panel.style, { left: 936 + 6 + "px", top: "8px" });
  assert.equal(first.focused, 1, "focus stays where it is");
  // Closing (unmounting) stops listening.
  runtime.unmount();
  assert.equal(win.listeners.has("scroll"), false);
});

test("one popover is open at a time, whoever opened it", () => {
  // One module, so the popovers share their owner; each has its own hooks.
  let current;
  const hooks = new Proxy({}, { get: (_, name) => current.hooks[name] });
  const module = loadSource("components/frame/Popover.tsx", {
    modules: {
      "preact/hooks": hooks,
      "../../notifications": notifications,
      "preact/compat": {
        createPortal: (vnode, host) => ({
          type: "Portal",
          props: { host, children: vnode },
        }),
      },
    },
    browser: { document: dom, window: win, ResizeObserver: FakeResizeObserver },
  });
  const calls = {};
  // Mounts a popover the way an owner does, by a click or by a program.
  const open = (name, role = "dialog") => {
    calls[name] = [];
    const runtime = createHookRuntime();
    current = runtime;
    const tree = runtime.render(() =>
      module.Popover({
        anchor: element(name + " anchor", {
          rect: { top: 10, bottom: 46, left: 900, right: 936 },
        }),
        placement: role === "menu" ? "top-end" : "bottom-end",
        role,
        label: name,
        close: (returnFocus) => calls[name].push(returnFocus),
        children: "x",
      }),
    );
    nodes(tree).find((n) => hasClass(n, "v2-pop")).ref.current = element(
      name + " panel",
    );
    runtime.flush();
    return runtime;
  };
  dom.activeElement = dom.body;
  const bell = open("jobs");
  assert.deepEqual(calls.jobs, []);
  // The tab bar's Tools menu opens: the bell's popover closes, without
  // taking focus back.
  const menu = open("tools", "menu");
  assert.deepEqual(calls.jobs, [false]);
  assert.deepEqual(calls.tools, []);
  // Its owner unmounts it; the menu stays the open one.
  current = bell;
  bell.unmount();
  const search = open("search");
  assert.deepEqual(calls.tools, [false]);
  assert.deepEqual(calls.jobs, [false], "a closed popover is not closed again");
  // After the last one closed, the next opens without closing anything.
  current = search;
  search.unmount();
  current = menu;
  menu.unmount();
  open("sync");
  assert.deepEqual(calls.search, []);
  assert.deepEqual(calls.tools, [false]);
  assert.deepEqual(calls.sync, []);
});

// --- Additions: useScrolled and the sync display -----------------------------

test("useScrolled turns on past 4px of scrolling", () => {
  const listeners = new Map();
  const page = {
    scrollY: 10,
    addEventListener(type, listener, options) {
      listeners.set(type, { listener, options });
    },
    removeEventListener(type, listener) {
      if (listeners.get(type)?.listener === listener) listeners.delete(type);
    },
  };
  const runtime = createHookRuntime();
  const { useScrolled } = loadSource("hooks/useScrolled.ts", {
    modules: { "preact/hooks": runtime.hooks },
    browser: { window: page },
  });
  // The first render already knows the scroll position.
  assert.equal(
    runtime.render(() => useScrolled()),
    true,
  );
  runtime.flush();
  const scroll = listeners.get("scroll");
  assert.ok(scroll, "listens to scrolling");
  assert.equal(scroll.options.passive, true);
  for (const [y, expected] of [
    [4, false],
    [5, true],
    [0, false],
    [600, true],
  ]) {
    page.scrollY = y;
    scroll.listener();
    assert.equal(
      runtime.settle(() => useScrolled()),
      expected,
      String(y),
    );
  }
  runtime.unmount();
  assert.equal(listeners.size, 0, "stops listening");
  // Another threshold.
  const other = createHookRuntime();
  const hook = loadSource("hooks/useScrolled.ts", {
    modules: { "preact/hooks": other.hooks },
    browser: { window: { ...page, scrollY: 10 } },
  });
  assert.equal(
    other.render(() => hook.useScrolled(20)),
    false,
  );
});

test("the sync display shows one state and never a bare last sync", () => {
  const states = {
    ok: statusWith(),
    running: statusWith({
      sync: { radarr: { count: 1, running: true }, sonarr: { count: 2 } },
    }),
    error: statusWith({
      sync: { radarr: { count: 1, error: "Timeout" }, sonarr: { count: 2 } },
    }),
    off: statusWith({ sync: {} }),
  };
  for (const [state, status] of Object.entries(states)) {
    const value = summary(status);
    assert.equal(value.state, state);
    // Without a sync the summary text would be a bare "Last sync: ".
    const text = state === "off" ? "Synchronization" : value.text;
    for (const variant of ["chip", "card", "row"]) {
      const tree = syncStatus({ summary: value, variant });
      assert.equal(tree.type, "button", variant);
      assert.doesNotMatch(textOf(tree), /Last sync: $|Last sync: (?!09:41)/);
      assert.ok(textOf(tree).includes(text), variant + " " + state);
      assert.equal(tree.props.title, text, variant + " " + state);
      // One decorative dot in the state's tone.
      const dots = byClass(tree, "v2-dot");
      assert.equal(dots.length, 1, variant);
      assert.ok(hidden(dots[0]));
      assert.deepEqual(
        classes(dots[0]).filter((name) => name.startsWith("v2-dot--")),
        [
          ...(state === "ok" ? [] : ["v2-dot--" + state]),
          ...(variant === "chip" ? ["v2-dot--ring"] : []),
        ],
        variant + " " + state,
      );
    }
    // The chip is a pill named by the summary.
    const chip = syncStatus({ summary: value, variant: "chip" });
    assert.ok(hasClass(chip, "v2-pill"));
    assert.ok(hasClass(chip, "v2-sync-chip"));
    assert.equal(accessibleName(chip), text);
    // The card has a title of its own; the row is one line.
    const card = syncStatus({ summary: value, variant: "card" });
    assert.ok(hasClass(card, "v2-sync--card"));
    assert.ok(nodes(card).some((n) => n.type === icons.RefreshCw));
    assert.equal(
      accessibleName(card),
      "Synchronization" + (state === "off" ? "" : value.text),
    );
    const row = syncStatus({ summary: value, variant: "row" });
    assert.ok(hasClass(row, "v2-sync--row"));
    assert.equal(accessibleName(row), text);
  }
  assert.equal(summary().text, "Last sync: 09:41");
});
