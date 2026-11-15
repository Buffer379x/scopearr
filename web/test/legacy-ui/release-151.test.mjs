// Legacy UI (1.7.0 look) – replaced in Phase 5c and 5d by the v2 settings card and dialog tests (the password dialog by settings-dialogs.test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { cssRules, selectors } from "../helpers/css-rules.mjs";
import { legacyCss } from "../helpers/legacy-styles.mjs";

const rule = (file, selector) =>
  cssRules(legacyCss(file)).find(
    (r) => !r.context.length && selectors(r.header).includes(selector),
  )?.body || "";

test("password field styling belongs to dialogs", () => {
  assert.doesNotMatch(
    legacyCss("settings-and-filters.css"),
    /\.password-card-fields/,
  );
  assert.match(
    rule("dialogs.css", ".password-dialog-fields"),
    /display:\s*grid/,
  );
});
