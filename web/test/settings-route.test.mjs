import test from "node:test";
import assert from "node:assert/strict";
import { find, loadSource, nodes } from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";
import { allSources, between, squash, src } from "./helpers/sources.mjs";

// The sort adapter lives with the real SortHeader; the header itself is a
// stub in these tests.
const { asFilmSort } = loadSource("components/list/SortHeader.tsx", {
  modules: {
    "preact/hooks": {},
    "../../i18n": {},
    "../../ui": {},
    "../frame/Popover": {},
  },
});

// Values cross a VM realm; compare their JSON shape.
const plain = (value) => JSON.parse(JSON.stringify(value));
const t = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");

// Runs a component or hook with the shared hook runtime: state slots, refs,
// and effects after each render when their dependencies change; state set
// while rendering or in effects renders again. Timers are fake.
function mounted(path, exportName, props, modules = {}, browser = {}) {
  const timers = new Map(),
    runtime = createHookRuntime();
  let clock = 0,
    timer = 0;
  const exports = loadSource(path, {
    modules: { "preact/hooks": runtime.hooks, ...modules },
    browser: {
      setTimeout(run, ms) {
        timers.set(++timer, { at: clock + ms, run });
        return timer;
      },
      clearTimeout: (id) => timers.delete(id),
      ...browser,
    },
  });
  const m = {
    props,
    current: undefined,
    render() {
      m.current = runtime.settle(
        () => {
          const props = typeof m.props === "function" ? m.props() : m.props;
          return exports[exportName](...[].concat(props));
        },
        { max: 10 },
      );
      return m.current;
    },
    advance(ms) {
      clock += ms;
      for (const [id, entry] of [...timers])
        if (entry.at <= clock) {
          timers.delete(id);
          entry.run();
        }
      return m.render();
    },
  };
  m.render();
  return m;
}

// The real browser-storage over a fake sessionStorage that logs writes.
function session(seeded = {}) {
  const values = new Map(Object.entries(seeded)),
    writes = [];
  const storage = loadSource("browser-storage.ts", {
    browser: {
      sessionStorage: {
        getItem: (key) => (values.has(key) ? values.get(key) : null),
        setItem(key, value) {
          writes.push([key, String(value)]);
          values.set(key, String(value));
        },
        removeItem: (key) => values.delete(key),
      },
    },
  });
  return { storage, values, writes };
}

// A route tab owner like AppShell: the tab a page sets is the next route tab.
function route(tab = "") {
  const r = {
    tab,
    sets: [],
    setTab(next) {
      r.sets.push(next);
      r.tab = next;
    },
  };
  return r;
}

// A page's tabs: the 1.7.0 SegmentedTabs (id, change) or the v2 Segmented
// (idPrefix, select; Services from Phase 5c), read alike.
const segmented = (tree, id) => {
  const { props } = nodes(tree).find(
    (node) =>
      (node.type === "SegmentedTabs" && node.props.id === id) ||
      (node.type === "Segmented" && node.props.idPrefix === id),
  );
  return { ...props, change: props.change ?? props.select };
};

function systemTab(seeded, routeTab) {
  const store = session(seeded),
    owner = route(routeTab);
  const m = mounted(
    "components/SystemSettings.tsx",
    "useSystemTab",
    () => [owner.tab, owner.setTab],
    {
      "../api": { api: async () => ({}) },
      "../browser-storage": store.storage,
      "../event-log": loadSource("event-log.ts"),
      "../i18n": { t },
      "../notifications": { notify() {} },
      "../ui": { SegmentedTabs: "SegmentedTabs" },
      "./EventLogViewer": { EventLogViewer: "EventLogViewer" },
      "./PasswordCard": { PasswordCard: "PasswordCard" },
      "./SystemInfo": { SystemInfo: "SystemInfo" },
      "../hooks/useManualSync": {
        useManualSync: () => ({ syncing: {}, sync: async () => {} }),
      },
    },
  );
  const show = () => m.render()[0];
  return { store, owner, show, set: (tab) => (m.current[1](tab), show()) };
}

