// Legacy UI (1.7.0 look) – replaced in Phase 5a and 5d by the v2 table tests and the stylesheet guards; the dashboard case left with Phase 5a (dashboard.test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { cssRules, selectors } from "../helpers/css-rules.mjs";
import { LEGACY_STYLESHEETS, legacyCss } from "../helpers/legacy-styles.mjs";
import { src } from "../helpers/sources.mjs";

test("all table components use a shared recipe and explicit header scope (1.7.0 look)", () => {
  // The libraries left with Phase 5a (MediaTable, v2-table), the tools'
  // tables with Phase 5b (ToolTable), File & metadata's with Phase 5d
  // (file-dialog.test.mjs), the mux track table's (mux-dialogs.test.mjs); Files & permissions' scan report
  // (a 1.7.0 dialog until 5d), dialogs and settings keep the 1.7.0 recipes;
  // Display's color tables left with Phase 5c (task 6), the Widgets and
  // Custom tags tables with task 7 (OrderedList stays until task 10), the
  // Tag rules tables with task 8.
  const names = ["FileCheckPage", "PlacementDialogs", "TagReview"];
  for (const name of names) {
    const code = src("components/" + name + ".tsx");
    assert.match(code, /data-table|detail-table|editor-table/, name);
  }
});
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
