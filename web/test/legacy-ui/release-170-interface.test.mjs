// Legacy UI (1.7.0 look) – replaced in Phase 5a, 5b and 5d by the v2 library, mux selection and token tests.
import test from "node:test";
import assert from "node:assert/strict";
import { cssRules } from "../helpers/css-rules.mjs";
import { legacyCss } from "../helpers/legacy-styles.mjs";

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
test("dead structural tokens are removed", () => {
  assert.doesNotMatch(
    legacyCss("base.css"),
    /--layout-(10|21|46|53|59|64|68|80|88|96|150|170|440|520):/,
  );
});
