import test from "node:test";
import assert from "node:assert/strict";
import {
  interfaceThemes,
  themePalettes,
  applyInterfaceTheme,
} from "../src/themes.ts";
import { audioLanguage, sameAudioLanguage } from "../src/languages.ts";
const luminance = (hex) => {
  const rgb = hex
    .slice(1)
    .match(/../g)
    .map((v) => parseInt(v, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
};
const contrast = (a, b) =>
  (Math.max(luminance(a), luminance(b)) + 0.05) /
  (Math.min(luminance(a), luminance(b)) + 0.05);
test("all additional palettes keep normal text and primary actions readable in each mode", () => {
  for (const [name, modes] of Object.entries(themePalettes))
    for (const [mode, palette] of Object.entries(modes)) {
      for (const surface of ["bg", "panel", "panel2"])
        for (const foreground of ["text", "muted"])
          assert.ok(
            contrast(palette[surface], palette[foreground]) >= 4.5,
            `${name}/${mode} ${foreground} on ${surface}`,
          );
      assert.ok(
        contrast(palette.accent, palette["accent-text"]) >= 4.5,
        `${name}/${mode} primary action`,
      );
      assert.ok(
        contrast(palette.accent, palette["accent-bg"]) >= 4.5,
        `${name}/${mode} selected navigation`,
      );
    }
});
test("changing mode replaces palette colors and returning to Default clears overrides", () => {
  const values = new Map();
  const root = {
    dataset: {},
    style: {
      setProperty: (key, value) => values.set(key, value),
      removeProperty: (key) => values.delete(key),
    },
  };
  applyInterfaceTheme(root, "nord", "dark");
  assert.equal(values.get("--bg"), "#2e3440");
  applyInterfaceTheme(root, "catppuccin", "light");
  assert.equal(values.get("--bg"), "#eff1f5");
  applyInterfaceTheme(root, "default", "light");
  assert.equal(root.dataset.palette, "default");
  assert.equal(values.size, 0);
  applyInterfaceTheme(root, "untrusted-value", "dark");
  assert.equal(root.dataset.palette, "default");
  assert.equal(values.size, 0);
});
test("Turkish aliases resolve locally while unrelated languages retain neutral fallback", () => {
  for (const value of ["Turkish", "Türkisch", "Türkçe", "Turco", "tr", "tur"])
    assert.equal(audioLanguage(value)?.flag, "tr");
  assert.ok(sameAudioLanguage("tur", "Turkish"));
  assert.equal(audioLanguage("unsupported-new-language"), undefined);
});

test("all 18 theme choices are accepted by the server and have both modes", async () => {
  const { readFileSync } = await import("node:fs");
  const server = readFileSync(
    new URL("../../internal/app/themes.go", import.meta.url),
    "utf8",
  );
  assert.equal(interfaceThemes.length, 18);
  for (const name of interfaceThemes) {
    assert.ok(server.includes('"' + name + '"'));
    if (name !== "default")
      assert.deepEqual(Object.keys(themePalettes[name]).sort(), [
        "dark",
        "light",
      ]);
  }
});

test("both default palettes keep normal and muted text readable on every surface", async () => {
  const { readFileSync } = await import("node:fs");
  const { cssRules } = await import("./helpers/css-rules.mjs");
  const source = readFileSync(
    new URL("../src/styles/base.css", import.meta.url),
    "utf8",
  );
  for (const rule of cssRules(source).filter((r) =>
    r.header.startsWith(":root"),
  )) {
    const palette = Object.fromEntries(
      [
        ...rule.body.matchAll(
          /--(bg|panel|panel2|text|muted):\s*(#[0-9a-f]+);/g,
        ),
      ].map(([, key, value]) => [
        key,
        value.length === 4
          ? "#" + [...value.slice(1)].map((c) => c + c).join("")
          : value,
      ]),
    );
    if (!palette.bg) continue;
    for (const surface of ["bg", "panel", "panel2"])
      for (const foreground of ["text", "muted"])
        assert.ok(
          contrast(palette[surface], palette[foreground]) >= 4.5,
          `${rule.header} ${foreground} on ${surface}`,
        );
  }
});
