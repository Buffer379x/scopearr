import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { translate } from "../src/i18n-core.ts";
import {
  toolTableStyle,
  toolColumn,
  openJobCount,
  muxOpenJobs,
} from "../src/tool-table.ts";
import {
  readNavigation,
  readSessionPreference,
  writeSessionPreference,
} from "../src/browser-storage.ts";
const src = (path) =>
  readFileSync(new URL("../src/" + path, import.meta.url), "utf8");
test("plural selection handles zero, one and two and preserves legacy fallback", () => {
  const en = JSON.parse(src("locales/en.json"));
  for (const locale of ["en", "de"]) {
    const c = JSON.parse(src("locales/" + locale + ".json"));
    for (const n of [0, 1, 2]) {
      const expected =
        locale === "de"
          ? n === 1
            ? "Datei"
            : "Dateien"
          : n === 1
            ? "file"
            : "files";
      assert.equal(
        translate(c, en, "{count} files", { count: n }),
        n + " " + expected,
      );
    }
    assert.equal(
      translate(c, en, "{count} files", { count: 1234 }).startsWith(
        new Intl.NumberFormat(locale).format(1234),
      ),
      true,
    );
  }
  assert.equal(
    translate(
      { locale: "de", name: "DE", messages: { legacy: "{count} alt" } },
      en,
      "legacy",
      { count: 1 },
    ),
    "1 alt",
  );
});
test("open tools count only explicit pending, running and actionable failure states", () => {
  const jobs = [
    "draft",
    "ready",
    "queued",
    "running",
    "succeeded",
    "failed",
    "cancelled",
    "needs_attention",
    "needs_review",
    "future",
  ].map((status) => ({ status }));
  assert.equal(muxOpenJobs(jobs), 7);
  assert.equal(openJobCount({ pending: 3, running: 1, failed: 3 }), 7);
  assert.equal(openJobCount(undefined), 0);
  assert.equal(
    openJobCount({ pending: 2 }) + openJobCount({ running: 1, failed: 2 }),
    5,
  );
});
test("column geometry depends on column choices and keeps mobile details accessible", () => {
  const cols = ["select", "actions", "title", "status", "remove"];
  assert.equal(toolTableStyle(cols, "placement")["--table-min"], "536px");
  assert.equal(
    toolTableStyle(cols, "placement")["--table-min-mobile"],
    "464px",
  );
  assert.equal(toolColumn("filename", "mux"), "title");
  assert.equal(toolColumn("actions", "mux"), "remove");
  for (const component of ["DiskPlacementPage", "FileCheckPage", "MuxTable"]) {
    const code = src("components/" + component + ".tsx");
    assert.match(code, /<colgroup>/);
    assert.match(code, /toolTableStyle/);
    assert.match(code, /tool-table/);
  }
  const css = src("styles/placement.css");
  assert.match(css, /\.tool-table\s*\{[^}]*table-layout: fixed/);
  assert.match(
    css,
    /\.tool-table td\s*\{[^}]*height: var\(--tool-row-height\)/,
  );
  assert.match(
    css,
    /\.col-remove \.icon-button\s*\{[^}]*height: var\(--control-sm\)/,
  );
});
test("interface recipes apply appwide, including settings, without override stylesheets", () => {
  for (const name of ["improvements", "interface-v2", "presentation"])
    assert.equal(
      existsSync(new URL("../src/styles/" + name + ".css", import.meta.url)),
      false,
    );
  for (const path of readdirSync(
    new URL("../src/components/", import.meta.url),
  ).filter((x) => x.endsWith(".tsx")))
    assert.doesNotMatch(src("components/" + path), /size=\{\d+\}/, path);
  const css = src("styles/base.css");
  assert.match(
    css,
    /input\[type="checkbox"\],\s*input\[type="radio"\]\s*\{[^}]*width: var\(--checkbox\)[^}]*flex: 0 0 var\(--checkbox\)/,
  );
  assert.match(
    src("styles/settings-and-filters.css"),
    /\.key-values > div\s*\{[^}]*grid-template-columns:/,
  );
  const allCSS = readdirSync(new URL("../src/styles/", import.meta.url))
    .map((name) => src("styles/" + name))
    .join("\n");
  assert.doesNotMatch(allCSS, /mux-status-/);
  assert.doesNotMatch(allCSS, /font-weight:\s*(550|570)/);
  assert.doesNotMatch(allCSS, /font-size:\s*(?:8|9|14|16|17|19|20|21|24)px/);
});
test("navigation survives auth remounts and blocked session storage remains optional", () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  try {
    const values = new Map();
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: {
        getItem: (key) => values.get(key) || null,
        setItem: (key, value) => values.set(key, value),
      },
    });
    writeSessionPreference(
      "scopearr-navigation",
      JSON.stringify({
        view: "disks",
        service: "radarr",
        page: 3,
        filters: { radarr: "instance=radarr-4k", sonarr: "" },
      }),
    );
    assert.equal(readNavigation().view, "disks");
    assert.equal(readNavigation().page, 3);
    assert.equal(readNavigation().filters.radarr, "instance=radarr-4k");
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get() {
        throw Error("blocked");
      },
    });
    assert.equal(readSessionPreference("scopearr-navigation"), null);
    assert.doesNotThrow(() => writeSessionPreference("key", "value"));
    assert.equal(readNavigation().view, "statistics");
  } finally {
    if (before) Object.defineProperty(globalThis, "sessionStorage", before);
    else delete globalThis.sessionStorage;
  }
});

test("dynamic column and toast classes keep their styles", () => {
  const css = src("styles/placement.css");
  for (const field of [
    "select",
    "service",
    "size",
    "disks",
    "target",
    "move",
    "kind",
    "status",
    "progress",
    "remove",
    "path",
    "current",
    "fix",
  ])
    assert.ok(css.includes(".tool-col-" + field), field);
  const base = src("styles/base.css");
  assert.match(base, /\.toast-error\s*\{[^}]*var\(--status-error\)/);
  assert.match(base, /\.toast-warning\s*\{[^}]*var\(--status-warn\)/);
});
