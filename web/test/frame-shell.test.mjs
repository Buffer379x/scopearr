import test from "node:test";
import assert from "node:assert/strict";
import * as preact from "preact";
import {
  componentHarness,
  loadSource,
  nodes,
  text,
} from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";
import { between, squash, src } from "./helpers/sources.mjs";

// The app shell in the new frame (docs/STYLEGUIDE.md, Part 1, 10.1): the
// loading screen until the first settings answer, then the sidebar, the
// band with topbar and page header, the transition sheet with the page and
// the phone tab bar. Sidebar, TabBar and Popover are named stubs; Topbar,
// SyncStatus and LoadingScreen are stubbed presentation modules, so a tree
// shows the props the shell hands them.

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
const navLink = loadSource("nav-link.ts");

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
const status = {
  version: "2.0.0",
  demo: true,
  mux: { enabled: true, installed: true, pending: 2, running: 1, failed: 0 },
  unraid: { enabled: false },
  files: { available: true, pending: 0, running: 0, failed: 0 },
  sync: {
    radarr: { count: 10, lastSuccess: "2026-11-07T09:41:00Z" },
    "radarr-4k": { count: 5, lastSuccess: "2026-11-07T08:00:00Z" },
    sonarr: { count: 20, lastSuccess: "2026-11-07T07:00:00Z" },
  },
};

const t = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");
const plain = (value) => JSON.parse(JSON.stringify(value));
const classes = (node) => String(node?.props?.class ?? "").split(/\s+/);
const hasClass = (node, name) => classes(node).includes(name);
const byType = (tree, type) => nodes(tree).find((n) => n.type === type);
const byClass = (tree, name) => nodes(tree).find((n) => hasClass(n, name));
const navInput = (route) => ({ route, settings, status, translate: t });

// A navigation whose route and older state can disagree: the frame reads
// only the route.
function navigation(hash, extra = {}) {
  const route = router.parseRoute(hash);
  const calls = [];
  return {
    calls,
    value: {
      view: route.view === "settings" ? "library" : route.view,
      service: "radarr",
      filters: { radarr: "", sonarr: "" },
      settingsOpen: route.view === "settings",
      settingsSection: route.view === "settings" ? route.section : "",
      settingsMount: 0,
      route,
      revision: 0,
      libraryEntry: 0,
      fromHistory: false,
      openLink: async (target) => {
        calls.push(plain(target));
        return true;
      },
      linkHref: (target) => router.formatRoute(navTarget(target)),
      openFiles: () => calls.push("openFiles"),
      openSettings: () => calls.push("openSettings"),
      replaceRoute: () => {},
      setSettingsDirty: () => {},
      setSectionGuard: () => {},
      canLeaveRules: async () => true,
      ...extra,
    },
  };
}
// The route of a link target, as linkHref gives it for these targets.
function navTarget(target) {
  if (target.view === "library")
    return {
      view: "library",
      service: target.service,
      filters: target.instance ? "instance=" + target.instance : "",
      page: 1,
      sort: "",
      dir: "",
    };
  if (target.view === "settings")
    return { view: "settings", section: target.section, tab: "", query: "" };
  if (target.view === "statistics") return { view: "statistics" };
  return { view: target.view, query: "" };
}

// The real PageHeader module (its context is the frame's slot).
function pageHeaderModule(runtime) {
  return loadSource("components/PageHeader.tsx", {
    modules: {
      preact,
      "preact/hooks": runtime.hooks,
      "preact/compat": {
        createPortal: (vnode, host) => ({
          type: "Portal",
          props: { host, children: vnode },
        }),
      },
    },
  });
}

