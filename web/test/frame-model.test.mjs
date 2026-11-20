import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./helpers/component-harness.mjs";

// The frame's navigation as pure functions of route, settings and status
// (nav-model.ts). Labels pass through translate; the tests use the identity.
function frameModules(tools) {
  const storage = loadSource("browser-storage.ts");
  const toolRoute = loadSource("tool-route.ts", {
    modules: { "./browser-storage": storage },
  });
  const route = tools
    ? { ...toolRoute, TOOLS: tools(toolRoute.TOOLS) }
    : toolRoute;
  const instances = loadSource("instances.ts");
  const frameStatus = loadSource("frame-status.ts", {
    modules: {
      "./instances": instances,
      "./tool-route": route,
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
      "./tool-route": route,
    },
  });
  const navModel = loadSource("nav-model.ts", {
    modules: {
      "./instances": instances,
      "./frame-status": frameStatus,
      "./router": router,
      "./tool-route": route,
    },
  });
  return { router, navModel, frameStatus };
}
const { router, navModel: nav } = frameModules();
const { parseRoute } = router;

// Values cross a VM realm; compare their JSON shape.
const plain = (value) => JSON.parse(JSON.stringify(value));
const identity = (key) => key;
const instance = (id, type, name = "", enabled = true) => ({
  id,
  type,
  name,
  enabled,
  url: "http://" + id,
  hasKey: true,
  interval: 60,
});
const settings = {
  instances: [
    instance("radarr", "radarr"),
    instance("radarr-4k", "radarr", "Radarr 4K"),
    instance("radarr-old", "radarr", "Old", false),
    instance("sonarr", "sonarr"),
    instance("emby", "emby"),
  ],
};
const status = {
  demo: false,
  mux: { enabled: true, installed: true, pending: 1, running: 1, failed: 0 },
  unraid: { enabled: false, pending: 4 },
  files: { available: true, pending: 0, running: 0, failed: 1 },
  sync: {
    radarr: { count: 10 },
    "radarr-4k": { count: 5 },
    "radarr-old": { count: 7 },
    sonarr: { count: 20 },
  },
};
const input = (hash, extra = {}) => ({
  route: parseRoute(hash),
  settings,
  status,
  translate: identity,
  ...extra,
});
const sections = (hash, extra) => plain(nav.navModel(input(hash, extra)));
const node = (model, key) =>
  model.flatMap((section) => section.nodes).find((n) => n.key === key);
const currentKeys = (model) =>
  model
    .flatMap((section) => section.nodes)
    .flatMap((n) => [n, ...n.children])
    .filter((entry) => entry.current)
    .map((entry) => entry.key);

