import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./helpers/component-harness.mjs";
import { fakeWindow } from "./helpers/fake-window.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";
import {
  allSources,
  between,
  readSources,
  squash,
  src,
} from "./helpers/sources.mjs";

// Values cross a VM realm; compare their JSON shape.
const plain = (value) => JSON.parse(JSON.stringify(value));
const languages = await import("../src/languages.ts");
const libraryFilters = await import("../src/library-filters.ts");
const FILTERS_KEY = "scopearr-library-filters";
const { formatRoute } = loadSource("router.ts", {
  modules: {
    "./tool-route": loadSource("tool-route.ts", {
      modules: { "./browser-storage": loadSource("browser-storage.ts") },
    }),
    "./event-log": loadSource("event-log.ts"),
  },
});

// Runs the real hook with the real browser-storage, router and route-history
// modules over a fake sessionStorage, localStorage and window (history stack,
// location.hash, fake timers) and the shared hook runtime. Effects run after
// each render when their dependencies change; state set inside effects
// renders again, as Preact would. Back, Forward and typed hashes settle their
// asynchronous guards.
function appNavigation({
  hash = "",
  session: seeded = {},
  blocked = false,
  local = {},
  status = {},
  answers = [],
} = {}) {
  const confirms = [],
    session = new Map(Object.entries(seeded)),
    writes = [],
    reads = [],
    preferences = new Map(Object.entries(local)),
    localWrites = [];
  const storage = (values, log) => ({
    getItem(key) {
      reads.push(key);
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      log.push([key, String(value)]);
      values.set(key, String(value));
    },
    removeItem(key) {
      log.push([key, null]);
      values.delete(key);
    },
  });
  const blockedStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };
  const sessionStorage = blocked ? blockedStorage : storage(session, writes),
    localStorage = storage(preferences, localWrites);
  const runtime = createHookRuntime();
  const win = fakeWindow({ hash });
  const window = Object.assign(win.window, { scrollY: 0 });
  const browserStorage = loadSource("browser-storage.ts", {
      browser: { sessionStorage, localStorage },
    }),
    eventLog = loadSource("event-log.ts"),
    // Log links of the toast ("Show in log") set location.hash.
    { openLog } = loadSource("event-log.ts", {
      browser: { window, CustomEvent },
    });
  const router = loadSource("router.ts", {
    modules: {
      "./tool-route": loadSource("tool-route.ts", {
        modules: { "./browser-storage": browserStorage },
      }),
      "./event-log": eventLog,
    },
  });
  const { useAppNavigation } = loadSource("hooks/useAppNavigation.ts", {
    browser: { window },
    modules: {
      "preact/hooks": runtime.hooks,
      "../browser-storage": browserStorage,
      "../components/SortableHeader": loadSource(
        "components/SortableHeader.tsx",
        { modules: { "../ui": { ICON: {} }, "../i18n": { t: (key) => key } } },
      ),
      "../event-log": eventLog,
      "../router": router,
      "../route-history": loadSource("route-history.ts", {
        modules: { "./router": router, "./event-log": eventLog },
      }),
      "../confirmation": {
        confirmDiscard: async (message) => {
          confirms.push(message);
          assert.ok(answers.length, "unexpected confirmation: " + message);
          return answers.shift();
        },
      },
      "../i18n": { t: (key) => key },
      "../placement": loadSource("placement.ts"),
      "../filecheck": loadSource("filecheck.ts"),
      "../mux-spec": loadSource("mux-spec.ts", {
        modules: { "./languages.ts": languages },
      }),
    },
  });
  const navigation = () => useAppNavigation(h.status);
  const settle = async () => {
    for (let pass = 0; pass < 4; pass++) {
      await new Promise((resolve) => setImmediate(resolve));
      h.render();
      win.advance();
    }
    return h.current;
  };
  const h = {
    status,
    current: undefined,
    confirms,
    writes,
    reads,
    session,
    localWrites,
    preferences,
    // The browser-storage module over these stores, for a page hook that
    // runs next to the navigation.
    storage: browserStorage,
    win,
    log: win.log,
    hash: () => window.location.hash,
    render() {
      runtime.flush();
      h.current = runtime.settle(navigation, { max: 10 });
      return h.current;
    },
    // Renders only after a state change, as Preact does.
    update: () => (runtime.changed ? h.render() : h.current),
    // A render whose effects wait for the next paint; like Preact, the next
    // render runs them first.
    renderBeforePaint() {
      runtime.flush();
      h.current = runtime.render(navigation);
    },
    // Runs the debounce timers and renders.
    advance(ms = 300) {
      win.advance(ms);
      return h.render();
    },
    unmount: runtime.unmount,
    settle,
    back: () => (win.back(), settle()),
    forward: () => (win.forward(), settle()),
    type: (next) => (win.type(next), settle()),
    openLog: (filter) => (openLog(filter), settle()),
    listeners: (type) => win.listeners(type),
    dispatch(type) {
      win.dispatch(type);
      return h.render();
    },
  };
  h.render();
  return h;
}

const visible = {
  unraid: { enabled: true },
  mux: { enabled: true },
  files: { available: true },
};
const pushes = (h) => h.log.filter(([kind]) => kind === "push");
const filters = (radarr, sonarr) => ({
  [FILTERS_KEY]: JSON.stringify({ radarr, sonarr }),
});

test("navigation starts from the hash route", () => {
  const stored = filters("resolution=1080p", "codec=hevc");
  const h = appNavigation({
    hash: "#/series?instance=sonarr-4k&page=4",
    session: stored,
    status: visible,
  });
  assert.deepEqual(
    plain({
      view: h.current.view,
      service: h.current.service,
      page: h.current.page,
      filters: h.current.filters,
      settingsOpen: h.current.settingsOpen,
      settingsSection: h.current.settingsSection,
    }),
    {
      view: "library",
      service: "sonarr",
      page: 4,
      // The route wins for its service; the other one comes from storage.
      filters: { radarr: "resolution=1080p", sonarr: "instance=sonarr-4k" },
      settingsOpen: false,
      settingsSection: "connections",
    },
  );
  // No placement file search is open: a files route with Files hidden
  // falls back.
  assert.equal(
    appNavigation({
      hash: "#/tools/files",
      status: { ...visible, files: { available: false } },
    }).current.view,
    "library",
  );
  assert.equal(h.current.revision, 0);

  const settings = appNavigation({
    hash: "#/settings/recognition",
    session: stored,
    status: visible,
  });
  assert.deepEqual(
    plain({
      view: settings.current.view,
      service: settings.current.service,
      page: settings.current.page,
      filters: settings.current.filters,
      settingsOpen: settings.current.settingsOpen,
      settingsSection: settings.current.settingsSection,
    }),
    {
      view: "statistics",
      service: "radarr",
      page: 1,
      filters: { radarr: "resolution=1080p", sonarr: "codec=hevc" },
      settingsOpen: true,
      settingsSection: "recognition",
    },
  );
  assert.equal(
    appNavigation({ hash: "#/tools/files", status: visible }).current.view,
    "files",
  );
  // The settings tab and page queries are passed through.
  assert.deepEqual(
    plain(
      appNavigation({ hash: "#/settings/system/log?level=error" }).current
        .route,
    ),
    { view: "settings", section: "system", tab: "log", query: "level=error" },
  );
  assert.deepEqual(
    plain(
      appNavigation({
        hash: "#/tools/mux?q=x&sort=size&dir=asc",
        status: visible,
      }).current.route,
    ),
    { view: "mux", query: "q=x&sort=size&dir=asc" },
  );

  for (const hash of [
    "",
    "#",
    "#/",
    "#/nope",
    "#/movies/x",
    "#/%E0%A4%A",
    "{",
  ]) {
    const empty = appNavigation({ hash, status: visible });
    assert.equal(empty.current.view, "statistics", hash);
    assert.equal(empty.current.service, "radarr", hash);
    assert.equal(empty.current.page, 1, hash);
    assert.deepEqual(plain(empty.current.filters), { radarr: "", sonarr: "" });
    assert.equal(empty.current.settingsOpen, false, hash);
    assert.equal(empty.current.settingsSection, "connections", hash);
    // Canonical at once and without an entry.
    assert.equal(empty.hash(), "#/dashboard", hash);
    assert.equal(empty.win.window.history.length, 1, hash);
    assert.deepEqual(pushes(empty), [], hash);
  }
  for (const reader of [h, settings])
    assert.ok(!reader.reads.includes("scopearr-navigation"));
  assert.doesNotMatch(allSources(), /scopearr-navigation|readNavigation/);
});

test("actions push and query changes replace", () => {
  const h = appNavigation({ status: visible });
  assert.deepEqual(h.log, [["replace", "#/dashboard"]]);
  // Unrelated renders, dirty state and an action to the current view write
  // nothing.
  h.render();
  h.current.setSettingsDirty(true);
  h.render();
  h.current.openDashboard();
  h.render();
  h.advance();
  assert.equal(h.log.length, 1);

  h.current.openLibrary("sonarr", { query: "codec=hevc" });
  h.render();
  assert.deepEqual(h.log.slice(1), [["push", "#/series?codec=hevc"]]);

  // Filters, page, sort and custom tag pruning replace, as one write.
  h.current.setPage(3);
  h.render();
  h.current.setFilters((current) => ({
    ...current,
    sonarr: "codec=hevc&custom=9&customOp=and",
  }));
  h.render();
  h.current.sortLibrary("year");
  h.render();
  h.current.setPage(2);
  h.render();
  h.current.pruneCustomFilters(new Set());
  h.render();
  assert.equal(h.log.length, 2);
  h.advance(299);
  assert.equal(h.log.length, 2);
  h.advance(1);
  assert.deepEqual(h.log.slice(2), [
    ["replace", "#/series?codec=hevc&page=2&sort=year&dir=asc"],
  ]);

  // An action without a hash change does not make the next replace a push.
  h.current.setPage(1);
  h.render();
  h.advance();
  h.current.openLibrary("sonarr", { instance: "" });
  h.render();
  assert.equal(h.log.length, 4);
  h.current.setPage(3);
  h.render();
  h.advance();
  assert.deepEqual(h.log.slice(3), [
    ["replace", "#/series?codec=hevc&sort=year&dir=asc"],
    ["replace", "#/series?codec=hevc&page=3&sort=year&dir=asc"],
  ]);

  // Settings sections and tabs are pushed once; the same route is not.
  h.current.openSettings("custom");
  h.render();
  h.current.openSettings("system", "log");
  h.render();
  h.current.openSettings("system", "log");
  h.render();
  assert.deepEqual(h.log.slice(5), [
    ["push", "#/settings/custom"],
    ["push", "#/settings/system/log"],
  ]);
  // A page's own parameters replace; a pending replace is written into its
  // entry before the next push.
  h.current.replaceRoute({ query: "level=error" });
  h.render();
  h.current.openDashboard();
  h.render();
  assert.deepEqual(h.log.slice(7), [
    ["replace", "#/settings/system/log?level=error"],
    ["push", "#/dashboard"],
  ]);
  h.current.openTool("mux");
  h.render();
  h.current.replaceRoute({ query: "q=a" });
  h.render();
  h.advance();
  assert.deepEqual(h.log.slice(9), [
    ["push", "#/tools/mux"],
    ["replace", "#/tools/mux?q=a"],
  ]);
  assert.deepEqual(h.win.entries(), [
    "#/dashboard",
    "#/series?codec=hevc&page=3&sort=year&dir=asc",
    "#/settings/custom",
    "#/settings/system/log?level=error",
    "#/dashboard",
    "#/tools/mux?q=a",
  ]);
  assert.equal(h.current.revision, 0);
  assert.ok(!h.writes.some(([key]) => key === "scopearr-navigation"));
  assert.ok(!h.reads.includes("scopearr-navigation"));
});

