import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { interfaceThemes, themePalettes } from "../src/themes.ts";
import { cssRules } from "./helpers/css-rules.mjs";
import { legacyCss } from "./helpers/legacy-styles.mjs";
import { contrast, mix, over, resolveTokens } from "./helpers/color.mjs";

// The contrast pairs of docs/STYLEGUIDE.md, Part 1, 2.6, in all 36 modes
// (18 palettes × light and dark) and both band styles. Every derived color
// comes from the formulas in styles/v2/tokens.css; only the component mixes
// of 2.2 (selected and hovered row) and 2.4 (status surfaces) are written
// here, because no token holds them.
const tokensCss = () =>
  readFileSync(new URL("../src/styles/v2/tokens.css", import.meta.url), "utf8");

const PALETTE_KEYS = [
  "bg",
  "panel",
  "panel2",
  "line",
  "text",
  "muted",
  "accent",
  "accent-bg",
  "accent-text",
];
const STATUS_KEYS = ["ok", "warn", "wait", "error", "info"];
const BANDS = ["strong", "muted"];

// Default palette and the status colors per mode, from base.css.
function baseModes() {
  const modes = {};
  for (const rule of cssRules(legacyCss("base.css"))) {
    const mode = {
      ":root": "dark",
      ':root[data-theme="light"]': "light",
    }[rule.header];
    if (!mode) continue;
    const values = Object.fromEntries(
      [...rule.body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]+);/g)].map(
        ([, key, value]) => [key, value],
      ),
    );
    if (!values.bg) continue;
    assert.equal(modes[mode], undefined, "one default " + mode + " palette");
    modes[mode] = {
      palette: Object.fromEntries(PALETTE_KEYS.map((k) => [k, values[k]])),
      status: Object.fromEntries(
        STATUS_KEYS.map((k) => [k, values["status-" + k]]),
      ),
    };
    for (const [key, value] of [
      ...Object.entries(modes[mode].palette),
      ...Object.entries(modes[mode].status),
    ])
      assert.ok(value, `base.css ${mode} defines ${key}`);
  }
  assert.deepEqual(Object.keys(modes).sort(), ["dark", "light"]);
  return modes;
}

function paletteModes() {
  const base = baseModes();
  const out = [];
  for (const name of interfaceThemes)
    for (const mode of ["dark", "light"]) {
      const palette =
        name === "default" ? base[mode].palette : themePalettes[name][mode];
      assert.deepEqual(Object.keys(palette).sort(), [...PALETTE_KEYS].sort());
      out.push({ name, mode, palette, status: base[mode].status });
    }
  return out;
}

const SELECTED_HOVER = "color-mix(in oklab, var(--accent) 12%, var(--panel))";
const tone = (key, share, base) =>
  `color-mix(in oklab, var(--status-${key}) ${share}%, var(--${base}))`;
// The text and the surface a v2 rule paints (color and background): a
// token read is the token's name, anything else the rule's own formula,
// so the pairs below check the real rules (Phase 5b, task 4).
function ruleColors(file, selector) {
  const css = readFileSync(
    new URL("../src/styles/v2/" + file, import.meta.url),
    "utf8",
  );
  const rule = cssRules(css).find(
    (r) => r.header === selector && r.context.length === 0,
  );
  assert.ok(rule, file + " has " + selector);
  const value = (property) => {
    const found = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(
      rule.body,
    );
    assert.ok(found, selector + " sets " + property);
    const text = found[1].trim().replace(/\s+/g, " ");
    return /^var\((--[\w-]+)\)$/.exec(text)?.[1] ?? text;
  };
  return { text: value("color"), bg: value("background") };
}
// The tool pages' disk tags (2.5) and the band's primary button (10.3), as
// data.css and recipes.css paint them. The contrast test of the disk tags
// swaps the source for probes.
const DISK_TARGET = ruleColors("data.css", ".v2-tag--disk");
const DISK_SOURCE = ruleColors("data.css", ".v2-tag--disk-src");
const BAND_PRIMARY = ruleColors("recipes.css", ".v2-btn.v2-btn--band-primary");

