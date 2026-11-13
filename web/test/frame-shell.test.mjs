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
  shown = status,
} = {}) {
  const runtime = createHookRuntime();
  const pageHeader = pageHeaderModule(runtime);
  const sidebarCalls = [],
    scrolls = [],
    animations = [],
    stored = [],
    requests = [],
    logs = [],
    palettes = [];
  // The shell's hooks, with the kind of the effect that runs right now, so
  // a palette records whether a layout effect (before paint) applied it.
  let running = "";
  const hooks = new Proxy(runtime.hooks, {
    get(target, name) {
      if (name !== "useEffect" && name !== "useLayoutEffect")
        return target[name];
      return (run, deps) =>
        target[name](() => {
          running = name;
          try {
            return run();
          } finally {
            running = "";
          }
        }, deps);
    },
  });
  // The manual sync the shell hands the sync popover.
  const manual = {
    syncing: { radarr: true },
    sync: async (service) => requests.push("sync " + service),
    refresh: null,
  };
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
  // The window's listeners by type (the quick search shortcut).
  const listeners = new Map();
  const window = {
    scrollTo: (x, y) => scrolls.push([x, y]),
    matchMedia: (query) => ({
      matches: query.includes("reduce") ? reduce : false,
    }),
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener(type, listener) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((other) => other !== listener),
      );
    },
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
  // Elements as the shortcut reads them: outside any popover unless given.
  const element = (name, popover = false) => ({
    name,
    closest: (selector) => (popover && selector === ".v2-pop" ? {} : null),
  });
  const body = element("body");
  // querySelector answers the selectors set here, else null.
  const found = new Map();
  const document = {
    documentElement: root,
    body,
    activeElement: body,
    querySelector: (selector) => found.get(selector) ?? null,
  };
  // The dialog stack's topmost open dialog (a modal), none by default.
  const dialogs = { topmost: null };
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
    status: shown,
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
      "preact/hooks": hooks,
      "preact/compat": {
        lazy: () => "LazyPage",
        Suspense: "Suspense",
      },
      "../api": {
        api: async (path, method = "GET") => requests.push(method + " " + path),
      },
      "../appearance": appearance,
      "../event-log": { openLog: (filter) => logs.push(plain(filter)) },
      "../frame-status": frameStatus,
      "../i18n": { t, getLocale: () => "en" },
      "../nav-model": navModel,
      "../nav-link": navLink,
      "../themes": {
        applyInterfaceTheme: (element, value, mode) =>
          palettes.push([running, element === root, value, mode]),
      },
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
      "./frame/SyncPopover": { SyncPopover: "SyncPopover" },
      "./frame/JobsMenu": { JobsMenu: "JobsMenu" },
      "./frame/QuickSearch": { QuickSearch: "QuickSearch" },
      "../dialog-stack": { topmostDialog: () => dialogs.topmost },
      "../hooks/useManualSync": {
        useManualSync: (refresh) => {
          manual.refresh = refresh;
          return manual;
        },
      },
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
    logs,
    palettes,
    root,
    manual,
    document,
    element,
    found,
    dialogs,
    // The window's keydown listeners.
    keydown: () => listeners.get("keydown") ?? [],
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
  assert.equal(main.props["data-sheet"], undefined);
  assert.equal(main.props.tabIndex, -1);
  // The sheet is for pages still in 1.7.0 (sheetPage): the libraries,
  // the dashboard, Muxing, Disk placement and Files & permissions (Phase
  // 5b), rebuilt, stand without it, as does every settings area since
  // Phase 5c (System last, task 9).
  for (const [hash, sheet] of [
    ["#/dashboard", undefined],
    ["#/movies", undefined],
    ["#/series?instance=sonarr", undefined],
    ["#/tools/mux", undefined],
    ["#/tools/placement", undefined],
    ["#/tools/files", undefined],
    ["#/settings/appearance", undefined],
    ["#/settings/widgets", undefined],
    ["#/settings/custom", undefined],
    ["#/settings/system", undefined],
  ]) {
    const page = byClass(shell({ hash }).tree, "v2-main");
    assert.equal(page.props["data-sheet"], sheet, hash);
  }
  const [slot, view] = main.props.children.filter(Boolean);
  assert.ok(hasClass(slot, "v2-page-slot"));
  assert.ok(hasClass(view, "v2-view"));
  // The dashboard gets the frame's guarded links and the library's
  // dashboard filter, with the current service for the scope "all".
  assert.equal(byType(view, "StatisticsPage").type, "StatisticsPage");
  const dashboard = navigation("#/dashboard", { service: "sonarr" });
  const statistics = byType(shell({ nav: dashboard }).tree, "StatisticsPage");
  assert.equal(statistics.props.service, "sonarr");
  assert.equal(statistics.props.status, status);
  assert.equal(statistics.props.hrefOf, dashboard.value.linkHref);
  assert.equal(statistics.props.open, dashboard.value.openLink);
  assert.equal(typeof statistics.props.onFilter, "function");

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
  // Every area has its band's header (Phase 5c, task 9: System too).
  assert.match(
    page,
    /<SettingsHeader section=\{section as SettingsSectionId\}/,
  );
  // No sticky 1.7.0 section heading and no scroll effect that marks it.
  assert.doesNotMatch(
    page,
    /settings-section-heading|getBoundingClientRect|<PageHeader/,
  );
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

