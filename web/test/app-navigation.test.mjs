import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./helpers/component-harness.mjs";
import { readSources, src } from "./helpers/sources.mjs";

// Values cross a VM realm; compare their JSON shape.
const plain = (value) => JSON.parse(JSON.stringify(value));
const languages = await import("../src/languages.ts");

// Runs the real hook with the real browser-storage module over a fake
// sessionStorage and localStorage. Effects run after each render when their
// dependencies change; state set inside effects renders again, as Preact would.
function appNavigation({ stored, local = {}, status = {}, answers = [] } = {}) {
  const state = [],
    effects = [],
    refs = [],
    listeners = new Map(),
    confirms = [],
    session = new Map(),
    writes = [],
    preferences = new Map(Object.entries(local)),
    localWrites = [];
  if (stored !== undefined)
    session.set(
      "scopearr-navigation",
      typeof stored === "string" ? stored : JSON.stringify(stored),
    );
  const storage = (values, log) => ({
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem(key, value) {
      log.push([key, String(value)]);
      values.set(key, String(value));
    },
  });
  const sessionStorage = storage(session, writes),
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
  const window = {
    scrollY: 0,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
  };
  const browserStorage = loadSource("browser-storage.ts", {
      browser: { sessionStorage, localStorage },
    }),
    eventLog = loadSource("event-log.ts");
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
      "../router": loadSource("router.ts", {
        modules: {
          "./browser-storage": browserStorage,
          "./event-log": eventLog,
        },
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
  const h = {
    status,
    current: undefined,
    confirms,
    writes,
    session,
    localWrites,
    preferences,
    render() {
      for (let pass = 0; pass < 10; pass++) {
        changed = false;
        cursor = 0;
        h.current = useAppNavigation(h.status);
        for (const entry of effects)
          if (entry?.pending) {
            entry.cleanup?.();
            entry.cleanup = entry.pending();
            entry.pending = undefined;
          }
        if (!changed) return h.current;
      }
      throw new Error("render did not settle");
    },
    listeners: (type) => [...(listeners.get(type) || [])],
    dispatch(type) {
      for (const listener of h.listeners(type)) listener();
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

test("navigation starts from the stored session state", () => {
  const stored = {
    view: "files",
    service: "sonarr",
    page: 4,
    filters: { radarr: "resolution=1080p", sonarr: "instance=sonarr-4k" },
    settingsOpen: true,
    settingsSection: "rules",
  };
  const h = appNavigation({ stored, status: visible });
  assert.deepEqual(
    plain({
      view: h.current.view,
      service: h.current.service,
      page: h.current.page,
      filters: h.current.filters,
      settingsOpen: h.current.settingsOpen,
      settingsSection: h.current.settingsSection,
    }),
    stored,
  );
  assert.equal(h.current.placementFileSearch, false);

  const empty = appNavigation();
  assert.equal(empty.current.view, "statistics");
  assert.equal(empty.current.service, "radarr");
  assert.equal(empty.current.page, 1);
  assert.deepEqual(plain(empty.current.filters), { radarr: "", sonarr: "" });
  assert.equal(empty.current.settingsOpen, false);
  assert.equal(empty.current.settingsSection, "connections");

  const broken = appNavigation({ stored: "{", status: visible });
  assert.equal(broken.current.view, "statistics");
});

test("navigation persists the same six keys", () => {
  const h = appNavigation({ status: visible });
  const expected = ({
    view,
    service,
    page,
    filters,
    settingsOpen,
    settingsSection,
  }) =>
    JSON.stringify({
      view,
      service,
      page,
      filters,
      settingsOpen,
      settingsSection,
    });
  assert.deepEqual(h.writes, [["scopearr-navigation", expected(h.current)]]);
  assert.equal(
    h.session.get("scopearr-navigation"),
    '{"view":"statistics","service":"radarr","page":1,"filters":{"radarr":"","sonarr":""},"settingsOpen":false,"settingsSection":"connections"}',
  );

  // Unrelated renders, state outside the six keys and an action to the
  // current view do not write again.
  h.render();
  h.current.setSettingsDirty(true);
  h.render();
  h.current.openDashboard();
  h.render();
  assert.equal(h.writes.length, 1);

  h.current.openLibrary("sonarr", { query: "codec=hevc" });
  h.current.setPage(3);
  h.render();
  assert.equal(h.writes.length, 2);
  assert.equal(
    h.session.get("scopearr-navigation"),
    '{"view":"library","service":"sonarr","page":3,"filters":{"radarr":"","sonarr":"codec=hevc"},"settingsOpen":false,"settingsSection":"connections"}',
  );
  assert.equal(h.session.get("scopearr-navigation"), expected(h.current));

  h.current.openSettings("tags");
  h.render();
  assert.equal(
    h.session.get("scopearr-navigation"),
    '{"view":"library","service":"sonarr","page":3,"filters":{"radarr":"","sonarr":"codec=hevc"},"settingsOpen":true,"settingsSection":"tags"}',
  );
  h.current.openSettings("system");
  h.render();
  assert.equal(h.session.get("scopearr-navigation"), expected(h.current));
  assert.equal(h.current.settingsSection, "system");
  assert.equal(h.writes.length, 4);
});

test("the open-log event opens System when settings are closed", () => {
  const h = appNavigation({ status: visible });
  assert.equal(h.listeners("scopearr-open-log").length, 1);
  h.render();
  // The listener is replaced, never doubled.
  assert.equal(h.listeners("scopearr-open-log").length, 1);

  h.dispatch("scopearr-open-log");
  assert.equal(h.current.settingsOpen, true);
  assert.equal(h.current.settingsSection, "system");
  assert.equal(h.listeners("scopearr-open-log").length, 1);

  // An open settings page switches itself.
  h.current.openSettings("rules");
  h.render();
  h.dispatch("scopearr-open-log");
  assert.equal(h.current.settingsOpen, true);
  assert.equal(h.current.settingsSection, "rules");

  const plainOpen = appNavigation({ status: visible });
  plainOpen.current.openSettings();
  plainOpen.render();
  assert.equal(plainOpen.current.settingsOpen, true);
  assert.equal(plainOpen.current.settingsSection, "connections");
});

test("leaving dirty settings asks first", async () => {
  const h = appNavigation({ status: visible, answers: [false, true] });
  h.current.openSettings("rules");
  h.render();
  h.current.setSettingsDirty(true);
  h.render();

  assert.equal(await h.current.canLeaveRules(), false);
  h.render();
  assert.deepEqual(h.confirms, ["Discard unsaved settings changes?"]);
  assert.equal(h.current.settingsOpen, true);

  assert.equal(await h.current.canLeaveRules(), true);
  h.render();
  assert.equal(h.confirms.length, 2);
  assert.equal(h.current.settingsOpen, false);

  // Clean settings, or dirty state with settings closed, leave without asking.
  const clean = appNavigation({ status: visible });
  clean.current.openSettings();
  clean.render();
  assert.equal(await clean.current.canLeaveRules(), true);
  clean.render();
  assert.equal(clean.current.settingsOpen, false);
  clean.current.setSettingsDirty(true);
  clean.render();
  assert.equal(await clean.current.canLeaveRules(), true);
  assert.deepEqual(clean.confirms, []);
});

test("pruning drops unknown custom tags and their operator", () => {
  const h = appNavigation({
    status: visible,
    stored: {
      view: "library",
      service: "radarr",
      filters: {
        radarr: "custom=1&custom=9&customOp=and&resolution=1080p",
        sonarr: "custom=9&customOp=or&codec=hevc",
      },
    },
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
  for (const [view, status] of [
    ["disks", { ...visible, unraid: { enabled: false } }],
    ["mux", { ...visible, mux: { enabled: false } }],
    ["files", { ...visible, files: { available: false } }],
  ]) {
    const h = appNavigation({ stored: { view, service: "radarr" }, status });
    assert.equal(h.current.view, "library", view);
  }
  for (const view of ["disks", "mux", "files", "statistics"]) {
    const h = appNavigation({
      stored: { view, service: "radarr" },
      status: visible,
    });
    assert.equal(h.current.view, view);
  }

  // A disk placement file search keeps the files view open while hidden.
  const h = appNavigation({
    stored: { view: "disks", service: "radarr" },
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
  const later = appNavigation({
    stored: { view: "mux", service: "radarr" },
    status: visible,
  });
  assert.equal(later.current.view, "mux");
  later.status = { ...visible, mux: { enabled: false } };
  later.render();
  assert.equal(later.current.view, "library");
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
const persisted = ({
  view,
  service,
  page,
  filters,
  settingsOpen,
  settingsSection,
}) =>
  JSON.stringify({
    view,
    service,
    page,
    filters,
    settingsOpen,
    settingsSection,
  });

test("named actions set the same state and storage as before", () => {
  const start = {
    view: "library",
    service: "radarr",
    page: 3,
    filters: {
      radarr: "resolution=1080p",
      sonarr: "codec=hevc&instance=sonarr",
    },
    settingsOpen: false,
    settingsSection: "connections",
  };
  const rows = [
    {
      name: "dashboard",
      act: (n) => n.openDashboard(),
      state: { view: "statistics" },
    },
    {
      name: "library instance",
      from: { view: "statistics" },
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
    },
    {
      name: "library with every instance",
      from: { view: "mux" },
      act: (n) => n.openLibrary("sonarr", { instance: "" }),
      state: {
        view: "library",
        service: "sonarr",
        page: 1,
        filters: { radarr: "resolution=1080p", sonarr: "codec=hevc" },
      },
    },
    {
      name: "library query",
      from: { view: "statistics", service: "sonarr" },
      act: (n) => n.openLibrary("radarr", { query: "hdr=Dolby+Vision" }),
      state: {
        view: "library",
        service: "radarr",
        page: 1,
        filters: {
          radarr: "hdr=Dolby+Vision",
          sonarr: "codec=hevc&instance=sonarr",
        },
      },
    },
    { name: "tool", act: (n) => n.openTool("mux"), state: { view: "mux" } },
    {
      name: "same tool",
      from: { view: "disks" },
      act: (n) => n.openTool("disks"),
      state: {},
    },
    {
      name: "files from disk placement",
      from: { view: "disks" },
      act: (n) => n.openFiles("/mnt/disk1/Movies/A B"),
      state: { view: "files", placementFileSearch: true },
      local: [
        [
          "scopearr-filecheck-filters",
          '{"q":"/mnt/disk1/Movies/A B","statuses":[],"targets":[],"kinds":[]}',
        ],
      ],
      session: [["scopearr-filecheck-page", "1"]],
    },
    {
      name: "mux file",
      act: (n) => n.openMuxFile("Movie (2020).mkv"),
      state: { view: "mux" },
      local: [
        ["scopearr-mux-filters", '{"q":"Movie (2020).mkv","statuses":[]}'],
      ],
    },
    {
      name: "settings",
      from: { settingsSection: "system" },
      act: (n) => n.openSettings(),
      state: { settingsOpen: true, settingsSection: "connections" },
    },
    {
      name: "settings section",
      from: { settingsOpen: true },
      act: (n) => n.openSettings("custom"),
      state: { settingsSection: "custom" },
    },
    {
      name: "service setup",
      from: { view: "mux" },
      act: (n) => n.openSettings("connections", "mux"),
      state: { settingsOpen: true },
      session: [["scopearr-service-settings", "mux"]],
    },
    {
      name: "appearance tab",
      act: (n) => n.openSettings("appearance", "colors"),
      state: { settingsOpen: true, settingsSection: "appearance" },
      session: [["scopearr-display-tab", "colors"]],
    },
    {
      name: "system tab",
      act: (n) => n.openSettings("system", "log"),
      state: { settingsOpen: true, settingsSection: "system" },
      session: [["scopearr-system-tab", "log"]],
    },
    {
      name: "library sort",
      from: { service: "sonarr" },
      act: (n) => n.sortLibrary("year"),
      state: {
        page: 1,
        sorts: { radarr: null, sonarr: { field: "year", direction: "asc" } },
        movieSort: { field: "year", direction: "asc" },
      },
      local: [
        ["scopearr-film-sort", '{"field":"title","direction":"asc"}'],
        ["scopearr-series-sort", '{"field":"year","direction":"asc"}'],
      ],
    },
  ];
  for (const row of rows) {
    const h = appNavigation({
      stored: { ...start, ...row.from },
      status: visible,
    });
    const before = snapshot(h.current),
      session = h.writes.length,
      local = h.localWrites.length;
    row.act(h.current);
    h.render();
    const after = snapshot(h.current);
    assert.deepEqual(after, { ...before, ...row.state }, row.name);
    const writes = h.writes.slice(session);
    assert.deepEqual(
      writes.filter(([key]) => key !== "scopearr-navigation"),
      row.session || [],
      row.name,
    );
    assert.deepEqual(h.localWrites.slice(local), row.local || [], row.name);
    // The tab state persists once per change, and not at all without one.
    assert.deepEqual(
      writes.filter(([key]) => key === "scopearr-navigation"),
      persisted(after) === persisted(before)
        ? []
        : [["scopearr-navigation", persisted(after)]],
      row.name,
    );
  }
});

test("library sort starts from storage and persists in the same format", () => {
  const h = appNavigation({
    stored: { view: "library", service: "radarr", page: 4 },
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
});
