import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./helpers/component-harness.mjs";

// Values cross a VM realm; compare their JSON shape.
const plain = (value) => JSON.parse(JSON.stringify(value));
const languages = await import("../src/languages.ts");

// Runs the real hook with the real browser-storage module over a fake
// sessionStorage. Effects run after each render when their dependencies
// change; state set inside effects renders again, as Preact would.
function appNavigation({ stored, status = {}, answers = [] } = {}) {
  const state = [],
    effects = [],
    refs = [],
    listeners = new Map(),
    confirms = [],
    session = new Map(),
    writes = [];
  if (stored !== undefined)
    session.set(
      "scopearr-navigation",
      typeof stored === "string" ? stored : JSON.stringify(stored),
    );
  const sessionStorage = {
    getItem: (key) => (session.has(key) ? session.get(key) : null),
    setItem(key, value) {
      writes.push([key, value]);
      session.set(key, String(value));
    },
  };
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
  const { useAppNavigation } = loadSource("hooks/useAppNavigation.ts", {
    browser: { window },
    modules: {
      "preact/hooks": hooks,
      "../browser-storage": loadSource("browser-storage.ts", {
        browser: { sessionStorage },
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

  // Unrelated renders do not write again.
  h.render();
  h.current.setPlacementFileSearch(false);
  h.render();
  assert.equal(h.writes.length, 1);

  h.current.setView("library");
  h.current.setService("sonarr");
  h.current.setPage(3);
  h.current.setFilters((current) => ({ ...current, sonarr: "codec=hevc" }));
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
  h.current.setSettingsSection("system");
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
  h.current.setSettingsSection("rules");
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
  h.current.setPlacementFileSearch(true);
  h.current.setView("files");
  h.render();
  assert.equal(h.current.view, "files");
  assert.equal(h.current.placementFileSearch, true);

  h.current.setView("disks");
  h.render();
  assert.equal(h.current.placementFileSearch, false);
  h.current.setView("files");
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
