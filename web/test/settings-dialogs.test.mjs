import test from "node:test";
import assert from "node:assert/strict";
import {
  loadSource,
  nodes,
  PRESENTATION_MODULES,
  text,
} from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";

// The settings dialogs on the v2 modal (Phase 5d, Task 11, E22;
// docs/STYLEGUIDE.md, Part 1, 10.9): Add service, Unraid path check,
// Change password, Edit recognition rule, Confirm tag synchronization
// changes, Review tag removals and Log entry. Each runs as real code with
// real hooks (hook-runtime); Modal, ModalFoot, CheckRow, Terminal,
// TableScroll, KeyValues and StatusTag are named stubs. Every 1.7.0 field,
// lock, question and text stays.

const classes = (node) => String(node?.props?.class ?? "").split(" ");
const byClass = (tree, name) =>
  nodes(tree).filter((n) => classes(n).includes(name));
const ofType = (tree, type) => nodes(tree).filter((n) => n.type === type);
const plain = (value) => JSON.parse(JSON.stringify(value ?? null));
const interpolate = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? "");
const i18n = { t: interpolate, useI18n: () => ({ locale: "en" }) };
const field = loadSource("components/settings/Field.tsx");
const check = loadSource("components/settings/Check.tsx");
const instances = loadSource("instances.ts");
const eventLog = loadSource("event-log.ts");
const footButtons = (tree) =>
  ofType(tree.props.foot, "button").map((b) => [
    text(b),
    b.props.disabled ?? false,
    b.props.class,
  ]);
const button = (tree, label) => {
  const found = ofType(tree, "button").filter(
    (b) => b.props["aria-label"] === label || text(b).trim() === label,
  );
  assert.equal(found.length, 1, "one button " + label);
  return found[0];
};
// The control a label names (by `for`) or holds.
const control = (tree, label) => {
  const named = nodes(tree).find(
    (n) => n.type === "label" && text(n).trim().startsWith(label),
  );
  assert.ok(named, "label " + label);
  return (
    nodes(named).find((n) => ["input", "select"].includes(n.type)) ??
    nodes(tree).find((n) => n.props?.id && n.props.id === named.props.for)
  );
};
const alerts = (tree) => nodes(tree).filter((n) => n.props?.role === "alert");
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let current = createHookRuntime();
const hooks = new Proxy({}, { get: (_, name) => current.hooks[name] });
function mount(path, name, props, modules = {}, contexts) {
  const runtime = createHookRuntime({ contexts });
  const exports = loadSource(path, {
    modules: { "preact/hooks": hooks, ...modules },
    stubs: PRESENTATION_MODULES,
  });
  const view = {
    runtime,
    props,
    render() {
      current = runtime;
      return runtime.settle(() => exports[name](view.props));
    },
  };
  return view;
}

// --- Add service ------------------------------------------------------------

function addService(props = {}) {
  const calls = [];
  const answers = { discard: false, delete: true };
  const list = [
    { id: "radarr", type: "radarr", enabled: true, name: "Radarr" },
    { id: "sonarr-2", type: "sonarr", enabled: false, name: "Shows" },
    {
      id: "emby",
      type: "emby",
      enabled: false,
      name: "Living room",
      tagSync: { hdr: true },
    },
  ];
  const view = mount(
    "components/dialog/AddServiceDialog.tsx",
    "AddServiceDialog",
    {
      instances: list,
      settings: { instances: list },
      demo: false,
      hasMux: true,
      hasMediaInfo: false,
      add: (...args) => calls.push(["add", ...args]),
      enable: (id) => calls.push(["enable", id]),
      remove: (id) => calls.push(["remove", id]),
      close: () => calls.push(["close"]),
      ...props,
    },
    {
      "../../confirmation": {
        confirmDiscard: async (message) => (
          calls.push(["ask", message]),
          answers.discard
        ),
        confirmDeletion: async (message) => (
          calls.push(["ask", message]),
          answers.delete
        ),
      },
      "../../i18n": i18n,
      "../../instances": instances,
      "../../ui": { ICON: { label: 15, button: 16 } },
      "../settings/Field": field,
    },
  );
  return { view, calls, answers };
}