test("one popover opens at a time from the frame's triggers", () => {
  const h = shell({ mode: "expanded" });
  const anchor = (name) => ({ name });
  let tree = h.tree;
  const topbar = () => byType(tree, "Topbar");
  const pop = () => byType(tree, "Popover");
  const jobsMenu = () => byType(tree, "JobsMenu");
  assert.equal(pop(), undefined);
  assert.equal(jobsMenu(), undefined);
  // Every trigger has its final popup attributes from the start (E15).
  for (const name of ["onSync", "onJobs", "onSearch"])
    assert.equal(typeof topbar().props[name], "function", name);
  const card = byType(tree, "Sidebar").props.footer;
  assert.equal(card.type, "SyncStatus");
  assert.equal(card.props.variant, "card");
  assert.equal(typeof card.props.onOpen, "function");
  assert.equal(card.props.expanded, false);

  // The bell opens the jobs menu (Task 12) at itself, no placeholder.
  const bell = anchor("bell");
  topbar().props.onJobs(bell);
  tree = h.render();
  assert.equal(topbar().props.open, "jobs");
  assert.equal(pop(), undefined, "no placeholder for the bell");
  assert.equal(jobsMenu().props.anchor, bell);
  // Another trigger replaces it; its own second click closes it. Quick
  // search opens its dialog (Task 13), no placeholder.
  const quick = () => byType(tree, "QuickSearch");
  const search = anchor("search");
  topbar().props.onSearch(search);
  tree = h.render();
  assert.equal(topbar().props.open, "search");
  assert.equal(jobsMenu(), undefined);
  assert.equal(pop(), undefined, "no placeholder for quick search");
  assert.equal(quick().props.anchor, search);
  topbar().props.onSearch(search);
  tree = h.render();
  assert.equal(topbar().props.open, null);
  assert.equal(quick(), undefined);
  // The sync card opens the sync popover (Task 11) beside itself.
  const cardAnchor = anchor("card");
  byType(tree, "Sidebar").props.footer.props.onOpen(cardAnchor);
  tree = h.render();
  const syncPop = () => byType(tree, "SyncPopover");
  assert.equal(pop(), undefined, "no placeholder for the sync display");
  assert.equal(syncPop().props.placement, "right-end");
  assert.equal(syncPop().props.anchor, cardAnchor);
  assert.equal(byType(tree, "Sidebar").props.footer.props.expanded, true);
  // A late close of a replaced popover leaves the shown one alone.
  const stale = syncPop().props.close;
  topbar().props.onJobs(bell);
  tree = h.render();
  stale(false);
  tree = h.render();
  assert.equal(topbar().props.open, "jobs");
  jobsMenu().props.close(true);
  tree = h.render();
  assert.equal(jobsMenu(), undefined);
  assert.equal(pop(), undefined);
});

