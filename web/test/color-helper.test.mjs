import test from "node:test";
import assert from "node:assert/strict";
import {
  contrast,
  mix,
  over,
  parseColor,
  resolveTokens,
} from "./helpers/color.mjs";

// Reference pixels from Chromium 156.0.8078.4 (Playwright chromium-1248),
// taken once with a scratch script: each expression was set as the
// fillStyle of a 1×1 2D canvas, painted over the ground (if any) and read
// back with getImageData. The values are 8-bit sRGB.
const CHROMIUM = [
  ["color-mix(in srgb, #14755c 50%, #205f94)", null, [26, 106, 120]],
  ["color-mix(in oklab, #14755c 62%, #205f94)", null, [22, 110, 115]],
  ["color-mix(in oklab, #7ee4c5 1%, #151e21)", null, [22, 32, 34]],
  ["color-mix(in oklab, #7ee4c5 99%, #151e21)", null, [125, 226, 195]],
  ["color-mix(in srgb, #e5edef 35%, #819399)", null, [164, 179, 183]],
  ["color-mix(in srgb, #ff0000 1%, #0000ff)", null, [3, 0, 252]],
  ["color-mix(in oklab, #ff0000 50%, #00ff00)", null, [208, 168, 0]],
  ["color-mix(in oklab, #0000ff 50%, #ffff00)", null, [108, 171, 199]],
  ["color-mix(in oklab, #a33743 80%, #1d3238 60%)", null, [108, 58, 63]],
  ["color-mix(in oklab, #a33743 30%, #fff)", null, [232, 195, 195]],
  ["color-mix(in srgb, #ff0000, #00ff00)", null, [128, 128, 0]],
  ["color-mix(in oklab, #7ee4c5 30%, #101719 40%)", "#ffffff", [118, 148, 141]],
  ["color-mix(in oklab, #7ee4c5 30%, #101719 40%)", "#000000", [42, 72, 65]],
  ["color-mix(in srgb, #ff0000 20%, #0000ff 30%)", "#ffffff", [178, 127, 204]],
  ["color-mix(in oklab, #ffffff 8%, transparent)", "#14755c", [39, 128, 105]],
  ["color-mix(in oklab, #123429 8%, transparent)", "#e0f4eb", [207, 228, 219]],
  ["color-mix(in srgb, #ffffff 10%, transparent)", "#101719", [40, 46, 48]],
  ["color-mix(in oklab, #000 50%, transparent)", "#ffffff", [127, 127, 127]],
  ["color-mix(in oklab, #ff000080 50%, #0000ff)", "#ffffff", [139, 122, 209]],
  [
    "color-mix(in oklab, color-mix(in oklab, #7ee4c5 70%, #86c5f4) 24%, #101719)",
    null,
    [40, 64, 64],
  ],
  [
    "color-mix(in oklab, color-mix(in oklab, #14755c 70%, #205f94) 16%, #f5f8f8)",
    null,
    [211, 225, 225],
  ],
  [
    "color-mix(in oklab, #ffffff 88%, color-mix(in oklab, #14755c 22%, #f5f8f8))",
    null,
    [248, 251, 250],
  ],
];

const NONE = { palette: {}, status: {}, mode: "dark", band: "strong" };
const evaluate = (expression) =>
  resolveTokens(`:root { --probe: ${expression}; }`, NONE).color("--probe");
const bytes = (color) =>
  [color.r, color.g, color.b].map((c) =>
    Math.round(255 * Math.min(1, Math.max(0, c))),
  );

test("color-mix matches Chromium within one step", () => {
  assert.equal(CHROMIUM.length, 22);
  for (const [expression, ground, expected] of CHROMIUM) {
    let color = evaluate(expression);
    if (ground) color = over(color, parseColor(ground));
    else assert.ok(Math.abs(color.a - 1) < 1e-9, expression + " is opaque");
    const actual = bytes(color);
    for (let i = 0; i < 3; i++)
      assert.ok(
        Math.abs(actual[i] - expected[i]) <= 1,
        `${expression}${ground ? " over " + ground : ""}: ${actual} vs Chromium ${expected}`,
      );
  }
});