test("the nav model follows the route", () => {
  const dashboard = sections("#/dashboard");
  assert.deepEqual(
    dashboard.map((section) => [section.key, section.label]),
    [
      ["library", "Library"],
      ["tools", "Tools"],
      ["system", "System"],
    ],
  );
  assert.deepEqual(dashboard[0].nodes[0], {
    key: "dashboard",
    label: "Dashboard",
    icon: "dashboard",
    target: { view: "statistics" },
    current: true,
    children: [],
    parentOfCurrent: false,
  });
  assert.deepEqual(currentKeys(dashboard), ["dashboard"]);

  // Movies with two enabled instances: the parent opens every instance and
  // counts the enabled ones; each child is one instance. The disabled one is
  // neither a child nor counted outside the demo.
  assert.deepEqual(node(dashboard, "movies"), {
    key: "movies",
    label: "Movies",
    icon: "movies",
    target: { view: "library", service: "radarr", instance: "" },
    current: false,
    count: 15,
    group: "movies",
    children: [
      {
        key: "movies:radarr",
        label: "Radarr",
        target: { view: "library", service: "radarr", instance: "radarr" },
        current: false,
        count: 10,
      },
      {
        key: "movies:radarr-4k",
        label: "Radarr 4K",
        target: { view: "library", service: "radarr", instance: "radarr-4k" },
        current: false,
        count: 5,
      },
    ],
    parentOfCurrent: false,
  });
  // One instance: no children and no group arrow.
  assert.deepEqual(node(dashboard, "series"), {
    key: "series",
    label: "TV series",
    icon: "series",
    target: { view: "library", service: "sonarr", instance: "" },
    current: false,
    count: 20,
    children: [],
    parentOfCurrent: false,
  });

  // Hidden tools are missing; the visible ones keep the order mux, disks,
  // files and carry their open jobs as a badge.
  assert.deepEqual(dashboard[1].nodes, [
    {
      key: "mux",
      label: "Muxing",
      icon: "mux",
      target: { view: "mux" },
      current: false,
      badge: 2,
      children: [],
      parentOfCurrent: false,
    },
    {
      key: "files",
      label: "Files & permissions",
      icon: "files",
      target: { view: "files" },
      current: false,
      badge: 1,
      children: [],
      parentOfCurrent: false,
    },
  ]);

  // Settings: six areas in route order, with the labels of the settings
  // page; the parent is a group, never the current entry itself.
  const { children: areas, ...settingsNode } = node(dashboard, "settings");
  assert.deepEqual(settingsNode, {
    key: "settings",
    label: "Settings",
    icon: "settings",
    target: { view: "settings", section: "connections" },
    current: false,
    group: "settings",
    parentOfCurrent: false,
  });
  assert.deepEqual(
    areas.map((child) => [child.key, child.label, child.target]),
    [
      ["connections", "Services"],
      ["appearance", "Display"],
      ["widgets", "Widgets"],
      ["custom", "Custom tags"],
      ["recognition", "Tag rules"],
      ["system", "System"],
    ].map(([section, label]) => [
      "settings:" + section,
      label,
      { view: "settings", section },
    ]),
  );

  // A child instance is current: its parent is the parent of the current
  // entry. Filters, sort and page do not matter.
  const fourK = sections("#/movies?instance=radarr-4k&resolution=2160p&page=3");
  assert.deepEqual(currentKeys(fourK), ["movies:radarr-4k"]);
  assert.equal(node(fourK, "movies").current, false);
  assert.equal(node(fourK, "movies").parentOfCurrent, true);
  assert.equal(node(fourK, "dashboard").current, false);
  // Without an instance filter the parent is current.
  const allMovies = sections("#/movies?resolution=2160p&sort=size&dir=desc");
  assert.deepEqual(currentKeys(allMovies), ["movies"]);
  assert.equal(node(allMovies, "movies").parentOfCurrent, false);
  // An instance the sidebar does not list marks only the parent group.
  const old = sections("#/movies?instance=radarr-old");
  assert.deepEqual(currentKeys(old), []);
  assert.equal(node(old, "movies").parentOfCurrent, true);
  // With one instance the parent is the whole library, filtered or not.
  for (const hash of ["#/series", "#/series?instance=sonarr"])
    assert.deepEqual(currentKeys(sections(hash)), ["series"], hash);

  // A tool and a settings area.
  assert.deepEqual(currentKeys(sections("#/tools/mux?q=x&status=failed")), [
    "mux",
  ]);
  const display = sections("#/settings/appearance/colors");
  assert.deepEqual(currentKeys(display), ["settings:appearance"]);
  assert.equal(node(display, "settings").parentOfCurrent, true);
  assert.deepEqual(currentKeys(sections("#/settings/system/log?level=error")), [
    "settings:system",
  ]);

  // The model names targets only; hrefs come from linkHref.
  assert.doesNotMatch(JSON.stringify(dashboard), /"href"/);

  // The demo counts every instance, as the library does.
  const demo = sections("#/dashboard", { status: { ...status, demo: true } });
  assert.equal(node(demo, "movies").count, 22);
  // Without settings or visible tools: no instances, no tools section.
  const bare = sections("#/dashboard", {
    settings: null,
    status: { demo: false },
  });
  assert.deepEqual(
    bare.map((section) => section.key),
    ["library", "system"],
  );
  assert.deepEqual(node(bare, "movies").children, []);
  assert.equal(node(bare, "movies").count, 0);
  assert.equal(node(bare, "movies").group, undefined);
  assert.equal(node(bare, "settings").children.length, 6);
});