// Task 11: the chip (rail) and the drawer row open the sync popover below
// themselves with the frame's summary, the status and the manual sync of
// System → Info; a closing drawer takes the row's popover along.
test("the sync display opens the sync popover with the manual sync", () => {
  const h = shell({ mode: "rail" });
  let tree = h.tree;
  const topbar = () => byType(tree, "Topbar");
  const syncPop = () => byType(tree, "SyncPopover");
  assert.equal(syncPop(), undefined);
  assert.equal(h.manual.refresh, h.props.refresh, "the shell's refresh");
  const chip = { name: "chip" };
  topbar().props.onSync(chip);
  tree = h.render();
  assert.equal(topbar().props.open, "sync");
  const props = syncPop().props;
  assert.equal(props.anchor, chip);
  assert.equal(props.placement, "bottom-end");
  assert.equal(props.summary, topbar().props.sync, "the frame's summary");
  assert.equal(props.status, status);
  assert.equal(props.demo, true);
  assert.equal(props.sync, h.manual.sync);
  assert.equal(props.syncing, h.manual.syncing);
  // Its close closes it; a second click on the chip too.
  props.close(true);
  tree = h.render();
  assert.equal(syncPop(), undefined);
  assert.equal(topbar().props.open, null);
  topbar().props.onSync(chip);
  tree = h.render();
  topbar().props.onSync(chip);
  tree = h.render();
  assert.equal(syncPop(), undefined);

  // The drawer row opens it below itself; closing the drawer (a page
  // change or Escape with focus elsewhere in it) closes it too.
  const phone = shell({ mode: "drawer", drawerOpen: true });
  tree = phone.tree;
  const row = { name: "row" };
  byType(tree, "Sidebar").props.drawerHead.props.onOpen(row);
  tree = phone.render();
  assert.equal(syncPop().props.anchor, row);
  assert.equal(syncPop().props.placement, "bottom-end");
  assert.equal(byType(tree, "Sidebar").props.drawerHead.props.expanded, true);
  phone.sidebar.drawerOpen = false;
  tree = phone.render();
  assert.equal(syncPop(), undefined, "closed with the drawer");
  assert.equal(byType(tree, "Sidebar").props.drawerHead.props.expanded, false);
});

// Task 12: the bell opens the jobs menu with the frame's one summary; a
// tool row opens its page through the guarded link, "Show in log" the
// error log of the failed tools' sources, and both close the menu.
test("the bell opens the jobs menu with its links and the log", () => {
  const h = shell({ mode: "rail" });
  let tree = h.tree;
  const topbar = () => byType(tree, "Topbar");
  const jobsMenu = () => byType(tree, "JobsMenu");
  const bell = { name: "bell" };
  const open = () => {
    topbar().props.onJobs(bell);
    tree = h.render();
    return jobsMenu().props;
  };
  let props = open();
  assert.equal(props.anchor, bell);
  assert.equal(props.summary, topbar().props.jobs, "the topbar's summary");
  assert.deepEqual(
    plain(props.summary),
    plain(frameStatus.jobsSummary(status)),
  );
  assert.equal(props.hrefOf, h.nav.value.linkHref);
  // A tool row: the menu closes, the link asks like every frame link.
  props.open({ view: "mux" });
  tree = h.render();
  assert.equal(jobsMenu(), undefined);
  assert.equal(topbar().props.open, null);
  assert.deepEqual(h.nav.calls, [{ view: "mux" }]);
  // Show in log: the menu closes and the log opens filtered to the errors
  // of the given sources.
  props = open();
  props.showLog(["mux", "filecheck"]);
  tree = h.render();
  assert.equal(jobsMenu(), undefined);
  assert.deepEqual(h.logs, [
    { level: ["error"], source: ["mux", "filecheck"] },
  ]);
  // Its close closes it, a second click on the bell too.
  open().close(true);
  tree = h.render();
  assert.equal(jobsMenu(), undefined);
  open();
  topbar().props.onJobs(bell);
  tree = h.render();
  assert.equal(jobsMenu(), undefined);
});

