import test from "node:test";
import assert from "node:assert/strict";
import {
  loadSource,
  nodes,
  PRESENTATION_MODULES,
  text,
} from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";
import { squash, src } from "./helpers/sources.mjs";
import { Fragment } from "preact";

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

// Settings → Tag rules on the v2 blocks (Phase 5c, task 8, R4): its own
// band (SettingsHeader, Save settings saves the rule draft), the card
// "Rules" (a TableCard without chips and footer; the search, Add rule and
// the help in its head; a flat table sortable by all nine 1.7.0 fields,
// ties in natural order, D19) and the card "Preview filename" with a fixed
// row per field. The component runs as real code with the hook runtime;
// the blocks it places are named stubs, so a tree shows what each one
// receives.

const t = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");
const f = () => {};
const tick = () => new Promise((resolve) => setImmediate(resolve));
const data = (value) => JSON.parse(JSON.stringify(value ?? null));
const classes = (node) => String(node?.props?.class ?? "").split(" ");
const byClass = (tree, name) =>
  nodes(tree).filter((n) => classes(n).includes(name));
const ofType = (tree, type) => nodes(tree).filter((n) => n.type === type);
const one = (tree, type) => {
  const found = ofType(tree, type);
  assert.equal(found.length, 1, "one " + String(type?.name ?? type));
  return found[0];
};
const kids = (node) =>
  []
    .concat(node?.props?.children ?? [])
    .flat(Infinity)
    .filter(Boolean)
    .flatMap((child) => (child.type === Fragment ? kids(child) : [child]));
const named = (tree, label) =>
  nodes(tree).filter(
    (n) =>
      n.props?.["aria-label"] === label ||
      (n.type === "RowButton" && n.props.label === label),
  );
const button = (tree, label) => {
  const found = named(tree, label);
  assert.equal(found.length, 1, "one button " + label);
  return found[0];
};

let current = createHookRuntime();
const hooks = new Proxy(
  {},
  {
    get: (_, name) =>
      name === "useId" ? () => "settings-form" : current.hooks[name],
  },
);
const NAMES = { name: "CustomTagNames" };
function mount(component, props) {
  const runtime = createHookRuntime({
    contexts: new Map([[NAMES, { 7: "Kids" }]]),
  });
  const view = {
    runtime,
    props,
    render() {
      current = runtime;
      return runtime.settle(() => component(view.props));
    },
  };
  return view;
}

const themes = loadSource("themes.ts");
const model = loadSource("settings-model.ts", {
  modules: { "./themes": themes, "./event-log": loadSource("event-log.ts") },
});
const sortable = { nextTableSort: undefined };
{
  const { nextTableSort } = loadSource("table-sort.ts", {
    modules: {
      "../ui": { ICON: {} },
      "../i18n": { t },
    },
  });
  sortable.nextTableSort = nextTableSort;
}
const LABELS = {
  resolution: "Resolution",
  codec: "Codec / encoder",
  source: "Source",
  processing: "Processing",
  hdr: "HDR",
  bitDepth: "Bit depth",
  audio: "Audio codec",
  channels: "Channels",
  language: "Language",
  custom: "Custom",
};

// The rules as the server sends them. The channel defaults share priority
// 100 and their IDs are not in the order of their names: by ID 7.1 would
// stand between 1.0 and 2.0 and 6.1 after 7.1 (the 1.7.0 order).
const rule = (id, name, more = {}) => ({
  id,
  name,
  field: "channels",
  match: "regex",
  pattern: name.split(" / ")[1].replace(".", "\\."),
  value: name.split(" / ")[1],
  mode: "direct",
  priority: 100,
  enabled: true,
  consume: false,
  ...more,
});
const RULES = [
  rule("default-channels-24", "Channels / 7.1"),
  rule("default-channels-6-1", "Channels / 6.1"),
  rule("default-channels-1-0", "Channels / 1.0"),
  rule("default-channels-25", "Channels / 2.0"),
  rule("default-channels-26", "Channels / 5.1"),
  {
    id: "user-uhd",
    name: "Demo UHD source",
    field: "source",
    match: "token",
    pattern: "UHD",
    value: "UHD",
    mode: "override",
    priority: 95,
    enabled: false,
    tag: false,
    consume: false,
  },
  {
    id: "user-kids",
    name: "Kids folder",
    field: "custom",
    match: "regex",
    pattern: "(?i)kids",
    value: "7",
    mode: "fallback",
    priority: 120,
    enabled: true,
    consume: false,
  },
];
const NATURAL = [
  "Demo UHD source",
  "Channels / 1.0",
  "Channels / 2.0",
  "Channels / 5.1",
  "Channels / 6.1",
  "Channels / 7.1",
  "Kids folder",
];
const HEADS = [
  ["priority", "Priority"],
  ["enabled", "Enabled"],
  ["tag", "Tag color"],
  ["name", "Name"],
  ["field", "Attribute"],
  ["match", "Match type"],
  ["pattern", "Pattern"],
  ["value", "Result"],
  ["mode", "Mode"],
];

