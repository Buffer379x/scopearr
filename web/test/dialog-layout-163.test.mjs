import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

const moduleURL = new URL("../src/dialog-layout.ts", import.meta.url);
const layout = existsSync(moduleURL) ? await import(moduleURL) : {};
// The v2 modal's body and properties (Modal.tsx, fitViewport).
const BODY = ":scope > .v2-modal-body";
const NAMES = ["--modal-vv-h", "--modal-vv-top"];

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
      assert.equal(selector, ":scope > .v2-modal-body");
      return body;
    },
    style: {
      setProperty: (key, value) => values.set(key, value),
      removeProperty: (key) => values.delete(key),
    },
  };
  try {
    const stop = layout.trackDialogViewport?.(dialog, BODY, NAMES);
    assert.equal(values.get("--modal-vv-h"), "667px");
    assert.equal(values.get("--modal-vv-top"), "0px");
    assert.equal(scrolls.length, 0);
    visualViewport.height = 400;
    bodyBottom = 290;
    listeners.get("resize")();
    assert.equal(window.innerHeight, 667, "layout viewport stays unchanged");
    assert.equal(values.get("--modal-vv-h"), "400px");
    assert.deepEqual(scrolls, [{ block: "nearest" }]);
    visualViewport.offsetTop = 90;
    inputBox = { top: 190, bottom: 232 };
    listeners.get("scroll")();
    assert.equal(values.get("--modal-vv-top"), "90px");
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
    const stop = layout.trackDialogViewport?.(
      {
        style: {
          setProperty: () => assert.fail("CSS fallback needs no overrides"),
        },
      },
      BODY,
      NAMES,
    );
    assert.equal(typeof stop, "function");
    stop();
  } finally {
    globalThis.window = previous;
  }
});
