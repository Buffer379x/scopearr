// Legacy UI (1.7.0 look) – replaced in Phase 5b and 5d by the v2 tool filter footer, tool table and file check dialog tests.
import test from "node:test";
import assert from "node:assert/strict";
import { src } from "../helpers/sources.mjs";
import { legacyCss } from "../helpers/legacy-styles.mjs";

test("tool footer icons share a centered small control without header sizing", () => {
  const component = src("components/ToolFilters.tsx");
  assert.match(component, /filter-footer-tools/);
  assert.doesNotMatch(component, /filter-icon-tools/);
  assert.match(
    legacyCss("library.css"),
    /\.filter-footer-tools \.icon-button,[\s\S]*?\.filter-footer-tools \.inline-help \.icon-button\s*\{[^}]*height: var\(--control-sm\);[^}]*align-items: center;/,
  );
});

test("file check explanations reuse notice typography and removal columns use the shared small control", () => {
  assert.match(
    src("components/FileCheckDetailDialog.tsx"),
    /class="notice filecheck-reason"/,
  );
  const css = legacyCss("placement.css");
  assert.match(
    css,
    /\.filecheck-reason\s*\{\s*display: block;\s*margin-bottom: var\(--space-4\);\s*\}/,
  );
  assert.match(
    css,
    /\.col-remove \.icon-button\s*\{[^}]*height: var\(--control-sm\);/,
  );
});
