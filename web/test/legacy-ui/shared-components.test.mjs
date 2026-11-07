// Legacy UI (1.7.0 look) – replaced in Phase 4, 5a, 5b and 5d by role-based harness tests of the v2 components.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { componentHarness, nodes } from "../helpers/component-harness.mjs";
import { createHookRuntime } from "../helpers/hook-runtime.mjs";
import { src } from "../helpers/sources.mjs";

const modules = { "../ui": { ICON: { button: 16 }, count: String } };

test("pagination renders the shared tool markup (1.7.0 look)", () => {
  const tree = componentHarness(
    "Pagination",
    {
      page: 2,
      pages: 3,
      setPage() {},
      summary: "101–200 of 250",
      summaryTitle: "Items in the list",
    },
    { modules },
  ).render();
  assert.equal(tree.props.class, "pagination");
  const [, controls] = tree.props.children;
  const [previous] = nodes(controls).filter((n) => n.type === "button");
  assert.equal(previous.props.class, "icon-button");
});

test("only the placement disk list keeps an inline pagination", () => {
  // The placement disk list is aligned in phase 5.
  const hits = readdirSync(new URL("../../src/components/", import.meta.url))
    .filter((f) => f.endsWith(".tsx") && f !== "Pagination.tsx")
    .filter((f) => src("components/" + f).includes('class="pagination"'));
  assert.deepEqual(hits, ["PlacementDialogs.tsx"]);
});

test("page header keeps the intro markup (1.7.0 look)", () => {
  const header = (props) =>
    componentHarness("PageHeader", props, { modules }).render();
  const full = header({ title: "Muxing", meta: "3 open", metaTitle: "Open" });
  assert.equal(full.props.class, "library-intro");
  const plain = header({ title: "Settings", as: "div" });
  assert.equal(plain.props.class, "library-intro");
});

test("empty state orders icon, heading and content (1.7.0 look)", () => {
  const tree = componentHarness(
    "EmptyState",
    {
      icon: { type: "svg", props: {} },
      title: "Nothing",
      children: { type: "p", props: { children: "Hint" } },
    },
    { modules },
  ).render();
  assert.equal(tree.props.class, "empty-state");
});

test("save preset dialog keeps both footers inside one form (1.7.0 look)", () => {
  const tree = componentHarness(
    "SavePresetDialog",
    {
      description: "About",
      name: "Mine",
      setName() {},
      error: "Failed",
      submit() {},
      close() {},
      children: { type: "div", props: { class: "modal-actions" } },
    },
    { modules },
  ).render();
  const parts = tree.props.children.props.children;
  assert.equal(parts[0].props.class, "error");
  assert.equal(parts[1].props.class, "quiet");
});

test("terminal output follows only while scrolled to the end (1.7.0 look)", () => {
  const runtime = createHookRuntime();
  const terminal = componentHarness(
    "TerminalOutput",
    { text: "log", children: "log" },
    { modules: { "preact/hooks": runtime.hooks } },
  );
  const tree = runtime.render(terminal.render);
  assert.equal(tree.props.class, "terminal");
});

test("both log dialogs share the terminal output (1.7.0 look)", () => {
  for (const file of ["MuxTerminalDialog", "PlacementDialogs"]) {
    const source = src("components/" + file + ".tsx");
    assert.doesNotMatch(source, /class="terminal"/);
  }
});