// Display's tab lives in SettingsPage (useDisplayTab, Phase 5c: the
// segment is on the band); AppearanceSettings renders the tab's panel.
function appearance(seeded, routeTab) {
  const store = session(seeded),
    owner = route(routeTab);
  const settings = {
    columnOrder: { radarr: [], sonarr: [] },
    visibleColumns: { radarr: [], sonarr: [] },
  };
  const modules = {
    "../ui": {
      ICON: {},
      columnLabels: {},
      defaultColumnOrder: [],
      defaultColumns: [],
    },
    "../placement": { placementColumns: [], placementColumnLabels: {} },
    "../filecheck": { fileCheckColumns: [], fileCheckColumnLabels: {} },
    "../i18n": { catalogs: [], t, useI18n: () => ({ locale: "en" }) },
    "../browser-storage": store.storage,
    "../confirmation": { confirmReset: async () => true },
    "../settings-model": { columnsDirty: () => ({}) },
    "./list/Segmented": { Segmented: "Segmented" },
    "./settings/ModeBandCard": { ModeBandCard: "ModeBandCard" },
    "./settings/PalettePicker": { PalettePicker: "PalettePicker" },
    "./settings/PalettePreview": { PalettePreview: "PalettePreview" },
    "./settings/ColumnOrderEditor": { ColumnOrderEditor: "ColumnOrderEditor" },
    "./settings/Card": loadSource("components/settings/Card.tsx"),
    "./settings/Field": loadSource("components/settings/Field.tsx"),
    "./settings/Check": loadSource("components/settings/Check.tsx"),
    "./ListLayoutSettings": {
      ListLayoutSettings: "ListLayoutSettings",
      infoLabels: {},
    },
  };
  const m = mounted(
    "components/AppearanceSettings.tsx",
    "useDisplayTab",
    () => [owner.tab, owner.setTab],
    modules,
  );
  // The panel of a tab, on its own hooks.
  const page = (tab) =>
    mounted(
      "components/AppearanceSettings.tsx",
      "AppearanceSettings",
      {
        cfg: settings,
        saved: settings,
        setCfg() {},
        draftLocale: "en",
        setDraftLocale() {},
        draftPrefs: {
          density: "comfortable",
          stacked: { radarr: false, sonarr: false },
          filename: { radarr: true, sonarr: true },
        },
        setDraftPrefs() {},
        hidden: false,
        colors: "colors",
        tab,
        mode: "dark",
        band: null,
        changeLook() {},
      },
      { ...modules, "../browser-storage": session().storage },
    ).current;
  const show = () => {
    const [value] = m.render();
    const panel = nodes(page(value)).find(
      (node) => node.props?.role === "tabpanel",
    );
    assert.equal(panel.props.id, "display-panel-" + value);
    return value;
  };
  return {
    store,
    owner,
    show,
    set: (tab) => (m.current[1](tab), show()),
  };
}

const instance = (id, type) => ({
  id,
  type,
  name: "",
  enabled: true,
  url: "",
  hasKey: false,
  interval: 60,
  tagImport: false,
  tagImportInterval: 5,
  syncStart: "",
  webhookEnabled: false,
  tagSync: {},
});

// api: the tool checks of MKVToolNix and MediaInfo; they never answer
// unless given.
function services(
  seeded,
  routeTab,
  api = () => new Promise(() => {}),
  settings = {
    // MKVToolNix, Radarr, Sonarr and Unraid; MKVToolNix sorts first.
    instances: [instance("radarr", "radarr"), instance("sonarr", "sonarr")],
    mux: { enabled: true },
  },
) {
  const store = session(seeded),
    owner = route(routeTab);
  const m = mounted(
    "components/ConnectionSettings.tsx",
    "ConnectionSettings",
    () => ({
      cfg: settings,
      setCfg() {},
      settings,
      demo: false,
      hidden: false,
      tab: owner.tab,
      setTab: owner.setTab,
    }),
    {
      "../browser-storage": store.storage,
      "../ui": { ICON: {}, labels: {} },
      "./list/Segmented": { Segmented: "Segmented" },
      "../settings-model": {
        toolHead: () => ({ tone: "neutral" }),
        serviceHead: () => ({ tone: "neutral" }),
        serviceKind: () => "arr",
      },
      "../hooks/useManualSync": {
        useManualSync: () => ({ syncing: {}, sync: async () => {} }),
      },
      "./settings/ServiceCard": {
        ServiceCard: "ServiceCard",
        ServiceSection: "ServiceSection",
      },
      "./settings/ServiceStatus": {
        ServiceStatus: "ServiceStatus",
        StatusValue: "StatusValue",
      },
      "./ExternalTagStatus": {
        ExternalTagCheck: "ExternalTagCheck",
        externalTagText: () => "",
      },
      "./settings/LibraryStatus": { libraryStatus: () => ({}) },
      "./settings/Field": loadSource("components/settings/Field.tsx"),
      "./settings/Check": loadSource("components/settings/Check.tsx"),
      "../api": { api },
      "../confirmation": {
        confirmDeletion: async () => true,
        confirmDiscard: async () => true,
      },
      "../i18n": { t, useI18n: () => ({ locale: "en" }) },
      "../notifications": { notify() {} },
      "./WebhookSettings": { WebhookSettings: "WebhookSettings" },
      "../instances": loadSource("instances.ts"),
      "./UnraidSettings": { UnraidSettings: "UnraidSettings" },
      "./MediaInfoSettings": { MediaInfoSettings: "MediaInfoSettings" },
      "./MuxToolSettings": { MuxToolSettings: "MuxToolSettings" },
      "../mux-spec": { defaultMuxSettings: () => ({}) },
      "./dialog/AddServiceDialog": { AddServiceDialog: "AddServiceDialog" },
    },
    { document: { querySelector: () => null } },
  );
  const show = () => segmented(m.render(), "service-settings").value;
  return {
    store,
    owner,
    show,
    set: (tab) => (
      segmented(m.current, "service-settings").change(tab),
      show()
    ),
  };
}

