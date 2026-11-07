import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  fileKey,
  mergeSelection,
  groupSelected,
} from "../src/file-selection.ts";
const src = (p) =>
  readFileSync(new URL("../src/" + p, import.meta.url), "utf8");
test("selection distinguishes instances and toggles explicit keys", () => {
  const a = { service: "sonarr", id: 1, mediaId: 10, season: 1 },
    b = { service: "sonarr-4k", id: 1, mediaId: 10, season: 1 };
  let selected = mergeSelection({}, [a, b], true);
  selected = mergeSelection(
    selected,
    [{ service: "sonarr", id: 2, mediaId: 10, season: 2 }],
    true,
  );
  assert.equal(Object.keys(selected).length, 3);
  assert.equal(groupSelected(Object.values(selected), "sonarr", 10), 2);
  assert.equal(groupSelected(Object.values(selected), "sonarr", 10, 1), 1);
  selected = mergeSelection(selected, [a], false);
  assert.ok(selected[fileKey(b)]);
  assert.equal(Object.keys(selected).length, 2);
});
test("recognition bulk reset stays absent and processing controls retain progress", () => {
  const code = src("components/RecognitionPage.tsx");
  assert.doesNotMatch(
    code,
    /recognition\/defaults|Restore all default recognition rules|recognition-rule-count/,
  );
  for (const name of ["DiskPlacementPage", "FileCheckPage", "MuxTable"]) {
    assert.match(src("components/" + name + ".tsx"), /<CompactProgress/);
  }
});
