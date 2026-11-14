import test from "node:test";
import assert from "node:assert/strict";
import {
  componentHarness,
  find,
  nodes,
  text,
} from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";
import { appShellSources, src } from "./helpers/sources.mjs";

const modules = { "../ui": { ICON: { button: 16 }, count: String } };

test("item ranges count from one and show zero for empty lists", () => {
  // The summary moved with the pager to list/PageNav (Phase 5c, P3).
  const { exports } = componentHarness(
    "list/PageNav",
    {},
    {
      modules: {
        "../../ui": modules["../ui"],
        "../../i18n": {
          t: (key, values = {}) =>
            key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? ""),
          useI18n: () => ({ locale: "en" }),
        },
      },
    },
  );
  assert.equal(exports.itemRange(1, 100, 0), "0–0 of 0");
  assert.equal(exports.itemRange(2, 100, 250), "101–200 of 250");
  assert.equal(exports.itemRange(3, 100, 250), "201–250 of 250");
});

test("page header shows the title, its summary and the action slot", () => {
  // Outside the frame (no context) the header renders in place.
  const frame = {
    preact: { createContext: () => ({}) },
    "preact/hooks": { useContext: () => null, useLayoutEffect() {} },
    "preact/compat": {
      createPortal: () => assert.fail("no portal outside the frame"),
    },
  };
  const header = (props) =>
    componentHarness("PageHeader", props, {
      modules: { ...modules, ...frame },
    }).render();
  const full = header({ title: "Muxing", meta: "3 open", metaTitle: "Open" });
  assert.equal(full.type, "div");
  assert.equal(full.props.class, "v2-page-head");
  const [box, actions] = full.props.children;
  const [h1, summary] = box.props.children;
  assert.equal(h1.type, "h1");
  assert.equal(text(h1), "Muxing");
  assert.equal(summary.type, "p");
  assert.equal(summary.props.title, "Open");
  assert.equal(text(summary), "3 open");
  assert.equal(actions.props.class, "v2-page-actions");

  const plain = header({ title: "Settings", as: "section" });
  assert.equal(plain.type, "section");
  assert.equal(text(plain.props.children[0].props.children[1]), "");
  assert.equal(nodes(plain).filter((n) => n.type === "span").length, 0);

  const untitled = header({ title: "T", meta: "m" });
  assert.equal(find(untitled, "p").props.title, undefined);
});

test("save preset dialog keeps both footers inside one form", () => {
  const dialog = (props) =>
    componentHarness(
      "SavePresetDialog",
      {
        description: "About",
        name: "Mine",
        setName() {},
        error: "",
        submit() {},
        close() {},
        ...props,
      },
      { modules },
    ).render();
  const footer = { type: "div", props: { class: "modal-actions" } };
  const tree = dialog({ error: "Failed", children: footer });
  assert.equal(tree.type, "Modal");
  assert.equal(tree.props.title, "Save filter view");
  const form = tree.props.children;
  assert.equal(form.type, "form");
  const parts = form.props.children;
  assert.deepEqual(
    [parts[0], parts[1], parts[2], parts[3]].map((n) => n.type),
    ["p", "p", "label", "div"],
  );
  assert.equal(parts[0].props.role, "alert");
  assert.equal(text(parts[0]), "Failed");
  assert.equal(text(parts[1]), "About");
  assert.equal(parts[3], footer);
  const input = find(form, "input");
  assert.equal(input.props.value, "Mine");
  assert.equal(input.props.maxLength, 80);
  assert.equal(input.props.required, true);
  assert.equal(input.props.autoFocus, true);
  assert.equal(input.props.placeholder, undefined);

  const quiet = dialog({ children: footer, placeholder: "Example" });
  assert.equal(quiet.props.children.props.children[0], "");
  assert.equal(find(quiet, "input").props.placeholder, "Example");
});

test("terminal output follows only while scrolled to the end", () => {
  const runtime = createHookRuntime();
  const props = { text: "log", children: "log" };
  const terminal = componentHarness("TerminalOutput", props, {
    modules: { "preact/hooks": runtime.hooks },
  });
  let tree = runtime.render(terminal.render);
  assert.equal(tree.type, "pre");
  assert.equal(tree.props.children, "log");
  // Preact attaches the ref before effects run.
  const pre = { scrollTop: 0, scrollHeight: 500 };
  tree.ref.current = pre;
  runtime.flush();
  assert.equal(pre.scrollTop, 500);
  // A new text renders again; its effect runs only when the text changed.
  const show = (text) => {
    props.text = text;
    tree = runtime.render(terminal.render);
    runtime.flush();
  };
  const scroll = (distance) =>
    tree.props.onScroll({
      currentTarget: {
        scrollHeight: 500,
        scrollTop: 0,
        clientHeight: 500 - distance,
      },
    });
  scroll(100);
  pre.scrollHeight = 900;
  show("log 2");
  assert.equal(pre.scrollTop, 500);
  scroll(31);
  show("log 2");
  assert.equal(pre.scrollTop, 500, "the same text does not scroll");
  show("log 3");
  assert.equal(pre.scrollTop, 900);
});

test("both log dialogs share the terminal output", () => {
  for (const file of ["MuxTerminalDialog", "PlacementDialogs"]) {
    const source = src("components/" + file + ".tsx");
    assert.match(
      source,
      /import \{ TerminalOutput \} from "\.\/TerminalOutput"/,
    );
    assert.match(source, /<TerminalOutput text=\{text\}>/);
    assert.doesNotMatch(source, /follow\.current/);
  }
});

test("both preset dialogs share the save preset frame", () => {
  const presets = src("hooks/useToolPresets.tsx"),
    library = src("components/LibraryPage.tsx");
  assert.match(presets, /<SavePresetDialog/);
  assert.match(library, /<SavePresetDialog/);
  assert.doesNotMatch(presets + appShellSources(), /Save filter view/);
});