// Task 13 (E18): ⌘K and Ctrl+K open quick search from anywhere, also from
// a field, unless a modal is open (a dialog or the drawer); its pages come
// from the nav model; a page or title opens through the guarded link and
// closes it; focus returns to where it was (the anchor).
test("quick search opens with its button, Ctrl+K and Meta+K", () => {
  const h = shell({ mode: "rail", hash: "#/movies" });
  let tree = h.tree;
  const topbar = () => byType(tree, "Topbar");
  const quick = () => byType(tree, "QuickSearch");
  const jobsMenu = () => byType(tree, "JobsMenu");
  // A keydown on the window; true when the shell took it.
  const press = (extra = {}) => {
    let taken = false;
    const event = {
      key: "k",
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: false,
      preventDefault: () => (taken = true),
      ...extra,
    };
    for (const listener of h.keydown()) listener(event);
    tree = h.render();
    return taken;
  };
  const closeSearch = () => {
    quick().props.close();
    tree = h.render();
    assert.equal(quick(), undefined);
  };
  assert.equal(h.keydown().length, 1, "one shortcut listener");
  assert.equal(quick(), undefined);

  // From the filter field: Ctrl+K opens it at the focused element.
  const field = h.element("filter field");
  h.document.activeElement = field;
  assert.equal(press({ ctrlKey: true }), true);
  let props = quick().props;
  assert.equal(props.anchor, field);
  assert.equal(topbar().props.open, "search", "the trigger is expanded");
  // Pages from the nav model of the shown route, the frame's links.
  assert.deepEqual(
    plain(props.pages),
    plain(
      navModel.searchPages(
        navModel.navModel(navInput(router.parseRoute("#/movies"))),
      ),
    ),
  );
  assert.equal(props.hrefOf, h.nav.value.linkHref);
  closeSearch();
  // ⌘K, and the capital K of Caps Lock; with nothing focused, at body.
  h.document.activeElement = h.document.body;
  assert.equal(press({ metaKey: true }), true);
  assert.equal(quick().props.anchor, h.document.body);
  closeSearch();
  assert.equal(press({ key: "K", ctrlKey: true }), true);
  closeSearch();
  // Not without Ctrl or ⌘, not with Shift or Alt (the browser's: Firefox
  // opens its console with Ctrl+Shift+K), not for another key, not when
  // the page took the key already.
  for (const extra of [
    {},
    { shiftKey: true },
    { ctrlKey: true, shiftKey: true },
    { metaKey: true, altKey: true },
    { ctrlKey: true, key: "j" },
    { ctrlKey: true, defaultPrevented: true },
  ]) {
    assert.equal(press(extra), false, JSON.stringify(extra));
    assert.equal(quick(), undefined, JSON.stringify(extra));
  }
  // Not while a modal dialog is open (quick search itself is one).
  h.dialogs.topmost = { name: "a dialog" };
  assert.equal(press({ ctrlKey: true }), false);
  assert.equal(quick(), undefined);
  h.dialogs.topmost = null;

  // It replaces an open popover, as every trigger does.
  topbar().props.onJobs({ name: "bell" });
  tree = h.render();
  assert.ok(jobsMenu());
  assert.equal(press({ ctrlKey: true }), true);
  assert.equal(jobsMenu(), undefined);
  // A page or title: it closes and the target opens through the link.
  props = quick().props;
  props.open({ view: "library", service: "radarr", query: "q=Arrival" });
  tree = h.render();
  assert.equal(quick(), undefined);
  assert.equal(topbar().props.open, null);
  assert.deepEqual(h.nav.calls, [
    { view: "library", service: "radarr", query: "q=Arrival" },
  ]);
  // A late close of a closed quick search changes nothing.
  topbar().props.onJobs({ name: "bell" });
  tree = h.render();
  props.close();
  tree = h.render();
  assert.ok(jobsMenu());

  // Unmounted, the shortcut goes with the shell.
  h.runtime.unmount();
  assert.equal(h.keydown().length, 0);

  // Not with the drawer open (a modal), and not before the frame shows.
  const drawer = shell({ mode: "drawer", drawerOpen: true });
  for (const listener of drawer.keydown())
    listener({
      key: "k",
      ctrlKey: true,
      preventDefault: () => assert.fail("taken with the drawer open"),
    });
  assert.equal(byType(drawer.render(), "QuickSearch"), undefined);
  assert.equal(shell({ ready: false }).keydown().length, 0);
});

