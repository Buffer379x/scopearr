import test from "node:test";
import assert from "node:assert/strict";
import * as icons from "lucide-preact";
import {
  componentHarness,
  find,
  loadSource,
  nodes,
  PRESENTATION_MODULES,
  text,
} from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";
import { src } from "./helpers/sources.mjs";

// The shared dialogs on the v2 modal (Phase 5d, Task 5; docs/STYLEGUIDE.md,
// Part 1, 10.9 and 11.7): the confirmation, the save-preset dialog of the
// library and the tools, the external auto-tag explanation and the custom
// tags dialog. Each runs as real code; the v2 Modal and ModalFoot are named
// stubs, so a tree shows what each dialog hands them.

const t = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");
const i18n = { t, getLocale: () => "en", useI18n: () => ({ locale: "en" }) };
const ICON = { label: 15, button: 16, row: 16 };
const ui = { ICON, count: String };
const field = loadSource("components/settings/Field.tsx");
const dialogModel = loadSource("dialog-model.ts");

const classes = (node) => String(node?.props?.class ?? "").split(" ");
const byClass = (tree, name) =>
  nodes(tree).filter((n) => classes(n).includes(name));
const ofType = (tree, type) => nodes(tree).filter((n) => n.type === type);
const buttons = (tree) => ofType(tree, "button");
const iconsOf = (tree) =>
  nodes(tree)
    .filter((n) => typeof n.type === "function")
    .map((n) => n.type);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// --- Confirmation ----------------------------------------------------------

test("confirmations keep their four kinds", async () => {
  const confirmation = loadSource("confirmation.ts");
  const runtime = createHookRuntime();
  const { ConfirmationDialog } = loadSource(
    "components/ConfirmationDialog.tsx",
    {
      modules: {
        "preact/hooks": runtime.hooks,
        "../confirmation": confirmation,
        "../dialog-model": dialogModel,
        "../i18n": i18n,
        "../ui": ui,
      },
      stubs: PRESENTATION_MODULES,
    },
  );
  const render = () => {
    const tree = runtime.render(() => ConfirmationDialog());
    runtime.flush();
    return tree;
  };
  assert.equal(render(), null, "nothing asks, nothing shows");
  const kinds = [
    {
      ask: () => confirmation.confirmAction("Mark 3 files?", "Mark for muxing"),
      title: "Confirm action",
      action: "Mark for muxing",
      tone: "v2-btn v2-btn--primary",
      icon: [],
    },
    {
      ask: () => confirmation.confirmDiscard("Discard the draft?"),
      title: "Really cancel?",
      action: "Discard changes",
      tone: "v2-btn",
      icon: [],
    },
    {
      ask: () => confirmation.confirmReset("Reset the columns?"),
      title: "Restore defaults",
      action: "Restore defaults",
      tone: "v2-btn",
      icon: ["RotateCcw"],
    },
    {
      ask: () => confirmation.confirmDeletion("Delete the rule?"),
      title: "Confirm deletion",
      action: "Delete",
      tone: "v2-btn v2-btn--danger",
      icon: ["Trash2"],
    },
    {
      ask: () =>
        confirmation.confirmDeletion("Remove the tags?", false, "Remove"),
      title: "Confirm deletion",
      action: "Remove",
      tone: "v2-btn v2-btn--danger",
      icon: ["Trash2"],
    },
  ];
  for (const kind of kinds)
    for (const answer of ["cancel", "escape", "action"]) {
      const asked = kind.ask();
      const tree = render();
      const label = kind.title + " · " + answer;
      assert.equal(tree.type, "Modal", label);
      assert.equal(tree.props.id, "confirm", label);
      assert.equal(tree.props.title, kind.title, label);
      // The message is the body; nothing in it takes focus, so the title
      // has it and Enter confirms nothing by accident.
      const [message] = byClass(tree.props.children, "v2-modal-text");
      assert.equal(message.type, "p", label);
      assert.equal(text(message), currentMessage(confirmation), label);
      assert.equal(
        nodes(tree.props.children).filter((n) => n.props?.autoFocus).length,
        0,
      );
      const foot = tree.props.foot;
      assert.equal(foot.type, "ModalFoot", label);
      assert.equal(foot.props.lead, undefined, label);
      const [cancel, action, ...rest] = buttons(foot);
      assert.deepEqual(rest, [], label);
      assert.equal(text(cancel), "Cancel", label);
      assert.equal(cancel.props.class, "v2-btn", label);
      assert.equal(cancel.props.type, "button", label);
      assert.equal(text(action), kind.action, label);
      assert.equal(action.props.class, kind.tone, label);
      assert.equal(action.props.type, "button", label);
      assert.deepEqual(
        iconsOf(action),
        kind.icon.map((name) => icons[name]),
        label,
      );
      if (answer === "cancel") cancel.props.onClick();
      else if (answer === "escape") tree.props.close();
      else action.props.onClick();
      assert.equal(await asked, answer === "action", label);
      assert.equal(render(), null, label + ": closed");
    }
  // One question at a time: a second one is answered no at once.
  const first = confirmation.confirmDeletion("First?");
  assert.equal(await confirmation.confirmAction("Second?", "Go"), false);
  assert.equal(
    text(byClass(render().props.children, "v2-modal-text")),
    "First?",
  );
  confirmation.answerConfirmation(false);
  assert.equal(await first, false);
});
const currentMessage = (confirmation) =>
  confirmation.currentConfirmation()?.message;

