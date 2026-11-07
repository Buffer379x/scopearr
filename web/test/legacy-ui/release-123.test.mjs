// Legacy UI (1.7.0 look) – replaced in Phase 5d by contrast.test.mjs (v2 status tokens); deleted with base.css.
import test from "node:test";
import assert from "node:assert/strict";
import { legacyCss } from "../helpers/legacy-styles.mjs";

const luminance = (hex) => {
  if (hex.length === 4)
    hex = "#" + [...hex.slice(1)].map((c) => c + c).join("");
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
};
test("mux status colors meet 4.5:1 in dark and light themes", () => {
  const css = legacyCss("base.css");
  for (const block of css.matchAll(
    /(?::root|:root\[data-theme="light"\])\s*\{([^}]+)\}/g,
  )) {
    const vars = Object.fromEntries(
      [...block[1].matchAll(/--([\w-]+):\s*(#[a-f0-9]{3,6});/g)].map((m) => [
        m[1],
        m[2],
      ]),
    );
    const panel =
      vars.panel.length === 4
        ? "#" + [...vars.panel.slice(1)].map((v) => v + v).join("")
        : vars.panel;
    for (const key of [
      "status-ok",
      "status-warn",
      "status-error",
      "status-info",
      "status-wait",
    ]) {
      const a = luminance(vars[key]),
        b = luminance(
          key === "status-wait"
            ? "#" +
                [1, 3, 5]
                  .map((i) =>
                    Math.round(
                      parseInt(vars[key].slice(i, i + 2), 16) * 0.08 +
                        parseInt(panel.slice(i, i + 2), 16) * 0.92,
                    )
                      .toString(16)
                      .padStart(2, "0"),
                  )
                  .join("")
            : vars.panel,
        );
      assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5, key);
    }
  }
});
