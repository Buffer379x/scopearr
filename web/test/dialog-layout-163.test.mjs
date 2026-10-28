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

test("scan viewport follows visual-only keyboard resize and pan, reveals fields and cleans up", () => {
  const previous = globalThis.window;
  const listeners = new Map();
  const visualViewport = {
    height: 667,
    offsetTop: 0,
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: (name, handler) => {
      assert.equal(listeners.get(name), handler);
      listeners.delete(name);
    },
  };
  globalThis.window = { innerHeight: 667, visualViewport };
  const values = new Map(),
    scrolls = [];
  let inputBox = { top: 306, bottom: 348 },
    bodyBottom = 560;
  const input = {
    getBoundingClientRect: () => inputBox,
    scrollIntoView: (options) => scrolls.push(options),
  };
  const body = {
    contains: (node) => node === input,
    getBoundingClientRect: () => ({ top: 100, bottom: bodyBottom }),
  };
  const dialog = {
    ownerDocument: { activeElement: input },
    querySelector: (selector) => {
      assert.equal(selector, ".scan-dialog-body");
      return body;
    },
    style: {
      setProperty: (key, value) => values.set(key, value),
      removeProperty: (key) => values.delete(key),
    },
  };
  try {
    const stop = layout.trackDialogViewport?.(dialog);
    assert.equal(values.get("--dialog-viewport-height"), "667px");
    assert.equal(values.get("--dialog-viewport-top"), "0px");
    assert.equal(scrolls.length, 0);
    visualViewport.height = 400;
    bodyBottom = 290;
    listeners.get("resize")();
    assert.equal(window.innerHeight, 667, "layout viewport stays unchanged");
    assert.equal(values.get("--dialog-viewport-height"), "400px");
    assert.deepEqual(scrolls, [{ block: "nearest" }]);
    visualViewport.offsetTop = 90;
    inputBox = { top: 190, bottom: 232 };
    listeners.get("scroll")();
    assert.equal(values.get("--dialog-viewport-top"), "90px");
    assert.equal(
      scrolls.length,
      1,
      "visible input does not cause more panning",
    );
    stop();
    assert.equal(listeners.size, 0);
    assert.equal(values.size, 0);
  } finally {
    globalThis.window = previous;
  }
});

test("scan viewport leaves CSS viewport fallback intact when the API is unavailable", () => {
  const previous = globalThis.window;
  globalThis.window = { innerHeight: 667 };
  try {
    const stop = layout.trackDialogViewport?.({
      style: {
        setProperty: () => assert.fail("CSS fallback needs no overrides"),
      },
    });
    assert.equal(typeof stop, "function");
    stop();
  } finally {
    globalThis.window = previous;
  }
});
