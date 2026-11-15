// Legacy UI (1.7.0 look) – replaced in Phase 5a and 5d by the v2 table tests and the stylesheet guards (the last 1.7.0 table, Review tag removals, by settings-dialogs.test.mjs); the dashboard case left with Phase 5a (dashboard.test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { cssRules, selectors } from "../helpers/css-rules.mjs";
import { LEGACY_STYLESHEETS, legacyCss } from "../helpers/legacy-styles.mjs";

test("floating surfaces own shadows and retired tooltip/table recipes stay removed", () => {
  for (const file of LEGACY_STYLESHEETS) {
    const code = legacyCss(file);
    assert.doesNotMatch(
      code,
      /filename-tooltip|control-tooltip|flag-tooltip|filter-logic-tooltip|column-sort|color-settings-table|dashboard-settings-table|evidence-table|mux-table-scroll/,
      file,
    );
    for (const rule of cssRules(code)) {
      if (!/box-shadow\s*:/.test(rule.body)) continue;
      assert.ok(
        selectors(rule.header).every((s) =>
          [".floating-surface", ".modal", ".toast"].includes(s),
        ),
        file + ": " + rule.header,
      );
    }
  }
});
