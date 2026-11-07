import ts from "typescript";
import { existsSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { runInNewContext } from "node:vm";
import * as jsxRuntime from "preact/jsx-runtime";
import * as icons from "lucide-preact";

// Pure presentation components (no side effects on import) that
// componentHarness replaces with named string components. New design-system
// components are added here, and only here.
export const PRESENTATION_MODULES = Object.freeze([
  "components/Modal",
  "components/Pagination",
  "components/PageHeader",
  "components/EmptyState",
  "components/SelectionBox",
  "components/SavePresetDialog",
  "components/TerminalOutput",
  "components/frame/BrandMark",
  "components/frame/NavLink",
  "components/frame/SyncStatus",
  "components/frame/Topbar",
]);

function sourceUrl(path) {
  return new URL("../../src/" + path, import.meta.url);
}

function readSource(path) {
  return readFileSync(sourceUrl(path), "utf8");
}

function transpile(path) {
  return ts.transpileModule(readSource(path), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      jsxImportSource: "preact",
    },
  }).outputText;
}

// Names of the functions, classes and constants a module exports.
function exportedNames(path) {
  const file = ts.createSourceFile(
    path,
    readSource(path),
    ts.ScriptTarget.ES2022,
    false,
    ts.ScriptKind.TSX,
  );
  const names = new Set();
  for (const statement of file.statements) {
    const exported = ts
      .getModifiers(statement)
      ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement)) &&
      statement.name
    )
      names.add(statement.name.text);
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations)
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
  }
  return names;
}

// A stand-in for a presentation module: each exported component is a string
// type named after the export, so it renders as a VNode such as
// { type: "Pagination", props } with its children intact. Logic exports and
// unknown names throw; pass those modules explicitly.
export function stubModule(path) {
  const file = [".tsx", ".ts"]
    .map((extension) => path + extension)
    .find((candidate) => existsSync(sourceUrl(candidate)));
  const names = exportedNames(file ?? path + ".tsx");
  return new Proxy(Object.create(null), {
    get(_, name) {
      if (typeof name === "symbol") return undefined;
      if (names.has(name) && /^[A-Z]/.test(name)) return name;
      throw new Error(
        path + " is stubbed: " + name + " is not one of its components",
      );
    },
  });
}

// Resolve one import of the module at `from` (src-relative). Explicit modules
// come first, then the JSX runtime and icons, then allow-listed stubs, matched
// by their path resolved from the importing folder. Everything else throws.
export function resolveDependency(spec, { from, modules = {}, stubs = [] }) {
  if (Object.hasOwn(modules, spec)) return modules[spec];
  if (spec === "preact/jsx-runtime") return jsxRuntime;
  if (spec === "lucide-preact") return icons;
  if (spec.startsWith("./") || spec.startsWith("../")) {
    const path = posix.normalize(posix.join(posix.dirname(from), spec));
    if (stubs.includes(path)) return stubModule(path);
  }
  throw new Error("Unexpected dependency: " + spec + " in " + from);
}

// Run a source module (.ts/.tsx under web/src) with explicit dependencies.
// Anything not listed in `modules` (besides JSX runtime and icons) is rejected;
// presentation modules are stubbed only when listed in `stubs`.
export function loadSource(
  path,
  { modules = {}, browser = {}, stubs = [] } = {},
) {
  const exports = {};
  runInNewContext(transpile(path), {
    exports,
    Blob,
    URLSearchParams,
    setTimeout,
    ...browser,
    require: (spec) => resolveDependency(spec, { from: path, modules, stubs }),
  });
  return exports;
}

// Run actual component code with deterministic hook state. Browser APIs and
// parent callbacks remain explicit boundaries; JSX uses real Preact VNodes.
export function componentHarness(
  name,
  props,
  {
    modules = {},
    browser = {},
    exportName = name,
    stubs = PRESENTATION_MODULES,
  } = {},
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
    "../i18n": {
      useI18n: () => ({ locale: "en" }),
      t: (key, values = {}) =>
        key.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? ""),
    },
  };
  const exports = loadSource("components/" + name + ".tsx", {
    modules: { ...fakes, ...modules },
    browser,
    stubs,
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
