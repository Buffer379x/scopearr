import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  fileKey,
  mergeSelection,
  groupSelected,
} from "../src/file-selection.ts";
import { cssRules } from "./helpers/css-rules.mjs";
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
test("table collapse and spacing have one global owner and control columns cannot ellipsize", () => {
  const declarations = [];
  for (const name of readdirSync(
    new URL("../src/styles/", import.meta.url),
  ).filter((p) => p.endsWith(".css"))) {
    for (const rule of cssRules(src("styles/" + name)))
      if (/border-(collapse|spacing)\s*:/.test(rule.body))
        declarations.push({ name, header: rule.header, body: rule.body });
  }
  assert.equal(declarations.length, 1);
  assert.equal(declarations[0].header.trim(), "table");
  assert.match(declarations[0].body, /border-collapse:\s*collapse/);
  assert.match(declarations[0].body, /border-spacing:\s*0/);
  const css = src("styles/library.css");
  assert.match(css, /\.col-control\s*\{[^}]*text-overflow:\s*clip/);
  assert.doesNotMatch(
    css,
    /\.tool-table thead th\s*\{[^}]*text-overflow:\s*ellipsis/,
  );
  assert.match(src("components/SortableHeader.tsx"), /th-label/);
});
test("recognition bulk reset stays absent and processing controls retain progress", () => {
  const code = src("components/RecognitionPage.tsx");
  assert.doesNotMatch(
    code,
    /recognition\/defaults|Restore all default recognition rules|recognition-rule-count/,
  );
  for (const name of ["DiskPlacementPage", "FileCheckPage", "MuxTable"]) {
    assert.match(src("components/" + name + ".tsx"), /<CompactProgress/);
    assert.match(src("components/" + name + ".tsx"), /col-control/);
  }
});
