// Legacy UI (1.7.0 look) – replaced in Phase 5a, 5b and 5d by the v2 library, mux selection and token tests.
import test from "node:test";
import assert from "node:assert/strict";
import { cssRules } from "../helpers/css-rules.mjs";
import { legacyCss } from "../helpers/legacy-styles.mjs";
import { src } from "../helpers/sources.mjs";

test("filter panel padding never depends on collapsed state", () => {
  for (const name of ["library", "placement"]) {
    for (const rule of cssRules(legacyCss(name + ".css"))) {
      if (
        /\.(?:filter-panel(?:-v2)?|placement-panel)[^ ,]*\.collapsed|\.placement-panel:not\(\.collapsed\)/.test(
          rule.header,
        ) &&
        !/[ >]/.test(rule.header)
      )
        assert.doesNotMatch(
          rule.body,
          /(?:^|;)\s*padding(?:-[\w-]+)?\s*:/,
          rule.header,
        );
    }
  }
});
test("state filter labels keep the operator beside the help icon", () => {
  const rule = cssRules(legacyCss("library.css")).find(
    (r) => r.header === ".state-filter-label",
  );
  assert.doesNotMatch(rule.body, /flex:\s*1\s*;/);
  assert.match(rule.body, /gap:\s*var\(--space-2\)/);
});
test("phone library selection actions have count badges and complete accessible names (1.7.0 look)", () => {
  const library = src("components/LibraryPage.tsx"),
    mux = src("components/MuxSelectionActions.tsx");
  assert.match(library, /library-results-heading/);
  assert.match(library, /selection-action-count/);
  assert.match(mux, /selection-action-count/);
  const mobile = cssRules(legacyCss("library.css")).filter((r) =>
    r.context.includes("@media (max-width: 600px)"),
  );
  assert.ok(
    mobile.some(
      (r) =>
        r.header.includes(".library-results-heading") &&
        /flex-direction:\s*row/.test(r.body),
    ),
  );
});
test("dead structural tokens are removed", () => {
  assert.doesNotMatch(
    legacyCss("base.css"),
    /--layout-(10|21|46|53|59|64|68|80|88|96|150|170|440|520):/,
  );
});

// Split from "phone demo banner follows the measured header …" (deleted with
// the 1.7.0 header): the selection hit area is part of the library look.
test("compact selection actions get a hit area on a coarse pointer (1.7.0 look)", () => {
  const coarse = cssRules(legacyCss("base.css")).filter((r) =>
    r.context.includes("@media (pointer: coarse)"),
  );
  assert.ok(
    coarse.some(
      (r) =>
        r.header.includes(".compact-selection-action::after") &&
        /width:\s*var\(--touch-target\)/.test(r.body),
    ),
  );
});
