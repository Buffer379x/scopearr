import test from "node:test";
import assert from "node:assert/strict";
import { sortFilterValues } from "../src/filter-values.ts";
import { resolutionFilterValues } from "../src/resolution-groups.ts";
import { presentedTagLabel } from "../src/tag-labels.ts";

test("SD sorts by its visible label and unknown is always the last resolution", () => {
  const values = ["__unknown__", "576p", "720p", "480p", "2160p", "1080p"];
  const grouped = resolutionFilterValues(values, [], true);
  assert.deepEqual(
    sortFilterValues(
      grouped,
      (v) => presentedTagLabel("resolution", v, {}),
      "de",
    ),
    ["1080p", "2160p", "720p", "__sd__", "__unknown__"],
  );
  assert.deepEqual(values, [
    "__unknown__",
    "576p",
    "720p",
    "480p",
    "2160p",
    "1080p",
  ]);
  const exact = resolutionFilterValues(values, ["480p"], true);
  assert.deepEqual(
    sortFilterValues(
      exact,
      (v) => presentedTagLabel("resolution", v, {}),
      "de",
    ),
    ["1080p", "2160p", "480p", "720p", "__sd__", "__unknown__"],
  );
});

test("all filter menus sort localized labels rather than canonical IDs, with unknown last", () => {
  for (const [locale, unknown] of [
    ["de", "Unbekannt"],
    ["en", "Unknown"],
    ["es", "Desconocido"],
    ["it", "Sconosciuto"],
  ]) {
    const names = { 9: "Zebra", 20: "Alpha", 2: "beta", __unknown__: unknown };
    assert.deepEqual(
      sortFilterValues(
        ["9", "__unknown__", "2", "20", "9"],
        (v) => names[v],
        locale,
      ),
      ["20", "2", "9", "__unknown__"],
    );
  }
  const german = {
    eng: "Englisch",
    deu: "Deutsch",
    tur: "Türkisch",
    __unknown__: "Unbekannt",
    zho: "Chinesisch",
  };
  assert.deepEqual(
    sortFilterValues(Object.keys(german), (v) => german[v], "de"),
    ["zho", "deu", "eng", "tur", "__unknown__"],
  );
});