test("add service keeps types, names and the disabled services", async () => {
  const { view, calls, answers } = addService();
  let tree = view.render();
  assert.equal(tree.type, "Modal");
  assert.equal(tree.props.id, "addService");
  assert.equal(tree.props.title, "Add service");
  // The types sorted by language; MKVToolNix locked while it is there.
  const type = control(tree.props.children, "Service type");
  assert.equal(type.type, "select");
  assert.equal(type.props.class, "v2-select");
  assert.equal(type.props.value, "radarr");
  assert.deepEqual(
    plain(
      ofType(type, "option").map((o) => [
        o.props.value,
        text(o),
        o.props.disabled,
      ]),
    ),
    [
      ["media", "Media player", false],
      ["mediainfo", "MediaInfo", false],
      ["mux", "MKVToolNix", true],
      ["radarr", "Radarr", false],
      ["sonarr", "Sonarr", false],
    ],
  );
  const locked = addService({ hasMux: false, hasMediaInfo: true }).view;
  assert.deepEqual(
    plain(
      ofType(control(locked.render().props.children, "Service type"), "option")
        .filter((o) => o.props.disabled)
        .map((o) => o.props.value),
    ),
    ["mediainfo"],
  );
  // The name: at most 80 characters, the type's name as its placeholder;
  // no media server until Media player.
  const name = () =>
    control(view.render().props.children, "Optional service name");
  assert.equal(name().props.class, "v2-input");
  assert.equal(name().props.maxLength, 80);
  assert.equal(name().props.placeholder, "Radarr");
  assert.equal(
    nodes(tree.props.children).some(
      (n) => n.type === "label" && text(n) === "Media server",
    ),
    false,
  );
  for (const [value, placeholder] of [
    ["sonarr", "Sonarr"],
    ["mux", "Radarr"],
    ["mediainfo", "Radarr"],
    ["media", "Emby"],
  ]) {
    control(view.render().props.children, "Service type").props.onChange({
      currentTarget: { value },
    });
    assert.equal(name().props.placeholder, placeholder, value);
  }
  const provider = control(view.render().props.children, "Media server");
  assert.equal(provider.props.class, "v2-select");
  assert.deepEqual(
    plain(ofType(provider, "option").map((o) => [o.props.value, text(o)])),
    [
      ["emby", "Emby"],
      ["jellyfin", "Jellyfin"],
    ],
  );
  provider.props.onChange({ currentTarget: { value: "jellyfin" } });
  assert.equal(name().props.placeholder, "Jellyfin");
  // The foot: Cancel, then Add service (primary), which hands over the
  // type, the media server and the name.
  name().props.onInput({ currentTarget: { value: "Den" } });
  tree = view.render();
  assert.deepEqual(plain(footButtons(tree)), [
    ["Cancel", false, "v2-btn"],
    ["Add service", false, "v2-btn v2-btn--primary"],
  ]);
  button(tree.props.foot, "Add service").props.onClick();
  assert.deepEqual(calls.at(-1), ["add", "media", "jellyfin", "Den"]);
  // Closing with a name asks first; declined, the dialog stays.
  calls.length = 0;
  await tree.props.close();
  assert.deepEqual(calls, [["ask", "Discard unsaved settings changes?"]]);
  answers.discard = true;
  await button(view.render().props.foot, "Cancel").props.onClick();
  assert.deepEqual(calls.at(-1), ["close"]);
  // Without a name it closes at once.
  const fresh = addService();
  await fresh.view.render().props.close();
  assert.deepEqual(fresh.calls, [["close"]]);

  // The disabled services, sorted by name: Enable service hands its id
  // over (the caller selects it and closes); Remove is locked by the tag
  // sync with its title and asks before removing.
  const list = byClass(tree.props.children, "v2-modal-sec").find(
    (s) => text(ofType(s, "h3")[0]) === "Disabled services",
  );
  const rows = ofType(list, "li");
  assert.deepEqual(
    plain(rows.map((r) => text(byClass(r, "v2-modal-list-name")[0]))),
    ["Living room", "Shows"],
  );
  calls.length = 0;
  button(rows[1], "Enable service").props.onClick();
  assert.deepEqual(calls, [["enable", "sonarr-2"]]);
  const removeSync = button(rows[0], "Remove service: Living room");
  assert.equal(removeSync.props.disabled, true);
  assert.equal(
    removeSync.props.title,
    "Disable tag synchronization and the service, then save before removing it.",
  );
  const remove = button(rows[1], "Remove service: Shows");
  assert.equal(remove.props.disabled, false);
  assert.equal(remove.props.title, "Remove service");
  assert.deepEqual(classes(remove), [
    "v2-icon-btn",
    "v2-icon-btn--sm",
    "v2-icon-btn--danger",
  ]);
  calls.length = 0;
  await remove.props.onClick();
  assert.deepEqual(calls, [
    [
      "ask",
      "Remove Shows? After saving, its local connection and cached data are removed. Nothing is deleted in Radarr, Sonarr or the media server.",
    ],
    ["remove", "sonarr-2"],
  ]);
  answers.delete = false;
  calls.length = 0;
  await remove.props.onClick();
  assert.equal(calls.length, 1, "declined: nothing removed");
  // The demo locks Remove.
  const demo = addService({ demo: true }).view.render();
  assert.equal(
    button(demo.props.children, "Remove service: Shows").props.disabled,
    true,
  );
  // No disabled service, no section.
  const none = addService({
    instances: [{ id: "radarr", type: "radarr", enabled: true }],
  }).view.render();
  assert.equal(
    nodes(none.props.children).some((n) => text(n) === "Disabled services"),
    false,
  );
});

// --- Unraid path check -----------------------------------------------------

const CHECKS = {
  root: true,
  share: false,
  checked: 4,
  found: 3,
  disks: [
    { name: "disk1", kind: "array", writable: true, free: 2048 },
    { name: "cache", kind: "pool", writable: false, free: 512 },
  ],
  state: { known: true, mover: false, parity: true },
  error: "Unraid disks are not mounted",
  warnings: [{ key: "w1" }, { key: "w2" }],
};
function unraid(checks = CHECKS) {
  const calls = [];
  const tree = mount(
    "components/dialog/UnraidPathCheckDialog.tsx",
    "UnraidPathCheckDialog",
    { checks, close: () => calls.push("close") },
    {
      "../../i18n": i18n,
      "../../ui": { ICON: {}, compactBytes: (n) => n + " B" },
      "../../placement-messages": {
        placementMessage: (v, t) => t("warning {key}", v),
      },
    },
  ).render();
  return { tree, calls };
}

