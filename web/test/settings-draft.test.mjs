import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./helpers/component-harness.mjs";

// Values cross a VM realm; compare their JSON shape.
const plain = (value) => JSON.parse(JSON.stringify(value));
const saved = { pageSize: 25, tagColors: {}, instances: [] };

// Runs the real hook. Effects run after each render when their dependencies
// change; the previous cleanup runs first, and unmount runs every cleanup.
function settingsDraft({ initialSection = "connections", answers = [] } = {}) {
  const state = [],
    effects = [],
    listeners = new Map(),
    confirms = [],
    dirtyCalls = [],
    sections = [],
    stored = [];
  let cursor = 0;
  const hooks = {
    useState(initial) {
      const slot = cursor++;
      if (!(slot in state))
        state[slot] = typeof initial === "function" ? initial() : initial;
      return [
        state[slot],
        (next) => {
          state[slot] = typeof next === "function" ? next(state[slot]) : next;
        },
      ];
    },
    useEffect(effect, deps) {
      const slot = cursor++;
      const old = effects[slot];
      if (!old || !deps || deps.some((value, i) => value !== old.deps[i]))
        effects[slot] = { deps, pending: effect, cleanup: old?.cleanup };
    },
  };
  const window = {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
  };
  const { useSettingsDraft } = loadSource("hooks/useSettingsDraft.ts", {
    browser: { window, structuredClone },
    modules: {
      "preact/hooks": hooks,
      "../api": {
        api: async () => {
          throw new Error("no request expected");
        },
      },
      "../browser-storage": {
        writeSessionPreference: (key, value) => stored.push([key, value]),
      },
      "../confirmation": {
        confirmDiscard: async (message) => {
          confirms.push(message);
          assert.ok(answers.length, "unexpected confirmation: " + message);
          return answers.shift();
        },
      },
      "../i18n": {
        t: (key) => key,
        useI18n: () => ({ locale: "en", setLocale: async () => {} }),
      },
      "../instances": loadSource("instances.ts"),
      "../notifications": { notify: () => {} },
      "../settings-payload": loadSource("settings-payload.ts"),
      "../tag-policy": loadSource("tag-policy.ts"),
    },
  });
  const args = {
    settings: saved,
    initialSection,
    onSectionChange: (section) => sections.push(section),
    onDirty: (dirty) => dirtyCalls.push(dirty),
    saved: async () => {},
  };
  let current;
  const render = () => {
    cursor = 0;
    current = useSettingsDraft(args);
    for (const entry of effects)
      if (entry?.pending) {
        entry.cleanup?.();
        entry.cleanup = entry.pending();
        entry.pending = undefined;
      }
    return current;
  };
  render();
  return {
    get current() {
      return current;
    },
    render,
    answers,
    confirms,
    dirtyCalls,
    sections,
    stored,
    unmount() {
      for (const entry of effects) entry?.cleanup?.();
    },
    listeners: (type) => [...(listeners.get(type) || [])],
    // Mirrors the e2e probe: a real BeforeUnloadEvent counts as blocked once
    // a listener prevents it.
    leaveIsBlocked() {
      let prevented = false;
      const event = {
        returnValue: undefined,
        preventDefault() {
          prevented = true;
        },
      };
      for (const listener of listeners.get("beforeunload") || [])
        listener(event);
      return prevented && event.returnValue === "";
    },
  };
}