function rules({ rulesList = RULES, failing = false } = {}) {
  const log = {
    api: [],
    notes: [],
    dirty: [],
    confirms: [],
    saved: 0,
  };
  let answer, fail;
  const make = () =>
    new Promise((resolve, reject) => {
      answer = resolve;
      fail = reject;
    });
  let pending = make();
  let revision = 4;
  const api = async (path, method = "GET", body) => {
    log.api.push([method, path, data(body)]);
    if (path === "recognition" && method === "GET") return pending;
    if (path === "recognition" && method === "PUT") {
      if (failing) throw new Error("no");
      return { rules: structuredClone(body.rules), revision: ++revision };
    }
    if (path === "recognition/preview")
      return {
        values: { channels: "5.1", custom: "7" },
        matches: { channels: ["default-channels-26"], custom: ["user-kids"] },
        conflicts: [
          {
            field: "channels",
            values: ["5.1", "7.1"],
            ruleNames: ["Channels / 5.1", "Channels / 7.1"],
          },
        ],
      };
    throw new Error("unexpected " + method + " " + path);
  };
  const i18n = { t, useI18n: () => ({ locale: "en" }) };
  const unload = new Set();
  const window = {
    addEventListener: (type, fn) => type === "beforeunload" && unload.add(fn),
    removeEventListener: (type, fn) => unload.delete(fn),
  };
  // Whether leaving the page is held back (the 1.7.0 beforeunload guard).
  log.blocked = () => {
    let held = false;
    for (const fn of unload)
      fn({ preventDefault: () => (held = true), returnValue: undefined });
    return held;
  };
  const { RecognitionPage } = loadSource("components/RecognitionPage.tsx", {
    browser: { structuredClone, window },
    modules: {
      "preact/hooks": hooks,
      "../api": { api },
      "../i18n": i18n,
      "../confirmation": {
        confirmDeletion: async (message) => (log.confirms.push(message), true),
      },
      "../notifications": {
        notify: (message, kind) => log.notes.push([message, kind]),
      },
      "../recognition-options": loadSource("recognition-options.ts"),
      "../rule-draft": loadSource("rule-draft.ts"),
      "../rule-search": loadSource("rule-search.ts"),
      "../rule-id": { newRuleID: () => "new-rule" },
      "../settings-model": model,
      "../ui": {
        ICON: { button: 16, label: 15, empty: 28 },
        labels: LABELS,
        CustomTagNames: NAMES,
      },
      "../table-sort": sortable,
      "./RuleEditor": { RuleEditor: "RuleEditor" },
      "./list/HelpTip": { HelpTip: "HelpTip" },
      "./list/SortHeader": { SortHeader: "SortHeader", asFilmSort },
      "./list/TableCard": { TableCard: "TableCard" },
      "./settings/SettingsHeader": { SettingsHeader: "SettingsHeader" },
      "./settings/Card": loadSource("components/settings/Card.tsx"),
      "./settings/Field": loadSource("components/settings/Field.tsx"),
    },
    stubs: PRESENTATION_MODULES,
  });
  const open = () =>
    mount(RecognitionPage, {
      saved: async () => {
        log.saved++;
      },
      onDirty: (value) => log.dirty.push(value),
    });
  const view = open();
  const r = {
    log,
    view,
    tree: view.render(),
    render: () => (r.tree = r.view.render()),
    // The area opened again in this session (the same module): a new
    // mount, a new read.
    remount() {
      r.again();
      r.view = open();
      return r.render();
    },
    async answer(list = rulesList) {
      answer({ rules: structuredClone(list), revision });
      await tick();
      return r.render();
    },
    async fail(message = "Rules could not be read") {
      fail(new Error(message));
      await tick();
      return r.render();
    },
    again() {
      pending = make();
    },
    get header() {
      return one(r.tree, "SettingsHeader").props;
    },
    get card() {
      return one(r.tree, "TableCard");
    },
    get bar() {
      return r.card.props.bar;
    },
    get table() {
      return ofType(r.card, "table")[0];
    },
    get heads() {
      return ofType(ofType(r.table, "thead")[0], "tr")[0];
    },
    get rows() {
      return ofType(ofType(r.table, "tbody")[0], "tr");
    },
    get names() {
      return r.rows.map((row) => text(byClass(row, "v2-table-name")[0]));
    },
    get preview() {
      return nodes(r.tree).find(
        (n) =>
          n.type === "section" &&
          n.props["aria-labelledby"] === "recognition-preview-title",
      );
    },
    get previewRows() {
      return ofType(ofType(ofType(r.preview, "table")[0], "tbody")[0], "tr");
    },
  };
  return r;
}

