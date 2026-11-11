// Legacy UI (1.7.0 look) – replaced in Phase 5d by the v2 stylesheet guards (stylesheet-guards.test.mjs); deleted with the last 1.7.0 stylesheet.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { sep } from "node:path";
import ts from "typescript";
import { cssRules, selectors } from "../helpers/css-rules.mjs";
import { LEGACY_STYLESHEETS, legacyCss } from "../helpers/legacy-styles.mjs";

// Media queries may adapt a component at a breakpoint. Base recipes have one
// owner, so importing another area cannot silently reverse their cascade.
const exceptions = new Map();
test("each non-media selector belongs to one stylesheet", () => {
  const owners = new Map();
  for (const file of LEGACY_STYLESHEETS) {
    const source = legacyCss(file);
    for (const rule of cssRules(source).filter(
      (r) => !r.context.some((c) => c.startsWith("@media")),
    )) {
      for (const selector of selectors(rule.header)) {
        const files = owners.get(selector) || new Set();
        files.add(file);
        owners.set(selector, files);
      }
    }
  }
  const duplicates = [...owners]
    .filter(([s, files]) => files.size > 1 && !exceptions.has(s))
    .map(([s, files]) => `${s}: ${[...files].join(", ")}`);
  assert.deepEqual(duplicates, [], "Shared recipes must have one owner");
  for (const [selector, reason] of exceptions) {
    assert.ok(reason.length > 20, selector + " needs a justification");
    assert.ok(
      owners.get(selector)?.size > 1,
      "Remove obsolete exception " + selector,
    );
  }
});

test("viewport breakpoints share the documented thresholds without duplicate blocks", () => {
  for (const file of LEGACY_STYLESHEETS) {
    const source = legacyCss(file),
      seen = new Set();
    for (const [, kind, width] of source.matchAll(
      /@media\s*\((max|min)-width:\s*(\d+)px\)/g,
    )) {
      const key = kind + width;
      assert.ok(!seen.has(key), file + ": duplicate " + key);
      seen.add(key);
      assert.ok(
        kind === "min"
          ? ["1120", "1440", "1600"].includes(width)
          : ["1120", "900", "740", "600"].includes(width),
        file + ": undocumented " + key,
      );
    }
  }
});

// Base form resets and the shared button geometry intentionally participate in
// several reset groups; merging these would duplicate their shared declarations.
const resetGroups = new Set([
  "button",
  "input",
  "select",
  "a",
  ".primary",
  ".button",
]);
test("each non-media selector has only one rule in its stylesheet", () => {
  for (const file of LEGACY_STYLESHEETS) {
    const seen = new Set(),
      duplicates = new Set();
    for (const rule of cssRules(legacyCss(file)).filter(
      (r) =>
        !r.context.some((c) => c.startsWith("@media") || /keyframes/.test(c)),
    )) {
      for (const selector of selectors(rule.header)) {
        if (
          seen.has(selector) &&
          !(file === "base.css" && resetGroups.has(selector))
        )
          duplicates.add(selector);
        seen.add(selector);
      }
    }
    assert.deepEqual(
      [...duplicates],
      [],
      file + ": consolidate duplicate selectors while preserving their cascade",
    );
  }
});

// Rules for classes that no component renders (Design §12), removed in
// Phase 4. Entries are compounds: ".notice.success" needs both classes on one
// element. `.placement-disk-source` is not listed: DiskTag builds it from
// "placement-disk-" + placementDiskTone(), so its rule stays.
const REMOVED = [
  ".footer",
  ".filter-heading",
  ".mux-progress",
  ".recognition-actions",
  ".column-settings",
  ".appearance-lists",
  ".list-layout-reset",
  ".emby-match-field",
  ".filecheck-kinds",
  ".filecheck-owner",
  ".language-chart-filter",
  ".placement-detail-disks",
  ".placement-footer",
  ".tab-dot-trigger",
  ".notice.success",
].map((entry) => entry.slice(1).split("."));
const classPattern = (name) =>
  new RegExp("\\." + name.replace(/-/g, "\\-") + "(?![\\w-])");
