import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { sep } from "node:path";

const url = (path) => new URL("../../src/" + path, import.meta.url);

export const src = (path) => readFileSync(url(path), "utf8");

// Joins several source files so a negative assertion covers all of them.
export function readSources(paths) {
  assert.ok(paths.length > 0, "readSources needs at least one path");
  for (const path of paths) assert.ok(existsSync(url(path)), path);
  return paths.map(src).join("\n");
}

// Every .ts/.tsx file under web/src, so a removal is checked everywhere. The
// walk is recursive; the root, components/ and hooks/ must each be found.
export function allSources() {
  const paths = readdirSync(url(""), { recursive: true })
    .map((path) => path.split(sep).join("/"))
    .filter((path) => /\.tsx?$/.test(path))
    .sort();
  assert.ok(paths.length > 0, "allSources found no sources");
  for (const folder of [/^[^/]+$/, /^components\/[^/]+$/, /^hooks\/[^/]+$/])
    assert.ok(
      paths.some((path) => folder.test(path)),
      "allSources misses " + folder,
    );
  return readSources(paths);
}

// Folds every whitespace run into one space, so a source check does not
// depend on how Prettier wraps a line. Patterns use \s* where a wrap can add
// or drop a space (after "(", "[", "{", before ")", "]", "}") and ,? where it
// adds a trailing comma.
export const squash = (code) => code.replace(/\s+/g, " ");

// Slice from the first `from` to the next `to`; both must be found.
export function between(code, from, to) {
  const start = code.indexOf(from);
  assert.ok(start >= 0, from);
  const end = code.indexOf(to, start);
  assert.ok(end > start, to);
  return code.slice(start, end);
}

// Library.tsx, the files its app shell code moved into, the library page's
// own parts (Phase 5a) and the frame (every file in components/frame/).
export const appShellSources = () =>
  readSources([
    "components/Library.tsx",
    "components/AppShell.tsx",
    "components/AppDataProvider.tsx",
    "hooks/useAppNavigation.ts",
    "hooks/useLibraryState.ts",
    "components/LibraryPage.tsx",
    "components/library/SelectionTools.tsx",
    "components/library/InstanceSegment.tsx",
    "hooks/useMuxSelection.ts",
    ...readdirSync(url("components/frame"))
      .filter((name) => /\.tsx?$/.test(name))
      .sort()
      .map((name) => "components/frame/" + name),
  ]);
