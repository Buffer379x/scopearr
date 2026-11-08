import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import * as preact from "preact";
import { loadSource, nodes, text } from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";
import { src } from "./helpers/sources.mjs";
import * as color from "../src/color.ts";
import * as filters from "../src/library-filters.ts";
import * as languages from "../src/languages.ts";
import * as resolution from "../src/resolution-groups.ts";
import * as tagDisplay from "../src/tag-display.ts";
import * as tagLabels from "../src/tag-labels.ts";
import * as units from "../src/units.ts";

// The filter drawer of the libraries (Phase 5a, task 7; docs/STYLEGUIDE.md,
// Part 1, 10.4 and 10.5): the general FilterDrawer, the library's fields
// (FilterFields), LibraryFilterDrawer with its draft, useMatchCount and the
// loader of the drawer's own chunk (ruling P10), built but not mounted yet.
// Each component runs as real code with the hook runtime; Popover, HelpTip
// and the fields inside the drawer are named stubs, so a tree shows what
// they receive. Browser APIs (timers, dialogs, idle callbacks) are fakes.

const t = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");
const i18n = { t, getLocale: () => "en", useI18n: () => ({ locale: "en" }) };

// Every module shares one hooks object; it calls the runtime that renders.
let current = createHookRuntime();
const hooks = new Proxy({}, { get: (_, name) => current.hooks[name] });
// The real ui.tsx: labels, ICON and the tag contexts.
const ui = loadSource("ui.tsx", {
  modules: {
    "./units": units,
    "./i18n": i18n,
    "./resolution-groups": resolution,
    "./tag-labels": tagLabels,
    "./color": color,
    "./tag-display": tagDisplay,
    preact,
    "preact/compat": { createPortal: (vnode) => vnode },
    "preact/hooks": hooks,
  },
});
const CONTEXTS = [
  ["TagLabels", "labels", {}],
  ["SDListGrouping", "groupSD", false],
  ["HiddenTags", "hidden", {}],
  ["CustomTagNames", "names", {}],
];
const tagContexts = (values = {}) =>
  new Map(
    CONTEXTS.map(([name, key, fallback]) => [
      ui[name],
      values[key] ?? fallback,
    ]),
  );

// A component with its own runtime; render() renders it again with the same
// state (after a click) and the current props, as Preact would; flush()
// runs its effects.
function mount(component, props, contexts) {
  const runtime = createHookRuntime({ contexts: tagContexts(contexts) });
  const view = {
    runtime,
    props,
    render() {
      current = runtime;
      return runtime.render(() => component(view.props));
    },
    flush() {
      current = runtime;
      runtime.flush();
    },
    unmount() {
      current = runtime;
      runtime.unmount();
    },
  };
  return view;
}

// A value of the sandbox as data of this realm.
const data = (value) => JSON.parse(JSON.stringify(value ?? null));
const classes = (node) => (node?.props?.class ?? "").split(" ");
const byClass = (tree, name) =>
  nodes(tree).filter((n) => classes(n).includes(name));