test("rules build their band, card and preview from the v2 blocks", async () => {
  const r = rules();
  // The band: one SettingsHeader of the area, Save settings with the
  // area's action, locked until the rules are read.
  assert.equal(r.header.section, "recognition");
  assert.equal(r.header.segment, undefined);
  assert.equal(r.header.save.form, undefined, "no form: the area's action");
  assert.equal(r.header.save.disabled, true);
  assert.equal(r.header.save.busy, false);
  assert.equal(r.header.save.dirty, false);
  assert.equal(ofType(r.tree, "PageHeader").length, 0);
  assert.equal(ofType(r.tree, "SettingsSectionHeading").length, 0);
  // The page: a v2-set of the card Rules and the card Preview filename.
  const set = kids(r.tree).find((n) => classes(n).includes("v2-set"));
  assert.ok(set, "a v2-set");
  assert.deepEqual(
    kids(set).map((n) => (n.type === "TableCard" ? "TableCard" : n.type)),
    ["TableCard", "section"],
  );
  assert.ok(classes(kids(set)[1]).includes("v2-set-card"));
  // The card: a TableCard without chips and footer, titled Rules, its
  // count of the listed rules.
  const card = r.card.props;
  assert.equal(card.id, "recognition-rules");
  assert.equal(card.title, "Rules");
  assert.equal(card.countTitle, "Rules in the list");
  assert.equal(card.regionLabel, "Tag rules");
  assert.equal(card.density, "comfortable");
  assert.equal(card.chips, undefined);
  assert.equal(card.foot, undefined);
  assert.equal(card.busy, true, "the spinner turns until the rules arrive");
  // Until the answer: placeholder rows under the real heads, hidden from
  // assistive technology; the loading text stays for screen readers. They
  // reserve the expected rules: before the first read the shipped default
  // rules (64), so the Preview card starts below the fold (a 48 row each
  // from y 253: 64 rows end past 3 300, more than any viewport's height;
  // 25 would already pass 1 440). The count shows the same number, so its
  // pill keeps its width when the rules arrive.
  assert.equal(r.rows.length, 64);
  assert.ok(r.rows.length * 48 + 253 > 1440, "the preview below the fold");
  assert.equal(card.count, 64);
  for (const row of r.rows) {
    assert.ok(classes(row).includes("v2-row--placeholder"));
    assert.equal(row.props["aria-hidden"], "true");
    assert.equal(ofType(row, "td").length, 10);
  }
  const loading = byClass(r.card, "v2-sr-only");
  assert.equal(loading.length, 1);
  assert.equal(text(loading[0]), "Loading rules …");
  assert.equal(loading[0].props.role, "status");
  assert.equal(byClass(r.tree, "quiet").length, 0, "no 1.7.0 paragraph");
  assert.equal(ofType(r.heads, "SortHeader").length, 9);
  // The head row: the search, Add rule (locked until the rules are read)
  // and the help (ruling R-P).
  assert.ok(classes(r.bar).includes("v2-filter-bar"));
  const search = button(r.bar, "Search recognition rules");
  assert.equal(search.type, "input");
  assert.equal(search.props.type, "search");
  assert.ok(classes(search).includes("v2-input"));
  assert.equal(search.props.placeholder, "Search all rule columns …");
  const add = () => ofType(r.bar, "button").find((n) => text(n) === "Add rule");
  assert.equal(add().props.disabled, true);
  const help = one(r.bar, "HelpTip").props;
  assert.equal(help.label, "Tag rules help");
  assert.deepEqual(data(help.sections.map((s) => s.heading)), [
    "Modes",
    "Priority and conflicts",
  ]);
  // The help says how ties list in the table and how they run (T2-M1).
  assert.match(
    help.sections[1].text,
    /^Lower priority numbers run first; ties run in rule ID order\. The table lists ties by name; sorting it does not change priority\./,
  );
  assert.doesNotMatch(help.sections[1].text, /ties use the rule ID/);
  assert.match(help.sections[0].text, /^Direct recognition · /);
  // The preview card is there from the first paint.
  assert.ok(r.preview, "the preview card");
  assert.equal(text(ofType(r.preview, "h2")[0]), "Preview filename");

  // The answer: the rules replace the placeholders, Add rule unlocks.
  await r.answer();
  assert.equal(r.card.props.count, 7);
  assert.equal(r.card.props.busy, false);
  assert.equal(r.rows.length, 7);
  assert.equal(byClass(r.card, "v2-row--placeholder").length, 0);
  assert.equal(byClass(r.card, "v2-sr-only").length, 0);
  assert.equal(add().props.disabled, false);
  assert.equal(r.header.save.disabled, true, "nothing changed yet");
  // Opened again in this session: the rows and the count of the last read.
  const back = rules();
  await back.answer();
  back.remount();
  assert.equal(back.rows.length, 7);
  assert.ok(
    back.rows.every((row) => classes(row).includes("v2-row--placeholder")),
  );
  assert.equal(back.card.props.count, 7);
  await back.answer();
  assert.equal(back.rows.length, 7);
  assert.equal(byClass(back.card, "v2-row--placeholder").length, 0);
  // A delete saves 6 rules: the next visit reserves 6.
  await button(back.rows[1], "Delete rule: Channels / 1.0").props.onClick();
  await tick();
  back.remount();
  assert.equal(back.rows.length, 6);
  assert.equal(back.card.props.count, 6);
  // A search narrows the list and its count.
  search.props.onInput({ currentTarget: { value: "channels 5.1" } });
  r.render();
  assert.equal(r.card.props.count, 1);
  assert.deepEqual(r.names, ["Channels / 5.1"]);
  button(r.bar, "Search recognition rules").props.onInput({
    currentTarget: { value: "nothing like it" },
  });
  r.render();
  assert.equal(r.card.props.count, 0);
  assert.equal(r.table, undefined);
  assert.equal(one(r.card, "ListEmpty").props.title, "No matching rules.");
  // No rules at all: the 1.7.0 text as the empty state.
  const empty = rules();
  await empty.answer([]);
  assert.equal(
    one(empty.card, "ListEmpty").props.title,
    "No filename rules. Only API and media server metadata will be used.",
  );
  // 256 rules lock Add rule.
  const full = rules();
  await full.answer(
    Array.from({ length: 256 }, (_, i) => rule("r" + i, "Channels / " + i)),
  );
  assert.equal(
    ofType(full.bar, "button").find((n) => text(n) === "Add rule").props
      .disabled,
    true,
  );
  // Add rule opens the 1.7.0 editor with the 1.7.0 defaults.
  add().props.onClick();
  r.render();
  assert.deepEqual(data(one(r.tree, "RuleEditor").props.rule), {
    id: "new-rule",
    name: "",
    field: "resolution",
    match: "token",
    pattern: "",
    value: "",
    mode: "fallback",
    priority: 100,
    enabled: true,
    consume: false,
  });

  // An error: its text as the empty state and "Reload rules", which reads
  // the rules again.
  const broken = rules();
  await broken.fail();
  const state = one(broken.card, "ListEmpty");
  assert.equal(state.props.title, "Rules could not be read");
  const reload = ofType(state, "button").find(
    (n) => text(n) === "Reload rules",
  );
  assert.ok(reload, "Reload rules");
  assert.ok(classes(reload).includes("v2-btn"));
  assert.equal(broken.card.props.busy, false);
  // The count matches the empty table, not the reserved rows.
  assert.equal(broken.card.props.count, 0);
  broken.again();
  reload.props.onClick();
  assert.equal(broken.log.api.filter(([, p]) => p === "recognition").length, 2);
  await broken.answer();
  assert.equal(broken.rows.length, 7);

  // Save settings saves the draft (a checkbox change) with the 1.7.0
  // request and notes; the area's guard reports it.
  const s = rules();
  await s.answer();
  button(s.rows[0], "Enable rule: Demo UHD source").props.onChange({
    currentTarget: { checked: true },
  });
  s.render();
  assert.equal(s.header.save.disabled, false);
  assert.equal(s.header.save.dirty, true);
  assert.equal(s.log.dirty.at(-1), true);
  assert.equal(s.log.blocked(), true, "an unsaved draft holds the unload");
  s.header.save.action();
  await tick();
  s.render();
  const [method, path, body] = s.log.api.at(-1);
  assert.deepEqual([method, path, body.revision], ["PUT", "recognition", 4]);
  assert.equal(body.rules.find((x) => x.id === "user-uhd").enabled, true);
  assert.deepEqual(s.log.notes.at(-1), [
    "Rules saved. Cached filenames have been reprocessed.",
    undefined,
  ]);
  assert.equal(s.log.saved, 1);
  assert.equal(s.header.save.disabled, true);
  assert.equal(s.log.dirty.at(-1), false);
  assert.equal(s.log.blocked(), false);
  s.view.runtime.unmount();
  assert.equal(s.log.dirty.at(-1), false);
});

