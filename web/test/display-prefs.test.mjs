import test from "node:test";
import assert from "node:assert/strict";
import { find, loadSource, nodes, text } from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";

// Row density and stacked audio tracks in Display (Phase 5a, task 12,
// E13, ruling R-C): drafts of the settings page like the interface
// language, written to their two localStorage keys only after a
// successful Save settings, never sent to the server.

// Values cross a VM realm; compare their JSON shape.
const plain = (value) => JSON.parse(JSON.stringify(value));
const t = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");
const saved = { pageSize: 25, tagColors: {}, instances: [] };
const COMFORTABLE = { density: "comfortable", stacked: false };
const DISCARD = "Discard unsaved settings changes?";

// One window for the page: beforeunload for the leave guard and the list
// preferences' event. localStorage logs every write, in order with the
// requests.
function browser(stored) {
  const listeners = new Map(),
    values = new Map(Object.entries(stored)),
    log = [],
    sent = [];
  const window = {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event) {
      sent.push(event.type);
      for (const listener of [...(listeners.get(event.type) || [])])
        listener(event);
      return true;
    },
  };
  const localStorage = {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem(key, value) {
      log.push("set " + key + "=" + value);
      values.set(key, String(value));
    },
    removeItem(key) {
      log.push("remove " + key);
      values.delete(key);
    },
  };
  return { window, localStorage, listeners, values, log, sent };
}

// The real useSettingsDraft with the real list preferences (list-prefs.ts,
// useListPrefs) over the fake browser; PUT settings fails while `failing`.
function settingsDraft({ stored = {}, section = "appearance" } = {}) {
  const page = browser(stored),
    runtime = createHookRuntime(),
    answers = [],
    confirms = [],
    dirtyCalls = [],
    puts = [],
    locales = [];
  const state = { failing: false };
  const listPrefs = loadSource("list-prefs.ts", {
    modules: {
      "./browser-storage": loadSource("browser-storage.ts", {
        browser: { localStorage: page.localStorage },
      }),
    },
    browser: { window: page.window, Event },
  });
  const { useSettingsDraft } = loadSource("hooks/useSettingsDraft.ts", {
    browser: { window: page.window, structuredClone },
    modules: {
      "preact/hooks": runtime.hooks,
      "../api": {
        api: async (path, method = "GET", body) => {
          page.log.push(method + " " + path);
          if (method === "PUT") {
            puts.push(JSON.stringify(body));
            if (state.failing) throw new Error("Could not save settings");
            return { ok: true };
          }
          return structuredClone(saved);
        },
      },
      "../confirmation": {
        confirmDiscard: async (message) => {
          confirms.push(message);
          assert.ok(answers.length, "unexpected confirmation: " + message);
          return answers.shift();
        },
      },
      "../i18n": {
        t,
        useI18n: () => ({
          locale: "en",
          setLocale: async (locale) => {
            page.log.push("locale " + locale);
            locales.push(locale);
          },
        }),
      },
      "../instances": loadSource("instances.ts"),
      "../list-prefs": listPrefs,
      "../notifications": { notify: (message) => page.log.push(message) },
      "../settings-payload": loadSource("settings-payload.ts"),
      "../tag-policy": loadSource("tag-policy.ts"),
      "./useListPrefs": loadSource("hooks/useListPrefs.ts", {
        modules: { "preact/hooks": runtime.hooks, "../list-prefs": listPrefs },
        browser: { window: page.window },
      }),
    },
  });
  const args = {
    settings: saved,
    section,
    onDirty: (dirty) => dirtyCalls.push(dirty),
    saved: async () => {
      page.log.push("saved");
    },
  };
  let current;
  const render = () => {
    current = runtime.render(() => useSettingsDraft(args));
    runtime.flush();
    return current;
  };
  render();
  return {
    ...page,
    state,
    answers,
    confirms,
    dirtyCalls,
    puts,
    locales,
    render,
    get current() {
      return current;
    },
    // A section link as openLink runs it (settings-draft.test.mjs).
    async link(next) {
      if (next === args.section) return;
      if (await current.confirmSectionChange(next)) args.section = next;
    },
    async save() {
      await current.saveSettings(current.cfg);
      render();
    },
    change(prefs) {
      current.setDraftPrefs(prefs);
      render();
    },
    leaveIsBlocked() {
      let prevented = false;
      const event = {
        returnValue: undefined,
        preventDefault() {
          prevented = true;
        },
      };
      for (const listener of page.listeners.get("beforeunload") || [])
        listener(event);
      return prevented && event.returnValue === "";
    },
  };
}

