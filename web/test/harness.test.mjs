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
import { readSources } from "./helpers/sources.mjs";

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

const i18n = {
  t: (key, values = {}) =>
    key.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? ""),
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
    () => componentHarness("MuxTable", {}),
    /Unexpected dependency: \.\/CompactProgress in components\/MuxTable\.tsx/,
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
    modules: { "./Modal": modal },
  }).render();
  assert.equal(tree.type, "ExplicitModal");
});

test("allow-listed modules render as named stubs", () => {
  assert.deepEqual([...PRESENTATION_MODULES].sort(), [
    "components/EmptyState",
    "components/Modal",
    "components/PageHeader",
    "components/Pagination",
    "components/SavePresetDialog",
    "components/SelectionBox",
    "components/TerminalOutput",
  ]);
  for (const path of PRESENTATION_MODULES) {
    const name = path.split("/").pop();
    assert.equal(stubModule(path)[name], name);
  }
  // Only the module's own components are stubbed; logic exports and unknown
  // names stay explicit.
  const pagination = stubModule("components/Pagination");
  assert.throws(
    () => pagination.itemRange,
    /components\/Pagination is stubbed: itemRange is not one of its components/,
  );
  assert.throws(
    () => pagination.Paginaton,
    /components\/Pagination is stubbed: Paginaton is not one of its components/,
  );
  assert.throws(() => stubModule("components/Missing"), /ENOENT/);

  const tree = componentHarness("SavePresetDialog", presetProps).render();
  assert.equal(tree.type, "Modal");
  assert.equal(tree.props.title, "Save filter view");
  assert.equal(find(tree, "input").props.value, "Mine");
  assert.match(text(tree), /About/);
});

test("relative specs resolve from the importing folder", () => {
  const stubs = ["components/Pagination"];
  const stub = (spec, from) => resolveDependency(spec, { from, stubs });
  assert.equal(
    stub("./Pagination", "components/X.tsx").Pagination,
    "Pagination",
  );
  assert.equal(
    stub("../components/Pagination", "hooks/useX.ts").Pagination,
    "Pagination",
  );
  assert.equal(
    stub("../components/./Pagination", "hooks/deep/../useX.ts").Pagination,
    "Pagination",
  );
  for (const [spec, from] of [
    ["./Pagination", "hooks/useX.ts"],
    ["../Pagination", "components/X.tsx"],
    ["components/Pagination", "components/X.tsx"],
    ["./components/Pagination", "hooks/useX.ts"],
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
        modules: { "../i18n": i18n },
      }),
    /Unexpected dependency: \.\/Modal in components\/SavePresetDialog\.tsx/,
  );
  const { SavePresetDialog } = loadSource("components/SavePresetDialog.tsx", {
    modules: { "../i18n": i18n },
    stubs: ["components/Modal"],
  });
  assert.equal(SavePresetDialog(presetProps).type, "Modal");
});
