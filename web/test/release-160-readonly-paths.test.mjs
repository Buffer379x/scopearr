import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";

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
      // Expand Vite's eager locale glob using the same real JSON catalogs.
      const dir = new URL("../src/locales/", import.meta.url);
      const catalogs = Object.fromEntries(
        readdirSync(dir)
          .filter((name) => name.endsWith(".json"))
          .map((name) => [
            name,
            JSON.parse(readFileSync(new URL(name, dir), "utf8")),
          ]),
      );
      source = source.replace(
        /import\.meta\.glob\([\s\S]*?\}\)/,
        JSON.stringify(catalogs),
      );
    }
    return {
      format: "module",
      shortCircuit: true,
      source,
    };
  },
});
const { MuxPathDialog, pathAttention } =
  await import("../src/components/MuxPathDialog.tsx");
const card = await import("../src/components/PathMappingsCard.tsx");
const { MediaInfoSettings } =
  await import("../src/components/MediaInfoSettings.tsx");
hooks.deregister();

function nodes(value) {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object") return [];
  return [value, ...nodes(value.props?.children)];
}
function text(value) {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value && typeof value === "object") return text(value.props?.children);
  return typeof value === "string" ? value : "";
}

function checks(override = {}) {
  return {
    readOnly: true,
    syntax: { ok: true },
    mappings: [
      {
        arrPath: "/arr",
        localPath: "/media/movies",
        exists: true,
        isDir: true,
        readable: true,
        writable: false,
        freeBytes: 0,
      },
    ],
    rootFolders: [
      {
        arrPath: "/arr",
        mapped: true,
        localExists: true,
        instances: ["Radarr"],
      },
    ],
    errors: [],
    samples: [{ instance: "Radarr", checked: 1, reachable: 1, sizeMatches: 1 }],
    workDir: { configured: true, exists: false, writable: false, freeBytes: 0 },
    ...override,
  };
}

test("MediaInfo mapping readiness depends on readable paths and samples, without writable workspace facts", () => {
  const result = checks();
  assert.equal(pathAttention(result), 0);
  const tree = MuxPathDialog({ checks: result, close() {} });
  const rows = nodes(tree).filter((node) => node.type?.name === "PathCheckRow");
  const mapping = rows.find(
    (node) => node.props.label === "/arr → /media/movies",
  );
  assert.equal(mapping.props.ok, true);
  assert.equal(mapping.props.detail, "Ready");
  assert.doesNotMatch(text(tree), /Muxing directory|free/);
  result.mappings[0].readable = false;
  assert.equal(pathAttention(result), 1);
  const unreadable = nodes(MuxPathDialog({ checks: result, close() {} })).find(
    (node) => node.props?.label === "/arr → /media/movies",
  );
  assert.equal(unreadable.props.ok, false);
  assert.equal(unreadable.props.detail, "Not readable");
});

test("mux path checks retain writable and working-directory blockers", () => {
  const result = checks({ readOnly: false });
  assert.equal(pathAttention(result), 2);
  const tree = MuxPathDialog({ checks: result, close() {} });
  const mapping = nodes(tree).find(
    (node) => node.props?.label === "/arr → /media/movies",
  );
  assert.equal(mapping.props.ok, false);
  assert.equal(mapping.props.detail, "Not writable for UID 99");
  assert.match(text(tree), /Muxing directory/);
});

test("shared mapping card selects a read-only endpoint and omits the mux workspace", () => {
  assert.equal(typeof card.pathCheckRequest, "function");
  const draft = { mappings: "/arr => /media/movies", workDir: "/mux-work" };
  assert.deepEqual(card.pathCheckRequest(draft, true), {
    endpoint: "mediainfo/check-paths",
    body: { mappings: "/arr => /media/movies" },
  });
  assert.deepEqual(card.pathCheckRequest(draft, false), {
    endpoint: "mux/check-paths",
    body: { mappings: "/arr => /media/movies", workDir: "/mux-work" },
  });
  const settings = MediaInfoSettings({
    cfg: {},
    change() {},
    changeMux() {},
    demo: false,
  });
  const mappings = nodes(settings).find(
    (node) => node.type?.name === "PathMappingsCard",
  );
  assert.equal(mappings.props.readOnly, true);
});