test("density and stacked tracks are drafts until saved", async () => {
  // The draft starts from the stored values.
  const stored = settingsDraft({
    stored: {
      "scopearr-density": "compact",
      "scopearr-tracks-stacked": "true",
    },
  });
  assert.deepEqual(plain(stored.current.draftPrefs), {
    density: "compact",
    stacked: true,
  });
  assert.deepEqual(plain(stored.current.savedPrefs), {
    density: "compact",
    stacked: true,
  });
  assert.equal(stored.current.dirty, false);

  const h = settingsDraft();
  assert.deepEqual(plain(h.current.draftPrefs), COMFORTABLE);
  assert.equal(h.current.dirty, false);
  assert.equal(h.leaveIsBlocked(), false);

  // Each preference alone makes the draft dirty and guards leaving; going
  // back to the stored value makes it clean again. Nothing is written.
  for (const prefs of [
    { density: "compact", stacked: false },
    { density: "comfortable", stacked: true },
  ]) {
    h.change(prefs);
    assert.equal(h.current.dirty, true, JSON.stringify(prefs));
    assert.equal(h.dirtyCalls.at(-1), true, JSON.stringify(prefs));
    assert.equal(h.leaveIsBlocked(), true, JSON.stringify(prefs));
    h.change({ ...COMFORTABLE });
    assert.equal(h.current.dirty, false, JSON.stringify(prefs));
    assert.equal(h.dirtyCalls.at(-1), false, JSON.stringify(prefs));
    assert.equal(h.leaveIsBlocked(), false, JSON.stringify(prefs));
  }
  assert.equal(h.listeners.get("beforeunload").size, 1);

  // Leaving asks once per navigation: Cancel keeps the draft, Discard
  // restores the stored values. Neither writes anything.
  h.change({ density: "compact", stacked: true });
  h.answers.push(false);
  await h.link("widgets");
  h.render();
  assert.deepEqual(h.confirms, [DISCARD]);
  assert.deepEqual(plain(h.current.draftPrefs), {
    density: "compact",
    stacked: true,
  });
  assert.equal(h.current.dirty, true);
  h.answers.push(true);
  await h.link("widgets");
  h.render();
  assert.deepEqual(h.confirms, [DISCARD, DISCARD]);
  assert.deepEqual(plain(h.current.draftPrefs), COMFORTABLE);
  assert.equal(h.current.dirty, false);
  assert.equal(h.dirtyCalls.at(-1), false);
  assert.deepEqual(h.log, []);
  assert.deepEqual(h.sent, []);

  // A failed save writes nothing and keeps the draft.
  h.change({ density: "compact", stacked: true });
  h.state.failing = true;
  await h.save();
  assert.deepEqual(h.log, ["PUT settings"]);
  assert.deepEqual(h.sent, []);
  assert.deepEqual(h.locales, []);
  assert.equal(h.current.dirty, true);

  // A save writes both keys once, after the settings were saved, with one
  // event for the shown lists; the server never sees either preference.
  h.state.failing = false;
  h.log.length = 0;
  await h.save();
  assert.deepEqual(h.log, [
    "PUT settings",
    "GET settings",
    "saved",
    "set scopearr-density=compact",
    "set scopearr-tracks-stacked=true",
    "locale en",
    "Settings saved.",
  ]);
  assert.deepEqual(h.sent, ["scopearr-list-prefs"]);
  assert.deepEqual(Object.fromEntries(h.values), {
    "scopearr-density": "compact",
    "scopearr-tracks-stacked": "true",
  });
  assert.equal(h.puts.length, 2);
  for (const body of h.puts)
    for (const word of [
      "density",
      "stacked",
      "compact",
      "scopearr-density",
      "scopearr-tracks-stacked",
    ])
      assert.equal(body.includes(word), false, word + " in " + body);
  assert.deepEqual(plain(h.current.savedPrefs), {
    density: "compact",
    stacked: true,
  });
  assert.deepEqual(plain(h.current.draftPrefs), {
    density: "compact",
    stacked: true,
  });
  assert.equal(h.current.dirty, false);
  assert.equal(h.dirtyCalls.at(-1), false);
  assert.equal(h.leaveIsBlocked(), false);

  // A save without a changed preference writes neither key.
  h.log.length = 0;
  h.current.setCfg((cfg) => ({ ...cfg, pageSize: 37 }));
  h.render();
  await h.save();
  assert.deepEqual(h.log, [
    "PUT settings",
    "GET settings",
    "saved",
    "locale en",
    "Settings saved.",
  ]);
  assert.deepEqual(h.sent, ["scopearr-list-prefs"]);

  // Back to the defaults removes both keys.
  h.log.length = 0;
  h.change({ ...COMFORTABLE });
  assert.equal(h.current.dirty, true);
  await h.save();
  assert.deepEqual(h.log.slice(3, 5), [
    "remove scopearr-density",
    "remove scopearr-tracks-stacked",
  ]);
  assert.deepEqual(Object.fromEntries(h.values), {});
  assert.deepEqual(plain(h.current.savedPrefs), COMFORTABLE);
  assert.equal(h.current.dirty, false);
});

