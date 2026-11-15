import test from "node:test";
import assert from "node:assert/strict";
import {
  PRESENTATION_MODULES,
  componentHarness,
  find,
  loadSource,
  resolveDependency,
  stubModule,
  text,
} from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";
import { readSources, squash } from "./helpers/sources.mjs";

test("loadSource runs a source module with explicit dependencies and rejects unknown ones", () => {
  const effects = [];
  const hooks = {
    useRef: (current) => ({ current }),
    useEffect: (effect, deps) => effects.push({ effect, deps }),
  };
  const { usePolling } = loadSource("hooks/usePolling.ts", {
    modules: { "preact/hooks": hooks },
  });
  usePolling(
    async () => 1,
    () => null,
    ["dep"],
  );
  assert.equal(effects.length, 1);
  assert.deepEqual(effects[0].deps, ["dep"]);
  assert.throws(
    () => loadSource("hooks/usePolling.ts"),
    /Unexpected dependency: preact\/hooks in hooks\/usePolling\.ts/,
  );
});

test("readSources rejects an empty list so negative assertions cannot pass vacuously", () => {
  assert.throws(() => readSources([]), /readSources needs at least one path/);
});

test("squash folds whitespace runs into one space", () => {
  assert.equal(squash("call(\n  a,\n\t b,\r\n)  ;\n"), "call( a, b, ) ; ");
  assert.equal(squash("a b"), "a b");
  assert.equal(squash(""), "");
});

const i18n = {
  t: (key, values = {}) =>
    key.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? ""),
};
// SavePresetDialog builds its field with the settings helper (Phase 5d).
const presetField = {
  "./settings/Field": loadSource("components/settings/Field.tsx"),
};
const presetProps = {
  description: "About",
  name: "Mine",
  setName() {},
  error: "",
  submit() {},
  close() {},
};

test("unknown modules still throw", () => {
  const stubs = PRESENTATION_MODULES;
  assert.throws(
    () =>
      resolveDependency("../tool-table", { from: "components/X.tsx", stubs }),
    /^Error: Unexpected dependency: \.\.\/tool-table in components\/X\.tsx$/,
  );
  // A sibling component that is not allow-listed stays a boundary.
  assert.throws(
    () =>
      resolveDependency("./SortableHeader", {
        from: "components/X.tsx",
        stubs,
      }),
    /Unexpected dependency: \.\/SortableHeader in components\/X\.tsx/,
  );
  // The harness stubs only allow-listed components, never other siblings.
  assert.throws(
    () => componentHarness("MuxOptionsDialog", {}),
    /Unexpected dependency: \.\/MuxTrackTable in components\/MuxOptionsDialog\.tsx/,
  );
});

test("prototype names are not modules", () => {
  for (const spec of ["toString", "constructor", "__proto__", "hasOwnProperty"])
    assert.throws(
      () => resolveDependency(spec, { from: "components/X.tsx" }),
      new RegExp("Unexpected dependency: " + spec + " in components/X\\.tsx"),
    );
  assert.throws(
    () =>
      resolveDependency("toString", {
        from: "components/X.tsx",
        modules: { "../ui": {} },
        stubs: PRESENTATION_MODULES,
      }),
    /Unexpected dependency: toString/,
  );
});

test("explicit modules win over stubs", () => {
  const modal = { Modal: "ExplicitModal" };
  assert.equal(
    resolveDependency("./Modal", {
      from: "components/X.tsx",
      modules: { "./Modal": modal },
      stubs: PRESENTATION_MODULES,
    }),
    modal,
  );
  const tree = componentHarness("SavePresetDialog", presetProps, {
    modules: { "./dialog/Modal": modal, ...presetField },
  }).render();
  assert.equal(tree.type, "ExplicitModal");
});