test("settings tabs follow the route and fall back to their session keys", () => {
  // first: the default; stored: in the session key; routed and other: route
  // tabs; chosen: picked on the page.
  for (const [name, open, key, first, stored, routed, other, chosen] of [
    [
      "System",
      systemTab,
      "scopearr-system-tab",
      "info",
      "log",
      "info",
      "log",
      "info",
    ],
    [
      "Display",
      appearance,
      "scopearr-display-tab",
      "general",
      "colors",
      "lists",
      "general",
      "lists",
    ],
    [
      "Services",
      services,
      "scopearr-service-settings",
      "mux",
      "unraid",
      "sonarr",
      "radarr",
      "radarr",
    ],
  ]) {
    // Without a route tab: the stored tab, else the first one.
    assert.equal(open({}, "").show(), first, name);
    assert.equal(open({ [key]: stored }, "").show(), stored, name);
    // A valid route tab wins over the stored one.
    const page = open({ [key]: stored }, routed);
    assert.equal(page.show(), routed, name);
    // The route leads: another route tab shows at once, in the same page;
    // without a route tab the stored one shows again.
    page.owner.tab = other;
    assert.equal(page.show(), other, name);
    page.owner.tab = "";
    assert.equal(page.show(), stored, name);
    // A route tab is never written to the key. ConnectionSettings writes
    // its start tab, as in 1.7.0.
    assert.deepEqual(
      page.store.writes.filter(([written]) => written === key),
      name === "Services" ? [[key, stored]] : [],
      name,
    );
    assert.deepEqual(page.owner.sets, [], name);
    // Choosing writes the session key (same format) and the route tab.
    page.owner.tab = routed;
    page.show();
    assert.equal(page.set(chosen), chosen, name);
    assert.deepEqual(page.owner.sets, [chosen], name);
    assert.equal(page.store.values.get(key), chosen, name);
    assert.deepEqual(page.store.writes.at(-1), [key, chosen], name);
    // Without a route tab, the chosen tab shows.
    page.owner.tab = "";
    assert.equal(page.show(), chosen, name);
    // An invalid route tab falls back to the stored one, then the first.
    for (const invalid of ["nope", "[object MouseEvent]"]) {
      assert.equal(open({ [key]: stored }, invalid).show(), stored, name);
      assert.equal(open({}, invalid).show(), first, name);
    }
  }
});

