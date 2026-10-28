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
      // Expand Vite's metadata and lazy message globs with the real catalogs.
      const dir = new URL("../src/locales/", import.meta.url);
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
const { RenameCompanionsDialog } =
  await import("../src/components/RenameCompanionsDialog.tsx");
const rename = await import("../src/file-rename.ts");
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
function preview(override = {}) {
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
function dialog(p, save = () => {}) {
  return RenameCompanionsDialog({ preview: p, close() {}, save });
}

test("rename preview displays media and companion devices on the real disk tags", () => {
  const tree = dialog(preview());
  const tags = nodes(tree).filter((node) => node.type?.name === "DiskTag");
  assert.deepEqual(
    tags.map((node) => node.props.disk),
    ["disk1", "cache"],
  );
  for (const node of tags) {
    const rendered = node.type(node.props);
    assert.equal(text(rendered), node.props.disk);
    assert.ok(
      nodes(rendered).some((child) =>
        child.props?.class?.includes("placement-disk-tag"),
      ),
    );
  }
  assert.match(text(tree), /New\.mkv/);
  assert.match(text(tree), /Old\.de\.srt → New\.de\.srt/);
});

test("user-share preview explains setup and leaves unsupported disk locations blank", () => {
  const tree = dialog(
    preview({
      device: "",
      userShare: true,
      companions: [
        { from: "Old.srt", to: "New.srt", conflict: false, device: "" },
      ],
    }),
  );
  const hint = nodes(tree).find((node) => node.props?.class === "cell-hint");
  assert.ok(hint, "missing user share hint");
  assert.equal(text(hint), "Renamed through the user share");
  assert.equal(
    hint.props.title,
    "Set up Unraid under Settings → Services → Unraid to rename directly on the disk.",
  );
  assert.equal(
    nodes(tree).filter((node) => node.type?.name === "DiskTag").length,
    0,
  );
});

test("companion device information preserves explicit conflict blocking and media-only action", () => {
  const calls = [];
  const p = preview();
  p.companions[0].conflict = true;
  const tree = dialog(p, (value) => calls.push(value));
  const buttons = nodes(tree).filter((node) => node.type === "button");
  const all = buttons.find(
    (node) => text(node) === "Rename companion files too",
  );
  const media = buttons.find((node) => text(node) === "Only the media file");
  assert.equal(all.props.disabled, true);
  media.props.onClick();
  assert.deepEqual(calls, [false]);
});

test("completed refreshes warn when new devices or a verification warning are returned", () => {
  assert.equal(typeof rename.renameResultTone, "function");
  assert.equal(
    rename.renameResultTone({ refresh: "completed", newDevices: [] }),
    "success",
  );
  assert.equal(
    rename.renameResultTone({ refresh: "completed", newDevices: ["cache"] }),
    "warning",
  );
  assert.equal(
    rename.renameResultTone({
      refresh: "completed",
      warning: "Folder locations could not be checked.",
    }),
    "warning",
  );
  assert.equal(rename.renameResultTone({ refresh: "pending" }), "warning");
  assert.equal(rename.renameResultTone({ refresh: "failed" }), "warning");
});

test("media-only rename preview retains disk/fallback explanation and one explicit rename action", () => {
  const calls = [];
  const tree = dialog(
    preview({ companions: [], userShare: true, device: "" }),
    (value) => calls.push(value),
  );
  const renameButton = nodes(tree).find(
    (node) => node.type === "button" && text(node) === "Rename file",
  );
  assert.ok(renameButton);
  assert.ok(
    nodes(tree).some(
      (node) =>
        node.props?.class === "cell-hint" &&
        text(node) === "Renamed through the user share",
    ),
  );
  renameButton.props.onClick();
  assert.deepEqual(calls, [false]);
  assert.equal(
    nodes(tree).some(
      (node) =>
        node.type === "button" && text(node) === "Rename companion files too",
    ),
    false,
  );
});
