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
// String literals and template parts of every .ts/.tsx file under web/src.
const sourceStrings = () => {
  const root = new URL("../../src/", import.meta.url);
  const strings = [];
  for (const path of readdirSync(root, { recursive: true })
    .map((p) => p.split(sep).join("/"))
    .filter((p) => /\.tsx?$/.test(p))) {
    const file = ts.createSourceFile(
      path,
      readFileSync(new URL(path, root), "utf8"),
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
  }
  return strings;
};
test("removed 1.7.0 rules stay removed", () => {
  for (const file of LEGACY_STYLESHEETS)
    for (const rule of cssRules(legacyCss(file)))
      for (const selector of selectors(rule.header))
        for (const compound of selector.split(/\s*[\s>+~]\s*/))
          for (const names of REMOVED)
            assert.ok(
              !names.every((name) => classPattern(name).test(compound)),
              `${file}: ${selector} styles the removed .${names.join(".")}`,
            );
  const strings = sourceStrings();
  assert.ok(strings.length > 1000, "the source scan finds string literals");
  for (const { path, text } of strings) {
    const tokens = text.split(/\s+/).filter(Boolean);
    for (const names of REMOVED) {
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
});
