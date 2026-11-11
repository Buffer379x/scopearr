// Legacy UI (1.7.0 look) – replaced in Phase 5b and 5d by the v2 tool table tests, the v2 toast recipe and the stylesheet guards.
import test from "node:test";
import assert from "node:assert/strict";
import { src } from "../helpers/sources.mjs";
import {
  allLegacyCss,
  legacyCss,
  stylesheetExists,
} from "../helpers/legacy-styles.mjs";

test("column geometry depends on column choices and keeps mobile details accessible (1.7.0 look)", () => {
  // Muxing and Disk placement left with Phase 5b (ToolTable).
  for (const component of ["FileCheckPage"]) {
    const code = src("components/" + component + ".tsx");
    assert.match(code, /tool-table/);
  }
  const css = legacyCss("placement.css");
  assert.match(css, /\.tool-table\s*\{[^}]*table-layout: fixed/);
  assert.match(
    css,
    /\.tool-table td\s*\{[^}]*height: var\(--tool-row-height\)/,
  );
  assert.match(
    css,
    /\.col-remove \.icon-button\s*\{[^}]*height: var\(--control-sm\)/,
  );
});
test("interface recipes apply appwide, including settings, without override stylesheets (1.7.0 look)", () => {
  for (const name of ["improvements", "interface-v2", "presentation"])
    assert.equal(stylesheetExists(name + ".css"), false);
  const css = legacyCss("base.css");
  assert.match(
    css,
    /input\[type="checkbox"\],\s*input\[type="radio"\]\s*\{[^}]*width: var\(--checkbox\)[^}]*flex: 0 0 var\(--checkbox\)/,
  );
  assert.match(
    legacyCss("settings-and-filters.css"),
    /\.key-values > div\s*\{[^}]*grid-template-columns:/,
  );
  const allCSS = allLegacyCss();
  assert.doesNotMatch(allCSS, /mux-status-/);
  assert.doesNotMatch(allCSS, /font-weight:\s*(550|570)/);
  assert.doesNotMatch(allCSS, /font-size:\s*(?:8|9|14|16|17|19|20|21|24)px/);
});

test("dynamic column and toast classes keep their styles", () => {
  const css = legacyCss("placement.css");
  for (const field of [
    "select",
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
  ])
    assert.ok(css.includes(".tool-col-" + field), field);
  const base = legacyCss("base.css");
  assert.match(base, /\.toast-error\s*\{[^}]*var\(--status-error\)/);
  assert.match(base, /\.toast-warning\s*\{[^}]*var\(--status-warn\)/);
});