test("rules with the same priority list naturally", async () => {
  const r = rules();
  await r.answer();
  // Priority first, ties by name in natural order (D19), not by ID.
  assert.deepEqual(r.names, NATURAL);
  assert.deepEqual(
    r.rows.map((row) => text(ofType(row, "td")[0])),
    ["95", "100", "100", "100", "100", "100", "120"],
  );
  // Sorting by another column keeps the natural order within its ties:
  // every channel rule has the attribute Channels.
  ofType(r.heads, "SortHeader")
    .find((n) => n.props.field === "field")
    .props.onSort("field");
  r.render();
  assert.deepEqual(r.names, [
    "Channels / 1.0",
    "Channels / 2.0",
    "Channels / 5.1",
    "Channels / 6.1",
    "Channels / 7.1",
    "Kids folder",
    "Demo UHD source",
  ]);
  // The table uses the model's order; the execution order (priority, then
  // ID) is the server's and unchanged.
  assert.match(
    squash(src("components/RecognitionPage.tsx")),
    /sortRules\(filtered, sort, customNames\)/,
  );
});

test("every rule column sorts and keeps aria-sort", async () => {
  const r = rules();
  await r.answer();
  const header = (field) =>
    ofType(r.heads, "SortHeader").find((n) => n.props.field === field);
  // Nine sort heads named by the 1.7.0 labels, then the plain Actions.
  assert.deepEqual(
    ofType(r.heads, "SortHeader").map((n) => [n.props.field, n.props.label]),
    HEADS,
  );
  const ths = kids(r.heads);
  assert.equal(ths.length, 10);
  assert.equal(ths[9].type, "th");
  assert.equal(ths[9].props.scope, "col");
  assert.equal(text(ths[9]), "Actions");
  assert.equal(header("priority").props.numeric, true);
  assert.equal(header("name").props.grow, true);
  for (const [field] of HEADS.filter(([f]) => f !== "priority"))
    assert.equal(header(field).props.numeric, false, field);
  // The default: priority ascending, shown on its head.
  assert.deepEqual(data(header("priority").props.sort), {
    field: "priority",
    direction: "asc",
  });
  // Each column: ascending, descending, then back to the default.
  for (const [field] of HEADS) {
    header(field).props.onSort(field);
    r.render();
    assert.deepEqual(data(header(field).props.sort), {
      field,
      direction: "asc",
    });
    header(field).props.onSort(field);
    r.render();
    assert.deepEqual(data(header(field).props.sort), {
      field,
      direction: "desc",
    });
    header(field).props.onSort(field);
    r.render();
    assert.deepEqual(data(header("priority").props.sort), {
      field: "priority",
      direction: "asc",
    });
    assert.deepEqual(r.names, NATURAL, field + " returns to the default");
  }
  // Name descending reverses the names; Result sorts a custom value by its
  // tag name ("Kids").
  header("name").props.onSort("name");
  r.render();
  header("name").props.onSort("name");
  r.render();
  assert.deepEqual(r.names, [...NATURAL].sort().reverse());
  header("value").props.onSort("value");
  r.render();
  assert.equal(r.names.at(-1), "Demo UHD source", "UHD after Kids");
  assert.equal(r.names.at(-2), "Kids folder");
  // The real SortHeader turns the sort into aria-sort.
  const { SortHeader } = loadSource("components/list/SortHeader.tsx", {
    modules: {
      "preact/hooks": { useState: (value) => [value, f] },
      "../../i18n": { t, useI18n: () => ({ locale: "en" }) },
      "../../ui": { ICON: { arrow: 12 } },
      "../frame/Popover": { Popover: "Popover" },
    },
  });
  const sortOf = (sort) =>
    SortHeader({ label: "Name", field: "name", sort, onSort: f }).props[
      "aria-sort"
    ];
  assert.equal(sortOf({ field: "name", direction: "asc" }), "ascending");
  assert.equal(sortOf({ field: "name", direction: "desc" }), "descending");
  assert.equal(sortOf({ field: "priority", direction: "asc" }), "none");
});

