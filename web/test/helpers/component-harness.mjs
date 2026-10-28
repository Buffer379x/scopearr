import ts from "typescript";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as jsxRuntime from "preact/jsx-runtime";
import * as icons from "lucide-preact";

// Run actual component code with deterministic hook state. Browser APIs and
// parent callbacks remain explicit boundaries; JSX uses real Preact VNodes.
export function componentHarness(
  name,
  props,
  { modules = {}, browser = {} } = {},
) {
  const state = [];
  let cursor = 0;
  const exports = {};
  const source = readFileSync(
    new URL(`../../src/components/${name}.tsx`, import.meta.url),
    "utf8",
  );
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        jsxImportSource: "preact",
      },
    }).outputText,
    {
      exports,
      Blob,
      URLSearchParams,
      setTimeout,
      ...browser,
      require(path) {
        if (path in modules) return modules[path];
        if (path === "preact/jsx-runtime") return jsxRuntime;
        if (path === "lucide-preact") return icons;
        if (path === "preact/hooks")
          return {
            useRef: () => ({ current: null }),
            useState(initial) {
              const slot = cursor++;
              if (!(slot in state))
                state[slot] =
                  typeof initial === "function" ? initial() : initial;
              return [
                state[slot],
                (next) => {
                  state[slot] =
                    typeof next === "function" ? next(state[slot]) : next;
                },
              ];
            },
          };
        if (path === "../ui") return { ICON: { label: 15, button: 16 } };
        if (path === "./Modal") return { Modal: "Modal" };
        if (path === "../i18n")
          return {
            useI18n: () => ({ locale: "en" }),
            t: (key, values = {}) =>
              key.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? ""),
          };
        throw new Error("Unexpected component dependency: " + path);
      },
    },
  );
  return {
    exports,
    render() {
      cursor = 0;
      return exports[name](props);
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