test("a log hash opens System → Log", async () => {
  const h = appNavigation({ status: visible });
  // Back, Forward and links are heard once, never twice, also after renders
  // and actions; there is no open-log event any more.
  const heard = () => [
    h.listeners("popstate"),
    h.listeners("hashchange"),
    h.listeners("scopearr:link"),
  ];
  assert.deepEqual(heard(), [1, 1, 1]);
  h.render();
  h.current.openLibrary("radarr", { instance: "" });
  h.render();
  assert.deepEqual(heard(), [1, 1, 1]);
  assert.equal(h.listeners("scopearr-open-log"), 0);

  // Settings closed: the link opens System → Log with its filter.
  await h.openLog({ source: ["sync"] });
  assert.equal(h.current.settingsOpen, true);
  assert.equal(h.current.settingsSection, "system");
  assert.deepEqual(plain(h.current.route), {
    view: "settings",
    section: "system",
    tab: "log",
    query: "source=sync",
  });
  assert.equal(h.hash(), "#/settings/system/log?source=sync");
  assert.equal(h.current.revision, 1);

  // Open on another section with unsaved changes: the section guard asks
  // once (not the leave question); a decline keeps the section and its tab.
  const asked = [],
    answers = [];
  h.current.setSectionGuard(async (next) => {
    asked.push(next);
    assert.ok(answers.length, "unexpected section question: " + next);
    return answers.shift();
  });
  h.current.openSettings("appearance");
  h.render();
  h.current.setSettingsDirty(true);
  h.render();
  const link = "#/settings/system/log?source=sync&instance=radarr";
  answers.push(false);
  await h.openLog({ source: ["sync"], instance: ["radarr"] });
  assert.deepEqual(asked, ["system"]);
  assert.equal(h.current.settingsSection, "appearance");
  assert.equal(h.current.route.tab, "");
  assert.equal(h.hash(), "#/settings/appearance");
  assert.equal(h.win.entries().at(-1), link, "the link stays ahead");
  assert.equal(h.current.revision, 1);
  answers.push(true);
  await h.openLog({ source: ["sync"], instance: ["radarr"] });
  assert.deepEqual(asked, ["system", "system"]);
  assert.equal(h.current.settingsSection, "system");
  assert.equal(h.hash(), link);
  assert.deepEqual(plain(h.current.route), {
    view: "settings",
    section: "system",
    tab: "log",
    query: "source=sync&instance=radarr",
  });
  assert.equal(h.current.revision, 2);
  assert.deepEqual(h.confirms, []);

  // Log already open: another filter starts the viewer again (revision)
  // without asking.
  await h.openLog({ level: ["error"] });
  assert.deepEqual(asked, ["system", "system"]);
  assert.equal(h.hash(), "#/settings/system/log?level=error");
  assert.equal(h.current.route.query, "level=error");
  assert.equal(h.current.revision, 3);

  // A link to the shown log starts it again (page 1) without an entry, also
  // while a filter change still waits for the URL: the waiting replace is
  // written first, so the link compares with what is shown.
  let entries = h.win.entries();
  await h.openLog({ level: ["error"] });
  assert.equal(h.current.revision, 4);
  assert.deepEqual(h.win.entries(), entries);
  h.current.replaceRoute({ tab: "log", query: "level=info" });
  h.render();
  assert.equal(h.win.window.location.hash, "#/settings/system/log?level=error");
  await h.openLog({ level: ["info"] });
  assert.equal(h.current.revision, 5);
  assert.equal(h.hash(), "#/settings/system/log?level=info");
  assert.deepEqual(h.win.entries(), [
    ...entries.slice(0, -1),
    "#/settings/system/log?level=info",
  ]);
  // A stale URL equal to the link is no shown route: the link opens anew.
  h.current.replaceRoute({ tab: "log", query: "level=warning" });
  h.render();
  assert.equal(h.win.window.location.hash, "#/settings/system/log?level=info");
  await h.openLog({ level: ["info"] });
  assert.equal(h.current.route.query, "level=info");
  assert.equal(h.current.revision, 6);
  entries = h.win.entries();
  assert.deepEqual(entries.slice(-2), [
    "#/settings/system/log?level=warning",
    "#/settings/system/log?level=info",
  ]);
  assert.deepEqual(asked, ["system", "system"]);
  assert.deepEqual(h.confirms, []);

  // A chosen tab replaces; another tab starts without the log query, the
  // same tab keeps it, and a log filter writes its tab with it.
  const length = h.win.entries().length;
  for (const [patch, hash] of [
    [{ tab: "log" }, "#/settings/system/log?level=info"],
    [{ tab: "info" }, "#/settings/system/info"],
    [{ tab: "log" }, "#/settings/system/log"],
    [{ tab: "", query: "" }, "#/settings/system"],
    [{ tab: "log", query: "q=x" }, "#/settings/system/log?q=x"],
  ]) {
    h.current.replaceRoute(patch);
    h.render();
    h.advance();
    assert.equal(h.hash(), hash, JSON.stringify(patch));
  }
  assert.equal(h.win.entries().length, length);
  assert.equal(h.current.revision, 6);
  assert.deepEqual(heard(), [1, 1, 1]);

  const plainOpen = appNavigation({ status: visible });
  plainOpen.current.openSettings();
  plainOpen.render();
  assert.equal(plainOpen.current.settingsOpen, true);
  assert.equal(plainOpen.current.settingsSection, "connections");
});

test("leaving dirty settings asks first", async () => {
  const h = appNavigation({ status: visible, answers: [false, true] });
  h.current.openSettings("recognition");
  h.render();
  h.current.setSettingsDirty(true);
  h.render();

  assert.equal(await h.current.canLeaveRules(), false);
  h.render();
  assert.deepEqual(h.confirms, ["Discard unsaved settings changes?"]);
  assert.equal(h.current.settingsOpen, true);

  // Asking changes nothing; the action that follows leaves.
  assert.equal(await h.current.canLeaveRules(), true);
  h.render();
  assert.equal(h.confirms.length, 2);
  assert.equal(h.current.settingsOpen, true);
  assert.equal(h.hash(), "#/settings/recognition");
  h.current.openDashboard();
  h.render();
  assert.equal(h.current.settingsOpen, false);
  assert.equal(h.hash(), "#/dashboard");

  // Clean settings, or dirty state with settings closed, leave without asking.
  const clean = appNavigation({ status: visible });
  clean.current.openSettings();
  clean.render();
  assert.equal(await clean.current.canLeaveRules(), true);
  clean.current.openTool("mux");
  clean.render();
  assert.equal(clean.current.settingsOpen, false);
  clean.current.setSettingsDirty(true);
  clean.render();
  assert.equal(await clean.current.canLeaveRules(), true);
  assert.deepEqual(clean.confirms, []);

  // Back and Forward out of dirty settings ask the same question once; a
  // decline returns to the settings entry and keeps the entry after it.
  const back = appNavigation({ status: visible, answers: [false, true] });
  back.current.openSettings("appearance");
  back.render();
  back.current.openTool("disks");
  back.render();
  await back.back();
  back.current.setSettingsDirty(true);
  back.render();
  const entries = back.win.entries();
  await back.back();
  assert.deepEqual(back.confirms, ["Discard unsaved settings changes?"]);
  assert.equal(back.current.settingsOpen, true);
  assert.equal(back.current.settingsSection, "appearance");
  assert.equal(back.hash(), "#/settings/appearance");
  assert.deepEqual(back.win.entries(), entries);
  await back.forward();
  assert.equal(back.confirms.length, 2);
  assert.equal(back.current.settingsOpen, false);
  assert.equal(back.current.view, "disks");
  assert.equal(back.hash(), "#/tools/placement");
  assert.deepEqual(back.win.entries(), entries);
  assert.deepEqual(pushes(back).length, 2);
});

