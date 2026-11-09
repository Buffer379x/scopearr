import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";

// Tool table headers after a late web font (Phase 5a, task 13, E22;
// docs/STYLEGUIDE.md, Part 2, Stable tool tables). fontsReady in main.tsx
// gives up after 1s, and document.fonts.ready can be fulfilled before the
// face arrives, so useFontsLoaded counts ready and every loadingdone, and
// useToolTableStyle measures again with each count. document.fonts is a
// fake EventTarget; the canvas measures 6px a letter with the fallback and
// 9px with the web font.

const tick = () => new Promise((resolve) => setImmediate(resolve));

function fakeFonts() {
  const fonts = new EventTarget();
  fonts.ready = new Promise((resolve) => {
    fonts.resolveReady = resolve;
  });
  const listeners = [];
  const add = fonts.addEventListener.bind(fonts),
    remove = fonts.removeEventListener.bind(fonts);
  fonts.addEventListener = (type, listener) => {
    listeners.push(type);
    add(type, listener);
  };
  fonts.removeEventListener = (type, listener) => {
    listeners.splice(listeners.indexOf(type), 1);
    remove(type, listener);
  };
  fonts.listeners = listeners;
  return fonts;
}

function fakeBrowser(fonts) {
  const page = { face: "fallback", fonts: [] };
  const context = {
    font: "",
    measureText(text) {
      page.fonts.push(context.font);
      return { width: text.length * (page.face === "inter" ? 9 : 6) };
    },
  };
  const document = {
    fonts,
    documentElement: { lang: "en" },
    body: {},
    createElement(tag) {
      assert.equal(tag, "canvas");
      return { getContext: () => context };
    },
  };
  // No token is set: tool-table.ts falls back to 10px, weight 500, no
  // letter spacing, 12px padding and an 8px gap.
  const getComputedStyle = () => ({
    getPropertyValue: () => "",
    fontFamily: '"Inter Variable", sans-serif',
  });
  return { page, document, getComputedStyle };
}

function fontsHook(runtime, document) {
  return loadSource("hooks/useFontsLoaded.ts", {
    modules: { "preact/hooks": runtime.hooks },
    browser: { document },
  });
}

test("the fonts revision counts ready and every later face", async () => {
  const fonts = fakeFonts();
  const runtime = createHookRuntime();
  const { useFontsLoaded } = fontsHook(runtime, { fonts });
  const revision = () => runtime.render(() => useFontsLoaded());

  assert.equal(revision(), 0);
  runtime.flush();
  assert.deepEqual(fonts.listeners, ["loadingdone"]);
  fonts.resolveReady();
  await tick();
  assert.equal(runtime.changed, true);
  assert.equal(revision(), 1);
  for (const next of [2, 3]) {
    fonts.dispatchEvent(new Event("loadingdone"));
    assert.equal(runtime.changed, true);
    assert.equal(revision(), next);
  }
  // Other font events are no new face.
  fonts.dispatchEvent(new Event("loading"));
  fonts.dispatchEvent(new Event("loadingerror"));
  assert.equal(runtime.changed, false);

  // Unmounted, it listens no more and a late ready changes nothing.
  runtime.unmount();
  assert.deepEqual(fonts.listeners, []);
  fonts.dispatchEvent(new Event("loadingdone"));
  assert.equal(runtime.changed, false);

  const late = fakeFonts();
  const other = createHookRuntime();
  const { useFontsLoaded: lateHook } = fontsHook(other, { fonts: late });
  assert.equal(
    other.render(() => lateHook()),
    0,
  );
  other.flush();
  other.unmount();
  late.resolveReady();
  await tick();
  assert.equal(other.changed, false, "no update after unmount");
});

test("the fonts revision stays 0 without document.fonts", () => {
  const runtime = createHookRuntime();
  const { useFontsLoaded } = fontsHook(runtime, {});
  assert.equal(
    runtime.render(() => useFontsLoaded()),
    0,
  );
  runtime.flush();
  assert.equal(runtime.changed, false);
  runtime.unmount();
});

test("tool headers are measured again after a late font", async () => {
  const fonts = fakeFonts();
  const { page, document, getComputedStyle } = fakeBrowser(fonts);
  const runtime = createHookRuntime();
  const toolTable = loadSource("tool-table.ts", {
    browser: { document, getComputedStyle },
  });
  const { useToolTableStyle } = loadSource("use-tool-table.ts", {
    modules: {
      "preact/hooks": runtime.hooks,
      "./i18n": { t: (key) => key, useI18n: () => ({ locale: "en" }) },
      "./tool-table": toolTable,
      "./hooks/useFontsLoaded": fontsHook(runtime, document),
    },
    browser: { document },
  });
  // One header wider than its 120px minimum: 24 letters, so the fallback
  // gives 24 × 6 + 2 × 12 + 13 + 8 + 1 = 190 and the web font 262.
  const columns = ["title", "service", "size"];
  const labels = { service: "Service with a long name", size: "Size" };
  const statusLabels = {};
  const style = () =>
    runtime.render(() =>
      useToolTableStyle(columns, "placement", labels, statusLabels),
    );

  const first = style();
  assert.equal(first["--tool-col-service"], "190px");
  assert.equal(first["--tool-col-size"], "88px");
  assert.equal(first["--table-min"], 200 + 190 + 88 + "px");
  assert.ok(
    page.fonts.every((font) => font.endsWith('"Inter Variable", sans-serif')),
  );
  runtime.flush();
  // Rendering again without a font event keeps the measured style.
  assert.equal(style(), first);

  // ready is fulfilled before the face arrives: measured again, the same.
  fonts.resolveReady();
  await tick();
  assert.equal(runtime.changed, true);
  const ready = style();
  assert.equal(ready["--tool-col-service"], "190px");

  // The face arrives late: the headers are measured with it.
  page.face = "inter";
  fonts.dispatchEvent(new Event("loadingdone"));
  assert.equal(runtime.changed, true);
  const late = style();
  assert.notEqual(late, ready);
  assert.equal(late["--tool-col-service"], "262px");
  assert.equal(late["--tool-col-size"], "88px");
  assert.equal(late["--table-min"], 200 + 262 + 88 + "px");
  assert.equal(style(), late);
  runtime.unmount();
  assert.deepEqual(fonts.listeners, []);
});
