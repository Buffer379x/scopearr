import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";
import { allSources } from "./helpers/sources.mjs";

// Values cross a VM realm; compare their JSON shape.
const plain = (value) => JSON.parse(JSON.stringify(value));
const saved = { pageSize: 25, tagColors: {}, instances: [] };

// Runs the real hook with the shared hook runtime. Effects run after each
// render when their dependencies change; the previous cleanup runs first, and
// unmount runs every cleanup.
// The section is a prop. link() is the frame's section link as openLink
// runs it: the shown section asks nothing; another one asks the section
// guard the page registers (confirmSectionChange) and, when allowed, the
// navigation opens it and passes the new section on the next render.
function settingsDraft({
  section = "connections",
  answers = [],
  theme,
  api,
  appearance,
} = {}) {
  const listeners = new Map(),
    confirms = [],
    dirtyCalls = [],
    opened = [],
    stored = [];
  const runtime = createHookRuntime();
  const window = {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
  };
  // The real list preferences over an empty localStorage; a write would
  // show up in `stored`.
  const listPrefs = loadSource("list-prefs.ts", {
    modules: {
      "./browser-storage": loadSource("browser-storage.ts", {
        browser: {
          localStorage: {
            getItem: () => null,
            setItem: (key, value) => stored.push([key, value]),
            removeItem: (key) => stored.push([key]),
          },
        },
      }),
    },
    browser: { window, Event },
  });
  const { useSettingsDraft } = loadSource("hooks/useSettingsDraft.ts", {
    browser: { window, structuredClone },
    modules: {
      "preact/hooks": runtime.hooks,
      "../api": {
        api:
          api ??
          (async () => {
            throw new Error("no request expected");
          }),
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
      "../list-prefs": listPrefs,
      "../notifications": { notify: () => {} },
      "../settings-payload": loadSource("settings-payload.ts"),
      "../tag-policy": loadSource("tag-policy.ts"),
      "./useListPrefs": loadSource("hooks/useListPrefs.ts", {
        modules: { "preact/hooks": runtime.hooks, "../list-prefs": listPrefs },
        browser: { window: window },
      }),
    },
  });
  const args = {
    settings: saved,
    section,
    onDirty: (dirty) => dirtyCalls.push(dirty),
    saved: async () => {},
    theme,
    appearance,
  };
  let current;
  const render = () => {
    current = runtime.render(() => useSettingsDraft(args));
    runtime.flush();
    return current;
  };
  render();
  return {
    get current() {
      return current;
    },
    async link(next) {
      if (next === args.section) return;
      if (await current.confirmSectionChange(next)) {
        opened.push(next);
        args.section = next;
      }
    },
    render,
    args,
    answers,
    confirms,
    dirtyCalls,
    opened,
    stored,
    unmount: runtime.unmount,
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
  assert.deepEqual(h.stored, [], "the section is not stored");
  assert.deepEqual(h.opened, [], "mounting opens no section");

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
  const h = settingsDraft({ section: "appearance" });
  assert.equal(h.current.section, "appearance", "the section is the prop");
  await h.link("widgets");
  h.render();
  assert.deepEqual(h.confirms, [], "a clean draft changes without asking");
  assert.deepEqual(h.opened, ["widgets"]);
  assert.equal(h.current.section, "widgets");
  await h.link("widgets");
  assert.deepEqual(h.confirms, []);
  assert.deepEqual(h.opened, ["widgets"], "the open section opens nothing");

  h.current.setCfg((cfg) => ({ ...cfg, pageSize: 37 }));
  h.current.setDraftLocale("de");
  h.render();
  h.answers.push(false);
  await h.link("appearance");
  h.render();
  assert.deepEqual(h.confirms, ["Discard unsaved settings changes?"]);
  assert.deepEqual(h.opened, ["widgets"], "a declined change opens nothing");
  assert.equal(h.current.section, "widgets");
  assert.equal(h.current.cfg.pageSize, 37);
  assert.equal(h.current.draftLocale, "de");

  await h.link("widgets");
  assert.equal(h.confirms.length, 1, "the same section never asks");

  h.answers.push(true);
  await h.link("appearance");
  h.render();
  assert.equal(h.confirms.length, 2);
  assert.deepEqual(
    h.opened,
    ["widgets", "appearance"],
    "a confirmed change opens its section once",
  );
  assert.equal(h.current.section, "appearance");
  assert.deepEqual(plain(h.current.cfg), saved);
  assert.notEqual(h.current.cfg, saved, "the draft is a copy");
  assert.equal(h.current.draftLocale, "en");
  assert.equal(h.current.dirty, false);
  assert.equal(h.dirtyCalls.at(-1), false);

  // Custom tags and tag rules guard only while their own section is open.
  for (const [section, set, message] of [
    ["custom", h.current.setCustomDirty, "Discard unsaved settings changes?"],
    ["recognition", h.current.setRulesDirty, "Discard unsaved rule changes?"],
  ]) {
    await h.link(section);
    h.render();
    set(true);
    h.render();
    const opened = h.opened.length;
    h.answers.push(false);
    await h.link("system");
    h.render();
    assert.equal(h.confirms.at(-1), message, section);
    assert.equal(h.opened.length, opened, section);
    assert.equal(h.current.section, section);
    h.answers.push(true);
    await h.link("system");
    h.render();
    assert.deepEqual(h.opened.slice(opened), ["system"], section);
    assert.equal(h.current.section, "system", section);
    const asked = h.confirms.length;
    await h.link("appearance");
    h.render();
    assert.equal(h.confirms.length, asked, section + " outside its section");
    set(false);
    h.render();
  }
  assert.deepEqual(h.answers, []);
  assert.deepEqual(h.stored, [], "the section is not stored");
});

test("the section guard asks like a section link without opening", async () => {
  const general = "Discard unsaved settings changes?",
    rules = "Discard unsaved rule changes?";
  // Each case runs once through the guard and once through a section link
  // on a fresh draft: same questions, same answer, same draft afterwards.
  const cases = [
    { name: "clean draft", from: "appearance", to: "widgets", ok: true },
    // A tab change within the section (back from Log to Info) keeps the draft.
    {
      name: "same section",
      from: "appearance",
      to: "appearance",
      draft: true,
      ok: true,
    },
    {
      name: "draft kept",
      from: "appearance",
      to: "system",
      draft: true,
      answers: [false],
      asks: [general],
      ok: false,
    },
    {
      name: "draft discarded",
      from: "appearance",
      to: "system",
      draft: true,
      answers: [true],
      asks: [general],
      ok: true,
    },
    {
      name: "custom tags kept",
      from: "custom",
      to: "system",
      custom: true,
      answers: [false],
      asks: [general],
      ok: false,
    },
    {
      name: "custom tags discarded",
      from: "custom",
      to: "system",
      custom: true,
      answers: [true],
      asks: [general],
      ok: true,
    },
    {
      name: "custom tags outside their section",
      from: "system",
      to: "appearance",
      custom: true,
      ok: true,
    },
    {
      name: "rules kept",
      from: "recognition",
      to: "system",
      rules: true,
      answers: [false],
      asks: [rules],
      ok: false,
    },
    {
      name: "rules and draft, draft kept",
      from: "recognition",
      to: "system",
      rules: true,
      draft: true,
      answers: [true, false],
      asks: [rules, general],
      ok: false,
    },
    {
      name: "rules and draft discarded",
      from: "recognition",
      to: "connections",
      rules: true,
      draft: true,
      answers: [true, true],
      asks: [rules, general],
      ok: true,
    },
    {
      name: "rules outside their section",
      from: "widgets",
      to: "system",
      rules: true,
      ok: true,
    },
  ];
  for (const c of cases)
    for (const via of ["guard", "link"]) {
      const name = c.name + " via " + via;
      const h = settingsDraft({
        section: c.from,
        answers: [...(c.answers || [])],
      });
      if (c.draft) {
        h.current.setCfg((cfg) => ({ ...cfg, pageSize: 37 }));
        h.current.setDraftLocale("de");
      }
      if (c.custom) h.current.setCustomDirty(true);
      if (c.rules) h.current.setRulesDirty(true);
      h.render();
      const result =
        via === "guard"
          ? await h.current.confirmSectionChange(c.to)
          : await h.link(c.to);
      h.render();
      assert.deepEqual(h.confirms, c.asks || [], name);
      assert.deepEqual(h.answers, [], name);
      if (via === "guard") {
        assert.equal(result, c.ok, name);
        assert.deepEqual(h.opened, [], name + ": the guard opens nothing");
        assert.equal(h.current.section, c.from, name);
      } else {
        assert.equal(result, undefined, name);
        assert.deepEqual(h.opened, c.ok && c.to !== c.from ? [c.to] : [], name);
      }
      // Only a confirmed change to another section discards the draft.
      const kept = c.draft && !(c.ok && c.to !== c.from);
      assert.equal(h.current.cfg.pageSize, kept ? 37 : 25, name);
      assert.equal(h.current.draftLocale, kept ? "de" : "en", name);
      assert.equal(h.current.dirty, !!kept, name);
      assert.deepEqual(h.stored, [], name);
    }
});

test("the settings section is not stored", () => {
  const sources = allSources();
  assert.doesNotMatch(sources, /scopearr-settings-section/);
  // The page follows the section prop instead of starting from one.
  assert.doesNotMatch(sources, /\binitialSection\b|\bonSectionChange\b/);
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

// Ruling P1: mode and band are drafts until Save settings. A draft makes
// the settings dirty (onDirty, beforeunload, one question on leaving),
// Discard drops it, and only a successful save (its PUT and GET) hands it
// to `appearance`; a failed one keeps it. A change of the shown mode (the
// topbar) clears only the mode draft and asks nothing.
test("mode and band drafts are dirty, ask on leave and apply only after a successful save", async () => {
  const log = [],
    applied = [];
  const state = { failing: false };
  const h = settingsDraft({
    section: "appearance",
    theme: "dark",
    api: async (path, method = "GET") => {
      log.push(method + " " + path);
      if (method === "PUT" && state.failing) throw new Error("failed");
      return method === "PUT" ? {} : structuredClone(saved);
    },
    appearance: (next) => {
      log.push("appearance");
      applied.push(plain(next));
    },
  });
  assert.equal(h.current.mode, "dark");
  assert.equal(h.current.dirty, false);
  // The mode drafted: shown, dirty, blocking; the shown mode again is clean.
  h.current.setLook({ mode: "light" });
  h.render();
  assert.equal(h.current.mode, "light");
  assert.equal(h.current.dirty, true);
  assert.equal(h.dirtyCalls.at(-1), true);
  assert.equal(h.leaveIsBlocked(), true);
  h.current.setLook({ mode: "dark" });
  h.render();
  assert.equal(h.current.dirty, false);
  assert.equal(h.leaveIsBlocked(), false);
  // A band draft (null: Use default) is a change as well.
  h.current.setLook({ band: null });
  h.render();
  assert.equal(h.current.dirty, true);
  // Leaving asks once; Cancel keeps it, Discard drops it.
  h.answers.push(false);
  await h.link("widgets");
  h.render();
  assert.deepEqual(h.confirms, ["Discard unsaved settings changes?"]);
  assert.deepEqual(plain(h.current.look), { band: null });
  h.answers.push(true);
  await h.link("widgets");
  h.render();
  assert.equal(h.confirms.length, 2);
  assert.deepEqual(plain(h.current.look), {});
  assert.equal(h.current.dirty, false);
  assert.deepEqual(h.opened, ["widgets"]);
  // The topbar: a new shown mode clears the mode draft and keeps the band
  // and every other change, without a question.
  h.current.setLook({ mode: "light", band: "strong" });
  h.current.setCfg((cfg) => ({ ...cfg, pageSize: 37 }));
  h.render();
  h.args.theme = "light";
  h.render();
  assert.equal(h.current.mode, "light");
  h.render();
  assert.deepEqual(plain(h.current.look), { band: "strong" });
  assert.equal(h.current.cfg.pageSize, 37);
  assert.equal(h.current.dirty, true);
  h.args.theme = "dark";
  h.render();
  assert.equal(h.current.mode, "dark", "the cleared mode draft stays gone");
  assert.equal(h.confirms.length, 2);
  // A failed save applies nothing and keeps the draft.
  h.current.setLook({ mode: "light", band: "strong" });
  h.render();
  state.failing = true;
  await h.current.saveSettings(h.current.cfg);
  h.render();
  assert.deepEqual(log, ["PUT settings"]);
  assert.deepEqual(applied, []);
  assert.deepEqual(plain(h.current.look), { mode: "light", band: "strong" });
  assert.equal(h.current.dirty, true);
  // A successful save hands the draft over after its PUT and GET, then
  // drops it.
  state.failing = false;
  log.length = 0;
  await h.current.saveSettings(h.current.cfg);
  h.render();
  assert.deepEqual(log, ["PUT settings", "GET settings", "appearance"]);
  assert.deepEqual(applied, [{ mode: "light", band: "strong" }]);
  assert.deepEqual(plain(h.current.look), {});
  // A save without a draft hands nothing over.
  await h.current.saveSettings(h.current.cfg);
  assert.equal(applied.length, 1);
  assert.deepEqual(h.stored, [], "a draft is never stored");
});