// Fix round 1: ⌘K with focus in an open popover replaces the popover, so
// focus returns to the popover's trigger, not to an element that is gone:
// the trigger of the shell's overlay (bell, sync display) or the tab bar's
// expanded Tools button (its menu is the tab bar's own popover).
test("quick search from an open popover returns focus to its trigger", () => {
  const h = shell({ mode: "rail" });
  let tree = h.tree;
  const topbar = () => byType(tree, "Topbar");
  const quick = () => byType(tree, "QuickSearch");
  const press = () => {
    let taken = false;
    for (const listener of h.keydown())
      listener({
        key: "k",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        defaultPrevented: false,
        preventDefault: () => (taken = true),
      });
    tree = h.render();
    return taken;
  };
  const closeSearch = () => {
    quick().props.close();
    tree = h.render();
  };
  const inside = h.element("a row of the popover", true);
  // The bell's jobs menu and the chip's sync popover: their triggers.
  for (const [open, trigger] of [
    ["onJobs", { name: "bell" }],
    ["onSync", { name: "sync chip" }],
  ]) {
    topbar().props[open](trigger);
    tree = h.render();
    h.document.activeElement = inside;
    assert.equal(press(), true, open);
    assert.equal(quick().props.anchor, trigger, open);
    closeSearch();
  }
  // The tab bar's Tools menu: its expanded trigger.
  const tools = h.element("Tools tab");
  h.found.set('.v2-tabbar [aria-expanded="true"]', tools);
  h.document.activeElement = inside;
  assert.equal(press(), true);
  assert.equal(quick().props.anchor, tools);
  closeSearch();
  // Without a trigger to find, body; outside a popover, the focused element.
  h.found.clear();
  assert.equal(press(), true);
  assert.equal(quick().props.anchor, h.document.body);
  closeSearch();
  const field = h.element("filter field");
  h.document.activeElement = field;
  topbar().props.onJobs({ name: "bell" });
  tree = h.render();
  assert.equal(press(), true);
  assert.equal(quick().props.anchor, field);
});

// Final review M1: ⌘K with focus in the rail's flyout, which closes when
// focus leaves it, returns focus to the flyout's entry (the rail entry
// whose flyout is expanded), else to body.
test("quick search from the rail flyout returns focus to its entry", () => {
  const h = shell({ mode: "rail" });
  let tree = h.tree;
  const press = () => {
    for (const listener of h.keydown())
      listener({
        key: "k",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
        defaultPrevented: false,
        preventDefault() {},
      });
    tree = h.render();
    return byType(tree, "QuickSearch");
  };
  h.document.activeElement = {
    name: "a flyout entry",
    closest: (selector) => (selector === ".v2-fly" ? {} : null),
  };
  const entry = h.element("Settings in the rail");
  h.found.set('[aria-controls="v2-fly"][aria-expanded="true"]', entry);
  assert.equal(press().props.anchor, entry);
  byType(tree, "QuickSearch").props.close();
  tree = h.render();
  h.found.clear();
  assert.equal(press().props.anchor, h.document.body);
});

// E17: changes of the bell's count are announced by a polite live region
// outside the frame (inert while the drawer is open), with the bell's name.
// The demo starts no job, so its count never changes and it has none.
test("a live region announces the bell's count outside the demo", () => {
  const regions = (tree) =>
    nodes(tree).filter((n) => n.props?.["aria-live"] !== undefined);
  assert.deepEqual(regions(shell().tree), [], "none in the demo");
  const live = { ...status, demo: false };
  for (const drawerOpen of [false, true]) {
    const { tree } = shell({ mode: "drawer", drawerOpen, shown: live });
    const found = regions(tree);
    assert.equal(found.length, 1);
    const [region] = found;
    assert.equal(region.props["aria-live"], "polite");
    assert.ok(hasClass(region, "v2-sr-only"));
    assert.equal(text(region), "Tools, 3 open jobs");
    // A child of the shell, beside the frame and the tab bar.
    const root = byClass(tree, "v2-shell");
    assert.ok(
      root.props.children.flat(Infinity).includes(region),
      "outside the frame",
    );
    assert.equal(regions(byClass(tree, "v2-frame")).length, 0);
  }
  const busier = {
    ...live,
    mux: { ...live.mux, failed: 2 },
    files: { ...live.files, pending: 1 },
  };
  assert.equal(
    text(regions(shell({ shown: busier }).tree)[0]),
    "Tools, 6 open jobs",
  );
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
  // Final review I2: the palette applies in a layout effect, so the frame's
  // first paint and the first paint after a theme change show it.
  assert.deepEqual(h.palettes, [
    ["useLayoutEffect", true, settings.interfaceTheme, "dark"],
  ]);
  topbar.props.toggleTheme();
  const tree = h.render();
  topbar = byType(tree, "Topbar");
  assert.equal(topbar.props.theme, "light");
  assert.deepEqual(h.palettes.slice(1), [
    ["useLayoutEffect", true, settings.interfaceTheme, "light"],
  ]);
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