const ofType = (tree, type) => nodes(tree).filter((n) => n.type === type);
const one = (tree, type) => {
  const found = ofType(tree, type);
  assert.equal(found.length, 1, "one " + String(type?.name ?? type));
  return found[0];
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

const fieldsModule = () =>
  loadSource("components/library/FilterFields.tsx", {
    modules: {
      preact,
      "preact/hooks": hooks,
      "../../ui": ui,
      "../../i18n": i18n,
      "../../languages": languages,
      "../../library-filters": filters,
      "../frame/Popover": { Popover: "Popover" },
      "../list/HelpTip": { HelpTip: "HelpTip" },
    },
  });

// --- FilterField -------------------------------------------------------------

const RESOLUTIONS = [
  { value: "2160p", label: "2160p" },
  { value: "1080p", label: "1080p" },
  { value: "__sd__", label: "SD" },
  { value: "__unknown__", label: "Unknown" },
];
const labelOf = (value) =>
  RESOLUTIONS.find((option) => option.value === value)?.label ?? value;

test("a field lists its values and resets them", () => {
  const { FilterField, OperatorToggle } = fieldsModule();
  const changes = [],
    operators = [];
  const view = mount(FilterField, {
    field: "resolution",
    label: "Resolution",
    options: RESOLUTIONS,
    selected: ["1080p", "__sd__"],
    operator: "eq",
    compound: false,
    labelOf,
    change: (values) => changes.push(values),
    operatorChange: (op) => operators.push(op),
  });
  let tree = view.render();

  // div.v2-ff: the label, the operator and the value button with the
  // 1.7.0 summary; the list is closed.
  assert.equal(tree.type, "div");
  assert.equal(tree.props.class, "v2-ff");
  const [label] = byClass(tree, "v2-ff-label");
  assert.equal(label.type, "span");
  assert.equal(label.props.id, "v2-ff-resolution");
  assert.equal(text(label), "Resolution");
  const op = one(tree, OperatorToggle);
  assert.equal(op.props.field, "Resolution");
  assert.equal(op.props.value, "eq");
  assert.equal(op.props.compound, false);
  op.props.change("not");
  assert.deepEqual(operators, ["not"]);
  const value = () => byClass(tree, "v2-ff-value")[0];
  assert.equal(value().type, "button");
  assert.equal(value().props.type, "button");
  assert.equal(value().props.class, "v2-ff-value v2-ff-value--on");
  // Named by the field's label, described by its summary.
  assert.equal(value().props["aria-labelledby"], "v2-ff-resolution");
  assert.equal(value().props["aria-describedby"], "v2-ff-resolution-sum");
  assert.equal(value().props["aria-expanded"], false);
  assert.equal(value().props["aria-controls"], "v2-ff-resolution-list");
  const summary = () => byClass(tree, "v2-ff-sum")[0];
  assert.equal(summary().props.id, "v2-ff-resolution-sum");
  assert.equal(text(summary()), "1080p, SD");
  assert.equal(ofType(tree, "fieldset").length, 0);

  // A press opens the list inside the drawer: Reset selection, then a
  // v2-check per value in the given order, checked when selected.
  value().props.onClick();
  tree = view.render();
  assert.equal(value().props["aria-expanded"], true);
  const list = () => one(tree, "fieldset");
  assert.equal(list().props.class, "v2-ff-list");
  assert.equal(list().props.id, "v2-ff-resolution-list");
  assert.equal(list().props["aria-labelledby"], "v2-ff-resolution");
  assert.equal(list().props["aria-busy"], undefined);
  const [reset] = ofType(list(), "button");
  assert.equal(reset.props.type, "button");
  assert.equal(reset.props.class, "v2-text-btn");
  assert.equal(text(reset), "Reset selection");
  const options = () =>
    ofType(list(), "label").map((option) => {
      const [box] = ofType(option, "input");
      return {
        class: option.props.class,
        text: text(option),
        type: box.props.type,
        box: box.props.class,
        checked: box.props.checked,
      };
    });
  assert.deepEqual(
    data(options()),
    [
      ["2160p", false],
      ["1080p", true],
      ["SD", true],
      ["Unknown", false],
    ].map(([label, checked]) => ({
      class: "v2-ff-opt",
      text: label,
      type: "checkbox",
      box: "v2-check",
      checked,
    })),
  );
  assert.equal(byClass(tree, "v2-ff-empty").length, 0);
  // Checking adds the value at the end, unchecking removes it, Reset
  // selection clears the field (its operator stays: operatorChange is not
  // called).
  const boxOf = (name) =>
    ofType(
      ofType(list(), "label").find((option) => text(option) === name),
      "input",
    )[0];
  boxOf("2160p").props.onChange({ currentTarget: { checked: true } });
  boxOf("1080p").props.onChange({ currentTarget: { checked: false } });
  reset.props.onClick();
  assert.deepEqual(data(changes), [
    ["1080p", "__sd__", "2160p"],
    ["__sd__"],
    [],
  ]);
  assert.deepEqual(operators, ["not"]);
  // A second press closes it.
  value().props.onClick();
  tree = view.render();
  assert.equal(value().props["aria-expanded"], false);
  assert.equal(ofType(tree, "fieldset").length, 0);

  // The summary reads as in 1.7.0 (MultiFilter): the values by their
  // labels, after "Not: ", "All: " or "Not all: "; without values "All",
  // or "No exclusions" for a negative operator. An excluding selection is
  // marked.
  for (const [selected, operator, read, valueClass] of [
    [
      ["1080p"],
      "not",
      "Not: 1080p",
      "v2-ff-value v2-ff-value--on v2-ff-value--not",
    ],
    [
      ["1080p", "2160p"],
      "all",
      "All: 1080p, 2160p",
      "v2-ff-value v2-ff-value--on",
    ],
    [
      ["__unknown__"],
      "notAll",
      "Not all: Unknown",
      "v2-ff-value v2-ff-value--on v2-ff-value--not",
    ],
    [[], "eq", "All", "v2-ff-value"],
    [[], "not", "No exclusions", "v2-ff-value"],
    [[], "notAll", "No exclusions", "v2-ff-value"],
  ]) {
    view.props = { ...view.props, selected, operator };
    tree = view.render();
    assert.equal(text(summary()), read, operator + " " + selected);
    assert.equal(value().props.class, valueClass, operator + " " + selected);
  }

  // Without values in the cache the open list says so; while the facets
  // load it holds placeholders instead (busy, hidden from assistive
  // technology) and never says "No values in cache yet".
  view.props = { ...view.props, options: [], selected: [], operator: "eq" };
  value().props.onClick();
  tree = view.render();
  assert.equal(ofType(list(), "label").length, 0);
  const [empty] = byClass(tree, "v2-ff-empty");
  assert.equal(empty.type, "span");
  assert.equal(text(empty), "No values in cache yet");
  view.props = { ...view.props, loading: true };
  tree = view.render();
  assert.equal(list().props["aria-busy"], "true");
  assert.equal(byClass(tree, "v2-ff-empty").length, 0);
  const holders = byClass(list(), "v2-ff-ph");
  assert.equal(holders.length, 3);
  for (const holder of holders) {
    assert.equal(holder.type, "span");
    assert.equal(holder.props["aria-hidden"], "true");
  }
  assert.equal(text(ofType(list(), "button")[0]), "Reset selection");
});

test("a language field treats one language's names as one value", () => {
  const { FilterField } = fieldsModule();
  const changes = [];
  const view = mount(FilterField, {
    field: "language",
    label: "Language",
    options: [
      { value: "English", label: "English" },
      { value: "German", label: "German" },
    ],
    selected: ["ger"],
    operator: "eq",
    compound: true,
    labelOf: (value) => languages.audioLanguageLabel(value, "en"),
    change: (values) => changes.push(values),
    operatorChange() {},
  });
  let tree = view.render();
  assert.equal(text(byClass(tree, "v2-ff-sum")[0]), "German");
  byClass(tree, "v2-ff-value")[0].props.onClick();
  tree = view.render();
  const boxes = ofType(one(tree, "fieldset"), "input");
  assert.deepEqual(
    boxes.map((box) => box.props.checked),
    [false, true],
  );
  // Unchecking German removes "ger"; checking it again replaces any other
  // name of the same language.
  boxes[1].props.onChange({ currentTarget: { checked: false } });
  view.props = { ...view.props, selected: ["deu", "English"] };
  tree = view.render();
  ofType(one(tree, "fieldset"), "input")[1].props.onChange({
    currentTarget: { checked: true },
  });
  assert.deepEqual(data(changes), [[], ["English", "German"]]);
});

// --- OperatorToggle ------------------------------------------------------------

test("simple operators toggle and compound operators open a menu", () => {
  const { OperatorToggle } = fieldsModule();
  const ops = [];
  const view = mount(OperatorToggle, {
    field: "Resolution",
    value: "eq",
    compound: false,
    change: (op) => ops.push(op),
  });
  let tree = view.render();
  const button = () => ofType(tree, "button")[0];
  const shown = () => ({
    class: button().props.class,
    name: button().props["aria-label"],
    title: button().props.title,
    popup: button().props["aria-haspopup"] ?? null,
    expanded: button().props["aria-expanded"] ?? null,
    symbol: text(button()),
  });
  // A simple field: one toggle between is (=) and is not (≠), named as the
  // 1.7.0 operator button ("{field}: {operator}"); no popup.
  assert.deepEqual(shown(), {
    class: "v2-ff-op",
    name: "Resolution: is",
    title: "is",
    popup: null,
    expanded: null,
    symbol: "=",
  });
  assert.equal(button().props.type, "button");
  const anchor = {
    focused: 0,
    focus() {
      this.focused++;
    },
  };
  button().props.onClick({ currentTarget: anchor });
  assert.deepEqual(ops, ["not"]);
  view.props = { ...view.props, value: "not" };
  tree = view.render();
  assert.deepEqual(shown(), {
    class: "v2-ff-op v2-ff-op--not",
    name: "Resolution: is not",
    title: "is not",
    popup: null,
    expanded: null,
    symbol: "≠",
  });
  button().props.onClick({ currentTarget: anchor });
  // A deep link's all on a simple field toggles to is not, as in 1.7.0.
  view.props = { ...view.props, value: "all" };
  tree = view.render();
  assert.equal(button().props["aria-label"], "Resolution: contains all");
  assert.equal(text(button()), "∧");
  button().props.onClick({ currentTarget: anchor });
  assert.deepEqual(ops, ["not", "eq", "not"]);
  assert.equal(ofType(tree, "Popover").length, 0);

  // A compound field (HDR, audio codec, language, channels, custom tags):
  // a menu of the four 1.7.0 operators at the button.
  ops.length = 0;
  const menu = mount(OperatorToggle, {
    field: "Audio codec",
    value: "eq",
    compound: true,
    change: (op) => ops.push(op),
  });
  tree = menu.render();
  assert.deepEqual(shown(), {
    class: "v2-ff-op",
    name: "Audio codec: contains at least one",
    title: "contains at least one",
    popup: "menu",
    expanded: false,
    symbol: "=",
  });
  button().props.onClick({ currentTarget: anchor });
  tree = menu.render();
  assert.deepEqual(ops, [], "opening changes nothing");
  assert.equal(button().props["aria-expanded"], true);
  const pop = () => one(tree, "Popover");
  assert.equal(pop().props.anchor, anchor);
  assert.equal(pop().props.placement, "bottom-end");
  assert.equal(pop().props.role, "menu");
  assert.equal(pop().props.label, "Audio codec: operator");
  const entries = () => ofType(pop(), "button");
  assert.deepEqual(
    data(
      entries().map((entry) => ({
        type: entry.props.type,
        role: entry.props.role,
        class: entry.props.class,
        checked: entry.props["aria-checked"],
        symbol: text(byClass(entry, "v2-ff-sym")[0]),
        hidden: byClass(entry, "v2-ff-sym")[0].props["aria-hidden"],
        label: text(byClass(entry, "v2-menu-text")[0]),
      })),
    ),
    [
      ["=", "contains at least one", true],
      ["≠", "contains none", false],
      ["∧", "contains all", false],
      ["¬∧", "does not contain all", false],
    ].map(([symbol, label, checked]) => ({
      type: "button",
      role: "menuitemradio",
      class: "v2-menu-item",
      checked,
      symbol,
      hidden: "true",
      label,
    })),
  );
  // A choice returns focus to the button, closes the menu, then changes.
  entries()[3].props.onClick();
  tree = menu.render();
  assert.equal(anchor.focused, 1);
  assert.equal(ofType(tree, "Popover").length, 0);
  assert.equal(button().props["aria-expanded"], false);
  assert.deepEqual(ops, ["notAll"]);
  // A second press on the button and the Popover's close close it too.
  button().props.onClick({ currentTarget: anchor });
  tree = menu.render();
  button().props.onClick({ currentTarget: anchor });
  tree = menu.render();
  assert.equal(ofType(tree, "Popover").length, 0);
  button().props.onClick({ currentTarget: anchor });
  tree = menu.render();
  pop().props.close(true);
  tree = menu.render();
  assert.equal(ofType(tree, "Popover").length, 0);
  assert.deepEqual(ops, ["notAll"]);
  menu.props = { ...menu.props, value: "notAll" };
  tree = menu.render();
  assert.equal(button().props.class, "v2-ff-op v2-ff-op--not");
  assert.equal(
    button().props["aria-label"],
    "Audio codec: does not contain all",
  );
  assert.equal(text(button()), "¬∧");
});

// --- RangeField ----------------------------------------------------------------

test("ranges keep the 1.7.0 inputs for years and gigabytes", () => {
  const { RangeField } = fieldsModule();
  const changes = [];
  const fields = [
    ["year", "Year", "Year from", "Year to", { min: "1800", max: "3000" }],
    [
      "size",
      "File size (GB)",
      "File size from (GB)",
      "File size to (GB)",
      {
        min: "0",
        step: "0.1",
      },
    ],
  ];
  for (const [kind, label, from, to, limits] of fields) {
    const tree = mount(RangeField, {
      kind,
      label,
      min: "1",
      max: "",
      change: (end, input) => changes.push([kind, end, input]),
    }).render();
    assert.equal(tree.props.class, "v2-ff");
    assert.equal(text(byClass(tree, "v2-ff-label")[0]), label);
    const [range] = byClass(tree, "v2-ff-range");
    assert.equal(range.type, "div");
    const inputs = ofType(range, "input");
    assert.deepEqual(
      data(
        inputs.map((input) => ({
          class: input.props.class,
          type: input.props.type,
          min: input.props.min,
          max: input.props.max,
          step: input.props.step,
          placeholder: input.props.placeholder,
          name: input.props["aria-label"],
          value: input.props.value,
        })),
      ),
      [
        ["From", from, "1"],
        ["To", to, ""],
      ].map(([placeholder, name, value]) => ({
        class: "v2-input",
        type: "number",
        ...limits,
        placeholder,
        name,
        value,
      })),
    );
    const [dash] = ofType(range, "span");
    assert.equal(text(dash), "–");
    assert.equal(dash.props["aria-hidden"], "true");
    inputs[0].props.onInput({ currentTarget: { value: "2" } });
    inputs[1].props.onInput({ currentTarget: { value: "" } });
  }
  assert.deepEqual(changes, [
    ["year", "min", "2"],
    ["year", "max", ""],
    ["size", "min", "2"],
    ["size", "max", ""],
  ]);
});

// --- StateField ----------------------------------------------------------------

test("state fields keep their operator while unchecked", () => {
  const { StateField, OperatorToggle } = fieldsModule();
  const spec = filters.STATE_FIELDS.find((field) => field.name === "conflict");
  const choices = [];
  const view = mount(StateField, {
    spec,
    choice: { active: false, exclude: false },
    change: (choice) => choices.push(choice),
  });
  let tree = view.render();
  view.flush();
  // div.v2-ff.v2-ff--state: the box with its label, the help, the operator.
  assert.equal(tree.type, "div");
  assert.equal(tree.props.class, "v2-ff v2-ff--state");
  const check = () => byClass(tree, "v2-ff-check")[0];
  assert.equal(check().type, "label");
  assert.equal(text(check()), "Metadata disagreement");
  const box = () => one(check(), "input");
  assert.equal(box().props.type, "checkbox");
  assert.equal(box().props.class, "v2-check");
  assert.equal(box().props.checked, false);
  const help = one(tree, "HelpTip");
  assert.equal(help.props.label, "Metadata disagreement");
  assert.equal(help.props.text, spec.help);
  const op = () => one(tree, OperatorToggle);
  assert.equal(op().props.field, "Metadata disagreement");
  assert.equal(op().props.value, "eq");
  assert.equal(op().props.compound, false);

  // Preparing ≠ on an unchecked filter activates nothing, and ≠ stays.
  op().props.change("not");
  tree = view.render();
  view.flush();
  assert.deepEqual(choices, []);
  assert.equal(op().props.value, "not");
  // Checking it applies the prepared operator.
  box().props.onChange({ currentTarget: { checked: true } });
  assert.deepEqual(data(choices), [{ active: true, exclude: true }]);
  // Active (the negative value in the query); unchecking removes it, and
  // the operator stays ≠ once the query holds nothing.
  view.props = { ...view.props, choice: { active: true, exclude: true } };
  tree = view.render();
  view.flush();
  assert.equal(box().props.checked, true);
  box().props.onChange({ currentTarget: { checked: false } });
  view.props = { ...view.props, choice: { active: false, exclude: false } };
  tree = view.render();
  view.flush();
  tree = view.render();
  assert.equal(box().props.checked, false);
  assert.equal(op().props.value, "not");
  // An active filter follows the query, and its operator applies at once.
  view.props = { ...view.props, choice: { active: true, exclude: false } };
  tree = view.render();
  view.flush();
  tree = view.render();
  assert.equal(op().props.value, "eq");
  op().props.change("not");
  assert.deepEqual(data(choices), [
    { active: true, exclude: true },
    { active: false, exclude: true },
    { active: true, exclude: true },
  ]);
});

// --- TrackComboField -------------------------------------------------------------

const EMPTY = { language: "", codec: "", channels: "" };
const COMBO_OPTIONS = {
  language: [
    { value: "English", label: "English" },
    { value: "German", label: "German" },
    { value: "__unknown__", label: "Unknown" },
  ],
  codec: [
    { value: "DTS", label: "DTS" },
    { value: "TrueHD", label: "TrueHD" },
  ],
  channels: [
    { value: "5.1", label: "5.1" },
    { value: "7.1", label: "7.1" },
  ],
};
const HINT =
  "Language, codec and channels must match within the same track. Files without measured tracks never match.";

test("track combinations add, change and remove rows", () => {
  const { TrackComboField, OperatorToggle } = fieldsModule();
  const changes = [],
    ops = [];
  const GERMAN_DTS = { language: "German", codec: "DTS", channels: "" };
  const view = mount(TrackComboField, {
    combos: [EMPTY, GERMAN_DTS],
    operator: "eq",
    options: COMBO_OPTIONS,
    change: (combos) => changes.push(combos),
    operatorChange: (op) => ops.push(op),
  });
  let tree = view.render();
  view.flush();
  assert.equal(tree.type, "div");
  assert.equal(tree.props.class, "v2-ff-combo");
  // The column names (the selects carry them as their names), then the
  // operator of the combinations, a compound one.
  assert.deepEqual(
    data(
      byClass(tree, "v2-ff-label").map((label) => [
        label.type,
        text(label),
        label.props["aria-hidden"],
      ]),
    ),
    [
      ["span", "Language", "true"],
      ["span", "Audio codec", "true"],
      ["span", "Channels", "true"],
    ],
  );
  const op = one(tree, OperatorToggle);
  assert.equal(op.props.field, "Audio track combination");
  assert.equal(op.props.value, "eq");
  assert.equal(op.props.compound, true);
  op.props.change("not");
  assert.deepEqual(ops, ["not"]);

  // Per row three v2-selects named Language, Audio codec and Channels, Any
  // first, then Remove combination.
  const selects = () => ofType(tree, "select");
  assert.deepEqual(
    data(
      selects().map((select) => [
        select.props.class,
        select.props["aria-label"],
        select.props.value,
      ]),
    ),
    [
      ["Language", ""],
      ["Audio codec", ""],
      ["Channels", ""],
      ["Language", "German"],
      ["Audio codec", "DTS"],
      ["Channels", ""],
    ].map(([name, value]) => ["v2-select", name, value]),
  );
  assert.deepEqual(
    data(
      ofType(selects()[0], "option").map((option) => [
        option.props.value,
        text(option),
      ]),
    ),
    [
      ["", "Any"],
      ["English", "English"],
      ["German", "German"],
      ["__unknown__", "Unknown"],
    ],
  );
  assert.deepEqual(
    data(ofType(selects()[2], "option").map((option) => text(option))),
    ["Any", "5.1", "7.1"],
  );
  const removes = () =>
    ofType(tree, "button").filter(
      (button) => button.props["aria-label"] === "Remove combination",
    );
  assert.equal(removes().length, 2);
  for (const remove of removes()) {
    assert.equal(remove.props.type, "button");
    assert.equal(remove.props.class, "v2-icon-btn v2-icon-btn--sm");
    assert.equal(remove.props.title, "Remove combination");
  }
  const add = () =>
    ofType(tree, "button").find((button) => text(button) === "Add combination");
  assert.equal(add().props.type, "button");
  assert.equal(add().props.class, "v2-btn v2-btn--sm");
  assert.equal(add().props.disabled, false);
  const [hint] = byClass(tree, "v2-ff-hint");
  assert.equal(hint.type, "p");
  assert.equal(hint.props.id, "v2-ff-track-hint");
  assert.equal(text(hint), HINT);

  // A choice changes its part of its row; Add appends a row of Any;
  // Remove takes its row out.
  selects()[0].props.onChange({ currentTarget: { value: "English" } });
  selects()[5].props.onChange({ currentTarget: { value: "5.1" } });
  add().props.onClick();
  removes()[0].props.onClick();
  assert.deepEqual(data(changes), [
    [{ language: "English", codec: "", channels: "" }, GERMAN_DTS],
    [EMPTY, { ...GERMAN_DTS, channels: "5.1" }],
    [EMPTY, GERMAN_DTS, EMPTY],
    [GERMAN_DTS],
  ]);

  // At most 16 combinations (the API's limit): Add is locked at 16.
  view.props = { ...view.props, combos: Array(15).fill(GERMAN_DTS) };
  tree = view.render();
  assert.equal(add().props.disabled, false);
  view.props = { ...view.props, combos: Array(16).fill(GERMAN_DTS) };
  tree = view.render();
  assert.equal(add().props.disabled, true);
  assert.equal(removes().length, 16);
  assert.equal(selects().length, 48);
});

test("track combination focus stays in the rows when they change", () => {
  const { TrackComboField } = fieldsModule();
  // The grid's focusable parts, as the effect finds them.
  const focused = [];
  const element = (name) => ({ focus: () => focused.push(name) });
  const grid = {
    rows: 2,
    querySelectorAll(selector) {
      if (selector === "select")
        return Array.from({ length: this.rows * 3 }, (_, i) =>
          element("select " + i),
        );
      assert.equal(selector, ".v2-icon-btn");
      return Array.from({ length: this.rows }, (_, i) =>
        element("remove " + i),
      );
    },
  };
  const view = mount(TrackComboField, {
    combos: [EMPTY, EMPTY],
    operator: "eq",
    options: COMBO_OPTIONS,
    change: (combos) => {
      view.props = { ...view.props, combos };
    },
    operatorChange() {},
  });
  let tree = view.render();
  tree.ref.current = grid;
  view.flush();
  assert.deepEqual(focused, [], "nothing moves on the first render");
  // Add focuses the new row's language.
  ofType(tree, "button")
    .find((button) => text(button) === "Add combination")
    .props.onClick();
  grid.rows = 3;
  tree = view.render();
  view.flush();
  assert.deepEqual(focused, ["select 6"]);
  // Remove focuses the Remove of the row now in its place, else the one
  // before it.
  const remove = (index) =>
    ofType(tree, "button")
      .filter((button) => button.props["aria-label"] === "Remove combination")
      [index].props.onClick();
  remove(1);
  grid.rows = 2;
  tree = view.render();
  view.flush();
  remove(1);
  grid.rows = 1;
  tree = view.render();
  view.flush();
  // The last row stays as a row of Any; its Remove keeps focus.
  remove(0);
  tree = view.render();
  view.flush();
  assert.deepEqual(focused, ["select 6", "remove 1", "remove 0", "remove 0"]);
  assert.deepEqual(data(view.props.combos), [EMPTY]);
  // A choice in a select moves nothing.
  ofType(tree, "select")[0].props.onChange({
    currentTarget: { value: "German" },
  });
  tree = view.render();
  view.flush();
  assert.equal(focused.length, 4);
});

// --- LibraryFilterDrawer -----------------------------------------------------------

const FACETS = {
  resolution: ["1080p", "2160p", "576p", "__unknown__"],
  codec: ["HEVC"],
  source: ["WEB-DL"],
  processing: [],
  family: ["H.265"],
  bitDepth: ["10"],
  hdr: ["HDR10"],
  audio: ["DTS", "TrueHD"],
  language: ["English", "German"],
  channels: ["5.1", "7.1", "__unknown__"],
  custom: ["3", "__unknown__"],
};
const FIELDS = {
  FilterField: "FilterField",
  OperatorToggle: "OperatorToggle",
  RangeField: "RangeField",
  StateField: "StateField",
  TrackComboField: "TrackComboField",
};
function libraryDrawer(props, { count = null, contexts } = {}) {
  const counted = [];
  const module = loadSource("components/library/LibraryFilterDrawer.tsx", {
    modules: {
      "preact/hooks": hooks,
      "../../ui": ui,
      "../../i18n": i18n,
      "../../library-filters": filters,
      "../../hooks/useMatchCount": {
        useMatchCount(service, query) {
          counted.push([service, query]);
          return count;
        },
      },
      "../list/FilterDrawer": { FilterDrawer: "FilterDrawer" },
      "../list/HelpTip": { HelpTip: "HelpTip" },
      "./FilterFields": FIELDS,
    },
  });
  const applied = [],
    closed = [];
  const view = mount(
    module.default,
    {
      service: "radarr",
      title: "Your movies",
      query: "",
      facets: FACETS,
      mediaInfoEnabled: false,
      apply: (query) => applied.push(query),
      close: () => closed.push(true),
      ...props,
    },
    contexts,
  );
  return { view, counted, applied, closed };
}
const fieldOf = (tree, name) =>
  ofType(tree, "FilterField").find((field) => field.props.field === name);
const rangeOf = (tree, kind) =>
  ofType(tree, "RangeField").find((field) => field.props.kind === kind);

test("the drawer edits a draft and applies it once", () => {
  const QUERY =
    "resolution=1080p&q=matrix&instance=radarr-2&audioOp=all&audio=DTS";
  const h = libraryDrawer({ query: QUERY }, { count: 42 });
  let tree = h.view.render();
  // The general shell: "Filters", the card title, the count of the draft.
  assert.equal(tree.type, "FilterDrawer");
  assert.equal(tree.props.title, "Filters");
  assert.equal(tree.props.subtitle, "Your movies");
  assert.equal(tree.props.count, 42);
  assert.deepEqual(data(h.counted.at(-1)), ["radarr", QUERY]);

  // Three sections, each named by its h3; the media attributes carry the
  // help "Filter logic" (1.7.0 text).
  const sections = ofType(tree, "section");
  assert.deepEqual(
    data(
      sections.map((section) => [
        section.props.class,
        section.props["aria-labelledby"],
        section.props["aria-describedby"] ?? null,
      ]),
    ),
    [
      ["v2-drawer-sec", "v2-drawer-media", null],
      ["v2-drawer-sec", "v2-drawer-tracks", "v2-ff-track-hint"],
      ["v2-drawer-sec", "v2-drawer-state", null],
    ],
  );
  assert.deepEqual(
    data(
      ofType(tree, "h3").map((heading) => [heading.props.id, text(heading)]),
    ),
    [
      ["v2-drawer-media", "Media attributes"],
      ["v2-drawer-tracks", "Audio track combination"],
      ["v2-drawer-state", "Status and metadata quality"],
    ],
  );
  const help = one(sections[0], "HelpTip");
  assert.equal(help.props.label, "Filter logic");
  assert.equal(
    help.props.text,
    "Different fields use AND. For audio, HDR and language, the operator decides whether some or all selected values are required. “Does not contain all” means at least one is missing from the known metadata, which does not prove its absence in the file. “Unknown” also finds partially unknown audio tracks.",
  );

  // The 11 fields in 1.7.0 order with their labels, compound operators on
  // HDR, audio, language, channels and custom tags; then year and size.
  assert.deepEqual(
    data(
      ofType(sections[0], "FilterField").map((field) => [
        field.props.field,
        field.props.label,
        field.props.compound,
      ]),
    ),
    [
      ["resolution", "Resolution", false],
      ["codec", "Codec / encoder", false],
      ["source", "Source", false],
      ["processing", "Processing", false],
      ["family", "Codec family", false],
      ["bitDepth", "Bit depth", false],
      ["hdr", "HDR", true],
      ["audio", "Audio codec", true],
      ["language", "Language", true],
      ["channels", "Channels", true],
      ["custom", "Custom", true],
    ],
  );
  assert.deepEqual(
    data(
      ofType(sections[0], "RangeField").map((field) => [
        field.props.kind,
        field.props.label,
      ]),
    ),
    [
      ["year", "Year"],
      ["size", "File size (GB)"],
    ],
  );
  // A field reads the draft: values, operator, its 1.7.0 options (facets),
  // the labels of its values.
  const resolutionField = () => fieldOf(tree, "resolution");
  assert.deepEqual(data(resolutionField().props.selected), ["1080p"]);
  assert.equal(resolutionField().props.operator, "eq");
  assert.equal(resolutionField().props.loading, false);
  assert.deepEqual(data(resolutionField().props.options), [
    { value: "1080p", label: "1080p" },
    { value: "2160p", label: "2160p" },
    { value: "576p", label: "576p" },
    { value: "__unknown__", label: "Unknown" },
  ]);
  assert.equal(fieldOf(tree, "audio").props.operator, "all");
  assert.deepEqual(data(fieldOf(tree, "audio").props.selected), ["DTS"]);
  assert.equal(
    fieldOf(tree, "custom").props.labelOf("__unknown__"),
    "No custom tags",
  );

  // Edits change the draft only: the fields and the count follow it,
  // nothing applies or closes.
  resolutionField().props.change(["1080p", "2160p"]);
  tree = h.view.render();
  fieldOf(tree, "audio").props.operatorChange("eq");
  tree = h.view.render();
  rangeOf(tree, "year").props.change("min", "2001");
  tree = h.view.render();
  rangeOf(tree, "size").props.change("max", "1.5");
  tree = h.view.render();
  assert.deepEqual(data(resolutionField().props.selected), ["1080p", "2160p"]);
  assert.equal(fieldOf(tree, "audio").props.operator, "eq");
  assert.equal(rangeOf(tree, "year").props.min, "2001");
  assert.equal(rangeOf(tree, "size").props.max, "1.5");
  const DRAFT =
    "q=matrix&instance=radarr-2&audio=DTS&resolution=1080p&resolution=2160p&yearMin=2001&sizeMax=1500000000";
  assert.deepEqual(data(h.counted.at(-1)), ["radarr", DRAFT]);
  assert.deepEqual(h.applied, []);
  assert.deepEqual(h.closed, []);
  // Apply applies the draft once, then closes.
  tree.props.apply();
  assert.deepEqual(h.applied, [DRAFT]);
  assert.deepEqual(h.closed, [true]);

  // Closing discards the draft: close, never apply.
  const closing = libraryDrawer({ query: QUERY });
  tree = closing.view.render();
  fieldOf(tree, "resolution").props.change([]);
  tree = closing.view.render();
  tree.props.close();
  assert.deepEqual(closing.applied, []);
  assert.deepEqual(closing.closed, [true]);

  // Reset clears the draft's filters and keeps the search and the instance
  // (they apply at once outside the drawer); it neither applies nor closes.
  const reset = libraryDrawer({
    query: QUERY + "&track=German%7CDTS%7C&trackOp=not&conflict=true",
  });
  tree = reset.view.render();
  assert.deepEqual(data(one(tree, "TrackComboField").props.combos), [
    { language: "German", codec: "DTS", channels: "" },
  ]);
  tree.props.reset();
  tree = reset.view.render();
  assert.deepEqual(reset.applied, []);
  assert.deepEqual(reset.closed, []);
  assert.deepEqual(data(fieldOf(tree, "resolution").props.selected), []);
  assert.equal(fieldOf(tree, "audio").props.operator, "eq");
  assert.deepEqual(data(one(tree, "TrackComboField").props.combos), [EMPTY]);
  assert.equal(one(tree, "TrackComboField").props.operator, "eq");
  assert.deepEqual(
    data(
      ofType(tree, "StateField").find(
        (field) => field.props.spec.name === "conflict",
      ).props.choice,
    ),
    { active: false, exclude: false },
  );
  assert.deepEqual(data(reset.counted.at(-1)), [
    "radarr",
    "q=matrix&instance=radarr-2",
  ]);
  tree.props.apply();
  assert.deepEqual(reset.applied, ["q=matrix&instance=radarr-2"]);
});

test("the drawer's track rows write only whole combinations", () => {
  const h = libraryDrawer({ query: "audio=DTS" });
  let tree = h.view.render();
  const field = () => one(tree, "TrackComboField");
  // Without combinations one row of Any shows; it writes nothing.
  assert.deepEqual(data(field().props.combos), [EMPTY]);
  assert.equal(field().props.operator, "eq");
  // The options are the files' values (facets: language, audio codec,
  // channels) with the 1.7.0 labels, unknown last.
  assert.deepEqual(data(field().props.options), {
    language: [
      { value: "English", label: "English" },
      { value: "German", label: "German" },
    ],
    codec: [
      { value: "DTS", label: "DTS" },
      { value: "TrueHD", label: "TrueHD" },
    ],
    channels: [
      { value: "5.1", label: "5.1" },
      { value: "7.1", label: "7.1" },
      { value: "__unknown__", label: "Unknown" },
    ],
  });
  // Add: a second row of Any, still nothing written.
  field().props.change([EMPTY, EMPTY]);
  tree = h.view.render();
  assert.deepEqual(data(field().props.combos), [EMPTY, EMPTY]);
  assert.equal(h.counted.at(-1)[1], "audio=DTS");
  // A part makes a row a combination; the empty row stays on screen only.
  field().props.change([EMPTY, { ...EMPTY, language: "German" }]);
  tree = h.view.render();
  assert.equal(h.counted.at(-1)[1], "audio=DTS&track=German%7C%7C");
  field().props.operatorChange("all");
  tree = h.view.render();
  assert.equal(field().props.operator, "all");
  assert.equal(h.counted.at(-1)[1], "audio=DTS&track=German%7C%7C&trackOp=all");
  // Back to Any everywhere: no combination; the operator stays.
  field().props.change([EMPTY, EMPTY]);
  tree = h.view.render();
  assert.equal(h.counted.at(-1)[1], "audio=DTS&trackOp=all");
  // Removing the last row leaves a row of Any.
  field().props.change([]);
  tree = h.view.render();
  assert.deepEqual(data(field().props.combos), [EMPTY]);
  // Sixteen combinations at most reach the draft, each once.
  const many = Array.from({ length: 17 }, (_, i) => ({
    ...EMPTY,
    codec: "C" + i,
  }));
  field().props.change([...many, many[0]]);
  tree = h.view.render();
  assert.equal(
    new URLSearchParams(h.counted.at(-1)[1]).getAll("track").length,
    16,
  );
  tree.props.apply();
  assert.deepEqual(
    new URLSearchParams(h.applied[0]).getAll("track"),
    many.slice(0, 16).map((combo) => "|" + combo.codec + "|"),
  );

  // A deep link's value outside the facets keeps an option of its own, so
  // its select shows it; the options of a value hidden in the settings too.
  const linked = libraryDrawer(
    { query: "track=deu%7CDTS%7C9.1" },
    { contexts: { hidden: { "audio:DTS": true } } },
  );
  tree = linked.view.render();
  const options = data(one(tree, "TrackComboField").props.options);
  assert.deepEqual(options.language.at(-1), { value: "deu", label: "German" });
  assert.deepEqual(options.codec, [
    { value: "TrueHD", label: "TrueHD" },
    { value: "DTS", label: "DTS" },
  ]);
  assert.deepEqual(options.channels.at(-1), { value: "9.1", label: "9.1" });
});

test("the drawer shows placeholders until the facets arrive", () => {
  const h = libraryDrawer({
    query: "resolution=1080p&track=German%7C%7C",
    facets: null,
  });
  const tree = h.view.render();
  // Facets load only while the drawer is open (ruling P11/M15): until they
  // arrive, every field shows placeholders, and the combination selects
  // offer only what the draft holds.
  for (const field of ofType(tree, "FilterField")) {
    assert.equal(field.props.loading, true, field.props.field);
    assert.deepEqual(data(field.props.options), [], field.props.field);
  }
  assert.deepEqual(data(fieldOf(tree, "resolution").props.selected), ["1080p"]);
  assert.deepEqual(data(one(tree, "TrackComboField").props.options), {
    language: [{ value: "German", label: "German" }],
    codec: [],
    channels: [],
  });
});

// --- useMatchCount ----------------------------------------------------------------

// Timers that run only when the test moves the clock.
function fakeTimers() {
  let now = 0,
    next = 1;
  const timers = new Map();
  return {
    setTimeout(run, delay) {
      timers.set(next, { run, at: now + delay });
      return next++;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    pending: () => timers.size,
    delays: () => [...timers.values()].map((timer) => timer.at - now),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers]
          .filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].run();
      }
      now = end;
    },
  };
}

