// Legacy UI (1.7.0 look) – replaced in Phase 5d by the v2 token tests; the library and tool filter panel parts left with Phase 5a and 5b.
import test from "node:test";
import assert from "node:assert/strict";
import { legacyCss } from "../helpers/legacy-styles.mjs";

test("dead structural tokens are removed", () => {
  assert.doesNotMatch(
    legacyCss("base.css"),
    /--layout-(10|21|46|53|59|64|68|80|88|96|150|170|440|520):/,
  );
});