// --- Save filter view --------------------------------------------------------

test("both preset dialogs keep name, error and their save button", () => {
  const log = [];
  const submit = (e) => log.push(["submit", e]),
    close = () => log.push(["close"]);
  const save = { type: "button", props: { type: "submit" } };
  const dialog = (props) =>
    componentHarness(
      "SavePresetDialog",
      {
        description: "About",
        name: "Mine",
        setName: (value) => log.push(["name", value]),
        error: "",
        submit,
        close,
        children: save,
        ...props,
      },
      { modules: { "./settings/Field": field } },
    ).render();
  const tree = dialog({ error: "Failed", placeholder: "Example" });
  assert.equal(tree.type, "Modal");
  assert.equal(tree.props.id, "savePreset");
  assert.equal(tree.props.title, "Save filter view");
  assert.equal(tree.props.close, close);
  // The form: the error above the field, the description, the field.
  const form = tree.props.children;
  assert.equal(form.type, "form");
  assert.equal(form.props.id, "save-preset-form");
  assert.deepEqual(classes(form), ["v2-modal-form"]);
  assert.equal(form.props.onSubmit, submit);
  const [error, description, nameField] = [form.props.children].flat();
  assert.equal(error.type, "p");
  assert.deepEqual(classes(error), ["v2-notice", "v2-notice--error"]);
  assert.equal(error.props.role, "alert");
  assert.equal(text(error), "Failed");
  assert.deepEqual(classes(description), ["v2-modal-hint"]);
  assert.equal(text(description), "About");
  assert.deepEqual(classes(nameField), ["v2-field"]);
  const label = find(nameField, "label");
  const input = find(nameField, "input");
  assert.equal(text(label), "Name");
  assert.equal(label.props.for, input.props.id);
  assert.deepEqual(classes(input), ["v2-input"]);
  assert.equal(input.props.value, "Mine");
  assert.equal(input.props.required, true);
  assert.equal(input.props.maxLength, 80);
  assert.equal(input.props.autoFocus, true);
  assert.equal(input.props.placeholder, "Example");
  input.props.onInput({ currentTarget: { value: "Other" } });
  assert.deepEqual(log.splice(0), [["name", "Other"]]);
  // The foot: Cancel, then the caller's own save button.
  const foot = tree.props.foot;
  assert.equal(foot.type, "ModalFoot");
  assert.equal(foot.props.lead, undefined);
  const [cancel, own] = [foot.props.children].flat();
  assert.equal(text(cancel), "Cancel");
  assert.equal(cancel.props.class, "v2-btn");
  assert.equal(cancel.props.type, "button");
  cancel.props.onClick();
  assert.deepEqual(log.splice(0), [["close"]]);
  assert.equal(own, save);
  // Without an error or a placeholder neither shows.
  const quiet = dialog({});
  assert.equal([quiet.props.children.props.children].flat()[0], "");
  assert.equal(find(quiet, "input").props.placeholder, undefined);
  // Both callers hand over a primary submit button of that form with
  // their own label.
  for (const [path, name] of [
    ["components/LibraryPage.tsx", "Save view"],
    ["hooks/useToolPresets.tsx", "Save preset"],
  ]) {
    const source = src(path);
    const child = source.match(
      /<SavePresetDialog[\s\S]*?>\s*(<button[\s\S]*?<\/button>)\s*<\/SavePresetDialog>/,
    )?.[1];
    assert.ok(child, path + ": one button as the child");
    assert.match(child, /type="submit"/, path);
    assert.match(child, /form="save-preset-form"/, path);
    assert.match(child, /class="v2-btn v2-btn--primary"/, path);
    assert.match(child, new RegExp('t\\("' + name + '"\\)'), path);
    assert.doesNotMatch(child, /Cancel/, path + ": Cancel is the dialog's");
  }
});

