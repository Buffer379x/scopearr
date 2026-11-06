import ts from "typescript";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as jsxRuntime from "preact/jsx-runtime";
import * as icons from "lucide-preact";

function transpile(path) {
  const source = readFileSync(
    new URL("../../src/" + path, import.meta.url),
    "utf8",
  );
  return ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      jsxImportSource: "preact",
    },
  }).outputText;
}

// Run a source module (.ts/.tsx under web/src) with explicit dependencies.
// Anything not listed in `modules` (besides JSX runtime and icons) is rejected.
export function loadSource(path, { modules = {}, browser = {} } = {}) {
  const exports = {};
  runInNewContext(transpile(path), {
    exports,
    Blob,
    URLSearchParams,
    setTimeout,
    ...browser,
    require(spec) {
      if (spec in modules) return modules[spec];
      if (spec === "preact/jsx-runtime") return jsxRuntime;
      if (spec === "lucide-preact") return icons;
      throw new Error("Unexpected dependency: " + spec + " in " + path);
    },
  });
  return exports;
}

// Run actual component code with deterministic hook state. Browser APIs and
// parent callbacks remain explicit boundaries; JSX uses real Preact VNodes.
export function componentHarness(
  name,
  props,
  { modules = {}, browser = {}, exportName = name } = {},
) {
  const state = [];
  let cursor = 0;
  const fakes = {
    "preact/hooks": {
      useRef: () => ({ current: null }),
      useState(initial) {
        const slot = cursor++;
        if (!(slot in state))
          state[slot] = typeof initial === "function" ? initial() : initial;
        return [
          state[slot],
          (next) => {
            state[slot] = typeof next === "function" ? next(state[slot]) : next;
          },
        ];
      },
    },
    "../ui": { ICON: { label: 15, button: 16 } },
    "./Modal": { Modal: "Modal" },
    "../i18n": {
      useI18n: () => ({ locale: "en" }),
      t: (key, values = {}) =>
        key.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? ""),
    },
  };
  const exports = loadSource("components/" + name + ".tsx", {
    modules: { ...fakes, ...modules },
    browser,
  });
  return {
    exports,
    render() {
      cursor = 0;
      return exports[exportName](props);
    },
  };
}

export function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}

export function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (tree && typeof tree === "object") return text(tree.props?.children);
  return tree == null || typeof tree === "boolean" ? "" : String(tree);
}

export function find(tree, type, label) {
  return nodes(tree).find(
    (node) =>
      node.type === type && (label === undefined || text(node) === label),
  );
}