test("a registered section guard is kept until the page unmounts", async () => {
  const h = appNavigation({ status: visible });
  // Without a settings page every section opens without asking.
  assert.equal(
    await h.current.openLink({ view: "settings", section: "system" }),
    true,
  );
  h.render();
  assert.equal(h.current.settingsSection, "system");

  h.current.openSettings("appearance");
  h.render();
  const asked = [];
  const guard = (answer) => async (next) => {
    asked.push(next);
    return answer;
  };
  const log = h.log.length,
    writes = h.writes.length;
  const declining = guard(false);
  h.current.setSectionGuard(declining);
  h.render();
  h.advance();
  assert.equal(h.log.length, log, "the guard is no navigation state");
  assert.equal(h.writes.length, writes, "the guard is no navigation state");

  // Renders, dirty state and navigation actions keep it.
  h.render();
  h.current.setSettingsDirty(true);
  h.render();
  h.current.openSettings("widgets");
  h.render();
  const link = (section) => h.current.openLink({ view: "settings", section });
  assert.equal(await link("system"), false);
  h.render();
  assert.deepEqual(asked, ["system"]);
  assert.equal(
    h.current.settingsSection,
    "widgets",
    "a declined link opens nothing",
  );

  // The page registers again on every render; the latest guard answers.
  const allowing = guard(true);
  h.current.setSectionGuard(allowing);
  h.render();
  assert.equal(await link("custom"), true);
  h.render();
  assert.deepEqual(asked, ["system", "custom"]);
  assert.equal(h.current.settingsSection, "custom");

  // An unmounting page drops only its own guard: a newer page keeps its own.
  h.current.setSectionGuard(null, declining);
  h.render();
  assert.equal(await link("system"), true);
  h.render();
  assert.deepEqual(asked, ["system", "custom", "system"]);
  assert.equal(h.current.settingsSection, "system");
  h.current.setSectionGuard(null, allowing);
  h.render();
  assert.equal(await link("widgets"), true);
  h.render();
  assert.deepEqual(asked, ["system", "custom", "system"]);
  assert.equal(h.current.settingsSection, "widgets");
  assert.deepEqual(h.confirms, []);

  // SettingsPage registers its current guard on every render and drops it on
  // unmount unless another page registered since; AppShell hands it the
  // section and the setters of the navigation. Another section opens through
  // the frame's links (openLink), which ask this guard; the page gets no
  // way to open a section itself.
  const page = squash(src("components/SettingsPage.tsx"));
  assert.match(
    page,
    / const guard = useRef\(\s*confirmSectionChange,?\s*\); guard\.current = confirmSectionChange; registerSectionGuard\(\s*confirmSectionChange,?\s*\);/,
  );
  // On every render: directly in the body of SettingsPage, in no block.
  const head = between(
    page,
    "export function SettingsPage(",
    " const guard = useRef(",
  );
  assert.equal(
    head.split("{").length - head.split("}").length,
    1,
    "the guard is registered in the body of SettingsPage",
  );
  assert.match(
    page,
    /useEffect\(\s*\(\) => \(\) =>\s*registerSectionGuard\(\s*null,\s*guard\.current,?\s*\),\s*\[\],?\s*\);/,
  );
  assert.equal(page.match(/registerSectionGuard\(/g).length, 2);
  const shell = src("components/AppShell.tsx");
  assert.match(shell, /\bsection=\{settingsSection\}/);
  assert.doesNotMatch(shell, /\bopenSection\b/);
  assert.match(squash(shell), /<Sidebar [^>]*\bopen=\{openLink\}/);
  assert.match(shell, /registerSectionGuard=\{setSectionGuard\}/);
});

test("the section guard decides back and forward within settings", async () => {
  const h = appNavigation({ status: visible });
  const asked = [],
    answers = [];
  h.current.setSectionGuard(async (next) => {
    asked.push(next);
    assert.ok(answers.length, "unexpected section question: " + next);
    return answers.shift();
  });
  h.current.openSettings();
  h.render();
  h.current.openSettings("appearance");
  h.render();
  const entries = h.win.entries();

  answers.push(false);
  await h.back();
  assert.deepEqual(asked, ["connections"]);
  assert.equal(h.current.settingsSection, "appearance");
  assert.equal(h.hash(), "#/settings/appearance");
  assert.deepEqual(h.win.entries(), entries);
  assert.equal(h.current.revision, 0);

  answers.push(true);
  await h.back();
  assert.deepEqual(asked, ["connections", "connections"]);
  assert.equal(h.current.settingsSection, "connections");
  assert.equal(h.hash(), "#/settings/connections");
  assert.equal(h.current.revision, 1);

  answers.push(true);
  await h.forward();
  assert.deepEqual(asked, ["connections", "connections", "appearance"]);
  assert.equal(h.current.settingsSection, "appearance");
  assert.equal(h.current.revision, 2);

  // A tab of the same section changes without asking.
  h.current.openSettings("system");
  h.render();
  answers.push(true);
  h.current.openSettings("system", "log");
  h.render();
  assert.equal(h.current.revision, 3, "the same section with another tab");
  await h.back();
  assert.equal(h.hash(), "#/settings/system");
  assert.equal(h.current.settingsSection, "system");
  assert.equal(h.current.route.tab, "");
  assert.equal(answers.length, 1);
  answers.length = 0;

  // Leaving settings asks the leave question, not the section guard.
  h.current.setSettingsDirty(true);
  h.render();
  const leave = appNavigation({ status: visible, answers: [true] });
  leave.current.setSectionGuard(async (next) => {
    throw new Error("section guard asked for " + next);
  });
  leave.current.openSettings("widgets");
  leave.render();
  leave.current.setSettingsDirty(true);
  leave.render();
  await leave.back();
  assert.deepEqual(leave.confirms, ["Discard unsaved settings changes?"]);
  assert.equal(leave.current.settingsOpen, false);
  assert.equal(leave.hash(), "#/dashboard");

  // While a question is open, more steps only move the target; the answer
  // applies to the newest entry.
  const late = appNavigation({ status: visible });
  let answer;
  late.current.setSectionGuard(
    () => new Promise((resolve) => (answer = resolve)),
  );
  late.current.openSettings();
  late.render();
  late.current.openSettings("appearance");
  late.render();
  late.current.openSettings("widgets");
  late.render();
  await late.back();
  assert.equal(typeof answer, "function");
  const first = answer;
  answer = undefined;
  await late.back();
  assert.equal(answer, undefined, "one question at a time");
  assert.equal(late.current.settingsSection, "widgets");
  first(true);
  await late.settle();
  assert.equal(late.current.settingsSection, "connections");
  assert.equal(late.hash(), "#/settings/connections");
  assert.equal(late.current.revision, 1);
});

test("a step that arrives before the last render synced is not undone", async () => {
  const h = appNavigation({ status: visible });
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  h.current.openLibrary("radarr", { instance: "" });
  h.render();
  h.current.openSettings();
  h.render();
  await h.back();
  // Back to the dashboard; its render has not synced when Forward arrives,
  // and the hashchange of Forward comes before the next paint.
  h.win.back();
  await tick();
  h.renderBeforePaint();
  assert.equal(h.current.view, "statistics");
  h.win.forward();
  await tick();
  h.renderBeforePaint();
  h.win.advance();
  assert.equal(h.hash(), "#/movies");
  h.render();
  h.advance();
  assert.equal(h.current.view, "library");
  assert.equal(h.hash(), "#/movies");
  assert.deepEqual(h.win.entries(), [
    "#/dashboard",
    "#/movies",
    "#/settings/connections",
  ]);
  assert.deepEqual(h.log.slice(1), [
    ["push", "#/movies"],
    ["push", "#/settings/connections"],
  ]);
});

test("an action that changes nothing leaves no intent behind", async () => {
  // A second click on the open tool or section renders nothing by itself;
  // the next filter change must still replace.
  const h = appNavigation({ status: visible });
  h.current.openTool("mux");
  h.update();
  h.current.openTool("mux");
  h.update();
  h.current.replaceRoute({ query: "q=a" });
  h.update();
  h.advance();
  h.current.openSettings("appearance");
  h.update();
  h.current.openSettings("appearance");
  h.update();
  h.current.replaceRoute({ tab: "colors" });
  h.update();
  h.advance();
  assert.deepEqual(h.log.slice(1), [
    ["push", "#/tools/mux"],
    ["replace", "#/tools/mux?q=a"],
    ["push", "#/settings/appearance"],
    ["replace", "#/settings/appearance/colors"],
  ]);

  // An allowed leave that no action used (Open in mux whose refresh failed)
  // ends with the next render: later section changes and Back keep the page.
  const left = appNavigation({ status: visible });
  left.current.openSettings("appearance");
  left.update();
  left.current.openSettings("widgets");
  left.update();
  const mount = left.current.settingsMount;
  assert.equal(await left.current.canLeaveRules(), true);
  left.render();
  left.current.openSettings("system");
  left.update();
  assert.equal(left.current.settingsMount, mount);
  assert.equal(await left.current.canLeaveRules(), true);
  left.render();
  await left.back();
  assert.equal(left.current.settingsSection, "widgets");
  assert.equal(left.current.settingsMount, mount);
});

test("pruning drops unknown custom tags and their operator", () => {
  const h = appNavigation({
    status: visible,
    hash: "#/movies?custom=1&custom=9&customOp=and&resolution=1080p",
    session: filters("", "custom=9&customOp=or&codec=hevc"),
  });
  h.current.pruneCustomFilters(new Set(["1"]));
  h.render();
  assert.deepEqual(plain(h.current.filters), {
    radarr: "customOp=and&resolution=1080p&custom=1",
    sonarr: "codec=hevc",
  });

  h.current.setFilters({
    radarr: "custom=__unknown__&customOp=or",
    sonarr: "",
  });
  h.render();
  h.current.pruneCustomFilters(new Set());
  h.render();
  assert.deepEqual(plain(h.current.filters), {
    radarr: "customOp=or&custom=__unknown__",
    sonarr: "",
  });
});

test("hidden tool views fall back to the library", () => {
  for (const [hash, status] of [
    ["#/tools/placement", { ...visible, unraid: { enabled: false } }],
    ["#/tools/mux", { ...visible, mux: { enabled: false } }],
    ["#/tools/files", { ...visible, files: { available: false } }],
  ]) {
    const h = appNavigation({ hash, status });
    assert.equal(h.current.view, "library", hash);
  }
  for (const [hash, view] of [
    ["#/tools/placement", "disks"],
    ["#/tools/mux", "mux"],
    ["#/tools/files", "files"],
    ["#/dashboard", "statistics"],
  ]) {
    const h = appNavigation({ hash, status: visible });
    assert.equal(h.current.view, view);
  }

  // A disk placement file search keeps the files view open while hidden.
  const h = appNavigation({
    hash: "#/tools/placement",
    status: { ...visible, files: { available: false } },
  });
  h.current.openFiles("/mnt/disk1/Movies");
  h.render();
  assert.equal(h.current.view, "files");
  // A later status update keeps it open.
  h.status = {
    ...visible,
    files: { available: false },
    mux: { enabled: true, pending: 1 },
  };
  h.render();
  assert.equal(h.current.view, "files");

  h.current.openTool("disks");
  h.render();
  assert.equal(h.current.view, "disks");
  h.current.openTool("files");
  h.render();
  assert.equal(h.current.view, "library");

  // Hiding a tool later moves its open view to the library.
  const later = appNavigation({ hash: "#/tools/mux", status: visible });
  assert.equal(later.current.view, "mux");
  later.status = { ...visible, mux: { enabled: false } };
  later.render();
  assert.equal(later.current.view, "library");
});

test("hidden tool routes fall back with a replace", async () => {
  // A deep link to a hidden tool opens the library without an entry.
  const start = appNavigation({
    hash: "#/tools/placement",
    status: { ...visible, unraid: { enabled: false } },
  });
  start.advance();
  assert.equal(start.hash(), "#/movies");
  assert.equal(start.win.window.history.length, 1);
  assert.deepEqual(pushes(start), []);

  // Hiding the open tool replaces its entry.
  const h = appNavigation({ status: visible });
  h.current.openTool("mux");
  h.render();
  h.status = { ...visible, mux: { enabled: false } };
  h.render();
  h.advance();
  assert.deepEqual(h.win.entries(), ["#/dashboard", "#/movies"]);
  assert.deepEqual(pushes(h), [["push", "#/tools/mux"]]);

  // Back or Forward onto a hidden tool replaces that entry, too.
  const back = appNavigation({ status: visible });
  back.current.openTool("disks");
  back.render();
  await back.back();
  back.status = { ...visible, unraid: { enabled: false } };
  back.render();
  await back.forward();
  back.advance();
  assert.equal(back.current.view, "library");
  assert.deepEqual(back.win.entries(), ["#/dashboard", "#/movies"]);
  assert.equal(pushes(back).length, 1);
});

test("own replaces and pushes to another view do not change the revision", async () => {
  const h = appNavigation({ hash: "#/movies?q=a", status: visible });
  h.current.setFilters((current) => ({ ...current, radarr: "q=ab" }));
  h.render();
  h.current.setPage(2);
  h.render();
  h.advance();
  h.current.openTool("mux");
  h.render();
  h.current.replaceRoute({ query: "q=x" });
  h.render();
  h.current.openSettings("appearance");
  h.render();
  h.current.openSettings("system");
  h.render();
  h.current.replaceRoute({ tab: "log", query: "level=error" });
  h.render();
  h.advance();
  h.current.openLibrary("radarr", { instance: "" });
  h.render();
  h.current.openTool("mux");
  h.render();
  h.current.openTool("mux");
  h.render();
  assert.equal(h.current.revision, 0);
  assert.deepEqual(h.win.entries(), [
    "#/movies?q=ab&page=2",
    "#/tools/mux?q=x",
    "#/settings/appearance",
    "#/settings/system/log?level=error",
    "#/movies?q=ab",
    "#/tools/mux",
  ]);

  // A push to the same page with other page parameters starts it again.
  h.current.openSettings("system");
  h.render();
  h.current.openSettings("system", "log");
  h.render();
  assert.equal(h.current.revision, 1);

  // Accepted Back and Forward count; a step back to the shown route does not.
  await h.back();
  assert.equal(h.current.revision, 2);
  await h.forward();
  assert.equal(h.current.revision, 3);
  h.win.dispatch("hashchange");
  await h.settle();
  assert.equal(h.current.revision, 3);
});

// Navigation state as the pages see it.
const snapshot = (navigation) =>
  plain({
    view: navigation.view,
    service: navigation.service,
    page: navigation.page,
    filters: navigation.filters,
    settingsOpen: navigation.settingsOpen,
    settingsSection: navigation.settingsSection,
    movieSort: navigation.movieSort,
  });

// Every action sets the state and storage of 1.7.0, except the settings tab
// keys: a tab given by an action (a link such as Set up) goes into the route
// only, and its page writes the key when a tab is chosen there.
test("named actions set the same state and storage as before, settings tabs only in the route", () => {
  const start = "#/movies?resolution=1080p&page=3",
    stored = filters("resolution=1080p", "codec=hevc&instance=sonarr");
  const rows = [
    {
      name: "dashboard",
      act: (n) => n.openDashboard(),
      state: { view: "statistics" },
      hash: "#/dashboard",
    },
    {
      name: "library instance",
      from: "#/dashboard",
      act: (n) => n.openLibrary("sonarr", { instance: "sonarr-4k" }),
      state: {
        view: "library",
        service: "sonarr",
        page: 1,
        filters: {
          radarr: "resolution=1080p",
          sonarr: "codec=hevc&instance=sonarr-4k",
        },
      },
      hash: "#/series?codec=hevc&instance=sonarr-4k",
    },
    {
      name: "library with every instance",
      from: "#/tools/mux",
      act: (n) => n.openLibrary("sonarr", { instance: "" }),
      state: {
        view: "library",
        service: "sonarr",
        page: 1,
        filters: { radarr: "resolution=1080p", sonarr: "codec=hevc" },
      },
      hash: "#/series?codec=hevc",
    },
    {
      name: "library query",
      from: "#/series?codec=hevc&instance=sonarr&page=2",
      act: (n) => n.openLibrary("radarr", { query: "hdr=Dolby+Vision" }),
      state: {
        service: "radarr",
        page: 1,
        filters: {
          radarr: "hdr=Dolby+Vision",
          sonarr: "codec=hevc&instance=sonarr",
        },
      },
      hash: "#/movies?hdr=Dolby+Vision",
    },
    {
      name: "tool",
      act: (n) => n.openTool("mux"),
      state: { view: "mux" },
      hash: "#/tools/mux",
    },
    {
      name: "same tool",
      from: "#/tools/placement",
      act: (n) => n.openTool("disks"),
      state: {},
    },
    {
      name: "files from disk placement",
      from: "#/tools/placement",
      act: (n) => n.openFiles("/mnt/disk1/Movies/A B"),
      state: { view: "files" },
      // It stays open while Files & permissions is hidden.
      keepsFiles: true,
      // The search is the route; the page writes its storage.
      hash: "#/tools/files?q=%2Fmnt%2Fdisk1%2FMovies%2FA+B",
    },
    {
      name: "mux file",
      act: (n) => n.openMuxFile("Movie (2020).mkv"),
      state: { view: "mux" },
      hash: "#/tools/mux?q=Movie+%282020%29.mkv",
    },
    {
      name: "settings",
      act: (n) => n.openSettings(),
      state: { settingsOpen: true },
      hash: "#/settings/connections",
    },
    {
      name: "settings from another section",
      from: "#/settings/system",
      act: (n) => n.openSettings(),
      state: { settingsSection: "connections" },
      hash: "#/settings/connections",
    },
    {
      name: "settings section",
      from: "#/settings/connections",
      act: (n) => n.openSettings("custom"),
      state: { settingsSection: "custom" },
      hash: "#/settings/custom",
    },
    {
      name: "service setup",
      // No session write: the tab is in the route only.
      from: "#/tools/mux",
      act: (n) => n.openSettings("connections", "mux"),
      state: { settingsOpen: true },
      hash: "#/settings/connections/mux",
    },
    {
      name: "appearance tab",
      // No session write: the tab is in the route only.
      act: (n) => n.openSettings("appearance", "colors"),
      state: { settingsOpen: true, settingsSection: "appearance" },
      hash: "#/settings/appearance/colors",
    },
    {
      name: "system tab",
      // No session write: the tab is in the route only.
      act: (n) => n.openSettings("system", "log"),
      state: { settingsOpen: true, settingsSection: "system" },
      hash: "#/settings/system/log",
    },
    {
      name: "dashboard from settings",
      from: "#/settings/appearance",
      act: (n) => n.openDashboard(),
      state: { settingsOpen: false },
      hash: "#/dashboard",
    },
    {
      name: "tool from settings",
      from: "#/settings/appearance",
      act: (n) => n.openTool("disks"),
      state: { settingsOpen: false, view: "disks" },
      hash: "#/tools/placement",
    },
    {
      name: "library from settings",
      from: "#/settings/appearance",
      act: (n) => n.openLibrary("radarr", { instance: "" }),
      state: { settingsOpen: false, view: "library" },
      hash: "#/movies?resolution=1080p",
    },
    {
      name: "library sort",
      from: "#/series?codec=hevc&instance=sonarr",
      act: (n) => n.sortLibrary("year"),
      state: { movieSort: { field: "year", direction: "asc" } },
      local: [
        ["scopearr-film-sort", '{"field":"title","direction":"asc"}'],
        ["scopearr-series-sort", '{"field":"year","direction":"asc"}'],
      ],
      // The pending replace is stored until it is written.
      session: [
        [
          "scopearr-pending-route",
          '{"index":0,"url":"http://127.0.0.1:18080/","hash":"#/series?codec=hevc&instance=sonarr&sort=year&dir=asc"}',
        ],
        ["scopearr-pending-route", null],
      ],
      replace: "#/series?codec=hevc&instance=sonarr&sort=year&dir=asc",
    },
  ];
  for (const row of rows) {
    const h = appNavigation({
      hash: row.from || start,
      session: stored,
      status: visible,
    });
    const before = snapshot(h.current),
      session = h.writes.length,
      local = h.localWrites.length,
      log = h.log.length;
    row.act(h.current);
    h.render();
    h.advance();
    const after = snapshot(h.current);
    assert.deepEqual(after, { ...before, ...row.state }, row.name);
    const writes = h.writes.slice(session);
    assert.deepEqual(
      writes.filter(([key]) => key !== FILTERS_KEY),
      row.session || [],
      row.name,
    );
    assert.equal(
      h.session.get(FILTERS_KEY),
      JSON.stringify(after.filters),
      row.name,
    );
    assert.deepEqual(h.localWrites.slice(local), row.local || [], row.name);
    // One push when the hash changes, a replace for the sort, else nothing.
    assert.deepEqual(
      h.log.slice(log),
      row.hash
        ? [["push", row.hash]]
        : row.replace
          ? [["replace", row.replace]]
          : [],
      row.name,
    );
    // Hiding Files & permissions moves only an open Files view that no
    // placement search opened.
    h.status = { ...visible, files: { available: false } };
    h.render();
    assert.equal(
      h.current.view,
      after.view === "files" && !row.keepsFiles ? "library" : after.view,
      row.name,
    );
  }
});

test("handoffs become routes", async () => {
  const files = "#/tools/files?q=%2Fmnt%2Fdisk1%2FMovies%2FA+B",
    mux = "#/tools/mux?q=Movie+%282020%29.mkv";
  const h = appNavigation({ hash: "#/tools/placement", status: visible });
  const session = h.writes.length,
    local = h.localWrites.length;
  // Disk placement opens one path in Files & permissions.
  h.current.openFiles("/mnt/disk1/Movies/A B");
  h.render();
  h.advance();
  assert.equal(h.hash(), files);
  assert.deepEqual(plain(h.current.route), {
    view: "files",
    query: "q=%2Fmnt%2Fdisk1%2FMovies%2FA+B",
  });
  // It stays open while Files & permissions is hidden.
  h.status = { ...visible, files: { available: false } };
  h.render();
  assert.equal(h.current.view, "files");
  h.status = visible;
  h.render();
  // A library file opens its name in Muxing.
  h.current.openLibrary("radarr", { instance: "" });
  h.render();
  h.current.openMuxFile("Movie (2020).mkv");
  h.render();
  h.advance();
  assert.equal(h.hash(), mux);
  assert.deepEqual(plain(h.current.route), {
    view: "mux",
    query: "q=Movie+%282020%29.mkv",
  });
  assert.deepEqual(pushes(h), [
    ["push", files],
    ["push", "#/movies"],
    ["push", mux],
  ]);
  // The navigation writes no storage for them; the opened page does.
  assert.deepEqual(
    h.writes.slice(session).filter(([key]) => key !== FILTERS_KEY),
    [],
  );
  assert.deepEqual(h.localWrites.slice(local), []);

  // A new search on the open tool starts its page again; the same one does
  // nothing.
  const revision = h.current.revision;
  h.current.openMuxFile("Other.mkv");
  h.render();
  assert.equal(h.current.revision, revision + 1);
  assert.equal(h.hash(), "#/tools/mux?q=Other.mkv");
  h.current.openMuxFile("Other.mkv");
  h.render();
  assert.equal(h.current.revision, revision + 1);
  assert.equal(pushes(h).length, 4);

  // Back returns to each search.
  await h.back();
  assert.equal(h.hash(), mux);
  await h.back();
  await h.back();
  assert.equal(h.hash(), files);
  assert.equal(h.current.view, "files");
  await h.back();
  assert.equal(h.current.view, "disks");
});

test("tool pages learn whether their route came from history", async () => {
  const h = appNavigation({ hash: "#/tools/mux?q=a", status: visible });
  // The start and actions let storage fill what the route leaves out.
  assert.equal(h.current.fromHistory, false);
  h.current.openTool("files");
  h.render();
  assert.equal(h.current.fromHistory, false);
  // Back and Forward name the whole state.
  await h.back();
  assert.equal(h.current.view, "mux");
  assert.equal(h.current.fromHistory, true);
  h.current.replaceRoute({ query: "q=ab" });
  h.render();
  assert.equal(h.current.revision, 1);
  h.current.openTool("disks");
  h.render();
  assert.equal(h.current.fromHistory, false);
  // A typed link starts like a page load.
  await h.type("#/tools/files?q=x");
  assert.equal(h.current.fromHistory, false);
  assert.equal(h.current.revision, 2);
  h.current.openMuxFile("b");
  h.render();
  assert.equal(h.current.fromHistory, false);
  await h.back();
  assert.equal(h.current.fromHistory, true);
  assert.deepEqual(plain(h.current.route), { view: "files", query: "q=x" });
});

test("library sort starts from storage and persists in the same format", () => {
  const h = appNavigation({
    hash: "#/movies?page=4",
    status: visible,
    local: {
      "scopearr-film-sort": '{"field":"language","direction":"desc"}',
      "scopearr-series-sort": '{"field":"title","direction":"asc"}',
    },
  });
  assert.deepEqual(plain(h.current.route.sort), {
    field: "audio",
    direction: "desc",
  });
  assert.deepEqual(plain(h.current.movieSort), {
    field: "audio",
    direction: "desc",
  });
  // A route without a sort takes the stored one into the URL at once.
  assert.equal(h.hash(), "#/movies?page=4&sort=audio&dir=desc");
  // Both keys are written on start, the old field renamed and the default
  // spelled out; renders without a change write nothing.
  assert.deepEqual(h.localWrites, [
    ["scopearr-film-sort", '{"field":"audio","direction":"desc"}'],
    ["scopearr-series-sort", '{"field":"title","direction":"asc"}'],
  ]);
  h.render();
  assert.equal(h.localWrites.length, 2);

  // A column sorts ascending, then descending, then back to the default,
  // each time from the first page.
  for (const sort of [
    { field: "year", direction: "asc" },
    { field: "year", direction: "desc" },
    null,
  ]) {
    h.current.setPage(4);
    h.current.sortLibrary("year");
    h.render();
    assert.deepEqual(plain(h.current.route.sort), sort);
    assert.deepEqual(
      plain(h.current.movieSort),
      sort || { field: "title", direction: "asc" },
    );
    assert.equal(h.current.page, 1);
    assert.equal(
      h.preferences.get("scopearr-film-sort"),
      JSON.stringify(sort || { field: "title", direction: "asc" }),
    );
  }

  // The sort belongs to the current service.
  h.current.openLibrary("sonarr", { instance: "" });
  h.render();
  assert.deepEqual(plain(h.current.movieSort), {
    field: "title",
    direction: "asc",
  });
  h.current.sortLibrary("size");
  h.render();
  assert.deepEqual(plain(h.current.route.sort), {
    field: "size",
    direction: "asc",
  });
  assert.equal(
    h.preferences.get("scopearr-series-sort"),
    '{"field":"size","direction":"asc"}',
  );
  assert.equal(
    h.preferences.get("scopearr-film-sort"),
    '{"field":"title","direction":"asc"}',
  );

  // A route sort wins over the stored one.
  const routed = appNavigation({
    hash: "#/series?sort=year&dir=desc",
    status: visible,
    local: { "scopearr-series-sort": '{"field":"size","direction":"asc"}' },
  });
  assert.deepEqual(plain(routed.current.movieSort), {
    field: "year",
    direction: "desc",
  });
  assert.equal(
    routed.preferences.get("scopearr-series-sort"),
    '{"field":"year","direction":"desc"}',
  );

  // Broken values, unknown fields and directions start from the default.
  for (const value of [
    "{",
    "null",
    '"year"',
    '{"field":"bogus","direction":"asc"}',
    '{"field":"year","direction":"up"}',
  ]) {
    const broken = appNavigation({
      status: visible,
      local: { "scopearr-film-sort": value, "scopearr-series-sort": value },
    });
    assert.deepEqual(
      plain(broken.current.movieSort),
      { field: "title", direction: "asc" },
      value,
    );
    assert.equal(
      broken.preferences.get("scopearr-film-sort"),
      '{"field":"title","direction":"asc"}',
      value,
    );
    assert.equal(
      broken.preferences.get("scopearr-series-sort"),
      '{"field":"title","direction":"asc"}',
    );
  }
});

test("history steps take every library parameter from the route", async () => {
  const h = appNavigation({
    hash: "#/movies",
    session: filters("q=stored", "codec=hevc"),
    status: visible,
    local: { "scopearr-film-sort": '{"field":"year","direction":"asc"}' },
  });
  // Entered without parameters: the stored sort; the route's empty filters.
  assert.equal(h.hash(), "#/movies?sort=year&dir=asc");
  assert.equal(h.current.filters.radarr, "");
  h.current.setFilters((current) => ({ ...current, radarr: "q=x" }));
  h.current.setPage(3);
  h.render();
  h.advance();
  h.current.openDashboard();
  h.render();

  // A missing sort, page or filter means the default, not the storage. The
  // entry has an index, as one from before a reload; a typed hash would
  // start like a page load.
  h.win.window.history.pushState({ scopearr: 2 }, "", "#/movies");
  await h.back();
  assert.equal(h.hash(), "#/dashboard");
  await h.forward();
  assert.equal(h.current.fromHistory, true);
  assert.deepEqual(plain(h.current.route.sort), null);
  assert.equal(h.current.filters.radarr, "");
  assert.equal(h.current.page, 1);
  assert.equal(h.current.filters.sonarr, "codec=hevc");
  assert.equal(
    h.preferences.get("scopearr-film-sort"),
    '{"field":"title","direction":"asc"}',
  );
  assert.equal(h.hash(), "#/movies");
  await h.back();
  assert.equal(h.hash(), "#/dashboard");
  await h.back();
  assert.deepEqual(plain(h.current.movieSort), {
    field: "year",
    direction: "asc",
  });
  assert.equal(h.current.filters.radarr, "q=x");
  assert.equal(h.current.page, 3);
});

test("inactive library filters survive a reload", () => {
  const first = appNavigation({ status: visible });
  first.current.openLibrary("sonarr", { query: "codec=hevc" });
  first.render();
  first.current.setFilters((current) => ({
    ...current,
    sonarr: "codec=hevc&q=Dark",
  }));
  first.render();
  first.current.openLibrary("radarr", { instance: "" });
  first.render();
  first.current.setFilters((current) => ({ ...current, radarr: "q=Tenet" }));
  first.render();
  first.advance();
  assert.equal(
    first.session.get(FILTERS_KEY),
    '{"radarr":"q=Tenet","sonarr":"codec=hevc&q=Dark"}',
  );

  // A reload on Movies: the route wins for movies, TV keeps its filters.
  const reload = appNavigation({
    hash: first.hash(),
    session: {
      [FILTERS_KEY]: '{"radarr":"q=old","sonarr":"codec=hevc&q=Dark"}',
    },
    status: visible,
  });
  assert.deepEqual(plain(reload.current.filters), {
    radarr: "q=Tenet",
    sonarr: "codec=hevc&q=Dark",
  });
  reload.current.openLibrary("sonarr", { instance: "" });
  reload.render();
  assert.equal(reload.hash(), "#/series?codec=hevc&q=Dark");

  // Every view other than a library restores both; broken values are empty.
  const dashboard = appNavigation({
    session: filters("q=a", "q=b"),
    status: visible,
  });
  assert.deepEqual(plain(dashboard.current.filters), {
    radarr: "q=a",
    sonarr: "q=b",
  });
  // Blocked session storage starts empty and keeps working.
  const blocked = appNavigation({ hash: "#/series?q=x", blocked: true });
  assert.deepEqual(plain(blocked.current.filters), {
    radarr: "",
    sonarr: "q=x",
  });
  blocked.current.openLibrary("radarr", { query: "q=y" });
  blocked.render();
  assert.equal(blocked.hash(), "#/movies?q=y");
  for (const value of ["{", "null", "[]", '{"radarr":1,"sonarr":["x"]}'])
    assert.deepEqual(
      plain(
        appNavigation({ session: { [FILTERS_KEY]: value } }).current.filters,
      ),
      { radarr: "", sonarr: "" },
      value,
    );
});

test("leaving settings for settings starts the page again", async () => {
  const h = appNavigation({ status: visible, answers: [false, true] });
  h.current.openSettings("appearance");
  h.render();
  const mount = h.current.settingsMount;
  // Section links keep the page (they ask through the section guard).
  h.current.openSettings("widgets");
  h.render();
  h.current.openSettings("system", "log");
  h.render();
  assert.equal(h.current.settingsMount, mount);
  // Open settings (an empty library) asks to leave and opens Services
  // afresh, as 1.7.0 closed and reopened the page: also on the same
  // section, and also without unsaved changes.
  assert.equal(await h.current.canLeaveRules(), true);
  h.current.openSettings();
  h.render();
  assert.equal(h.current.settingsMount, mount + 1);
  assert.equal(h.current.settingsSection, "connections");
  h.current.setSettingsDirty(true);
  h.render();
  assert.equal(await h.current.canLeaveRules(), false);
  assert.equal(h.current.settingsMount, mount + 1);
  assert.equal(await h.current.canLeaveRules(), true);
  h.current.openSettings();
  h.render();
  assert.equal(h.current.settingsMount, mount + 2);
  assert.deepEqual(h.confirms, [
    "Discard unsaved settings changes?",
    "Discard unsaved settings changes?",
  ]);
  // Only once: the next section change keeps the page.
  h.current.setSettingsDirty(false);
  h.current.openSettings("system");
  h.render();
  assert.equal(h.current.settingsMount, mount + 2);
  // An allowed leave to another view does not carry over to a later visit.
  assert.equal(await h.current.canLeaveRules(), true);
  h.current.openDashboard();
  h.render();
  h.current.openSettings();
  h.render();
  h.current.openSettings("system");
  h.render();
  assert.equal(h.current.settingsMount, mount + 2);
  assert.match(
    squash(src("components/AppShell.tsx")),
    /<SettingsPage key=\{settingsMount\}/,
  );
});

// One link target of every kind.
const linkTargets = [
  { view: "statistics" },
  { view: "library", service: "radarr", instance: "radarr-4k" },
  { view: "library", service: "radarr", instance: "" },
  { view: "library", service: "sonarr", instance: "sonarr-4k" },
  { view: "library", service: "sonarr", query: "hdr=Dolby+Vision" },
  { view: "mux" },
  { view: "mux", q: "Movie (2020).mkv" },
  { view: "mux", q: "  " },
  { view: "disks" },
  { view: "files", q: "/mnt/disk1" },
  { view: "settings", section: "connections" },
  { view: "settings", section: "connections", tab: "mux" },
  { view: "settings", section: "appearance" },
  { view: "settings", section: "system", tab: "log" },
];

test("a link asks like Back and Forward, once", async () => {
  // Out of dirty settings, a link asks the leave question once; a link to
  // another section asks the section guard once with that section; the
  // shown section asks nothing and keeps the page with its draft.
  for (const target of linkTargets) {
    const name = JSON.stringify(target);
    const h = appNavigation({ status: visible, answers: [true] });
    const asked = [];
    h.current.setSectionGuard(async (next) => {
      asked.push(next);
      return true;
    });
    h.current.openSettings("appearance");
    h.render();
    h.current.setSettingsDirty(true);
    h.render();
    const mount = h.current.settingsMount,
      before = pushes(h).length,
      href = h.current.linkHref(target);
    assert.equal(await h.current.openLink(target), true, name);
    await h.settle();
    if (target.view === "settings") {
      assert.deepEqual(h.confirms, [], name);
      assert.deepEqual(
        asked,
        target.section === "appearance" ? [] : [target.section],
        name,
      );
      assert.equal(h.current.settingsMount, mount, name);
    } else {
      assert.deepEqual(h.confirms, ["Discard unsaved settings changes?"], name);
      assert.deepEqual(asked, [], name);
      assert.equal(h.current.settingsOpen, false, name);
    }
    assert.equal(h.hash(), href, name);
    assert.equal(
      pushes(h).length,
      before + (href === "#/settings/appearance" ? 0 : 1),
      name,
    );
  }
  // Without open settings nothing asks, also with a dirty state left over.
  for (const target of linkTargets) {
    const name = JSON.stringify(target);
    const h = appNavigation({ status: visible });
    h.current.setSectionGuard(async (next) =>
      assert.fail("section guard asked for " + next),
    );
    h.current.setSettingsDirty(true);
    h.render();
    assert.equal(await h.current.openLink(target), true, name);
    await h.settle();
    assert.deepEqual(h.confirms, [], name);
    assert.equal(h.hash(), h.current.linkHref(target), name);
  }
});

test("a declined link changes nothing", async () => {
  for (const target of linkTargets) {
    const name = JSON.stringify(target);
    // The shown section never asks.
    if (target.view === "settings" && target.section === "appearance") continue;
    const h = appNavigation({ status: visible, answers: [false] });
    h.current.setSectionGuard(async () => false);
    h.current.openSettings("appearance");
    h.render();
    h.current.setSettingsDirty(true);
    h.render();
    h.advance();
    const state = () =>
      plain({
        hash: h.hash(),
        entries: h.win.entries(),
        log: h.log.length,
        writes: h.writes.length,
        localWrites: h.localWrites.length,
        route: h.current.route,
        revision: h.current.revision,
        libraryEntry: h.current.libraryEntry,
        settingsMount: h.current.settingsMount,
        fromHistory: h.current.fromHistory,
      });
    const before = state();
    assert.equal(await h.current.openLink(target), false, name);
    await h.settle();
    h.advance();
    assert.deepEqual(state(), before, name);
    assert.equal(h.confirms.length, target.view === "settings" ? 0 : 1, name);
  }
});

test("a link href is the route of its action", async () => {
  for (const from of [
    "#/movies?q=a&resolution=1080p&page=3&sort=year&dir=desc",
    "#/series?instance=sonarr-4k",
    "#/tools/mux?q=x&sort=size&dir=asc&page=2",
    "#/tools/placement?status=split",
    "#/settings/system/log?level=error",
    "#/dashboard",
  ])
    for (const target of linkTargets) {
      const name = from + " " + JSON.stringify(target);
      const h = appNavigation({
        hash: from,
        status: visible,
        session: filters("codec=hevc", "instance=sonarr&q=b"),
        local: {
          "scopearr-series-sort": '{"field":"size","direction":"desc"}',
        },
      });
      const href = h.current.linkHref(target);
      assert.equal(await h.current.openLink(target), true, name);
      await h.settle();
      assert.equal(formatRoute(h.current.route), href, name);
      assert.equal(h.hash(), href, name);
    }
  // The rules: the open tool keeps its parameters and another tool starts
  // without them; a search replaces them. A library keeps its filters and
  // sort, sets or clears the instance and starts on page 1; a query
  // replaces its filters.
  const h = appNavigation({
    hash: "#/tools/mux?q=x&page=2",
    status: visible,
    session: filters("q=a&instance=radarr-4k", ""),
    local: { "scopearr-series-sort": '{"field":"size","direction":"desc"}' },
  });
  const log = [...h.log];
  for (const [target, href] of [
    [{ view: "mux" }, "#/tools/mux?q=x&page=2"],
    [{ view: "mux", q: " " }, "#/tools/mux?q=x&page=2"],
    [{ view: "mux", q: "a b" }, "#/tools/mux?q=a+b"],
    [{ view: "disks" }, "#/tools/placement"],
    [{ view: "files", q: "/mnt" }, "#/tools/files?q=%2Fmnt"],
    [{ view: "library", service: "radarr", instance: "" }, "#/movies?q=a"],
    [
      { view: "library", service: "radarr", instance: "radarr" },
      "#/movies?q=a&instance=radarr",
    ],
    [
      { view: "library", service: "sonarr", query: "codec=hevc" },
      "#/series?codec=hevc&sort=size&dir=desc",
    ],
    [
      { view: "settings", section: "system", tab: "log" },
      "#/settings/system/log",
    ],
    [{ view: "settings", section: "bogus" }, "#/settings/connections"],
    [{ view: "statistics" }, "#/dashboard"],
  ])
    assert.equal(h.current.linkHref(target), href, JSON.stringify(target));
  // An href changes nothing.
  h.advance();
  assert.deepEqual(h.log, log);
  assert.equal(h.current.view, "mux");
});

test("library entries count links and actions only", async () => {
  const h = appNavigation({ hash: "#/movies?q=a", status: visible });
  assert.equal(h.current.libraryEntry, 0);
  const open = async (target) => {
    assert.equal(await h.current.openLink(target), true);
    await h.settle();
  };
  await open({ view: "library", service: "sonarr", instance: "" });
  assert.equal(h.current.libraryEntry, 1);
  // A link to the shown library starts it again, too.
  await open({ view: "library", service: "sonarr", instance: "" });
  assert.equal(h.current.libraryEntry, 2);
  await open({ view: "library", service: "radarr", query: "codec=hevc" });
  assert.equal(h.current.libraryEntry, 3);
  h.current.openLibrary("sonarr", { instance: "" });
  h.render();
  assert.equal(h.current.libraryEntry, 4);
  // Filters, page, sort and pruning replace; they are no entry.
  h.current.setFilters((current) => ({ ...current, sonarr: "q=x" }));
  h.render();
  h.current.setPage(2);
  h.render();
  h.current.sortLibrary("year");
  h.render();
  h.current.pruneCustomFilters(new Set());
  h.render();
  h.advance();
  assert.equal(h.hash(), "#/series?q=x&sort=year&dir=asc");
  assert.equal(h.current.libraryEntry, 4);
  // Other links and actions.
  await open({ view: "statistics" });
  await open({ view: "mux" });
  h.current.openSettings("system");
  h.render();
  assert.equal(h.current.libraryEntry, 4);
  // An accepted Back step onto a library and a typed library hash.
  await h.back();
  await h.back();
  await h.back();
  assert.equal(h.hash(), "#/series?q=x&sort=year&dir=asc");
  assert.equal(h.current.view, "library");
  await h.type("#/movies?q=b");
  assert.equal(h.current.view, "library");
  assert.equal(h.current.libraryEntry, 4);
});

test("the navigation offers no raw state", () => {
  const h = appNavigation({ status: visible });
  assert.deepEqual(Object.keys(h.current).sort(), [
    "canLeaveRules",
    "file",
    "filters",
    "fromHistory",
    "libraryEntry",
    "linkHref",
    "movieSort",
    "openDashboard",
    "openFiles",
    "openLibrary",
    "openLink",
    "openMuxFile",
    "openSettings",
    "openTool",
    "page",
    "pruneCustomFilters",
    "replaceRoute",
    "revision",
    "route",
    "service",
    "setFile",
    "setFilters",
    "setPage",
    "setSectionGuard",
    "setSettingsDirty",
    "settingsMount",
    "settingsOpen",
    "settingsSection",
    "sortLibrary",
    "view",
  ]);
  for (const key of ["canChangeSection", "sorts", "placementFileSearch"])
    assert.ok(!(key in h.current), key);
  const type = between(
    src("hooks/useAppNavigation.ts"),
    "export type AppNavigation = {",
    "\n};",
  );
  assert.doesNotMatch(type, /\b(canChangeSection|sorts|placementFileSearch)\b/);
  assert.match(type, /\bopenLink\(target: NavTarget\): Promise<boolean>;/);
  assert.match(type, /\blinkHref\(target: NavTarget\): string;/);
  assert.match(type, /\blibraryEntry: number;/);
});

test("entries without an index start like a page load", async () => {
  const h = appNavigation({
    status: visible,
    session: filters("q=stored", "codec=hevc"),
    local: { "scopearr-film-sort": '{"field":"year","direction":"asc"}' },
  });
  h.current.openSettings("appearance");
  h.render();
  // A typed library hash without a sort: the stored sort; filters and page
  // from the route, and the other library keeps its own.
  await h.type("#/movies?q=x&page=2");
  assert.equal(h.current.fromHistory, false);
  assert.equal(h.current.revision, 1);
  assert.deepEqual(plain(h.current.movieSort), {
    field: "year",
    direction: "asc",
  });
  assert.deepEqual(plain(h.current.filters), {
    radarr: "q=x",
    sonarr: "codec=hevc",
  });
  assert.equal(h.current.page, 2);
  h.advance();
  assert.equal(h.hash(), "#/movies?q=x&page=2&sort=year&dir=asc");
  // A sort in the route wins and is stored; missing filters are none.
  await h.type("#/movies?sort=size&dir=desc");
  assert.deepEqual(plain(h.current.movieSort), {
    field: "size",
    direction: "desc",
  });
  assert.equal(
    h.preferences.get("scopearr-film-sort"),
    '{"field":"size","direction":"desc"}',
  );
  assert.equal(h.current.filters.radarr, "");
  assert.equal(h.current.page, 1);
  // Tool pages fill the gaps of a typed route from storage; so do links
  // that set location.hash, such as Show in log.
  await h.type("#/tools/mux?q=a");
  assert.equal(h.current.view, "mux");
  assert.equal(h.current.fromHistory, false);
  await h.openLog({ level: ["error"] });
  assert.equal(h.current.settingsSection, "system");
  assert.equal(h.current.fromHistory, false);
  // Back and Forward onto entries with an index stay history steps.
  await h.back();
  assert.equal(h.current.view, "mux");
  assert.equal(h.current.fromHistory, true);
  await h.back();
  await h.back();
  assert.equal(h.current.fromHistory, true);
  assert.deepEqual(plain(h.current.movieSort), {
    field: "year",
    direction: "asc",
  });
  assert.equal(h.current.filters.radarr, "q=x");
  assert.equal(h.current.page, 2);
  await h.forward();
  assert.equal(h.current.fromHistory, true);
  assert.deepEqual(plain(h.current.movieSort), {
    field: "size",
    direction: "desc",
  });
});

// Opens the Muxing page hook on the route the navigation shows, over the
// navigation's storage, as AppShell hands it the route.
function openMuxPage(h) {
  const runtime = createHookRuntime();
  const { useToolPageState } = loadSource("hooks/useToolPageState.ts", {
    modules: {
      "preact/hooks": runtime.hooks,
      "../browser-storage": h.storage,
      "../components/SortableHeader": loadSource(
        "components/SortableHeader.tsx",
        { modules: { "../ui": { ICON: {} }, "../i18n": { t: (key) => key } } },
      ),
      "../tool-route": loadSource("tool-route.ts", {
        modules: { "./browser-storage": h.storage },
      }),
    },
  });
  return runtime.settle(() =>
    useToolPageState(
      "mux",
      { statuses: ["ready"], sorts: ["size"] },
      { resetPageOnSort: false },
      {
        query: h.current.route.query,
        fromHistory: h.current.fromHistory,
        replace() {},
      },
    ),
  );
}

test("a hash typed during a question starts like a page load", async () => {
  // Leaving dirty settings with Back asks; while the question is open the
  // user types a hash, then discards. The answer applies to the typed
  // entry, which starts like a page load: the Muxing page keeps its stored
  // filters and sort.
  const stored = {
    "scopearr-mux-filters":
      '{"statuses":["ready"],"targets":[],"kinds":[],"q":"stored"}',
    "scopearr-mux-sort": "size:desc",
  };
  let discard;
  const typed = appNavigation({
    status: visible,
    local: stored,
    answers: [new Promise((resolve) => (discard = resolve))],
  });
  typed.current.openSettings("appearance");
  typed.render();
  typed.current.setSettingsDirty(true);
  typed.render();
  await typed.back();
  assert.deepEqual(typed.confirms, ["Discard unsaved settings changes?"]);
  assert.equal(typed.current.settingsOpen, true);
  await typed.type("#/tools/mux");
  discard(true);
  await typed.settle();
  assert.equal(typed.current.view, "mux");
  assert.equal(typed.current.fromHistory, false);
  const mux = openMuxPage(typed);
  assert.deepEqual(plain(mux.sort), { field: "size", direction: "desc" });
  assert.equal(mux.filters.q, "stored");
  for (const [key, value] of Object.entries(stored))
    assert.equal(typed.preferences.get(key), value, key);
});

test("a step back during a question is a history step", async () => {
  // A typed hash asks, and while the question is open the user goes back
  // to an entry with an index. The answer applies to that history step,
  // which takes its sort from the route, not from storage.
  let leave;
  const back = appNavigation({
    hash: "#/movies",
    status: visible,
    answers: [new Promise((resolve) => (leave = resolve))],
  });
  back.current.openLibrary("radarr", { query: "q=x" });
  back.render();
  back.current.sortLibrary("year");
  back.render();
  back.advance();
  assert.equal(
    back.preferences.get("scopearr-film-sort"),
    '{"field":"year","direction":"asc"}',
  );
  back.current.openSettings("appearance");
  back.render();
  back.current.setSettingsDirty(true);
  back.render();
  await back.type("#/tools/mux");
  assert.equal(back.confirms.length, 1);
  await back.back();
  await back.back();
  await back.back();
  assert.equal(back.confirms.length, 1, "one question at a time");
  leave(true);
  await back.settle();
  back.advance();
  assert.equal(back.current.view, "library");
  assert.equal(back.current.fromHistory, true);
  assert.equal(back.current.route.sort, null);
  assert.equal(back.hash(), "#/movies");
  assert.equal(
    back.preferences.get("scopearr-film-sort"),
    '{"field":"title","direction":"asc"}',
  );
});

test("a link to the shown route takes and gives no freshness", async () => {
  // It starts the shown route again by its own rule, not as the step
  // before it arrived.
  const link = appNavigation({ status: visible });
  await link.type("#/settings/system/log?level=error");
  assert.equal(link.current.fromHistory, false);
  const revision = link.current.revision;
  await link.openLog({ level: ["error"] });
  assert.equal(link.current.revision, revision + 1);
  assert.equal(link.current.fromHistory, true);

  // One that arrives during a question (Show in log on the typed entry) is
  // dropped and leaves the entry the answer applies to as it arrived.
  const asked = appNavigation({ status: visible });
  let answer;
  asked.current.setSectionGuard(
    () => new Promise((resolve) => (answer = resolve)),
  );
  asked.current.openSettings("appearance");
  asked.render();
  await asked.type("#/settings/system/log?level=error");
  assert.equal(typeof answer, "function");
  assert.equal(asked.current.settingsSection, "appearance");
  await asked.openLog({ level: ["error"] });
  answer(true);
  await asked.settle();
  assert.equal(asked.current.settingsSection, "system");
  assert.equal(asked.hash(), "#/settings/system/log?level=error");
  assert.equal(asked.current.fromHistory, false);
});

test("a blank search opens the tool like its link", () => {
  const h = appNavigation({ status: visible });
  h.current.openMuxFile("  ");
  h.render();
  assert.equal(h.hash(), "#/tools/mux");
  // On the open tool it keeps the tool's parameters, like the tool's link,
  // and starts nothing again.
  h.current.replaceRoute({ query: "q=a&page=2" });
  h.render();
  h.advance();
  const revision = h.current.revision;
  h.current.openMuxFile("");
  h.render();
  h.advance();
  assert.equal(h.hash(), "#/tools/mux?q=a&page=2");
  assert.equal(h.current.revision, revision);
  // Placement → Files with a blank path opens Files like its link.
  h.current.openFiles(" ");
  h.render();
  assert.equal(h.hash(), "#/tools/files");
  assert.deepEqual(pushes(h), [
    ["push", "#/tools/mux"],
    ["push", "#/tools/files"],
  ]);
});

// Runs the real useLibraryState over a fake navigation with the shared hook
// runtime; its list query is stubbed, so a test hands it results.
function libraryState(overrides = {}) {
  const runtime = createHookRuntime();
  let query;
  const navigation = {
    view: "library",
    service: "radarr",
    filters: { radarr: "", sonarr: "" },
    setFilters() {},
    page: 1,
    setPage() {},
    movieSort: { field: "title", direction: "asc" },
    settingsOpen: false,
    libraryEntry: 0,
    links: [],
    answer: true,
    async openLink(target) {
      navigation.links.push(plain(target));
      return navigation.answer;
    },
    ...overrides,
  };
  const { useLibraryState } = loadSource("hooks/useLibraryState.ts", {
    modules: {
      "preact/hooks": runtime.hooks,
      "./useFileSelection": loadSource("hooks/useFileSelection.ts", {
        modules: {
          "preact/hooks": runtime.hooks,
          "../file-selection": loadSource("file-selection.ts"),
        },
      }),
      "../instances": loadSource("instances.ts"),
      "../confirmation": {},
      "../i18n": { t: (key) => key, getLocale: () => "en" },
      "../notifications": { notify() {} },
      "../api": { api: () => new Promise(() => {}), ApiError: class {} },
      "../dashboard-filter": loadSource("dashboard-filter.ts"),
      "../library-filters": libraryFilters,
      "./useLibraryQuery": {
        useFacets() {},
        useLibraryQuery(args) {
          query = args;
        },
      },
      "../preset-query": loadSource("preset-query.ts", {
        modules: { "./languages.ts": languages },
      }),
      "../ui": {
        defaultColumnOrder: [],
        defaultColumns: [],
        emptyResults: {
          files: [],
          total: 0,
          displayTotal: 0,
          page: 1,
          pageSize: 100,
        },
      },
    },
  });
  const data = {
    settings: null,
    presets: [],
    loadPresets: async () => {},
    customRevision: 0,
  };
  const h = {
    navigation,
    current: undefined,
    render() {
      runtime.flush();
      h.current = runtime.settle(
        () => useLibraryState({ status: {}, navigation, data }),
        { max: 10 },
      );
      return h.current;
    },
    results(files) {
      query.setResults({
        files,
        total: files.length,
        displayTotal: files.length,
        page: 1,
        pageSize: 100,
      });
      return h.render();
    },
  };
  h.render();
  return h;
}
const libraryFile = {
  service: "radarr",
  id: 1,
  mediaId: 1,
  filename: "A.mkv",
  title: "A",
};

test("a library entry clears the selection and closes the filter drawer", () => {
  const h = libraryState();
  assert.ok(!("openLibrary" in h.current));
  h.results([libraryFile]);
  const pick = () => {
    h.current.selection.toggle([libraryFile], true);
    h.current.openDrawer("filters");
    h.render();
    assert.equal(h.current.selection.keys.length, 1);
    assert.equal(h.current.drawer, "filters");
  };
  pick();
  // Renders without a new entry keep both.
  h.render();
  h.render();
  assert.equal(h.current.selection.keys.length, 1);
  assert.equal(h.current.drawer, "filters");
  // A new entry (a library link or action) starts the library again, once.
  h.navigation.libraryEntry = 1;
  h.render();
  assert.deepEqual(plain(h.current.selection.keys), []);
  assert.equal(h.current.drawer, null);
  pick();
  h.render();
  assert.equal(h.current.selection.keys.length, 1);
  assert.equal(h.current.drawer, "filters");
  h.navigation.libraryEntry = 2;
  h.render();
  assert.deepEqual(plain(h.current.selection.keys), []);
  assert.equal(h.current.drawer, null);
});

test("dashboard filters open the library through a link", async () => {
  const h = libraryState({ view: "statistics" });
  h.results([libraryFile]);
  h.current.applyPreset({
    id: 7,
    service: "sonarr",
    name: "HEVC",
    query: "codec=hevc",
  });
  h.render();
  assert.equal(h.current.presetIds.sonarr, 7);
  // Declined: nothing changes.
  h.navigation.answer = false;
  await h.current.openDashboardFilter("codec", "hevc", "sonarr");
  h.render();
  assert.deepEqual(h.navigation.links, [
    { view: "library", service: "sonarr", query: "codec=hevc" },
  ]);
  assert.equal(h.current.presetIds.sonarr, 7);
  assert.equal(h.current.results.files.length, 1);
  // Allowed: the library opens on the filter, without a chosen preset and
  // without the old results.
  h.navigation.answer = true;
  await h.current.openDashboardFilter("codec", "hevc", "sonarr");
  h.render();
  assert.equal(h.navigation.links.length, 2);
  assert.equal(h.current.presetIds.sonarr, undefined);
  assert.deepEqual(plain(h.current.results.files), []);
});

test("every push asks before it leaves open settings", () => {
  // In-app links (openLink) ask like Back and Forward themselves. Each other
  // named action call in the shell and the library runs after
  // canLeaveRules() in the same block. Actions are never handed on
  // unguarded.
  const calls =
    /\b(openDashboard|openLibrary|openTool|openFiles|openMuxFile|openSettings|openLink)\(/g;
  for (const path of [
    "components/AppShell.tsx",
    "components/LibraryPage.tsx",
    "hooks/useLibraryState.ts",
  ]) {
    const code = src(path).replace(/"[^"\n]*"/g, (text) =>
      "_".repeat(text.length),
    );
    assert.doesNotMatch(
      code,
      /=\{(openDashboard|openLibrary|openTool|openFiles|openMuxFile|openSettings)\}/,
      path,
    );
    let checked = 0;
    for (const match of code.matchAll(calls)) {
      const line = code.slice(
        code.lastIndexOf("\n", match.index) + 1,
        code.indexOf("\n", match.index),
      );
      checked += 1;
      // Whether canLeaveRules() runs before the call in its block.
      const guard = code.lastIndexOf("canLeaveRules()", match.index);
      let depth = 0,
        guarded = guard >= 0;
      for (const char of guarded ? code.slice(guard, match.index) : "") {
        depth += char === "{" ? 1 : char === "}" ? -1 : 0;
        if (depth < 0) guarded = false;
      }
      // openLink asks itself; after canLeaveRules() it would ask twice.
      assert.equal(guarded, match[1] !== "openLink", path + ": " + line.trim());
    }
    assert.ok(checked > 0, path);
  }
  // The frame gets openLink only: the sidebar, the tab bar and the phone
  // brand open their targets through it, and their links only on a plain
  // click (NavLink, nav-link.ts). It never gets a named action.
  const shell = squash(src("components/AppShell.tsx"));
  for (const part of ["<Sidebar ", "<TabBar "]) {
    const frame = between(shell, part, "/>");
    assert.match(frame, /\bopen=\{openLink\}/, part);
    assert.match(frame, /\bhrefOf=\{linkHref\}/, part);
  }
  const topbar = between(shell, "<Topbar ", "/>");
  assert.match(topbar, /\bhomeHref=\{linkHref\(HOME\)\}/);
  assert.match(topbar, /\bopenHome=\{\(\) => void openLink\(HOME\)\}/);
  assert.match(shell, /const HOME: NavTarget = \{ view: "statistics" \};/);
  for (const part of ["<Sidebar ", "<Topbar ", "<TabBar "])
    assert.doesNotMatch(
      between(shell, part, "/>"),
      /\bopen(Dashboard|Library|Tool|Files|MuxFile|Settings)\b/,
      part,
    );
  const frame = squash(
    readSources([
      "components/frame/Sidebar.tsx",
      "components/frame/SidebarFlyout.tsx",
      "components/frame/TabBar.tsx",
      "components/frame/Topbar.tsx",
    ]),
  );
  assert.doesNotMatch(frame, /\bopen(Dashboard|Library|Tool|Files|MuxFile)\(/);
  assert.match(
    src("components/frame/NavLink.tsx"),
    /onClick=\{\(event\) => followLink\(event, open\)\}/,
  );
  // Brand (sidebar and phone topbar), the entries and sub-entries of the
  // sidebar and its flyout, and the tab bar's tabs and Tools menu: all
  // NavLinks with their href.
  assert.equal(
    (frame.match(/<NavLink\b/g) || []).length,
    (frame.match(/<NavLink\b[^>]*?\bhref=\{/g) || []).length,
  );
});

test("pages navigate through named actions", () => {
  const pages = readSources([
    "components/AppShell.tsx",
    "components/LibraryPage.tsx",
    "hooks/useLibraryState.ts",
  ]);
  assert.doesNotMatch(
    pages,
    /\bset(View|Service|SettingsSection|PlacementFileSearch)\(/,
  );
  // The library sort lives in the navigation; settings tabs are routes.
  const keys =
    /scopearr-(filecheck-filters|filecheck-page|mux-filters|service-settings|film-sort|series-sort)/;
  assert.doesNotMatch(pages, keys);
  assert.doesNotMatch(pages, /writeSessionPreference|initialMovieSort/);
  const navigation = src("hooks/useAppNavigation.ts");
  for (const key of ["film-sort", "series-sort"])
    assert.match(navigation, new RegExp(`"scopearr-${key}"`), key);
  // Tool filters, sort and page are written only by the tool page hook; the
  // navigation hands searches on as routes.
  const tools = src("hooks/useToolPageState.ts");
  for (const part of ["filters", "sort", "page"])
    assert.match(
      tools,
      new RegExp(
        `write(Session)?Preference\\(\\s*\`scopearr-\\$\\{tool\\}-${part}\``,
      ),
      part,
    );
  const handoff = allSources()
    .replace(tools, "")
    .match(
      /scopearr-(mux|placement|filecheck|\$\{tool\})-(filters|sort|page)\b/,
    );
  assert.equal(handoff?.[0], undefined);
  // Only the route history touches window.history; the navigation reads no
  // location and keeps no scroll position.
  const routing = src("route-history.ts");
  assert.match(routing, /history\.go\(/);
  assert.doesNotMatch(
    allSources().replace(routing, ""),
    /\bhistory\.(pushState|replaceState|go|back|forward|state|scrollRestoration)\b/,
  );
  assert.doesNotMatch(
    readSources([
      "hooks/useAppNavigation.ts",
      "components/AppShell.tsx",
      "components/Library.tsx",
    ]),
    /\bhistory\.|location\.hash|\blibraryScroll\b|scrollY/,
  );
});

// The dialog route (Phase 5d, E17, R-H): File & metadata mirrors its file
// into the library route with setFile, always as a replace, so opening,
// paging and closing add no history entry. A link with a file (quick
// search) is one push; Back after it leaves the library as without one.
test("opening and paging files adds no history entry", async () => {
  const h = appNavigation({ hash: "#/movies?q=a", status: visible });
  assert.equal(h.current.file, "");
  h.current.setFile("radarr:1");
  h.render();
  h.current.setFile("radarr:2");
  h.render();
  h.current.setPage(2);
  h.render();
  h.current.setFile("radarr:51");
  h.render();
  h.advance();
  assert.equal(h.current.file, "radarr:51");
  assert.deepEqual(plain(h.current.route), {
    view: "library",
    service: "radarr",
    filters: "q=a",
    page: 2,
    sort: null,
    file: "radarr:51",
  });
  h.current.setFile("");
  h.render();
  h.advance();
  assert.deepEqual(pushes(h), []);
  assert.deepEqual(h.win.entries(), ["#/movies?q=a&page=2"]);
  assert.ok(!("file" in h.current.route));
  // The file never becomes a filter, a stored value or a session key.
  assert.deepEqual(plain(h.current.filters), { radarr: "q=a", sonarr: "" });
  // (The route history's pending replace holds the address itself.)
  const stored = (writes) =>
    writes.filter(
      ([key, value]) =>
        key !== "scopearr-pending-route" && /file|radarr(:|%3A)/.test(value),
    );
  assert.deepEqual(stored(h.writes), []);
  assert.deepEqual(stored(h.localWrites), []);

  // A start with a file keeps it in the route until the dialog closes.
  const start = appNavigation({
    hash: "#/movies?q=Arrival&file=radarr%3A42",
    status: visible,
  });
  assert.equal(start.current.file, "radarr:42");
  assert.equal(start.hash(), "#/movies?q=Arrival&file=radarr%3A42");

  // A link with a file pushes one entry; closing replaces it; Back leaves
  // the library as it would without a file.
  for (const file of ["radarr-4k:7", undefined]) {
    const link = appNavigation({ hash: "#/dashboard", status: visible });
    const target = { view: "library", service: "radarr", query: "q=Arrival" };
    if (file) target.file = file;
    assert.equal(
      link.current.linkHref(target),
      "#/movies?q=Arrival" + (file ? "&file=radarr-4k%3A7" : ""),
    );
    assert.equal(await link.current.openLink(target), true);
    await link.settle();
    assert.equal(link.current.file, file ?? "");
    link.current.setFile("");
    link.render();
    link.advance();
    assert.deepEqual(link.win.entries(), ["#/dashboard", "#/movies?q=Arrival"]);
    assert.equal(pushes(link).length, 1);
    await link.back();
    assert.equal(link.current.view, "statistics", String(file));
    assert.equal(link.current.file, "");
    // Forward comes back to the list without the dialog.
    await link.forward();
    assert.equal(link.current.view, "library");
    assert.equal(link.current.file, "");
  }

  // Another action leaves the file behind.
  const left = appNavigation({
    hash: "#/movies?q=a&file=radarr%3A1",
    status: visible,
  });
  left.current.openTool("mux");
  left.render();
  left.current.openLibrary("radarr", { instance: "" });
  left.render();
  assert.equal(left.current.file, "");
  assert.equal(left.hash(), "#/movies?q=a");
});