test("allow-listed modules render as named stubs", () => {
  assert.deepEqual([...PRESENTATION_MODULES].sort(), [
    "components/LoadingScreen",
    "components/Modal",
    "components/PageHeader",
    "components/SavePresetDialog",
    "components/SelectionBox",
    "components/TerminalOutput",
    "components/dashboard/KpiCard",
    "components/dialog/CheckRow",
    "components/dialog/Modal",
    "components/dialog/TableScroll",
    "components/dialog/TargetDisksDialog",
    "components/dialog/Terminal",
    "components/frame/BrandMark",
    "components/frame/NavLink",
    "components/frame/SyncStatus",
    "components/frame/Topbar",
    "components/list/CustomTag",
    "components/list/HelpTip",
    "components/list/ListEmpty",
    "components/list/MediaTag",
    "components/list/RowButton",
    "components/list/RowMark",
    "components/list/Tooltip",
    "components/settings/KeyValues",
    "components/settings/PalettePreview",
    "components/settings/Switch",
    "components/tools/ProgressCell",
    "components/tools/StatusTag",
    "components/tools/ToolDiskTag",
  ]);
  for (const path of PRESENTATION_MODULES) {
    const name = path.split("/").pop();
    assert.equal(stubModule(path)[name], name);
  }
  // Only the module's own components are stubbed; logic exports and unknown
  // names stay explicit.
  const pageNav = stubModule("components/list/PageNav");
  assert.throws(
    () => pageNav.itemRange,
    /components\/list\/PageNav is stubbed: itemRange is not one of its components/,
  );
  assert.throws(
    () => pageNav.Pagenav,
    /components\/list\/PageNav is stubbed: Pagenav is not one of its components/,
  );
  assert.throws(() => stubModule("components/Missing"), /ENOENT/);

  const tree = componentHarness("SavePresetDialog", presetProps, {
    modules: presetField,
  }).render();
  assert.equal(tree.type, "Modal");
  assert.equal(tree.props.title, "Save filter view");
  assert.equal(find(tree, "input").props.value, "Mine");
  assert.match(text(tree), /About/);
});

test("relative specs resolve from the importing folder", () => {
  const stubs = ["components/list/PageNav"];
  const stub = (spec, from) => resolveDependency(spec, { from, stubs });
  assert.equal(stub("./PageNav", "components/list/X.tsx").PageNav, "PageNav");
  assert.equal(
    stub("../components/list/PageNav", "hooks/useX.ts").PageNav,
    "PageNav",
  );
  assert.equal(
    stub("../components/list/./PageNav", "hooks/deep/../useX.ts").PageNav,
    "PageNav",
  );
  for (const [spec, from] of [
    ["./PageNav", "hooks/useX.ts"],
    ["../PageNav", "components/list/X.tsx"],
    ["components/list/PageNav", "components/X.tsx"],
    ["./components/list/PageNav", "hooks/useX.ts"],
  ])
    assert.throws(
      () => stub(spec, from),
      new RegExp("Unexpected dependency: " + spec.replace(/[./]/g, "\\$&")),
    );
});

test("loadSource does not stub unless asked", () => {
  assert.throws(
    () =>
      loadSource("components/SavePresetDialog.tsx", {
        modules: { "../i18n": i18n, ...presetField },
      }),
    /Unexpected dependency: \.\/dialog\/Modal in components\/SavePresetDialog\.tsx/,
  );
  const { SavePresetDialog } = loadSource("components/SavePresetDialog.tsx", {
    modules: { "../i18n": i18n, ...presetField },
    stubs: ["components/dialog/Modal"],
  });
  assert.equal(SavePresetDialog(presetProps).type, "Modal");
});

test("effects follow deps and clean up", () => {
  const rt = createHookRuntime();
  const log = [];
  let value = "a";
  const Component = () => {
    const { useEffect } = rt.hooks;
    useEffect(() => {
      log.push("every");
      return () => log.push("every cleanup");
    });
    useEffect(() => {
      log.push("once");
      return () => log.push("once cleanup");
    }, []);
    const current = value;
    useEffect(() => {
      log.push("value " + current);
      return () => log.push("value cleanup " + current);
    }, [current]);
    return current;
  };
  assert.equal(rt.render(Component), "a");
  assert.deepEqual(log, [], "effects wait for flush");
  rt.flush();
  assert.deepEqual(log, ["every", "once", "value a"]);
  rt.flush();
  assert.deepEqual(log, ["every", "once", "value a"], "a flush runs once");

  log.length = 0;
  rt.render(Component);
  rt.flush();
  assert.deepEqual(log, ["every cleanup", "every"], "same deps do not re-run");

  log.length = 0;
  value = "b";
  rt.render(Component);
  rt.flush();
  // Each cleanup runs right before its effect runs again, in slot order.
  assert.deepEqual(log, [
    "every cleanup",
    "every",
    "value cleanup a",
    "value b",
  ]);

  // Deps compare with Object.is: NaN stays, a new object re-runs.
  log.length = 0;
  value = NaN;
  rt.render(Component);
  rt.flush();
  rt.render(Component);
  rt.flush();
  assert.deepEqual(log, [
    "every cleanup",
    "every",
    "value cleanup b",
    "value NaN",
    "every cleanup",
    "every",
  ]);

  log.length = 0;
  rt.unmount();
  assert.deepEqual(log, ["every cleanup", "once cleanup", "value cleanup NaN"]);
  rt.unmount();
  assert.equal(log.length, 3, "unmount runs each cleanup once");
});