// String literals and template parts of one .ts/.tsx file; comments are not
// strings, so they never count.
const stringsIn = (path, code) => {
  const strings = [];
  const file = ts.createSourceFile(
    path,
    code,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const visit = (node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    )
      strings.push({ path, text: node.text });
    ts.forEachChild(node, visit);
  };
  visit(file);
  return strings;
};
// String literals and template parts of every .ts/.tsx file under web/src.
const sourceStrings = () => {
  const root = new URL("../../src/", import.meta.url);
  return readdirSync(root, { recursive: true })
    .map((p) => p.split(sep).join("/"))
    .filter((p) => /\.tsx?$/.test(p))
    .flatMap((path) =>
      stringsIn(path, readFileSync(new URL(path, root), "utf8")),
    );
};
function assertRemoved(removed) {
  for (const file of LEGACY_STYLESHEETS)
    for (const rule of cssRules(legacyCss(file)))
      for (const selector of selectors(rule.header))
        for (const compound of selector.split(/\s*[\s>+~]\s*/))
          for (const names of removed)
            assert.ok(
              !names.every((name) => classPattern(name).test(compound)),
              `${file}: ${selector} styles the removed .${names.join(".")}`,
            );
  const strings = sourceStrings();
  assert.ok(strings.length > 1000, "the source scan finds string literals");
  for (const { path, text } of strings) {
    const tokens = text.split(/\s+/).filter(Boolean);
    for (const names of removed) {
      assert.ok(
        !names.every((name) => tokens.includes(name)),
        `${path} renders the removed class .${names.join(".")}`,
      );
      // A constructed name ("placement-" + part) could produce the class.
      for (const token of tokens.filter((t) => /^[a-z][\w-]*-$/.test(t)))
        assert.ok(
          !names.some((name) => name.startsWith(token)),
          `${path} builds "${token}…", which can produce .${names.join(".")}`,
        );
    }
  }
}
test("removed 1.7.0 rules stay removed", () => assertRemoved(REMOVED));

// The 1.7.0 tool pages left in Phase 5b (Tasks 6–8 switched them; Task 9
// removed what only they and their parts built: FilterRow, CompactProgress,
// FilterCheckList, CSVExport, the tool table, the filter panel and the
// results heading, with the R-G wrap rule of the filter row beside an
// expanded sidebar). Their rules and their tokens stay removed; the
// dialogs, the report, the log, the rules and the settings keep theirs.
const TOOL_PAGE_REMOVED = [
  ".filter-panel",
  ".filter-always-visible",
  ".filter-icon-tools",
  ".preset-toolbar",
  ".rotated",
  ".results-heading",
  ".page-notice",
  ".title-cell",
  ".tool-filter-list",
  ".placement-panel",
  ".placement-table",
  ".scan-ready",
  ".compact-progress",
  ".tool-table",
  ".col-status",
  ".col-progress",
  ".col-remove",
  ...[
    "select",
    "actions",
    "service",
    "size",
    "disks",
    "target",
    "move",
    "kind",
    "status",
    "progress",
    "remove",
    "path",
    "current",
    "fix",
  ].map((column) => ".tool-col-" + column),
].map((entry) => entry.slice(1).split("."));
const TOOL_PAGE_TOKENS =
  /--tool-col-[\w-]*|--tool-row-height-mobile|--table-min(?:-mobile)?(?![\w-])|--progress-label-width|--progress-height(?![\w-])/;
