import test from "node:test";
import assert from "node:assert/strict";
import {
  confirmDeletion,
  currentConfirmation,
  answerConfirmation,
  subscribeConfirmation,
} from "../src/confirmation.ts";
test("deletion waits for explicit confirmation, supports cancellation and rejects overlapping prompts", async () => {
  let updates = 0;
  const unsubscribe = subscribeConfirmation(() => updates++);
  const cancelled = confirmDeletion("Delete first?");
  assert.equal(currentConfirmation().message, "Delete first?");
  assert.equal(await confirmDeletion("Delete second?"), false);
  answerConfirmation(false);
  assert.equal(await cancelled, false);
  assert.equal(currentConfirmation(), null);
  const accepted = confirmDeletion("Delete third?");
  answerConfirmation(true);
  assert.equal(await accepted, true);
  answerConfirmation(true);
  assert.equal(updates, 4);
  unsubscribe();
});

test("discard confirmation preserves edits until a user explicitly accepts", async () => {
  const { confirmDiscard } = await import("../src/confirmation.ts");
  const cancel = confirmDiscard("Discard draft?");
  assert.equal(currentConfirmation().discard, true);
  answerConfirmation(false);
  assert.equal(await cancel, false);
  const discard = confirmDiscard("Discard draft?");
  answerConfirmation(true);
  assert.equal(await discard, true);
});

// 5b Task 10 M-6 (Phase 5d, Task 5): a question reads the element that
// asked when it opens (the start set keeps only this; the dialog's chunk
// keeps focus near it, dialog-focus.test.mjs); the page itself is none.
test("a question reads the element that asked", async () => {
  const button = { name: "Cancel mux job" };
  const body = { name: "body" };
  globalThis.document = { activeElement: button, body };
  try {
    let asked = confirmDeletion("Cancel the job?");
    assert.equal(currentConfirmation().opener, button);
    answerConfirmation(false);
    await asked;
    globalThis.document.activeElement = body;
    asked = confirmDeletion("Cancel the job?");
    assert.equal(currentConfirmation().opener, null);
    answerConfirmation(false);
    await asked;
  } finally {
    delete globalThis.document;
  }
  // Without a document (a test, a worker) a question still opens.
  const bare = confirmDeletion("Again?");
  assert.equal(currentConfirmation().opener, null);
  answerConfirmation(true);
  assert.equal(await bare, true);
});
