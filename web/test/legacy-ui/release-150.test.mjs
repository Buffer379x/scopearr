// Legacy UI (1.7.0 look) – replaced in Phase 5c and 5d by the v2 filter, settings and dialog tests and contrast.test.mjs; the library and tool table parts left with Phase 5a and 5b.
import test from "node:test";
import assert from "node:assert/strict";
import { cssRules, selectors } from "../helpers/css-rules.mjs";
import { LEGACY_STYLESHEETS, legacyCss } from "../helpers/legacy-styles.mjs";
import { src } from "../helpers/sources.mjs";

const rules = (p, selector) =>
  cssRules(legacyCss(p)).filter((r) => selectors(r.header).includes(selector));

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