test("every nav label passes through translate", () => {
  const translate = (key) => "de:" + key;
  const model = sections("#/dashboard", { translate });
  const labels = model.flatMap((section) => [
    section.label,
    ...section.nodes.flatMap((n) => [
      n.label,
      ...n.children.map((c) => c.label),
    ]),
  ]);
  // Instance names are the user's own and stay as they are.
  assert.deepEqual(
    labels.filter((label) => !label.startsWith("de:")),
    ["Radarr", "Radarr 4K"],
  );
});

test("breadcrumbs start with Scopearr and name the section", () => {
  const crumbs = (hash, extra) => plain(nav.breadcrumbs(input(hash, extra)));
  assert.deepEqual(crumbs("#/dashboard"), ["Scopearr", "Library", "Dashboard"]);
  assert.deepEqual(crumbs("#/movies"), ["Scopearr", "Library", "Movies"]);
  assert.deepEqual(crumbs("#/movies?instance=radarr-4k&page=2"), [
    "Scopearr",
    "Library",
    "Movies",
    "Radarr 4K",
  ]);
  assert.deepEqual(crumbs("#/series?instance=sonarr"), [
    "Scopearr",
    "Library",
    "TV series",
    "Sonarr",
  ]);
  // An unknown instance is not echoed from the URL.
  assert.deepEqual(crumbs("#/movies?instance=nope"), [
    "Scopearr",
    "Library",
    "Movies",
  ]);
  assert.deepEqual(crumbs("#/tools/mux?q=a"), ["Scopearr", "Tools", "Muxing"]);
  // A hidden tool keeps its name; the crumbs follow the route only.
  assert.deepEqual(crumbs("#/tools/placement"), [
    "Scopearr",
    "Tools",
    "Disk placement",
  ]);
  assert.deepEqual(crumbs("#/tools/files"), [
    "Scopearr",
    "Tools",
    "Files & permissions",
  ]);
  assert.deepEqual(crumbs("#/settings/appearance/colors"), [
    "Scopearr",
    "Settings",
    "Display",
  ]);
  assert.deepEqual(crumbs("#/settings/system/log?level=error"), [
    "Scopearr",
    "Settings",
    "System",
  ]);
  assert.deepEqual(crumbs("#/movies?instance=radarr-4k", { settings: null }), [
    "Scopearr",
    "Library",
    "Movies",
  ]);
  // The brand and instance names stay; everything else is translated.
  assert.deepEqual(
    crumbs("#/movies?instance=radarr-4k", { translate: (k) => "de:" + k }),
    ["Scopearr", "de:Library", "de:Movies", "Radarr 4K"],
  );
});