// --- External auto-tag -------------------------------------------------------

test("both auto-tag marks open one explanation", () => {
  const instances = {
    instanceByID: (settings, id) =>
      settings?.instances.find((i) => i.id === id),
    instanceLabel: (instance) => instance.name ?? instance.id,
  };
  const tag = {
    id: 5,
    name: "4K",
    protected: true,
    rules: ["radarr · Resolution is 2160p"],
  };
  const settings = { instances: [{ id: "radarr", name: "Radarr" }] };
  // The dialog: a small modal with the explanation, its lines kept.
  const { AutoTagDialog } = loadSource("components/dialog/AutoTagDialog.tsx", {
    modules: { "../../i18n": i18n },
    stubs: PRESENTATION_MODULES,
  });
  const close = () => {};
  const hint = "Used by external auto-tag rules\nRadarr · Resolution is 2160p";
  const dialog = AutoTagDialog({ hint, close });
  assert.equal(dialog.type, "Modal");
  assert.equal(dialog.props.id, "autoTag");
  assert.equal(dialog.props.title, "External auto-tag");
  assert.equal(dialog.props.close, close);
  assert.equal(dialog.props.foot, undefined);
  assert.equal(dialog.props.children.type, "p");
  assert.deepEqual(classes(dialog.props.children), ["v2-modal-text"]);
  assert.equal(text(dialog.props.children), hint);
  // The mark of the custom tags dialog opens it with autoTagHint.
  const mark = componentHarness(
    "AutoTagMark",
    { tag, settings },
    {
      modules: {
        "../instances": instances,
        "./dialog/AutoTagDialog": { AutoTagDialog: "AutoTagDialog" },
      },
    },
  );
  const { autoTagHint } = mark.exports;
  const expected = autoTagHint(tag, settings);
  assert.equal(
    expected,
    "Used by external auto-tag rules\nRadarr · Resolution is 2160p\nAssignments and deletion are controlled by the service.",
  );
  let tree = mark.render();
  assert.equal(ofType(tree, "AutoTagDialog").length, 0);
  const button = find(tree, "button");
  assert.equal(button.props["aria-label"], expected);
  const calls = [];
  button.props.onClick({
    preventDefault: () => calls.push("preventDefault"),
    stopPropagation: () => calls.push("stopPropagation"),
  });
  assert.deepEqual(calls, ["preventDefault", "stopPropagation"]);
  tree = mark.render();
  const [opened] = ofType(tree, "AutoTagDialog");
  assert.equal(opened.props.hint, expected);
  opened.props.close();
  assert.equal(ofType(mark.render(), "AutoTagDialog").length, 0);
  // The auto mark of a v2 custom tag opens the same dialog with the same
  // hint (its behavior: list-primitives, "custom tags use the user color
  // and keep the auto mark"); neither keeps a dialog of its own.
  const customTag = src("components/list/CustomTag.tsx");
  assert.match(
    customTag,
    /import \{ AutoTagDialog \} from "\.\.\/dialog\/AutoTagDialog";/,
  );
  assert.match(customTag, /const hint = auto \? autoTagHint\(tag, settings\)/);
  assert.match(
    customTag,
    /<AutoTagDialog hint=\{hint\} close=\{\(\) => setOpen\(false\)\} \/>/,
  );
  for (const path of [
    "components/list/CustomTag.tsx",
    "components/AutoTagMark.tsx",
  ])
    assert.doesNotMatch(src(path), /<Modal\b|External auto-tag/, path);
});

