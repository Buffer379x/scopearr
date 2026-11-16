// The bundle budget check (web/scripts/bundle-budget.mjs, Phase 6.2) on a
// small fake dist: the start set follows static imports only, pages count
// beyond the start and Library sets, locale catalogs never count.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  BUDGETS,
  measure,
  overBudget,
  staticImports,
} from "../scripts/bundle-budget.mjs";

test("static imports are the minified import and from forms, not import()", () => {
  assert.deepEqual(
    staticImports(
      'import"./a-1.js";import{x}from"./b-2.js";const c=()=>import(`./c-3.js`)',
    ),
    ["a-1.js", "b-2.js"],
  );
});

test("a fake dist measures start, pages and all", () => {
  const dist = mkdtempSync(join(tmpdir(), "budget-"));
  const assets = join(dist, "assets");
  mkdirSync(assets);
  const write = (name, body) => writeFileSync(join(assets, name), body);
  writeFileSync(
    join(dist, "index.html"),
    '<script type="module" crossorigin src="/assets/index-A.js"></script>',
  );
  write(
    "index-A.js",
    'import"./shared-B.js";import"./en-C.js";' + "x".repeat(60),
  );
  write("shared-B.js", "y".repeat(100));
  write("en-C.js", "z".repeat(5000));
  write(
    "Library-D.js",
    'import"./shared-B.js";import"./Popover-E.js";' + "l".repeat(200),
  );
  write("Popover-E.js", "p".repeat(30));
  write(
    "MuxPage-F.js",
    'import"./Library-D.js";import"./ToolTable-G.js";' + "m".repeat(70),
  );
  write("ToolTable-G.js", "t".repeat(40));
  const m = measure(dist);
  const size = (s) => Buffer.byteLength(s);
  const index = 'import"./shared-B.js";import"./en-C.js";'.length + 60;
  assert.equal(m.start, index + 100);
  assert.equal(
    m.pages.Library,
    size('import"./shared-B.js";import"./Popover-E.js";') + 200 + 30,
  );
  assert.equal(
    m.pages.MuxPage,
    size('import"./Library-D.js";import"./ToolTable-G.js";') + 70 + 40,
  );
  assert.equal(m.all, m.start + m.pages.Library + m.pages.MuxPage);
  assert.equal(m.cssGzip, 0);
  const over = overBudget(m, { ...BUDGETS, MuxPage: 10 });
  assert.ok(over.some((line) => line.startsWith("MuxPage:")));
  assert.ok(over.some((line) => line === "SettingsPage: no chunk found"));
});