// [group, foreground, background, minimum]; a name is a token, anything
// else a CSS expression or a computed band color.
function pairs(t, source = DISK_SOURCE) {
  const [radial, linear] = t.stops("--band-bg");
  const bandMiddle = mix("srgb", linear[0], 50, linear.at(-1), 50);
  const radialLight = over(radial[0], t.color("--band-2"));
  const color = (x) => (typeof x === "string" ? t.color(x) : x);
  const list = [
    ...[
      ["bg", "--bg"],
      ["panel", "--panel"],
      ["--thead", "--thead"],
      ["--hover", "--hover"],
      ["--tint-soft", "--tint-soft"],
      ["selected and hovered", SELECTED_HOVER],
      ["--tint", "--tint"],
      ["--field-bg", "--field-bg"],
    ].map(([label, bg]) => ["--text", "--text", label, bg, 4.5]),
    ...["bg", "panel", "panel2", "--thead"].map((bg) => [
      "--muted",
      "--muted",
      bg,
      bg.startsWith("--") ? bg : "--" + bg,
      4.5,
    ]),
    ...[
      ["--hover", "--hover"],
      ["--tint-soft", "--tint-soft"],
      ["selected and hovered", SELECTED_HOVER],
      ["--tint", "--tint"],
    ].map(([label, bg]) => [
      "--muted-strong",
      "--muted-strong",
      label,
      bg,
      4.5,
    ]),
    ...[
      ["accent", "--accent"],
      ["accent-2", "--accent-2"],
      ["end of --grad-btn", t.stops("--grad-btn")[0].at(-1)],
    ].map(([label, bg]) => ["--accent-text", "--accent-text", label, bg, 4.5]),
    ...[
      ["band-1", "--band-1"],
      ["band-2", "--band-2"],
      ["middle", bandMiddle],
      ["band-2 with the radial light", radialLight],
    ].map(([label, bg]) => ["--band-ink", "--band-ink", label, bg, 4.5]),
    ...[
      ["band-1", "--band-1"],
      ["middle", bandMiddle],
    ].map(([label, bg]) => [
      "--band-ink-soft",
      "--band-ink-soft",
      label,
      bg,
      4.5,
    ]),
    ...STATUS_KEYS.map((key) => [
      "status tag",
      tone(key, 70, "text"),
      `status tag ${key}`,
      tone(key, 12, "panel"),
      4.5,
    ]),
    ...STATUS_KEYS.map((key) => [
      "notice",
      tone(key, 45, "text"),
      `notice ${key}`,
      tone(key, 10, "panel"),
      4.5,
    ]),
    [
      "danger button",
      tone("error", 80, "text"),
      "danger button hover",
      tone("error", 10, "panel"),
      4.5,
    ],
    // The excluded filter chip (2.4): its field name and its value.
    ...[
      ["field name", tone("error", 80, "text")],
      ["value", "--text"],
    ].map(([label, fg]) => [
      "excluded chip",
      fg,
      `excluded chip ${label}`,
      tone("error", 12, "panel"),
      4.5,
    ]),
    ...[
      ["--field-bg", "--field-bg"],
      ["panel", "--panel"],
    ].map(([label, bg]) => ["--field-border", "--field-border", label, bg, 3]),
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => [
      "--chart-1 … --chart-8",
      `--chart-${n}`,
      "panel",
      "--panel",
      3,
    ]),
    // The neutral media tag tone (2.5): SDR, kinds without a palette of
    // their own and custom tags without a user color.
    [
      "--tag-neutral-fg",
      "--tag-neutral-fg",
      "--tag-neutral-bg",
      "--tag-neutral-bg",
      4.5,
    ],
    // Accent ink on the tints (2.2): a chip's field name at rest and on
    // hover, and an active count.
    ["chip field", "--accent-ink", "chip", "--tint", 4.5],
    ["chip field hover", "--accent-ink", "chip hover", "--tint-strong", 4.5],
    ["count on", "--accent-ink", "count on", "--tint", 4.5],
    // The disk tags of the tool tables (2.5): a target in the accent, a
    // source in the warning tone.
    ["disk tag", DISK_TARGET.text, "disk tag target", DISK_TARGET.bg, 4.5],
    ["disk tag", source.text, "disk tag source", source.bg, 4.5],
    // The band's primary button (10.3, Scan).
    ["band primary", BAND_PRIMARY.text, "band primary", BAND_PRIMARY.bg, 4.5],
  ];
  return list.map(([group, fg, label, bg, min]) => ({
    group,
    fg: typeof fg === "string" && fg.startsWith("--") ? fg : group,
    bg: label,
    ratio: contrast(color(fg), color(bg)),
    min,
  }));
}