test("the tab bar marks tools and more", () => {
  const tabs = (hash, extra) => plain(nav.tabBarModel(input(hash, extra)));
  const dashboard = tabs("#/dashboard");
  assert.deepEqual(dashboard.tabs, [
    {
      key: "dashboard",
      label: "Dashboard",
      icon: "dashboard",
      target: { view: "statistics" },
      current: true,
    },
    {
      key: "movies",
      label: "Movies",
      icon: "movies",
      target: { view: "library", service: "radarr", instance: "" },
      current: false,
      count: 15,
    },
    {
      key: "series",
      label: "TV series",
      icon: "series",
      target: { view: "library", service: "sonarr", instance: "" },
      current: false,
      count: 20,
    },
  ]);
  // The tools menu lists every visible tool with its open jobs; the tab's
  // badge is their sum.
  assert.deepEqual(
    dashboard.tools.map((tool) => [
      tool.key,
      tool.label,
      tool.badge,
      tool.current,
    ]),
    [
      ["mux", "Muxing", 2, false],
      ["files", "Files & permissions", 1, false],
    ],
  );
  assert.equal(dashboard.toolsBadge, 3);
  assert.equal(dashboard.toolsCurrent, false);
  assert.equal(dashboard.moreCurrent, false);

  // A movie instance marks the Movies tab.
  const fourK = tabs("#/movies?instance=radarr-4k");
  assert.deepEqual(
    fourK.tabs.map((tab) => tab.current),
    [false, true, false],
  );
  // A tool marks the Tools tab and its menu entry.
  const files = tabs("#/tools/files?status=failed");
  assert.deepEqual(
    files.tabs.map((tab) => tab.current),
    [false, false, false],
  );
  assert.equal(files.toolsCurrent, true);
  assert.deepEqual(
    files.tools.map((tool) => tool.current),
    [false, true],
  );
  assert.equal(files.moreCurrent, false);
  // Settings live behind More.
  const settingsTabs = tabs("#/settings/widgets");
  assert.deepEqual(
    settingsTabs.tabs.map((tab) => tab.current),
    [false, false, false],
  );
  assert.equal(settingsTabs.toolsCurrent, false);
  assert.equal(settingsTabs.moreCurrent, true);
  // No visible tool: an empty menu without a badge.
  const none = tabs("#/dashboard", { status: { demo: false } });
  assert.deepEqual(none.tools, []);
  assert.equal(none.toolsBadge, 0);
});

test("page keys change only with the page", () => {
  const key = (hash) => nav.pageKey(parseRoute(hash));
  assert.equal(key("#/dashboard"), "statistics");
  assert.equal(key("#/movies"), "library:radarr");
  assert.equal(key("#/series"), "library:sonarr");
  assert.equal(key("#/tools/mux"), "mux");
  assert.equal(key("#/tools/placement"), "disks");
  assert.equal(key("#/tools/files"), "files");
  assert.equal(key("#/settings/system"), "settings:system");
  assert.equal(key("#/settings/connections/radarr"), "settings:connections");
  // Filters, instance, page, sort, tab and log query keep the key.
  for (const [a, b] of [
    ["#/movies", "#/movies?instance=radarr-4k&resolution=2160p"],
    ["#/movies", "#/movies?page=4&sort=size&dir=desc"],
    ["#/series?q=lost", "#/series?page=2"],
    ["#/tools/mux", "#/tools/mux?q=a&status=failed&sort=size&dir=asc&page=2"],
    ["#/tools/placement", "#/tools/placement?target=disk1&kind=split"],
    ["#/settings/appearance", "#/settings/appearance/colors"],
    ["#/settings/system/info", "#/settings/system/log?level=error&q=x"],
    ["#/settings/connections", "#/settings/connections/sonarr"],
  ])
    assert.equal(key(a), key(b), a + " / " + b);
  // The view, library service, tool and settings area change it.
  const pages = [
    "#/dashboard",
    "#/movies",
    "#/series",
    "#/tools/mux",
    "#/tools/placement",
    "#/tools/files",
    ...router.SETTINGS_SECTIONS.map((section) => "#/settings/" + section),
  ];
  assert.equal(new Set(pages.map(key)).size, pages.length);
});

test("the frame takes its tools from the one tool table", () => {
  // Reordering TOOLS reorders the tools of the sidebar and the tab bar.
  const { navModel, frameStatus } = frameModules((tools) =>
    Object.freeze({ files: tools.files, disks: tools.disks, mux: tools.mux }),
  );
  const shown = {
    ...status,
    unraid: { enabled: true, pending: 4 },
  };
  const model = plain(
    navModel.navModel({ ...input("#/dashboard"), status: shown }),
  );
  assert.deepEqual(
    model[1].nodes.map((n) => n.key),
    ["files", "disks", "mux"],
  );
  assert.deepEqual(
    plain(
      navModel.tabBarModel({ ...input("#/dashboard"), status: shown }),
    ).tools.map((tool) => tool.key),
    ["files", "disks", "mux"],
  );
  assert.deepEqual(
    plain(frameStatus.jobsSummary(shown)).tools.map((tool) => tool.view),
    ["files", "disks", "mux"],
  );
});
