// Legacy UI (1.7.0 look) – replaced in Phase 5c by the v2 settings recipe tests; the tool page parts left with Phase 5b.
import test from "node:test";
import assert from "node:assert/strict";
import { src } from "../helpers/sources.mjs";

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
