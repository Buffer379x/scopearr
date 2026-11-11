import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as geometry from "../src/tool-table.ts";
import { audioChannelLayout } from "../src/audio-channels.ts";
import { readSources } from "./helpers/sources.mjs";

const src = (p) =>
  readFileSync(new URL("../src/" + p, import.meta.url), "utf8");

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
  for (const name of ["DiskPlacementPage", "FileCheckPage"]) {
    const code = src("components/" + name + ".tsx");
    assert.match(code, /useToolTableStyle/);
  }
  // Muxing (Phase 5b): the v2 widths cover every status text of the tool
  // (tool-status, toolStatusTexts), never only the rows on screen.
  assert.match(src("components/MuxPage.tsx"), /useToolColumnStyle\(/);
  assert.match(src("use-tool-table.ts"), /toolStatusTexts\(kind, t\)/);
  // Measured again after a language change, document.fonts.ready and every
  // later face (useFontsLoaded, Phase 5a; tool-fonts.test.mjs runs it).
  const hook = src("use-tool-table.ts");
  assert.match(hook, /const fonts = useFontsLoaded\(\);/);
  assert.match(hook, /\[columns, kind, labels, statusLabels, locale, fonts\]/);
  const fonts = src("hooks/useFontsLoaded.ts");
  assert.match(fonts, /const fonts = document\.fonts;/);
  assert.match(fonts, /fonts\.ready\.then\(next\)/);
  assert.match(fonts, /fonts\.addEventListener\("loadingdone", next\)/);
});

test("mux status tags show short text and expose the complete status label", () => {
  const code = src("components/MuxStatusDialog.tsx").split(
    "export function MuxStatusDialog",
  )[0];
  // From the one source of the tool status views (Phase 5b): the short
  // text shown, the label as name and title (tool-status.test.mjs pins the
  // views to the 1.7.0 tag).
  assert.match(code, /const view = muxStatusView\(job, t\);/);
  assert.match(code, /\{view\.text\}/);
  assert.match(code, /aria-label=\{view\.long\}/);
  assert.match(code, /title=\{view\.long\}/);
});

test("password card uses externally associated controls without changing settings dirty state", () => {
  assert.doesNotMatch(
    readSources([
      "components/SettingsPage.tsx",
      "components/SystemSettings.tsx",
      "hooks/useSettingsDraft.ts",
    ]),
    /password-settings|setPasswordOpen|setCurrent|setPassword\]/,
  );
  assert.match(
    src("components/SystemSettings.tsx"),
    /password=\{<PasswordCard demo=\{demo\}/,
  );
  assert.match(
    src("components/SettingsPage.tsx"),
    /<\/form>[\s\S]*<form\s+id="password-form"/,
  );
  const card = src("components/PasswordCard.tsx");
  assert.doesNotMatch(card, /<form/);
  assert.equal((card.match(/form="password-form"/g) || []).length, 3);
  assert.match(card, /minLength=\{12\}/);
  assert.match(card, /autoComplete="current-password"/);
  assert.match(card, /autoComplete="new-password"/);
  assert.match(card, /disabled=\{demo\}/);
  assert.match(src("components/SystemInfo.tsx"), /\{password\}/);
});

test("compatible source evidence retains the Arr value and explains its broader category", () => {
  const code = src("components/FileDialog.tsx");
  assert.match(
    code,
    /k === "source"[\s\S]*!e\.conflict[\s\S]*e\.filename !== e\.api/,
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

test("file details normalize channel labels while preserving the raw layout tooltip", () => {
  const code = src("components/FileDialog.tsx");
  assert.match(code, /audioChannelLayout\(track\)/);
  assert.match(code, /title=\{track.channelLayout \|\| undefined\}/);
});
