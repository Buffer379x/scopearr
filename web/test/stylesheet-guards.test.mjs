import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
import { themePalettes } from "../src/themes.ts";

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
const v2Names = () => readdirSync(srcUrl("styles/v2/")).sort();
const v2Css = (name) => read("styles/v2/" + name);

// The 9 palette keys and 5 status tokens: v2 reads them, never defines them.
const paletteKeys = Object.keys(themePalettes.nord.dark).map((k) => "--" + k);
const statusKeys = [
  ...new Set(legacyCss("base.css").match(/--status-[a-z]+/g)),
].sort();
const sharedKeys = new Set([...paletteKeys, ...statusKeys]);

// --- 1. Layer order in style.css -------------------------------------------

function layerProblems(styleCss, files) {
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

  const files_ = v2Names();
  assert.ok(files_.includes("tokens.css"), "styles/v2/tokens.css exists");
  assert.deepEqual(layerProblems(read("style.css"), files_), []);
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
// (`"--tool-col-" + column`). var() reads in TS/TSX count as names too.
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
// phase that reads a v2 token from TSX adds it here on purpose.
const V2_TSX_READS = [];
const V2_TSX_PREFIXES = [];
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
  assert.ok(prefixes.includes("--tool-col-"), "reads TSX prefixes");
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
    ":root { --tool-col-title: 0; }",
  ])
    assert.notDeepEqual(
      nameProblems(props(sample), taken, prefixes),
      [],
      sample,
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
  // The real run excludes exactly the listed v2 reads; today there are none,
  // so every new exclusion is a deliberate change of this list.
  assert.deepEqual(legacyNames(legacyCssText, sources, v2Defined).excluded, {
    tokens: V2_TSX_READS,
    prefixes: V2_TSX_PREFIXES,
  });
  assert.deepEqual(withV2.excluded, {
    tokens: [...V2_TSX_READS, "--fs-sm", "--sp-4"].sort(),
    prefixes: [...V2_TSX_PREFIXES, "--chart-"].sort(),
  });
  // The real run keeps every name 1.7.0 CSS defines and the TSX names.
  for (const name of [...legacyDefined, "--dialog-viewport-top"])
    assert.ok(legacyTokens.has(name), name);
  assert.ok(legacyPrefixes.includes("--tool-col-"), "the TSX prefixes");
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
    if (!TOKEN_SELECTORS.includes(selector))
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
@media (max-width: 739px) { :root { --a: 2px; } }
@media (pointer: coarse) { :root { --e: 56px; } }`;
  assert.deepEqual(tokenFileProblems(good), []);
  for (const sample of [
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
      '[data-theme="dark"] { --a: var(--x, var(--tool-col-title)); }',
      /reads the 1\.7\.0 token --tool-col-title/,
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
    [".v2-x { width: var(--tool-col-title); }", /token --tool-col-title/],
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
  assert.deepEqual(undocumented(names, guide), []);
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
// names, so the browser never loads it. Phase 4 activates it through --font.
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

test("the bundled font is declared but unused", () => {
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
});
