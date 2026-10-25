import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import * as geometry from "../src/tool-table.ts";
import { audioChannelLayout } from "../src/audio-channels.ts";
import { cssRules, selectors } from "./helpers/css-rules.mjs";

const src = (p) =>
  readFileSync(new URL("../src/" + p, import.meta.url), "utf8");
const rules = (p, selector) =>
  cssRules(src("styles/" + p)).filter((r) =>
    selectors(r.header).includes(selector),
  );

test("status geometry reserves tag padding, border and cell padding for every translated label", () => {
  const oldDocument = globalThis.document,
    oldStyle = globalThis.getComputedStyle;
  const canvas = { measureText: (text) => ({ width: text.length * 6 }) };
  globalThis.document = {
    documentElement: {},
    body: {},
    createElement: () => ({ getContext: () => canvas }),
  };
  globalThis.getComputedStyle = () => ({
    getPropertyValue: () => "",
    fontFamily: "sans-serif",
  });
  try {
    assert.equal(typeof geometry.measuredTagWidth, "function");
    assert.equal(geometry.measuredTagWidth("abcdefghijklmnopqrst"), 166);
    assert.equal(
      geometry.toolTableStyle(["status", "progress"], "placement", {}, [
        "abcdefghijklmnopqrst",
      ])["--tool-col-status"],
      "166px",
    );
    assert.equal(
      geometry.toolTableStyle(["status", "progress"], "placement", {}, [
        "Ready",
      ])["--tool-col-status"],
      "120px",
    );
    assert.equal(
      geometry.toolTableStyle(["progress"], "placement")["--tool-col-progress"],
      "128px",
    );
  } finally {
    globalThis.document = oldDocument;
    globalThis.getComputedStyle = oldStyle;
  }
});

test("channel layout qualifiers retain LFE layout without guessing from a channel count", () => {
  for (const [channelLayout, channels, want] of [
    ["5.1(side)", 6, "5.1"],
    ["7.1(wide)", 8, "7.1"],
    ["6.1(back)", 7, "6.1"],
    ["5.0(side)", 5, "5.0"],
    ["quad", 4, "4.0"],
    ["stereo", 2, "2.0"],
    ["mono", 1, "1.0"],
    ["hexagonal", 6, "6 ch"],
    ["", 0, ""],
  ])
    assert.equal(
      audioChannelLayout({ channelLayout, channels }),
      want,
      channelLayout,
    );
});

test("tool cells keep status tags and 100 percent progress unclipped with one left alignment", () => {
  for (const name of ["DiskPlacementPage", "MuxTable", "FileCheckPage"]) {
    const code = src("components/" + name + ".tsx");
    assert.match(code, /<td class="col-status">/);
    assert.match(code, /<td class="col-progress">/);
    assert.doesNotMatch(code, /col-progress number/);
    assert.match(code, /useToolTableStyle/);
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
  assert.match(src("styles/base.css"), /--progress-label-width:\s*40px/);
  assert.match(src("styles/base.css"), /--tool-col-progress:\s*128px/);
  const hook = src("use-tool-table.ts");
  assert.match(hook, /document\.fonts\.ready/);
  assert.match(
    hook,
    /\[columns, kind, labels, statusLabels, locale, fontsReady\]/,
  );
});

test("mux status tags show short text and expose the complete status label", () => {
  const code = src("components/MuxStatusDialog.tsx").split(
    "export function MuxStatusDialog",
  )[0];
  assert.match(code, /t\(muxStatusShort\[status\]/);
  assert.match(code, /aria-label=\{t\(muxStatusLabels\[status\]/);
  assert.match(code, /title=\{t\(muxStatusLabels\[status\]/);
});

test("excluded chips and selected filter buttons share error semantics in every theme", () => {
  for (const selector of [
    ".filter-chip.excluded",
    ".select-button.selected.excluded",
  ]) {
    const matches = readdirSync(new URL("../src/styles/", import.meta.url))
      .filter((p) => p.endsWith(".css"))
      .flatMap((p) =>
        cssRules(src("styles/" + p)).filter((r) => r.header.includes(selector)),
      );
    assert.equal(matches.length, 1, selector);
    assert.match(matches[0].body, /color:\s*var\(--status-error\)/);
    assert.match(matches[0].body, /--status-error\) 35%/);
    assert.match(matches[0].body, /--status-error\) 10%/);
  }
});

test("password card uses externally associated controls without changing settings dirty state", () => {
  const settings = src("components/SettingsDialog.tsx");
  assert.doesNotMatch(
    settings,
    /password-settings|setPasswordOpen|setCurrent|setPassword\]/,
  );
  assert.match(settings, /password=\{<PasswordCard demo=\{demo\}/);
  assert.match(settings, /<\/form>[\s\S]*<form\s+id="password-form"/);
  const card = src("components/PasswordCard.tsx");
  assert.doesNotMatch(card, /<form/);
  assert.equal((card.match(/form="password-form"/g) || []).length, 3);
  assert.match(card, /minLength=\{12\}/);
  assert.match(card, /autoComplete="current-password"/);
  assert.match(card, /autoComplete="new-password"/);
  assert.match(card, /disabled=\{demo\}/);
  assert.match(src("components/SystemInfo.tsx"), /\{password\}/);
  assert.match(
    rules("settings-and-filters.css", ".system-overview").find(
      (r) => !r.context.length,
    )?.body || "",
    /repeat\(3, minmax\(0, 1fr\)\)/,
  );
});

test("compatible source evidence retains the Arr value and explains its broader category", () => {
  const code = src("components/FileDialog.tsx");
  assert.match(
    code,
    /k === "source"[\s\S]*!e\.conflict[\s\S]*e\.filename !== e\.api/,
  );
  assert.match(code, /class="cell-hint"/);
  assert.match(
    code,
    /data-label="Radarr \/ Sonarr">\s*<span class="ordered-label">/,
  );
  for (const locale of ["en", "de", "es", "it"]) {
    const { messages } = JSON.parse(src("locales/" + locale + ".json"));
    for (const key of [
      "Category",
      "Radarr/Sonarr report a broader category; the filename is more specific.",
      "Changing the password signs out every session.",
      "Media details refreshed for {count} files|one",
      "Media details refreshed for {count} files|other",
      "Could not refresh media details: {error}",
    ])
      assert.ok(messages[key], locale + ": " + key);
  }
});

test("excluded error tint retains readable contrast in every shipped palette and mode", async () => {
  const { interfaceThemes, themePalettes } = await import("../src/themes.ts");
  const modes = {};
  for (const block of cssRules(src("styles/base.css"))) {
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

test("file details normalize channel labels while preserving the raw layout tooltip", () => {
  const code = src("components/FileDialog.tsx");
  assert.match(code, /audioChannelLayout\(track\)/);
  assert.match(code, /title=\{track.channelLayout \|\| undefined\}/);
});