test("the match count follows the draft", async () => {
  const timers = fakeTimers();
  const requests = [];
  const api = (path, method, body, signal, options) =>
    new Promise((resolve, reject) =>
      requests.push({ path, method, body, signal, options, resolve, reject }),
    );
  const { useMatchCount } = loadSource("hooks/useMatchCount.ts", {
    modules: {
      "preact/hooks": hooks,
      "../api": { api },
      "../library-filters": filters,
    },
    browser: {
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      AbortController,
    },
  });
  const runtime = createHookRuntime();
  const count = (query) => {
    current = runtime;
    const value = runtime.render(() => useMatchCount("radarr", query));
    runtime.flush();
    return value;
  };
  // Null while it loads; one request 180ms after the last change.
  assert.equal(count("resolution=1080p"), null);
  timers.advance(179);
  assert.equal(requests.length, 0);
  timers.advance(1);
  assert.equal(requests.length, 1);
  // One file of the draft's results (limit=1) in its service; the count is
  // its total. Errors are not toasted.
  assert.equal(
    requests[0].path,
    "files?resolution=1080p&service=radarr&limit=1",
  );
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].body, undefined);
  assert.deepEqual(data(requests[0].options), { notifyErrors: false });
  // A change before the answer aborts it; typing on waits for the pause.
  assert.equal(count("resolution=1080p&resolution=2160p"), null);
  assert.equal(requests[0].signal.aborted, true);
  timers.advance(100);
  assert.equal(count("resolution=1080p&resolution=2160p&yearMin=2001"), null);
  timers.advance(179);
  assert.equal(requests.length, 1);
  timers.advance(1);
  assert.equal(requests.length, 2);
  assert.equal(
    requests[1].path,
    "files?resolution=1080p&resolution=2160p&yearMin=2001&service=radarr&limit=1",
  );
  // The current answer counts; an aborted one that arrives later is
  // ignored.
  requests[1].resolve({ total: 42, files: [] });
  await tick();
  assert.equal(count("resolution=1080p&resolution=2160p&yearMin=2001"), 42);
  requests[0].resolve({ total: 99, files: [] });
  await tick();
  assert.equal(count("resolution=1080p&resolution=2160p&yearMin=2001"), 42);
  // Page and sort do not change it: no new request.
  assert.equal(
    count(
      "resolution=1080p&resolution=2160p&yearMin=2001&page=3&sort=size&dir=desc",
    ),
    42,
  );
  timers.advance(500);
  assert.equal(requests.length, 2);
  // A failed request gives null.
  assert.equal(count(""), null);
  timers.advance(180);
  assert.equal(requests[2].path, "files?service=radarr&limit=1");
  requests[2].reject(new Error("Request failed"));
  await tick();
  assert.equal(count(""), null);
  // Leaving clears the pause and aborts the request.
  assert.equal(count("source=WEB-DL"), null);
  assert.equal(timers.pending(), 1);
  current = runtime;
  runtime.unmount();
  assert.equal(timers.pending(), 0);
  timers.advance(180);
  assert.equal(requests.length, 3);
});

