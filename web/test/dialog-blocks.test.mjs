import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as preact from "preact";
import * as icons from "lucide-preact";
import { loadSource, nodes, text } from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";

// The v2 dialog building blocks (Phase 5d, Task 3; docs/STYLEGUIDE.md,
// Part 1, 10.6, 10.9 and 11.7): Modal and ModalFoot, Tabs, CheckRow and
// Terminal, built but not mounted yet. Each runs as real code with the
// hook runtime; a fake dialog, document and pre stand in for the DOM.
// Tooltip moved out of ui.tsx and SegmentedTabs into DialogTabs.tsx
// unchanged: both, a LanguageFlag and the 1.7.0 Modal render the VNodes
// recorded at the BASE of this task (goldens/).

const t = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");
const i18n = { t, getLocale: () => "en", useI18n: () => ({ locale: "en" }) };
const ICON = { label: 15, button: 16, close: 20 };

// Every module shares one hooks object; it calls the runtime that renders.
let current = createHookRuntime();
const hooks = new Proxy(
  {},
  {
    get: (_, name) => (name === "useId" ? () => "uid" : current.hooks[name]),
  },
);

function mount(component, props) {
  const runtime = createHookRuntime();
  const view = {
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

const classes = (node) => String(node?.props?.class ?? "").split(" ");
const byClass = (tree, name) =>
  nodes(tree).filter((n) => classes(n).includes(name));
const one = (tree, name) => {
  const found = byClass(tree, name);
  assert.equal(found.length, 1, "one ." + name);
  return found[0];
};
const kids = (node) => [node.props.children].flat(Infinity).filter(Boolean);

// The shape of a VNode tree, as goldens/ records it: every prop, an
// undefined one and a function by a marker.
function shape(node) {
  if (Array.isArray(node)) return node.map(shape);
  if (node == null || typeof node === "boolean") return null;
  if (typeof node !== "object") return String(node);
  const type =
    typeof node.type === "function"
      ? "fn:" + (node.type.displayName || node.type.name)
      : node.type;
  const props = {};
  for (const [key, value] of Object.entries(node.props ?? {})) {
    if (key === "children") continue;
    props[key] =
      value === undefined
        ? "<undefined>"
        : typeof value === "function"
          ? "<function>"
          : value;
  }
  return {
    type,
    key: node.key ?? null,
    props,
    children: shape(node.props?.children),
  };
}
const data = (value) => JSON.parse(JSON.stringify(value ?? null));
const GOLDEN = JSON.parse(
  readFileSync(
    new URL("./goldens/dialog-blocks-54508a8.json", import.meta.url),
    "utf8",
  ),
);
const src = (path) =>
  readFileSync(new URL("../src/" + path, import.meta.url), "utf8");

const dialogModel = loadSource("dialog-model.ts");
// The dialog still open below a closing one (dialog-stack's topmostDialog).
let below = null;
const dialogFocus = loadSource("dialog-focus.ts", {
  modules: { "./dialog-stack": { topmostDialog: () => below } },
});
const dialogModule = (name, modules = {}) =>
  loadSource("components/dialog/" + name + ".tsx", {
    modules: {
      "preact/hooks": hooks,
      "../../ui": { ICON },
      "../../i18n": i18n,
      "../../dialog-focus": dialogFocus,
      ...modules,
    },
  });

// --- Modal ---------------------------------------------------------------

// A document with the focused element and the page's h1, and a dialog
// whose body may hold an [autofocus] field.
function fakeDom({ autofocus = null } = {}) {
  const doc = { activeElement: null, h1: null };
  doc.querySelector = (selector) => (selector === "h1" ? doc.h1 : null);
  const calls = [];
  const dialog = {
    ownerDocument: doc,
    showModal() {
      calls.push("showModal");
    },
    close() {
      calls.push("close");
    },
    querySelector(selector) {
      return selector === ":scope > .v2-modal-body [autofocus]"
        ? autofocus
        : null;
    },
  };
  return { doc, dialog, calls };
}
function element(
  doc,
  name,
  { connected = true, visible = true, disabled = false } = {},
) {
  const attributes = new Map();
  return {
    name,
    disabled,
    isConnected: connected,
    getClientRects: () => (visible ? [{}] : []),
    focus() {
      doc.activeElement = this;
    },
    hasAttribute: (key) => attributes.has(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getAttribute: (key) => attributes.get(key) ?? null,
  };
}

function modal(props, { autofocus = false } = {}) {
  const stack = [],
    viewports = [];
  const { Modal } = dialogModule("Modal", {
    "../../dialog-stack": {
      pushDialog: (d) => stack.push(["push", d]),
      removeDialog: (d) => stack.push(["remove", d]),
    },
    "../../dialog-layout": {
      trackDialogViewport(d, body) {
        assert.equal(body, ":scope > .v2-modal-body");
        viewports.push(["track", d]);
        return () => viewports.push(["stop", d]);
      },
    },
    "../../dialog-model": dialogModel,
  });
  const dom = fakeDom();
  const field = autofocus ? element(dom.doc, "field") : null;
  if (field)
    dom.dialog.querySelector = (s) =>
      s === ":scope > .v2-modal-body [autofocus]" ? field : null;
  const view = mount(Modal, {
    title: "Path check",
    close() {},
    children: "Body",
    ...props,
  });
  const heading = element(dom.doc, "heading");
  const attach = () => {
    const tree = view.render();
    tree.ref.current = dom.dialog;
    const h2 = nodes(tree).find((n) => n.type === "h2");
    h2.ref.current = heading;
    return tree;
  };
  return { view, dom, heading, field, stack, viewports, attach };
}

// Phase 5d, Task 6: File & metadata's tabs row stands between the head
// and the scrolling body, so it never scrolls away.
test("a modal's bar stands between its head and its body", () => {
  const { attach } = modal({ id: "file", bar: "BAR", foot: "FOOT" });
  const tree = attach();
  assert.equal(tree.props["data-size"], "file");
  assert.equal(tree.props["data-height"], "fixed");
  const [head, bar, body, foot] = kids(tree);
  assert.deepEqual(classes(head), ["v2-modal-head"]);
  assert.equal(bar, "BAR");
  assert.deepEqual(classes(body), ["v2-modal-body"]);
  assert.equal(foot, "FOOT");
});

test("a v2 modal names itself by its title and carries its size", () => {
  const { attach } = modal({
    id: "placementDetails",
    tools: "TOOLS",
    head: "HEAD",
    foot: "FOOT",
  });
  const tree = attach();
  assert.equal(tree.type, "dialog");
  assert.deepEqual(classes(tree), ["v2-modal"]);
  assert.equal(tree.props["aria-modal"], "true");
  assert.equal(tree.props["data-size"], "lg");
  assert.equal(tree.props["data-height"], "fixed");
  const h2 = nodes(tree).find((n) => n.type === "h2");
  assert.equal(tree.props["aria-labelledby"], h2.props.id);
  assert.ok(h2.props.id, "the title has an id");
  assert.equal(text(h2), "Path check");
  assert.deepEqual(classes(h2), ["v2-modal-title"]);
  assert.equal(h2.props.tabIndex, -1);
  // Head: the title, the head slot, then the tools and Close; the body;
  // the foot after it.
  const [head, body, foot] = kids(tree);
  assert.deepEqual(classes(head), ["v2-modal-head"]);
  assert.equal(kids(head)[0], h2);
  assert.equal(kids(head)[1], "HEAD");
  const tools = one(tree, "v2-modal-tools");
  assert.equal(kids(head)[2], tools);
  const [slot, close] = kids(tools);
  assert.equal(slot, "TOOLS");
  assert.deepEqual(classes(close), ["v2-icon-btn", "v2-icon-btn--sm"]);
  assert.equal(close.props["aria-label"], "Close");
  assert.equal(close.props.type, "button");
  assert.deepEqual(classes(body), ["v2-modal-body"]);
  assert.equal(text(body), "Body");
  assert.equal(foot, "FOOT");
  // The other sizes come from DIALOGS as well.
  for (const [id, size, height] of [
    ["confirm", "sm", "auto"],
    ["savePreset", "sm", "auto"],
    ["autoTag", "sm", "auto"],
    ["password", "sm", "auto"],
    ["logEntry", "md", "auto"],
    ["muxStatus", "md", "fixed"],
    ["muxOptions", "lg", "auto"],
    ["file", "file", "fixed"],
  ]) {
    const other = modal({ id }).attach();
    assert.equal(other.props["data-size"], size, id);
    assert.equal(other.props["data-height"], height, id);
  }
  // An eyebrow makes the title the mini label.
  const eyebrow = modal({ id: "file", eyebrow: true }).attach();
  const label = nodes(eyebrow).find((n) => n.type === "h2");
  assert.deepEqual(classes(label), ["v2-modal-eyebrow"]);
  assert.equal(label.props.tabIndex, -1);
  assert.equal(eyebrow.props["aria-labelledby"], label.props.id);
  // Without a foot nothing follows the body.
  assert.equal(kids(modal({ id: "confirm" }).attach()).length, 2);
});

test("a v2 modal closes like the 1.7.0 modal", () => {
  const log = [];
  const m = modal({
    id: "confirm",
    close: () => log.push("close"),
    cancel: () => log.push("cancel"),
  });
  let tree = m.attach();
  m.view.flush();
  assert.deepEqual(m.dom.calls, ["showModal"]);
  assert.deepEqual(m.stack, [["push", m.dom.dialog]]);
  // Escape (the cancel event): cancel before close, and the browser's own
  // close is prevented.
  let prevented = 0;
  const escape = () => ({ preventDefault: () => prevented++ });
  tree.props.onCancel(escape());
  assert.deepEqual(log.splice(0), ["cancel"]);
  assert.equal(prevented, 1);
  // Without cancel, Escape closes.
  m.view.props = { ...m.view.props, cancel: undefined };
  tree = m.attach();
  tree.props.onCancel(escape());
  assert.deepEqual(log.splice(0), ["close"]);
  // A press that begins and ends on the backdrop (the dialog itself) closes.
  const d = m.dom.dialog;
  const inside = { name: "button in the body" };
  tree.props.onPointerDown({ target: d });
  tree.props.onPointerUp({ target: d });
  tree.props.onClick({ target: d, currentTarget: d });
  assert.deepEqual(log.splice(0), ["close"]);
  // A press that begins on the backdrop and ends inside (a drag into the
  // content; the click goes to the dialog, their common ancestor) does not.
  tree.props.onPointerDown({ target: d });
  tree.props.onPointerUp({ target: inside });
  tree.props.onClick({ target: d, currentTarget: d });
  assert.deepEqual(log, []);
  // A press that begins inside and ends on the backdrop does not.
  tree.props.onPointerDown({ target: inside });
  tree.props.onClick({ target: d, currentTarget: d });
  assert.deepEqual(log, []);
  // A press inside does not either.
  tree.props.onPointerDown({ target: inside });
  tree.props.onClick({ target: inside, currentTarget: d });
  assert.deepEqual(log, []);
  // Close calls close.
  one(tree, "v2-icon-btn").props.onClick();
  assert.deepEqual(log.splice(0), ["close"]);
  // closeDisabled: Close is locked, Escape and the backdrop do nothing,
  // and Escape is still prevented.
  m.view.props = { ...m.view.props, closeDisabled: true };
  tree = m.attach();
  assert.equal(one(tree, "v2-icon-btn").props.disabled, true);
  tree.props.onCancel(escape());
  assert.equal(prevented, 3);
  tree.props.onPointerDown({ target: d });
  tree.props.onPointerUp({ target: d });
  tree.props.onClick({ target: d, currentTarget: d });
  assert.deepEqual(log, []);
  // Rendering again neither shows nor stacks it again; unmounting closes it
  // and takes it off the stack, once each.
  m.view.flush();
  m.view.unmount();
  assert.deepEqual(m.dom.calls, ["showModal", "close"]);
  assert.deepEqual(m.stack, [
    ["push", d],
    ["remove", d],
  ]);
  // fitViewport hands the dialog to trackDialogViewport, which stops on
  // close; without it nothing is tracked.
  assert.deepEqual(m.viewports, []);
  const fit = modal({ id: "placementScan", fitViewport: true });
  fit.attach();
  fit.view.flush();
  assert.deepEqual(fit.viewports, [["track", fit.dom.dialog]]);
  fit.view.unmount();
  assert.deepEqual(fit.viewports, [
    ["track", fit.dom.dialog],
    ["stop", fit.dom.dialog],
  ]);
});

test("a modal focuses its autofocus field, else its title", () => {
  const plain = modal({ id: "confirm" });
  plain.attach();
  plain.view.flush();
  assert.equal(plain.dom.doc.activeElement, plain.heading);
  const form = modal({ id: "savePreset" }, { autofocus: true });
  form.attach();
  form.view.flush();
  assert.equal(form.dom.doc.activeElement, form.field);
});

test("a modal returns focus to its opener", () => {
  const open = (opener, props = {}) => {
    const m = modal({ id: "confirm", ...props });
    const doc = m.dom.doc;
    doc.h1 = element(doc, "h1");
    const button = opener && element(doc, "opener", opener);
    doc.activeElement = button;
    m.attach();
    m.view.flush();
    assert.equal(doc.activeElement, m.heading, "the title takes focus");
    return { m, doc, button };
  };
  // The opener is still there: focus returns to it, even when returnFocus
  // names another target.
  let { m, doc, button } = open({});
  m.view.unmount();
  assert.equal(doc.activeElement, button);
  ({ m, doc, button } = open(
    {},
    { returnFocus: () => element(doc, "next row button") },
  ));
  m.view.unmount();
  assert.equal(doc.activeElement, button);
  // The opener is gone (or hidden, or locked by the action that closed the
  // dialog): returnFocus() names the target.
  for (const gone of [
    { connected: false },
    { visible: false },
    { disabled: true },
  ]) {
    let next;
    ({ m, doc, button } = open(gone, {
      returnFocus: () => next,
    }));
    next = element(doc, "next row button");
    m.view.unmount();
    assert.equal(doc.activeElement, next, JSON.stringify(gone));
  }
  // Neither: the page's h1, which takes focus by script only.
  ({ m, doc } = open({ connected: false }));
  m.view.unmount();
  assert.equal(doc.activeElement, doc.h1);
  assert.equal(doc.h1.getAttribute("tabindex"), "-1");
  // returnFocus without a target falls back to the h1 as well.
  ({ m, doc } = open(null, { returnFocus: () => null }));
  m.view.unmount();
  assert.equal(doc.activeElement, doc.h1);
  // Over another open dialog (a confirmation over Custom tags, its Apply
  // locked) the fallback is that dialog's title, not the inert h1 (M-1).
  ({ m, doc } = open({ disabled: true }, { returnFocus: () => null }));
  const title = element(doc, "custom tags title");
  below = { querySelector: (s) => (s === "h2" ? title : null) };
  try {
    m.view.unmount();
  } finally {
    below = null;
  }
  assert.equal(doc.activeElement, title);
  assert.equal(title.getAttribute("tabindex"), "-1");
});

test("modal footers keep cancel before the primary action", () => {
  const { ModalFoot } = dialogModule("Modal", {
    "../../dialog-stack": {},
    "../../dialog-layout": {},
    "../../dialog-model": dialogModel,
  });
  const cancel = preact.h("button", { class: "v2-btn" }, "Cancel"),
    save = preact.h("button", { class: "v2-btn v2-btn--primary" }, "Save");
  const foot = ModalFoot({ lead: "3 of 26", children: [cancel, save] });
  assert.equal(foot.type, "div");
  assert.deepEqual(classes(foot), ["v2-modal-foot"]);
  const [lead, ...actions] = kids(foot);
  assert.deepEqual(classes(lead), ["v2-modal-foot-lead"]);
  assert.equal(text(lead), "3 of 26");
  assert.deepEqual(actions, [cancel, save]);
  // Without a lead (none, null or undefined) the actions are the only
  // children: no empty lead element.
  for (const lead of [{}, { lead: null }, { lead: undefined }]) {
    const bare = ModalFoot({ ...lead, children: [cancel, save] });
    assert.deepEqual(kids(bare), [cancel, save], JSON.stringify(lead));
    assert.equal(byClass(bare, "v2-modal-foot-lead").length, 0);
  }
  // A lead of 0 (a count) is still a lead.
  assert.equal(text(kids(ModalFoot({ lead: 0, children: save }))[0]), "0");
});

// --- Tabs ----------------------------------------------------------------

test("dialog tabs keep the 1.7.0 ids and keys", () => {
  const { Tabs } = dialogModule("Tabs");
  const changes = [];
  const items = [
    { value: "overview", label: "Overview" },
    { value: "mediainfo", label: "MediaInfo" },
    { value: "raw", label: "Raw" },
  ];
  const render = (value, extra = {}) =>
    Tabs({
      id: "file-detail",
      label: "File details",
      value,
      items,
      change: (v) => changes.push(v),
      ...extra,
    });
  const tree = render("overview", { accessory: "Last read" });
  assert.deepEqual(classes(tree), ["v2-tabs"]);
  const list = one(tree, "v2-tabs-list");
  assert.equal(list.props.role, "tablist");
  assert.equal(list.props["aria-label"], "File details");
  const tabs = nodes(tree).filter((n) => n.props?.role === "tab");
  assert.deepEqual(
    tabs.map((tab) => [
      tab.type,
      tab.props.type,
      tab.props.id,
      tab.props["aria-controls"],
      tab.props["aria-selected"],
      tab.props.tabIndex,
      classes(tab).join(" "),
    ]),
    [
      [
        "button",
        "button",
        "file-detail-tab-overview",
        "file-detail-panel-overview",
        true,
        0,
        "v2-tabs-tab",
      ],
      [
        "button",
        "button",
        "file-detail-tab-mediainfo",
        "file-detail-panel-mediainfo",
        false,
        -1,
        "v2-tabs-tab",
      ],
      [
        "button",
        "button",
        "file-detail-tab-raw",
        "file-detail-panel-raw",
        false,
        -1,
        "v2-tabs-tab",
      ],
    ],
  );
  tabs[1].props.onClick();
  assert.deepEqual(changes.splice(0), ["mediainfo"]);
  assert.equal(text(one(tree, "v2-tabs-accessory")), "Last read");
  assert.equal(byClass(render("overview"), "v2-tabs-accessory").length, 0);
  // ←/→ (wrapping), Home and End choose and focus; other keys do nothing.
  const focused = [];
  const buttons = items.map((item) => ({
    focus: () => focused.push(item.value),
    scrollIntoView() {},
  }));
  const press = (value, key) => {
    let prevented = false;
    one(render(value), "v2-tabs-list").props.onKeyDown({
      key,
      preventDefault: () => (prevented = true),
      currentTarget: {
        querySelectorAll: (selector) => {
          assert.equal(selector, "[role=tab]");
          return buttons;
        },
      },
    });
    return prevented;
  };
  assert.ok(press("overview", "ArrowRight"));
  assert.ok(press("raw", "ArrowRight"));
  assert.ok(press("overview", "ArrowLeft"));
  assert.ok(press("mediainfo", "Home"));
  assert.ok(press("overview", "End"));
  assert.equal(press("overview", "ArrowDown"), false);
  assert.deepEqual(changes, [
    "mediainfo",
    "overview",
    "raw",
    "overview",
    "raw",
  ]);
  assert.deepEqual(focused, changes);
  // reserve keeps an empty row of the same class without tabs, hidden from
  // screen readers; without reserve there is no row.
  const empty = Tabs({
    id: "file-detail",
    label: "File details",
    value: "overview",
    items: [],
    change() {},
    reserve: true,
  });
  assert.deepEqual(classes(empty), ["v2-tabs"]);
  assert.equal(empty.props["aria-hidden"], "true");
  assert.equal(nodes(empty).length, 1, "an empty row");
  assert.equal(
    Tabs({ id: "x", label: "X", value: "a", items: [], change() {} }),
    null,
  );
  // With tabs, reserve changes nothing.
  assert.deepEqual(
    data(shape(render("overview", { reserve: true }))),
    data(shape(render("overview"))),
  );
});

// --- CheckRow ------------------------------------------------------------

test("check rows show ok, warning and error with their 1.7.0 detail", () => {
  const { CheckRow } = dialogModule("CheckRow");
  for (const [props, tone, Icon, detail] of [
    [{ ok: true }, "ok", icons.Check, "Ready"],
    [
      { ok: false, warning: true },
      "warn",
      icons.TriangleAlert,
      "Needs attention",
    ],
    [{ ok: false }, "error", icons.X, "Needs attention"],
    [{ ok: true, warning: true }, "ok", icons.Check, "Ready"],
    [{ ok: false, detail: "Timed out" }, "error", icons.X, "Timed out"],
  ]) {
    const row = CheckRow({ label: "Root folder", ...props });
    const what = JSON.stringify(props);
    assert.equal(row.type, "div", what);
    assert.deepEqual(classes(row), ["v2-check-row"], what);
    assert.equal(row.props["data-tone"], tone, what);
    const [tile, label, shown] = kids(row);
    assert.deepEqual(classes(tile), ["v2-check-row-tile"], what);
    assert.equal(tile.props["aria-hidden"], "true", what);
    assert.equal(kids(tile)[0].type, Icon, what);
    assert.deepEqual(classes(label), ["v2-check-row-label"], what);
    assert.equal(text(label), "Root folder", what);
    assert.deepEqual(classes(shown), ["v2-check-row-detail"], what);
    assert.equal(text(shown), detail, what);
  }
  // An empty detail falls back like 1.7.0 (detail || default).
  assert.equal(
    text(
      one(
        CheckRow({ ok: true, label: "x", detail: "" }),
        "v2-check-row-detail",
      ),
    ),
    "Ready",
  );
});

// --- Terminal ------------------------------------------------------------

test("the terminal follows new text only at its end", () => {
  const { Terminal } = dialogModule("Terminal");
  const view = mount(Terminal, {
    label: "MKVToolNix log",
    text: "one",
    children: "one",
  });
  let tree = view.render();
  assert.equal(tree.type, "pre");
  assert.deepEqual(classes(tree), ["v2-code"]);
  assert.equal(tree.props.tabIndex, 0);
  assert.equal(tree.props["aria-label"], "MKVToolNix log");
  assert.equal(text(tree), "one");
  const pre = { scrollTop: 0, scrollHeight: 500, clientHeight: 100 };
  tree.ref.current = pre;
  view.flush();
  assert.equal(pre.scrollTop, 500, "it starts at the end");
  const more = (value) => {
    view.props = { ...view.props, text: value };
    tree = view.render();
    pre.scrollHeight += 100;
    view.flush();
  };
  // Scrolled up (more than 32 from the end): new text leaves it there.
  pre.scrollTop = 300;
  tree.props.onScroll({ currentTarget: pre });
  more("two");
  assert.equal(pre.scrollTop, 300);
  // Back near the end: new text follows.
  pre.scrollTop = 480;
  tree.props.onScroll({ currentTarget: pre });
  more("three");
  assert.equal(pre.scrollTop, 700);
  // The same text does not scroll.
  pre.scrollTop = 650;
  tree = view.render();
  view.flush();
  assert.equal(pre.scrollTop, 650);
});

// --- Unchanged 1.7.0 parts -----------------------------------------------

const modules = {
  preact,
  "preact/compat": {
    createPortal: (vnode, host) => ({
      type: "Portal",
      props: { host: host.name, children: vnode },
    }),
  },
  "preact/hooks": hooks,
};

// Tooltip closed, then open after its trigger takes keyboard focus.
function tooltipShapes(Tooltip) {
  current = createHookRuntime();
  const props = {
    content: "German",
    children: preact.h(
      "span",
      { tabIndex: 0, class: "language-flag", "aria-describedby": "info" },
      "de",
    ),
  };
  const closed = current.render(() => Tooltip(props));
  const trigger = closed.props.children[0];
  trigger.ref({ matches: () => true, closest: () => null });
  trigger.props.onFocus({});
  const open = current.render(() => Tooltip(props));
  return data({ closed: shape(closed), open: shape(open) });
}
function languageFlagShape(Tooltip) {
  const ui = {
    ICON,
    Tooltip,
    TagColors: "TagColors",
    TagVisibility: "TagVisibility",
    TagInformation: "TagInformation",
  };
  const { LanguageFlag } = loadSource("components/LanguageFlag.tsx", {
    modules: {
      "../ui": ui,
      "./list/Tooltip": { Tooltip },
      "preact/hooks": hooks,
      "../i18n": i18n,
      "../languages": {
        audioLanguage: () => ({ flag: "de" }),
        audioLanguageLabel: () => "German",
      },
    },
  });
  current = createHookRuntime({
    contexts: new Map([
      ["TagColors", {}],
      ["TagVisibility", null],
      ["TagInformation", {}],
    ]),
  });
  return data(shape(current.render(() => LanguageFlag({ value: "de" }))));
}

test("the tooltip moved out of ui.tsx unchanged", () => {
  const { Tooltip } = loadSource("components/list/Tooltip.tsx", {
    modules,
    browser: { document: { body: { name: "body" } } },
  });
  assert.deepEqual(tooltipShapes(Tooltip), GOLDEN.tooltip);
  assert.deepEqual(languageFlagShape(Tooltip), GOLDEN.languageFlag);
  assert.match(
    src("components/LanguageFlag.tsx"),
    /import \{ Tooltip \} from "\.\/list\/Tooltip";/,
  );
  assert.match(
    src("components/DiskTag.tsx"),
    /import \{ Tooltip \} from "\.\/list\/Tooltip";/,
  );
  // ui.tsx (the start set) keeps neither Tooltip nor SegmentedTabs.
  const ui = src("ui.tsx");
  assert.doesNotMatch(ui, /\bTooltip\b/);
  assert.doesNotMatch(ui, /\bSegmentedTabs\b/);
  // SegmentedTabs moved into DialogTabs.tsx, its only importer, unchanged.
  const { SegmentedTabs } = loadSource("components/DialogTabs.tsx", {
    modules: { ...modules, "../dialog-layout": {} },
  });
  current = createHookRuntime();
  assert.deepEqual(
    data(
      shape(
        current.render(() =>
          SegmentedTabs({
            label: "File details",
            id: "file-detail",
            value: "overview",
            change() {},
            items: [
              { value: "overview", label: "Overview" },
              { value: "mediainfo", label: "MediaInfo" },
            ],
          }),
        ),
      ),
    ),
    GOLDEN.segmentedTabs,
  );
});

test("the 1.7.0 modal stays as it is", () => {
  const { Modal } = loadSource("components/Modal.tsx", {
    modules: {
      "../ui": { ICON },
      "../dialog-stack": { pushDialog() {}, removeDialog() {} },
      "../i18n": i18n,
      "preact/hooks": hooks,
      "../dialog-layout": {
        trackDialogHeight: () => () => {},
        trackDialogViewport: () => () => {},
      },
    },
  });
  current = createHookRuntime();
  const props = {
    title: "Path check",
    close() {},
    wide: true,
    tabs: true,
    className: "path-check",
    children: "Body",
  };
  assert.deepEqual(
    data(shape(current.render(() => Modal(props)))),
    GOLDEN.legacyModal,
  );
});
