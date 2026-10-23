import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { canonicalToolPresetQuery } from "../src/tool-filters.ts";
import { cssRules, selectors } from "./helpers/css-rules.mjs";
const src = (path) =>
  readFileSync(new URL("../src/" + path, import.meta.url), "utf8");
test("tool preset equivalence ignores navigation but retains every list restriction", () => {
  assert.equal(
    canonicalToolPresetQuery(
      "service=tool:placement&status=split&share=Movies&q=Film+FOO+film&page=2&sort=size&dir=desc",
    ),
    canonicalToolPresetQuery("share=Movies&status=split&q=foo+film"),
  );
  for (const suffix of [
    "&share=Shows",
    "&status=failed",
    "&target=disk3",
    "&kind=small_files",
  ])
    assert.notEqual(
      canonicalToolPresetQuery("q=film" + suffix),
      canonicalToolPresetQuery("q=film"),
    );
});
test("all table components use a shared recipe and explicit header scope", () => {
  const names = [
    "LibraryTable",
    "DiskPlacementPage",
    "FileCheckPage",
    "MuxTable",
    "FileDialog",
    "RecognitionPage",
    "PlacementDialogs",
    "MuxTrackTable",
    "TagReview",
    "SettingsDialog",
    "CustomTagsSettings",
    "WidgetsSettings",
    "OrderedList",
  ];
  // The AST-like opening-tag check avoids matching thead and accepts attributes
  // on separate lines without tying the invariant to formatting.
  for (const name of names) {
    const code = src("components/" + name + ".tsx");
    for (const match of code.matchAll(/<th(?=[\s>])[^>]*>/g))
      assert.match(match[0], /scope="(?:col|row)"/, name);
    assert.match(code, /data-table|detail-table|editor-table/, name);
  }
});
test("floating surfaces own shadows and retired tooltip/table recipes stay removed", () => {
  for (const file of readdirSync(
    new URL("../src/styles/", import.meta.url),
  ).filter((n) => n.endsWith(".css"))) {
    const code = src("styles/" + file);
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
test("dashboard distributions share structure and cannot regain a two-column language override", () => {
  const code = src("components/StatisticsPage.tsx");
  assert.match(code, /function LanguageDistribution[^]*?<DistributionChart/);
  assert.equal((code.match(/class="distribution-stack"/g) || []).length, 1);
  assert.match(
    src("styles/dashboard.css"),
    /\.dashboard-widget-grid\s*\{[^}]*align-items: stretch/,
  );
  for (const file of readdirSync(
    new URL("../src/styles/", import.meta.url),
  ).filter((n) => n.endsWith(".css")))
    for (const r of cssRules(src("styles/" + file)))
      if (r.header.includes(".language-distribution .distribution-list"))
        assert.doesNotMatch(r.body, /grid-template-columns/);
});
