import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalToolPresetQuery } from "../src/tool-filters.ts";
import {
  PRESENTATION_MODULES,
  loadSource,
  nodes,
} from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";
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
  // The libraries' media table (with its sort headers and the track
  // popover) replaced LibraryTable; the tool table replaced MuxTable.
  const names = [
    "library/MediaTable",
    "list/SortHeader",
    "library/TracksPopover",
    "DiskPlacementPage",
    "FileCheckPage",
    "tools/ToolTable",
    "FileDialog",
    "RecognitionPage",
    "PlacementDialogs",
    "MuxTrackTable",
    "TagReview",
    "settings/Card",
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
  // Every distribution, the languages included, is one DistributionCard
  // (Phase 5a): the language card and its rows carry the same classes as
  // any other, so no rule can lay out the languages on their own.
  const runtime = createHookRuntime();
  const { DistributionCard } = loadSource(
    "components/dashboard/DistributionCard.tsx",
    {
      modules: {
        "preact/hooks": runtime.hooks,
        "../../i18n": { t: (key) => key, getLocale: () => "en", useI18n() {} },
        "../../ui": {
          ICON: { empty: 28 },
          count: String,
          percent: String,
          labels: { language: "Language", codec: "Codec / encoder" },
          TagLabels: {},
        },
        "../../dashboard-model": loadSource("dashboard-model.ts", {
          modules: {
            "./i18n": { t: (key) => key, getLocale: () => "en" },
            "./dashboard-widgets": loadSource("dashboard-widgets.ts"),
          },
        }),
        "../../tag-labels": { presentedTagLabel: (_, value) => value },
        "../../languages": { audioLanguageLabel: (value) => value },
        "../LanguageFlag": { LanguageFlag: "LanguageFlag" },
      },
      stubs: PRESENTATION_MODULES,
    },
  );
  const shape = (field) => {
    const card = runtime.settle(() =>
      DistributionCard({
        field,
        buckets: [
          { value: "a", count: 2 },
          { value: "b", count: 1 },
        ],
        total: 3,
        hrefOf: (value) => value,
        open() {},
      }),
    );
    // The styled elements: the card, its parts and every row's parts.
    return nodes(card)
      .filter(
        (node) =>
          typeof node.type === "string" &&
          /^[a-z]/.test(node.type) &&
          node.props.class,
      )
      .map((node) => node.type + "." + node.props.class);
  };
  const language = shape("language");
  assert.deepEqual(language, shape("codec"));
  assert.equal(language[0], "article.v2-card v2-dist");
});
