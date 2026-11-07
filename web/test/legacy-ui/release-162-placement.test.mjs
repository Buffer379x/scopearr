// Legacy UI (1.7.0 look) – replaced in Phase 5d by the v2 scan dialog tests.
import test from "node:test";
import assert from "node:assert/strict";
import { src } from "../helpers/sources.mjs";

test("placement scan options have ordered sections, inline errors and a moves-disabled start (1.7.0 look)", () => {
  const dialog = src("components/PlacementScanDialog.tsx");
  assert.match(dialog, /<Modal[\s\S]*wide[\s\S]*className="scan-dialog"/);
});
