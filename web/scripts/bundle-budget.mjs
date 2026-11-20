// The 2.0.0 bundle budgets (Phase 6.2; docs/STYLEGUIDE.md, Part 1, 13).
// Run after `build`:
//   node web/scripts/bundle-budget.mjs [dist directory]
// The default directory is web/dist. Prints the measured sets and exits 1
// when one is over its budget. Sizes are raw bytes of the minified chunks,
// the CSS gzip -9; locale catalogs (de, en, es, it) never count.
// - start: the entry chunk and every chunk it imports statically (what
//   index.html loads before the first render).
// - Library: the Library chunk (the frame and the library page) with every
//   chunk it imports statically, beyond the start set.
// - each other page: its chunk with every chunk it imports statically,
//   beyond the start set and the Library set (every page opens in the
//   frame, so both are there before it).
// - all: every JS chunk without the locale catalogs (the language registry,
//   which only loads for the language pickers, included).
// Budgets are the 2.0.0 measurements plus a small margin; raise one only
// with a reason in the release's plan.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

export const BUDGETS = {
  start: 54_000,
  Library: 204_000,
  SettingsPage: 108_000,
  RecognitionPage: 121_000,
  MuxPage: 50_500,
  DiskPlacementPage: 67_000,
  FileCheckPage: 51_500,
  all: 1_035_000,
  cssGzip: 23_500,
};

const LOCALE = /^(de|en|es|it)-[\w-]+\.js$/;

// The chunks a chunk imports statically (minified `import"./x.js"` and
// `from"./x.js"`), not its dynamic import() targets.
export function staticImports(code) {
  const out = new Set();
  for (const m of code.matchAll(
    /(?:\bfrom|\bimport)\s*["']\.\/([^"']+\.js)["']/g,
  ))
    out.add(m[1]);
  return [...out];
}

// Measures a dist directory: { start, pages: {name: bytes}, all, cssGzip }.
export function measure(dist) {
  const assets = join(dist, "assets");
  const files = readdirSync(assets);
  const code = new Map(
    files
      .filter((f) => f.endsWith(".js"))
      .map((f) => [f, readFileSync(join(assets, f), "utf8")]),
  );
  const size = (f) => Buffer.byteLength(code.get(f));
  const closure = (roots) => {
    const seen = new Set();
    const walk = (f) => {
      if (seen.has(f) || !code.has(f)) return;
      seen.add(f);
      for (const next of staticImports(code.get(f))) walk(next);
    };
    roots.forEach(walk);
    return seen;
  };
  const sum = (set) =>
    [...set].filter((f) => !LOCALE.test(f)).reduce((n, f) => n + size(f), 0);
  const html = readFileSync(join(dist, "index.html"), "utf8");
  const entry = html.match(/<script[^>]+src="\/assets\/([^"]+\.js)"/)?.[1];
  if (!entry || !code.has(entry))
    throw new Error("No entry chunk in index.html");
  const start = closure([entry]);
  const chunkOf = (name) =>
    files.find((f) => f.startsWith(name + "-") && f.endsWith(".js"));
  const library = chunkOf("Library")
    ? closure([chunkOf("Library")])
    : new Set();
  const pages = {};
  for (const name of Object.keys(BUDGETS)) {
    const chunk = chunkOf(name);
    if (!chunk) continue;
    const before = name === "Library" ? start : new Set([...start, ...library]);
    pages[name] = sum(
      new Set([...closure([chunk])].filter((f) => !before.has(f))),
    );
  }
  const all = sum(new Set(code.keys()));
  const cssGzip = files
    .filter((f) => f.endsWith(".css"))
    .reduce(
      (n, f) =>
        n + gzipSync(readFileSync(join(assets, f)), { level: 9 }).length,
      0,
    );
  return {
    start: sum(start),
    pages,
    all,
    cssGzip,
    startChunks: [...start].filter((f) => !LOCALE.test(f)),
  };
}

// The lines over budget, empty when all fit.
export function overBudget(measured, budgets = BUDGETS) {
  const rows = [
    ["start", measured.start],
    ...Object.entries(measured.pages),
    ["all", measured.all],
    ["cssGzip", measured.cssGzip],
  ];
  const missing = Object.keys(budgets).filter(
    (k) => !rows.some(([name]) => name === k),
  );
  return [
    ...missing.map((k) => `${k}: no chunk found`),
    ...rows
      .filter(([name, bytes]) => bytes > budgets[name])
      .map(([name, bytes]) => `${name}: ${bytes} B > ${budgets[name]} B`),
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist =
    process.argv[2] ?? fileURLToPath(new URL("../dist", import.meta.url));
  const m = measure(dist);
  const show = (name, bytes) =>
    console.log(
      `${name.padEnd(18)} ${String(bytes).padStart(9)} / ${BUDGETS[name]}`,
    );
  show("start", m.start);
  console.log(`  (${m.startChunks.join(" + ")})`);
  for (const [name, bytes] of Object.entries(m.pages)) show(name, bytes);
  show("all", m.all);
  show("cssGzip", m.cssGzip);
  const over = overBudget(m);
  if (over.length) {
    console.error("Over budget:\n  " + over.join("\n  "));
    process.exit(1);
  }
  console.log("Bundle budgets: ok");
}