// --- State fields of the drawer ------------------------------------------------------

test("series and MediaInfo decide the state fields", () => {
  const states = (props) => {
    const tree = libraryDrawer(props).view.render();
    const section = ofType(tree, "section")[2];
    // The headings and the fields in their order, as names.
    return data(
      nodes(section)
        .filter((n) => n.type === "h4" || n.type === "StateField")
        .map((n) => (n.type === "h4" ? "# " + text(n) : n.props.spec.name)),
    );
  };
  const MATCHING = [
    "# Media server matching",
    "mediaMatched",
    "mediaMissing",
    "mediaAmbiguous",
    "mediaConflicting",
    "mediaNoTracks",
    "mediaPending",
    "mediaUnconfigured",
  ];
  assert.deepEqual(states({ service: "radarr" }), [
    "conflict",
    "ruleConflict",
    "confirmed",
    "metadata",
    ...MATCHING,
  ]);
  assert.deepEqual(states({ service: "sonarr" }), [
    "conflict",
    "ruleConflict",
    "confirmed",
    "metadata",
    "seasonOutlier",
    "languageOutlier",
    ...MATCHING,
  ]);
  assert.deepEqual(states({ service: "radarr", mediaInfoEnabled: true }), [
    "conflict",
    "ruleConflict",
    "confirmed",
    "mediaInfo",
    "metadata",
    ...MATCHING,
  ]);
  // A set MediaInfo filter (a deep link, a preset) shows without it.
  assert.deepEqual(states({ service: "radarr", query: "mediaInfo=false" }), [
    "conflict",
    "ruleConflict",
    "confirmed",
    "mediaInfo",
    "metadata",
    ...MATCHING,
  ]);
  const matching = one(
    ofType(libraryDrawer({}).view.render(), "section")[2],
    "h4",
  );
  assert.equal(matching.props.id, "v2-drawer-match");
  assert.equal(matching.props.class, undefined);

  // A state field reads and writes the draft's 1.7.0 values.
  const h = libraryDrawer({ service: "sonarr", query: "mediaInfo=false" });
  let tree = h.view.render();
  const state = (name) =>
    ofType(tree, "StateField").find((field) => field.props.spec.name === name);
  assert.deepEqual(data(state("mediaInfo").props.choice), {
    active: true,
    exclude: true,
  });
  state("metadata").props.change({ active: true, exclude: true });
  tree = h.view.render();
  state("seasonOutlier").props.change({ active: true, exclude: false });
  tree = h.view.render();
  state("mediaInfo").props.change({ active: false, exclude: true });
  tree = h.view.render();
  // No field comes or goes while the draft changes: MediaInfo read stays.
  assert.deepEqual(data(state("mediaInfo").props.choice), {
    active: false,
    exclude: false,
  });
  assert.deepEqual(data(state("metadata").props.choice), {
    active: true,
    exclude: true,
  });
  tree.props.apply();
  assert.deepEqual(h.applied, ["metadata=complete&seasonOutlier=true"]);
});