test("colors parse from hex and transparent", () => {
  assert.deepEqual(parseColor("#fff"), { r: 1, g: 1, b: 1, a: 1 });
  assert.deepEqual(parseColor("#FF0000"), { r: 1, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseColor("#00000000"), { r: 0, g: 0, b: 0, a: 0 });
  assert.deepEqual(parseColor("transparent"), { r: 0, g: 0, b: 0, a: 0 });
  for (const bad of ["red", "#12", "#12345", "rgb(0 0 0)", ""])
    assert.throws(() => parseColor(bad), bad);
});

test("color-mix normalizes percentages and keeps a missing share as alpha", () => {
  const red = parseColor("#ff0000"),
    blue = parseColor("#0000ff");
  // Both omitted: 50/50. One omitted: the rest of 100%.
  assert.deepEqual(mix("srgb", red, undefined, blue, undefined), {
    r: 0.5,
    g: 0,
    b: 0.5,
    a: 1,
  });
  assert.deepEqual(mix("srgb", red, 25, blue, undefined), {
    r: 0.25,
    g: 0,
    b: 0.75,
    a: 1,
  });
  // A sum above 100% scales down; below 100% also lowers alpha.
  assert.deepEqual(mix("srgb", red, 90, blue, 30), mix("srgb", red, 75, blue));
  const thin = mix("srgb", red, 20, blue, 30);
  assert.ok(Math.abs(thin.a - 0.5) < 1e-12);
  assert.ok(Math.abs(thin.r - 0.4) < 1e-12);
  assert.throws(() => mix("srgb", red, 0, blue, 0));
  assert.throws(() => mix("srgb", red, 150, blue, 50));
  assert.throws(() => mix("hsl", red, 50, blue, 50));
  // transparent adds only alpha, never black (premultiplied).
  const glass = mix(
    "oklab",
    parseColor("#ffffff"),
    8,
    parseColor("transparent"),
  );
  assert.ok(Math.abs(glass.a - 0.08) < 1e-12);
  assert.ok(bytes(glass).every((c) => c === 255));
});

test("WCAG contrast uses relative luminance", () => {
  const ratio = (a, b) => contrast(parseColor(a), parseColor(b));
  assert.equal(ratio("#000000", "#ffffff"), 21);
  assert.equal(ratio("#ffffff", "#000000"), 21);
  assert.equal(ratio("#777777", "#777777"), 1);
  assert.equal(ratio("#777777", "#ffffff").toFixed(2), "4.48");
  // A translucent foreground is composited over its background first.
  assert.equal(contrast(parseColor("#00000000"), parseColor("#ffffff")), 1);
  assert.deepEqual(over(parseColor("#ffffff80"), parseColor("#000000")), {
    r: 128 / 255,
    g: 128 / 255,
    b: 128 / 255,
    a: 1,
  });
});

test("tokens resolve through the cascade, var() fallbacks and nested mixes", () => {
  const css = `
    :root { --a: var(--accent); --soft: 88%; --m: color-mix(in srgb, var(--a) var(--soft), var(--missing, #000)); }
    [data-theme="light"] { --a: #0000ff; }
    :root { --b: #111; }
    [data-band="muted"][data-theme="dark"] { --b: #222; }
    :root { --b: #333; }
    @media (max-width: 1px) { :root { --gap: 12px; } }
    [data-palette-scope] { --b: #555; }
  `;
  const at = (mode, band) =>
    resolveTokens(css, {
      palette: { accent: "#ff0000" },
      status: { info: "#00ff00" },
      mode,
      band,
    });
  const dark = at("dark", "strong");
  assert.deepEqual(dark.color("--accent"), parseColor("#ff0000"));
  assert.deepEqual(dark.color("--status-info"), parseColor("#00ff00"));
  assert.deepEqual(dark.color("--a"), parseColor("#ff0000"));
  assert.deepEqual(at("light", "strong").color("--a"), parseColor("#0000ff"));
  const m = dark.color("--m");
  assert.ok(Math.abs(m.r - 0.88) < 1e-12 && m.g === 0 && m.b === 0);
  // Later rules win at equal specificity; a more specific rule wins over
  // a later one; geometry in media blocks and other elements do not apply.
  assert.deepEqual(dark.color("--b"), parseColor("#333"));
  assert.deepEqual(at("dark", "muted").color("--b"), parseColor("#222"));
  assert.deepEqual(at("light", "muted").color("--b"), parseColor("#333"));
  assert.throws(() => dark.color("--undefined"), /--undefined/);
  assert.throws(
    () => resolveTokens(":root { --x: var(--x); }", NONE).color("--x"),
    /cycle/,
  );
  assert.throws(
    () => resolveTokens(".card { --x: #000; }", NONE).color("--x"),
    /selector/,
  );
});

test("a palette fix applies only to its palette and mode", () => {
  const css = `
    :root { --x: #000; }
    [data-palette="nord"][data-theme="dark"] { --x: #fff; }
  `;
  const read = (name, mode) =>
    resolveTokens(css, { ...NONE, name, mode }).color("--x");
  assert.deepEqual(read("nord", "dark"), parseColor("#fff"));
  assert.deepEqual(read("nord", "light"), parseColor("#000"));
  assert.deepEqual(read("catppuccin", "dark"), parseColor("#000"));
  // Without a name the palette is the default one.
  assert.deepEqual(read(undefined, "dark"), parseColor("#000"));
});

test("selectors are single root compounds", () => {
  const read = (selector) =>
    resolveTokens(`${selector} { --x: #fff; }`, {
      ...NONE,
      band: "muted",
    }).color("--x");
  assert.deepEqual(read('[data-band="muted"][data-theme="dark"]'), {
    r: 1,
    g: 1,
    b: 1,
    a: 1,
  });
  for (const selector of [
    '[data-theme="dark"] [data-band="muted"]',
    ':root [data-band="muted"]',
    '[data-theme="dark"]>[data-band="muted"]',
    '[data-theme="dark"] > [data-band="muted"]',
    '[data-theme="dark"] + [data-band="muted"]',
    '[data-theme="dark"] ~ [data-band="muted"]',
    ":root .card",
    "html",
  ])
    assert.throws(() => read(selector), /unsupported selector/, selector);
});

test("at-rule blocks may hold geometry only", () => {
  const sheet = (inner) => `
    :root { --gap: 16px; --accent-2: color-mix(in oklab, var(--accent) 62%, #fff); }
    @media (max-width: 739px) { :root { ${inner} } }
    @media (pointer: coarse) { :root { --row: 56px; } }
  `;
  const resolve = (inner) =>
    resolveTokens(sheet(inner), {
      ...NONE,
      palette: { accent: "#14755c" },
    });
  // Good: lengths and calc() over other lengths, as in the phone block.
  const good = resolve(
    "--gap: 12px; --band-h: calc(6px + var(--topbar-h) + var(--gap));",
  );
  assert.ok(good.color("--accent-2").a === 1);
  // Bad: any color value inside an at-rule throws at once.
  for (const value of [
    "#000",
    "#14755cff",
    "transparent",
    "white",
    "RebeccaPurple",
    "currentColor",
    "rgb(0 0 0)",
    "hsl(0 0% 0%)",
    "oklab(0.5 0 0)",
    "oklch(0.5 0 0)",
    "color-mix(in oklab, var(--accent) 10%, var(--panel))",
    "linear-gradient(90deg, var(--line) 22%, red)",
  ])
    assert.throws(
      () => resolve(`--x: ${value};`),
      /color inside @media \(max-width: 739px\)/,
      value,
    );
  // Bad: a token declared inside an at-rule throws when it is read, even
  // without a color value (a percentage, or a token holding a color).
  const soft = resolve("--accent-2: var(--other);");
  assert.throws(
    () => soft.color("--accent-2"),
    /--accent-2 is also declared inside @media/,
  );
  assert.throws(
    () =>
      resolveTokens(
        `:root { --s: 88%; --m: color-mix(in srgb, #fff var(--s), #000); }
         @supports (color: red) { :root { --s: 60%; } }`,
        NONE,
      ).color("--m"),
    /--s is also declared inside @supports/,
  );
  // Nested style rules are not understood.
  assert.throws(
    () => resolveTokens(":root { & [data-x] { --x: 1px; } }", NONE),
    /nested rule/,
  );
});
