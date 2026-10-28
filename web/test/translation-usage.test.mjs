import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
const root = fileURLToPath(new URL("../../", import.meta.url));
const walk = (dir) =>
  readdirSync(root + dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(dir + "/" + entry.name)
      : [dir + "/" + entry.name],
  );
// These messages are composed in production rather than passed as full literals.
// Keep the list explicit so new unused keys cannot hide behind broad patterns.
const dynamic = new Map([
  ...[
    "Jellyfin endpoint is not allowed",
    "Invalid Jellyfin address",
    "Jellyfin did not provide a complete page count",
    "Jellyfin library changed during sync; sync again",
    "Incomplete Jellyfin page",
    "Jellyfin pages contain missing or duplicate IDs",
    "Jellyfin enrichment failed: ",
  ].map((key) => [
    key,
    "emby.go and sync.go substitute the media-server label for the shared Emby client",
  ]),
  ...[
    "At least 850 MB of free Appdata space is required",
    "At least 150 MB of free Appdata space is required",
    "Could not activate MKVToolNix",
    "MKVToolNix self-test failed",
    "MediaInfo self-test failed",
  ].map((key) => [
    key,
    "tool_package.go formats the tool label or its minimum free-space value",
  ]),
  ...["Radarr", "Sonarr"].flatMap((service) => [
    ...["queued", "started"].map((state) => [
      `Waiting for ${service} rescan (${state})`,
      "mux_arr.go and webhooks.go compose the service and command state",
    ]),
    [
      `${service} did not finish the rescan within 5 minutes. The new file is in place.`,
      "mux_arr.go composes the service-specific timeout",
    ],
    [
      `File renamed. ${service} has not finished the rescan yet; the library updates afterwards.`,
      "file_rename.go composes the service-specific refresh warning",
    ],
  ]),
]);
test("every English translation key is used by production source or a documented dynamic message", () => {
  const literals = new Set();
  const files = [
    ...walk("web/src").filter((p) => /\.tsx?$/.test(p)),
    ...walk("internal").filter(
      (p) => p.endsWith(".go") && !p.endsWith("_test.go"),
    ),
    ...walk("cmd").filter((p) => p.endsWith(".go")),
  ];
  for (const file of files) {
    const source = readFileSync(root + file, "utf8");
    if (/\.tsx?$/.test(file)) {
      const sf = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node) => {
        if (
          ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node)
        )
          literals.add(node.text);
        ts.forEachChild(node, visit);
      };
      visit(sf);
    } else {
      for (const [literal] of source.matchAll(/"(?:[^"\\]|\\.)*"|`[^`]*`/g)) {
        try {
          literals.add(
            literal.startsWith("`")
              ? literal.slice(1, -1)
              : JSON.parse(literal),
          );
        } catch {
          /* Go-only escapes cannot form catalog keys. */
        }
      }
    }
  }
  const messages = JSON.parse(
    readFileSync(root + "web/src/locales/en.json", "utf8"),
  ).messages;
  const unused = Object.keys(messages).filter(
    (key) =>
      !literals.has(key) &&
      !literals.has(key.replace(/\|(one|other)$/, "")) &&
      !dynamic.has(key),
  );
  assert.deepEqual(unused, [], "Remove unused keys from all four catalogs");
  for (const [key, reason] of dynamic) {
    assert.ok(reason.length > 20, key);
    assert.ok(
      Object.hasOwn(messages, key),
      "Remove obsolete dynamic allowance: " + key,
    );
  }
});