// --- FilterDrawer ------------------------------------------------------------------

function fakeDialog() {
  return {
    shown: 0,
    closed: 0,
    showModal() {
      this.shown++;
    },
    close() {
      this.closed++;
    },
  };
}

test("the drawer is a native modal on the dialog stack", () => {
  const stack = [],
    overlays = [];
  const { FilterDrawer } = loadSource("components/list/FilterDrawer.tsx", {
    modules: {
      "preact/hooks": hooks,
      "../../ui": ui,
      "../../i18n": i18n,
      "../../dialog-stack": {
        pushDialog: (dialog) => stack.push(["push", dialog]),
        removeDialog: (dialog) => stack.push(["remove", dialog]),
      },
      "../frame/Popover": {
        useOneOverlay: (close, scope) => overlays.push([close, scope]),
      },
    },
  });
  const calls = [];
  const view = mount(FilterDrawer, {
    title: "Filters",
    subtitle: "Your movies",
    count: 1234,
    apply: () => calls.push("apply"),
    reset: () => calls.push("reset"),
    close: () => calls.push("close"),
    children: "FIELDS",
  });
  let tree = view.render();
  // dialog.v2-drawer, modal for assistive technology (so a popover in it
  // renders inside it), named by its title, described by the card title.
  assert.equal(tree.type, "dialog");
  assert.equal(tree.props.class, "v2-drawer");
  assert.equal(tree.props["aria-modal"], "true");
  assert.equal(tree.props["aria-labelledby"], "v2-drawer-title");
  assert.equal(tree.props["aria-describedby"], "v2-drawer-sub");
  const [head, body, foot] = tree.props.children;
  assert.equal(head.props.class, "v2-drawer-head");
  assert.equal(body.props.class, "v2-drawer-body");
  assert.equal(foot.props.class, "v2-drawer-foot");
  const title = one(head, "h2");
  assert.equal(title.props.id, "v2-drawer-title");
  assert.equal(title.props.class, "v2-drawer-title");
  assert.equal(text(title), "Filters");
  const sub = one(head, "p");
  assert.equal(sub.props.id, "v2-drawer-sub");
  assert.equal(sub.props.class, "v2-drawer-sub");
  assert.equal(text(sub), "Your movies");
  const close = one(head, "button");
  assert.equal(close.props.type, "button");
  assert.equal(close.props.class, "v2-icon-btn");
  assert.equal(close.props["aria-label"], "Close");
  assert.equal(close.props.title, "Close");
  assert.equal(text(body), "FIELDS");
  // The footer: Reset, then Apply with the count, which fills the width.
  const [reset, apply] = ofType(foot, "button");
  assert.equal(reset.props.class, "v2-btn");
  assert.equal(reset.props.type, "button");
  assert.equal(text(reset), "Reset");
  assert.equal(apply.props.class, "v2-btn v2-btn--primary");
  assert.equal(apply.props.type, "button");
  assert.equal(text(apply), "Apply (1234 matches)");

  // Opening: showModal() before the paint, on the dialog stack, focus on
  // Close; one overlay of the page.
  const dialog = fakeDialog();
  tree.ref.current = dialog;
  const focused = [];
  close.ref.current = { focus: () => focused.push("close") };
  view.flush();
  assert.equal(dialog.shown, 1);
  assert.deepEqual(stack, [["push", dialog]]);
  assert.deepEqual(focused, ["close"]);
  assert.equal(overlays.length, 1);
  assert.equal(overlays[0][1], undefined, "the page's scope");

  // Escape (cancel), the backdrop (a press on the dialog itself), Close and
  // another overlay close it; a press inside does not. Nothing applies.
  let prevented = 0;
  tree.props.onCancel({
    preventDefault: () => prevented++,
  });
  assert.equal(prevented, 1, "the drawer closes itself");
  tree.props.onClick({ target: dialog, currentTarget: dialog });
  tree.props.onClick({ target: close, currentTarget: dialog });
  close.props.onClick();
  overlays[0][0](false);
  assert.deepEqual(calls, ["close", "close", "close", "close"]);
  reset.props.onClick();
  apply.props.onClick();
  assert.deepEqual(calls.slice(4), ["reset", "apply"]);

  // Without a count (loading, failed) Apply has no number; without a
  // subtitle the drawer has no description.
  view.props = { ...view.props, count: null, subtitle: undefined };
  tree = view.render();
  assert.equal(text(ofType(tree.props.children[2], "button")[1]), "Apply");
  assert.equal(tree.props["aria-describedby"], undefined);
  assert.equal(ofType(tree.props.children[0], "p").length, 0);

  // Closing: off the dialog stack, the dialog closed.
  view.unmount();
  assert.equal(dialog.closed, 1);
  assert.deepEqual(stack, [
    ["push", dialog],
    ["remove", dialog],
  ]);
});

