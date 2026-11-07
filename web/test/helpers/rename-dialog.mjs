import { readFileSync, existsSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";

// RenameCompanionsDialog for release-160-rename and its 1.7.0 look test.
// Load the real TSX component so assertions follow its rendered tree rather
// than its source text. Components remain VNodes; no fake DOM is required.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
      for (const suffix of [".ts", ".tsx"]) {
        const url = new URL(specifier + suffix, context.parentURL);
        if (existsSync(url)) return nextResolve(url.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!/\.tsx?$/.test(url) || url.includes("/node_modules/"))
      return nextLoad(url, context);
    let source = ts.transpileModule(readFileSync(new URL(url), "utf8"), {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        jsxImportSource: "preact",
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    if (url.endsWith("/i18n.tsx")) {
      // Expand Vite's metadata and lazy message globs with the real catalogs.
      const dir = new URL("../../src/locales/", import.meta.url);
      const catalogs = Object.fromEntries(
        readdirSync(dir)
          .filter((name) => name.endsWith(".json"))
          .map((name) => [
            "./locales/" + name,
            JSON.parse(readFileSync(new URL(name, dir), "utf8")),
          ]),
      );
      source = source.replace(
        /import fallback from "\.\/locales\/en.json";/,
        "const fallback = " +
          JSON.stringify(catalogs["./locales/en.json"]) +
          ";",
      );
      source = source.replace(
        /import\.meta\.glob\([\s\S]*?\}\)/,
        JSON.stringify(
          Object.fromEntries(
            Object.entries(catalogs).map(([path, c]) => [path, c.name]),
          ),
        ),
      );
      source = source.replace(
        /import\.meta\.glob\([\s\S]*?\}\)/,
        "{" +
          Object.entries(catalogs)
            .map(
              ([path, c]) =>
                JSON.stringify(path) +
                ": async () => (" +
                JSON.stringify(c) +
                ")",
            )
            .join(",") +
          "}",
      );
    }
    return {
      format: "module",
      shortCircuit: true,
      source,
    };
  },
});
export const { RenameCompanionsDialog } =
  await import("../../src/components/RenameCompanionsDialog.tsx");
export const rename = await import("../../src/file-rename.ts");
hooks.deregister();

export function nodes(value) {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object") return [];
  return [value, ...nodes(value.props?.children)];
}
export function text(value) {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value && typeof value === "object") return text(value.props?.children);
  return typeof value === "string" ? value : "";
}
export function preview(override = {}) {
  return {
    filename: "New.mkv",
    device: "disk1",
    userShare: false,
    companions: [
      {
        from: "Old.de.srt",
        to: "New.de.srt",
        conflict: false,
        device: "cache",
      },
    ],
    ...override,
  };
}
export function dialog(p, save = () => {}) {
  return RenameCompanionsDialog({ preview: p, close() {}, save });
}
