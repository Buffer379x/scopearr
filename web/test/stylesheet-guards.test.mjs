import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  cssRules,
  customProperties,
  declarations,
  selectors,
} from "./helpers/css-rules.mjs";
import {
  LEGACY_STYLESHEETS,
  allLegacyCss,
  legacyCss,
} from "./helpers/legacy-styles.mjs";
import { allSources } from "./helpers/sources.mjs";
import { loadSource } from "./helpers/component-harness.mjs";
import { interfaceThemes, themePalettes } from "../src/themes.ts";

// Guards for the 2.0.0 stylesheet architecture (docs/STYLEGUIDE.md, Part 1,
// section 9). Each guard is a function that lists problems; it runs against
// synthetic good and bad samples and against the real files, so none of them
// can pass by checking nothing. The 1.7.0 ownership guard stays separate in
// legacy-ui/stylesheet-ownership.test.mjs.

const srcUrl = (path) => new URL("../src/" + path, import.meta.url);
const read = (path) => readFileSync(srcUrl(path), "utf8");
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const oneSpace = (text) => text.replace(/\s+/g, " ").trim();

const LAYERS = [
  "legacy",
  "tokens",
  "base",
  "shell",
  "recipes",
  "pages",
  "responsive",
];
const LAYER_STATEMENT = "@layer " + LAYERS.join(", ") + ";";
const TOKEN_FILES = ["tokens.css", "fonts.css"];
// Every v2 file with its layer, in import order (section 9). data.css holds
// the data building blocks in the layer recipes, after recipes.css (E25);
// settings.css the settings families, in the same layer after data.css
// (Phase 5c, E24).
const V2_SHEETS = Object.freeze([
  ["tokens.css", "tokens"],
  ["fonts.css", "tokens"],
  ["base.css", "base"],
  ["shell.css", "shell"],
  ["recipes.css", "recipes"],
  ["data.css", "recipes"],
  ["settings.css", "recipes"],
  ["pages.css", "pages"],
]);
const v2Names = () => readdirSync(srcUrl("styles/v2/")).sort();
const v2Css = (name) => read("styles/v2/" + name);

// The 9 palette keys and 5 status tokens: v2 reads them, never defines them.
const paletteKeys = Object.keys(themePalettes.nord.dark).map((k) => "--" + k);
const statusKeys = [
  ...new Set(legacyCss("base.css").match(/--status-[a-z]+/g)),
].sort();
const sharedKeys = new Set([...paletteKeys, ...statusKeys]);

// --- 1. Layer order in style.css -------------------------------------------

function layerProblems(styleCss, files, v2Sheets = null) {
  const problems = [];
  const statements = stripComments(styleCss)
    .split(";")
    .map(oneSpace)
    .filter(Boolean);
  if (statements[0] + ";" !== LAYER_STATEMENT)
    problems.push("first statement is not the layer order: " + statements[0]);
  const imports = [];
  for (const statement of statements.slice(1)) {
    const m = statement.match(
      /^@import "\.\/styles\/([^"]+)" layer\(([a-z-]+)\)$/,
    );
    if (m) imports.push({ path: m[1], layer: m[2] });
    else problems.push("not a layered import: " + statement);
  }
  imports.forEach(({ path, layer }, i) => {
    if (!LAYERS.includes(layer))
      problems.push(path + ": undeclared layer " + layer);
    else if (i && LAYERS.indexOf(layer) < LAYERS.indexOf(imports[i - 1].layer))
      problems.push(path + ": imported after a higher layer");
    if (layer !== "legacy" && !path.startsWith("v2/"))
      problems.push(path + ": a 1.7.0 sheet outside layer(legacy)");
    if (path.startsWith("v2/") && layer === "legacy")
      problems.push(path + ": a v2 file in layer(legacy)");
    if (TOKEN_FILES.includes(path.slice(3)) && layer !== "tokens")
      problems.push(path + ": token files load into layer(tokens)");
    if (path.startsWith("v2/") && !files.includes(path.slice(3)))
      problems.push(path + ": no such file in styles/v2/");
  });
  const legacy = imports.filter((i) => i.layer === "legacy").map((i) => i.path);
  if (legacy.join() !== LEGACY_STYLESHEETS.join())
    problems.push(
      "layer(legacy) imports differ from LEGACY_STYLESHEETS: " +
        legacy.join(", "),
    );
  for (const name of files) {
    const count = imports.filter((i) => i.path === "v2/" + name).length;
    if (count !== 1)
      problems.push(`v2/${name}: imported ${count} times, expected once`);
  }
  // The v2 imports, in order and each into its layer, as v2Sheets lists
  // them: a new file or a moved import needs its entry first.
  const v2 = imports
    .filter((i) => i.path.startsWith("v2/"))
    .map((i) => i.path.slice(3) + " " + i.layer);
  if (v2Sheets && v2.join() !== v2Sheets.map((s) => s.join(" ")).join())
    problems.push("v2 imports differ from V2_SHEETS: " + v2.join(", "));
  return problems;
}

const sampleStyle = (legacy = LEGACY_STYLESHEETS, extra = []) =>
  [
    LAYER_STATEMENT,
    ...legacy.map((name) => `@import "./styles/${name}" layer(legacy);`),
    '@import "./styles/v2/tokens.css" layer(tokens);',
    ...extra,
  ].join("\n");

