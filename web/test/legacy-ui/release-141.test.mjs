// Legacy UI (1.7.0 look) – replaced in Phase 5a and 5d by the v2 table and dashboard widget tests and the stylesheet guards.
import test from "node:test";
import assert from "node:assert/strict";
import { cssRules, selectors } from "../helpers/css-rules.mjs";
import { LEGACY_STYLESHEETS, legacyCss } from "../helpers/legacy-styles.mjs";
import { src } from "../helpers/sources.mjs";

test("all table components use a shared recipe and explicit header scope (1.7.0 look)", () => {
  // The libraries left with Phase 5a (MediaTable, v2-table); the tools,
  // dialogs and settings keep the 1.7.0 recipes.
  const names = [
    "DiskPlacementPage",
    "FileCheckPage",
    "MuxTable",
    "FileDialog",
    "RecognitionPage",
    "PlacementDialogs",
    "MuxTrackTable",
    "TagReview",
    "SettingsPage",
    "CustomTagsSettings",
    "WidgetsSettings",
    "OrderedList",
  ];
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

test("dashboard distributions share structure and cannot regain a two-column language override (1.7.0 look)", () => {
  const code = src("components/StatisticsPage.tsx");
  assert.equal((code.match(/class="distribution-stack"/g) || []).length, 1);
  assert.match(
    legacyCss("dashboard.css"),
    /\.dashboard-widget-grid\s*\{[^}]*align-items: stretch/,
  );
  for (const file of LEGACY_STYLESHEETS)
    for (const r of cssRules(legacyCss(file)))
      if (r.header.includes(".language-distribution .distribution-list"))
        assert.doesNotMatch(r.body, /grid-template-columns/);
});
