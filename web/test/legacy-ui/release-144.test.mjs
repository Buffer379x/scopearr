// Legacy UI (1.7.0 look) – replaced in Phase 5c by the v2 settings recipe tests; the tool page parts left with Phase 5b.
import test from "node:test";
import assert from "node:assert/strict";
import { src } from "../helpers/sources.mjs";
import { legacyCss } from "../helpers/legacy-styles.mjs";

test("card titles align and the rules keep their results tools", () => {
  // The tool pages' rhythm left with the 1.7.0 tool pages in Phase 5b, the
  // results tools and the card heading with the 1.7.0 settings pages
  // (Phase 5c, task 10); dialogs keep the card title row.
  assert.match(
    legacyCss("settings-and-filters.css"),
    /\.settings-content \.card-title \{[^}]*min-height: var\(--control-md\)/,
  );
});