function shell({
  hash = "#/dashboard",
  ready = true,
  mode = "rail",
  drawerOpen = false,
  reduce = false,
  nav = navigation(hash),
} = {}) {
  const runtime = createHookRuntime();
  const pageHeader = pageHeaderModule(runtime);
  const sidebarCalls = [],
    scrolls = [],
    animations = [],
    stored = [],
    requests = [];
  const sidebar = {
    mode,
    toggleMode: () => sidebarCalls.push("toggleMode"),
    groups: { movies: true, series: true, settings: false },
    toggleGroup: (group) => sidebarCalls.push("group " + group),
    drawerOpen,
    openDrawer: (anchor) => sidebarCalls.push(["openDrawer", anchor]),
    closeDrawer: () => sidebarCalls.push("closeDrawer"),
  };
  const root = {
    attributes: {},
    dataset: {},
    style: { setProperty() {}, removeProperty() {} },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
  };
  const window = {
    scrollTo: (x, y) => scrolls.push([x, y]),
    matchMedia: (query) => ({
      matches: query.includes("reduce") ? reduce : false,
    }),
  };
  const localStorage = {
    getItem: () => null,
    setItem: (key, value) => stored.push([key, value]),
    removeItem() {},
  };
  const appearance = loadSource("appearance.ts", {
    modules: {
      "./browser-storage": loadSource("browser-storage.ts", {
        browser: { localStorage },
      }),
    },
  });
  const document = { documentElement: root };
  const data = {
    settings,
    settingsReady: ready,
    setSettings: () => {},
    loadSettings: async () => {},
    presets: [],
    loadPresets: async () => {},
    customTags: [],
    customRevision: 0,
    loadCustom: async () => [],
  };
  const props = {
    status,
    refresh: async () => requests.push("refresh"),
    navigation: nav.value,
  };
  const harness = componentHarness("AppShell", props, {
    browser: {
      window,
      document,
      getComputedStyle: (element) => ({
        getPropertyValue: (name) =>
          element === root && name === "--ease"
            ? " cubic-bezier(0.2, 0.7, 0.2, 1)"
            : "",
      }),
    },
    modules: {
      "preact/hooks": runtime.hooks,
      "preact/compat": {
        lazy: () => "LazyPage",
        Suspense: "Suspense",
      },
      "../api": {
        api: async (path, method = "GET") => requests.push(method + " " + path),
      },
      "../appearance": appearance,
      "../frame-status": frameStatus,
      "../i18n": { t, getLocale: () => "en" },
      "../nav-model": navModel,
      "../themes": { applyInterfaceTheme: () => {} },
      "../ui": {
        ICON: { label: 15, button: 16 },
        date: (iso) => (iso ? "7 Nov" : "Not synced yet"),
        clock: (iso) => (iso ? "09:41" : ""),
      },
      "./AppDataProvider": { useAppData: () => data },
      "../hooks/useLanguageRegistry": { useLanguageRegistry: () => false },
      "../hooks/useLibraryState": {
        useLibraryState: () => ({ openDashboardFilter: () => {} }),
      },
      "../hooks/useScrolled": { useScrolled: () => false },
      "../hooks/useSidebar": { useSidebar: () => sidebar },
      "./LibraryPage": {
        LibraryPage: "LibraryPage",
        LibraryDialogs: "LibraryDialogs",
      },
      "./StatisticsPage": { StatisticsPage: "StatisticsPage" },
      "./PageHeader": pageHeader,
      "./frame/Sidebar": { Sidebar: "Sidebar" },
      "./frame/TabBar": { TabBar: "TabBar" },
      "./frame/Popover": { Popover: "Popover" },
    },
  });
  const render = () => runtime.settle(harness.render);
  const tree = render();
  return {
    tree,
    render,
    runtime,
    props,
    nav,
    pageHeader,
    sidebar,
    sidebarCalls,
    scrolls,
    animations,
    stored,
    requests,
    root,
  };
}

