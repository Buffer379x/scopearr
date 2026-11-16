import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";

// Row density and stacked tracks (Phase 5a, task 2, E13): browser
// preferences in two localStorage keys, never a server setting.

function storage(entries = {}, { failing = false } = {}) {
  const values = new Map(Object.entries(entries)),
    touched = new Set();
  const guard = (key) => {
    touched.add(key);
    if (failing) throw new Error("Storage blocked");
  };
  return {
    values,
    touched,
    localStorage: {
      getItem: (key) => (guard(key), values.has(key) ? values.get(key) : null),
      setItem: (key, value) => (guard(key), values.set(key, String(value))),
      removeItem: (key) => (guard(key), values.delete(key)),
    },
  };
}
function events() {
  const sent = [],
    listeners = new Map();
  return {
    sent,
    listeners,
    window: {
      dispatchEvent(event) {
        sent.push(event.type);
        for (const listener of [...(listeners.get(event.type) || [])])
          listener(event);
        return true;
      },
      addEventListener(type, listener) {
        listeners.set(
          type,
          new Set([...(listeners.get(type) || []), listener]),
        );
      },
      removeEventListener(type, listener) {
        listeners.get(type)?.delete(listener);
      },
    },
  };
}
function listPrefs(store, bus) {
  return loadSource("list-prefs.ts", {
    modules: {
      "./browser-storage": loadSource("browser-storage.ts", {
        browser: { localStorage: store.localStorage },
      }),
    },
    browser: { window: bus.window, Event },
  });
}

const both = (value) => ({ radarr: value, sonarr: value });
const plain = (value) => JSON.parse(JSON.stringify(value));
const DEFAULTS = {
  density: "comfortable",
  stacked: both(false),
  filename: both(true),
};

test("list prefs keep to per-list keys and survive blocked storage", () => {
  const store = storage(),
    bus = events();
  const prefs = listPrefs(store, bus);
  assert.equal(prefs.DENSITY_KEY, "scopearr-density");
  assert.equal(prefs.STACKED_KEY, "scopearr-tracks-stacked");
  assert.equal(prefs.FILENAME_KEY, "scopearr-title-filename");
  assert.equal(prefs.LIST_PREFS_EVENT, "scopearr-list-prefs");
  assert.deepEqual(plain(prefs.readListPrefs()), DEFAULTS);
  // Movies and TV series hold their own values.
  prefs.writeListPrefs({
    density: "compact",
    stacked: { radarr: true, sonarr: false },
    filename: { radarr: false, sonarr: true },
  });
  assert.deepEqual(Object.fromEntries(store.values), {
    "scopearr-density": "compact",
    "scopearr-tracks-stacked:radarr": "true",
    "scopearr-tracks-stacked:sonarr": "false",
    "scopearr-title-filename:radarr": "hidden",
    "scopearr-title-filename:sonarr": "shown",
  });
  assert.deepEqual(bus.sent, ["scopearr-list-prefs"]);
  const stored = {
    density: "compact",
    stacked: { radarr: true, sonarr: false },
    filename: { radarr: false, sonarr: true },
  };
  assert.deepEqual(plain(prefs.readListPrefs()), stored);
  // A fresh start reads the stored per-list values.
  assert.deepEqual(plain(listPrefs(store, events()).readListPrefs()), stored);
  // The comfortable density removes its key.
  prefs.writeListPrefs({ ...DEFAULTS });
  assert.equal(store.values.has("scopearr-density"), false);
  assert.equal(bus.sent.length, 2, "one event per write");
  // Any other value is no choice of the list: the shared key decides
  // (here absent, so the defaults).
  for (const [density, own] of [
    ["dense", "yes"],
    ["Compact", "TRUE"],
    ["", "1"],
  ]) {
    store.values.clear();
    store.values.set("scopearr-density", density);
    store.values.set("scopearr-tracks-stacked:radarr", own);
    store.values.set("scopearr-title-filename:sonarr", own);
    assert.deepEqual(
      plain(listPrefs(store, events()).readListPrefs()),
      DEFAULTS,
    );
  }
  assert.deepEqual(
    [...store.touched].sort(),
    [
      "scopearr-density",
      "scopearr-title-filename",
      "scopearr-title-filename:radarr",
      "scopearr-title-filename:sonarr",
      "scopearr-tracks-stacked",
      "scopearr-tracks-stacked:radarr",
      "scopearr-tracks-stacked:sonarr",
    ],
    "only these keys",
  );

  // Blocked storage gives the defaults and never throws; the event is sent
  // exactly once per write.
  const blocked = storage(
    { "scopearr-density": "compact", "scopearr-tracks-stacked": "true" },
    { failing: true },
  );
  const quiet = events();
  const failing = listPrefs(blocked, quiet);
  assert.deepEqual(plain(failing.readListPrefs()), DEFAULTS);
  const choice = {
    density: "compact",
    stacked: { radarr: false, sonarr: true },
    filename: { radarr: true, sonarr: false },
  };
  assert.doesNotThrow(() => failing.writeListPrefs(choice));
  // The choice written holds for this session (final review I2), as the
  // interface language does; a fresh start has the defaults again.
  assert.deepEqual(plain(failing.readListPrefs()), choice);
  assert.deepEqual(
    plain(listPrefs(blocked, events()).readListPrefs()),
    DEFAULTS,
  );
  assert.deepEqual(quiet.sent, ["scopearr-list-prefs"]);
  // A written choice is a copy: changing the object passed changes
  // nothing, and each read hands out its own object.
  choice.stacked.radarr = true;
  choice.density = "comfortable";
  const read = failing.readListPrefs();
  assert.equal(read.density, "compact");
  assert.equal(read.stacked.radarr, false);
  read.stacked.sonarr = false;
  assert.equal(failing.readListPrefs().stacked.sonarr, true);
});