// --- One overlay per scope ----------------------------------------------------------

test("a popover in the drawer leaves the drawer open", () => {
  const closed = [];
  const listeners = { document: [], window: [] };
  const target = (name) => ({
    addEventListener: (type) => listeners[name].push(type),
    removeEventListener() {},
    activeElement: null,
    body: {},
    documentElement: { clientWidth: 1440 },
    querySelector: () => null,
    innerHeight: 900,
  });
  const { useOneOverlay, Popover } = loadSource(
    "components/frame/Popover.tsx",
    {
      modules: {
        "preact/hooks": hooks,
        "preact/compat": {
          createPortal: (vnode, host) => ({
            type: "Portal",
            props: { host, children: vnode },
          }),
        },
        "../../notifications": loadSource("notifications.ts"),
      },
      browser: {
        document: target("document"),
        window: target("window"),
        ResizeObserver: class {
          observe() {}
          disconnect() {}
        },
      },
    },
  );
  const overlay = (name, scope) => {
    const runtime = createHookRuntime();
    current = runtime;
    runtime.render(() =>
      useOneOverlay((returnFocus) => closed.push([name, returnFocus]), scope),
    );
    runtime.flush();
    return runtime;
  };
  const drawer = { modal: true };
  overlay("sync popover");
  overlay("drawer");
  assert.deepEqual(closed, [["sync popover", false]]);
  // Overlays in the drawer: one at a time there, the drawer stays.
  overlay("operator menu", drawer);
  assert.equal(closed.length, 1);
  const help = overlay("help", drawer);
  assert.deepEqual(closed.slice(1), [["operator menu", false]]);
  // Another modal's overlays have a scope of their own.
  overlay("track menu", { modal: true });
  assert.equal(closed.length, 2);
  // An unmounted one is never closed again.
  current = help;
  help.unmount();
  overlay("sort menu", drawer);
  assert.equal(closed.length, 2);

  // Popover takes the modal its anchor sits in as its scope (and renders
  // into it).
  closed.length = 0;
  const page = overlay("drawer 2");
  assert.deepEqual(closed, [["drawer", false]]);
  const anchor = {
    closest: (selector) => {
      assert.equal(selector, '[aria-modal="true"]');
      return drawer;
    },
    contains: () => false,
  };
  const runtime = createHookRuntime();
  current = runtime;
  const portal = runtime.render(() =>
    Popover({
      anchor,
      placement: "bottom-end",
      role: "menu",
      label: "Audio codec: operator",
      close: (returnFocus) => closed.push(["menu", returnFocus]),
      children: "ENTRIES",
    }),
  );
  runtime.flush();
  assert.equal(portal.props.host, drawer);
  assert.deepEqual(closed.slice(1), [["sort menu", false]]);
  // An overlay of the page closes the page's overlay only.
  overlay("quick search");
  assert.deepEqual(closed.slice(2), [["drawer 2", false]]);
  current = page;
  page.unmount();
  current = runtime;
  runtime.unmount();
});