// --- Custom tags -------------------------------------------------------------

function customBulk(props = {}, { answer = true } = {}) {
  const runtime = createHookRuntime();
  const requests = [],
    asked = [],
    log = [];
  let respond;
  const api = (path, method, body) => {
    requests.push([path, method, body]);
    return new Promise((resolve, reject) => {
      respond = { resolve, reject };
    });
  };
  const ask =
    (kind) =>
    (message, ...rest) => {
      asked.push([kind, message, ...rest]);
      return Promise.resolve(answer);
    };
  const { CustomBulk } = loadSource("components/CustomBulk.tsx", {
    modules: {
      "preact/hooks": runtime.hooks,
      "../api": { api },
      "../confirmation": {
        confirmDeletion: ask("deletion"),
        confirmAction: ask("action"),
      },
      "../i18n": i18n,
      "../ui": ui,
      "./AutoTagMark": {
        AutoTagMark: "AutoTagMark",
        autoTagHint: (tag) => "hint for " + tag.name,
      },
      "./settings/Field": field,
    },
    stubs: PRESENTATION_MODULES,
  });
  const view = {
    props: {
      query: "service=radarr&q=a",
      settings: null,
      close: () => log.push("close"),
      saved: async (total) => log.push(["saved", total]),
      ...props,
    },
    requests,
    asked,
    log,
    respond: () => respond,
    render() {
      const tree = runtime.render(() => CustomBulk(view.props));
      runtime.flush();
      return tree;
    },
  };
  return view;
}
const SELECTION = {
  total: 3,
  counts: { 1: 3, 2: 1, 3: 1 },
  tags: [
    { id: 1, name: "kids", displayName: "Kids" },
    { id: 2, name: "4K", protected: true, rules: ["radarr · 2160p"] },
    { id: 3, name: "old" },
  ],
};
const options = (tree) =>
  byClass(tree, "v2-ff-opt").map((label) => ({
    label,
    input: find(label, "input"),
  }));
const event = (extra = {}) => {
  const calls = [];
  return {
    calls,
    preventDefault: () => calls.push("preventDefault"),
    ...extra,
  };
};