test("settle stops at a stable state and fails on loops", () => {
  const rt = createHookRuntime();
  let renders = 0;
  const Counter = () => {
    renders++;
    const [count, setCount] = rt.hooks.useState(0);
    rt.hooks.useEffect(() => {
      if (count < 3) setCount((n) => n + 1);
    });
    return count;
  };
  assert.equal(rt.settle(Counter), 3);
  assert.equal(renders, 4);
  assert.equal(rt.changed, false);
  // The setter keeps its identity; setting the same value changes nothing.
  const [, setCount] = (() => {
    let pair;
    rt.render(() => (pair = rt.hooks.useState()));
    return pair;
  })();
  let again;
  rt.render(() => ([, again] = rt.hooks.useState()));
  assert.equal(again, setCount);
  setCount(3);
  assert.equal(rt.changed, false);
  setCount(4);
  assert.equal(rt.changed, true);
  rt.render(() => rt.hooks.useState());
  assert.equal(rt.changed, false, "a render consumes the change");

  const loop = createHookRuntime();
  let loops = 0;
  const Loop = () => {
    loops++;
    const [, setTick] = loop.hooks.useState(0);
    loop.hooks.useEffect(() => setTick((n) => n + 1));
  };
  assert.throws(() => loop.settle(Loop), /render did not settle after 20/);
  assert.equal(loops, 20);
  assert.throws(
    () => loop.settle(Loop, { max: 3 }),
    /render did not settle after 3/,
  );
  assert.equal(loops, 23);
});

test("refs, memos, callbacks and contexts keep their slots", () => {
  const theme = { name: "theme" },
    other = { name: "other" };
  const rt = createHookRuntime({ contexts: new Map([[theme, "dark"]]) });
  let dep = 1,
    computed = 0;
  const Component = () => {
    const { useRef, useMemo, useCallback, useContext } = rt.hooks;
    const ref = useRef("start");
    const memo = useMemo(() => ++computed, [dep]);
    const callback = useCallback(() => dep, [dep]);
    return {
      ref,
      memo,
      callback,
      theme: useContext(theme),
      other: useContext(other),
    };
  };
  const first = rt.render(Component);
  assert.equal(first.ref.current, "start");
  assert.equal(first.theme, "dark");
  assert.equal(first.other, undefined);
  assert.deepEqual(rt.seenContexts, [theme, other]);
  first.ref.current = "kept";
  const second = rt.render(Component);
  assert.equal(second.ref, first.ref);
  assert.equal(second.ref.current, "kept");
  assert.equal(second.memo, 1);
  assert.equal(second.callback, first.callback);
  dep = 2;
  const third = rt.render(Component);
  assert.equal(third.memo, 2);
  assert.notEqual(third.callback, first.callback);
  assert.equal(third.callback(), 2);
  assert.deepEqual(rt.seenContexts, [theme, other, theme, other, theme, other]);
});

test("unknown hooks throw", () => {
  const rt = createHookRuntime();
  assert.throws(() => rt.hooks.useReducer, /Unknown hook: useReducer/);
  assert.throws(() => rt.hooks.useId, /Unknown hook: useId/);
  // A hook that moves to another slot fails instead of reading stale state.
  rt.render(() => rt.hooks.useState(1));
  assert.throws(
    () => rt.render(() => rt.hooks.useRef(1)),
    /Hook 0 changed from useState to useRef/,
  );
});