test("the Unraid path check keeps its rows", () => {
  const { tree, calls } = unraid();
  assert.equal(tree.props.id, "unraidPathCheck");
  assert.equal(tree.props.title, "Unraid path check");
  assert.deepEqual(
    plain(
      ofType(tree.props.children, "CheckRow").map((r) => [
        r.props.label,
        r.props.ok,
        r.props.warning ?? false,
        r.props.detail ?? null,
      ]),
    ),
    [
      ["Unraid disks reachable", true, false, "1 array disks · 1 pools"],
      ["User share reachable", false, false, null],
      ["Share and disk sample", false, false, "3/4 found on a disk"],
      ["disk1", true, true, "2048 B free"],
      ["cache", false, true, "512 B free"],
      ["Mover / parity state", true, true, "Parity operation in progress"],
    ],
  );
  const state = (s) =>
    ofType(unraid({ ...CHECKS, state: s }).tree.props.children, "CheckRow").at(
      -1,
    ).props.detail;
  assert.equal(state({ known: true, mover: true }), "Mover is running");
  assert.equal(state({ known: true }), "Idle");
  assert.equal(state({ known: false }), "Mover/parity state unknown");
  // No sample: a warning, not an error.
  const none = ofType(
    unraid({ ...CHECKS, checked: 0, found: 0 }).tree.props.children,
    "CheckRow",
  )[2];
  assert.equal(none.props.warning, true);
  // The error as an alert, the warnings as hints.
  assert.deepEqual(plain(alerts(tree.props.children).map(text)), [
    "Unraid disks are not mounted",
  ]);
  assert.deepEqual(classes(alerts(tree.props.children)[0]), [
    "v2-notice",
    "v2-notice--error",
  ]);
  assert.deepEqual(
    plain(byClass(tree.props.children, "v2-modal-hint").map(text)),
    ["warning w1", "warning w2"],
  );
  assert.equal(
    alerts(unraid({ ...CHECKS, error: "" }).tree.props.children).length,
    0,
  );
  // The foot: Close.
  assert.deepEqual(plain(footButtons(tree)), [["Close", false, "v2-btn"]]);
  button(tree.props.foot, "Close").props.onClick();
  assert.deepEqual(calls, ["close"]);
});

// --- Change password -------------------------------------------------------

function password(demo = false) {
  const calls = [];
  const view = mount(
    "components/dialog/PasswordDialog.tsx",
    "PasswordDialog",
    { demo, close: () => calls.push("close") },
    {
      "../../i18n": i18n,
      "../settings/Field": field,
    },
  );
  return { view, calls };
}

test("the password dialog keeps its form", () => {
  const { view, calls } = password();
  let tree = view.render();
  assert.equal(tree.props.id, "password");
  assert.equal(tree.props.title, "Change password");
  assert.equal(
    text(byClass(tree.props.children, "v2-modal-hint")[0]),
    "Changing the password signs out every session.",
  );
  // Both fields belong to the page's password form (outside the dialog).
  assert.deepEqual(
    plain(
      ofType(tree.props.children, "input").map((i) => [
        i.props.name,
        i.props.type,
        i.props.form,
        i.props.autoComplete,
        i.props.required,
        i.props.minLength ?? null,
        i.props.autoFocus ?? false,
        i.props.class,
      ]),
    ),
    [
      [
        "current",
        "password",
        "password-form",
        "current-password",
        true,
        null,
        true,
        "v2-input",
      ],
      [
        "password",
        "password",
        "password-form",
        "new-password",
        true,
        12,
        false,
        "v2-input",
      ],
    ],
  );
  assert.equal(ofType(tree, "form").length, 0, "no form of its own");
  assert.deepEqual(
    plain(
      ["Current password", "New password"].map(
        (label) => control(tree.props.children, label).props.name,
      ),
    ),
    ["current", "password"],
  );
  // The foot: Cancel, then the submit of the page's form.
  assert.deepEqual(plain(footButtons(tree)), [
    ["Cancel", false, "v2-btn"],
    ["Change password and sign out", false, "v2-btn v2-btn--primary"],
  ]);
  const submit = button(tree.props.foot, "Change password and sign out");
  assert.equal(submit.props.type, "submit");
  assert.equal(submit.props.form, "password-form");
  assert.equal(
    button(
      password(true).view.render().props.foot,
      "Change password and sign out",
    ).props.disabled,
    true,
    "locked in the demo",
  );
  // Cancel empties both fields and closes.
  for (const [i, value] of [
    [0, "old"],
    [1, "new-password-123"],
  ])
    ofType(view.render().props.children, "input")[i].props.onInput({
      currentTarget: { value },
    });
  assert.deepEqual(
    plain(
      ofType(view.render().props.children, "input").map((i) => i.props.value),
    ),
    ["old", "new-password-123"],
  );
  button(view.render().props.foot, "Cancel").props.onClick();
  assert.deepEqual(calls, ["close"]);
  tree = view.render();
  assert.deepEqual(
    plain(ofType(tree.props.children, "input").map((i) => i.props.value)),
    ["", ""],
  );
  // Close and Escape do the same.
  assert.equal(
    tree.props.close,
    button(tree.props.foot, "Cancel").props.onClick,
  );
});

// --- Edit recognition rule -------------------------------------------------

