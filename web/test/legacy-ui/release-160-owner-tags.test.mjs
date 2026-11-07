// Legacy UI (1.7.0 look) – replaced in Phase 5c by the v2 settings card tests.
import test from "node:test";
import assert from "node:assert/strict";
import { legacyCss } from "../helpers/legacy-styles.mjs";
import { src } from "../helpers/sources.mjs";

test("Unraid paths and owner cards precede shares and show process identity (1.7.0 look)", () => {
  const code = src("components/UnraidSettings.tsx");
  assert.match(code, /class="unraid-settings-grid"/);
  assert.match(
    legacyCss("placement.css"),
    /\.unraid-settings-grid[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
  );
});
