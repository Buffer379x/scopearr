// Legacy UI (1.7.0 look) – replaced in Phase 5d by the v2 disk tag and file check dialog tests; the tool page parts left with Phase 5b.
import test from "node:test";
import assert from "node:assert/strict";
import { legacyCss } from "../helpers/legacy-styles.mjs";

test("all four disks have visible tags with one target and three sources (1.7.0 look)", () => {
  assert.match(
    legacyCss("placement.css"),
    /\.tag\.placement-disk-tag\s*\{[^}]*background: var\(--panel2\);[^}]*border-color: var\(--line\)/,
  );
});