const RULE = {
  id: "r1",
  name: "HDR",
  field: "hdr",
  match: "token",
  pattern: "HDR10",
  value: "HDR10",
  mode: "fallback",
  priority: 10,
  enabled: true,
  tag: true,
  consume: false,
  unless: "",
  comparisonPattern: "",
};
const CUSTOM = { names: true };
function ruleEditor(props = {}) {
  const calls = [];
  const answers = { discard: false };
  const view = mount(
    "components/RuleEditor.tsx",
    "RuleEditor",
    {
      rule: RULE,
      busy: false,
      close: () => calls.push(["close"]),
      save: async (rule) => calls.push(["save", plain(rule)]),
      ...props,
    },
    {
      "../confirmation": {
        confirmDiscard: async (message) => (
          calls.push(["ask", message]),
          answers.discard
        ),
      },
      "../i18n": i18n,
      "../rule-draft": loadSource("rule-draft.ts"),
      "../recognition-options": {
        recognitionFields: ["hdr", "audio", "custom"],
        recognitionModes: {
          fallback: "Only if missing",
          override: "Explicit override",
        },
      },
      "../ui": {
        ICON: { label: 15, close: 16 },
        CustomTagNames: CUSTOM,
        labels: { hdr: "HDR", audio: "Audio", custom: "Custom tag" },
      },
      "./settings/Field": field,
      "./settings/Check": check,
    },
    new Map([[CUSTOM, { c1: "Favourite", c2: "Kids" }]]),
  );
  return { view, calls, answers };
}

test("the rule editor keeps every field and asks before discarding", async () => {
  const { view, calls, answers } = ruleEditor();
  let tree = view.render();
  assert.equal(tree.props.id, "ruleEditor");
  assert.equal(tree.props.title, "Edit recognition rule");
  assert.equal(tree.props.closeDisabled, false);
  const form = ofType(tree.props.children, "form")[0];
  assert.equal(form.props.id, "rule-editor-form");
  assert.deepEqual(classes(form), ["v2-modal-form"]);
  // Every field in the 1.7.0 order, with its limits.
  const body = () => view.render().props.children;
  const fields = [
    ["Name", "input", { required: true, maxLength: 80, value: "HDR" }],
    ["Attribute", "select", { value: "hdr" }],
    ["Match type", "select", { value: "token" }],
    ["Pattern", "input", { required: true, maxLength: 500, value: "HDR10" }],
    ["Result", "input", { required: true, maxLength: 80, value: "HDR10" }],
    ["Mode", "select", { value: "fallback" }],
    [
      "Priority",
      "input",
      {
        required: true,
        type: "number",
        min: 0,
        max: 10000,
        step: 1,
        value: 10,
      },
    ],
  ];
  for (const [label, type, expected] of fields) {
    const c = control(body(), label);
    assert.equal(c.type, type, label);
    assert.equal(c.props.class, type === "select" ? "v2-select" : "v2-input");
    for (const [key, value] of Object.entries(expected))
      assert.equal(c.props[key], value, label + " " + key);
  }
  assert.deepEqual(
    plain(ofType(control(body(), "Attribute"), "option").map(text)),
    ["HDR", "Audio", "Custom tag"],
  );
  assert.deepEqual(
    plain(ofType(control(body(), "Match type"), "option").map(text)),
    ["Token", "Regular expression"],
  );
  assert.deepEqual(plain(ofType(control(body(), "Mode"), "option").map(text)), [
    "Only if missing",
    "Explicit override",
  ]);
  // The pattern's hint only for tokens; the mode's hint always.
  const hint = (label) => {
    const c = control(body(), label);
    const id = c.props["aria-describedby"];
    return id && text(nodes(body()).find((n) => n.props?.id === id));
  };
  assert.match(hint("Pattern"), /^Tokens match literal text/);
  assert.match(hint("Mode"), /^Priority applies within each mode/);
  // Enabled and Tag color; the help line.
  const box = (label) =>
    nodes(body()).find((n) => n.type === "label" && text(n) === label);
  assert.deepEqual(classes(box("Enabled")), ["v2-ff-check"]);
  assert.equal(ofType(box("Enabled"), "input")[0].props.checked, true);
  assert.equal(ofType(box("Tag color"), "input")[0].props.checked, true);
  assert.ok(
    byClass(body(), "v2-modal-hint").some((n) =>
      text(n).startsWith("Matching is case-insensitive."),
    ),
  );
  // Advanced matching: the skip expression, consume and their hint; the
  // codec expression only for audio.
  const more = () => ofType(body(), "details")[0];
  assert.deepEqual(classes(more()), ["v2-modal-more"]);
  assert.equal(text(ofType(more(), "summary")[0]), "Advanced matching");
  assert.equal(
    control(more(), "Skip when filename matches this expression").props
      .maxLength,
    500,
  );
  assert.equal(
    text(
      nodes(more()).find(
        (n) => n.type === "label" && text(n).startsWith("Consume"),
      ),
    ),
    "Consume matched text before subsequent rules",
  );
  assert.equal(
    nodes(more()).some((n) => text(n).startsWith("Equivalent metadata")),
    false,
  );
  control(body(), "Attribute").props.onChange({
    currentTarget: { value: "audio" },
  });
  const codec = control(
    more(),
    "Equivalent metadata codecs (regular expression)",
  );
  assert.equal(codec.props.placeholder, "^DTS(?:-HD(?: MA)?)?$");
  codec.props.onInput({ currentTarget: { value: "^DTS" } });
  control(body(), "Match type").props.onChange({
    currentTarget: { value: "regex" },
  });
  assert.equal(hint("Pattern"), undefined, "no token hint for a regex");
  // A custom tag: the result is a select of the names, the mode locked.
  control(body(), "Attribute").props.onChange({
    currentTarget: { value: "custom" },
  });
  const result = control(body(), "Result");
  assert.equal(result.type, "select");
  assert.equal(result.props.value, "c1");
  assert.deepEqual(
    plain(ofType(result, "option").map((o) => [o.props.value, text(o)])),
    [
      ["", "Select a custom tag"],
      ["c1", "Favourite"],
      ["c2", "Kids"],
    ],
  );
  assert.equal(control(body(), "Mode").props.disabled, true);
  assert.equal(
    nodes(more()).some((n) => text(n).startsWith("Equivalent metadata")),
    false,
    "the codec expression leaves with audio",
  );
  // The foot: Cancel, then Save rule as the form's submit.
  tree = view.render();
  assert.deepEqual(plain(footButtons(tree)), [
    ["Cancel", false, "v2-btn"],
    ["Save rule", false, "v2-btn v2-btn--primary"],
  ]);
  const save = button(tree.props.foot, "Save rule");
  assert.equal(save.props.type, "submit");
  assert.equal(save.props.form, "rule-editor-form");
  let prevented = false;
  await ofType(tree.props.children, "form")[0].props.onSubmit({
    preventDefault: () => (prevented = true),
  });
  assert.equal(prevented, true);
  assert.equal(calls.at(-1)[0], "save");
  assert.equal(calls.at(-1)[1].field, "custom");
  assert.equal(calls.at(-1)[1].comparisonPattern, "");

  // Closing asks only with a change; declined, it stays.
  calls.length = 0;
  view.render().props.close();
  await settle();
  assert.deepEqual(calls, [["ask", "Discard your unsaved rule changes?"]]);
  answers.discard = true;
  button(view.render().props.foot, "Cancel").props.onClick();
  await settle();
  assert.deepEqual(calls.at(-1), ["close"]);
  const clean = ruleEditor();
  clean.view.render().props.close();
  await settle();
  assert.deepEqual(clean.calls, [["close"]]);
  // While it asks, Close, Escape, Cancel and Save are off.
  const asking = ruleEditor();
  let release;
  control(asking.view.render().props.children, "Name").props.onInput({
    currentTarget: { value: "HDR 2" },
  });
  const question = new Promise((resolve) => (release = resolve));
  asking.answers.discard = question;
  asking.view.render().props.close();
  tree = asking.view.render();
  assert.equal(tree.props.closeDisabled, true);
  assert.deepEqual(plain(footButtons(tree).map((b) => b[1])), [true, true]);
  release(false);
  await settle();
  assert.equal(asking.view.render().props.closeDisabled, false);

  // Busy: every field and both buttons locked, the status line, no submit.
  const busy = ruleEditor({ busy: true });
  tree = busy.view.render();
  assert.equal(tree.props.closeDisabled, true);
  for (const [label] of fields)
    assert.equal(
      control(tree.props.children, label).props.disabled,
      true,
      label,
    );
  assert.deepEqual(plain(footButtons(tree)), [
    ["Cancel", true, "v2-btn"],
    ["Saving rule…", true, "v2-btn v2-btn--primary"],
  ]);
  assert.equal(
    button(tree.props.foot, "Saving rule…").props["aria-busy"],
    true,
  );
  const status = nodes(tree.props.children).find(
    (n) => n.props?.role === "status",
  );
  assert.match(text(status), /^Saving rule and updating the cached library\./);
  await ofType(tree.props.children, "form")[0].props.onSubmit({
    preventDefault() {},
  });
  assert.equal(busy.calls.length, 0);
});

