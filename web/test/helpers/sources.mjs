import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const url = (path) => new URL("../../src/" + path, import.meta.url);

export const src = (path) => readFileSync(url(path), "utf8");

// Joins several source files so a negative assertion covers all of them.
export function readSources(paths) {
  for (const path of paths) assert.ok(existsSync(url(path)), path);
  return paths.map(src).join("\n");
}

// Slice from the first `from` to the next `to`; both must be found.
export function between(code, from, to) {
  const start = code.indexOf(from);
  assert.ok(start >= 0, from);
  const end = code.indexOf(to, start);
  assert.ok(end > start, to);
  return code.slice(start, end);
}