test("the shell paints the frame after the first settings answer", () => {
  // Before the first /api/settings answer: the loading screen, no frame.
  const waiting = shell({ ready: false });
  assert.equal(waiting.tree.type, "LoadingScreen");
  assert.equal(byType(waiting.tree, "Sidebar"), undefined);
  assert.equal(byClass(waiting.tree, "v2-frame"), undefined);

  // Then the frame, in this order: skip control, sidebar, frame (band,
  // topbar, main with the header slot and the view), tab bar, dialogs.
  const { tree } = shell();
  const root = byClass(tree, "v2-shell");
  assert.equal(root.props["data-mode"], "rail");
  const children = root.props.children
    .flat(Infinity)
    .filter((child) => child && typeof child === "object");
  assert.deepEqual(
    // Elements by tag and first class, components by name.
    plain(children).map((child) =>
      /^[a-z]/.test(child.type)
        ? child.type + "." + classes(child)[0]
        : child.type,
    ),
    ["button.v2-skip", "Sidebar", "div.v2-frame", "TabBar", "LibraryDialogs"],
  );
  const skip = children[0];
  assert.equal(skip.props.type, "button");
  assert.equal(text(skip), "Skip to content");
  assert.equal(
    skip.props.href,
    undefined,
    "no #main hash, it would be a route",
  );

  const frame = byClass(tree, "v2-frame");
  const [band, topbar, main] = frame.props.children.filter(Boolean);
  assert.ok(hasClass(band, "v2-band"));
  assert.equal(band.props["aria-hidden"], "true");
  assert.equal(topbar.type, "Topbar");
  assert.equal(main.type, "main");
  assert.equal(main.props.id, "main");
  assert.ok(hasClass(main, "v2-main"));
  assert.equal(main.props["data-sheet"], "");
  assert.equal(main.props.tabIndex, -1);
  const [slot, view] = main.props.children.filter(Boolean);
  assert.ok(hasClass(slot, "v2-page-slot"));
  assert.ok(hasClass(view, "v2-view"));
  assert.equal(byType(view, "StatisticsPage").type, "StatisticsPage");

  // The skip control focuses main.
  const focused = [];
  main.ref.current = { focus: () => focused.push("main") };
  skip.props.onClick();
  assert.deepEqual(focused, ["main"]);
});

test("the frame is built only from the route", () => {
  for (const hash of [
    "#/dashboard",
    "#/movies?instance=radarr-4k",
    "#/series",
    "#/tools/mux",
    "#/settings/system/log",
    "#/settings/appearance",
  ]) {
    // The older state says "library" everywhere: the frame ignores it.
    const nav = navigation(hash, {
      view: "library",
      service: "sonarr",
      settingsOpen: false,
      settingsSection: "widgets",
    });
    const { tree } = shell({ hash, nav });
    const route = router.parseRoute(hash);
    const input = navInput(route);
    const sidebar = byType(tree, "Sidebar"),
      topbar = byType(tree, "Topbar"),
      tabBar = byType(tree, "TabBar");
    assert.deepEqual(
      plain(sidebar.props.sections),
      plain(navModel.navModel(input)),
      hash,
    );
    assert.deepEqual(
      plain(topbar.props.crumbs),
      plain(navModel.breadcrumbs(input)),
      hash,
    );
    assert.deepEqual(
      plain(tabBar.props.model),
      plain(navModel.tabBarModel(input)),
      hash,
    );
    // Hrefs and plain clicks are the navigation's guarded links.
    assert.equal(sidebar.props.hrefOf, nav.value.linkHref, hash);
    assert.equal(sidebar.props.open, nav.value.openLink, hash);
    assert.equal(tabBar.props.hrefOf, nav.value.linkHref, hash);
    assert.equal(tabBar.props.open, nav.value.openLink, hash);
    // The jobs of the bell, the version of the brand, the demo pill.
    assert.deepEqual(
      plain(topbar.props.jobs),
      plain(frameStatus.jobsSummary(status)),
    );
    assert.equal(sidebar.props.version, "2.0.0");
    assert.equal(topbar.props.demo, true);
  }
  // The source reads no older state for the frame.
  const shellCode = squash(src("components/AppShell.tsx"));
  for (const part of ["<Sidebar ", "<Topbar ", "<TabBar "])
    assert.doesNotMatch(
      between(shellCode, part, "/>"),
      /settingsOpen|\bview\b|navigationPage/,
      part,
    );
});

