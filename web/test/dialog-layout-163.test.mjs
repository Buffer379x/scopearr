import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

const moduleURL = new URL("../src/dialog-layout.ts", import.meta.url);
const layout = existsSync(moduleURL) ? await import(moduleURL) : {};

test("tabbed height retains its session maximum, caps against the viewport and clears on close", () => {
  const original = globalThis.ResizeObserver;
  let changed = () => {};
  globalThis.ResizeObserver = class {
    constructor(fn) {
      changed = fn;
    }
    observe() {}
    disconnect() {}
  };
  try {
    let height = 850;
    const dialog = {
      getBoundingClientRect: () => ({ height }),
      style: {
        minHeight: "",
        removeProperty(name) {
          assert.equal(name, "min-height");
          this.minHeight = "";
        },
      },
    };
    const close = layout.trackDialogHeight?.(dialog);
    assert.equal(
      dialog.style.minHeight,
      "min(850px, calc(100dvh - var(--layout-50)))",
    );
    height = 279;
    changed();
    assert.equal(
      dialog.style.minHeight,
      "min(850px, calc(100dvh - var(--layout-50)))",
    );
    height = 910;
    changed();
    assert.equal(
      dialog.style.minHeight,
      "min(910px, calc(100dvh - var(--layout-50)))",
    );
    close();
    assert.equal(dialog.style.minHeight, "");
    const closeNext = layout.trackDialogHeight(dialog);
    assert.equal(
      dialog.style.minHeight,
      "min(910px, calc(100dvh - var(--layout-50)))",
    );
    closeNext();
    height = 279;
    const closeShort = layout.trackDialogHeight(dialog);
    assert.equal(
      dialog.style.minHeight,
      "min(279px, calc(100dvh - var(--layout-50)))",
    );
    closeShort();
  } finally {
    globalThis.ResizeObserver = original;
  }
});

test("tab changes reveal only an out-of-view tablist using nearest scrolling", () => {
  const scrolls = [];
  let box = { top: 150, bottom: 194 };
  const tablist = {
    closest: (selector) => {
      assert.equal(selector, "dialog");
      return { getBoundingClientRect: () => ({ top: 25, bottom: 875 }) };
    },
    getBoundingClientRect: () => box,
    scrollIntoView: (options) => scrolls.push(options),
  };
  layout.revealDialogTabs?.(tablist);
  assert.equal(scrolls.length, 0);
  box = { top: -10, bottom: 34 };
  layout.revealDialogTabs?.(tablist);
  assert.deepEqual(scrolls, [{ block: "nearest" }]);
});