// AppearanceSettings with the stubs of settings-route.test.mjs.
function appearance({ tab, hidden = false, draftPrefs = COMFORTABLE }) {
  const changes = [];
  const state = [];
  let cursor = 0;
  const { AppearanceSettings } = loadSource(
    "components/AppearanceSettings.tsx",
    {
      modules: {
        "preact/hooks": {
          useState(initial) {
            const slot = cursor++;
            if (!(slot in state))
              state[slot] = typeof initial === "function" ? initial() : initial;
            return [state[slot], (next) => (state[slot] = next)];
          },
        },
        "../ui": {
          ICON: {},
          CardHeading: "CardHeading",
          SegmentedTabs: "SegmentedTabs",
          columnLabels: {},
          defaultColumnOrder: [],
          defaultColumns: [],
        },
        "../placement": { placementColumns: [], placementColumnLabels: {} },
        "../filecheck": { fileCheckColumns: [], fileCheckColumnLabels: {} },
        "../i18n": {
          LanguageSelect: "LanguageSelect",
          t,
          useI18n: () => ({ locale: "en" }),
        },
        "../themes": { interfaceThemes: [], themeLabels: {} },
        "../browser-storage": {
          readSessionPreference: () => null,
          writeSessionPreference() {},
        },
        "../confirmation": { confirmReset: async () => true },
        "./OrderedList": { OrderedList: "OrderedList" },
        "./ListLayoutSettings": {
          ListLayoutSettings: "ListLayoutSettings",
          infoLabels: {},
        },
      },
    },
  );
  const settings = {
    columnOrder: { radarr: [], sonarr: [] },
    visibleColumns: { radarr: [], sonarr: [] },
  };
  cursor = 0;
  const tree = AppearanceSettings({
    cfg: settings,
    saved: settings,
    setCfg() {},
    draftLocale: "en",
    setDraftLocale() {},
    draftPrefs,
    setDraftPrefs: (prefs) => changes.push(plain(prefs)),
    hidden,
    colors: "colors",
    dirtyTabs: {},
    tab,
    setTab() {},
  });
  return { tree, changes };
}

// The card around a control: the closest section.connection that holds it.
const cardOf = (tree, control) =>
  nodes(tree)
    .filter(
      (node) =>
        node.type === "section" &&
        node.props.class === "connection" &&
        nodes(node).includes(control),
    )
    .at(-1);