test("the page header sits on the band with a fixed slot for actions", () => {
  const runtime = createHookRuntime();
  const module = pageHeaderModule(runtime);
  const header = (props) =>
    runtime.settle(() => module.PageHeader({ title: "Muxing", ...props }));

  // Outside the frame it renders in place.
  let tree = header({ meta: "3 open", metaTitle: "Open items" });
  assert.equal(tree.type, "div");
  assert.ok(hasClass(tree, "v2-page-head"));
  const [textBox, actions] = tree.props.children;
  assert.ok(hasClass(textBox, "v2-page-text"));
  const [title, summary] = textBox.props.children;
  assert.equal(title.type, "h1");
  assert.ok(hasClass(title, "v2-page-title"));
  assert.equal(text(title), "Muxing");
  assert.equal(summary.type, "p");
  assert.ok(hasClass(summary, "v2-page-sum"));
  assert.equal(text(summary), "3 open");
  assert.equal(summary.props.title, "Open items");
  // The action slot is always there; it stays empty until Phase 5.
  assert.ok(hasClass(actions, "v2-page-actions"));
  assert.equal(nodes(actions.props.children).length, 0);

  // Without a summary or actions the boxes stay, so the title keeps its
  // place on every page.
  tree = header({ title: "Settings", as: "section" });
  assert.equal(tree.type, "section");
  const [box, slot] = tree.props.children;
  assert.equal(box.props.children.length, 2);
  assert.equal(text(box.props.children[1]), "");
  assert.equal(box.props.children[1].props.title, undefined);
  assert.ok(hasClass(slot, "v2-page-actions"));
  tree = header({ actions: { type: "button", props: { children: "Scan" } } });
  assert.equal(text(tree.props.children[1]), "Scan");

  // In the frame: a portal into the band slot, and the title for the topbar.
  const titles = [];
  const host = { name: "slot" };
  const contexts = new Map();
  const runtimeWith = createHookRuntime({ contexts });
  const moduleWith = pageHeaderModule(runtimeWith);
  contexts.set(moduleWith.PageTitleContext, {
    slot: host,
    setTitle: (title) => titles.push(title),
  });
  const props = { title: "Disk placement", meta: "2 open" };
  tree = runtimeWith.settle(() => moduleWith.PageHeader(props));
  assert.equal(tree.type, "Portal");
  assert.equal(tree.props.host, host);
  assert.ok(hasClass(tree.props.children, "v2-page-head"));
  assert.deepEqual(titles, ["Disk placement"]);
  props.title = "Files & permissions";
  runtimeWith.settle(() => moduleWith.PageHeader(props));
  assert.deepEqual(titles.at(-1), "Files & permissions");
  runtimeWith.unmount();
  assert.equal(titles.at(-1), "", "an unmounted page leaves no title");
  // Before the slot exists, the framed header waits instead of rendering
  // inside the page.
  const empty = new Map();
  const waitRuntime = createHookRuntime({ contexts: empty });
  const waitModule = pageHeaderModule(waitRuntime);
  empty.set(waitModule.PageTitleContext, { slot: null, setTitle() {} });
  assert.equal(
    waitRuntime.settle(() => waitModule.PageHeader({ title: "Wait" })),
    null,
  );

  // The shell provides the slot and shows the reported title on the phone
  // topbar.
  const h = shell({ mode: "drawer" });
  const provider = nodes(h.tree).find(
    (n) => n.type === h.pageHeader.PageTitleContext.Provider,
  );
  assert.ok(provider, "the shell provides the page header context");
  const slotNode = byClass(h.tree, "v2-page-slot");
  slotNode.ref({ name: "slot element" });
  let next = h.render();
  const value = nodes(next).find(
    (n) => n.type === h.pageHeader.PageTitleContext.Provider,
  ).props.value;
  assert.deepEqual(value.slot, { name: "slot element" });
  value.setTitle("Dashboard");
  next = h.render();
  assert.equal(byType(next, "Topbar").props.title, "Dashboard");
  // The value keeps its identity while the slot stays (no render loop).
  assert.equal(
    nodes(h.render()).find(
      (n) => n.type === h.pageHeader.PageTitleContext.Provider,
    ).props.value,
    value,
  );
});

