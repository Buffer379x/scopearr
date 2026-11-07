// Writes the language core the interface bundles; it loads the full registry
// only on demand. Run after changing internal/langdata/registry.json:
//   node web/scripts/language-core.mjs
// - web/src/language-core.json: the registry rows with an ISO 639-1 code plus
//   the special codes mis, mul, und and zxx, in registry order.
// - web/src/language-core-regional.json: the registry keys that the core
//   finds only through its regional fallback, and as another language than
//   the full registry names ("oji-cree": core oji, registry ojs). These keys
//   load the registry; every other regional tag stays a core answer.
import { readFileSync, writeFileSync } from "node:fs";

const special = new Set(["mis", "mul", "und", "zxx"]);
const registry = JSON.parse(
  readFileSync(
    new URL("../../internal/langdata/registry.json", import.meta.url),
    "utf8",
  ),
);
const core = registry.filter(([id, iso1]) => iso1 || special.has(id));

// The lookup of languages.ts: aliases (first row wins), then codes.
function index(rows) {
  const byAlias = new Map();
  for (const [id, , , canonical, codes, aliases] of rows)
    for (const alias of [canonical, ...codes, ...aliases]) {
      const key = alias.trim().toLowerCase();
      if (!byAlias.has(key)) byAlias.set(key, id);
    }
  for (const [id, , , , codes] of rows)
    for (const code of codes) byAlias.set(code, id);
  return byAlias;
}
const regional =
  /^([a-z]{2,3})[-_](?:[a-z]{2}|[0-9]{3}|[a-z]{4})(?:[-_][a-z0-9]{5,8})*$/i;
const full = index(registry);
const coreIndex = index(core);
const differing = [...full.keys()]
  .filter((key) => !coreIndex.has(key))
  .filter((key) => {
    const fallback = coreIndex.get(regional.exec(key)?.[1]);
    return fallback && fallback !== full.get(key);
  })
  .sort();

const lines = (items) =>
  "[\n" + items.map((item) => JSON.stringify(item)).join(",\n") + "\n]\n";
writeFileSync(
  new URL("../src/language-core.json", import.meta.url),
  lines(core),
);
writeFileSync(
  new URL("../src/language-core-regional.json", import.meta.url),
  lines(differing),
);
console.log(
  `language-core.json: ${core.length} of ${registry.length} rows; ` +
    `language-core-regional.json: ${differing.length} keys`,
);