test("rule rows keep enable, tag color, edit and delete", async () => {
  const r = rules();
  await r.answer();
  const row = (name) => r.rows[r.names.indexOf(name)];
  const cells = (name) => ofType(row(name), "td");
  // Every cell names its column; the priority is a number, the name the
  // row's wide cell.
  assert.deepEqual(
    ofType(r.rows[0], "td").map((td) => td.props["data-label"]),
    [...HEADS.map(([, label]) => label), "Actions"],
  );
  assert.ok(classes(cells("Kids folder")[0]).includes("v2-table-num"));
  assert.ok(classes(cells("Kids folder")[3]).includes("v2-table-wide"));
  // A disabled rule is muted; the others are plain rows.
  assert.deepEqual(classes(row("Demo UHD source")), ["v2-row", "v2-row--off"]);
  assert.deepEqual(classes(row("Kids folder")), ["v2-row"]);
  // Name with "Default rule" below for the defaults only.
  assert.equal(
    text(byClass(cells("Channels / 5.1")[3], "v2-table-sub")[0]),
    "Default rule",
  );
  assert.equal(byClass(cells("Kids folder")[3], "v2-table-sub").length, 0);
  // Attribute, match type, pattern (monospace, cut, its title), result
  // (a custom value by its tag name) and mode as in 1.7.0.
  assert.deepEqual(
    [4, 5, 7, 8].map((at) => text(cells("Kids folder")[at])),
    ["Custom", "Regular expression", "Kids", "Only if missing"],
  );
  assert.deepEqual(
    [4, 5, 7, 8].map((at) => text(cells("Demo UHD source")[at])),
    ["Source", "Token", "UHD", "Explicit override"],
  );
  const pattern = ofType(cells("Kids folder")[6], "code")[0];
  assert.deepEqual(classes(pattern), ["v2-table-mono", "v2-set-pattern"]);
  assert.equal(pattern.props.title, "(?i)kids");
  assert.equal(text(pattern), "(?i)kids");
  // Enabled and Tag color: checkboxes of the draft, named per rule.
  const enable = button(row("Kids folder"), "Enable rule: Kids folder");
  assert.equal(enable.type, "input");
  assert.equal(enable.props.type, "checkbox");
  assert.ok(classes(enable).includes("v2-check"));
  assert.equal(enable.props.checked, true);
  const color = button(
    row("Demo UHD source"),
    "Use tag color: Demo UHD source",
  );
  assert.equal(color.props.checked, false);
  assert.equal(
    button(row("Kids folder"), "Use tag color: Kids folder").props.checked,
    true,
  );
  enable.props.onChange({ currentTarget: { checked: false } });
  r.render();
  assert.deepEqual(classes(row("Kids folder")), ["v2-row", "v2-row--off"]);
  button(
    row("Demo UHD source"),
    "Use tag color: Demo UHD source",
  ).props.onChange({ currentTarget: { checked: true } });
  r.render();
  assert.equal(
    button(row("Demo UHD source"), "Use tag color: Demo UHD source").props
      .checked,
    true,
  );
  assert.equal(r.header.save.dirty, true, "checkbox changes wait for Save");
  assert.equal(r.log.api.length, 1, "nothing sent yet");
  // Edit: a row button that opens the 1.7.0 editor with the rule; its save
  // sends the saved rules with the edit and keeps the draft's other edits.
  const edit = button(row("Channels / 6.1"), "Edit rule: Channels / 6.1");
  assert.equal(edit.type, "RowButton");
  edit.props.onClick();
  r.render();
  const editor = one(r.tree, "RuleEditor").props;
  assert.equal(editor.rule.id, "default-channels-6-1");
  await editor.save({ ...editor.rule, priority: 90 });
  await tick();
  r.render();
  const sent = r.log.api.at(-1);
  assert.deepEqual([sent[0], sent[1]], ["PUT", "recognition"]);
  assert.equal(
    sent[2].rules.find((x) => x.id === "default-channels-6-1").priority,
    90,
  );
  assert.equal(
    sent[2].rules.find((x) => x.id === "user-kids").enabled,
    true,
    "the saved rules, not the draft",
  );
  assert.equal(ofType(r.tree, "RuleEditor").length, 0, "closed after save");
  assert.equal(r.names[0], "Channels / 6.1", "priority 90 first");
  assert.deepEqual(
    classes(row("Kids folder")),
    ["v2-row", "v2-row--off"],
    "the draft's change stays",
  );
  // Delete: a danger row button with the 1.7.0 question, saved at once.
  const del = button(row("Channels / 2.0"), "Delete rule: Channels / 2.0");
  assert.equal(del.props.tone, "danger");
  assert.equal(del.props.disabled, false);
  await del.props.onClick();
  await tick();
  r.render();
  assert.equal(r.log.confirms.at(-1), "Delete rule Channels / 2.0?");
  const removed = r.log.api.at(-1);
  assert.deepEqual([removed[0], removed[1]], ["PUT", "recognition"]);
  assert.equal(
    removed[2].rules.some((x) => x.id === "default-channels-25"),
    false,
  );
  assert.equal(r.rows.length, 6);
  // Both buttons sit in one items cell.
  assert.equal(
    ofType(byClass(row("Kids folder"), "v2-table-items")[0], "RowButton")
      .length,
    2,
  );
  // While a save runs, every checkbox and row button is locked.
  const busy = rules();
  await busy.answer();
  button(busy.rows[0], "Enable rule: Demo UHD source").props.onChange({
    currentTarget: { checked: true },
  });
  busy.render();
  busy.header.save.action();
  busy.render();
  assert.equal(busy.header.save.busy, true);
  assert.equal(busy.card.props.busy, true);
  for (const name of [
    "Enable rule: Kids folder",
    "Use tag color: Kids folder",
    "Edit rule: Kids folder",
    "Delete rule: Kids folder",
  ])
    assert.equal(button(busy.rows.at(-1), name).props.disabled, true, name);
  await tick();
});