// --- Confirm tag synchronization changes -----------------------------------

function tagPolicy(props = {}) {
  const calls = [];
  const view = mount(
    "components/TagPolicyDialog.tsx",
    "TagPolicyDialog",
    {
      changes: [
        {
          service: "radarr",
          name: "Radarr",
          enabled: ["hdr"],
          disabled: ["audio"],
          needsMode: true,
          media: false,
        },
        {
          service: "emby",
          name: "",
          enabled: [],
          disabled: ["hdr"],
          needsMode: false,
          media: true,
        },
      ],
      busy: false,
      close: () => calls.push(["close"]),
      save: async (choices) => calls.push(["save", plain(choices)]),
      ...props,
    },
    {
      "../i18n": i18n,
      "../ui": { labels: { hdr: "HDR", audio: "Audio" } },
    },
  );
  return { view, calls };
}

test("tag policy keeps both choices per service", async () => {
  const { view, calls } = tagPolicy();
  let tree = view.render();
  assert.equal(tree.props.id, "tagPolicy");
  assert.equal(tree.props.title, "Confirm tag synchronization changes");
  assert.equal(tree.props.closeDisabled, false);
  assert.match(
    text(byClass(tree.props.children, "v2-modal-hint")[0]),
    /^Choose how existing tags should be handled before saving\./,
  );
  // One section per service (its name, else its id) with its groups.
  const sections = () =>
    ofType(view.render().props.children, "section").filter((s) =>
      classes(s).includes("v2-modal-sec"),
    );
  assert.deepEqual(plain(sections().map((s) => text(ofType(s, "h3")[0]))), [
    "Radarr",
    "emby",
  ]);
  assert.deepEqual(plain(byClass(sections()[0], "v2-modal-text").map(text)), [
    "Enabled groups: HDR",
    "Disabled groups: Audio",
  ]);
  // The groups of radios, each named by its heading, with their hints.
  const groups = (s) => nodes(s).filter((n) => n.props?.role === "radiogroup");
  const named = (s, g) =>
    text(nodes(s).find((n) => n.props?.id === g.props["aria-labelledby"]));
  const radios = (g) =>
    ofType(g, "label").map((l) => [
      text(l),
      ofType(l, "input")[0].props.name,
      ofType(l, "input")[0].props.checked,
    ]);
  const [radarr, emby] = sections();
  assert.deepEqual(
    plain(groups(radarr).map((g) => [named(radarr, g), radios(g)])),
    [
      [
        "Existing assignments",
        [
          ["Keep and only add", "radarr-mode", false],
          ["Overwrite assignments", "radarr-mode", false],
        ],
      ],
      [
        "Disabled groups",
        [
          ["Keep their existing tags", "radarr-disable", false],
          [
            "Remove assignments and unused definitions",
            "radarr-disable",
            false,
          ],
        ],
      ],
    ],
  );
  assert.deepEqual(plain(groups(emby).map((g) => radios(g).map((r) => r[0]))), [
    ["Keep their existing tags", "Remove tag assignments"],
  ]);
  assert.equal(byClass(radarr, "v2-modal-hint").length, 3);
  // Confirm and save only with every choice made; a removal makes it
  // the danger action.
  const confirm = () => button(view.render().props.foot, "Confirm and save");
  assert.deepEqual(plain(footButtons(view.render())), [
    ["Cancel", false, "v2-btn"],
    ["Confirm and save", true, "v2-btn v2-btn--primary"],
  ]);
  const pick = (s, label) =>
    ofType(
      nodes(sections()[s]).find((n) => n.type === "label" && text(n) === label),
      "input",
    )[0].props.onChange();
  pick(0, "Keep and only add");
  pick(0, "Keep their existing tags");
  assert.equal(confirm().props.disabled, true, "emby not chosen yet");
  pick(1, "Remove tag assignments");
  assert.equal(confirm().props.disabled, false);
  assert.equal(confirm().props.class, "v2-btn v2-btn--danger");
  await confirm().props.onClick();
  assert.deepEqual(calls.at(-1), [
    "save",
    { radarr: { mode: "add", disable: "keep" }, emby: { disable: "delete" } },
  ]);
  // Busy: the choices, Cancel, Confirm and Close are locked.
  tree = tagPolicy({ busy: true }).view.render();
  assert.equal(tree.props.closeDisabled, true);
  assert.ok(
    ofType(tree.props.children, "input").every((i) => i.props.disabled),
  );
  assert.deepEqual(plain(footButtons(tree).map((b) => b[1])), [true, true]);
  button(view.render().props.foot, "Cancel").props.onClick();
  assert.deepEqual(calls.at(-1), ["close"]);
});

