// Writes web/src/language-core.json: the registry rows with an ISO 639-1
// code plus the special codes mis, mul, und and zxx, in registry order. The
// interface bundles this core and loads the full registry only on demand.
// Run after changing internal/langdata/registry.json:
//   node web/scripts/language-core.mjs
import { readFileSync, writeFileSync } from "node:fs";

const special = new Set(["mis", "mul", "und", "zxx"]);
const registry = JSON.parse(
  readFileSync(
    new URL("../../internal/langdata/registry.json", import.meta.url),
    "utf8",
  ),
);
const core = registry.filter(([id, iso1]) => iso1 || special.has(id));
writeFileSync(
  new URL("../src/language-core.json", import.meta.url),
  "[\n" + core.map((row) => JSON.stringify(row)).join(",\n") + "\n]\n",
);
console.log(`language-core.json: ${core.length} of ${registry.length} rows`);
