// Legacy UI (1.7.0 look) – replaced in Phase 5c and 5d by the v2 table recipe tests (the global table rules leave with the last 1.7.0 table, ruling R-M); the library and tool table parts left with Phase 5a and 5b.
import test from "node:test";
import assert from "node:assert/strict";
import { cssRules } from "../helpers/css-rules.mjs";
import { LEGACY_STYLESHEETS, legacyCss } from "../helpers/legacy-styles.mjs";
import { src } from "../helpers/sources.mjs";

test("table collapse and spacing have one global owner and control columns cannot ellipsize", () => {
  const declarations = [];
  for (const name of LEGACY_STYLESHEETS) {
    for (const rule of cssRules(legacyCss(name)))
      if (/border-(collapse|spacing)\s*:/.test(rule.body))
        declarations.push({ name, header: rule.header, body: rule.body });
  }
  assert.equal(declarations.length, 1);
  assert.equal(declarations[0].header.trim(), "table");
  assert.match(declarations[0].body, /border-collapse:\s*collapse/);
  assert.match(declarations[0].body, /border-spacing:\s*0/);
  const css = legacyCss("library.css");
  assert.match(css, /\.col-control\s*\{[^}]*text-overflow:\s*clip/);
  assert.match(src("components/SortableHeader.tsx"), /th-label/);
});
