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

// 5b Task 10 M-6 (Phase 5d, Task 5): a confirmed action that locks or
// removes the button that asked (Cancel mux job: the row's buttons lock
// while the request runs) never drops focus to the page. The next enabled
// button of the row takes it, else the page's h1; a cancelled question and
// focus the user moved elsewhere are left alone.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
test("a confirmed answer never drops focus to the page", async () => {
  const observers = [];
  globalThis.MutationObserver = class {
    constructor(callback) {
      this.callback = callback;
      this.on = false;
      observers.push(this);
    }
    observe() {
      this.on = true;
    }
    disconnect() {
      this.on = false;
    }
  };
  const listeners = new Set();
  const doc = {
    body: { name: "body" },
    activeElement: null,
    h1: null,
    querySelector: (s) => (s === "h1" ? doc.h1 : null),
    addEventListener: (_, l) => listeners.add(l),
    removeEventListener: (_, l) => listeners.delete(l),
  };
  globalThis.document = doc;
  const attrs = new Map();
  const el = (name, row) => ({
    name,
    tagName: name === "h1" ? "H1" : "BUTTON",
    disabled: false,
    isConnected: true,
    hidden: false,
    getClientRects() {
      return this.hidden ? [] : [{}];
    },
    closest: () => row,
    hasAttribute: (k) => attrs.has(name + k),
    setAttribute: (k, v) => attrs.set(name + k, v),
    focus() {
      doc.activeElement = this;
    },
  });
  const row = { querySelectorAll: () => buttons };
  const start = el("start", row),
    cancel = el("cancel", row),
    more = el("more", row);
  // A phone-only button of the row is hidden on a desktop.
  const phone = el("phone", row);
  phone.hidden = true;
  const buttons = [start, cancel, phone, more];
  doc.h1 = el("h1", null);
  const changed = () =>
    observers.filter((o) => o.on).forEach((o) => o.callback());
  try {
    // Asked from Cancel; the dialog hands focus back, then the row locks
    // Cancel: the next enabled button (More) takes focus.
    doc.activeElement = cancel;
    let asked = confirmDeletion("Cancel the job?");
    assert.equal(currentConfirmation().returnFocus(), more);
    answerConfirmation(true);
    assert.equal(await asked, true);
    cancel.disabled = true;
    changed();
    await settle();
    assert.equal(doc.activeElement, more);
    assert.equal(observers.filter((o) => o.on).length, 0, "the watch ends");
    // Every button locked (busy): the h1 takes focus by script.
    cancel.disabled = false;
    doc.activeElement = cancel;
    asked = confirmDeletion("Cancel the job?");
    answerConfirmation(true);
    await asked;
    for (const b of buttons) b.disabled = true;
    doc.activeElement = doc.body;
    changed();
    await settle();
    assert.equal(doc.activeElement, doc.h1);
    assert.equal(attrs.get("h1tabindex"), "-1");
    for (const b of buttons) b.disabled = false;
    // A cancelled question watches nothing.
    const before = observers.length;
    doc.activeElement = cancel;
    asked = confirmDeletion("Cancel the job?");
    answerConfirmation(false);
    await asked;
    assert.equal(observers.length, before);
    // Focus the user moved on (a focusin elsewhere) ends the watch.
    asked = confirmDeletion("Cancel the job?");
    answerConfirmation(true);
    await asked;
    [...listeners].forEach((l) => l({ target: start }));
    start.focus();
    cancel.disabled = true;
    changed();
    await settle();
    assert.equal(doc.activeElement, start);
    assert.equal(listeners.size, 0);
  } finally {
    delete globalThis.document;
    delete globalThis.MutationObserver;
  }
});