test("the display page offers both options with their hints", () => {
  // General: the card "Row density" with its select and hint.
  const general = appearance({
    tab: "general",
    draftPrefs: { density: "comfortable", stacked: true },
  });
  const select = nodes(general.tree).find(
    (node) =>
      node.type === "select" && node.props["aria-label"] === "Row density",
  );
  assert.ok(select, "the Row density select");
  assert.equal(select.props.value, "comfortable");
  assert.equal(select.props.class, "standalone-field");
  assert.deepEqual(
    plain(
      nodes(select.props.children)
        .filter((node) => node.type === "option")
        .map((node) => [node.props.value, text(node)]),
    ),
    [
      ["comfortable", "Comfortable"],
      ["compact", "Compact"],
    ],
  );
  const densityCard = cardOf(general.tree, select);
  assert.equal(text(find(densityCard, "h3")), "Row density");
  assert.equal(
    text(find(densityCard, "small")),
    "Compact rows show more entries at once. Applied after saving in this browser.",
  );
  // A choice changes only the density of the draft; anything but
  // "compact" is comfortable.
  select.props.onChange({ currentTarget: { value: "compact" } });
  select.props.onChange({ currentTarget: { value: "dense" } });
  assert.deepEqual(general.changes, [
    { density: "compact", stacked: true },
    { density: "comfortable", stacked: true },
  ]);
  // It sits between the TV view and pagination row and the resolution
  // groups.
  const panel = nodes(general.tree).find(
    (node) => node.props?.role === "tabpanel",
  );
  const shown = [].concat(panel.props.children).find(Boolean);
  const blocks = [].concat(shown.props.children).filter(Boolean);
  assert.deepEqual(
    blocks.map((block) =>
      block.props.class === "appearance-preferences"
        ? "row"
        : text(find(block, "h3")),
    ),
    ["row", "row", "Row density", "Resolution groups"],
  );
  assert.equal(
    nodes(general.tree).some(
      (node) =>
        node.type === "input" &&
        node.props.type === "checkbox" &&
        text(cardOf(general.tree, node)).includes("stacked"),
    ),
    false,
    "the stacked option is not on General",
  );

  // Lists & columns: the card "Audio tracks" after the column editor, with
  // the checkbox and its hint.
  const lists = appearance({
    tab: "lists",
    draftPrefs: { density: "compact", stacked: false },
  });
  const label = nodes(lists.tree).find(
    (node) =>
      node.type === "label" && text(node) === "Show audio tracks stacked",
  );
  assert.ok(label, "the stacked label");
  assert.equal(label.props.class, "check-field");
  const checkbox = find(label, "input");
  assert.equal(checkbox.props.type, "checkbox");
  assert.equal(checkbox.props.checked, false);
  const stackedCard = cardOf(lists.tree, checkbox);
  assert.equal(text(find(stackedCard, "h3")), "Audio tracks");
  assert.equal(
    text(find(stackedCard, "small")),
    "Stacked shows every audio track on its own line; otherwise up to two show and the others on demand. Applied after saving in this browser.",
  );
  const listPanel = nodes(lists.tree).find(
    (node) => node.props?.role === "tabpanel",
  );
  assert.deepEqual(
    plain(
      nodes(listPanel)
        .filter((node) => node.type === "section")
        .map((node) => node.props.class),
    ),
    ["connection list-columns-card", "connection"],
  );
  checkbox.props.onChange({ currentTarget: { checked: true } });
  assert.deepEqual(lists.changes, [{ density: "compact", stacked: true }]);
  assert.equal(
    nodes(lists.tree).some(
      (node) =>
        node.type === "select" && node.props["aria-label"] === "Row density",
    ),
    false,
    "the density is not on Lists & columns",
  );

  // While another settings area is shown, the hidden Display section keeps
  // its 1.7.0 markup: neither option renders there.
  for (const tab of ["general", "lists"]) {
    const hidden = appearance({ tab, hidden: true });
    const all = nodes(hidden.tree);
    assert.equal(
      all.some(
        (node) =>
          node.type === "select" && node.props["aria-label"] === "Row density",
      ),
      false,
      tab,
    );
    assert.equal(
      all.some((node) => text(node) === "Show audio tracks stacked"),
      false,
      tab,
    );
  }
});
