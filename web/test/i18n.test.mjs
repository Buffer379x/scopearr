import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { translate, resolveLocale } from "../src/i18n-core.ts";
import { audioLanguage, sameAudioLanguage } from "../src/languages.ts";
import {
  makeDashboardFilter,
  dashboardService,
} from "../src/dashboard-filter.ts";
const root = fileURLToPath(new URL("../src/", import.meta.url));
const catalogs = readdirSync(root + "locales")
  .filter((p) => p.endsWith(".json"))
  .map((p) => JSON.parse(readFileSync(root + "locales/" + p, "utf8")));
const english = catalogs.find((c) => c.locale === "en");
const slots = (text) =>
  [...text.matchAll(/\{[A-Za-z][\w]*\}|%[ds]/g)].map((m) => m[0]).sort();
test("all four shipped catalogs have identical keys and preserve parameters", () => {
  for (const required of ["de", "en", "es", "it"])
    assert.ok(catalogs.some((c) => c.locale === required));
  const ids = catalogs.map((c) => c.locale);
  assert.equal(new Set(ids).size, ids.length);
  for (const catalog of catalogs) {
    assert.ok(/^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$/.test(catalog.locale));
    assert.ok(catalog.name.trim());
  }
  for (const catalog of catalogs) {
    assert.deepEqual(
      Object.keys(catalog.messages).sort(),
      Object.keys(english.messages).sort(),
      catalog.locale,
    );
    for (const [key, value] of Object.entries(catalog.messages)) {
      assert.equal(typeof value, "string");
      assert.ok(value.trim(), key);
      assert.deepEqual(
        slots(value),
        slots(english.messages[key]),
        `${catalog.locale}: ${key}`,
      );
    }
  }
});
test("literal translation calls refer to existing English keys", () => {
  const paths = [
    "main.tsx",
    "ui.tsx",
    "api.ts",
    "i18n.tsx",
    ...readdirSync(root + "components").map((p) => "components/" + p),
    ...readdirSync(root + "hooks").map((p) => "hooks/" + p),
  ];
  for (const path of paths) {
    const sf = ts.createSourceFile(
      path,
      readFileSync(root + path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    function visit(node) {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(sf) === "t" &&
        ts.isStringLiteral(node.arguments[0])
      )
        assert.ok(
          Object.hasOwn(english.messages, node.arguments[0].text),
          `${path}: ${node.arguments[0].text}`,
        );
      ts.forEachChild(node, visit);
    }
    visit(sf);
  }
});
test("locale selection, English fallback and named parameters", () => {
  assert.equal(
    resolveLocale(["es-MX", "de-DE"], ["en", "de", "es", "it"]),
    "es",
  );
  assert.equal(resolveLocale(["fr-FR"], ["en", "de", "es", "it"]), "en");
  assert.equal(
    translate(
      { locale: "xx", name: "Example", messages: {} },
      english,
      "Page {page} / {pages}",
      { page: 2, pages: 8 },
    ),
    "Page 2 / 8",
  );
  assert.equal(
    translate(english, english, "{value}", { value: "<script>&" }),
    "<script>&",
  );
});
test("language icons preserve canonical filter values and use a neutral fallback", () => {
  assert.equal(audioLanguage("Deutsch").flag, "de");
  assert.equal(audioLanguage("eng").flag, "gb");
  assert.equal(audioLanguage("spa").flag, "es");
  assert.equal(audioLanguage("ita")?.name, "Italian");
  assert.equal(audioLanguage("und"), undefined);
  assert.equal(audioLanguage(""), undefined);
  assert.equal(audioLanguage("Unidentified"), undefined);
});
test("dashboard drilldown encodes values, handles unknowns and picks the service scope", () => {
  assert.equal(
    new URLSearchParams(makeDashboardFilter("codec", "x264", "all").query).get(
      "codec",
    ),
    "x264",
  );
  assert.equal(
    new URLSearchParams(makeDashboardFilter("source", "", "sonarr").query).get(
      "source",
    ),
    "__unknown__",
  );
  assert.equal(
    new URLSearchParams(
      makeDashboardFilter("source", "a&b=1", "all").query,
    ).get("source"),
    "a&b=1",
  );
  assert.equal(dashboardService("all", "sonarr"), "sonarr");
  assert.equal(dashboardService("radarr", "sonarr"), "radarr");
});

test("legacy language aliases remain selected without rewriting query values", () => {
  assert.ok(sameAudioLanguage("Spanish", "Spanisch"));
  assert.ok(sameAudioLanguage("ita", "Italienisch"));
  assert.ok(!sameAudioLanguage("Spanish", "German"));
  assert.ok(!sameAudioLanguage("Unidentified", "Unknown"));
  const query = new URLSearchParams("language=Spanish");
  assert.ok(sameAudioLanguage(query.get("language"), "Spanisch"));
  assert.equal(query.get("language"), "Spanish");
});