test("the settings page has no section navigation of its own", () => {
  const page = squash(src("components/SettingsPage.tsx"));
  assert.doesNotMatch(page, /settings-tabs|Settings sections|aria-pressed/);
  assert.doesNotMatch(page, /\bopenSection\b|\bchangeSection\b/);
  assert.match(page, /<PageHeader title=\{t\("Settings"\)\} \/>/);
  // The sticky section heading measures under the frame's topbar.
  assert.match(page, /document\.querySelector\("\.v2-topbar"\)/);
  assert.doesNotMatch(page, /querySelector\("\.header"\)/);
  const draft = squash(src("hooks/useSettingsDraft.ts"));
  assert.doesNotMatch(draft, /\bopenSection\b|\bchangeSection\b/);
  // The shell hands it no way to open a section; the sidebar group does.
  const shellCode = squash(src("components/AppShell.tsx"));
  assert.doesNotMatch(between(shellCode, "<SettingsPage", "/>"), /openSection/);
  const areas = navModel
    .navModel(navInput(router.parseRoute("#/settings/widgets")))
    .find((section) => section.key === "system")
    .nodes.find((node) => node.key === "settings");
  assert.deepEqual(
    plain(areas.children.map((entry) => [entry.label, entry.current])),
    [
      ["Services", false],
      ["Display", false],
      ["Widgets", true],
      ["Custom tags", false],
      ["Tag rules", false],
      ["System", false],
    ],
  );
});

test("the brand links to the dashboard", () => {
  const { tree, nav } = shell({ hash: "#/movies", mode: "drawer" });
  const topbar = byType(tree, "Topbar"),
    sidebar = byType(tree, "Sidebar");
  // Both brands lead to the dashboard route, the sidebar through hrefOf.
  assert.equal(topbar.props.homeHref, "#/dashboard");
  assert.equal(sidebar.props.hrefOf({ view: "statistics" }), "#/dashboard");
  // The phone brand is a NavLink: a plain click opens the dashboard in the
  // app, a modified or middle click keeps the browser's link.
  const link = loadSource("components/frame/NavLink.tsx", {
    modules: { "../../nav-link": navLink },
  }).NavLink({
    href: topbar.props.homeHref,
    open: topbar.props.openHome,
    label: "Scopearr home",
    children: "mark",
  });
  assert.equal(link.type, "a");
  assert.equal(link.props.href, "#/dashboard");
  const click = (event = {}) => {
    const prevented = [];
    link.props.onClick({
      button: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      ...event,
      preventDefault: () => prevented.push(true),
    });
    return prevented.length;
  };
  for (const event of [
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
  ]) {
    assert.equal(click(event), 0, JSON.stringify(event));
    assert.deepEqual(nav.calls, [], JSON.stringify(event));
  }
  assert.equal(click(), 1);
  assert.deepEqual(nav.calls, [{ view: "statistics" }]);
});

test("one placeholder popover opens at a time from the frame's triggers", () => {
  const h = shell({ mode: "expanded" });
  const anchor = (name) => ({ name });
  let tree = h.tree;
  const topbar = () => byType(tree, "Topbar");
  const pop = () => byType(tree, "Popover");
  assert.equal(pop(), undefined);
  // Every trigger has its final popup attributes from the start (E15).
  for (const name of ["onSync", "onJobs", "onSearch"])
    assert.equal(typeof topbar().props[name], "function", name);
  const card = byType(tree, "Sidebar").props.footer;
  assert.equal(card.type, "SyncStatus");
  assert.equal(card.props.variant, "card");
  assert.equal(typeof card.props.onOpen, "function");
  assert.equal(card.props.expanded, false);

  const bell = anchor("bell");
  topbar().props.onJobs(bell);
  tree = h.render();
  assert.equal(topbar().props.open, "jobs");
  assert.equal(pop().props.anchor, bell);
  assert.equal(pop().props.role, "dialog");
  assert.equal(pop().props.label, "Jobs");
  assert.equal(pop().props.placement, "bottom-end");
  // Another trigger replaces it; its own second click closes it.
  const search = anchor("search");
  topbar().props.onSearch(search);
  tree = h.render();
  assert.equal(topbar().props.open, "search");
  assert.equal(pop().props.anchor, search);
  assert.equal(pop().props.label, "Quick search");
  topbar().props.onSearch(search);
  tree = h.render();
  assert.equal(topbar().props.open, null);
  assert.equal(pop(), undefined);
  // The sync card opens beside itself.
  const cardAnchor = anchor("card");
  byType(tree, "Sidebar").props.footer.props.onOpen(cardAnchor);
  tree = h.render();
  assert.equal(pop().props.placement, "right-end");
  assert.equal(pop().props.label, "Synchronization");
  assert.equal(byType(tree, "Sidebar").props.footer.props.expanded, true);
  // A late close of a replaced popover leaves the shown one alone.
  const stale = pop().props.close;
  topbar().props.onJobs(bell);
  tree = h.render();
  stale(false);
  tree = h.render();
  assert.equal(topbar().props.open, "jobs");
  pop().props.close(true);
  tree = h.render();
  assert.equal(pop(), undefined);
});