test("an unknown service tab in the route is replaced by the shown one", async () => {
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const checked = async (path) => ({ installed: path === "mediainfo/tool" });
  // Unknown tab: replaced by the shown tab once the tool checks answered
  // (their tabs appear later); the session key keeps its value.
  const unknown = services(
    { "scopearr-service-settings": "unraid" },
    "nonsense",
    checked,
  );
  assert.equal(unknown.show(), "unraid");
  assert.deepEqual(unknown.owner.sets, [], "the checks have not answered");
  await settle();
  assert.equal(unknown.show(), "unraid");
  assert.deepEqual(unknown.owner.sets, ["unraid"]);
  assert.equal(unknown.owner.tab, "unraid");
  assert.equal(unknown.store.values.get("scopearr-service-settings"), "unraid");
  assert.deepEqual(unknown.store.writes, [
    ["scopearr-service-settings", "unraid"],
  ]);
  unknown.show();
  assert.deepEqual(unknown.owner.sets, ["unraid"], "replaced once");
  // The shown tab is the first one when the stored tab is gone; the key
  // keeps the tab chosen last.
  const gone = services(
    { "scopearr-service-settings": "mediainfo" },
    "nonsense",
    async () => ({ installed: false }),
  );
  await settle();
  assert.equal(gone.show(), "mux");
  assert.deepEqual(gone.owner.sets, ["mux"]);
  assert.equal(gone.store.values.get("scopearr-service-settings"), "mediainfo");
  // MediaInfo is a tab only after its check: its link waits and stays.
  const late = services({}, "mediainfo", checked, {
    instances: [instance("radarr", "radarr")],
    mux: { enabled: true },
    mediaInfo: { enabled: false },
  });
  assert.equal(late.show(), "mux");
  await settle();
  assert.equal(late.show(), "mediainfo");
  assert.deepEqual(late.owner.sets, []);
  // Without the checks no tab is replaced; valid and empty tabs never are.
  const waiting = services({}, "nonsense");
  await settle();
  assert.equal(waiting.show(), "mux");
  assert.deepEqual(waiting.owner.sets, []);
  for (const tab of ["", "sonarr"]) {
    const page = services({}, tab, checked);
    await settle();
    page.show();
    assert.deepEqual(page.owner.sets, [], tab);
  }
});

test("the route hands each settings section its own tab", () => {
  const page = src("components/SettingsPage.tsx");
  // Hidden sections never read another section's tab.
  assert.match(
    page,
    /const sectionTab = \(id: string\) => \(section === id \? tab : ""\);/,
  );
  assert.match(
    page,
    /useSystemTab\(\s*sectionTab\("system"\),\s*setTab,?\s*\)/,
  );
  // Services takes its route tab; Display's tab (on the band) comes from
  // useDisplayTab with its route tab, as System's does.
  assert.match(
    page,
    /hidden=\{section !== "connections"\}\s+tab=\{sectionTab\("connections"\)\}\s+setTab=\{setTab\}\s+\/>/,
    "connections",
  );
  assert.match(
    page,
    /useDisplayTab\(\s*sectionTab\("appearance"\),\s*setTab,?\s*\)[\s\S]*hidden=\{section !== "appearance"\}\s+tab=\{displayTab\}\s+\/>/,
    "appearance",
  );
  // The log starts again from the route on every revision (keyed inside,
  // so it keeps its sort).
  assert.match(
    page,
    /<SystemSettingsLog\s+revision=\{revision\}\s+status=\{status\}\s+demo=\{demo\}\s+query=\{logQuery\}\s+setQuery=\{setLogQuery\}\s+\/>/,
  );
  // AppShell hands the settings page the route's tab and log query; tabs
  // and log filters replace the current entry.
  const shell = src("components/AppShell.tsx");
  for (const prop of [
    /tab=\{route\.view === "settings" \? route\.tab : ""\}/,
    /setTab=\{\(tab\) => replaceRoute\(\{ tab \}\)\}/,
    /logQuery=\{route\.view === "settings" \? route\.query : ""\}/,
    /setLogQuery=\{\(query\) => replaceRoute\(\{ tab: "log", query \}\)\}/,
    /revision=\{revision\}/,
  ])
    assert.match(between(shell, "<SettingsPage", "/>"), prop);
});