test("tool page rules leave with the 1.7.0 tool pages", () => {
  assertRemoved(TOOL_PAGE_REMOVED);
  for (const file of LEGACY_STYLESHEETS) {
    const css = legacyCss(file).replace(/\/\*[\s\S]*?\*\//g, "");
    const token = css.match(TOOL_PAGE_TOKENS);
    assert.equal(token, null, `${file} keeps ${token?.[0]}`);
  }
  for (const { path, text } of sourceStrings())
    assert.ok(!TOOL_PAGE_TOKENS.test(text), `${path} writes ${text}`);
  // --tool-row-height stays for the recognition rules (Phase 5c).
  assert.match(legacyCss("base.css"), /--tool-row-height:\s*64px/);
  assert.match(legacyCss("recognition.css"), /var\(--tool-row-height\)/);
});

// Every --layout-* token a 1.7.0 sheet defines (all of them in base.css) is
// read through var(): by a 1.7.0 rule, or by a string in a .ts/.tsx source
// (dialog-layout.ts writes var(--layout-50) into a dialog's style). A write
// or any other mention is no read, and comments never count. A token that
// nothing reads is removed (STYLEGUIDE Part 1, 4; Phase 5a removes each one
// its deletions leave unread).
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const LAYOUT_DEFINITION = /(?<![\w-])(--layout-[\w-]+)\s*:/g;
const LAYOUT_READ = /var\(\s*(--layout-[\w-]+)/g;
function unreadLayoutTokens(sheets, strings) {
  const css = stripComments(sheets.join("\n"));
  const defined = [
    ...new Set([...css.matchAll(LAYOUT_DEFINITION)].map((m) => m[1])),
  ];
  const read = new Set([...css.matchAll(LAYOUT_READ)].map((m) => m[1]));
  const readInSource = (name) => {
    const pattern = new RegExp("var\\(\\s*" + name + "(?![\\w-])");
    return strings.some(({ text }) => pattern.test(text));
  };
  return defined.filter((name) => !read.has(name) && !readInSource(name));
}
test("every 1.7.0 layout token is read", () => {
  const base =
    ":root { --layout-2: 2px; --layout-50: 50px; --layout-1: 1px; --layout-10: 10px; --layout-34: 34px; }";
  const rules = [
    base,
    ".a { width: var(--layout-2); margin: var(--layout-1-3); }",
    ".b { min-width: var(--layout-100); } /* var(--layout-34) */",
  ];
  const code =
    "// var(--layout-1)\nel.style.height = `calc(100dvh - var(--layout-50))`;";
  const strings = stringsIn("dialog.ts", code);
  assert.deepEqual(unreadLayoutTokens(rules, strings), [
    "--layout-1",
    "--layout-10",
    "--layout-34",
  ]);
  // Writing a token, or naming it in any other way, is no read.
  const writes = [
    ...stringsIn("w.tsx", 'const z = <i style={{ "--layout-1": "2px" }} />;'),
    ...stringsIn("w.ts", 'el.style.setProperty("--layout-10", "4px");'),
    ...stringsIn("n.ts", 'const token = "--layout-34";'),
  ];
  assert.deepEqual(unreadLayoutTokens(rules, [...strings, ...writes]), [
    "--layout-1",
    "--layout-10",
    "--layout-34",
  ]);
  // A read in a rule, a .ts template and a .tsx string literal each count.
  assert.deepEqual(
    unreadLayoutTokens(
      [base, ".c { width: var( --layout-1 ); height: var(--layout-2); }"],
      [
        ...strings,
        ...stringsIn(
          "a.tsx",
          'const x = <i style="width: var(--layout-34)" />;',
        ),
        ...stringsIn("b.tsx", 'const y = { minWidth: "var(--layout-10)" };'),
      ],
    ),
    [],
  );

  const strings_ = sourceStrings();
  assert.ok(
    strings_.some(
      ({ path, text }) =>
        path === "dialog-layout.ts" && text.includes("var(--layout-50)"),
    ),
    "the source scan reads the .ts template of dialog-layout.ts",
  );
  const sheets = LEGACY_STYLESHEETS.map(legacyCss);
  assert.ok(
    [...stripComments(sheets.join("\n")).matchAll(LAYOUT_DEFINITION)].length >
      50,
    "the 1.7.0 sheets define the layout tokens",
  );
  assert.deepEqual(unreadLayoutTokens(sheets, strings_), []);
});
