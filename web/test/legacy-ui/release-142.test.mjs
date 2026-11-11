// Legacy UI (1.7.0 look) – replaced in Phase 5a and 5b by the v2 table recipe and tool table tests.
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
  assert.doesNotMatch(
    css,
    /\.tool-table thead th\s*\{[^}]*text-overflow:\s*ellipsis/,
  );
  assert.match(src("components/SortableHeader.tsx"), /th-label/);
});
test("recognition bulk reset stays absent and processing controls retain progress (1.7.0 look)", () => {
  // Muxing and Disk placement left with Phase 5b (ToolTable).
  for (const name of ["FileCheckPage"]) {
    assert.match(src("components/" + name + ".tsx"), /col-control/);
  }
});
