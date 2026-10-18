import test from "node:test";
import assert from "node:assert/strict";
import {
  SD_RESOLUTION,
  isSDResolution,
  groupResolutionBuckets,
  resolutionFilterValues,
} from "../src/resolution-groups.ts";
import { presentedTagLabel } from "../src/tag-labels.ts";

test("SD groups only known numeric resolutions below 720p, including interlaced and cropped SD", () => {
  for (const value of ["244p", "480p", "576p", "480i", "576P", "1p"])
    assert.equal(isSDResolution(value), true, value);
  for (const value of [
    "",
    "__unknown__",
    "__sd__",
    "720p",
    "720i",
    "1080p",
    "2160p",
    "4K",
    "SD",
    "0p",
    "576x244p",
    "480p extra",
    "576.0p",
  ])
    assert.equal(isSDResolution(value), false, value);
});
test("dashboard SD aggregation preserves totals, unknowns and the original statistics", () => {
  const buckets = [
    { value: "480p", count: 2 },
    { value: "576p", count: 3 },
    { value: "244p", count: 1 },
    { value: "720p", count: 4 },
    { value: "", count: 5 },
  ];
  const result = groupResolutionBuckets(buckets, true);
  assert.deepEqual(result, [
    { value: "720p", count: 4 },
    { value: "", count: 5 },
    { value: SD_RESOLUTION, count: 6 },
  ]);
  assert.equal(
    result.reduce((n, b) => n + b.count, 0),
    15,
  );
  assert.equal(buckets.length, 5);
  assert.deepEqual(groupResolutionBuckets(result, true), result);
  assert.equal(groupResolutionBuckets(buckets, false), buckets);
});
test("resolution options retain exact active presets and support dashboard SD selection in split mode", () => {
  const values = ["480p", "576p", "720p", "__unknown__"];
  assert.deepEqual(resolutionFilterValues(values, [], true), [
    "__sd__",
    "720p",
    "__unknown__",
  ]);
  assert.deepEqual(resolutionFilterValues(values, ["480p"], true), [
    "__sd__",
    "720p",
    "__unknown__",
    "480p",
  ]);
  assert.deepEqual(resolutionFilterValues(values, ["__sd__"], false), [
    ...values,
    "__sd__",
  ]);
  assert.deepEqual(resolutionFilterValues(values, [], false), values);
  assert.deepEqual(values, ["480p", "576p", "720p", "__unknown__"]);
});
test("rule spellings change labels without changing canonical filter or color keys", () => {
  const labels = { "codec:vp9": "VP9", "codec:avc": "Avc" };
  assert.equal(presentedTagLabel("codec", "vp9", labels), "VP9");
  assert.equal(presentedTagLabel("codec", "x264", labels), "x264");
  assert.equal(presentedTagLabel("resolution r__sd__", "__sd__", labels), "SD");
  assert.equal(presentedTagLabel("resolution", "480p", labels), "480p");
  assert.equal(presentedTagLabel("codec", "vp9", {}), "vp9");
  assert.deepEqual(Object.keys(labels), ["codec:vp9", "codec:avc"]);
});