// --- The drawer's chunk (ruling P10) -------------------------------------------------

// A loader whose attempts the test answers: resolve(value) or fail().
function attempts() {
  const list = [];
  const load = () =>
    new Promise((resolve, reject) => list.push({ resolve, reject }));
  return { list, load };
}

test("the drawer chunk loads at idle and retries once when opened", async () => {
  const notes = [];
  const loadHook = (window, timers = fakeTimers()) =>
    loadSource("hooks/useLazyChunk.ts", {
      modules: {
        "preact/hooks": hooks,
        "../i18n": i18n,
        "../notifications": {
          notify: (message, kind) => notes.push([message, kind]),
        },
      },
      browser: {
        window,
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
      },
    });
  const { lazyChunk, useLazyChunk } = loadHook({});

  // A failed preload is ignored: nothing throws, nothing is loaded.
  let a = attempts();
  let chunk = lazyChunk(a.load);
  assert.equal(chunk.loaded(), null);
  chunk.prefetch();
  chunk.prefetch();
  assert.equal(a.list.length, 1, "one import in flight");
  a.list[0].resolve(null);
  await tick();
  assert.equal(chunk.loaded(), null);
  // Opening after the failure tries once more; when that fails, it gives
  // null (no third attempt).
  let opened = chunk.open();
  assert.equal(a.list.length, 2);
  a.list[1].resolve(null);
  await tick();
  assert.equal(a.list.length, 2, "no third attempt");
  assert.equal(await opened, null);
  // The next opening tries once again; a chunk that is there stays.
  opened = chunk.open();
  assert.equal(a.list.length, 3);
  a.list[2].resolve("Drawer");
  assert.equal(await opened, "Drawer");
  assert.equal(chunk.loaded(), "Drawer");
  assert.equal(await chunk.open(), "Drawer");
  chunk.prefetch();
  assert.equal(a.list.length, 3);

  // Opening during the preload waits for it; when it fails, one more try.
  a = attempts();
  chunk = lazyChunk(a.load);
  chunk.prefetch();
  opened = chunk.open();
  assert.equal(a.list.length, 1);
  a.list[0].resolve(null);
  await tick();
  assert.equal(a.list.length, 2);
  a.list[1].resolve("Drawer");
  assert.equal(await opened, "Drawer");
  // Opening before any preload: the import, then one retry; an import that
  // rejects counts as a failure.
  a = attempts();
  chunk = lazyChunk(a.load);
  opened = chunk.open();
  a.list[0].reject(new Error("offline"));
  await tick();
  assert.equal(a.list.length, 2);
  a.list[1].resolve(null);
  assert.equal(await opened, null);
  assert.equal(a.list.length, 2);

  // The hook preloads at idle once the page has painted.
  const idle = [];
  const win = {
    requestIdleCallback: (run) => idle.push(run) && idle.length,
    cancelIdleCallback: (id) => idle.push("cancel " + id),
    location: {
      reload: () => assert.fail("no reload"),
    },
    dispatchEvent: () => assert.fail("no event"),
  };
  const timers = fakeTimers();
  const hook = loadHook(win, timers);
  a = attempts();
  chunk = hook.lazyChunk(a.load);
  const closed = [];
  const runtime = createHookRuntime();
  let open = false;
  const drawer = () => {
    current = runtime;
    const value = runtime.render(() =>
      hook.useLazyChunk(chunk, open, () => closed.push(true)),
    );
    runtime.flush();
    return value;
  };
  assert.equal(drawer(), null);
  assert.equal(idle.length, 1);
  assert.equal(timers.pending(), 0);
  assert.equal(a.list.length, 0, "not before the idle callback");
  idle[0]();
  assert.equal(a.list.length, 1);
  // A press before the chunk arrived waits for it: nothing renders yet.
  open = true;
  assert.equal(drawer(), null);
  a.list[0].resolve("Drawer");
  await tick();
  assert.equal(drawer(), "Drawer");
  open = false;
  assert.equal(drawer(), null);
  open = true;
  assert.equal(drawer(), "Drawer");
  assert.deepEqual(closed, []);
  assert.deepEqual(notes, []);
  current = runtime;
  runtime.unmount();

  // When opening fails twice, the drawer closes with the error notice,
  // without a reload (win's reload and events fail the test).
  a = attempts();
  chunk = hook.lazyChunk(a.load);
  const failing = createHookRuntime();
  const render = (isOpen) => {
    current = failing;
    const value = failing.render(() =>
      hook.useLazyChunk(chunk, isOpen, () => closed.push(true)),
    );
    failing.flush();
    return value;
  };
  render(false);
  idle.at(-1)();
  a.list[0].resolve(null);
  await tick();
  assert.equal(render(true), null);
  assert.equal(a.list.length, 2, "one retry");
  a.list[1].resolve(null);
  await tick();
  assert.deepEqual(closed, [true]);
  assert.deepEqual(notes, [["Scopearr is not reachable", "error"]]);
  // A drawer closed before its chunk failed stays quiet.
  render(false);
  render(true);
  render(false);
  a.list[2].resolve(null);
  await tick();
  await tick();
  assert.deepEqual(closed, [true]);
  assert.equal(notes.length, 1);
  // Leaving before the idle callback cancels it.
  const leaving = createHookRuntime();
  current = leaving;
  leaving.render(() =>
    hook.useLazyChunk(hook.lazyChunk(a.load), false, () => {}),
  );
  leaving.flush();
  const id = idle.length;
  leaving.unmount();
  assert.equal(idle.at(-1), "cancel " + id);

  // Without requestIdleCallback (Safari) a timeout preloads instead.
  const later = fakeTimers();
  const safari = loadHook({}, later);
  a = attempts();
  const plain = createHookRuntime();
  current = plain;
  plain.render(() =>
    safari.useLazyChunk(safari.lazyChunk(a.load), false, () => {}),
  );
  plain.flush();
  assert.deepEqual(later.delays(), [500]);
  later.advance(500);
  assert.equal(a.list.length, 1);
  current = plain;
  plain.unmount();
  // A loaded chunk is not preloaded again.
  const loaded = safari.lazyChunk(async () => "Drawer");
  await loaded.open();
  const again = createHookRuntime();
  current = again;
  again.render(() => safari.useLazyChunk(loaded, false, () => {}));
  again.flush();
  assert.equal(later.pending(), 0);
});

