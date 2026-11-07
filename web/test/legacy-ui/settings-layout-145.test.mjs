// Legacy UI (1.7.0 look) – replaced in Phase 5c by the v2 settings section recipe and its layout invariants.
import test from "node:test";
import assert from "node:assert/strict";
import { cssRules, selectors } from "../helpers/css-rules.mjs";
import { legacyCss } from "../helpers/legacy-styles.mjs";
const settingsCSS = () => cssRules(legacyCss("settings-and-filters.css"));
test("service synchronization fields use equal halves like address and API key", () => {
  const rules = settingsCSS().filter((rule) =>
    selectors(rule.header).includes(".sync-clock-grid"),
  );
  assert.ok(rules.length);
  const last = rules
    .filter((rule) => /grid-template-columns/.test(rule.body))
    .at(-1);
  assert.match(
    last.body,
    /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
  );
});
test("settings titles reserve the save control height even without an action", () => {
  const rule = settingsCSS().find((rule) =>
    selectors(rule.header).includes(".settings-section-heading h2"),
  );
  assert.match(rule.body, /min-height:\s*var\(--control-md\)/);
  assert.match(rule.body, /align-items:\s*center/);
});

test("timezone card keeps its heading above both grid columns", () => {
  const rule = settingsCSS().find((rule) =>
    selectors(rule.header).includes(".sync-timezone > .card-intro"),
  );
  assert.ok(rule);
  assert.match(rule.body, /grid-column:\s*1\s*\/\s*-1/);
});