test("the preview keeps its rows before and after a preview", async () => {
  const r = rules();
  const FIELDS = Object.values(LABELS);
  const shown = () =>
    r.previewRows.map((row) => ofType(row, "td").map((td) => text(td)));
  // Before the rules: one row per field, "—" in Result and Matching rules,
  // Preview locked.
  assert.deepEqual(
    ofType(ofType(r.preview, "thead")[0], "th").map((th) => text(th)),
    ["Attribute", "Result", "Matching rules"],
  );
  assert.deepEqual(
    shown(),
    FIELDS.map((label) => [label, "—", "—"]),
  );
  const form = ofType(r.preview, "form")[0];
  assert.ok(classes(form).includes("v2-set-preview"));
  const submit = () =>
    ofType(ofType(r.preview, "form")[0], "button").find(
      (n) => text(n) === "Preview",
    );
  assert.equal(submit().props.type, "submit");
  assert.equal(submit().props.disabled, true);
  assert.equal(
    text(ofType(r.preview, "p")[0]),
    "Preview uses the current rule draft and the filename only. API and media server enrichment is not included.",
  );
  // The Filename field (field()): label, required, 2048 at most.
  const field = byClass(form, "v2-field")[0];
  assert.equal(text(ofType(field, "label")[0]), "Filename");
  const input = () => ofType(ofType(r.preview, "form")[0], "input")[0];
  assert.equal(input().props.id, ofType(field, "label")[0].props.for);
  assert.equal(input().props.required, true);
  assert.equal(input().props.maxLength, 2048);
  assert.ok(classes(input()).includes("v2-input"));
  await r.answer();
  assert.equal(submit().props.disabled, false);
  assert.equal(r.previewRows.length, FIELDS.length);
  // A preview: the same rows with the values and matching rules (a custom
  // value by its tag name), the conflict notice below the table.
  input().props.onInput({ currentTarget: { value: "Movie.5.1.mkv" } });
  r.render();
  await ofType(r.preview, "form")[0].props.onSubmit({ preventDefault: f });
  await tick();
  r.render();
  assert.deepEqual(r.log.api.at(-1), [
    "POST",
    "recognition/preview",
    { rules: data(RULES), filename: "Movie.5.1.mkv" },
  ]);
  assert.equal(r.previewRows.length, FIELDS.length);
  const after = shown();
  assert.deepEqual(after[7], ["Channels", "5.1", "Channels / 5.1"]);
  assert.deepEqual(after[9], ["Custom", "Kids", "Kids folder"]);
  assert.deepEqual(after[0], ["Resolution", "Unknown", "—"]);
  const card = kids(r.preview);
  const notice = card.at(-1);
  assert.ok(classes(notice).includes("v2-notice--warn"));
  assert.equal(text(ofType(notice, "b")[0]), "Conflicting recognition rules");
  assert.equal(
    text(ofType(notice, "p")[0]),
    "Channels: 5.1 / 7.1 · Channels / 5.1 · Channels / 7.1",
  );
  assert.ok(
    card.findIndex((n) => byClass(n, "v2-table").length) < card.indexOf(notice),
    "the notice below the table",
  );
  // Typing again drops the preview: "—" again, the same rows.
  input().props.onInput({ currentTarget: { value: "Other.mkv" } });
  r.render();
  assert.deepEqual(
    shown(),
    FIELDS.map((label) => [label, "—", "—"]),
  );
  assert.equal(byClass(r.preview, "v2-notice").length, 0);
});

