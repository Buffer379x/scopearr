// Legacy UI (1.7.0 look) – replaced in Phase 5d by the v2 disk tag and file check dialog tests; the tool page parts left with Phase 5b.
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
test("the file check dialog keeps its notice (1.7.0 look)", () => {
  // Muxing, Disk placement and Files & permissions left with Phase 5b
  // (ToolTable); the file check dialog keeps its 1.7.0 notice.
  assert.match(
    src("components/FileCheckDetailDialog.tsx"),
    /class="notice filecheck-reason"/,
  );
});