test("style.css declares the layer order first and loads every sheet into a layer", () => {
  const files = ["tokens.css"];
  assert.deepEqual(layerProblems(sampleStyle(), files), []);
  const files3 = ["tokens.css", "base.css", "shell.css"];
  const bad = [
    [
      sampleStyle().replace(
        '"./styles/library.css" layer(legacy)',
        '"./styles/library.css"',
      ),
      /not a layered import: @import "\.\/styles\/library\.css"$/m,
    ],
    [
      sampleStyle()
        .replace(LAYER_STATEMENT + "\n", "")
        .concat("\n" + LAYER_STATEMENT),
      /first statement is not the layer order/,
    ],
    [
      sampleStyle().replace(
        LAYER_STATEMENT,
        "@layer tokens, legacy, base, shell, recipes, pages, responsive;",
      ),
      /first statement is not the layer order/,
    ],
    [
      sampleStyle([...LEGACY_STYLESHEETS.slice(1), LEGACY_STYLESHEETS[0]]),
      /layer\(legacy\) imports differ from LEGACY_STYLESHEETS/,
    ],
    [
      sampleStyle([...LEGACY_STYLESHEETS, "extra.css"]),
      /layer\(legacy\) imports differ from LEGACY_STYLESHEETS: .*extra\.css/,
    ],
    [
      sampleStyle(undefined, ['@import "./styles/extra.css" layer(base);']),
      /extra\.css: a 1\.7\.0 sheet outside layer\(legacy\)/,
    ],
    [
      sampleStyle(undefined, [
        '@import "./styles/v2/tokens.css" layer(tokens);',
      ]),
      /v2\/tokens\.css: imported 2 times/,
    ],
    [
      sampleStyle(undefined, [
        '@import "./styles/v2/shell.css" layer(shell);',
        '@import "./styles/v2/base.css" layer(base);',
      ]),
      /v2\/base\.css: imported after a higher layer/,
      files3,
    ],
    [
      sampleStyle(undefined, [
        '@import "./styles/v2/base.css" layer(legacy);',
        '@import "./styles/v2/shell.css" layer(shell);',
      ]),
      /v2\/base\.css: a v2 file in layer\(legacy\)/,
      files3,
    ],
    [
      sampleStyle().replace(
        'v2/tokens.css" layer(tokens)',
        'v2/tokens.css" layer(base)',
      ),
      /v2\/tokens\.css: token files load into layer\(tokens\)/,
    ],
    [
      sampleStyle(undefined, ["body { margin: 0; }"]),
      /not a layered import: body \{ margin: 0$/m,
    ],
    [
      sampleStyle(undefined, ['@import "./styles/v2/x.css" layer(extra);']),
      /v2\/x\.css: undeclared layer extra/,
    ],
    [
      sampleStyle(),
      /v2\/base\.css: imported 0 times/,
      ["tokens.css", "base.css"],
    ],
  ];
  for (const [sample, problem, sampleFiles = files] of bad)
    assert.match(layerProblems(sample, sampleFiles).join("\n"), problem);

  // The v2 list: each file loads once, in order, into its own layer.
  const sheets = [
    ["tokens.css", "tokens"],
    ["base.css", "base"],
    ["recipes.css", "recipes"],
    ["data.css", "recipes"],
  ];
  const v2Import = ([name, layer]) =>
    `@import "./styles/v2/${name}" layer(${layer});`;
  const style = (list) => sampleStyle(undefined, list.slice(1).map(v2Import));
  const names = sheets.map(([name]) => name);
  assert.deepEqual(layerProblems(style(sheets), names, sheets), []);
  for (const [list, why] of [
    [
      [sheets[0], sheets[1], ["recipes.css", "recipes"], ["data.css", "pages"]],
      "data.css in another layer",
    ],
    [
      [sheets[0], sheets[1], sheets[3], sheets[2]],
      "data.css before recipes.css",
    ],
    [sheets.slice(0, 3), "data.css missing"],
  ])
    assert.match(
      layerProblems(style(list), names, sheets).join("\n"),
      /v2 imports differ from V2_SHEETS/,
      why,
    );

  const files_ = v2Names();
  assert.ok(files_.includes("tokens.css"), "styles/v2/tokens.css exists");
  assert.deepEqual(files_, V2_SHEETS.map(([name]) => name).sort());
  assert.deepEqual(layerProblems(read("style.css"), files_, V2_SHEETS), []);
});

// --- 2./3. Names shared with 1.7.0 --------------------------------------------

const VAR_READ = /var\(\s*(--[\w-]+)/g;
const legacyCssText = allLegacyCss();
const legacyDefined = new Set(
  customProperties(legacyCssText).map((p) => p.name),
);
const legacyReads = new Set(
  [...legacyCssText.matchAll(VAR_READ)].map((m) => m[1]),
);
// Every custom property a v2 file defines.
const v2Defined = new Set(
  v2Names()
    .flatMap((name) => customProperties(v2Css(name)))
    .map((p) => p.name),
);
// "--…" strings in web/src TS/TSX; a string ending in "-" is a prefix
// (`"--tt-" + column`). var() reads in TS/TSX count as names too.
const sources = allSources();
const sourceTokens = [
  ...new Set([...sources.matchAll(/["'`](--[A-Za-z0-9-]+)/g)].map((m) => m[1])),
];
const sourceReads = [
  ...new Set([...sources.matchAll(VAR_READ)].map((m) => m[1])),
];

// Every 1.7.0 token name, and the TSX prefixes that build more of them: the
// names 1.7.0 CSS defines, plus the names and prefixes TS/TSX sets or reads.
// A TSX name that a v2 file defines and no 1.7.0 rule defines or reads is a
// v2 read, not a 1.7.0 name; likewise a TSX prefix that only v2 names start
// with.
function legacyNames(legacyText, sourceText, v2Names) {
  const defined = customProperties(legacyText).map((p) => p.name);
  const known = new Set([
    ...defined,
    ...[...legacyText.matchAll(VAR_READ)].map((m) => m[1]),
  ]);
  const strings = [
    ...new Set(
      [...sourceText.matchAll(/["'`](--[A-Za-z0-9-]+)/g)].map((m) => m[1]),
    ),
  ];
  const reads = [...sourceText.matchAll(VAR_READ)].map((m) => m[1]);
  const v2Read = (name) => v2Names.has(name) && !known.has(name);
  const names = [
    ...new Set([...strings.filter((n) => !n.endsWith("-")), ...reads]),
  ];
  const tokens = new Set([...defined, ...names.filter((n) => !v2Read(n))]);
  const startsWith = (names, prefix) =>
    [...names].some((name) => name.startsWith(prefix));
  const v2Prefix = (prefix) =>
    !startsWith(known, prefix) && startsWith(v2Names, prefix);
  const allPrefixes = strings.filter((n) => n.endsWith("-"));
  const prefixes = allPrefixes.filter((prefix) => !v2Prefix(prefix));
  // What the v2 rule left out, so a test can pin it.
  const excluded = {
    tokens: names.filter(v2Read).sort(),
    prefixes: allPrefixes.filter(v2Prefix).sort(),
  };
  return { tokens, prefixes, excluded };
}
// TSX names and prefixes that are v2 reads in the real sources. A later
// phase that reads a v2 token from TSX adds it here on purpose. --font:
// fontsReady in main.tsx (Phase 4); --ease: the page fade in AppShell.tsx
// (Phase 4); --sp-3 and --toast-top: the toasts' gap below what they keep
// clear of and their own top in notifications.ts (Phase 4, final review
// I1; read as numbers since the 5a fix wave, N2); --ct: a custom tag's user
// color in list/CustomTag.tsx and --tone: a row mark's user warning color
// in list/RowMark.tsx (Phase 5a, task 3; data.css defines both);
// --tc-gutter: the measured scrollbar height of a table region in
// hooks/useTableOverflow.ts (Phase 5a, task 5; data.css defines it).
// Phase 5b, task 2 (ruling I12): tool-columns.ts measures the tool tables
// with the v2 metrics domToolMetrics reads (--fs-thead, --ls-thead,
// --w-bold, --fs-xs, --w-semi, --dot-sm, --sp-1, --sp-2, --sp-5,
// --row-btn, --select-col, --title-col-min, --tool-status-min) and sets
// the table's --tt-<column>, --tt-min and --tt-min-phone (data.css
// defines both minimums). Phase 5b, task 4: --v, the value ProgressCell
// and the disk cards' usage bar set for their fill (data.css defines it).
// Phase 5b, task 5 review (ruling M15): domToolMetrics measures the
// selection column with --check and, on a coarse pointer, --check-touch
// and --sp-3. Phase 5b fix wave (F-I2): it measures a plain cell's text
// with --fs-sm at --w-reg.
const V2_TSX_READS = [
  "--check",
  "--check-touch",
  "--ct",
  "--dot-sm",
  "--ease",
  "--font",
  "--fs-sm",
  "--fs-thead",
  "--fs-xs",
  "--ls-thead",
  "--row-btn",
  "--select-col",
  "--sp-1",
  "--sp-2",
  "--sp-3",
  "--sp-5",
  "--tc-gutter",
  "--title-col-min",
  "--toast-top",
  "--tone",
  "--tool-status-min",
  "--tt-min",
  "--tt-min-phone",
  "--v",
  "--w-bold",
  "--w-reg",
  "--w-semi",
];
const V2_TSX_PREFIXES = ["--tt-"];
const { tokens: legacyTokens, prefixes: legacyPrefixes } = legacyNames(
  legacyCssText,
  sources,
  v2Defined,
);

// v2 rules and tokens read no 1.7.0 token (docs/STYLEGUIDE.md, intro): every
// var() in a v2 file names a v2 token or one of the shared keys. The whole
// text is scanned, so fallbacks and keyframes count too.
function legacyReadProblems(where, css) {
  const reads = new Set(
    [...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]),
  );
  return [...reads]
    .filter(
      (name) =>
        !sharedKeys.has(name) &&
        (legacyTokens.has(name) ||
          legacyPrefixes.some((prefix) => name.startsWith(prefix))),
    )
    .map((name) => where + "reads the 1.7.0 token " + name);
}

function nameProblems(v2Props, taken, prefixes) {
  const problems = [];
  for (const { name } of v2Props) {
    if (sharedKeys.has(name))
      problems.push(name + ": palette and status keys are only read in v2");
    else if (taken.has(name)) problems.push(name + ": also a 1.7.0 token");
    const prefix = prefixes.find((p) => name.startsWith(p));
    if (prefix) problems.push(name + ": matches the 1.7.0 prefix " + prefix);
  }
  return [...new Set(problems)];
}

test("v2 tokens share no name with 1.7.0 and never redefine palette keys", () => {
  assert.equal(paletteKeys.length, 9, "9 palette keys");
  assert.equal(statusKeys.length, 5, "5 status keys");
  assert.ok(legacyDefined.has("--radius-sm"), "reads 1.7.0 definitions");
  assert.ok(sourceTokens.includes("--dialog-viewport-top"), "reads TSX");
  assert.ok(sourceReads.length > 0, "reads var() in TSX");
  const taken = legacyTokens;
  const prefixes = legacyPrefixes;
  // The scan reads the TSX prefixes (the v2 "--tt-" is one, excluded as a
  // v2 read); since Phase 5b, Task 9 no TSX prefix builds a 1.7.0 name (the
  // 1.7.0 toolTableStyle's "--tool-col-" left with the 1.7.0 tool pages).
  assert.deepEqual(
    legacyNames(legacyCssText, sources, v2Defined).excluded.prefixes,
    ["--tt-"],
    "reads TSX prefixes",
  );
  assert.deepEqual(prefixes, [], "no TSX prefix builds a 1.7.0 name");
  const props = (css) => customProperties(css);
  assert.deepEqual(
    nameProblems(props(":root { --v2-sample: 1px; }"), taken, prefixes),
    [],
  );
  for (const sample of [
    ":root { --radius-sm: 8px; }",
    ":root { --accent: red; }",
    ":root { --status-info: red; }",
    ":root { --dialog-viewport-top: 0; }",
    ":root { --control-md: 0; }",
  ])
    assert.notDeepEqual(
      nameProblems(props(sample), taken, prefixes),
      [],
      sample,
    );
  // A name a TSX prefix would build is taken too.
  const built = legacyNames(
    legacyCssText,
    sources + ' "--tool-col-" + column;',
    v2Defined,
  );
  assert.deepEqual(
    nameProblems(
      props(":root { --tool-col-title: 0; }"),
      built.tokens,
      built.prefixes,
    ),
    ["--tool-col-title: matches the 1.7.0 prefix --tool-col-"],
  );

  const real = v2Names().flatMap((name) => props(v2Css(name)));
  assert.ok(real.length > 100, "tokens.css defines the v2 tokens");
  assert.deepEqual(nameProblems(real, taken, prefixes), []);
});

// From Phase 4 on, TS/TSX reads v2 tokens ("--fs-sm", var(--sp-4)). Such a
// read must not turn the v2 name into a 1.7.0 token; a name that 1.7.0 CSS
// defines or reads, and every name no v2 file defines, stays a 1.7.0 name.
test("TSX reads of v2 tokens are not 1.7.0 names", () => {
  assert.ok(v2Defined.has("--fs-sm") && v2Defined.has("--sp-4"), "v2 names");
  const v2Reads =
    'el.style.setProperty("--fs-sm", "1px"); const w = "var(--sp-4)";' +
    ' const c = "--chart-" + n;';
  // The scan sees these names: without the v2 rule they would be taken.
  assert.match(v2Reads, /["'`]--fs-sm/);
  const withV2 = legacyNames(legacyCssText, sources + v2Reads, v2Defined);
  for (const name of ["--fs-sm", "--sp-4"])
    assert.ok(!withV2.tokens.has(name), name + " is a v2 read");
  assert.ok(!withV2.prefixes.includes("--chart-"), "a prefix of v2 names");
  const real = v2Names().flatMap((name) => customProperties(v2Css(name)));
  assert.deepEqual(nameProblems(real, withV2.tokens, withV2.prefixes), []);

  const legacy = legacyNames(
    legacyCssText,
    '"--dialog-viewport-top"; "--v2-unknown"; "var(--radius-sm)";' +
      ' "--tool-col-" + column; "--chart-x-" + n;',
    v2Defined,
  );
  for (const name of [
    "--dialog-viewport-top",
    "--v2-unknown",
    "--radius-sm",
    "--accent",
  ])
    assert.ok(legacy.tokens.has(name), name + " stays a 1.7.0 name");
  assert.deepEqual(legacy.prefixes, ["--tool-col-", "--chart-x-"]);
  // A v2 name that a 1.7.0 rule reads is still a collision.
  const clash = legacyNames(
    ".a { width: var(--fs-sm); }",
    '"--fs-sm"',
    v2Defined,
  );
  assert.ok(clash.tokens.has("--fs-sm"), "1.7.0 CSS reads --fs-sm");
  assert.deepEqual(
    nameProblems(
      customProperties(":root { --fs-sm: 1px; }"),
      clash.tokens,
      clash.prefixes,
    ),
    ["--fs-sm: also a 1.7.0 token"],
  );
  const prefixClash = legacyNames(
    ".a { width: var(--chart-legacy); }",
    '"--chart-" + n',
    v2Defined,
  );
  assert.deepEqual(prefixClash.prefixes, ["--chart-"]);
  // The real run excludes exactly the listed v2 reads, so every new exclusion
  // is a deliberate change of this list.
  assert.deepEqual(legacyNames(legacyCssText, sources, v2Defined).excluded, {
    tokens: V2_TSX_READS,
    prefixes: V2_TSX_PREFIXES,
  });
  assert.deepEqual(withV2.excluded, {
    tokens: [...new Set([...V2_TSX_READS, "--fs-sm", "--sp-4"])].sort(),
    prefixes: [...V2_TSX_PREFIXES, "--chart-"].sort(),
  });
  // The real run keeps every name 1.7.0 CSS defines and the TSX names.
  for (const name of [...legacyDefined, "--dialog-viewport-top"])
    assert.ok(legacyTokens.has(name), name);
  assert.deepEqual(legacyPrefixes, [], "the TSX prefixes");
});

function readProblems(legacyText, v2Defined) {
  return [...legacyText.matchAll(/var\(\s*(--[\w-]+)/g)]
    .map((m) => m[1])
    .filter((name) => v2Defined.has(name))
    .map((name) => "1.7.0 CSS reads the v2 token " + name);
}

test("1.7.0 rules read no v2 token", () => {
  const v2Defined = new Set(
    v2Names()
      .flatMap((name) => customProperties(v2Css(name)))
      .map((p) => p.name),
  );
  assert.ok(v2Defined.has("--r-sm"), "reads v2 definitions");
  assert.ok(legacyReads.has("--radius-sm"), "reads 1.7.0 var() calls");
  assert.deepEqual(readProblems(".a { padding: var(--sp-x); }", v2Defined), []);
  assert.notDeepEqual(
    readProblems(".a { border-radius: var(--r-sm); }", v2Defined),
    [],
  );
  assert.notDeepEqual(
    readProblems(".a { color: var( --accent-ink, red); }", v2Defined),
    [],
  );
  assert.deepEqual(readProblems(legacyCssText, v2Defined), []);
});

// --- 4. Token files -----------------------------------------------------------

const TOKEN_SELECTORS = [
  ":root",
  ":root, [data-palette-scope]",
  '[data-theme="light"]',
  '[data-theme="dark"]',
  '[data-band="muted"][data-theme="dark"]',
  '[data-band="muted"][data-theme="light"]',
];
// A palette fix (section 2.2): one bundled palette in one mode, as
// applyInterfaceTheme sets data-palette.
const PALETTE_FIX =
  /^\[data-palette="([\w-]+)"\]\[data-theme="(?:dark|light)"\]$/;
const tokenSelector = (selector) =>
  TOKEN_SELECTORS.includes(selector) ||
  interfaceThemes.includes(PALETTE_FIX.exec(selector)?.[1]);
const TOKEN_MEDIA = ["@media (max-width: 739px)", "@media (pointer: coarse)"];
const SHELL_STATE = ["--offset"];

function tokenFileProblems(source) {
  const problems = [];
  const css = stripComments(source);
  for (const [header] of css.matchAll(/@[a-z-]+[^{;]*/g))
    if (!TOKEN_MEDIA.includes(oneSpace(header)))
      problems.push("at-rule not allowed in a token file: " + oneSpace(header));
  problems.push(...legacyReadProblems("", css));
  const varReads = (value) =>
    [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);
  // What each token reads, over all of its definitions in this file.
  const readsOf = new Map();
  for (const rule of cssRules(css))
    for (const { name, value } of declarations(rule.body))
      readsOf.set(name, [...(readsOf.get(name) ?? []), ...varReads(value)]);
  // Whether a read reaches a palette or status key, directly or through
  // other tokens of this file (each token is followed once per question, so
  // a cycle ends).
  const reachesPalette = (name, followed = new Set()) => {
    if (sharedKeys.has(name)) return true;
    if (followed.has(name)) return false;
    followed.add(name);
    return (readsOf.get(name) ?? []).some((r) => reachesPalette(r, followed));
  };
  // Phone and touch blocks override tokens of :root; they define none.
  const rootNames = new Set(
    cssRules(css)
      .filter(
        (rule) => !rule.context.length && oneSpace(rule.header) === ":root",
      )
      .flatMap((rule) => declarations(rule.body).map((d) => d.name)),
  );
  for (const rule of cssRules(css).filter((r) => r.context.length))
    for (const { name } of declarations(rule.body))
      if (!rootNames.has(name))
        problems.push(name + ": overrides no :root token");
  for (const rule of cssRules(css)) {
    const selector = oneSpace(rule.header);
    const media = rule.context.map(oneSpace);
    if (!tokenSelector(selector))
      problems.push("not a token selector: " + selector);
    if (media.length && selector !== ":root")
      problems.push(selector + ": phone and touch lengths sit on :root");
    for (const { name, value } of declarations(rule.body)) {
      if (!name.startsWith("--"))
        problems.push(selector + ": not a custom property: " + name);
      if (SHELL_STATE.includes(name))
        problems.push(name + ": shell state is not a token");
      // Formulas over palette keys, direct or through derived tokens, must
      // also apply to [data-palette-scope].
      if (
        selector === ":root" &&
        varReads(value).some((r) => reachesPalette(r))
      )
        problems.push(name + ": derived from palette keys on :root only");
    }
  }
  return problems;
}

function fontFileProblems(source) {
  const rest = oneSpace(
    stripComments(source).replace(/@font-face\s*\{[^{}]*\}/g, ""),
  );
  return rest ? ["fonts.css holds only @font-face rules: " + rest] : [];
}

test("token files hold only custom properties on token selectors", () => {
  const good = `:root { --a: 1px; --e: 48px; }
:root, [data-palette-scope] { --b: color-mix(in oklab, var(--accent) 14%, var(--panel)); }
[data-theme="dark"] { --c: var(--bg); }
[data-band="muted"][data-theme="light"] { --d: 94%; }
[data-palette="nord"][data-theme="dark"] { --b: color-mix(in oklab, var(--accent) 18%, var(--panel)); }
@media (max-width: 739px) { :root { --a: 2px; } }
@media (pointer: coarse) { :root { --e: 56px; } }`;
  assert.deepEqual(tokenFileProblems(good), []);
  for (const sample of [
    '[data-palette="unknown"][data-theme="dark"] { --b: var(--bg); }',
    '[data-palette="nord"] { --b: var(--bg); }',
    '[data-theme="dark"][data-palette="nord"] { --b: var(--bg); }',
    '@media (max-width: 739px) { [data-palette="nord"][data-theme="dark"] { --a: 1px; } }',
    ":root { color: red; }",
    "body { --a: 1px; }",
    ".card { --a: 1px; }",
    ":root { --offset: 72px; }",
    ":root { --tint: color-mix(in oklab, var(--accent) 14%, var(--panel)); }",
    "@media (max-width: 740px) { :root { --a: 1px; } }",
    '@media (max-width: 739px) { [data-theme="dark"] { --a: 1px; } }',
    "@font-face { font-family: X; }",
    '@import "x.css";',
  ])
    assert.notDeepEqual(tokenFileProblems(sample), [], sample);
  // A :root-only token must not reach the palette through derived tokens
  // either: it would compute once on :root and inherit into the scope. Two
  // readers of one derived token are both flagged; a cycle ends.
  const tint =
    ":root, [data-palette-scope] { --tint: color-mix(in oklab, var(--accent) 14%, var(--panel)); }";
  assert.deepEqual(
    tokenFileProblems(
      tint +
        ":root { --a: 4px; --b: calc(var(--a) * 2); --c: var(--d); --d: var(--c); }" +
        ":root, [data-palette-scope] { --x: var(--tint); }",
    ),
    [],
  );
  for (const sample of [
    tint + ":root { --w: var(--tint); --x: var(--tint); }",
    tint +
      "@media (max-width: 739px) { :root { --x: 0 0 0 1px var(--tint); } }",
    '[data-theme="dark"] { --c: var(--bg); } :root, [data-palette-scope] { --d: var(--c); } :root { --x: var(--d); }',
  ])
    assert.match(
      tokenFileProblems(sample).join("\n"),
      /^--x: derived from palette keys on :root only$/m,
      sample,
    );
  // v2 tokens read no 1.7.0 token; the shared keys are the only exception.
  assert.ok(legacyTokens.has("--accent"), "the palette keys are 1.7.0 names");
  assert.deepEqual(
    tokenFileProblems(
      ":root, [data-palette-scope] { --b: color-mix(in oklab, var(--accent) 80%, var(--status-info)); }",
    ),
    [],
  );
  for (const [sample, problem] of [
    [":root { --a: var(--radius-sm); }", /reads the 1\.7\.0 token --radius-sm/],
    [
      '[data-theme="dark"] { --a: var(--space-2); }',
      /reads the 1\.7\.0 token --space-2/,
    ],
    [
      '[data-theme="dark"] { --a: var(--x, var(--control-md)); }',
      /reads the 1\.7\.0 token --control-md/,
    ],
  ])
    assert.match(tokenFileProblems(sample).join("\n"), problem, sample);
  assert.deepEqual(
    fontFileProblems(
      '/* Inter */ @font-face { font-family: "Inter Variable"; src: url(a.woff2); }',
    ),
    [],
  );
  assert.notDeepEqual(
    fontFileProblems("@font-face { src: url(a.woff2); } .a { color: red; }"),
    [],
  );
  assert.notDeepEqual(fontFileProblems(":root { --font: x; }"), []);

  const tokens = v2Css("tokens.css");
  assert.ok(cssRules(tokens).length >= 4, "tokens.css has token blocks");
  assert.deepEqual(tokenFileProblems(tokens), []);
  if (v2Names().includes("fonts.css"))
    assert.deepEqual(fontFileProblems(v2Css("fonts.css")), []);
});

test("phone and touch blocks only override tokens defined on :root", () => {
  const good = `:root { --a: 1px; --e: 48px; }
@media (max-width: 739px) { :root { --a: 2px; } }
@media (pointer: coarse) { :root { --e: 56px; } }`;
  assert.deepEqual(tokenFileProblems(good), []);
  for (const [sample, problem] of [
    [
      "@media (max-width: 739px) { :root { --a: 2px; } }",
      /^--a: overrides no :root token$/m,
    ],
    [
      ":root { --row-h: 48px; } @media (pointer: coarse) { :root { --row-hh: 56px; } }",
      /^--row-hh: overrides no :root token$/m,
    ],
    [
      ":root, [data-palette-scope] { --a: 1px; } @media (max-width: 739px) { :root { --a: 2px; } }",
      /^--a: overrides no :root token$/m,
    ],
    [
      '[data-theme="dark"] { --a: 1px; } @media (pointer: coarse) { :root { --a: 2px; } }',
      /^--a: overrides no :root token$/m,
    ],
  ])
    assert.match(tokenFileProblems(sample).join("\n"), problem, sample);
  const tokens = v2Css("tokens.css");
  const overrides = cssRules(stripComments(tokens)).filter(
    (rule) => rule.context.length,
  );
  assert.ok(overrides.length >= 2, "tokens.css has phone and touch blocks");
});

// --- 5. v2 rule files ---------------------------------------------------------

const V2_WIDTHS = [1599, 1279, 1119, 899, 739, 359];
const V2_CONTAINERS = [1060, 760, 560];
const V2_FEATURES = [
  "@media (pointer: coarse)",
  "@media (prefers-reduced-motion: reduce)",
  "@media (forced-colors: active)",
];
const REDUCED_MOTION = "@media (prefers-reduced-motion: reduce)";
// CSS named colors; transparent, currentColor and inherit are allowed.
const NAMED_COLORS = new Set(
  `aliceblue antiquewhite aqua aquamarine azure beige bisque black
blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate
coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod
darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange
darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray
darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey
dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold
goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory
khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral
lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink
lightsalmon lightseagreen lightskyblue lightslategray lightslategrey
lightsteelblue lightyellow lime limegreen linen magenta maroon
mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen
mediumslateblue mediumspringgreen mediumturquoise mediumvioletred
midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive
olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise
palevioletred papayawhip peachpuff peru pink plum powderblue purple
rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen
seashell sienna silver skyblue slateblue slategray slategrey snow
springgreen steelblue tan teal thistle tomato turquoise violet wheat white
whitesmoke yellow yellowgreen`.split(/\s+/),
);

const legacyClasses = new Set(
  cssRules(legacyCssText).flatMap((rule) =>
    [...rule.header.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]),
  ),
);

// Every CSS length unit (CSS Values 4 and 5), matched in any case.
const LENGTH_UNITS = `px cm mm q in pt pc em rem ex rex cap rcap ch rch ic ric
lh rlh vw vh vi vb vmin vmax svw svh svi svb svmin svmax lvw lvh lvi lvb lvmin
lvmax dvw dvh dvi dvb dvmin dvmax cqw cqh cqi cqb cqmin cqmax`
  .split(/\s+/)
  .sort((a, b) => b.length - a.length);
const RAW_LENGTH = new RegExp(
  String.raw`(?<![\w.#-])-?(\d*\.?\d+)(?:${LENGTH_UNITS.join("|")})\b`,
  "gi",
);
// The value without custom property names and strings.
const valueText = (value) =>
  value.replace(/var\(\s*--[\w-]+/g, "var(").replace(/"[^"]*"|'[^']*'/g, "");

function rawValueProblems(where, value) {
  const problems = [];
  const v = valueText(value);
  for (const [length, number] of v.matchAll(RAW_LENGTH))
    if (Number(number) !== 0 && !/^-?1px$/i.test(length))
      problems.push(where + ": raw length " + length);
  for (const [hex] of v.matchAll(/#[0-9a-fA-F]{3,8}\b/g))
    problems.push(where + ": raw color " + hex);
  for (const [fn] of v.matchAll(
    /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi,
  ))
    problems.push(where + ": raw color " + fn);
  // A word directly followed by "(" is a function such as tan(), not a color.
  for (const [word] of v.matchAll(/\b[a-zA-Z]+\b(?!\()/g))
    if (NAMED_COLORS.has(word.toLowerCase()))
      problems.push(where + ": named color " + word);
  return problems;
}

// Durations, layers and weights come from --t-*, --z-* and --w-*
// (docs/STYLEGUIDE.md, Part 1, section 9). Zero durations are not raw values;
// under reduced motion every duration is 0.01ms. z-index allows 0, 1, -1, a
// --z-* token and a --z-* token plus or minus 1.
const RAW_DURATION = /(?<![\w.#-])-?(\d*\.?\d+)m?s\b/gi;
const Z_INDEX =
  /^(?:-?[01]|auto|inherit|initial|unset|revert|revert-layer|var\(--z-[\w-]+\)|calc\(var\(--z-[\w-]+\) [+-] 1\))$/i;
const BARE_NUMBER = /(?<![\w.#/-])\d*\.?\d+(?![\w%.])/g;

function tokenUseProblems(where, name, value, context) {
  const problems = [];
  const v = valueText(value);
  const property = name.toLowerCase();
  const reduced = context.includes(REDUCED_MOTION);
  for (const [time, number] of v.matchAll(RAW_DURATION))
    if (Number(number) !== 0 && !(reduced && time.toLowerCase() === "0.01ms"))
      problems.push(where + ": raw duration " + time);
  if (property === "z-index") {
    const z = oneSpace(value.replace(/!\s*important/i, ""))
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")");
    if (!Z_INDEX.test(z)) problems.push(where + ": raw z-index " + z);
  }
  // In the font shorthand, "/ <line-height>" follows the size; it is no weight.
  const weights = property === "font" ? v.replace(/\/\s*[^\s/]+/g, "") : v;
  if (property === "font-weight" || property === "font")
    for (const [weight] of weights.matchAll(BARE_NUMBER))
      problems.push(where + ": raw font-weight " + weight);
  return problems;
}

// A selector is scoped when a class remains after dropping :not() and :has()
// arguments (they never narrow what the rest matches) and :is()/:where()
// lists in which some alternative has no class: `button:not(.v2-x)` and
// `:is(button, .v2-x)` both match every 1.7.0 button.
function scopedText(selector) {
  const text = selector
    .replace(/"[^"]*"|'[^']*'/g, "")
    .replace(/\[[^\]]*\]/g, "[]");
  let out = "";
  for (let i = 0; i < text.length;) {
    const m = /^:(not|has|is|where|matches|-webkit-any)\(/i.exec(text.slice(i));
    if (!m) {
      out += text[i++];
      continue;
    }
    let j = i + m[0].length,
      depth = 1;
    for (; j < text.length && depth; j++)
      if (text[j] === "(") depth++;
      else if (text[j] === ")") depth--;
    const inner = text.slice(i + m[0].length, j - 1);
    const list = selectors(inner);
    if (
      !["not", "has"].includes(m[1].toLowerCase()) &&
      list.length &&
      list.every(hasScopingClass)
    )
      out += ".scoped";
    i = j;
  }
  return out;
}
const hasScopingClass = (selector) =>
  /\.[A-Za-z_][\w-]*/.test(scopedText(selector));

function ruleFileProblems(files) {
  const problems = [],
    owners = new Map();
  for (const [file, source] of Object.entries(files)) {
    const css = stripComments(source),
      seen = new Set(),
      widths = { media: [], container: [] };
    problems.push(...legacyReadProblems(file + ": ", css));
    for (const [raw] of css.matchAll(/@[a-z-]+[^{;]*/g)) {
      const header = oneSpace(raw);
      const media = header.match(/^@media \(max-width: (\d+)px\)$/);
      const container = header.match(
        /^@container(?: [a-z][\w-]*)? \(max-width: (\d+)px\)$/,
      );
      if (/^@keyframes [\w-]+$/.test(header)) continue;
      if (media && V2_WIDTHS.includes(+media[1])) widths.media.push(+media[1]);
      else if (container && V2_CONTAINERS.includes(+container[1]))
        widths.container.push(+container[1]);
      else if (!V2_FEATURES.includes(header)) {
        problems.push(`${file}: undocumented at-rule ${header}`);
        continue;
      }
      if (seen.has(header))
        problems.push(`${file}: a second block for ${header}`);
      seen.add(header);
    }
    for (const list of Object.values(widths))
      if (list.some((w, i) => i && w > list[i - 1]))
        problems.push(`${file}: thresholds are not widest first`);
    for (const rule of cssRules(css)) {
      const context = rule.context.map(oneSpace);
      // Keyframe selectors (from, to, 50%) are not selectors; their
      // declarations are values like any other.
      const keyframe = context.some((c) => c.startsWith("@keyframes"));
      for (const selector of keyframe
        ? []
        : selectors(rule.header).map(oneSpace)) {
        const where = `${file}: ${selector}`;
        const classes = [...selector.matchAll(/\.([A-Za-z_][\w-]*)/g)].map(
          (m) => m[1],
        );
        if (!hasScopingClass(selector))
          problems.push(where + ": selector without a scoping class");
        for (const name of classes)
          if (legacyClasses.has(name))
            problems.push(where + ": uses the 1.7.0 class ." + name);
        const key = [...context, selector].join(" | ");
        if (owners.has(key))
          problems.push(`${where}: second rule (first in ${owners.get(key)})`);
        else owners.set(key, file);
      }
      for (const { name, value } of declarations(rule.body)) {
        const where = `${file}: ${oneSpace(rule.header)} ${name}`;
        if (/!\s*important/i.test(value) && !context.includes(REDUCED_MOTION))
          problems.push(where + ": !important");
        problems.push(...rawValueProblems(where, value));
        problems.push(...tokenUseProblems(where, name, value, context));
      }
    }
  }
  return problems;
}

test("v2 rule files use one owner per selector, a class in every selector, no 1.7.0 class, no !important, only tokens and fixed breakpoints", () => {
  assert.ok(legacyClasses.has("modal-actions"), "reads 1.7.0 classes");
  const good = `.v2-card { padding: var(--sp-4); border: 1px solid var(--line); margin: 0; color: currentColor; background: transparent; box-shadow: inset 0 -1px 0 var(--line-soft); }
.v2-card button { font: inherit; }
@media (max-width: 1119px) { .v2-card { padding: var(--sp-3); } }
@media (max-width: 739px) { .v2-card { padding: var(--sp-2); } }
@container (max-width: 760px) { .v2-card .v2-title { display: none; } }
@media (pointer: coarse) { .v2-card { min-height: var(--touch); } }
@media (prefers-reduced-motion: reduce) { .v2-card { transition-duration: 0.01ms !important; } }
@media (forced-colors: active) { .v2-check { appearance: auto; } }
@keyframes v2-spin { to { transform: rotate(360deg); } }
.v2-x:is(:hover, :focus-visible) { color: var(--accent-ink); }
:is(.v2-a, .v2-b) .v2-icon:not(:first-child) { margin: 0; }
.v2-angle { rotate: atan(tan(var(--angle))); }`;
  assert.deepEqual(ruleFileProblems({ "good.css": good }), []);
  const bad = {
    "a type selector": "button { padding: 0; }",
    "an attribute selector": "[aria-current] { color: var(--text); }",
    "a class only inside :not()": "button:not(.v2-x) { padding: 0; }",
    "a class in one :is() alternative": ":is(button, .v2-x) { padding: 0; }",
    "a class in one :where() alternative":
      ":where(.v2-x, input) { padding: 0; }",
    "a class only inside :has()": "label:has(.v2-x) { padding: 0; }",
    "a class only in an attribute value": '[class=".v2-x"] { padding: 0; }',
    "a raw container length": ".v2-x { padding: 10cqi; }",
    "a raw line-height length": ".v2-x { margin: 2lh; }",
    "a raw Q length": ".v2-x { margin: 4Q; }",
    "a 1.7.0 class": ".v2-x .modal-actions { gap: var(--sp-2); }",
    "!important": ".v2-x { display: none !important; }",
    "a raw length": ".v2-x { padding: 12px; }",
    "a raw negative length": ".v2-x { margin: -2px; }",
    "a raw hex color": ".v2-x { color: #fff; }",
    "a raw rgb()": ".v2-x { color: rgb(0 0 0); }",
    "a named color": ".v2-x { border-color: white; }",
    "a 1.7.0 breakpoint": "@media (max-width: 740px) { .v2-x { gap: 0; } }",
    "a min-width query": "@media (min-width: 1600px) { .v2-x { gap: 0; } }",
    "an undocumented container":
      "@container (max-width: 600px) { .v2-x { gap: 0; } }",
    "two blocks per threshold":
      "@media (max-width: 739px) { .v2-x { gap: 0; } } @media (max-width: 739px) { .v2-y { gap: 0; } }",
    "narrowest first":
      "@media (max-width: 739px) { .v2-x { gap: 0; } } @media (max-width: 1119px) { .v2-y { gap: 0; } }",
    "two rules for one selector": ".v2-x { gap: 0; } .v2-x { margin: 0; }",
  };
  for (const [name, sample] of Object.entries(bad))
    assert.notDeepEqual(ruleFileProblems({ "bad.css": sample }), [], name);
  assert.notDeepEqual(
    ruleFileProblems({
      "a.css": ".v2-x { gap: 0; }",
      "b.css": ".v2-x { margin: 0; }",
    }),
    [],
    "two owners in two files",
  );
  // v2 rules read no 1.7.0 token: not from 1.7.0 CSS, not one TS/TSX sets or
  // reads, not one built from a TSX prefix, not in a fallback or a keyframe.
  assert.deepEqual(
    ruleFileProblems({
      "good.css": ".v2-x { color: var(--status-ok); gap: var(--sp-2); }",
    }),
    [],
  );
  for (const [sample, problem] of [
    [
      ".v2-x { gap: var(--space-2); }",
      /bad\.css: reads the 1\.7\.0 token --space-2/,
    ],
    [".v2-x { border-radius: var(--radius-sm); }", /token --radius-sm/],
    [
      ".v2-x { top: var(--dialog-viewport-top); }",
      /token --dialog-viewport-top/,
    ],
    [".v2-x { width: var(--layout-50); }", /token --layout-50/],
    [".v2-x { width: var(--control-md); }", /token --control-md/],
    [".v2-x { gap: var(--sp-2, var(--space-3)); }", /token --space-3/],
    [
      "@keyframes v2-x { to { margin: var(--radius-sm); } }",
      /bad\.css: reads the 1\.7\.0 token --radius-sm/,
    ],
  ])
    assert.match(
      ruleFileProblems({ "bad.css": sample }).join("\n"),
      problem,
      sample,
    );

  // An empty :is() scopes nothing; keyframe declarations are values too.
  for (const [name, sample] of Object.entries({
    "an empty :is()": "button:is() { padding: 0; }",
    "a raw length in a keyframe": "@keyframes v2-x { to { margin: 4px; } }",
  }))
    assert.notDeepEqual(ruleFileProblems({ "bad.css": sample }), [], name);

  // Phase 3 has no v2 rule files yet; the guard applies to every file that
  // is not a token file.
  const ruleFiles = v2Names().filter((name) => !TOKEN_FILES.includes(name));
  assert.deepEqual(
    ruleFileProblems(
      Object.fromEntries(ruleFiles.map((name) => [name, v2Css(name)])),
    ),
    [],
  );
});

test("raw values cover every CSS length unit in any case", () => {
  for (const length of [
    "4Q",
    "10PX",
    "2dvi",
    "1dvb",
    "3svi",
    "5lvi",
    "2rcap",
    "1ic",
    "3cap",
    "2rlh",
    "1VMIN",
  ]) {
    assert.deepEqual(
      rawValueProblems("x", "calc(" + length + " + var(--sp-2))"),
      ["x: raw length " + length],
      length,
    );
    assert.notDeepEqual(
      ruleFileProblems({ "bad.css": `.v2-x { margin: ${length}; }` }),
      [],
      length,
    );
  }
  for (const value of ["0", "1px", "50%", "1fr", "45deg", "2"])
    assert.deepEqual(rawValueProblems("x", value), [], value);
});

test("v2 rule files use tokens for durations, layers and weights", () => {
  const good = `.v2-x { transition: opacity var(--t-fast) var(--ease); z-index: calc(var(--z-sidebar) - 1); font-weight: var(--w-semi); }
.v2-y { z-index: -1; animation: v2-spin var(--t-slow) linear infinite; transition-delay: 0s; }
.v2-z { z-index: var(--z-topbar); font: var(--w-bold) var(--fs-page) / var(--lh-page-title) var(--font); }
.v2-w { z-index: calc(var(--z-fly) + 1); }
.v2-v { z-index: 0; }
.v2-u { z-index: 1; font-weight: inherit; }
.v2-t { animation: v2-ring var(--t-ring) var(--ease), v2-bar var(--t-bar) var(--ease); }
.v2-s { animation: v2-spin var(--t-spin) linear infinite, v2-pulse var(--t-pulse) var(--ease) infinite; }
.v2-r { animation: v2-pulse var(--t-pulse-slow) var(--ease) infinite; font: var(--w-semi) var(--fs-sm) / 1.5 var(--font); }
@media (prefers-reduced-motion: reduce) { .v2-x { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; } }`;
  assert.deepEqual(ruleFileProblems({ "good.css": good }), []);
  for (const [sample, problem] of [
    [".v2-x { transition: opacity 150ms; }", /raw duration 150ms/],
    [".v2-x { animation: x 1s; }", /raw duration 1s$/m],
    [".v2-x { animation-delay: 0.2S; }", /raw duration 0\.2S/],
    [".v2-x { transition-duration: 0.01ms; }", /raw duration 0\.01ms/],
    [
      "@media (prefers-reduced-motion: reduce) { .v2-x { transition-duration: 1ms !important; } }",
      /raw duration 1ms/,
    ],
    [".v2-x { z-index: 30; }", /raw z-index 30/],
    [".v2-x { z-index: 2; }", /raw z-index 2/],
    [
      ".v2-x { z-index: calc(var(--z-sidebar) - 2); }",
      /raw z-index calc\(var\(--z-sidebar\) - 2\)/,
    ],
    [".v2-x { z-index: var(--sp-2); }", /raw z-index var\(--sp-2\)/],
    [".v2-x { font-weight: 600; }", /raw font-weight 600/],
    [".v2-x { FONT-WEIGHT: 550; }", /raw font-weight 550/],
    [".v2-x { font: 600 var(--fs-sm) var(--font); }", /raw font-weight 600/],
    [".v2-x { animation: v2-ring 800ms var(--ease); }", /raw duration 800ms/],
    [".v2-x { animation: v2-bar 600ms var(--ease); }", /raw duration 600ms/],
    [".v2-x { animation: v2-pulse 1.4s infinite; }", /raw duration 1\.4s/],
  ])
    assert.match(
      ruleFileProblems({ "bad.css": sample }).join("\n"),
      problem,
      sample,
    );
  // The line height after "/" in the font shorthand is not a weight.
  assert.deepEqual(
    ruleFileProblems({
      "bad.css": ".v2-x { font: 600 var(--fs-sm) / 1.5 var(--font); }",
    }),
    ["bad.css: .v2-x font: raw font-weight 600"],
  );
  // The animation durations of the guide (section 6) are tokens.
  const durations = Object.fromEntries(
    customProperties(v2Css("tokens.css"))
      .filter((p) => p.name.startsWith("--t-"))
      .map((p) => [p.name, p.value]),
  );
  for (const [name, value] of Object.entries({
    "--t-ring": "800ms",
    "--t-bar": "600ms",
    "--t-spin": "1s",
    "--t-pulse": "1s",
    "--t-pulse-slow": "1.4s",
  }))
    assert.equal(durations[name], value, name);
});

// --- 5b. Hit areas -------------------------------------------------------------

// Compact frame targets keep their visible size under a coarse pointer and
// get an invisible 44px hit area (docs/STYLEGUIDE.md, Part 1, 10.7 Pill):
// the pill is the containing block, and its ::after spans its width, at
// least --touch (the dot-only sync chip below 900 is 28 wide), and --touch
// in height, centered on the pill, so neighbours never move. That no hit
// area overlaps a neighbour is measured by the e2e touch test.
// Under the coarse block nothing else may touch the pills of the topbar.
const COARSE = "@media (pointer: coarse)";
const PILL_SELECTORS = /v2-pill|v2-sync-chip|v2-demo(?![\w-])/;
function hitAreaProblems(files) {
  const problems = [],
    seen = new Set();
  for (const [file, source] of Object.entries(files))
    for (const rule of cssRules(stripComments(source))) {
      const coarse = rule.context.map(oneSpace).includes(COARSE);
      const list = declarations(rule.body);
      const value = (name) =>
        oneSpace(list.find((d) => d.name === name)?.value ?? "");
      for (const selector of selectors(rule.header).map(oneSpace)) {
        if (!coarse || !PILL_SELECTORS.test(selector)) continue;
        const where = `${file}: ${selector}`;
        if (selector === ".v2-pill") {
          seen.add(selector);
          if (value("position") !== "relative")
            problems.push(where + ": the hit area needs position: relative");
          for (const { name } of list)
            if (name !== "position")
              problems.push(where + ": changes " + name + " under coarse");
        } else if (selector === ".v2-pill::after") {
          seen.add(selector);
          if (value("content") !== '""') problems.push(where + ": no content");
          if (value("position") !== "absolute")
            problems.push(where + ": not absolute");
          if (value("height") !== "var(--touch)")
            problems.push(where + ": height is not var(--touch)");
          if (value("width") !== "max(100%, var(--touch))")
            problems.push(where + ": not the pill's width, at least --touch");
          if (value("inset") !== "50% auto auto 50%")
            problems.push(where + ": not placed at the pill's center");
          if (value("translate") !== "-50% -50%")
            problems.push(where + ": not centered on the pill");
          for (const { name } of list)
            if (
              ![
                "content",
                "position",
                "inset",
                "width",
                "height",
                "translate",
              ].includes(name)
            )
              problems.push(where + ": also sets " + name);
        } else problems.push(where + ": changes a topbar pill under coarse");
      }
    }
  for (const selector of [".v2-pill", ".v2-pill::after"])
    if (!seen.has(selector))
      problems.push(`no ${selector} rule under ${COARSE}`);
  return problems;
}

test("topbar pills keep 28px and get a 44px hit area on a coarse pointer", () => {
  const good = `@media (pointer: coarse) {
  .v2-pill { position: relative; }
  .v2-pill::after { content: ""; position: absolute; inset: 50% auto auto 50%; width: max(100%, var(--touch)); height: var(--touch); translate: -50% -50%; }
}`;
  assert.deepEqual(hitAreaProblems({ "a.css": good }), []);
  for (const [bad, problem] of [
    ["", /no \.v2-pill rule/],
    [good.replace("position: relative; ", ""), /needs position: relative/],
    [
      good.replace(
        "position: relative;",
        "position: relative; height: var(--touch);",
      ),
      /changes height/,
    ],
    [
      good.replace("width: max(100%, var(--touch))", "width: 100%"),
      /not the pill's width, at least --touch/,
    ],
    [
      good.replace("width: max(100%, var(--touch))", "width: 60px"),
      /not the pill's width, at least --touch/,
    ],
    [
      good.replace(" width: max(100%, var(--touch));", ""),
      /not the pill's width, at least --touch/,
    ],
    [
      good.replace("inset: 50% auto auto 50%", "inset: 50% -8px auto"),
      /not placed at the pill's center/,
    ],
    [
      good.replace("height: var(--touch)", "height: 44px"),
      /not var\(--touch\)/,
    ],
    [good.replace("translate: -50% -50%", "translate: 0 -50%"), /not centered/],
    [
      good.replace("translate: -50% -50%;", "translate: -50% -50%; margin: 0;"),
      /also sets margin/,
    ],
    [good.replace('content: ""; ', ""), /no content/],
    [
      good +
        "\n@media (pointer: coarse) { .v2-sync-chip { min-height: var(--touch); } }",
      /changes a topbar pill/,
    ],
  ])
    assert.match(hitAreaProblems({ "a.css": bad }).join("\n"), problem);
  // The real rule files.
  const ruleFiles = v2Names().filter((name) => !TOKEN_FILES.includes(name));
  assert.deepEqual(
    hitAreaProblems(
      Object.fromEntries(ruleFiles.map((name) => [name, v2Css(name)])),
    ),
    [],
  );
});

// The frame (E2, Task 9 carry-forward): .v2-frame contains the topbar's top
// margin (display: flow-root), so the phone band starts at y = 0; the page
// header slot has the fixed --ph-h, and the transition sheet starts at its
// end (146, phones 172) under the content.
function frameProblems(files) {
  const problems = [],
    seen = new Set();
  const expected = {
    ".v2-frame": { display: "flow-root", position: "relative" },
    ".v2-page-slot": { height: "var(--ph-h)" },
  };
  for (const [file, source] of Object.entries(files))
    for (const rule of cssRules(stripComments(source))) {
      const list = declarations(rule.body);
      for (const selector of selectors(rule.header).map(oneSpace)) {
        const where = `${file}: ${selector}`;
        if (selector.endsWith(".v2-frame") && selector !== ".v2-frame")
          for (const { name } of list)
            if (["display", "position"].includes(name))
              problems.push(where + ": changes " + name);
        if (!Object.hasOwn(expected, selector)) continue;
        if (rule.context.length) {
          for (const { name } of list)
            if (Object.hasOwn(expected[selector], name))
              problems.push(where + ": changes " + name + " in a media block");
          continue;
        }
        seen.add(selector);
        for (const [name, want] of Object.entries(expected[selector])) {
          const got = oneSpace(list.find((d) => d.name === name)?.value ?? "");
          if (got !== want)
            problems.push(`${where}: ${name} is "${got}", not "${want}"`);
        }
      }
    }
  for (const selector of Object.keys(expected))
    if (!seen.has(selector)) problems.push("no " + selector + " rule");
  return problems;
}

test("the frame holds the topbar margin", () => {
  const good = `.v2-frame { position: relative; display: flow-root; }
.v2-page-slot { height: var(--ph-h); }`;
  assert.deepEqual(frameProblems({ "a.css": good }), []);
  for (const [bad, problem] of [
    [good.replace(" display: flow-root;", ""), /display is ""/],
    [good.replace("flow-root", "block"), /display is "block"/],
    [
      good + "\n@media (max-width: 739px) { .v2-frame { display: block; } }",
      /changes display in a media block/,
    ],
    [
      good + '\n.v2-shell[data-mode="drawer"] .v2-frame { display: block; }',
      /changes display/,
    ],
    [good.replace("height: var(--ph-h)", "height: auto"), /\.v2-page-slot/],
    [good.replace(/\.v2-page-slot[^}]*}/, ""), /no \.v2-page-slot rule/],
  ])
    assert.match(frameProblems({ "a.css": bad }).join("\n"), problem);
  assert.doesNotMatch(v2Css("shell.css"), /data-sheet/);
  const ruleFiles = v2Names().filter((name) => !TOKEN_FILES.includes(name));
  assert.deepEqual(
    frameProblems(
      Object.fromEntries(ruleFiles.map((name) => [name, v2Css(name)])),
    ),
    [],
  );
});

// --- 6. Style guide -----------------------------------------------------------

function undocumented(names, guide) {
  const start = guide.indexOf("\n## Part 1"),
    end = guide.indexOf("\n## Part 2");
  assert.ok(start >= 0 && end > start, "the guide has Part 1 and Part 2");
  const part1 = guide.slice(start, end);
  return names.filter((name) => !new RegExp("`" + name + "`").test(part1));
}

test("every v2 token is documented in the style guide", () => {
  const guide = readFileSync(
    new URL("../../docs/STYLEGUIDE.md", import.meta.url),
    "utf8",
  );
  assert.deepEqual(undocumented(["--fs-sm"], guide), []);
  assert.deepEqual(undocumented(["--v2-not-documented"], guide), [
    "--v2-not-documented",
  ]);
  // A name in Part 2 only does not count.
  assert.deepEqual(undocumented(["--progress-height"], guide), [
    "--progress-height",
  ]);
  const names = [
    ...new Set(customProperties(v2Css("tokens.css")).map((p) => p.name)),
  ];
  assert.ok(names.length > 100, "tokens.css defines the v2 tokens");
  // The tool page tokens of Phase 5b (section 4) are among them.
  for (const name of [
    "--lh-kpi-compact",
    "--disk-card-min",
    "--tool-status-min",
    "--tool-progress-w",
  ])
    assert.ok(names.includes(name), name + " is defined in tokens.css");
  // And the settings tokens of Phase 5c (section 4, E25).
  for (const name of [
    "--pal-dot",
    "--preview-band-h",
    "--preview-head-h",
    "--save-dock-gap",
  ])
    assert.ok(names.includes(name), name + " is defined in tokens.css");
  assert.deepEqual(undocumented(names, guide), []);
});

// The progress minimum of the tool tables is the progress cell (Phase 5b,
// Task 2; the Task 1 ledger): TOOL_COLUMN_MIN.progress equals
// --tool-progress-w, and toolColumnStyle adds the cell padding to it.
test("the tool tables' progress minimum is the progress cell", () => {
  const { TOOL_COLUMN_MIN } = loadSource("tool-columns.ts", {
    modules: {
      "./filecheck": {},
      "./mux-spec": {},
      "./placement": {},
      "./ui": { ICON: { arrow: 11 } },
    },
  });
  const token = customProperties(v2Css("tokens.css")).find(
    (p) => p.name === "--tool-progress-w",
  );
  assert.ok(token, "tokens.css defines --tool-progress-w");
  assert.equal(token.value, TOOL_COLUMN_MIN.progress + "px");
  // The cell takes the progress at its width; data.css gives the table's
  // minimums and the progress value their defaults (ruling I12).
  const data = v2Css("data.css");
  for (const name of ["--tt-min", "--tt-min-phone", "--v"])
    assert.ok(
      customProperties(data).some((p) => p.name === name),
      name + " has a default in data.css",
    );
});

// --- 7. Built stylesheet ------------------------------------------------------

// Lightning CSS (Vite's minifier) drops the leading layer statement: it
// moves layer blocks into the declared order and emits the still-empty
// layers as a trailing statement. The cascade depends on the order in which
// layer names first appear, so that order is what this guard checks.
function builtLayerProblems(css) {
  const problems = [],
    order = [];
  let depth = 0,
    start = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === "{") {
      if (!depth) {
        const header = oneSpace(css.slice(start, i));
        const m = header.match(/^@layer ([a-z-]+)$/);
        if (m) order.push(m[1]);
        else problems.push("unlayered top-level block: " + header);
      }
      depth++;
    } else if (c === "}") {
      if (!--depth) start = i + 1;
    } else if (c === ";" && !depth) {
      const statement = oneSpace(css.slice(start, i));
      const m = statement.match(/^@layer ([a-z-]+(?: ?, ?[a-z-]+)*)$/);
      if (m) order.push(...m[1].split(",").map((s) => s.trim()));
      else problems.push("unlayered top-level statement: " + statement);
      start = i + 1;
    }
  }
  if (oneSpace(css.slice(start))) problems.push("trailing unlayered CSS");
  const first = [...new Set(order)];
  if (first.join() !== LAYERS.join())
    problems.push("layer order " + first.join(", "));
  return problems;
}

test("the built stylesheet keeps the layer order and layers every rule", async () => {
  const good =
    "@layer legacy{a{color:red}@media (width<=600px){b{color:red}}}@layer tokens{:root{--x:1}}@layer base,shell,recipes,pages,responsive;";
  assert.deepEqual(builtLayerProblems(good), []);
  assert.deepEqual(
    builtLayerProblems(
      "@layer legacy,tokens,base,shell,recipes,pages,responsive;@layer legacy{a{color:red}}",
    ),
    [],
  );
  for (const sample of [
    "a{color:red}" + good,
    good + "a{color:red}",
    "@media print{a{color:red}}" + good,
    "@layer tokens{:root{--x:1}}@layer legacy{a{color:red}}@layer base,shell,recipes,pages,responsive;",
    "@layer legacy{a{color:red}}@layer tokens{:root{--x:1}}",
  ])
    assert.notDeepEqual(builtLayerProblems(sample), [], sample);

  const { build } = await import("vite");
  const result = await build({
    root: fileURLToPath(new URL("../", import.meta.url)),
    logLevel: "silent",
    build: { write: false },
  });
  const output = (Array.isArray(result) ? result : [result]).flatMap(
    (r) => r.output,
  );
  const assets = output.filter(
    (o) => o.type === "asset" && o.fileName.endsWith(".css"),
  );
  assert.equal(assets.length, 1, "one stylesheet");
  const css =
    typeof assets[0].source === "string"
      ? assets[0].source
      : new TextDecoder().decode(assets[0].source);
  assert.deepEqual(builtLayerProblems(css), []);
  // Nested color-mix() formulas reach the bundle unchanged.
  const squashed = css.replace(/\s+/g, "");
  const formulas = customProperties(v2Css("tokens.css")).filter((p) =>
    p.value.includes("color-mix("),
  );
  assert.ok(formulas.length > 30, "tokens.css holds the color formulas");
  for (const { name, value } of formulas)
    assert.ok(
      squashed.includes(name + ":" + value.replace(/\s+/g, "")),
      name + " changed in the bundle",
    );
  // The two Inter files stay hashed assets: linked from the stylesheet only,
  // never inlined and never referenced by a script.
  const fonts = output
    .filter((o) => o.fileName.endsWith(".woff2"))
    .map((o) => o.fileName)
    .sort();
  assert.equal(fonts.length, 2, "two font assets");
  for (const [i, name] of [
    "inter-latin-ext-wght-normal",
    "inter-latin-wght-normal",
  ].entries())
    assert.match(fonts[i], new RegExp(`^assets/${name}-[\\w-]{8}\\.woff2$`));
  const linked = [...css.matchAll(/url\(([^)]*\.woff2)\)/g)].map((m) => m[1]);
  assert.deepEqual(
    linked.sort(),
    fonts.map((f) => "/" + f),
  );
  assert.doesNotMatch(css, /data:font|data:application\/font/);
  for (const chunk of output.filter((o) => o.type === "chunk"))
    assert.doesNotMatch(chunk.code, /\.woff2/, chunk.fileName);
});

// --- 8. Bundled font ----------------------------------------------------------

// Inter is bundled under the family "Inter Variable", which no 1.7.0 stack
// names. One rule activates it: .v2-root on <html> reads --font (layer base),
// and main.tsx preloads the face through the same token before the first
// render.
const FONT_FAMILY = "Inter Variable";
const fontName = /inter\s+variable/gi;
const FONT_FACE = /@font-face\s*\{([^{}]*)\}/g;
const FONT_URL = /^\.\.\/\.\.\/fonts\/[a-z0-9-]+\.woff2$/;

function fontFaceProblems(source) {
  const problems = [];
  const faces = [...stripComments(source).matchAll(FONT_FACE)].map((m) =>
    declarations(m[1]),
  );
  if (faces.length !== 2)
    problems.push(`expected two @font-face rules, found ${faces.length}`);
  const urls = [];
  faces.forEach((face, i) => {
    const where = "@font-face " + (i + 1);
    const value = (name) =>
      face
        .filter((d) => d.name === name)
        .map((d) => oneSpace(d.value))
        .join(" | ");
    if (value("font-family") !== `"${FONT_FAMILY}"`)
      problems.push(where + ": font-family " + value("font-family"));
    if (value("font-display") !== "swap")
      problems.push(where + ": font-display " + value("font-display"));
    if (value("font-weight") !== "100 900")
      problems.push(where + ": font-weight " + value("font-weight"));
    if (!value("unicode-range")) problems.push(where + ": no unicode-range");
    const found = [...value("src").matchAll(/url\(\s*([^)]*?)\s*\)/g)].map(
      (m) => m[1].replace(/^(["'])(.*)\1$/, "$2"),
    );
    if (!found.length) problems.push(where + ": no url() in src");
    for (const url of found)
      if (!FONT_URL.test(url)) problems.push(where + ": url " + url);
    urls.push(...found);
  });
  if (new Set(urls).size !== urls.length)
    problems.push("two @font-face rules load the same file");
  return problems;
}

// files: { name: css }. Only v2/fonts.css may hold @font-face rules; outside
// them the family name may appear only in the value of --font, and only in
// v2/tokens.css.
const FONT_TOKEN_FILE = "v2/tokens.css";
function fontUseProblems(files) {
  const problems = [];
  for (const [file, source] of Object.entries(files)) {
    let css = stripComments(source);
    if (file === "v2/fonts.css") css = css.replace(FONT_FACE, "");
    let inDeclarations = 0;
    for (const rule of cssRules(css))
      for (const { name, value } of declarations(rule.body)) {
        const count = (value.match(fontName) || []).length;
        inDeclarations += count;
        if (count && !(file === FONT_TOKEN_FILE && name === "--font"))
          problems.push(`${file}: ${oneSpace(rule.header)} ${name}`);
      }
    // Anything else (a selector, an at-rule header, a stray @font-face).
    if ((css.match(fontName) || []).length > inDeclarations)
      problems.push(file + ": names " + FONT_FAMILY + " outside --font");
  }
  return problems;
}

// files: { name: css } of v2 files. Exactly one font-family declaration reads
// --font: on .v2-root in v2/base.css, outside any at-rule. .v2-root sets no
// font size, so 1.7.0 sizes stay as they are. html: index.html, whose <html>
// carries the class.
const ROOT_FONT = { file: "v2/base.css", header: ".v2-root" };
function fontActivationProblems(files, html) {
  const problems = [],
    reads = [];
  for (const [file, source] of Object.entries(files))
    for (const rule of cssRules(stripComments(source))) {
      const header = oneSpace(rule.header);
      for (const { name, value } of declarations(rule.body)) {
        const property = name.toLowerCase();
        if (property === "font-family" && /var\(\s*--font(?![\w-])/.test(value))
          reads.push({ file, header, context: rule.context, value });
        if (
          header === ROOT_FONT.header &&
          (property === "font-size" || property === "font")
        )
          problems.push(`${file}: ${header} sets ${property}`);
      }
    }
  if (reads.length !== 1)
    problems.push(
      `expected one font-family: var(--font), found ${reads.length}`,
    );
  for (const { file, header, context, value } of reads)
    if (
      file !== ROOT_FONT.file ||
      header !== ROOT_FONT.header ||
      context.length ||
      oneSpace(value) !== "var(--font)"
    )
      problems.push(
        `${file}: ${[...context.map(oneSpace), header].join(" ")} font-family: ${oneSpace(value)}`,
      );
  const tag = html.match(/<html\b[^>]*>/i)?.[0] ?? "";
  const classes = tag.match(/\sclass\s*=\s*"([^"]*)"/i)?.[1] ?? "";
  if (!classes.split(/\s+/).includes("v2-root"))
    problems.push("index.html: <html> without class v2-root");
  return problems;
}

test("the bundled font is used only through --font", () => {
  const face = (url, family = '"Inter Variable"', display = "swap") =>
    `@font-face { font-family: ${family}; font-style: normal; font-weight: 100 900; font-display: ${display}; src: url(${url}) format("woff2"); unicode-range: U+0000-00FF; }`;
  const good = face("../../fonts/a.woff2") + face('"../../fonts/b.woff2"');
  assert.deepEqual(fontFaceProblems(good), []);
  for (const [sample, problem] of [
    [face("../../fonts/a.woff2"), /expected two @font-face rules, found 1/],
    [good + face("../../fonts/c.woff2"), /found 3/],
    [
      face("../../fonts/a.woff2", '"Inter"') + face("../../fonts/b.woff2"),
      /@font-face 1: font-family "Inter"/,
    ],
    [
      face("../../fonts/a.woff2", "Inter Variable") +
        face("../../fonts/b.woff2"),
      /font-family Inter Variable/,
    ],
    [
      face("../../fonts/a.woff2") +
        face("../../fonts/b.woff2", undefined, "block"),
      /@font-face 2: font-display block/,
    ],
    [
      face("../../fonts/a.woff2") + face("/fonts/b.woff2"),
      /@font-face 2: url \/fonts\/b\.woff2/,
    ],
    [
      face("../../fonts/a.woff2") + face("../../fonts/b.woff"),
      /url \.\.\/\.\.\/fonts\/b\.woff$/m,
    ],
    [
      face("../../fonts/a.woff2") + face("data:font/woff2;base64,AAAA"),
      /url data:font/,
    ],
    [
      face("../../fonts/a.woff2") + face("../../fonts/a.woff2"),
      /the same file/,
    ],
    [
      good.replace("font-weight: 100 900;", "font-weight: 400;"),
      /font-weight 400/,
    ],
    [good.replace("unicode-range: U+0000-00FF;", ""), /no unicode-range/],
  ])
    assert.match(fontFaceProblems(sample).join("\n"), problem);

  const tokens = ':root { --font: "Inter Variable", sans-serif; }';
  assert.deepEqual(
    fontUseProblems({ "v2/fonts.css": good, "v2/tokens.css": tokens }),
    [],
  );
  for (const [files, problem] of [
    [
      { "base.css": '.a { font-family: "Inter Variable"; }' },
      /base\.css: \.a font-family/,
    ],
    [
      { "base.css": ".a { font: 14px inter variable; }" },
      /base\.css: \.a font$/m,
    ],
    [{ "base.css": ':root { --ui-font: "Inter Variable"; }' }, /--ui-font/],
    // --font may name the family only in v2/tokens.css.
    [
      { "base.css": ':root { --font: "Inter Variable", sans-serif; }' },
      /^base\.css: :root --font$/m,
    ],
    [
      { "v2/shell.css": '.v2-x { --font: "Inter Variable"; }' },
      /^v2\/shell\.css: \.v2-x --font$/m,
    ],
    [{ "base.css": good }, /base\.css: names Inter Variable outside --font/],
    [
      { "v2/tokens.css": '@supports (font-family: "Inter Variable") {}' },
      /names Inter Variable outside --font/,
    ],
  ])
    assert.match(fontUseProblems(files).join("\n"), problem);

  // The real files.
  assert.ok(v2Names().includes("fonts.css"), "styles/v2/fonts.css exists");
  const fonts = v2Css("fonts.css");
  assert.deepEqual(fontFaceProblems(fonts), []);
  for (const [, url] of fonts.matchAll(/url\(\s*["']?([^)"']+)/g))
    assert.ok(
      existsSync(new URL(url, srcUrl("styles/v2/fonts.css"))),
      url + " exists",
    );
  const font = customProperties(v2Css("tokens.css")).filter(
    (p) => p.name === "--font",
  );
  assert.equal(font.length, 1, "tokens.css defines --font once");
  assert.match(font[0].value, /^"Inter Variable",/, "--font names the font");
  const files = Object.fromEntries([
    ...LEGACY_STYLESHEETS.map((name) => [name, legacyCss(name)]),
    ...v2Names().map((name) => ["v2/" + name, v2Css(name)]),
  ]);
  assert.deepEqual(fontUseProblems(files), []);
  // No inline style in TS/TSX names the family either.
  assert.doesNotMatch(sources, /inter\s+variable/i);

  // Activation: one rule on <html>, in layer base.
  const root = ".v2-root { font-family: var(--font); font-synthesis: none; }";
  const page = '<!doctype html>\n<html lang="en" class="v2-root">';
  assert.deepEqual(fontActivationProblems({ "v2/base.css": root }, page), []);
  assert.deepEqual(
    fontActivationProblems(
      { "v2/base.css": root, "v2/shell.css": ".v2-x { font: inherit; }" },
      '<html class="a  v2-root" lang="en">',
    ),
    [],
  );
  // A token that only starts with --font is not a read of --font.
  assert.deepEqual(
    fontActivationProblems(
      {
        "v2/base.css": root,
        "v2/shell.css":
          ".v2-x { font-family: var(--font-sm); } .v2-y { font-family: var(--font_x, serif); }",
      },
      page,
    ),
    [],
  );
  for (const [sample, html, problem] of [
    [{}, page, /expected one font-family: var\(--font\), found 0/],
    [
      { "v2/base.css": ".v2-root { font-family: var(--font-sm); }" },
      page,
      /found 0/,
    ],
    [
      {
        "v2/base.css": root,
        "v2/shell.css": ".v2-x { font-family: var(--font); }",
      },
      page,
      /found 2[\s\S]*v2\/shell\.css: \.v2-x font-family/,
    ],
    [
      { "v2/shell.css": ".v2-root { font-family: var(--font); }" },
      page,
      /^v2\/shell\.css: \.v2-root font-family: var\(--font\)$/m,
    ],
    [
      { "v2/base.css": ".v2-shell { font-family: var(--font); }" },
      page,
      /v2\/base\.css: \.v2-shell font-family/,
    ],
    [
      {
        "v2/base.css":
          "@media (max-width: 739px) { .v2-root { font-family: var(--font); } }",
      },
      page,
      /@media \(max-width: 739px\) \.v2-root font-family/,
    ],
    [
      { "v2/base.css": ".v2-root { font-family: var(--font), serif; }" },
      page,
      /font-family: var\(--font\), serif/,
    ],
    [
      {
        "v2/base.css":
          ".v2-root { font-family: var(--font); font-size: var(--fs-base); }",
      },
      page,
      /v2\/base\.css: \.v2-root sets font-size/,
    ],
    [
      {
        "v2/base.css":
          ".v2-root { font-family: var(--font); font: var(--w-reg) var(--fs-base) var(--font); }",
      },
      page,
      /\.v2-root sets font$/m,
    ],
    [{ "v2/base.css": root }, '<html lang="en">', /<html> without class/],
    [
      { "v2/base.css": root },
      '<html lang="en" class="v2-root-x">',
      /<html> without class/,
    ],
    [
      { "v2/base.css": root },
      '<html lang="en"><body class="v2-root">',
      /<html> without class/,
    ],
  ])
    assert.match(
      fontActivationProblems(sample, html).join("\n"),
      problem,
      JSON.stringify(sample),
    );

  // The real files: v2/base.css loads into layer(base); the preload in
  // main.tsx reads the family from --font instead of naming it.
  assert.match(
    read("style.css"),
    /^@import "\.\/styles\/v2\/base\.css" layer\(base\);$/m,
  );
  assert.deepEqual(
    fontActivationProblems(
      Object.fromEntries(v2Names().map((name) => ["v2/" + name, v2Css(name)])),
      readFileSync(new URL("../index.html", import.meta.url), "utf8"),
    ),
    [],
  );
  const main = read("main.tsx").replace(/\s+/g, " ");
  assert.match(main, /function fontsReady\(timeout = 1000\): Promise<void> \{/);
  assert.match(main, /document\.fonts\.load\(/);
  assert.match(main, /getPropertyValue\("--font"\)/);
  // The first render waits for the face: the one render() call runs in the
  // .then of Promise.all over the locale and fontsReady().
  assert.equal(main.match(/\brender\(/g)?.length, 1, "one render() call");
  assert.equal(main.match(/\bfontsReady\(\)/g)?.length, 1, "one fontsReady()");
  assert.match(
    main,
    /Promise\.all\(\[ ?loadLocale\(initialLocale\(\)\)[^;]*?, fontsReady\(\),? ?\]\)\.then\(\(\[catalog\]\) => \{ prepareLocale\(catalog\); render\(/,
    "render() waits for Promise.all([locale, fontsReady()])",
  );
});

// --- 9. Retired 1.7.0 sign-in -------------------------------------------------

// Task 15 rebuilt sign-in, setup and the loading screen in v2 (Part 1, 11.5):
// login.css is no 1.7.0 sheet any more, and no 1.7.0 rule or rendered class
// of the old screens is left (.login-*, .brand, .loading-screen).
const RETIRED_LOGIN = /\.(?:login-[\w-]+|brand|loading-screen[\w-]*)(?![\w-])/;
const RETIRED_LOGIN_CLASSES = [
  "login-page",
  "login-art",
  "login-orbit",
  "login-form",
  "login-version",
  "brand",
  "loading-screen",
];

// The string literals and template parts of TS/TSX source, as class lists.
function sourceStrings(path, code) {
  const strings = [];
  const visit = (node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    )
      strings.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(
    ts.createSourceFile(
      path,
      code,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    ),
  );
  return strings;
}

function retiredLoginProblems(sheets, sources) {
  const problems = [];
  for (const [file, css] of Object.entries(sheets))
    for (const rule of cssRules(css))
      for (const selector of selectors(rule.header))
        if (RETIRED_LOGIN.test(selector))
          problems.push(`${file}: ${oneSpace(selector)}`);
  for (const [path, code] of Object.entries(sources))
    for (const string of sourceStrings(path, code))
      for (const name of string.split(/\s+/))
        if (RETIRED_LOGIN_CLASSES.includes(name))
          problems.push(`${path} renders the class ${name}`);
  return problems;
}

test("1.7.0 login rules are gone", () => {
  // The guard sees each form of the old rules and classes.
  for (const [css, source] of [
    [".login-page { display: grid; }", ""],
    ["@media (max-width: 740px) { .brand img { width: 0; } }", ""],
    [".loading-screen img { width: 0; }", ""],
    ["", 'const x = <main class="login-page" />;'],
    ["", 'const x = <div class="brand" />;'],
    ["", "const x = <div class={`loading-screen ${y}`} />;"],
  ])
    assert.notDeepEqual(
      retiredLoginProblems({ "x.css": css }, { "x.tsx": source }),
      [],
      css || source,
    );
  assert.deepEqual(
    retiredLoginProblems(
      { "x.css": ".v2-brand-home { gap: 0; } .language-select { gap: 0; }" },
      {
        "x.tsx":
          '// the brand\'s link\nconst x = <a class="v2-brand-home" title="Scopearr home" />;',
      },
    ),
    [],
  );

  assert.ok(!LEGACY_STYLESHEETS.includes("login.css"), "login.css is listed");
  assert.ok(!existsSync(srcUrl("styles/login.css")), "login.css exists");
  assert.doesNotMatch(read("style.css"), /login\.css/);
  const sources = Object.fromEntries(
    readdirSync(srcUrl(""), { recursive: true })
      .map((path) => path.split(sep).join("/"))
      .filter((path) => /\.tsx?$/.test(path))
      .map((path) => [path, read(path)]),
  );
  assert.ok(Object.keys(sources).length > 100, "reads the sources");
  assert.deepEqual(
    retiredLoginProblems(
      Object.fromEntries(
        LEGACY_STYLESHEETS.map((name) => [name, legacyCss(name)]),
      ),
      sources,
    ),
    [],
  );
});

// --- 10. Tables beside the 1.7.0 table rules (Phase 5a, task 6) ---------------

const v2Data = v2Css("data.css");
// A value as plain data.
const plainData = (value) => JSON.parse(JSON.stringify(value ?? null));
// The properties each selector of a CSS text declares, outside any at-rule.
function declared(css) {
  const out = new Map();
  for (const rule of cssRules(css)) {
    if (rule.context.length) continue;
    for (const selector of selectors(rule.header)) {
      const names = out.get(selector) ?? new Set();
      for (const { name } of declarations(rule.body)) names.add(name);
      out.set(selector, names);
    }
  }
  return out;
}

// The global 1.7.0 rules that reach every table, in any 1.7.0 sheet and any
// context (responsive.css narrows the padding and the minimum width), and
// per v2 table the selectors that must set each of their properties.
// While 1.7.0 tables use these rules, a v2 table sets its own value for
// every property they set, so a property added to them later fails here.
const LEGACY_TABLE_RULES = [
  "table",
  "th",
  "td",
  "tbody tr:hover:not(.season-row)",
];
const SHARED_TABLE = ":is(.v2-table, .v2-trk-table)";
const TABLE_SHIELDS = {
  ".v2-table": {
    table: [".v2-table", SHARED_TABLE],
    th: [".v2-table th", SHARED_TABLE + " th"],
    td: [".v2-table td", SHARED_TABLE + " td"],
    "tbody tr:hover:not(.season-row)": [".v2-table > tbody > tr"],
  },
  ".v2-trk-table": {
    table: [".v2-trk-table", SHARED_TABLE],
    th: [".v2-trk-table th", SHARED_TABLE + " th"],
    td: [".v2-trk-table td", SHARED_TABLE + " td"],
    "tbody tr:hover:not(.season-row)": [".v2-trk-table tr"],
  },
};
// A declared property covers itself and its longhands (border covers
// border-top, border-block covers border-top and border-bottom).
const covers = (declared, name) =>
  declared === name ||
  name.startsWith(declared + "-") ||
  (declared === "border-block" &&
    ["border-top", "border-bottom"].some(
      (side) => name === side || name.startsWith(side + "-"),
    ));
function tableShieldProblems(legacyText, v2Text) {
  const legacy = new Map(LEGACY_TABLE_RULES.map((rule) => [rule, new Set()]));
  for (const rule of cssRules(stripComments(legacyText)))
    for (const selector of selectors(rule.header).map(oneSpace))
      if (legacy.has(selector))
        for (const { name } of declarations(rule.body))
          legacy.get(selector).add(name);
  const v2 = declared(v2Text);
  const problems = [];
  for (const [table, shields] of Object.entries(TABLE_SHIELDS))
    for (const [rule, own] of Object.entries(shields)) {
      const set = own.flatMap((selector) => [...(v2.get(selector) ?? [])]);
      for (const name of legacy.get(rule))
        if (!set.some((property) => covers(property, name)))
          problems.push(`${table}: the 1.7.0 rule ${rule} sets ${name}`);
    }
  return problems;
}

test("the v2 tables set what the 1.7.0 table rules would leak into them", () => {
  const legacySample = `table { min-width: 780px; border-spacing: 0; }
th { background: red; padding: 4px; }
@media (max-width: 740px) { th, td { padding: 2px; } }
td { border-top: 1px solid red; }
tbody tr:hover:not(.season-row) { background: blue; }`;
  const v2Sample = `:is(.v2-table, .v2-trk-table) { min-width: 0; border-spacing: 0; }
:is(.v2-table, .v2-trk-table) td { border-top: 0; }
.v2-table th { padding: 0; background: var(--thead); }
.v2-table td { padding: 0; }
.v2-table > tbody > tr { background: var(--panel); }
.v2-trk-table th { padding: 0; background: transparent; }
.v2-trk-table td { border: 0; padding: 0; }
.v2-trk-table tr { background: transparent; }`;
  assert.deepEqual(tableShieldProblems(legacySample, v2Sample), []);
  // A property the 1.7.0 rules gain later, one only in a media query, and
  // a v2 rule that loses a property each fail.
  assert.deepEqual(
    tableShieldProblems(
      legacySample + "\nth { vertical-align: top; }",
      v2Sample,
    ),
    [
      ".v2-table: the 1.7.0 rule th sets vertical-align",
      ".v2-trk-table: the 1.7.0 rule th sets vertical-align",
    ],
  );
  assert.deepEqual(
    tableShieldProblems(
      legacySample + "\n@media (max-width: 740px) { td { color: red; } }",
      v2Sample,
    ),
    [
      ".v2-table: the 1.7.0 rule td sets color",
      ".v2-trk-table: the 1.7.0 rule td sets color",
    ],
  );
  assert.deepEqual(
    tableShieldProblems(
      legacySample,
      v2Sample.replace(".v2-trk-table tr { background: transparent; }", ""),
    ),
    [
      ".v2-trk-table: the 1.7.0 rule tbody tr:hover:not(.season-row) sets background",
    ],
  );
  // The real files: the global 1.7.0 rules still exist (the tools, the
  // rules and the log use them), and both v2 tables shield every property.
  const legacy = declared(legacyCss("library.css"));
  for (const rule of LEGACY_TABLE_RULES)
    assert.ok(legacy.get(rule)?.size, "the 1.7.0 rule " + rule + " exists");
  assert.deepEqual(tableShieldProblems(legacyCssText, v2Data), []);
  // The card rows of a narrow card are a grid.
  const narrow = cssRules(v2Data).filter((rule) =>
    rule.context.includes("@container (max-width: 560px)"),
  );
  const rows = narrow.find((rule) =>
    selectors(rule.header).includes(".v2-table > tbody > tr"),
  );
  assert.ok(rows, "the 560 block places the body rows");
  assert.ok(
    declarations(rows.body).some(
      ({ name, value }) => name === "display" && value === "grid",
    ),
  );
  // A number's label prefix stays out of the cell's accessible text (the
  // column header names it), and without the Info column the title takes
  // the whole first line, so no other cell moves up into it (the browser
  // check measures both).
  const narrowRule = (selector) =>
    narrow.find((rule) => selectors(rule.header).includes(selector));
  assert.deepEqual(
    plainData(
      declarations(narrowRule("td.v2-table-num::before").body).find(
        ({ name }) => name === "content",
      ),
    ),
    { name: "content", value: 'attr(data-label) / ""' },
  );
  assert.ok(
    declarations(
      narrowRule(".v2-table tr:not(:has(> .v2-table-info)) > td.v2-table-title")
        .body,
    ).some(({ name, value }) => name === "grid-column-end" && value === "-1"),
  );
  // A selection box gets a 44 hit area; a custom tag's auto mark gets one
  // that starts at the mark and runs right, so it stays clear of the edit
  // button before the tag and of its hit area (the browser check measures
  // both).
  const touch = cssRules(v2Data).filter((rule) =>
    rule.context.includes("@media (pointer: coarse)"),
  );
  const hit = (selector) =>
    touch.filter((rule) => selectors(rule.header).includes(selector));
  assert.equal(hit(".v2-table-hit::after").length, 1);
  const [auto] = hit(".v2-ctag-auto::after");
  assert.deepEqual(selectors(auto.header), [".v2-ctag-auto::after"]);
  assert.deepEqual(
    plainData(declarations(auto.body).map(({ name, value }) => [name, value])),
    [
      ["content", '""'],
      ["position", "absolute"],
      ["inset", "50% auto auto 0"],
      ["width", "var(--touch)"],
      ["height", "var(--touch)"],
      ["translate", "0 -50%"],
    ],
  );
});

// --- 11. The filter drawer (Phase 5a, task 7) -----------------------------------

// The drawer overlays the page: only the open dialog has a box (before
// showModal() the dialog renders nothing), it is fixed on the right and a
// full sheet on phones, its head and foot keep their height while the body
// scrolls in place (stable gutter, no scroll chaining), so neither a list
// that opens nor a count that changes moves anything, and Apply fills the
// foot, wrapping a long count inside its fixed height. On touch its fields
// and values grow to 44. The browser check measures these.
test("the filter drawer keeps its place and its geometry", () => {
  const rules = cssRules(v2Data);
  const ruleOf = (selector, context = []) => {
    const found = rules.filter(
      (rule) =>
        selectors(rule.header).map(oneSpace).includes(selector) &&
        rule.context.map(oneSpace).join() === context.join(),
    );
    assert.equal(found.length, 1, selector + " " + context);
    return plainData(
      declarations(found[0].body).map(({ name, value }) => [
        name,
        oneSpace(value),
      ]),
    );
  };
  const has = (selector, expected, context) => {
    const own = ruleOf(selector, context);
    for (const pair of expected)
      assert.ok(
        own.some(([name, value]) => name === pair[0] && value === pair[1]),
        `${selector} ${context ?? ""}: ${pair.join(": ")}`,
      );
  };
  // No rule gives the closed dialog a box or a place.
  for (const rule of rules)
    for (const selector of selectors(rule.header).map(oneSpace))
      if (/\.v2-drawer(?![\w-])(?!\[open\])(?!::backdrop)/.test(selector))
        assert.deepEqual(
          plainData(
            declarations(rule.body)
              .map(({ name }) => name)
              .filter((name) =>
                ["display", "position", "inset", "width", "height"].includes(
                  name,
                ),
              ),
          ),
          [],
          selector,
        );
  has(".v2-drawer[open]", [
    ["position", "fixed"],
    ["inset", "var(--edge) var(--edge) var(--edge) auto"],
    ["display", "flex"],
    ["flex-direction", "column"],
    ["width", "min(var(--drawer-w), calc(100% - 2 * var(--edge)))"],
    ["max-width", "none"],
    ["height", "auto"],
    ["max-height", "none"],
    ["margin", "0"],
    ["padding", "0"],
    ["overflow", "hidden"],
    ["border-radius", "var(--r-lg)"],
    ["box-shadow", "var(--shadow-float)"],
  ]);
  has(".v2-drawer::backdrop", [["background", "var(--scrim-light)"]]);
  has(
    ".v2-drawer[open]",
    [
      ["inset", "0"],
      ["width", "100%"],
      ["border-radius", "0"],
    ],
    ["@media (max-width: 739px)"],
  );
  for (const part of [".v2-drawer-head", ".v2-drawer-foot"])
    has(part, [
      ["display", "flex"],
      ["flex", "none"],
    ]);
  has(".v2-drawer-body", [
    ["flex", "1"],
    ["min-height", "0"],
    ["overflow", "auto"],
    ["overscroll-behavior", "contain"],
    ["scrollbar-gutter", "stable"],
  ]);
  has(".v2-drawer-foot > .v2-btn--primary", [
    ["flex", "1"],
    ["min-width", "0"],
    ["white-space", "normal"],
  ]);
  // The values and a state field's box are labels: the 1.7.0 label rule
  // (display: flex; flex-direction: column) would stack box and text.
  for (const label of [".v2-ff-opt", ".v2-ff-check"])
    has(label, [["flex-direction", "row"]]);
  has(
    ":is(.v2-ff-op, .v2-ff-value, .v2-ff-opt)",
    [["height", "var(--touch)"]],
    ["@media (pointer: coarse)"],
  );
  has(".v2-ff-op", [["width", "var(--touch)"]], ["@media (pointer: coarse)"]);
  // A state field's label is its target: at least 44 high on touch.
  has(
    ".v2-ff-check",
    [["min-height", "var(--touch)"]],
    ["@media (pointer: coarse)"],
  );
});

// --- 12. Library page tools --------------------------------------------------

// A count tool's slot holds its number and, hidden, the largest number it
// can show in one grid cell (docs/STYLEGUIDE.md, Part 1, 10.10), so a count
// change never moves a tool; the setup notice wraps its action below its
// text when it is narrow; a pressed page tool reads as on.
test("count slots keep their width and the page tools their states", () => {
  const rulesOf = (css, selector) =>
    cssRules(css)
      .filter(
        (rule) =>
          !rule.context.length &&
          selectors(rule.header).map(oneSpace).includes(selector),
      )
      .flatMap((rule) =>
        plainData(
          declarations(rule.body).map(({ name, value }) => [
            name,
            oneSpace(value),
          ]),
        ),
      );
  const recipes = v2Css("recipes.css");
  assert.deepEqual(rulesOf(recipes, ".v2-count-num"), [["grid-area", "1 / 1"]]);
  assert.deepEqual(rulesOf(recipes, ".v2-count-max"), [
    ["grid-area", "1 / 1"],
    ["visibility", "hidden"],
  ]);
  assert.ok(
    rulesOf(recipes, ".v2-count").some(
      ([name, value]) => name === "display" && value === "inline-grid",
    ),
    "the count is a grid",
  );
  assert.deepEqual(rulesOf(recipes, ".v2-notice--setup").slice(0, 2), [
    ["display", "flex"],
    ["flex-wrap", "wrap"],
  ]);
  assert.deepEqual(
    rulesOf(recipes, '.v2-icon-btn:is(:disabled, [aria-disabled="true"])'),
    [
      ["opacity", "0.42"],
      ["cursor", "default"],
    ],
  );
  // A pressed page tool (All columns) reads as on, as an open icon button
  // does; the state lives with its family in recipes.css (5a final review
  // M4), and the reveal toggle keeps its look (its eye shows the state).
  assert.deepEqual(
    rulesOf(
      recipes,
      '.v2-icon-btn:is( [aria-haspopup][aria-expanded="true"], [aria-pressed="true"]:not(.v2-reveal) )',
    ),
    [
      ["background", "var(--tint)"],
      ["color", "var(--accent-ink)"],
    ],
  );
  assert.equal(
    cssRules(v2Data).filter((rule) => rule.header.includes("aria-pressed"))
      .length,
    0,
    "no icon button state in data.css",
  );
  // Below 1060 a tool's label is visually hidden, not removed: it stays in
  // the tool's name, which is what the tool shows (Task 9, WCAG 2.5.3).
  const narrow = cssRules(v2Data).filter(
    (rule) =>
      selectors(rule.header).map(oneSpace).includes(".v2-tc-label") &&
      rule.context.map(oneSpace).join() === "@container (max-width: 1060px)",
  );
  assert.equal(narrow.length, 1);
  const hidden = plainData(
    declarations(narrow[0].body).map(({ name, value }) => [
      name,
      oneSpace(value),
    ]),
  );
  for (const pair of [
    ["position", "absolute"],
    ["width", "1px"],
    ["height", "1px"],
    ["overflow", "hidden"],
    ["clip-path", "inset(50%)"],
  ])
    assert.ok(
      hidden.some(([name, value]) => name === pair[0] && value === pair[1]),
      ".v2-tc-label @container (max-width: 1060px): " + pair.join(": "),
    );
  assert.ok(
    !hidden.some(([name]) => name === "display" || name === "visibility"),
    "the narrow label stays in the accessibility tree",
  );
});

// --- 13. Dashboard cards ------------------------------------------------------

// The dashboard's cards have their height before their data and keep it
// (docs/STYLEGUIDE.md, Part 1, 10.2, 10.10 and 11.3): a KPI card is at least
// --kpi-min, a distribution body holds five rows and the More row, a row is
// --dist-row-h, the ring's place is as high as the ring (the hint too), a
// widget head is 44 on touch with or without its buttons, and the grid
// keeps each card's own height, so More grows only its card.
test("the dashboard's cards reserve their height", () => {
  const v2Pages = v2Css("pages.css");
  const ruleOf = (css, selector, context = []) => {
    const found = cssRules(css).filter(
      (rule) =>
        selectors(rule.header).map(oneSpace).includes(selector) &&
        rule.context.map(oneSpace).join() === context.join(),
    );
    assert.equal(found.length, 1, selector + " " + context);
    return plainData(
      declarations(found[0].body).map(({ name, value }) => [
        name,
        oneSpace(value),
      ]),
    );
  };
  const has = (css, selector, expected, context) => {
    const own = ruleOf(css, selector, context);
    for (const pair of expected)
      assert.ok(
        own.some(([name, value]) => name === pair[0] && value === pair[1]),
        `${selector} ${context ?? ""}: ${pair.join(": ")}`,
      );
  };
  has(v2Data, ".v2-kpi", [["min-height", "var(--kpi-min)"]]);
  has(v2Data, ".v2-dist-body", [["min-height", "var(--dist-body-min)"]]);
  has(v2Data, ".v2-dist-row", [["height", "var(--dist-row-h)"]]);
  has(v2Data, ".v2-ring", [["min-height", "var(--ring-size)"]]);
  has(v2Data, ".v2-ring-chart", [
    ["width", "var(--ring-size)"],
    ["height", "var(--ring-size)"],
    ["flex", "none"],
  ]);
  has(
    v2Data,
    ".v2-widget-head",
    [["min-height", "var(--touch)"]],
    ["@media (pointer: coarse)"],
  );
  has(v2Pages, ".v2-dash-grid", [["align-items", "start"]]);
  // Placeholders and data share every sized property: no rule sizes a
  // card by a state.
  for (const css of [v2Data, v2Pages])
    for (const rule of cssRules(css))
      for (const selector of selectors(rule.header).map(oneSpace))
        if (/\.v2-(?:kpi|widget|ring|dist|match|dash)/.test(selector))
          assert.doesNotMatch(
            selector,
            /\[aria-busy|:empty|--loading|--placeholder/,
            selector,
          );
});

// The rules behind the blocks (docs/STYLEGUIDE.md, Part 1, 10.2, 10.3,
// 10.7 and 10.10): the status tag is exactly what the column measurement
// adds to its text (Phase 5b, task 2: 2 × --dot-sm + 2 × --sp-2); dots
// and the hidden label never take width; the rows keep one height.
test("the tool blocks keep their measured and fixed sizes", () => {
  // The declarations of the one rule with exactly this selector.
  const rule = (file, selector, context = []) => {
    const found = cssRules(v2Css(file)).filter(
      (r) =>
        selectors(r.header).map(oneSpace).includes(selector) &&
        r.context.map(oneSpace).join() === context.join(),
    );
    assert.equal(found.length, 1, file + " " + selector + " " + context);
    return Object.fromEntries(
      declarations(found[0].body).map(({ name, value }) => [
        name,
        oneSpace(value),
      ]),
    );
  };
  const st = rule("data.css", ".v2-st");
  assert.equal(st.padding, "0 var(--sp-2)");
  assert.equal(st.gap, "var(--dot-sm)");
  assert.equal(st.height, "var(--tag-h)");
  assert.equal(st["white-space"], "nowrap");
  assert.equal(st.border, undefined);
  const dot = rule("data.css", ".v2-st-dot");
  assert.equal(dot.width, "var(--dot-sm)");
  const stButton = rule("data.css", ".v2-st-btn");
  assert.equal(stButton.padding, "0");
  assert.equal(stButton.border, "0");
  assert.equal(rule("data.css", ".v2-st > .v2-dot").position, "absolute");
  assert.equal(rule("recipes.css", ".v2-btn > .v2-dot").position, "absolute");
  const alt = rule("recipes.css", ".v2-btn-alt");
  assert.equal(alt.visibility, "hidden");
  assert.equal(
    rule("recipes.css", ".v2-btn:has(> .v2-btn-alt) > span")["grid-area"],
    "1 / 2",
  );
  const ready = rule("recipes.css", ".v2-btn.v2-btn--ready");
  assert.match(
    ready["box-shadow"],
    /^inset 0 0 0 var\(--outline-w\) var\(--accent\), var\(--shadow-btn\)$/,
  );
  assert.equal(
    ready.outline,
    undefined,
    "a ring inside, the focus ring stays outside",
  );
  const progress = rule("data.css", ".v2-progress-bar > span");
  assert.equal(progress.width, "calc(var(--v, 0) * 1%)");
  assert.deepEqual(
    rule("data.css", ".v2-disk-bar > span"),
    progress,
    "the usage bar fills alike",
  );
  assert.equal(
    rule("data.css", ".v2-progress").width,
    "var(--tool-progress-w)",
  );
  const compact = rule("data.css", ".v2-kpi--compact");
  assert.equal(compact.height, "var(--stat-h)");
  assert.equal(compact["min-height"], "0");
  const phone = rule("data.css", ".v2-kpi--compact", [
    "@media (max-width: 739px)",
  ]);
  assert.equal(
    phone["flex-direction"],
    "row",
    "on phones the tile stays beside the text",
  );
  const value = rule("data.css", ".v2-kpi--compact .v2-kpi-value");
  assert.equal(value["font-size"], "var(--fs-2xl)");
  assert.equal(value["line-height"], "var(--lh-kpi-compact)");
  const row = rule("data.css", ".v2-disks");
  assert.equal(row["grid-auto-flow"], "column");
  assert.equal(row["grid-auto-columns"], "minmax(var(--disk-card-min), 1fr)");
  assert.equal(rule("data.css", ".v2-disk").height, "var(--stat-h)");
  // While it overflows the row fades out at its end like the chips row,
  // its end padding and scroll padding as wide as the fade, and a swipe at
  // its end stays in it.
  const overflowing = rule("data.css", ".v2-disks[data-overflow]");
  assert.equal(overflowing["overflow-x"], "auto");
  assert.equal(overflowing["overscroll-behavior-x"], "contain");
  assert.equal(overflowing["padding-inline-end"], "var(--sp-6)");
  assert.equal(overflowing["scroll-padding-inline-end"], "var(--sp-6)");
  assert.equal(
    overflowing["mask-image"],
    rule("data.css", ".v2-chips-group")["mask-image"],
  );
  assert.equal(rule("data.css", ".v2-disks")["scrollbar-width"], "none");
  // The status button and "+n" reach 44 on touch without growing.
  const coarse = ["@media (pointer: coarse)"];
  const hit = rule("data.css", ".v2-row-btn::after", coarse);
  for (const selector of [".v2-st-btn::after", ".v2-tag--more::after"])
    assert.deepEqual(rule("data.css", selector, coarse), hit, selector);
  assert.equal(hit.height, "var(--touch)");
  for (const selector of [".v2-st-btn", ".v2-tag--more"])
    assert.equal(rule("data.css", selector).position, "relative", selector);
  // Forced colors keep the fills, the dots and the disk tags' difference.
  const forced = ["@media (forced-colors: active)"];
  for (const [file, selector] of [
    ["data.css", ".v2-progress-bar > span"],
    ["data.css", ".v2-disk-bar > span"],
    ["data.css", ".v2-st-dot"],
    ["recipes.css", ".v2-dot--warn"],
  ]) {
    const own = rule(file, selector, forced);
    assert.equal(own["forced-color-adjust"], "none", selector);
    assert.equal(own.background, "CanvasText", selector);
  }
  for (const selector of [".v2-progress-bar", ".v2-disk-bar"])
    assert.equal(
      rule("data.css", selector, forced).outline,
      "1px solid CanvasText",
      selector,
    );
  assert.equal(
    rule("data.css", ".v2-tag--disk", forced).outline,
    "1px solid CanvasText",
  );
  assert.equal(
    rule("data.css", ".v2-tag--disk-src", forced).outline,
    "1px dashed CanvasText",
  );
});

// Phase 5b, task 5 (docs/STYLEGUIDE.md, Part 1, 10.3, 10.8 and 10.10): the
// tool table lays out fixed from its colgroup, at least --tt-min wide
// (--tt-min-phone at ≤ 739, none as card rows); a row button for desktops
// or phones hides on the other; a removing action hovers in the danger
// button's tone; a removed row fades; a pending empty state keeps its
// height, invisible.
// Task 11 review (fix wave): the toasts' links (Show in log, Open Muxing,
// the 1.7.0 text-button until Phase 5d) and their dismiss button take the
// v2 focus ring of base.css, whose rule reaches only v2 classes.
test("the toasts' buttons take the v2 focus ring", () => {
  const ring = (name) =>
    Object.fromEntries(
      cssRules(v2Css(name))
        .filter(
          (r) => !r.context.length && selectors(r.header).map(oneSpace).length,
        )
        .flatMap((r) =>
          selectors(r.header)
            .map(oneSpace)
            .map((selector) => [
              selector,
              Object.fromEntries(
                declarations(r.body).map(({ name: n, value }) => [
                  n,
                  oneSpace(value),
                ]),
              ),
            ]),
        ),
    );
  const base = ring("base.css")['.v2-root [class*="v2-"]:focus-visible'];
  const toasts = ring("shell.css")[".v2-toasts :focus-visible"];
  assert.ok(toasts, "a ring for the toasts");
  assert.deepEqual(
    [toasts.outline, toasts["outline-offset"]],
    [base.outline, base["outline-offset"]],
  );
});

test("the tool table keeps its fixed layout, its states and its buttons", () => {
  const rule = (selector, context = []) => {
    const found = cssRules(v2Css("data.css")).filter(
      (r) =>
        selectors(r.header).map(oneSpace).includes(selector) &&
        r.context.map(oneSpace).join() === context.join(),
    );
    assert.equal(found.length, 1, selector + " " + context);
    return Object.fromEntries(
      declarations(found[0].body).map(({ name, value }) => [
        name,
        oneSpace(value),
      ]),
    );
  };
  const phone = ["@media (max-width: 739px)"];
  const cards = ["@container (max-width: 560px)"];
  const fixed = rule(".v2-table--fixed");
  assert.equal(fixed["table-layout"], "fixed");
  assert.equal(fixed["min-width"], "var(--tt-min)");
  assert.equal(fixed["--tt-min"], "0");
  assert.equal(fixed["--tt-min-phone"], "0");
  assert.equal(
    rule(".v2-table--fixed", phone)["min-width"],
    "var(--tt-min-phone)",
  );
  assert.equal(rule(".v2-table--fixed", cards)["min-width"], "0");
  // The title column has no width of its own: it takes the rest.
  assert.equal(rule(".v2-table--fixed .v2-table-title").width, "auto");
  // F-I2 (fix wave): a plain cell clips with an ellipsis, as 1.7.0 did; a
  // disk tag gives way in its cell with an ellipsis.
  const clip = rule(".v2-table-clip");
  assert.deepEqual(
    [clip.overflow, clip["text-overflow"]],
    ["hidden", "ellipsis"],
  );
  const disk = rule(".v2-tag[data-disk]");
  assert.deepEqual(
    [
      disk["min-width"],
      disk["max-width"],
      disk.overflow,
      disk["text-overflow"],
    ],
    ["0", "100%", "hidden", "ellipsis"],
  );
  assert.equal(rule(".v2-row-btn--phone").display, "none");
  assert.equal(rule(".v2-row-btn--phone", phone).display, "inline-grid");
  assert.equal(rule(".v2-row-btn--desk", phone).display, "none");
  assert.equal(rule(".v2-row-btn").display, "inline-grid");
  const danger = rule(".v2-row-btn--danger:not(:disabled):hover");
  assert.equal(
    danger.color,
    "color-mix(in oklab, var(--status-error) 80%, var(--text))",
  );
  assert.equal(
    danger.background,
    "color-mix(in oklab, var(--status-error) 10%, var(--panel))",
  );
  assert.equal(
    danger["box-shadow"],
    "inset 0 0 0 1px color-mix(in oklab, var(--status-error) 40%, var(--line)), var(--shadow-btn)",
  );
  const removing = rule(".v2-table > tbody > .v2-row--removing");
  assert.equal(removing.opacity, "0");
  assert.equal(removing.transition, "opacity var(--t-fast)");
  assert.equal(rule(".v2-empty--pending").visibility, "hidden");
  // As card rows the cols lay nothing out (Task 5 review).
  assert.equal(rule(".v2-table--fixed > colgroup", cards).display, "none");
  // The selection cell domToolMetrics measures (ruling M15): the first
  // cell's padding, the box and its right padding, larger on touch; the
  // box's 44 hit area ends inside the measured column.
  const coarse = ["@media (pointer: coarse)"];
  assert.equal(
    rule(".v2-table tr > :first-child")["padding-left"],
    "var(--sp-5)",
  );
  assert.equal(rule(".v2-check").width, "var(--check)");
  assert.equal(rule(".v2-check", coarse).width, "var(--check-touch)");
  assert.equal(rule(".v2-table .v2-table-sel")["padding-right"], "var(--sp-1)");
  assert.equal(
    rule(".v2-table .v2-table-sel", coarse)["padding-right"],
    "var(--sp-3)",
  );
  assert.equal(
    rule(".v2-table-hit::after", coarse).width,
    "max(100%, var(--touch))",
  );
  const root = Object.fromEntries(
    customProperties(v2Css("tokens.css")).map((p) => [p.name, p.value]),
  );
  const token = (name) => Number.parseFloat(root[name]);
  const touchColumn =
    token("--sp-5") + token("--check-touch") + token("--sp-3");
  assert.ok(
    token("--sp-5") + token("--check-touch") / 2 + token("--touch") / 2 <=
      touchColumn,
    "the hit area ends inside the column: " + touchColumn,
  );
  assert.ok(
    token("--sp-5") + token("--check") + token("--sp-1") <=
      token("--select-col"),
  );
});

// Services (docs/STYLEGUIDE.md, Part 1, 10.11 and 11.4, Task 4 fix round
// 1): a Status value keeps one line, its long text cut with an ellipsis
// (ruling P4); the head drops the switch divider wherever it can wrap the
// switch to its own line; the page layout of Services lives in pages.css
// (R-H), not with the building blocks.
test("services keep their status on one line and their layout in pages.css", () => {
  const rules = (file, selector, context = []) =>
    cssRules(v2Css(file)).filter(
      (r) =>
        selectors(r.header).map(oneSpace).includes(selector) &&
        r.context.map(oneSpace).join() === context.join(),
    );
  const rule = (file, selector, context = []) => {
    const found = rules(file, selector, context);
    assert.equal(found.length, 1, file + " " + selector + " " + context);
    return Object.fromEntries(
      declarations(found[0].body).map(({ name, value }) => [
        name,
        oneSpace(value),
      ]),
    );
  };
  const line = rule("recipes.css", ".v2-kv-line");
  assert.equal(line.display, "flex");
  assert.equal(line["flex-wrap"], undefined);
  assert.equal(line["min-width"], "0");
  const long = rule("recipes.css", ".v2-kv-long");
  assert.equal(long["white-space"], "nowrap");
  assert.equal(long.overflow, "hidden");
  assert.equal(long["text-overflow"], "ellipsis");
  assert.equal(long["min-width"], "0");
  // Download / Update share one cell without an icon column (10.3).
  assert.equal(
    rule("recipes.css", ".v2-btn:has(> .v2-btn-alt):not(:has(> svg)) > span")[
      "grid-area"
    ],
    "1 / 1",
  );
  const narrow = rule("settings.css", ".v2-svc-switch", [
    "@media (max-width: 1119px)",
  ]);
  assert.equal(narrow["box-shadow"], "none");
  assert.equal(narrow["padding-left"], "0");
  for (const selector of [
    ".v2-svc-sync",
    ".v2-svc-sync > h2",
    ".v2-svc-sync .v2-input",
    ".v2-svc-bar",
    ".v2-svc-bar > .v2-seg",
  ]) {
    assert.equal(rules("pages.css", selector).length, 1, selector);
    assert.equal(
      cssRules(v2Css("settings.css")).filter((r) =>
        selectors(r.header).map(oneSpace).includes(selector),
      ).length,
      0,
      selector + " is page layout",
    );
  }
  assert.equal(
    rule("pages.css", ".v2-svc-bar > .v2-seg")["margin-right"],
    "auto",
  );
});

// Phase 5c fix wave: a palette preview head keeps one line (T6-M2), the
// color tables' control columns one width (T6-M7), a rule's pattern its
// own token (T8-M5), a status line that is an error the error tone (T5-M2)
// and Tag rules' heads the middle of the head row in card rows (T9).
test("the settings fix wave keeps its rules", () => {
  const rule = (file, selector, context = []) => {
    const found = cssRules(v2Css(file)).filter(
      (r) =>
        selectors(r.header).map(oneSpace).includes(selector) &&
        r.context.map(oneSpace).join() === context.join(),
    );
    assert.equal(found.length, 1, file + " " + selector + " " + context);
    return Object.fromEntries(
      declarations(found[0].body).map(({ name, value }) => [
        name,
        oneSpace(value),
      ]),
    );
  };
  const head = rule("settings.css", ".v2-pal-prev-row:first-child > *");
  assert.equal(head["white-space"], "nowrap");
  assert.equal(head.overflow, "hidden");
  assert.equal(head["text-overflow"], "ellipsis");
  assert.equal(head["min-width"], "0");
  assert.equal(
    rule("settings.css", ".v2-pal-prev-row", ["@media (max-width: 739px)"])[
      "grid-template-columns"
    ],
    "minmax(0, 1.4fr) repeat(2, minmax(0, 1fr))",
  );
  const colors = rule(
    "pages.css",
    ".v2-set-colors > * > tr > :not(:first-child)",
  );
  assert.equal(colors.width, "var(--tool-status-min)");
  assert.equal(colors["min-width"], "var(--tool-status-min)");
  const cards = rule("pages.css", ".v2-set-colors > * > tr > :nth-child(n)", [
    "@container (max-width: 560px)",
  ]);
  assert.deepEqual([cards.width, cards["min-width"]], ["auto", "0"]);
  assert.equal(
    rule("pages.css", ".v2-set-pattern")["max-width"],
    "var(--rule-pattern-w)",
  );
  assert.equal(
    rule("pages.css", ".v2-set-rules > * > tr > :nth-child(7)").width,
    "calc(var(--rule-pattern-w) + 2 * var(--sp-2))",
  );
  assert.match(
    rule("recipes.css", ".v2-kv-long--error").color,
    /var\(--status-error\)/,
  );
  assert.equal(
    rule("pages.css", ".v2-set-rules > thead th", [
      "@container (max-width: 560px)",
    ]).display,
    "flex",
  );
});