const sortable = loadSource("table-sort.ts", {
  modules: { "../ui": { ICON: {} }, "../i18n": { t } },
});
function viewer(query, queries, sorts = [], polled = []) {
  const props = {
    status: {},
    demo: false,
    query,
    setQuery: (next) => {
      queries.push(next);
      props.query = next;
    },
    sort: null,
    setSort: (next) => {
      sorts.push(next);
      props.sort = next;
    },
  };
  return mounted("components/EventLogViewer.tsx", "EventLogViewer", props, {
    "../hooks/usePolling": {
      usePolling: (_load, _interval, [request]) => polled.push(request),
    },
    "../api": { api: () => new Promise(() => {}) },
    "../confirmation": { confirmDeletion: async () => true },
    "../event-log": loadSource("event-log.ts"),
    "../hooks/useDrawerAnchor": { useDrawerAnchor() {} },
    // The drawer's chunk, there at once.
    "../hooks/useLazyChunk": {
      chunkRetry: () => ({ failed: () => null, fresh: () => null }),
      lazyChunk: () => ({}),
      useLazyChunk: (_chunk, open) => (open ? "LogFilterDrawer" : null),
    },
    "../i18n": { t, useI18n() {} },
    "../notifications": { notify() {} },
    "../settings-model": loadSource("settings-model.ts", {
      modules: {
        "./themes": loadSource("themes.ts"),
        "./event-log": loadSource("event-log.ts"),
      },
    }),
    "../ui": { count: String, ICON: {} },
    "./dialog/LogEntryDialog": { LogEntryDialog: "LogEntryDialog" },
    "../table-sort": { nextTableSort: sortable.nextTableSort },
    "./list/ChipsRow": { ChipsRow: "ChipsRow" },
    "./list/FilterBar": { FilterBar: "FilterBar" },
    "./list/ListEmpty": { ListEmpty: "ListEmpty" },
    "./list/PageNav": { PageNav: "PageNav", itemRange: () => "" },
    "./list/SortHeader": { SortHeader: "SortHeader", asFilmSort },
    "./list/TableCard": { TableCard: "TableCard" },
    "./settings/Card": loadSource("components/settings/Card.tsx"),
    "./tools/StatusTag": { StatusTag: "StatusTag" },
  });
}

const slot = (tree, name) => find(tree, "TableCard").props[name].props;
test("the log viewer starts from the route and replaces it on changes", () => {
  const queries = [];
  const m = viewer("q=dune&level=error&source=sync", queries);
  // The card's filter bar, chips row and pager are its props.
  const bar = () => slot(m.current, "bar");
  // The drawer's draft of each list (Phase 5c, task 9: the drawer replaced
  // the three 1.7.0 MultiFilter menus); opening it shows the applied
  // filter.
  const filter = (key) => {
    if (!find(m.current, "LogFilterDrawer")) {
      bar().filters.open({});
      m.render();
    }
    const drawer = find(m.current, "LogFilterDrawer").props;
    return {
      selected: drawer.initial[key],
      change: (values) => drawer.apply({ ...drawer.initial, [key]: values }),
    };
  };
  const chips = () =>
    plain(slot(m.current, "chips").chips.map((chip) => chip.label));
  const search = () => bar().search;
  const page = () => slot(m.current, "foot").page;
  // The route query is the start; it is not written back.
  assert.deepEqual(chips(), ["Search: dune", "Error", "Synchronization"]);
  assert.deepEqual(plain(filter("level").selected), ["error"]);
  assert.deepEqual(plain(filter("source").selected), ["sync"]);
  assert.equal(search().value, "dune");
  assert.equal(page(), 1);
  assert.deepEqual(queries, []);

  // Filter changes replace the route query and start on page 1.
  slot(m.current, "foot").setPage(3);
  m.render();
  assert.equal(page(), 3);
  assert.deepEqual(queries, [], "the page is not part of the route");
  filter("level").change(["error", "warning"]);
  m.render();
  assert.equal(page(), 1);
  assert.deepEqual(queries, ["q=dune&level=error&level=warning&source=sync"]);
  search().change("arrival");
  m.render();
  assert.equal(queries.length, 1, "the search waits");
  m.advance(300);
  assert.deepEqual(queries.slice(1), [
    "q=arrival&level=error&level=warning&source=sync",
  ]);
  slot(m.current, "chips").reset();
  m.render();
  assert.deepEqual(queries.slice(2), [""]);
  assert.deepEqual(chips(), []);

  // The sort belongs to the owner of the viewer: it shows the given sort
  // and hands changes on, from page 1.
  const sorts = [],
    polled = [];
  const sorted = viewer("level=error", [], sorts, polled);
  const header = (label) =>
    nodes(sorted.current).find(
      (node) => node.type === "SortHeader" && node.props.label === label,
    ).props;
  slot(sorted.current, "foot").setPage(2);
  sorted.render();
  header("Level").onSort("level");
  sorted.render();
  assert.deepEqual(plain(sorts), [{ field: "level", direction: "asc" }]);
  // The log requests sort by it.
  assert.match(
    polled.at(-1),
    /^level=error&sort=level&dir=asc&limit=25&offset=0$/,
  );
  assert.equal(header("Level").sort.field, "level");
  assert.notEqual(header("Time").sort.field, "ts");
  assert.equal(slot(sorted.current, "foot").page, 1);

  // An empty route starts without filters and writes nothing.
  const empty = viewer("", queries);
  assert.equal(slot(empty.current, "chips").chips.length, 0);
  assert.equal(queries.length, 3);
});