// SettingsPage with a fake draft: what it renders for Tag rules.
// The rules chunk loads through lazyChunk/useLazyChunk: `chunk.fail`
// import()s fail (a rejection), `chunk.empty` resolve without the export
// (Vite's preload recovery resolves undefined); idle preloads wait in
// `chunk.idle` until a test runs them.
function page({
  section,
  dirty = false,
  busy = false,
  demo = true,
  fail = 0,
  empty = 0,
}) {
  const draft = {
    cfg: { instances: [], tagColors: {}, tagTextColors: {}, hiddenTags: {} },
    setCfg: f,
    draftLocale: "en",
    setDraftLocale: f,
    draftPrefs: {
      density: "comfortable",
      stacked: { radarr: false, sonarr: false },
      filename: { radarr: true, sonarr: true },
    },
    setDraftPrefs: f,
    savedPrefs: {
      density: "comfortable",
      stacked: { radarr: false, sonarr: false },
      filename: { radarr: true, sonarr: true },
    },
    look: {},
    setLook: f,
    mode: "dark",
    dirty,
    setRulesDirty: f,
    setCustomDirty: f,
    busy,
    confirmSectionChange: async () => true,
    saveSettings: async () => {},
    submit: f,
    confirmTags: f,
    tagChanges: null,
    setTagChanges: f,
    tagSaveReview: null,
    setTagSaveReview: f,
  };
  const refresh = async () => {};
  const chunk = {
    loads: 0,
    fail,
    empty,
    idle: [],
    notes: [],
    preloadErrors: [],
  };
  const window = {
    addEventListener: f,
    removeEventListener: f,
    requestIdleCallback: (run) => chunk.idle.push(run),
    cancelIdleCallback: f,
  };
  const lazy = loadSource("hooks/useLazyChunk.ts", {
    browser: { window },
    modules: {
      "preact/hooks": hooks,
      "../i18n": { t },
      "../notifications": {
        notify: (message, kind) => chunk.notes.push([message, kind]),
      },
    },
  });
  // The build wraps the module's import() in Vite's preload helper: when
  // the import rejects there, it raises vite:preloadError (and
  // preload-recovery.ts reloads the page) before it throws on.
  const vitePreload = (load) => () =>
    load().catch((error) => {
      chunk.preloadErrors.push(error);
      throw error;
    });
  const { SettingsPage } = loadSource("components/SettingsPage.tsx", {
    browser: { window, AbortController },
    modules: {
      "preact/hooks": hooks,
      // The rules chunk (import()): counted, a named stub.
      get "./RecognitionPage"() {
        chunk.loads++;
        if (chunk.fail > 0) {
          chunk.fail--;
          throw new Error("chunk");
        }
        if (chunk.empty > 0) {
          chunk.empty--;
          return undefined;
        }
        return { RecognitionPage: "RecognitionPage" };
      },
      "../hooks/useLazyChunk": {
        ...lazy,
        lazyChunk: (load) => lazy.lazyChunk(vitePreload(load)),
      },
      "./SettingsSectionHeading": {
        SettingsSectionHeading: "SettingsSectionHeading",
      },
      "../ui": { colorFields: ["resolution"] },
      "../instances": loadSource("instances.ts"),
      "../i18n": { t, useI18n: () => ({ locale: "en" }) },
      "../notifications": { notify: f },
      "./AppearanceSettings": {
        AppearanceSettings: "AppearanceSettings",
        useDisplayTab: () => ["general", f],
      },
      "./ConnectionSettings": { ConnectionSettings: "ConnectionSettings" },
      "./CustomTagsSettings": { CustomTagsSettings: "CustomTagsSettings" },
      "./SystemSettings": {
        SystemSettingsInfo: "SystemSettingsInfo",
        SystemSettingsLog: "SystemSettingsLog",
        useSystemTab: () => ["info", f],
      },
      "./settings/SettingsHeader": { SettingsHeader: "SettingsHeader" },
      "./TagPolicyDialog": { TagPolicyDialog: "TagPolicyDialog" },
      "./TagReview": { TagReview: "TagReview" },
      "./WidgetsSettings": { WidgetsSettings: "WidgetsSettings" },
      "./settings/TagColorsCard": { TagColorsCard: "TagColorsCard" },
      "./settings/WarningColorsCard": {
        WarningColorsCard: "WarningColorsCard",
      },
      "../api": { api: async () => [] },
      "../hooks/useSettingsDraft": { useSettingsDraft: () => draft },
      "../appearance": {
        setBandPreference: f,
        setTheme: f,
        storedBand: () => null,
      },
      "../settings-model": model,
    },
    stubs: PRESENTATION_MODULES,
  });
  const view = mount(SettingsPage, {
    customTags: [],
    customChanged: async () => [],
    settings: draft.cfg,
    status: { recognitionRevision: 0, cacheRevision: 0, sync: {} },
    summary: {},
    demo,
    saved: async () => {},
    onDirty: f,
    refresh,
    section,
    registerSectionGuard: f,
    tab: "",
    setTab: f,
    logQuery: "",
    setLogQuery: f,
    revision: 0,
    theme: "dark",
    onTheme: f,
  });
  const p = {
    draft,
    refresh,
    chunk,
    view,
    tree: view.render(),
    render: () => (p.tree = view.render()),
  };
  return p;
}

