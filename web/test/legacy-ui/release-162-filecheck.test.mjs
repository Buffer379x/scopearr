// Legacy UI (1.7.0 look) – replaced in Phase 5d by the v2 dialog footer tests.
import test from "node:test";
import assert from "node:assert/strict";
import * as fileCheck from "../../src/filecheck.ts";
import { componentHarness } from "../helpers/component-harness.mjs";

test("names dialog ends with its action footer", () => {
  const tree = componentHarness(
    "FileCheckNamesDialog",
    {
      options: fileCheck.defaultFileCheckSettings,
      save() {},
      close() {},
    },
    { modules: { "../filecheck": fileCheck } },
  ).render();
  const children = tree.props.children.filter(Boolean);
  assert.equal(children.at(-1).props.class, "modal-actions");
});