test("custom tags keep every 1.7.0 rule of the tag dialog", async () => {
  // Until the selection answers: placeholder rows, no visible “Loading …”;
  // the scope line keeps its place.
  const view = customBulk();
  let tree = view.render();
  assert.equal(tree.type, "Modal");
  assert.equal(tree.props.id, "customTags");
  assert.equal(tree.props.title, "Custom tags");
  assert.deepEqual(view.requests, [
    ["custom-selection?service=radarr&q=a", "GET", undefined],
  ]);
  const pending = byClass(tree.props.children, "v2-ff-ph");
  assert.ok(pending.length >= 4, "placeholder rows");
  const placeholders = byClass(tree.props.children, "v2-ff-list")[0];
  assert.equal(placeholders.props["aria-hidden"], "true");
  const status = nodes(tree.props.children).find(
    (n) => n.props?.role === "status",
  );
  assert.deepEqual(classes(status), ["v2-sr-only"]);
  assert.equal(text(status), "Loading …");
  const visibleLoading = nodes(tree.props.children).filter(
    (n) =>
      typeof n.props?.children === "string" &&
      n.props.children === "Loading …" &&
      !classes(n).includes("v2-sr-only"),
  );
  assert.equal(visibleLoading.length, 0);
  const [scope] = byClass(tree.props.children, "v2-modal-hint");
  assert.equal(text(scope), " ", "the scope line is reserved");
  const apply = () => buttons(tree.props.foot).find((b) => text(b) === "Apply");
  assert.equal(apply().props.disabled, true);
  assert.equal(apply().props.form, "custom-tags-form");
  assert.equal(apply().props.type, "submit");
  assert.deepEqual(classes(apply()), ["v2-btn", "v2-btn--primary"]);
  const cancel = buttons(tree.props.foot)[0];
  assert.equal(text(cancel), "Cancel");
  cancel.props.onClick();
  assert.deepEqual(view.log.splice(0), ["close"]);

  view.respond().resolve(structuredClone(SELECTION));
  await settle();
  tree = view.render();
  assert.equal(byClass(tree, "v2-ff-ph").length, 0);
  assert.equal(
    text(byClass(tree.props.children, "v2-modal-hint")[0]),
    "Changes apply to all 3 matching files, across every page.",
  );
  const all = options(tree);
  assert.deepEqual(
    all.map(({ label }) => text(label)),
    ["Kids3 / 3", "4K1 / 3", "old1 / 3"],
  );
  // Kids is on everywhere, old on some (mixed), 4K an auto tag: locked,
  // its explanation as the title, with its auto mark.
  const [kids, auto, old] = all;
  assert.equal(kids.input.props.checked, true);
  assert.equal(kids.input.props["aria-checked"], true);
  assert.equal(old.input.props.checked, false);
  assert.equal(old.input.props["aria-checked"], "mixed");
  const box = {};
  old.input.ref(box);
  assert.equal(box.indeterminate, true);
  assert.deepEqual(classes(old.input), ["v2-check"]);
  assert.equal(auto.input.props.disabled, true);
  assert.equal(auto.input.props.title, "hint for 4K");
  assert.equal(auto.label.props["aria-disabled"], "true");
  assert.equal(ofType(auto.label, "AutoTagMark").length, 1);
  assert.equal(kids.input.props.disabled, false);
  assert.deepEqual(byClass(kids.label, "v2-ff-n").map(text), ["3 / 3"]);

  // A new tag: Enter adds it without submitting the form.
  const input = () =>
    nodes(tree).find(
      (n) => n.type === "input" && n.props.placeholder === "New tag",
    );
  const add = (name) => {
    input().props.onInput({ currentTarget: { value: name } });
    tree = view.render();
    const enter = event({ key: "Enter" });
    input().props.onKeyDown(enter);
    assert.deepEqual(enter.calls, ["preventDefault"], name);
    tree = view.render();
  };
  const hintOf = () => {
    const field = byClass(tree, "v2-field").find((f) =>
      nodes(f).includes(input()),
    );
    const small = find(field, "small");
    return small ? text(small) : "";
  };
  assert.equal(text(find(byClass(tree, "v2-field")[0], "label")), "New tag");
  assert.equal(input().props.maxLength, 80);
  assert.deepEqual(classes(input()), ["v2-input"]);
  add("");
  assert.equal(hintOf(), "Enter a tag name between 1 and 80 characters");
  assert.equal(input().props["aria-invalid"], true);
  assert.equal(
    input().props["aria-describedby"],
    find(
      byClass(tree, "v2-field").find((f) => nodes(f).includes(input())),
      "small",
    ).props.id,
  );
  add("x".repeat(81));
  assert.equal(hintOf(), "Enter a tag name between 1 and 80 characters");
  // A duplicate picks the existing tag (old: from mixed to on).
  add("OLD");
  assert.equal(hintOf(), "A custom tag with this name already exists");
  assert.equal(options(tree)[2].input.props.checked, true);
  assert.equal(options(tree)[2].input.props["aria-checked"], true);
  add("Fresh");
  assert.equal(hintOf(), "");
  assert.equal(input().props["aria-invalid"], false);
  const fresh = options(tree)[3];
  assert.equal(text(fresh.label), "FreshNew");
  assert.equal(fresh.input.props.checked, true);
  assert.equal(input().props.value, "");
  // The Add button does the same.
  const addButton = buttons(tree.props.children).find((b) => text(b) === "Add");
  assert.deepEqual(classes(addButton), ["v2-btn"]);
  assert.equal(addButton.props.type, "button");

  // Apply: a change on more than one item asks first; no answer, no PUT.
  const submit = () => {
    const form = byClass(tree.props.children, "v2-modal-form")[0];
    assert.equal(form.type, "form");
    assert.equal(form.props.id, "custom-tags-form");
    const e = event();
    return form.props.onSubmit(e);
  };
  assert.equal(apply().props.disabled, false);
  view.asked.length = 0;
  const declined = customBulk({}, { answer: false });
  declined.render();
  declined.respond().resolve(structuredClone(SELECTION));
  await settle();
  let other = declined.render();
  options(other)[2].input.props.onChange({ currentTarget: { checked: true } });
  other = declined.render();
  await byClass(other.props.children, "v2-modal-form")[0].props.onSubmit(
    event(),
  );
  assert.deepEqual(declined.asked, [
    ["action", "You are about to change tags for 3 items.", "Change"],
  ]);
  assert.equal(declined.requests.length, 1, "no PUT without an answer");
  // Removing asks with its own sentence.
  options(other)[0].input.props.onChange({ currentTarget: { checked: false } });
  other = declined.render();
  await byClass(other.props.children, "v2-modal-form")[0].props.onSubmit(
    event(),
  );
  assert.deepEqual(declined.asked.at(-1), [
    "deletion",
    "You are about to remove tags from 3 items.",
    false,
    "Remove",
  ]);
  assert.equal(declined.requests.length, 1);

  // A failed save keeps the dialog open with its error.
  const saving = submit();
  await settle();
  assert.deepEqual(view.asked, [
    ["action", "You are about to change tags for 3 items.", "Change"],
  ]);
  const [path, method, body] = view.requests.at(-1);
  assert.deepEqual([path, method], ["custom-selection", "PUT"]);
  assert.deepEqual(JSON.parse(JSON.stringify(body)), {
    query: "service=radarr&q=a",
    changes: { 3: true, "new:1": true },
    create: [{ key: "new:1", name: "Fresh" }],
  });
  tree = view.render();
  assert.equal(apply().props.disabled, true, "busy");
  view.respond().reject(new Error("Tag limit reached"));
  await saving;
  tree = view.render();
  assert.equal(tree.type, "Modal");
  const error = nodes(tree.props.children).find(
    (n) => n.props?.role === "alert",
  );
  assert.deepEqual(classes(error), ["v2-notice", "v2-notice--error"]);
  assert.equal(text(error), "Tag limit reached");
  assert.deepEqual(view.log, []);
  assert.equal(apply().props.disabled, false);

  // The scope sentence of one file and of a selection; one file asks
  // nothing before a change.
  const single = customBulk(
    { single: true, files: [{ service: "radarr", id: 7 }] },
    { answer: false },
  );
  single.render();
  assert.deepEqual(single.requests[0].slice(0, 2), [
    "custom-selection",
    "POST",
  ]);
  single.respond().resolve({ ...structuredClone(SELECTION), total: 1 });
  await settle();
  let one = single.render();
  assert.equal(
    text(byClass(one.props.children, "v2-modal-hint")[0]),
    "Changes apply only to this file.",
  );
  options(one)[0].input.props.onChange({ currentTarget: { checked: false } });
  one = single.render();
  await byClass(one.props.children, "v2-modal-form")[0].props.onSubmit(event());
  assert.deepEqual(single.asked, [
    ["deletion", "Remove selected tags from this file?", false, "Remove"],
  ]);
  const picked = customBulk({
    files: [
      { service: "radarr", id: 7 },
      { service: "radarr", id: 8 },
    ],
  });
  picked.render();
  picked.respond().resolve(structuredClone(SELECTION));
  await settle();
  assert.equal(
    text(byClass(picked.render().props.children, "v2-modal-hint")[0]),
    "Changes apply to 3 selected files.",
  );

  // At 128 tags no new one can be added.
  const full = customBulk();
  full.render();
  full.respond().resolve({
    total: 1,
    counts: {},
    tags: Array.from({ length: 128 }, (_, i) => ({ id: i + 1, name: "t" + i })),
  });
  await settle();
  const limited = full.render();
  const newInput = nodes(limited).find(
    (n) => n.type === "input" && n.props.placeholder === "New tag",
  );
  assert.equal(newInput.props.disabled, true);
  assert.equal(
    buttons(limited.props.children).find((b) => text(b) === "Add").props
      .disabled,
    true,
  );
  assert.match(
    text(limited.props.children),
    /At most 128 custom tags are allowed/,
  );
  // Without tags the 1.7.0 empty text shows.
  const empty = customBulk();
  empty.render();
  empty.respond().resolve({ total: 2, counts: {}, tags: [] });
  await settle();
  assert.match(
    text(empty.render().props.children),
    /No custom tags yet\. Add one below\./,
  );
});
