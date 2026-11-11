// Legacy UI (1.7.0 look) – replaced in Phase 5b and 5c by the v2 tool page and settings recipe tests.
import test from "node:test";
import assert from "node:assert/strict";
import { src } from "../helpers/sources.mjs";

test("tool activity stays inline and row progress remains available (1.7.0 look)", () => {
  // Disk placement left with Phase 5b (the tool card's hint line).
  for (const page of ["FileCheckPage"]) {
    const code = src("components/" + page + ".tsx");
    assert.match(code, /tool-activity/);
  }
});
test("fixed ordered-list hints are inline and title labels are not duplicated (1.7.0 look)", () => {
  const code = src("components/OrderedList.tsx");
  assert.match(code, /<em class="cell-hint">/);
  assert.doesNotMatch(code, /class="cell-sub"/);
});
test("settings share heading and move rule guidance into help (1.7.0 look)", () => {
  assert.doesNotMatch(
    src("components/RecognitionPage.tsx"),
    /class="recognition-guide"|class="notice recognition-notice"/,
  );
});