test("each list starts from the shared key of the release candidates", () => {
  // The shared keys (rc.1 to rc.4) give both lists their first value;
  // 1.7.0 never knew them, so nothing else is needed for a downgrade.
  const store = storage({
    "scopearr-tracks-stacked": "true",
    "scopearr-title-filename": "hidden",
  });
  const prefs = listPrefs(store, events());
  assert.deepEqual(plain(prefs.readListPrefs()), {
    density: "comfortable",
    stacked: both(true),
    filename: both(false),
  });
  // A list's own key wins over the shared one, for the other list alone.
  store.values.set("scopearr-tracks-stacked:sonarr", "false");
  store.values.set("scopearr-title-filename:radarr", "shown");
  assert.deepEqual(plain(listPrefs(store, events()).readListPrefs()), {
    density: "comfortable",
    stacked: { radarr: true, sonarr: false },
    filename: { radarr: true, sonarr: false },
  });
  // A save writes the list keys and leaves the shared keys untouched.
  const saving = listPrefs(store, events());
  saving.writeListPrefs({
    density: "comfortable",
    stacked: { radarr: false, sonarr: false },
    filename: { radarr: true, sonarr: true },
  });
  assert.equal(store.values.get("scopearr-tracks-stacked"), "true");
  assert.equal(store.values.get("scopearr-title-filename"), "hidden");
  assert.deepEqual(plain(listPrefs(store, events()).readListPrefs()), {
    density: "comfortable",
    stacked: both(false),
    filename: both(true),
  });
  // Blocked storage: the defaults, no throw.
  const blocked = storage(
    { "scopearr-title-filename": "hidden" },
    { failing: true },
  );
  assert.deepEqual(
    plain(listPrefs(blocked, events()).readListPrefs()),
    DEFAULTS,
  );
});

test("the list prefs hook follows every write", () => {
  const store = storage({ "scopearr-density": "compact" }),
    bus = events(),
    runtime = createHookRuntime();
  const prefs = listPrefs(store, bus);
  const { useListPrefs } = loadSource("hooks/useListPrefs.ts", {
    modules: { "preact/hooks": runtime.hooks, "../list-prefs": prefs },
    browser: { window: bus.window },
  });
  // The first render already reads the stored choice.
  assert.deepEqual(plain(runtime.render(useListPrefs)), {
    density: "compact",
    stacked: both(false),
    filename: both(true),
  });
  runtime.flush();
  assert.equal(bus.listeners.get("scopearr-list-prefs")?.size, 1);
  const before = runtime.settle(useListPrefs);
  prefs.writeListPrefs({
    density: "comfortable",
    stacked: both(true),
    filename: both(true),
  });
  assert.deepEqual(plain(runtime.settle(useListPrefs)), {
    density: "comfortable",
    stacked: both(true),
    filename: both(true),
  });
  // An event without a change keeps the same object.
  const after = runtime.settle(useListPrefs);
  bus.window.dispatchEvent(new Event("scopearr-list-prefs"));
  assert.equal(runtime.settle(useListPrefs), after);
  assert.notEqual(before, after);
  runtime.unmount();
  assert.equal(bus.listeners.get("scopearr-list-prefs")?.size, 0);
});
