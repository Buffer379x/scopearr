import test from "node:test";
import assert from "node:assert/strict";
import {
  componentHarness,
  find,
  nodes,
  text,
} from "./helpers/component-harness.mjs";
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

test("both log dialogs share the terminal output", () => {
  // The mux log is on the v2 Terminal since Phase 5d, Task 8
  // (mux-dialogs.test.mjs), the placement log with Task 9
  // (placement-dialogs.test.mjs).
  const mux = src("components/MuxTerminalDialog.tsx");
  assert.match(mux, /import \{ Terminal \} from "\.\/dialog\/Terminal"/);
  assert.match(mux, /<Terminal label=\{t\("Terminal"\)\} text=\{text\}>/);
  assert.doesNotMatch(mux, /TerminalOutput|follow\.current/);
  const source = src("components/PlacementDialogs.tsx");
  assert.match(source, /import \{ Terminal \} from "\.\/dialog\/Terminal"/);
  assert.match(source, /<Terminal label=\{t\("Terminal"\)\} text=\{text\}>/);
  assert.doesNotMatch(source, /TerminalOutput|follow\.current/);
});

test("both preset dialogs share the save preset frame", () => {
  const presets = src("hooks/useToolPresets.tsx"),
    library = src("components/LibraryPage.tsx");
  assert.match(presets, /<SavePresetDialog/);
  assert.match(library, /<SavePresetDialog/);
  assert.doesNotMatch(presets + appShellSources(), /Save filter view/);
});