test("the drawer's import handles its own failure", async () => {
  // The import's failure is handled on the import() itself, so that it
  // stays inside Vite's preload wrapper: a failure never raises
  // vite:preloadError, and preload-recovery.ts never reloads the page.
  const source = src("components/library/drawer-chunk.ts");
  assert.match(
    source,
    /lazyChunk(?:<[^>]*>)?\(\s*\(\) =>\s*import\("\.\/LibraryFilterDrawer"\)\.then\(\s*\(chunk\) => chunk\.default,\s*\(\) => null,?\s*\),?\s*\)/,
  );
  assert.doesNotMatch(source, /^import (?!type )[^;]*LibraryFilterDrawer/m);
  // The drawer module as the import finds it: there, or a chunk that
  // cannot load (offline, an old tab after an update).
  const load = (drawer) => {
    let loader;
    const modules = {
      "../../hooks/useLazyChunk": {
        lazyChunk: (given) => (loader = given),
      },
    };
    Object.defineProperty(modules, "./LibraryFilterDrawer", {
      enumerable: true,
      get() {
        if (drawer) return drawer;
        throw new TypeError("Failed to fetch dynamically imported module");
      },
    });
    loadSource("components/library/drawer-chunk.ts", { modules });
    return loader;
  };
  assert.equal(await load({ default: "Drawer" })(), "Drawer");
  assert.equal(await load(null)(), null);

  // The build keeps the handler inside the preload wrapper (the module as
  // the entry, its export kept, so the import stays in the bundle).
  const { build } = await import("vite");
  const result = await build({
    root: fileURLToPath(new URL("../", import.meta.url)),
    logLevel: "silent",
    build: {
      write: false,
      rolldownOptions: {
        input: fileURLToPath(
          new URL("../src/components/library/drawer-chunk.ts", import.meta.url),
        ),
        preserveEntrySignatures: "strict",
      },
    },
  });
  const output = (Array.isArray(result) ? result : [result]).flatMap(
    (r) => r.output,
  );
  const entry = output.find((o) => o.type === "chunk" && o.isEntry);
  const drawerChunk = output.find(
    (o) => o.type === "chunk" && /LibraryFilterDrawer/.test(o.fileName),
  );
  assert.ok(drawerChunk, "the drawer is a chunk of its own");
  const file = drawerChunk.fileName.split("/").at(-1);
  // wrapper(() => import("./LibraryFilterDrawer-….js").then(ok, () => null), deps)
  const call = entry.code.match(
    new RegExp(
      String.raw`\(\(\)=>import\(\S\./` +
        file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
        String.raw`\S\)\.then\(([^()]|\([^()]*\))*\)(?=,)`,
    ),
  );
  assert.ok(call, "the import and its handler are one wrapped call");
  assert.match(call[0], /,\(\)=>null\)$/);
});