// --- Review tag removals ---------------------------------------------------

const PREVIEW = {
  service: "radarr",
  token: "t1",
  approvalRequired: true,
  rows: [
    {
      id: 1,
      label: "hdr",
      origin: "scopearr",
      assignments: 12,
      deleteDefinition: true,
      retained: false,
      targets: [
        { id: 7, title: "Dune" },
        { id: 8, title: "" },
      ],
    },
    {
      id: 2,
      label: "4k",
      origin: "existing",
      assignments: 0,
      deleteDefinition: false,
      retained: true,
      targets: [],
    },
    {
      id: 3,
      label: "old",
      origin: "",
      assignments: 1,
      deleteDefinition: false,
      retained: false,
      targets: [{ id: 9, title: "Arrival" }],
    },
  ],
};
function tagReview(props = {}, answer = async () => PREVIEW) {
  const calls = [];
  const view = mount(
    "components/TagReview.tsx",
    "TagReview",
    {
      requests: [
        {
          service: "radarr",
          config: { id: "radarr", type: "radarr", name: "Movies" },
        },
      ],
      close: () => calls.push(["close"]),
      confirm: async (tokens) => calls.push(["confirm", plain(tokens)]),
      ...props,
    },
    {
      "../api": {
        api: (path, method, body) => (
          calls.push(["api", path, method, plain(body)]),
          answer(body)
        ),
      },
      "../i18n": i18n,
      "../instances": instances,
      "../ui": { ICON: { label: 15, button: 16 } },
    },
  );
  return { view, calls };
}

