import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";

// Tool table headers after a late web font (Phase 5a, task 13, E22;
// docs/STYLEGUIDE.md, Part 1, 10.10, ToolTable). fontsReady in main.tsx
// gives up after 1s, and document.fonts.ready can be fulfilled before the
// face arrives, so useFontsLoaded counts ready and every loadingdone, and
// useToolColumnStyle measures again with each count (the 1.7.0
// useToolTableStyle left with the 1.7.0 tool pages in Phase 5b, Task 9).
// document.fonts is a fake EventTarget; the canvas measures 6px a letter
// with the fallback and 9px with the web font.

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
  // The v2 tokens the tool table measures with (tool-columns.ts,
  // domToolMetrics): headers of 10px without letter spacing, cells with
  // 8px padding and 20px at the table's edges, the title's 200px minimum.
  const tokens = {
    "--font": '"Inter Variable", sans-serif',
    "--fs-thead": "10px",
    "--w-bold": "700",
    "--sp-1": "4px",
    "--sp-2": "8px",
    "--sp-5": "20px",
    "--title-col-min": "200px",
  };
  const getComputedStyle = () => ({
    getPropertyValue: (name) => tokens[name] ?? "",
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
  const browser = { document, getComputedStyle };
  const { useToolColumnStyle } = loadSource("use-tool-table.ts", {
    modules: {
      "preact/hooks": runtime.hooks,
      "./i18n": { t: (key) => key, useI18n: () => ({ locale: "en" }) },
      "./hooks/useFontsLoaded": fontsHook(runtime, document),
      "./tool-columns": loadSource("tool-columns.ts", {
        modules: {
          "./filecheck": loadSource("filecheck.ts"),
          "./mux-spec": loadSource("mux-spec.ts", {
            modules: { "./languages.ts": { audioLanguage: () => null } },
          }),
          "./placement": loadSource("placement.ts"),
          "./ui": { ICON: { arrow: 11 } },
        },
        browser,
      }),
    },
    browser,
  });
  // One header wider than its 96px minimum: 24 letters, so the fallback
  // gives 24 × 6 + 1, the sort button 4 + 4 + 2 + 11 and the padding 8 + 8:
  // 182; the web font 24 × 9 + 1 + 21 + 16 = 254. Size stays at its 64px
  // minimum and its padding (8 + 20, the last cell), the title takes its
  // 200px minimum and its padding (20 + 8, the first cell).
  const columns = ["title", "service", "size"];
  const labels = { service: "Service with a long name", size: "Size" };
  const buttons = { info: 2, actions: 2, infoPhone: 1, actionsPhone: 1 };
  const style = () =>
    runtime.render(() =>
      useToolColumnStyle(columns, "placement", labels, buttons),
    );

  const first = style();
  assert.equal(first["--tt-service"], "182px");
  assert.equal(first["--tt-size"], "92px");
  assert.equal(first["--tt-min"], 228 + 182 + 92 + "px");
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
  assert.equal(ready["--tt-service"], "182px");

  // The face arrives late: the headers are measured with it.
  page.face = "inter";
  fonts.dispatchEvent(new Event("loadingdone"));
  assert.equal(runtime.changed, true);
  const late = style();
  assert.notEqual(late, ready);
  assert.equal(late["--tt-service"], "254px");
  assert.equal(late["--tt-size"], "92px");
  assert.equal(late["--tt-min"], 228 + 254 + 92 + "px");
  assert.equal(style(), late);
  runtime.unmount();
  assert.deepEqual(fonts.listeners, []);
});
