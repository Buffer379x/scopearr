import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./helpers/component-harness.mjs";
import { fakeWindow } from "./helpers/fake-window.mjs";
import { allSources, readSources, src } from "./helpers/sources.mjs";

// Values cross a VM realm; compare their JSON shape.
const plain = (value) => JSON.parse(JSON.stringify(value));
const languages = await import("../src/languages.ts");
const FILTERS_KEY = "scopearr-library-filters";

// Runs the real hook with the real browser-storage, router and route-history
// modules over a fake sessionStorage, localStorage and window (history stack,
// location.hash, fake timers). Effects run after each render when their
// dependencies change; state set inside effects renders again, as Preact
// would. Back, Forward and typed hashes settle their asynchronous guards.
function appNavigation({
  hash = "",
  session: seeded = {},
  blocked = false,
  local = {},
  status = {},
  answers = [],
} = {}) {
  const state = [],
    effects = [],
    refs = [],
    confirms = [],
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
  });
  const blockedStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  const sessionStorage = blocked ? blockedStorage : storage(session, writes),
    localStorage = storage(preferences, localWrites);
  let cursor = 0,
    changed = false;
  const hooks = {
    useState(initial) {
      const slot = cursor++;
      if (!(slot in state))
        state[slot] = typeof initial === "function" ? initial() : initial;
      return [
        state[slot],
        (next) => {
          const value = typeof next === "function" ? next(state[slot]) : next;
          if (value !== state[slot]) changed = true;
          state[slot] = value;
        },
      ];
    },
    useRef(initial) {
      const slot = cursor++;
      if (!(slot in refs)) refs[slot] = { current: initial };
      return refs[slot];
    },
    useEffect(effect, deps) {
      const slot = cursor++;
      const old = effects[slot];
      if (!old || !deps || deps.some((value, i) => value !== old.deps[i]))
        effects[slot] = { deps, pending: effect, cleanup: old?.cleanup };
    },
  };
  const win = fakeWindow({ hash });
  const window = Object.assign(win.window, { scrollY: 0 });
  const browserStorage = loadSource("browser-storage.ts", {
      browser: { sessionStorage, localStorage },
    }),
    eventLog = loadSource("event-log.ts");
  const router = loadSource("router.ts", {
    modules: {
      "./browser-storage": browserStorage,
      "./event-log": eventLog,
    },
  });
  const { useAppNavigation } = loadSource("hooks/useAppNavigation.ts", {
    browser: { window },
    modules: {
      "preact/hooks": hooks,
      "../browser-storage": browserStorage,
      "../components/SortableHeader": loadSource(
        "components/SortableHeader.tsx",
        { modules: { "../ui": { ICON: {} }, "../i18n": { t: (key) => key } } },
      ),
      "../event-log": eventLog,
      "../router": router,
      "../route-history": loadSource("route-history.ts", {
        modules: { "./router": router },
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
  const runEffects = () => {
    for (const entry of effects)
      if (entry?.pending) {
        entry.cleanup?.();
        entry.cleanup = entry.pending();
        entry.pending = undefined;
      }
  };
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
    win,
    log: win.log,
    hash: () => window.location.hash,
    render() {
      runEffects();
      for (let pass = 0; pass < 10; pass++) {
        changed = false;
        cursor = 0;
        h.current = useAppNavigation(h.status);
        runEffects();
        if (!changed) return h.current;
      }
      throw new Error("render did not settle");
    },
    // A render whose effects wait for the next paint; like Preact, the next
    // render runs them first.
    renderBeforePaint() {
      runEffects();
      cursor = 0;
      h.current = useAppNavigation(h.status);
    },
    // Runs the debounce timers and renders.
    advance(ms = 300) {
      win.advance(ms);
      return h.render();
    },
    unmount() {
      for (const entry of effects) entry?.cleanup?.();
    },
    settle,
    back: () => (win.back(), settle()),
    forward: () => (win.forward(), settle()),
    type: (next) => (win.type(next), settle()),
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
  assert.equal(h.current.placementFileSearch, false);
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

test("the open-log event opens System when settings are closed", () => {
  const h = appNavigation({ status: visible });
  assert.equal(h.listeners("scopearr-open-log"), 1);
  h.render();
  // The listener is replaced, never doubled.
  assert.equal(h.listeners("scopearr-open-log"), 1);

  h.dispatch("scopearr-open-log");
  assert.equal(h.current.settingsOpen, true);
  assert.equal(h.current.settingsSection, "system");
  assert.equal(h.listeners("scopearr-open-log"), 1);

  // An open settings page switches itself.
  h.current.openSettings("recognition");
  h.render();
  h.dispatch("scopearr-open-log");
  assert.equal(h.current.settingsOpen, true);
  assert.equal(h.current.settingsSection, "recognition");

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
  assert.equal(await h.current.canChangeSection("system"), true);

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
  assert.equal(await h.current.canChangeSection("system"), false);
  assert.deepEqual(asked, ["system"]);
  assert.equal(h.current.settingsSection, "widgets", "asking opens nothing");

  // The page registers again on every render; the latest guard answers.
  const allowing = guard(true);
  h.current.setSectionGuard(allowing);
  h.render();
  assert.equal(await h.current.canChangeSection("custom"), true);
  assert.deepEqual(asked, ["system", "custom"]);
  assert.equal(h.current.settingsSection, "widgets");

  // An unmounting page drops only its own guard: a newer page keeps its own.
  h.current.setSectionGuard(null, declining);
  h.render();
  assert.equal(await h.current.canChangeSection("system"), true);
  assert.deepEqual(asked, ["system", "custom", "system"]);
  h.current.setSectionGuard(null, allowing);
  h.render();
  assert.equal(await h.current.canChangeSection("system"), true);
  assert.deepEqual(asked, ["system", "custom", "system"]);
  assert.deepEqual(h.confirms, []);

  // SettingsPage registers its current guard on every render and drops it on
  // unmount unless another page registered since; AppShell hands it the
  // section and the setters of the navigation.
  const page = src("components/SettingsPage.tsx");
  assert.match(
    page,
    /\n  const guard = useRef\(confirmSectionChange\);\n  guard\.current = confirmSectionChange;\n  registerSectionGuard\(confirmSectionChange\);\n/,
  );
  assert.match(
    page,
    /useEffect\(\(\) => \(\) => registerSectionGuard\(null, guard\.current\), \[\]\);/,
  );
  assert.equal(page.match(/registerSectionGuard\(/g).length, 2);
  const shell = src("components/AppShell.tsx");
  assert.match(shell, /\bsection=\{settingsSection\}/);
  assert.match(shell, /openSection=\{\(section\) => openSettings\(section\)\}/);
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
  assert.equal(h.current.placementFileSearch, true);

  h.current.openTool("disks");
  h.render();
  assert.equal(h.current.placementFileSearch, false);
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
    placementFileSearch: navigation.placementFileSearch,
    sorts: navigation.sorts,
    movieSort: navigation.movieSort,
  });

test("named actions set the same state and storage as before", () => {
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
      state: { view: "files", placementFileSearch: true },
      local: [
        [
          "scopearr-filecheck-filters",
          '{"q":"/mnt/disk1/Movies/A B","statuses":[],"targets":[],"kinds":[]}',
        ],
      ],
      session: [["scopearr-filecheck-page", "1"]],
      hash: "#/tools/files",
    },
    {
      name: "mux file",
      act: (n) => n.openMuxFile("Movie (2020).mkv"),
      state: { view: "mux" },
      local: [
        ["scopearr-mux-filters", '{"q":"Movie (2020).mkv","statuses":[]}'],
      ],
      hash: "#/tools/mux",
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
      from: "#/tools/mux",
      act: (n) => n.openSettings("connections", "mux"),
      state: { settingsOpen: true },
      session: [["scopearr-service-settings", "mux"]],
      hash: "#/settings/connections/mux",
    },
    {
      name: "appearance tab",
      act: (n) => n.openSettings("appearance", "colors"),
      state: { settingsOpen: true, settingsSection: "appearance" },
      session: [["scopearr-display-tab", "colors"]],
      hash: "#/settings/appearance/colors",
    },
    {
      name: "system tab",
      act: (n) => n.openSettings("system", "log"),
      state: { settingsOpen: true, settingsSection: "system" },
      session: [["scopearr-system-tab", "log"]],
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
      state: {
        sorts: { radarr: null, sonarr: { field: "year", direction: "asc" } },
        movieSort: { field: "year", direction: "asc" },
      },
      local: [
        ["scopearr-film-sort", '{"field":"title","direction":"asc"}'],
        ["scopearr-series-sort", '{"field":"year","direction":"asc"}'],
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
  }
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
  assert.deepEqual(plain(h.current.sorts), {
    radarr: { field: "audio", direction: "desc" },
    sonarr: null,
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
    assert.deepEqual(plain(h.current.sorts.radarr), sort);
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
  assert.deepEqual(plain(h.current.sorts), {
    radarr: null,
    sonarr: { field: "size", direction: "asc" },
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
      plain(broken.current.sorts),
      { radarr: null, sonarr: null },
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

  // A missing sort, page or filter means the default, not the storage.
  await h.type("#/movies");
  assert.deepEqual(plain(h.current.sorts.radarr), null);
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
  // Section buttons keep the page (they ask through changeSection).
  h.current.openSettings("widgets");
  h.render();
  h.current.openSettings("system", "log");
  h.render();
  assert.equal(h.current.settingsMount, mount);
  // The header Settings button asks to leave and opens Services afresh, as
  // 1.7.0 closed and reopened the page: also on the same section, and also
  // without unsaved changes.
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
    src("components/AppShell.tsx"),
    /<SettingsPage\n\s+key=\{settingsMount\}/,
  );
});

test("every push asks before it leaves open settings", () => {
  // Each named action call in the shell and the library runs after
  // canLeaveRules() in the same block; the section buttons ask through
  // changeSection. Actions are never handed on unguarded.
  const calls =
    /\b(openDashboard|openTool|openFiles|openMuxFile|openSettings|navigation\.openLibrary)\(/g;
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
      /=\{(openDashboard|openTool|openFiles|openMuxFile|openSettings)\}/,
      path,
    );
    let checked = 0;
    for (const match of code.matchAll(calls)) {
      const line = code.slice(
        code.lastIndexOf("\n", match.index) + 1,
        code.indexOf("\n", match.index),
      );
      if (/openSection=\{\(section\) => openSettings\(section\)\}/.test(line))
        continue;
      const guard = code.lastIndexOf("canLeaveRules()", match.index);
      assert.ok(guard >= 0, path + ": " + line.trim());
      let depth = 0;
      for (const char of code.slice(guard, match.index)) {
        depth += char === "{" ? 1 : char === "}" ? -1 : 0;
        assert.ok(depth >= 0, path + ": " + line.trim());
      }
      checked += 1;
    }
    assert.ok(checked > 0, path);
  }
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
  // The storage handoffs and the library sort live in the navigation.
  const keys =
    /scopearr-(filecheck-filters|filecheck-page|mux-filters|service-settings|film-sort|series-sort)/;
  assert.doesNotMatch(pages, keys);
  assert.doesNotMatch(pages, /writeSessionPreference|initialMovieSort/);
  const navigation = src("hooks/useAppNavigation.ts");
  for (const key of [
    "filecheck-filters",
    "filecheck-page",
    "mux-filters",
    "service-settings",
    "film-sort",
    "series-sort",
  ])
    assert.match(navigation, new RegExp(`"scopearr-${key}"`), key);
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
