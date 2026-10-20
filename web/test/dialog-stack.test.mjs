import test from "node:test";
import assert from "node:assert/strict";
import { topmost } from "../src/dialog-stack.ts";
test("dialog stack returns the latest open dialog", () => {
  const first = { open: true },
    closed = { open: false },
    last = { open: true };
  assert.equal(topmost([]), null);
  assert.equal(topmost([closed]), null);
  assert.equal(topmost([first, closed, last]), last);
  last.open = false;
  assert.equal(topmost([first, closed, last]), first);
});
