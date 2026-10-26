import test from "node:test";
import assert from "node:assert/strict";
import { toolPackageActions } from "../src/tool-package.ts";

test("package lifecycle actions keep remove available after disabling a service", () => {
  assert.deepEqual(
    toolPackageActions({ installed: false, busy: "" }, true, false),
    [
      { action: "install", disabled: false },
      { action: "check", disabled: false },
    ],
  );
  assert.deepEqual(
    toolPackageActions({ installed: true, busy: "" }, false, false),
    [
      { action: "update", disabled: true },
      { action: "check", disabled: true },
      { action: "remove", disabled: false },
    ],
  );
  for (const state of [
    { installed: true, busy: "installing" },
    { installed: true, busy: "checking" },
  ]) {
    assert.ok(
      toolPackageActions(state, true, false).every((action) => action.disabled),
    );
  }
  assert.ok(
    toolPackageActions({ installed: true, busy: "" }, true, true).every(
      (action) => action.disabled,
    ),
  );
});
