import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import {
  componentHarness,
  find,
  nodes,
  text,
} from "./helpers/component-harness.mjs";
import { appShellSources, src } from "./helpers/sources.mjs";

const modules = { "../ui": { ICON: { button: 16 }, count: String } };

function render(props) {
  return componentHarness("Pagination", props, { modules }).render();
}

test("pagination renders the shared tool markup", () => {
  const calls = [];
  const props = {
    page: 2,
    pages: 3,
    setPage: (page) => calls.push(page),
    summary: "101–200 of 250",
    summaryTitle: "Items in the list",
  };
  const tree = render(props);
  assert.equal(tree.type, "div");
  assert.equal(tree.props.class, "pagination");
  const [summary, controls] = tree.props.children;
  assert.equal(summary.type, "span");
  assert.equal(summary.props.title, "Items in the list");
  assert.equal(text(summary), "101–200 of 250");
  const buttons = nodes(controls).filter((n) => n.type === "button");
  assert.equal(buttons.length, 2);
  const [previous, next] = buttons;
  assert.equal(previous.props["aria-label"], "Previous page");
  assert.equal(previous.props.title, "Previous page");
  assert.equal(next.props["aria-label"], "Next page");
  assert.equal(next.props.title, "Next page");
  assert.equal(previous.props.class, "icon-button");
  assert.equal(previous.props.disabled, false);
  assert.equal(next.props.disabled, false);
  assert.equal(text(find(controls, "span")), "Page 2 / 3");
  previous.props.onClick();
  next.props.onClick();
  assert.deepEqual(calls, [1, 3]);
  assert.equal("type" in previous.props && previous.props.type, undefined);

  const first = nodes(render({ ...props, page: 1 })).filter(
    (n) => n.type === "button",
  );
  assert.equal(first[0].props.disabled, true);
  assert.equal(first[1].props.disabled, false);
  const last = nodes(render({ ...props, page: 3 })).filter(
    (n) => n.type === "button",
  );
  assert.equal(last[0].props.disabled, false);
  assert.equal(last[1].props.disabled, true);

  const typed = nodes(render({ ...props, buttonType: "button" })).filter(
    (n) => n.type === "button",
  );
  assert.deepEqual(
    typed.map((n) => n.props.type),
    ["button", "button"],
  );
  assert.equal(
    nodes(render({ ...props, summaryTitle: undefined })).find(
      (n) => n.type === "span",
    ).props.title,
    undefined,
  );
});

test("item ranges count from one and show zero for empty lists", () => {
  const { exports } = componentHarness("Pagination", {}, { modules });
  assert.equal(exports.itemRange(1, 100, 0), "0–0 of 0");
  assert.equal(exports.itemRange(2, 100, 250), "101–200 of 250");
  assert.equal(exports.itemRange(3, 100, 250), "201–250 of 250");
});

test("only the placement disk list keeps an inline pagination", () => {
  // The placement disk list is aligned in phase 5.
  const hits = readdirSync(new URL("../src/components/", import.meta.url))
    .filter((f) => f.endsWith(".tsx") && f !== "Pagination.tsx")
    .filter((f) => src("components/" + f).includes('class="pagination"'));
  assert.deepEqual(hits, ["PlacementDialogs.tsx"]);
});

test("page header keeps the intro markup", () => {
  const header = (props) =>
    componentHarness("PageHeader", props, { modules }).render();
  const full = header({ title: "Muxing", meta: "3 open", metaTitle: "Open" });
  assert.equal(full.type, "section");
  assert.equal(full.props.class, "library-intro");
  const [h1, span] = full.props.children;
  assert.equal(h1.type, "h1");
  assert.equal(text(h1), "Muxing");
  assert.equal(span.type, "span");
  assert.equal(span.props.title, "Open");
  assert.equal(text(span), "3 open");

  const plain = header({ title: "Settings", as: "div" });
  assert.equal(plain.type, "div");
  assert.equal(plain.props.class, "library-intro");
  assert.equal(plain.props.children[1], false);
  assert.equal(nodes(plain).filter((n) => n.type === "span").length, 0);

  const untitled = header({ title: "T", meta: "m" });
  assert.equal(find(untitled, "span").props.title, undefined);
});

test("empty state orders icon, heading and content", () => {
  const icon = { type: "svg", props: {} };
  const body = { type: "p", props: { children: "Hint" } };
  const tree = componentHarness(
    "EmptyState",
    { icon, title: "Nothing", children: body },
    { modules },
  ).render();
  assert.equal(tree.type, "div");
  assert.equal(tree.props.class, "empty-state");
  const [first, heading, rest] = tree.props.children;
  assert.equal(first, icon);
  assert.equal(heading.type, "h3");
  assert.equal(text(heading), "Nothing");
  assert.equal(rest, body);
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
  assert.equal(parts[0].props.class, "error");
  assert.equal(parts[0].props.role, "alert");
  assert.equal(text(parts[0]), "Failed");
  assert.equal(parts[1].props.class, "quiet");
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
  let effect;
  const ref = { current: { scrollTop: 0, scrollHeight: 500 } };
  const hooks = {
    useRef: (initial) => (initial === true ? { current: true } : ref),
    useEffect: (fn) => {
      effect = fn;
      fn();
    },
  };
  const tree = componentHarness(
    "TerminalOutput",
    { text: "log", children: "log" },
    { modules: { "preact/hooks": hooks } },
  ).render();
  assert.equal(tree.type, "pre");
  assert.equal(tree.props.class, "terminal");
  assert.equal(tree.props.children, "log");
  assert.equal(ref.current.scrollTop, 500);
  const scroll = (distance) =>
    tree.props.onScroll({
      currentTarget: {
        scrollHeight: 500,
        scrollTop: 0,
        clientHeight: 500 - distance,
      },
    });
  scroll(100);
  ref.current.scrollHeight = 900;
  effect();
  assert.equal(ref.current.scrollTop, 500);
  scroll(31);
  effect();
  assert.equal(ref.current.scrollTop, 900);
});

test("both log dialogs share the terminal output", () => {
  for (const file of ["MuxTerminalDialog", "PlacementDialogs"]) {
    const source = src("components/" + file + ".tsx");
    assert.match(
      source,
      /import \{ TerminalOutput \} from "\.\/TerminalOutput"/,
    );
    assert.match(source, /<TerminalOutput text=\{text\}>/);
    assert.doesNotMatch(source, /follow\.current|class="terminal"/);
  }
});

test("both preset dialogs share the save preset frame", () => {
  const presets = src("hooks/useToolPresets.tsx"),
    library = src("components/LibraryPage.tsx");
  assert.match(presets, /<SavePresetDialog/);
  assert.match(library, /<SavePresetDialog/);
  assert.doesNotMatch(presets + appShellSources(), /Save filter view/);
});
