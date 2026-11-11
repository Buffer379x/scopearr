// Legacy UI (1.7.0 look) – replaced in Phase 5a, 5b, 5c and 5d by the v2 filter, tool table, settings and dialog tests and contrast.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { cssRules, selectors } from "../helpers/css-rules.mjs";
import { LEGACY_STYLESHEETS, legacyCss } from "../helpers/legacy-styles.mjs";
import { src } from "../helpers/sources.mjs";

const rules = (p, selector) =>
  cssRules(legacyCss(p)).filter((r) => selectors(r.header).includes(selector));

test("tool cells keep status tags and 100 percent progress unclipped with one left alignment (1.7.0 look)", () => {
  // Muxing and Disk placement left with Phase 5b (StatusTag, ProgressCell).
  for (const name of ["FileCheckPage"]) {
    const code = src("components/" + name + ".tsx");
    assert.match(code, /<td class="col-status">/);
    assert.match(code, /<td class="col-progress">/);
    assert.doesNotMatch(code, /col-progress number/);
  }
  for (const selector of [
    ".tool-table td.col-status",
    ".tool-table td.col-progress",
  ])
    assert.match(
      rules("placement.css", selector)[0]?.body || "",
      /text-overflow:\s*clip/,
    );
  assert.match(
    rules("library.css", ".compact-progress span")[0]?.body || "",
    /min-width:\s*var\(--progress-label-width\)/,
  );
  assert.match(legacyCss("base.css"), /--progress-label-width:\s*40px/);
  assert.match(legacyCss("base.css"), /--tool-col-progress:\s*128px/);
});

test("excluded chips and selected filter buttons share error semantics in every theme", () => {
  for (const selector of [
    ".filter-chip.excluded",
    ".select-button.selected.excluded",
  ]) {
    const matches = LEGACY_STYLESHEETS.flatMap((p) =>
      cssRules(legacyCss(p)).filter((r) => r.header.includes(selector)),
    );
    assert.equal(matches.length, 1, selector);
    assert.match(matches[0].body, /color:\s*var\(--status-error\)/);
    assert.match(matches[0].body, /--status-error\) 35%/);
    assert.match(matches[0].body, /--status-error\) 10%/);
  }
});

test("password card uses externally associated controls without changing settings dirty state (1.7.0 look)", () => {
  assert.match(
    rules("settings-and-filters.css", ".system-overview").find(
      (r) => !r.context.length,
    )?.body || "",
    /repeat\(3, minmax\(0, 1fr\)\)/,
  );
});

test("compatible source evidence retains the Arr value and explains its broader category (1.7.0 look)", () => {
  const code = src("components/FileDialog.tsx");
  assert.match(code, /class="cell-hint"/);
  assert.match(
    code,
    /data-label="Radarr \/ Sonarr">\s*<span\s+class=\{[\s\S]*?"ordered-label"/,
  );
});

test("excluded error tint retains readable contrast in every shipped palette and mode", async () => {
  const { interfaceThemes, themePalettes } =
    await import("../../src/themes.ts");
  const modes = {};
  for (const block of cssRules(legacyCss("base.css"))) {
    const mode =
      block.header === ":root"
        ? "dark"
        : block.header === ':root[data-theme="light"]'
          ? "light"
          : "";
    if (mode)
      modes[mode] = Object.fromEntries(
        [...block.body.matchAll(/--([\w-]+):\s*(#[a-f0-9]{3,6});/g)].map(
          (m) => [m[1], m[2]],
        ),
      );
  }
  const rgb = (hex) => {
    if (hex.length === 4)
      hex = "#" + [...hex.slice(1)].map((n) => n + n).join("");
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  };
  const luminance = (values) =>
    values
      .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
      .reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0);
  for (const theme of interfaceThemes)
    for (const mode of ["light", "dark"]) {
      const vars = modes[mode];
      const panel = rgb(
        theme === "default" ? vars.panel : themePalettes[theme][mode].panel,
      );
      const error = rgb(vars["status-error"]);
      const tint = panel.map((x, i) => 0.9 * x + 0.1 * error[i]);
      const a = luminance(error),
        b = luminance(tint);
      assert.ok(
        (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5,
        theme + "/" + mode,
      );
    }
});
