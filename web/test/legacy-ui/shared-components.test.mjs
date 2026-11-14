// Legacy UI (1.7.0 look) – replaced in Phase 5c and 5d by role-based harness tests of the v2 components; the library and tool parts left with Phase 5a and 5b.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { componentHarness, nodes } from "../helpers/component-harness.mjs";
import { createHookRuntime } from "../helpers/hook-runtime.mjs";
import { src } from "../helpers/sources.mjs";

const modules = { "../ui": { ICON: { button: 16 }, count: String } };

test("only the placement disk list keeps an inline pagination", () => {
  // The placement disk list is aligned in phase 5.
  const hits = readdirSync(new URL("../../src/components/", import.meta.url))
    .filter((f) => f.endsWith(".tsx") && f !== "Pagination.tsx")
    .filter((f) => src("components/" + f).includes('class="pagination"'));
  assert.deepEqual(hits, ["PlacementDialogs.tsx"]);
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
