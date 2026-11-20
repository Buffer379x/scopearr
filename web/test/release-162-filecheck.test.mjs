import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { between, src } from "./helpers/sources.mjs";
const component = (name) => src("components/" + name + ".tsx");

test("FileCheck moves all pre-scan controls into its scan dialog", () => {
  const page = component("FileCheckPage");
  assert.match(page, /<FileCheckScanDialog/);
  // The filter drawer's groups (Phase 5b) hold only result filters.
  const filters = between(page, "const groups: ToolGroup[] = [", "];");
  for (const text of [
    "Libraries",
    "Checks",
    "Permissions",
    "Edit allowed and ignored names",
  ])
    assert.ok(
      !filters.includes('t("' + text + '")'),
      text + " must not be an outcome filter",
    );
  assert.match(filters, /t\("Shares"\)/);
});

test("manual and failed findings are selectable while fix actions use only fixable selection", () => {
  const code = component("FileCheckPage");
  assert.match(code, /function fileCheckSelectable/);
  const body = code.match(
    /export function fileCheckSelectable\([^]*?\n\}/,
  )?.[0];
  assert.ok(body, "selection predicate exists");
  const predicate = new Function(
    body
      .replace(/export /, "")
      .replace(/item: Pick<FileCheckItem, "jobStatus">/, "item") +
      "; return fileCheckSelectable;",
  )();
  for (const jobStatus of ["", "failed", "cancelled", "needs_review"])
    assert.equal(predicate({ jobStatus, fix: "manual" }), true, jobStatus);
  for (const jobStatus of ["queued", "running", "succeeded"])
    assert.equal(predicate({ jobStatus }), false, jobStatus);
  assert.match(code, /onClick=\{\(\) => fix\(selectedFixable\)\}/);
  assert.match(
    code,
    /results\.selectableIds\.filter\(\s*\(id\) =>\s*selected\.includes\(id\),?\s*\)/,
  );
  assert.match(code, /\{ all: true, query: filterQuery \}/);
});

test("command preview truncates beyond 500 lines and always copies/downloads full script", () => {
  const path = new URL(
    "../src/components/FileCheckCommandsDialog.tsx",
    import.meta.url,
  );
  assert.ok(existsSync(path), "commands dialog exists");
  const code = component("FileCheckCommandsDialog");
  assert.match(code, /lines\.length > 500/);
  assert.match(code, /lines\.slice\(0, 50\)/);
  assert.match(code, /clipboard\.writeText\(text\)/);
  assert.match(code, /new Blob\(\[text\]/);
  assert.match(code, /\.sh/);
});

test("names belong to the Unraid settings draft and checksums follow same-disk mux", () => {
  const code = component("UnraidSettings");
  assert.match(code, /title=\{t\("Files & permissions"\)\}/);
  assert.match(code, /<FileCheckNamesDialog/);
  assert.match(code, /changeFileCheck\(/);
  assert.ok(
    code.indexOf("value.verifyChecksum") > code.indexOf("value.muxSameDisk"),
  );
  assert.match(component("ConnectionSettings"), /changeFileCheck=\{/);
  assert.doesNotMatch(component("FileCheckPage"), /kind: "rules"/);
});

// Evaluate the real component with deterministic hook state and inert JSX nodes.
// Browser integration stays in the release fixture; these exercise event handlers
// and state transitions without making requests or executing generated commands.
import ts from "typescript";
import { runInNewContext } from "node:vm";
import * as fileCheck from "../src/filecheck.ts";
import * as instances from "../src/instances.ts";
function renderHarness(name, props, browser = {}) {
  const state = [];
  let index = 0;
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  const code = ts.transpileModule(component(name), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      jsxImportSource: "preact",
    },
  }).outputText;
  runInNewContext(code, {
    exports,
    Blob,
    setTimeout,
    ...browser,
    require(path) {
      if (path === "preact/jsx-runtime") return { jsx, jsxs: jsx };
      if (path === "preact/hooks")
        return {
          useRef: () => ({ current: null }),
          useState(initial) {
            const slot = index++;
            if (!(slot in state))
              state[slot] = typeof initial === "function" ? initial() : initial;
            return [
              state[slot],
              (next) => {
                state[slot] =
                  typeof next === "function" ? next(state[slot]) : next;
              },
            ];
          },
        };
      if (path === "../filecheck") return fileCheck;
      if (path === "../instances") return instances;
      if (path === "../i18n")
        return {
          useI18n() {},
          t: (key, values = {}) =>
            key.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? ""),
        };
      if (path === "../ui") return { ICON: { label: 15, button: 16 } };
      return new Proxy({}, { get: (_, key) => key });
    },
  });
  return {
    render: () => {
      index = 0;
      return exports[name](props);
    },
    exports,
  };
}
test("selection lifecycle retains visible manual findings, prunes hidden/active findings on reload and clears page/sort changes", () => {
  const code = component("FileCheckPage");
  const prune = renderHarness("FileCheckPage", {}).exports
    .fileCheckVisibleSelection;
  assert.equal(
    typeof prune,
    "function",
    "reloads prune selections through the visible-row helper",
  );
  let selected = [1, 2, 3, 4];
  const row = (id, jobStatus = "", fix = "manual") => ({ id, jobStatus, fix });
  selected = Array.from(
    prune(selected, [row(1), row(2, "failed"), row(3), row(4)]),
  );
  assert.deepEqual(
    selected,
    [1, 2, 3, 4],
    "manual and failed findings survive an unchanged poll",
  );
  selected = Array.from(
    prune(selected, [
      row(1),
      row(2, "queued"),
      row(3, "running"),
      row(4, "succeeded"),
    ]),
  );
  assert.deepEqual(
    selected,
    [1],
    "polling drops queued, running and succeeded selections",
  );
  selected = Array.from(prune(selected, [row(5), row(6, "failed")]));
  assert.deepEqual(
    selected,
    [],
    "moving to another visible page cannot retain hidden IDs",
  );
  assert.deepEqual(
    Array.from(prune([1, 5], [row(5)])),
    [5],
    "removed rows are pruned while remaining visible selections survive",
  );
  assert.match(
    code,
    /setResults\(list\);\s*setSelected\(\(current\) =>\s*fileCheckVisibleSelection\(current, list\.items\),?\s*\)/,
    "each reload prunes against returned rows",
  );
  assert.match(
    code,
    /useEffect\(\s*\(\) => setSelected\(\[\]\),\s*\[\s*filters,\s*shares,\s*page,\s*formatTableSort\(sort\),?\s*\],?\s*\)/,
    "page and sort changes clear selection even when the visible IDs overlap",
  );
});
