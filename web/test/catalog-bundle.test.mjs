import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "vite";

test("the production startup import graph excludes unselected message catalogs", async () => {
  const result = await build({
    root: fileURLToPath(new URL("../", import.meta.url)),
    logLevel: "silent",
    build: { write: false },
  });
  const chunks = new Map(
    result.output
      .filter((entry) => entry.type === "chunk")
      .map((chunk) => [chunk.fileName, chunk]),
  );
  const entry = [...chunks.values()].find((chunk) => chunk.isEntry);
  const visited = new Set();
  const visit = (chunk) => {
    if (visited.has(chunk.fileName)) return;
    visited.add(chunk.fileName);
    for (const name of chunk.imports)
      if (chunks.has(name)) visit(chunks.get(name));
  };
  visit(entry);
  const startupModules = [...visited].flatMap((name) =>
    Object.keys(chunks.get(name).modules),
  );
  for (const locale of ["de", "es", "it"]) {
    assert.ok(
      !startupModules.some((id) => id.endsWith(`/locales/${locale}.json`)),
      `${locale} messages must be lazy`,
    );
    assert.ok(
      [...chunks.values()].some((chunk) =>
        Object.keys(chunk.modules).some((id) =>
          id.endsWith(`/locales/${locale}.json`),
        ),
      ),
      `${locale} catalog must remain available`,
    );
  }
  assert.ok(
    startupModules.some((id) => id.endsWith("/locales/en.json")),
    "English fallback remains eager",
  );
});