// Pairs and minimum per group, written out from the table in 2.6 (and 2.4
// for the status surfaces), for each band style. pairs() must match it.
const DESIGN_TABLE = {
  "--text": [8, 4.5],
  "--muted": [4, 4.5],
  "--muted-strong": [4, 4.5],
  "--accent-text": [3, 4.5],
  "--band-ink": [4, 4.5],
  "--band-ink-soft": [2, 4.5],
  "status tag": [5, 4.5],
  notice: [5, 4.5],
  "danger button": [1, 4.5],
  "excluded chip": [2, 4.5],
  "--field-border": [2, 3],
  "--chart-1 … --chart-8": [8, 3],
  "--tag-neutral-fg": [1, 4.5],
  "chip field": [1, 4.5],
  "chip field hover": [1, 4.5],
  "count on": [1, 4.5],
  "disk tag": [2, 4.5],
  "band primary": [1, 4.5],
};
const PAIRS_PER_STYLE = 55;

function check(cssText, source) {
  const results = [];
  for (const { name, mode, palette, status } of paletteModes())
    for (const band of BANDS) {
      const t = resolveTokens(cssText, { palette, status, mode, band, name });
      for (const pair of pairs(t, source))
        results.push({ ...pair, where: `${name}/${mode}/${band}` });
    }
  return results;
}

test("every palette mode meets the contrast pairs of the design", (t) => {
  const modes = paletteModes();
  assert.equal(modes.length, 36);
  assert.equal(new Set(modes.map((m) => m.name + "/" + m.mode)).size, 36);
  const results = check(tokensCss());
  assert.equal(results.length, 36 * BANDS.length * PAIRS_PER_STYLE);
  assert.equal(
    Object.values(DESIGN_TABLE).reduce((sum, [count]) => sum + count, 0),
    PAIRS_PER_STYLE,
  );
  for (const where of new Set(results.map((r) => r.where))) {
    const here = results.filter((r) => r.where === where);
    assert.equal(here.length, PAIRS_PER_STYLE, where);
    const table = {};
    for (const r of here) {
      const [count = 0, min = r.min] = table[r.group] ?? [];
      assert.equal(r.min, min, `${where} ${r.group} has one minimum`);
      table[r.group] = [count + 1, min];
    }
    assert.deepEqual(table, DESIGN_TABLE, where);
    assert.equal(
      new Set(here.map((r) => r.fg + " on " + r.bg)).size,
      PAIRS_PER_STYLE,
      where + " has no duplicate pair",
    );
  }
  const failures = results
    .filter((r) => !(r.ratio >= r.min))
    .map(
      (r) => `${r.where} ${r.fg} on ${r.bg}: ${r.ratio.toFixed(2)} < ${r.min}`,
    );
  assert.deepEqual(failures, []);
  // The lowest ratio per group, for the release notes.
  const groups = Map.groupBy(results, (r) => r.group);
  for (const [group, list] of groups) {
    const low = list.reduce((a, b) => (b.ratio < a.ratio ? b : a));
    t.diagnostic(
      `${group}: min ${low.ratio.toFixed(2)} (${low.where} on ${low.bg})`,
    );
  }
});