test("a log link keeps the sort of the open log", () => {
  // SystemSettingsLog lives as long as the Log tab; a link (new revision)
  // starts only the viewer inside again, with the sort kept as in 1.7.0.
  const log = mounted(
    "components/SystemSettings.tsx",
    "SystemSettingsLog",
    { status: {}, demo: false, query: "", setQuery() {}, revision: 0 },
    {
      "../api": { api: async () => ({}) },
      "../browser-storage": session().storage,
      "../event-log": loadSource("event-log.ts"),
      "../i18n": { t },
      "../notifications": { notify() {} },
      "../ui": { SegmentedTabs: "SegmentedTabs" },
      "./EventLogViewer": { EventLogViewer: "EventLogViewer" },
      "./PasswordCard": { PasswordCard: "PasswordCard" },
      "./SystemInfo": { SystemInfo: "SystemInfo" },
      "../hooks/useManualSync": {
        useManualSync: () => ({ syncing: {}, sync: async () => {} }),
      },
    },
  );
  const viewerNode = () => find(log.current, "EventLogViewer");
  assert.equal(viewerNode().key, 0);
  assert.equal(viewerNode().props.sort, null);
  viewerNode().props.setSort({ field: "level", direction: "asc" });
  log.render();
  log.props = { ...log.props, revision: 1, query: "level=error" };
  log.render();
  assert.equal(viewerNode().key, 1);
  assert.equal(viewerNode().props.query, "level=error");
  assert.deepEqual(plain(viewerNode().props.sort), {
    field: "level",
    direction: "asc",
  });
  // The panel itself is not keyed: it stays mounted through a link.
  assert.doesNotMatch(
    src("components/SettingsPage.tsx"),
    /<SystemSettingsLog\s+key=/,
  );
});

test("the open-log event and the service handoff are gone", () => {
  const sources = allSources();
  assert.doesNotMatch(sources, /scopearr-open-log|takeLogFilter|logRequested/);
  // The service tab key is read and written by its tabs only.
  const services = src("components/ConnectionSettings.tsx");
  assert.match(services, /"scopearr-service-settings"/);
  assert.doesNotMatch(
    sources.replace(services, ""),
    /scopearr-service-settings/,
  );
  // openLog sets the hash unless the router started the shown route again;
  // nothing listens for a log event any more.
  assert.match(
    src("event-log.ts"),
    /const hash = "#\/settings\/system\/log" \+ \(query \? "\?" \+ query : ""\);/,
  );
  assert.match(src("event-log.ts"), /window\.location\.hash = hash;/);
});

test("Map in settings opens the MKVToolNix service", () => {
  // The notice hands its click on to setup; Files & permissions passes the
  // service, so the click event never becomes the service tab.
  const opened = [];
  const notice = mounted(
    "components/RootCoverage.tsx",
    "SkippedRootsNotice",
    {
      roots: [
        {
          arrPath: "/movies",
          share: "",
          instances: ["radarr"],
          mapped: false,
          items: 1,
        },
      ],
      saved() {},
      setup: (...args) => opened.push(args),
      disabled: false,
    },
    {
      "../scan-coverage": { scanCoverageReason: () => "" },
      "./list/HelpTip": { HelpTip: "HelpTip" },
      "../placement-messages": { placementMessage: () => "" },
      "../api": { api: async () => ({}) },
      "../notifications": { notify() {} },
      "../i18n": { t },
      "../ui": { ICON: {} },
    },
  );
  const map = find(notice.current, "button", "Map in settings");
  const click = { type: "click", toString: () => "[object MouseEvent]" };
  map.props.onClick(click);
  assert.equal(opened.length, 1);
  assert.equal(opened[0][0], click, "the click event is handed on");

  const files = src("components/FileCheckPage.tsx");
  const handed = between(squash(files), "<FileCheckReportDialog", "/>").match(
    / setup=\{(.+?)\}(?= \w+=\{| $)/,
  )[1];
  const setups = [];
  const setup = (...args) => setups.push(args);
  // The handler as Files & permissions passes it, called like the button.
  new Function("setup", "return " + handed)(setup)(click);
  assert.deepEqual(setups, [["mux"]]);
  assert.doesNotMatch(files, /setup=\{setup\}/);
});
