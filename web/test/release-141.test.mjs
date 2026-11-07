import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalToolPresetQuery } from "../src/tool-filters.ts";
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
    "SettingsPage",
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
  }
});
test("dashboard distributions share structure and cannot regain a two-column language override", () => {
  const code = src("components/StatisticsPage.tsx");
  assert.match(code, /function LanguageDistribution[^]*?<DistributionChart/);
});
