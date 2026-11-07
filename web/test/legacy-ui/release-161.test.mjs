// Legacy UI (1.7.0 look) – replaced in Phase 5d by the v2 file dialog tests.
import test from "node:test";
import assert from "node:assert/strict";
import { legacyCss } from "../helpers/legacy-styles.mjs";
import { src } from "../helpers/sources.mjs";

test("file dialog width is scoped and the Used column stays on one line", () => {
  assert.match(src("components/FileDialog.tsx"), /className="file-dialog"/);
  assert.match(
    legacyCss("dialogs.css"),
    /\.modal\.wide\.file-dialog\s*\{[^}]*--layout-1060/,
  );
  assert.match(
    legacyCss("dialogs.css"),
    /\.evidence-used\s*\{[^}]*white-space: nowrap/,
  );
});
