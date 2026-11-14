import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./helpers/component-harness.mjs";

// Where focus goes once a dialog has closed (Phase 5d, Task 5 and its fix
// round; dialog-focus.ts, part of the dialogs' lazy chunks): the row's
// next button after a confirmed action locked the one that asked (5b Task
// 10 M-6), else the title of a dialog still open below, else the page's h1
// (M-1).

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function world() {
  const observers = [],
    listeners = new Set(),
    attrs = new Map();
  let below = null;
  const doc = {
    body: { name: "body" },
    activeElement: null,
    h1: null,
    querySelector: (s) => (s === "h1" ? doc.h1 : null),
    addEventListener: (_, l) => listeners.add(l),
    removeEventListener: (_, l) => listeners.delete(l),
  };
  class MutationObserver {
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
  }
  const focus = loadSource("dialog-focus.ts", {
    modules: { "./dialog-stack": { topmostDialog: () => below } },
    browser: { document: doc, MutationObserver, clearTimeout },
  });
  const row = { querySelectorAll: () => buttons };
  const el = (name, inRow = row) => ({
    name,
    ownerDocument: doc,
    disabled: false,
    isConnected: true,
    hidden: false,
    getClientRects() {
      return this.hidden ? [] : [{}];
    },
    closest: () => inRow,
    hasAttribute: (k) => attrs.has(name + k),
    setAttribute: (k, v) => attrs.set(name + k, v),
    getAttribute: (k) => attrs.get(name + k) ?? null,
    focus() {
      doc.activeElement = this;
    },
  });
  const start = el("start"),
    cancel = el("cancel"),
    phone = el("phone"),
    more = el("more");
  // A phone-only button of the row is hidden on a desktop.
  phone.hidden = true;
  const buttons = [start, cancel, phone, more];
  doc.h1 = el("h1", null);
  return {
    focus,
    doc,
    attrs,
    listeners,
    buttons: { start, cancel, phone, more },
    all: buttons,
    el,
    setBelow: (value) => (below = value),
    changed: () => observers.filter((o) => o.on).forEach((o) => o.callback()),
    watching: () => observers.filter((o) => o.on).length,
  };
}

test("the next row button is the next enabled, visible one, wrapping", () => {
  const w = world();
  const { cancel, more, start } = w.buttons;
  assert.equal(w.focus.nextInRow(cancel), more);
  // From the row's end it goes on from the row's start (Actions → Info).
  more.disabled = true;
  assert.equal(w.focus.nextInRow(cancel), start);
  start.disabled = true;
  assert.equal(w.focus.nextInRow(cancel), null, "none enabled");
  start.disabled = false;
  more.disabled = false;
  assert.equal(w.focus.nextInRow(start), cancel);
  assert.equal(w.focus.nextInRow(null), null);
  assert.equal(w.focus.nextInRow(w.el("alone", null)), null);
});

test("a confirmed action never drops focus to the page", async () => {
  const w = world();
  const { cancel, more, start } = w.buttons;
  // Cancel asked; the dialog handed focus back, then the row locks it: the
  // next enabled, visible button (More, not the hidden phone one) takes it.
  cancel.focus();
  w.focus.keepFocus(cancel);
  w.changed();
  await settle();
  assert.equal(w.doc.activeElement, cancel, "nothing locked, nothing moves");
  cancel.disabled = true;
  w.changed();
  assert.equal(w.watching(), 0, "the watch ends");
  await settle();
  assert.equal(w.doc.activeElement, more);
  // Every button locked (busy) and focus already on the page: the h1 takes
  // focus by script.
  cancel.disabled = false;
  cancel.focus();
  w.focus.keepFocus(cancel);
  for (const b of w.all) b.disabled = true;
  w.doc.activeElement = w.doc.body;
  w.changed();
  await settle();
  assert.equal(w.doc.activeElement, w.doc.h1);
  assert.equal(w.attrs.get("h1tabindex"), "-1");
  for (const b of w.all) b.disabled = false;
  // Removed with its row (a reload) works the same.
  cancel.focus();
  w.focus.keepFocus(cancel);
  cancel.isConnected = false;
  w.doc.activeElement = w.doc.body;
  w.changed();
  await settle();
  assert.equal(w.doc.activeElement, more);
  cancel.isConnected = true;
  // Focus the user moved on (a focusin elsewhere) ends the watch.
  cancel.focus();
  w.focus.keepFocus(cancel);
  [...w.listeners].forEach((l) => l({ target: start }));
  start.focus();
  cancel.disabled = true;
  w.changed();
  await settle();
  assert.equal(w.doc.activeElement, start);
  assert.equal(w.listeners.size, 0);
  assert.equal(w.watching(), 0);
  // Nothing asked: nothing to watch.
  w.focus.keepFocus(null);
  assert.equal(w.watching(), 0);
});

test("over another open dialog the fallback is its title (M-1)", async () => {
  const w = world();
  const { cancel } = w.buttons;
  // A confirmation over Custom tags: its Apply asked and is locked (busy);
  // the page's h1 is inert behind the dialog, so its title takes focus.
  const title = w.el("custom tags title", null);
  w.setBelow({ querySelector: (s) => (s === "h2" ? title : null) });
  for (const b of w.all) b.disabled = true;
  cancel.focus();
  w.focus.keepFocus(cancel);
  w.changed();
  await settle();
  assert.equal(w.doc.activeElement, title);
  assert.equal(title.getAttribute("tabindex"), "-1");
  // The fallback alone: the dialog below, else the h1.
  w.doc.activeElement = null;
  w.focus.focusFallback(w.doc);
  assert.equal(w.doc.activeElement, title);
  w.setBelow(null);
  w.focus.focusFallback(w.doc);
  assert.equal(w.doc.activeElement, w.doc.h1);
});
