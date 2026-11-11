// Legacy UI (1.7.0 look) – replaced in Phase 5b by the v2 tool page and disk tag tests.
import test from "node:test";
import assert from "node:assert/strict";
import { src } from "../helpers/sources.mjs";
import { legacyCss } from "../helpers/legacy-styles.mjs";

test("all four disks have visible tags with one target and three sources (1.7.0 look)", () => {
  assert.match(
    legacyCss("placement.css"),
    /\.tag\.placement-disk-tag\s*\{[^}]*background: var\(--panel2\);[^}]*border-color: var\(--line\)/,
  );
});
test("tool pages share filters and reserve progress/removal columns (1.7.0 look)", () => {
  // Muxing and Disk placement left with Phase 5b (ToolTable).
  for (const page of ["FileCheckPage"]) {
    const code = src("components/" + page + ".tsx");
    assert.match(code, /col-remove/);
    assert.match(code, /col-progress/);
  }
  assert.match(
    src("components/FileCheckDetailDialog.tsx"),
    /class="notice filecheck-reason"/,
  );
});