test("tag review keeps preview, pages, refresh and confirm", async () => {
  let resolve;
  const { view, calls } = tagReview(
    {},
    () => new Promise((r) => (resolve = r)),
  );
  let tree = view.render();
  assert.equal(tree.props.id, "tagReview");
  assert.equal(tree.props.title, "Review tag removals");
  assert.match(
    text(byClass(tree.props.children, "v2-modal-hint")[0]),
    /^No tags are changed until you confirm\./,
  );
  assert.deepEqual(calls[0], [
    "api",
    "tag-preview",
    "POST",
    {
      service: "radarr",
      config: { id: "radarr", type: "radarr", name: "Movies" },
    },
  ]);
  // While it loads: a placeholder per service (its heading in place), no
  // visible "Loading …", which only a screen reader hears; Close and
  // every action locked.
  assert.equal(tree.props.closeDisabled, true);
  assert.deepEqual(plain(ofType(tree.props.children, "h3").map(text)), [
    "Movies",
  ]);
  const loading = nodes(tree.props.children).find(
    (n) => n.props?.role === "status",
  );
  assert.equal(text(loading), "Loading …");
  assert.deepEqual(classes(loading), ["v2-sr-only"]);
  assert.equal(ofType(tree.props.children, "LoaderCircle").length, 0);
  assert.deepEqual(plain(footButtons(tree)), [
    ["Cancel", true, "v2-btn"],
    ["Refresh preview", true, "v2-btn"],
    ["Confirm changes", true, "v2-btn v2-btn--danger"],
  ]);
  resolve(PREVIEW);
  await settle();
  tree = view.render();
  assert.equal(tree.props.closeDisabled, false);
  // The table: Tag, Origin, Assignments to remove, Definition; the 1.7.0
  // texts literal.
  const table = ofType(tree.props.children, "table")[0];
  assert.deepEqual(classes(table), ["v2-table"]);
  assert.deepEqual(
    plain(ofType(table, "th").map((h) => [text(h), h.props.scope])),
    [
      ["Tag", "col"],
      ["Origin", "col"],
      ["Assignments to remove", "col"],
      ["Definition", "col"],
    ],
  );
  const rows = ofType(ofType(table, "tbody")[0], "tr");
  const cells = (r) => ofType(r, "td");
  assert.deepEqual(
    plain(
      rows.map((r) => [
        text(cells(r)[0]),
        text(cells(r)[1]),
        text(cells(r)[3]),
        cells(r).map((c) => c.props["data-label"]),
      ]),
    ),
    [
      [
        "hdr",
        "Created by Scopearr",
        "Delete unused definition",
        ["Tag", "Origin", "Assignments to remove", "Definition"],
      ],
      [
        "4k",
        "Already present",
        "Keep: still referenced",
        ["Tag", "Origin", "Assignments to remove", "Definition"],
      ],
      [
        "old",
        "Origin not recorded",
        "Keep definition",
        ["Tag", "Origin", "Assignments to remove", "Definition"],
      ],
    ],
  );
  assert.equal(text(cells(rows[1])[2]), "0");
  // The affected titles of a tag: a disclosure with the titles (#id
  // without one) and pages of 100 above 10 assignments.
  const targets = nodes(cells(rows[0])[2]).find(
    (n) => typeof n.type === "function",
  );
  assert.ok(targets, "the titles of the first tag");
  assert.equal(ofType(tree.props.children, "TableScroll").length, 1);
  // Media servers: the definition is not applicable.
  const media = tagReview({
    requests: [{ service: "radarr", config: { id: "radarr", type: "emby" } }],
  });
  media.view.render();
  await settle();
  assert.ok(
    ofType(media.view.render().props.children, "td").some(
      (c) => text(c) === "Not applicable",
    ),
  );
  // No rows: the 1.7.0 text.
  const empty = tagReview({}, async () => ({ ...PREVIEW, rows: [] }));
  empty.view.render();
  await settle();
  assert.equal(
    text(byClass(empty.view.render().props.children, "v2-modal-text")[0]),
    "No tags will be removed.",
  );
  // Refresh preview asks again; Confirm changes hands the tokens over.
  calls.length = 0;
  await button(view.render().props.foot, "Refresh preview").props.onClick();
  assert.equal(calls[0][1], "tag-preview");
  await settle();
  await button(view.render().props.foot, "Confirm changes").props.onClick();
  assert.deepEqual(calls.at(-1), ["confirm", { radarr: "t1" }]);
  button(view.render().props.foot, "Cancel").props.onClick();
  assert.deepEqual(calls.at(-1), ["close"]);
  // A failed confirmation shows its error and resets the preview, so
  // Confirm changes waits for a new one.
  const failing = tagReview({
    confirm: async () => {
      throw new Error("Remote data changed");
    },
  });
  failing.view.render();
  await settle();
  await button(
    failing.view.render().props.foot,
    "Confirm changes",
  ).props.onClick();
  tree = failing.view.render();
  assert.deepEqual(plain(alerts(tree.props.children).map(text)), [
    "Remote data changed",
  ]);
  assert.deepEqual(classes(alerts(tree.props.children)[0]), [
    "v2-notice",
    "v2-notice--error",
  ]);
  assert.equal(ofType(tree.props.children, "table").length, 0);
  assert.equal(button(tree.props.foot, "Confirm changes").props.disabled, true);
  // A failed preview the same.
  const refused = tagReview({}, async () => {
    throw new Error("Service unreachable");
  });
  refused.view.render();
  await settle();
  assert.deepEqual(
    plain(alerts(refused.view.render().props.children).map(text)),
    ["Service unreachable"],
  );
  // With a preview at hand, no request.
  const given = tagReview({ initial: [PREVIEW] });
  given.view.render();
  await settle();
  assert.equal(given.calls.length, 0);
  assert.equal(ofType(given.view.render().props.children, "table").length, 1);
});