test("draft changes report dirty and block unload", () => {
  const h = settingsDraft();
  assert.equal(h.current.dirty, false);
  assert.deepEqual(h.dirtyCalls, [false]);
  assert.equal(h.listeners("beforeunload").length, 1);
  assert.equal(h.leaveIsBlocked(), false);
  assert.deepEqual(h.stored, [["scopearr-settings-section", "connections"]]);
  assert.deepEqual(h.sections, ["connections"]);

  h.current.setCfg((cfg) => ({ ...cfg, pageSize: 37 }));
  h.render();
  assert.equal(h.current.dirty, true);
  assert.deepEqual(h.dirtyCalls, [false, true]);
  // The guard is replaced, never doubled.
  assert.equal(h.listeners("beforeunload").length, 1);
  assert.equal(h.leaveIsBlocked(), true);

  h.current.setCfg((cfg) => ({ ...cfg, pageSize: 25 }));
  h.render();
  assert.equal(h.current.dirty, false);
  assert.equal(h.leaveIsBlocked(), false);

  for (const [set, name] of [
    [h.current.setRulesDirty, "rules"],
    [h.current.setCustomDirty, "custom"],
    [h.current.setDraftLocale, "locale"],
  ]) {
    set(name === "locale" ? "de" : true);
    h.render();
    assert.equal(h.dirtyCalls.at(-1), true, name);
    assert.equal(h.leaveIsBlocked(), true, name);
    set(name === "locale" ? "en" : false);
    h.render();
    assert.equal(h.dirtyCalls.at(-1), false, name);
    assert.equal(h.leaveIsBlocked(), false, name);
  }
  assert.equal(h.listeners("beforeunload").length, 1);
});

test("section change asks before discarding and restores the saved draft", async () => {
  const h = settingsDraft({ initialSection: "appearance" });
  await h.current.changeSection("widgets");
  h.render();
  assert.deepEqual(h.confirms, [], "a clean draft changes without asking");
  assert.equal(h.current.section, "widgets");
  await h.current.changeSection("widgets");
  assert.deepEqual(h.confirms, []);

  h.current.setCfg((cfg) => ({ ...cfg, pageSize: 37 }));
  h.current.setDraftLocale("de");
  h.render();
  h.answers.push(false);
  await h.current.changeSection("appearance");
  h.render();
  assert.deepEqual(h.confirms, ["Discard unsaved settings changes?"]);
  assert.equal(h.current.section, "widgets");
  assert.equal(h.current.cfg.pageSize, 37);
  assert.equal(h.current.draftLocale, "de");

  await h.current.changeSection("widgets");
  assert.equal(h.confirms.length, 1, "the same section never asks");

  h.answers.push(true);
  await h.current.changeSection("appearance");
  h.render();
  assert.equal(h.confirms.length, 2);
  assert.equal(h.current.section, "appearance");
  assert.deepEqual(plain(h.current.cfg), saved);
  assert.notEqual(h.current.cfg, saved, "the draft is a copy");
  assert.equal(h.current.draftLocale, "en");
  assert.equal(h.current.dirty, false);
  assert.equal(h.dirtyCalls.at(-1), false);
  assert.deepEqual(h.sections, ["appearance", "widgets", "appearance"]);
  assert.deepEqual(h.stored.at(-1), [
    "scopearr-settings-section",
    "appearance",
  ]);

  // Custom tags and tag rules guard only while their own section is open.
  for (const [section, set, message] of [
    ["custom", h.current.setCustomDirty, "Discard unsaved settings changes?"],
    ["recognition", h.current.setRulesDirty, "Discard unsaved rule changes?"],
  ]) {
    await h.current.changeSection(section);
    h.render();
    set(true);
    h.render();
    h.answers.push(false);
    await h.current.changeSection("system");
    h.render();
    assert.equal(h.confirms.at(-1), message, section);
    assert.equal(h.current.section, section);
    h.answers.push(true);
    await h.current.changeSection("system");
    h.render();
    assert.equal(h.current.section, "system", section);
    const asked = h.confirms.length;
    await h.current.changeSection("appearance");
    h.render();
    assert.equal(h.confirms.length, asked, section + " outside its section");
    set(false);
    h.render();
  }
  assert.deepEqual(h.answers, []);
});

test("unmount clears dirty and removes the unload guard", () => {
  const h = settingsDraft();
  h.current.setCfg((cfg) => ({ ...cfg, pageSize: 37 }));
  h.render();
  assert.equal(h.dirtyCalls.at(-1), true);
  assert.equal(h.leaveIsBlocked(), true);

  h.unmount();
  assert.equal(h.dirtyCalls.at(-1), false);
  assert.equal(h.dirtyCalls.filter((dirty) => !dirty).length, 2);
  assert.deepEqual(h.listeners("beforeunload"), []);
  assert.equal(h.leaveIsBlocked(), false);
});
