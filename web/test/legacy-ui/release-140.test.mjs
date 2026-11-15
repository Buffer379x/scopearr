// Legacy UI (1.7.0 look) – replaced in Phase 5d by the v2 toast recipe and the stylesheet guards; the tool table parts left with Phase 5b.
import test from "node:test";
import assert from "node:assert/strict";
import { src } from "../helpers/sources.mjs";
import {
  allLegacyCss,
  legacyCss,
  stylesheetExists,
} from "../helpers/legacy-styles.mjs";

test("interface recipes apply appwide, including settings, without override stylesheets (1.7.0 look)", () => {
  for (const name of ["improvements", "interface-v2", "presentation"])
    assert.equal(stylesheetExists(name + ".css"), false);
  const css = legacyCss("base.css");
  assert.match(
    css,
    /input\[type="checkbox"\],\s*input\[type="radio"\]\s*\{[^}]*width: var\(--checkbox\)[^}]*flex: 0 0 var\(--checkbox\)/,
  );
  const allCSS = allLegacyCss();
  assert.doesNotMatch(allCSS, /mux-status-/);
  assert.doesNotMatch(allCSS, /font-weight:\s*(550|570)/);
  assert.doesNotMatch(allCSS, /font-size:\s*(?:8|9|14|16|17|19|20|21|24)px/);
});