test("tag review pages through the affected titles of a tag", async () => {
  const pages = [];
  const { view } = tagReview({ initial: [PREVIEW] }, async (body) => {
    pages.push(body.page);
    return { targets: [{ id: 100 + body.page, title: "Page " + body.page }] };
  });
  const cell = ofType(
    ofType(view.render().props.children, "tbody")[0],
    "td",
  )[2];
  const node = nodes(cell).find((n) => typeof n.type === "function");
  // Targets has hooks of its own: run it in its own runtime.
  const runtime = createHookRuntime();
  const run = () => {
    current = runtime;
    return runtime.settle(() => node.type(node.props));
  };
  let more = run();
  assert.equal(more.type, "details");
  assert.deepEqual(classes(more), ["v2-modal-more"]);
  assert.equal(text(ofType(more, "summary")[0]), "12 affected titles");
  assert.deepEqual(plain(ofType(more, "li").map(text)), ["Dune", "#8"]);
  assert.deepEqual(
    plain(
      ofType(more, "button").map((b) => [
        text(b),
        b.props.disabled,
        b.props.class,
      ]),
    ),
    [
      ["Previous page", true, "v2-btn v2-btn--sm"],
      ["Show affected titles", false, "v2-btn v2-btn--sm"],
    ],
  );
  button(more, "Show affected titles").props.onClick();
  await settle();
  more = run();
  assert.deepEqual(plain(ofType(more, "li").map(text)), ["Page 1"]);
  // Page 1 of 12 titles is the last (100 a page).
  assert.equal(button(more, "Next page").props.disabled, true);
  assert.equal(button(more, "Previous page").props.disabled, true);
  assert.deepEqual(pages, [1]);
});

// --- Log entry ---------------------------------------------------------------

const ENTRY = {
  id: 3,
  ts: Date.UTC(2026, 10, 6, 9, 30),
  level: "error",
  source: "sync",
  instance: "radarr",
  message: "Sync failed",
  params: {},
  subject: "Dune",
  detail: "connection refused",
  repeat: 4,
};
function logEntry(entry = ENTRY) {
  const calls = [];
  const tree = mount(
    "components/dialog/LogEntryDialog.tsx",
    "LogEntryDialog",
    {
      entry,
      serviceName: (id) => "Name of " + id,
      sourceLabel: (v) => "Source " + v,
      copy: (value) => calls.push(["copy", value]),
      close: () => calls.push(["close"]),
    },
    {
      "../../event-log": eventLog,
      "../../i18n": i18n,
      "../../ui": { ICON: { label: 15, button: 16 }, count: String },
    },
  ).render();
  return { tree, calls };
}

test("the log entry keeps its rows and both copies", () => {
  const { tree, calls } = logEntry();
  assert.equal(tree.props.id, "logEntry");
  assert.equal(tree.props.title, "Log entry");
  const rows = ofType(tree.props.children, "KeyValues")[0].props.rows;
  assert.deepEqual(plain(rows.map((r) => r.label)), [
    "Time",
    "Level",
    "Source",
    "Service",
    "Subject",
    "Message",
    "Repetitions",
  ]);
  const value = (label) => rows.find((r) => r.label === label).value;
  const iso = new Date(ENTRY.ts).toISOString();
  assert.equal(text(value("Time")), new Date(ENTRY.ts).toLocaleString() + iso);
  assert.deepEqual(plain(byClass(value("Time"), "v2-modal-hint").map(text)), [
    iso,
  ]);
  assert.equal(value("Level").type, "StatusTag");
  assert.deepEqual(plain(value("Level").props.view), {
    tone: "error",
    text: "Error",
    long: "Error",
  });
  assert.equal(text(value("Source")), "Source sync");
  assert.equal(text(value("Service")), "Name of radarr");
  assert.equal(text(value("Subject")), "Dune");
  assert.equal(text(value("Message")), "Sync failed");
  assert.equal(text(value("Repetitions")), "4");
  // Only the fields with a value.
  const bare = logEntry({
    ...ENTRY,
    instance: "",
    subject: "",
    detail: "",
    repeat: 1,
  }).tree;
  assert.deepEqual(
    plain(
      ofType(bare.props.children, "KeyValues")[0].props.rows.map(
        (r) => r.label,
      ),
    ),
    ["Time", "Level", "Source", "Message"],
  );
  assert.equal(ofType(bare.props.children, "Terminal").length, 0);
  // The details: a terminal that stays at its top, Copy details beside
  // its heading.
  const terminal = ofType(tree.props.children, "Terminal")[0];
  assert.equal(terminal.props.label, "Details");
  assert.equal(terminal.props.text, "connection refused");
  assert.equal(terminal.props.follow, false);
  assert.equal(text(terminal), "connection refused");
  assert.deepEqual(
    plain(byClass(tree.props.children, "v2-modal-h").map(text)),
    ["Details"],
  );
  const copyDetails = button(tree.props.children, "Copy details");
  assert.equal(copyDetails.props.title, "Copy details");
  copyDetails.props.onClick();
  assert.deepEqual(calls.at(-1), ["copy", "connection refused"]);
  // The foot: Copy (the whole entry as one line) and Close.
  assert.deepEqual(plain(footButtons(tree)), [
    ["Copy", false, "v2-btn"],
    ["Close", false, "v2-btn"],
  ]);
  button(tree.props.foot, "Copy").props.onClick();
  assert.deepEqual(calls.at(-1), [
    "copy",
    iso +
      " ERROR [Source sync/Name of radarr] Sync failed · Dune ×4 · connection refused",
  ]);
  const plainCopy = logEntry({
    ...ENTRY,
    instance: "",
    subject: "",
    detail: "",
    repeat: 1,
  });
  button(plainCopy.tree.props.foot, "Copy").props.onClick();
  assert.deepEqual(plainCopy.calls.at(-1), [
    "copy",
    iso + " ERROR [Source sync] Sync failed",
  ]);
  button(tree.props.foot, "Close").props.onClick();
  assert.deepEqual(calls.at(-1), ["close"]);
});