test("the open drawer makes the frame and the tab bar inert", () => {
  for (const drawerOpen of [false, true]) {
    const { tree, sidebar } = shell({ mode: "drawer", drawerOpen });
    assert.equal(byClass(tree, "v2-frame").props.inert, drawerOpen);
    const tabBar = byType(tree, "TabBar");
    assert.equal(tabBar.props.inert, drawerOpen);
    assert.equal(tabBar.props.moreOpen, drawerOpen);
    assert.equal(tabBar.props.openMore, sidebar.openDrawer);
    const bar = byType(tree, "Sidebar");
    assert.equal(bar.props.drawerOpen, drawerOpen);
    assert.equal(bar.props.closeDrawer, sidebar.closeDrawer);
    // The drawer's head has the sync row, its end theme and sign out.
    assert.equal(bar.props.drawerHead.props.variant, "row");
    const extras = nodes(bar.props.drawerExtras).filter(
      (n) => n.type === "button",
    );
    assert.deepEqual(
      extras.map((button) => [classes(button)[0], text(button)]),
      [
        ["v2-nav-item", "Light theme"],
        ["v2-nav-item", "Sign out"],
      ],
    );
  }
});

test("the theme button stores the theme and keeps the band", async () => {
  const h = shell();
  let topbar = byType(h.tree, "Topbar");
  assert.equal(topbar.props.theme, "dark");
  topbar.props.toggleTheme();
  const tree = h.render();
  topbar = byType(tree, "Topbar");
  assert.equal(topbar.props.theme, "light");
  assert.deepEqual(h.root.attributes, {
    "data-theme": "light",
    "data-band": "strong",
  });
  assert.deepEqual(h.stored, [["scopearr-theme", "light"]]);
  // Sign out logs out, then refreshes the status.
  await topbar.props.signOut();
  assert.deepEqual(h.requests, ["POST logout", "refresh"]);
});

test("a page change scrolls to the top and fades the content in", () => {
  for (const reduce of [false, true]) {
    const nav = navigation("#/movies");
    const h = shell({ hash: "#/movies", nav, reduce });
    const animations = [];
    const view = byClass(h.tree, "v2-view");
    view.ref.current = {
      animate: (frames, options) => animations.push([frames, options]),
    };
    // Filters, page and instance keep the page: no scroll.
    nav.value.route = router.parseRoute("#/movies?q=Dune&page=2");
    h.render();
    nav.value.route = router.parseRoute("#/movies?instance=radarr");
    h.render();
    assert.deepEqual(h.scrolls, [], "reduce " + reduce);
    // Another page scrolls to 0 and fades in (not with reduced motion).
    nav.value.route = router.parseRoute("#/series");
    h.render();
    assert.deepEqual(h.scrolls, [[0, 0]]);
    assert.equal(animations.length, reduce ? 0 : 1);
    if (!reduce) {
      const [frames, options] = animations[0];
      assert.deepEqual(plain(frames), [
        { opacity: 0, transform: "translateY(4px)" },
        { opacity: 1, transform: "none" },
      ]);
      assert.equal(options.duration, 150);
      assert.equal(options.easing, "cubic-bezier(0.2, 0.7, 0.2, 1)");
    }
    // Settings areas are pages of their own; a tab is not.
    nav.value.route = router.parseRoute("#/settings/system");
    h.render();
    nav.value.route = router.parseRoute("#/settings/system/log");
    h.render();
    assert.equal(h.scrolls.length, 2);
  }
});
