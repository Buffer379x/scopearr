// Legacy UI (1.7.0 look) – replaced in Phase 5c and 5d by the v2 log filter footer and file check dialog tests; the tool table parts left with Phase 5b.
import test from "node:test";
import assert from "node:assert/strict";
import { src } from "../helpers/sources.mjs";
import { legacyCss } from "../helpers/legacy-styles.mjs";

test("file check explanations reuse notice typography", () => {
  assert.match(
    src("components/FileCheckDetailDialog.tsx"),
    /class="notice filecheck-reason"/,
  );
  const css = legacyCss("placement.css");
  assert.match(
    css,
    /\.filecheck-reason\s*\{\s*display: block;\s*margin-bottom: var\(--space-4\);\s*\}/,
  );
});