// The tool pages' disk tags (2.5: a target in the accent, a source in the
// warning tone) and the band's primary button (10.3) read at 4.5:1 in all
// 36 modes and both band styles. A weaker source text or a stronger source
// surface fails, so the pair can tell.
test("disk tags and the band primary button keep 4.5:1 in every mode", (t) => {
  const groups = ["disk tag", "band primary"];
  const of = (source) =>
    check(tokensCss(), source).filter((r) => groups.includes(r.group));
  const low = (list) =>
    list
      .filter((r) => !(r.ratio >= 4.5))
      .map((r) => `${r.where} ${r.fg} on ${r.bg}: ${r.ratio.toFixed(2)}`);
  // The rules paint the pairs of 2.5 and 2.6, and the status tag the
  // formula of the status tag pairs (2.4) with its --tone.
  assert.deepEqual(
    { DISK_TARGET, DISK_SOURCE, BAND_PRIMARY },
    {
      DISK_TARGET: { text: "--accent-ink", bg: "--tint" },
      DISK_SOURCE: {
        text: tone("warn", 75, "text"),
        bg: tone("warn", 12, "panel"),
      },
      BAND_PRIMARY: { text: "--accent-ink", bg: "--panel" },
    },
  );
  const tag = ruleColors("data.css", ".v2-st");
  const byTone = (key) => (formula) =>
    formula.replace("var(--tone)", `var(--status-${key})`);
  for (const key of STATUS_KEYS)
    assert.deepEqual(
      { text: byTone(key)(tag.text), bg: byTone(key)(tag.bg) },
      { text: tone(key, 70, "text"), bg: tone(key, 12, "panel") },
      "status tag " + key,
    );
  const results = of(DISK_SOURCE);
  assert.equal(results.length, 36 * BANDS.length * 3);
  for (const where of new Set(results.map((r) => r.where)))
    assert.deepEqual(
      results
        .filter((r) => r.where === where)
        .map((r) => `${r.fg} on ${r.bg} (${r.min})`),
      [
        "--accent-ink on disk tag target (4.5)",
        "disk tag on disk tag source (4.5)",
        "--accent-ink on band primary (4.5)",
      ],
      where,
    );
  assert.deepEqual(low(results), []);
  for (const bg of ["disk tag target", "disk tag source", "band primary"]) {
    const list = results.filter((r) => r.bg === bg);
    const min = list.reduce((a, b) => (b.ratio < a.ratio ? b : a));
    t.diagnostic(`${bg}: min ${min.ratio.toFixed(2)} (${min.where})`);
  }
  // Probes: the source text at mix(warn 40%, panel), or its surface at
  // mix(warn 40%, panel), fall below 4.5 (only the source pair).
  for (const probe of [
    { ...DISK_SOURCE, text: tone("warn", 40, "panel") },
    { ...DISK_SOURCE, bg: tone("warn", 40, "panel") },
  ]) {
    const failing = low(of(probe));
    assert.ok(failing.length > 0, JSON.stringify(probe));
    assert.ok(
      failing.every((line) => line.includes(" on disk tag source: ")),
      failing.join("\n"),
    );
  }
});

// A palette fix (2.2) overrides a derived token for one palette and mode
// (data-palette, as applyInterfaceTheme sets it), and only where the
// formula of :root falls below a minimum of 2.6 there: without the fix
// that palette and mode fail, and no other.
test("palette fixes sit only where a formula falls short", () => {
  const css = tokensCss();
  const fixes = cssRules(css).filter((rule) =>
    rule.header.startsWith("[data-palette="),
  );
  assert.deepEqual(
    fixes.map((rule) => rule.header),
    [
      '[data-palette="nord"][data-theme="dark"]',
      '[data-palette="catppuccin"][data-theme="dark"]',
    ],
  );
  for (const rule of fixes) {
    const [, name, mode] =
      /^\[data-palette="([\w-]+)"\]\[data-theme="(dark|light)"\]$/.exec(
        rule.header,
      );
    assert.ok(interfaceThemes.includes(name), name + " is a palette");
    assert.equal(rule.context.length, 0, rule.header + " is no media block");
    const without = css.slice(0, rule.start) + css.slice(rule.end);
    const failing = new Set(
      check(without)
        .filter((r) => !(r.ratio >= r.min))
        .map((r) => r.where.split("/").slice(0, 2).join("/")),
    );
    assert.deepEqual([...failing], [name + "/" + mode], rule.header);
  }
});

test("tokens are read from tokens.css", () => {
  const css = tokensCss();
  const defined = new Set(
    [...css.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map(([, name]) => name),
  );
  // Each derived token the pairs read is defined there, and dropping its
  // definitions makes the check fail: no copy, no fallback.
  const read = [
    "--accent-2",
    "--grad-btn",
    "--tint",
    "--tint-soft",
    "--tint-strong",
    "--accent-ink",
    "--hover",
    "--thead",
    "--field-border",
    "--field-bg",
    "--muted-strong",
    "--band-1",
    "--band-2",
    "--band-ink",
    "--band-soft",
    "--band-ink-soft",
    "--band-bg",
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `--chart-${n}`),
    "--tag-neutral-bg",
    "--tag-neutral-fg",
  ];
  for (const name of read) {
    assert.ok(defined.has(name), name + " is defined in tokens.css");
    const dropped = css.replace(
      new RegExp(`^\\s*${name}\\s*:[^;]*;`, "gm"),
      "",
    );
    assert.notEqual(dropped, css, name);
    assert.throws(() => check(dropped), new RegExp(name + "(?![\\w-])"), name);
  }
  // v2 only reads the palette and status keys.
  for (const key of [...PALETTE_KEYS, ...STATUS_KEYS.map((k) => "status-" + k)])
    assert.ok(!defined.has("--" + key), "tokens.css defines --" + key);
});
