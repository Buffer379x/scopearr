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

test("list prefs keep to two keys and survive blocked storage", () => {
  const store = storage(),
    bus = events();
  const prefs = listPrefs(store, bus);
  assert.equal(prefs.DENSITY_KEY, "scopearr-density");
  assert.equal(prefs.STACKED_KEY, "scopearr-tracks-stacked");
  assert.equal(prefs.LIST_PREFS_EVENT, "scopearr-list-prefs");
  // Defaults without keys.
  assert.deepEqual(
    { ...prefs.readListPrefs() },
    {
      density: "comfortable",
      stacked: false,
      filename: true,
    },
  );
  prefs.writeListPrefs({ density: "compact", stacked: true, filename: true });
  assert.deepEqual(Object.fromEntries(store.values), {
    "scopearr-density": "compact",
    "scopearr-tracks-stacked": "true",
  });
  assert.deepEqual(bus.sent, ["scopearr-list-prefs"]);
  assert.deepEqual(
    { ...prefs.readListPrefs() },
    {
      density: "compact",
      stacked: true,
      filename: true,
    },
  );
  // The default removes the key.
  prefs.writeListPrefs({ density: "comfortable", stacked: true, filename: true });
  assert.deepEqual(Object.fromEntries(store.values), {
    "scopearr-tracks-stacked": "true",
  });
  prefs.writeListPrefs({ density: "comfortable", stacked: false, filename: true });
  assert.deepEqual(Object.fromEntries(store.values), {});
  assert.equal(bus.sent.length, 3, "one event per write");
  // Any other value means the default (read by a fresh start: a write
  // of this session holds, see below).
  for (const [density, stacked] of [
    ["dense", "yes"],
    ["Compact", "TRUE"],
    ["", "1"],
  ]) {
    store.values.set("scopearr-density", density);
    store.values.set("scopearr-tracks-stacked", stacked);
    assert.deepEqual(
      { ...listPrefs(store, events()).readListPrefs() },
      {
        density: "comfortable",
        stacked: false,
        filename: true,
      },
    );
  }
  assert.deepEqual(
    [...store.touched].sort(),
    ["scopearr-density", "scopearr-title-filename", "scopearr-tracks-stacked"],
    "only the three keys",
  );

  // Blocked storage gives the defaults and never throws; the event is sent
  // exactly once per write.
  const blocked = storage(
    { "scopearr-density": "compact", "scopearr-tracks-stacked": "true" },
    { failing: true },
  );
  const quiet = events();
  const failing = listPrefs(blocked, quiet);
  assert.deepEqual(
    { ...failing.readListPrefs() },
    {
      density: "comfortable",
      stacked: false,
      filename: true,
    },
  );
  assert.doesNotThrow(() =>
    failing.writeListPrefs({ density: "compact", stacked: true, filename: true }),
  );
  // The choice written holds for this session (final review I2), as the
  // interface language does; a fresh start has the defaults again.
  assert.deepEqual(
    { ...failing.readListPrefs() },
    {
      density: "compact",
      stacked: true,
      filename: true,
    },
  );
  assert.deepEqual(
    { ...listPrefs(blocked, events()).readListPrefs() },
    {
      density: "comfortable",
      stacked: false,
      filename: true,
    },
  );
  assert.doesNotThrow(() =>
    failing.writeListPrefs({ density: "comfortable", stacked: false, filename: true }),
  );
  assert.deepEqual(
    { ...failing.readListPrefs() },
    {
      density: "comfortable",
      stacked: false,
      filename: true,
    },
  );
  assert.deepEqual(quiet.sent, ["scopearr-list-prefs", "scopearr-list-prefs"]);
  // A written choice is a copy: changing the object passed changes
  // nothing, and each read hands out its own object.
  const choice = { density: "compact", stacked: false, filename: true };
  failing.writeListPrefs(choice);
  choice.density = "comfortable";
  const read = failing.readListPrefs();
  assert.deepEqual({ ...read }, { density: "compact", stacked: false, filename: true });
  read.stacked = true;
  assert.equal(failing.readListPrefs().stacked, false);
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
  assert.deepEqual(
    { ...runtime.render(useListPrefs) },
    {
      density: "compact",
      stacked: false,
      filename: true,
    },
  );
  runtime.flush();
  assert.equal(bus.listeners.get("scopearr-list-prefs")?.size, 1);
  const before = runtime.settle(useListPrefs);
  prefs.writeListPrefs({ density: "comfortable", stacked: true, filename: true });
  assert.deepEqual(
    { ...runtime.settle(useListPrefs) },
    {
      density: "comfortable",
      stacked: true,
      filename: true,
    },
  );
  // An event without a change keeps the same object.
  const after = runtime.settle(useListPrefs);
  bus.window.dispatchEvent(new Event("scopearr-list-prefs"));
  assert.equal(runtime.settle(useListPrefs), after);
  assert.notEqual(before, after);
  runtime.unmount();
  assert.equal(bus.listeners.get("scopearr-list-prefs")?.size, 0);
});

test("the filename preference is on by default and stores only when off", () => {
  const store = storage(),
    bus = events();
  const prefs = listPrefs(store, bus);
  assert.equal(prefs.FILENAME_KEY, "scopearr-title-filename");
  assert.equal(prefs.readListPrefs().filename, true);
  prefs.writeListPrefs({ density: "comfortable", stacked: false, filename: false });
  assert.deepEqual(Object.fromEntries(store.values), {
    "scopearr-title-filename": "hidden",
  });
  // A fresh start reads the stored choice; an unknown value is the default.
  assert.equal(listPrefs(store, events()).readListPrefs().filename, false);
  store.values.set("scopearr-title-filename", "off");
  assert.equal(listPrefs(store, events()).readListPrefs().filename, true);
  prefs.writeListPrefs({ density: "comfortable", stacked: false, filename: true });
  assert.deepEqual(Object.fromEntries(store.values), {});
  // Blocked storage: defaults, no throw, the session keeps the choice.
  const blocked = storage({ "scopearr-title-filename": "hidden" }, { failing: true });
  const failing = listPrefs(blocked, events());
  assert.equal(failing.readListPrefs().filename, true);
  assert.doesNotThrow(() =>
    failing.writeListPrefs({ density: "comfortable", stacked: false, filename: false }),
  );
  assert.equal(failing.readListPrefs().filename, false);
});