test("the lazy rules page keeps the band while it loads", async () => {
  for (const dirty of [false, true]) {
    const p = page({ section: "recognition", dirty });
    // Until the chunk is there, the area's band stands in its place with
    // Save locked: the same header the page renders, so the band never
    // shows a gap. Not a Suspense fallback (see SettingsPage).
    assert.equal(ofType(p.tree, "Suspense").length, 0);
    const band = one(p.tree, "SettingsHeader").props;
    assert.equal(band.section, "recognition");
    assert.equal(band.segment, undefined);
    assert.deepEqual(data(band.save), {
      busy: false,
      disabled: true,
      dirty: false,
    });
    assert.equal(ofType(p.tree, "RecognitionPage").length, 0);
    // No 1.7.0 title or heading; the settings form hidden and without the
    // demo notice.
    assert.equal(ofType(p.tree, "PageHeader").length, 0);
    assert.equal(ofType(p.tree, "SettingsSectionHeading").length, 0);
    const form = ofType(p.tree, "form").find(
      (n) => n.props.id === "settings-form",
    );
    assert.equal(form.props.hidden, true);
    assert.equal(byClass(form, "v2-notice").length, 0);
    // The chunk arrives: the page takes the band's place with its guard and
    // refresh; it renders its own band, so this page renders none.
    await tick();
    p.render();
    assert.equal(p.chunk.loads, 1);
    const rules = one(p.tree, "RecognitionPage").props;
    assert.equal(rules.onDirty, p.draft.setRulesDirty);
    assert.equal(rules.saved, p.refresh);
    assert.equal(ofType(p.tree, "SettingsHeader").length, 0);
    // Another area and back: the page at once, no second load.
    p.view.props = { ...p.view.props, section: "connections" };
    p.render();
    assert.equal(ofType(p.tree, "RecognitionPage").length, 0);
    p.view.props = { ...p.view.props, section: "recognition" };
    p.render();
    assert.equal(ofType(p.tree, "RecognitionPage").length, 1);
    assert.equal(ofType(p.tree, "SettingsHeader").length, 0);
    for (const run of p.chunk.idle) run();
    await tick();
    assert.equal(p.chunk.loads, 1, "the idle preload finds it there");
    assert.deepEqual(p.chunk.notes, []);
  }
  // Leaving while it loads and coming back before it is there: one load
  // (the import in flight is shared), the page once it arrives.
  const mid = page({ section: "recognition" });
  mid.view.props = { ...mid.view.props, section: "connections" };
  mid.render();
  mid.view.props = { ...mid.view.props, section: "recognition" };
  mid.render();
  assert.equal(one(mid.tree, "SettingsHeader").props.section, "recognition");
  await tick();
  mid.render();
  assert.equal(mid.chunk.loads, 1);
  assert.equal(ofType(mid.tree, "RecognitionPage").length, 1);
  // Leaving for good while it loads: nothing renders it later, no notice.
  const gone = page({ section: "recognition" });
  gone.view.props = { ...gone.view.props, section: "connections" };
  gone.render();
  await tick();
  gone.render();
  assert.equal(ofType(gone.tree, "RecognitionPage").length, 0);
  assert.deepEqual(gone.chunk.notes, []);
  // A failed load is tried once more; the retry brings the page.
  const retry = page({ section: "recognition", fail: 1 });
  await tick();
  await tick();
  retry.render();
  assert.equal(retry.chunk.loads, 2);
  assert.equal(ofType(retry.tree, "RecognitionPage").length, 1);
  assert.deepEqual(retry.chunk.notes, []);
  // Both fail (a rejection, then a module without the page, as Vite's
  // preload recovery resolves): the error notice, no unhandled rejection,
  // the band stays locked; coming back tries again.
  const broken = page({ section: "recognition", fail: 1, empty: 1 });
  await tick();
  await tick();
  broken.render();
  assert.equal(broken.chunk.loads, 2);
  assert.deepEqual(broken.chunk.notes, [
    ["Scopearr is not reachable", "error"],
  ]);
  assert.equal(ofType(broken.tree, "RecognitionPage").length, 0);
  assert.equal(one(broken.tree, "SettingsHeader").props.save.disabled, true);
  broken.view.props = { ...broken.view.props, section: "connections" };
  broken.render();
  broken.view.props = { ...broken.view.props, section: "recognition" };
  broken.render();
  await tick();
  broken.render();
  assert.equal(broken.chunk.loads, 3);
  assert.equal(ofType(broken.tree, "RecognitionPage").length, 1);
  // The other areas preload it once at idle, never at once.
  const services = page({ section: "connections" });
  await tick();
  assert.equal(services.chunk.loads, 0);
  assert.equal(services.chunk.idle.length, 1);
  services.chunk.idle[0]();
  await tick();
  assert.equal(services.chunk.loads, 1);
  services.view.props = { ...services.view.props, section: "recognition" };
  services.render();
  assert.equal(ofType(services.tree, "RecognitionPage").length, 1);
  assert.equal(ofType(services.tree, "SettingsHeader").length, 0);
  // System has its band's header too since task 9.
  const system = page({ section: "system" });
  assert.equal(one(system.tree, "SettingsHeader").props.section, "system");
  assert.equal(ofType(system.tree, "PageHeader").length, 0);
});

test("a failed rules chunk shows the notice and never reloads", async () => {
  // A stale tab after an update or a short outage: the import() rejects
  // twice. Its handler sits on the import() itself, inside Vite's preload
  // wrapper, so no vite:preloadError reaches preload-recovery.ts (which
  // would reload the page); opening Tag rules shows the notice instead.
  const idle = page({ section: "connections", fail: 2 });
  for (const run of idle.chunk.idle) run();
  await tick();
  await tick();
  assert.equal(idle.chunk.loads, 1);
  assert.deepEqual(idle.chunk.preloadErrors, []);
  assert.deepEqual(idle.chunk.notes, []);
  idle.view.props = { ...idle.view.props, section: "recognition" };
  idle.render();
  await tick();
  await tick();
  idle.render();
  assert.equal(idle.chunk.loads, 2);
  assert.deepEqual(idle.chunk.preloadErrors, []);
  assert.deepEqual(idle.chunk.notes, [["Scopearr is not reachable", "error"]]);
  assert.equal(ofType(idle.tree, "RecognitionPage").length, 0);
  assert.equal(one(idle.tree, "SettingsHeader").props.save.disabled, true);
  // Opened straight away: the same.
  const open = page({ section: "recognition", fail: 2 });
  await tick();
  await tick();
  open.render();
  assert.equal(open.chunk.loads, 2);
  assert.deepEqual(open.chunk.preloadErrors, []);
  assert.deepEqual(open.chunk.notes, [["Scopearr is not reachable", "error"]]);
});

test("rules drop the transition sheet", () => {
  // The source: no 1.7.0 parts left in the rules page.
  const code = squash(src("components/RecognitionPage.tsx"));
  assert.doesNotMatch(
    code,
    /SettingsSectionHeading|HelpPopover|SortableHeader[^"]|<SortableHeader|Tooltip|class="(?:settings-card|card-heading|card-title|filter-count|results-tools|search-field|input-wrap|table-wrap|data-table|detail-table|recognition-\w+|icon-button|button|quiet|notice)"/,
  );
  assert.match(code, /<SettingsHeader section="recognition"/);
  assert.match(code, /<TableCard/);
  assert.match(code, /<SortHeader/);
  assert.match(code, /asFilmSort\(sort, "priority"\)/);
});

test("the reserved rule rows match the shipped default rules", async () => {
  // SHIPPED_RULES holds the table until the rules arrive; it must stay the
  // count of DefaultRecognitionRules, which the Go test pins as the 1.7.0
  // count plus the 2.0.0 additions.
  const { readFile } = await import("node:fs/promises");
  const go = await readFile(
    new URL("../../internal/app/release_200_rules_test.go", import.meta.url),
    "utf8",
  );
  const base = +go.match(/const defaultRuleCount170 = (\d+)/)[1];
  const added = +go.match(/len\(rules\) != defaultRuleCount170\+(\d+)/)[1];
  const web = +src("components/RecognitionPage.tsx").match(
    /const SHIPPED_RULES = (\d+);/,
  )[1];
  assert.equal(web, base + added);
});
