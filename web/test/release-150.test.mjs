import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { audioChannelLayout } from "../src/audio-channels.ts";
import { readSources } from "./helpers/sources.mjs";
import { loadSource } from "./helpers/component-harness.mjs";

const src = (p) =>
  readFileSync(new URL("../src/" + p, import.meta.url), "utf8");

test("status geometry reserves the tag's dot, padding and cell padding for every translated label", () => {
  // The v2 tool tables (Phase 5b; the 1.7.0 measuredTagWidth and
  // toolTableStyle left in Task 9): a status tag is its text, the dot and
  // its gap (--dot-sm each) and --sp-2 on both sides, rounded up and 1px
  // more; the status column takes the widest text of the tool, at least
  // --tool-status-min, plus the cell padding (--sp-5 at the first cell).
  const canvas = { measureText: (text) => ({ width: text.length * 6 }) };
  const tokens = {
    "--fs-xs": "11.5px",
    "--w-semi": "600",
    "--dot-sm": "6px",
    "--sp-1": "4px",
    "--sp-2": "8px",
    "--sp-5": "20px",
    "--tool-status-min": "116px",
  };
  const geometry = loadSource("tool-columns.ts", {
    modules: {
      "./filecheck": {},
      "./mux-spec": {},
      "./placement": {},
      "./ui": { ICON: { arrow: 11 } },
    },
    browser: {
      document: {
        documentElement: {},
        createElement: () => ({ getContext: () => canvas }),
      },
      getComputedStyle: () => ({
        getPropertyValue: (name) => tokens[name] ?? "",
      }),
    },
  });
  const buttons = { info: 2, actions: 2, infoPhone: 1, actionsPhone: 1 };
  const metrics = geometry.domToolMetrics();
  const style = (columns, texts = []) =>
    geometry.toolColumnStyle(columns, "placement", {}, texts, buttons, metrics);
  assert.equal(typeof geometry.domToolMetrics, "function");
  assert.equal(metrics.tag("abcdefghijklmnopqrst"), 20 * 6 + 12 + 16 + 1);
  assert.equal(
    style(["status", "progress"], ["abcdefghijklmnopqrst"])["--tt-status"],
    149 + 20 + 8 + "px",
  );
  assert.equal(
    style(["status", "progress"], ["Ready"])["--tt-status"],
    116 + 20 + 8 + "px",
  );
  assert.equal(style(["progress"])["--tt-progress"], 130 + 20 + 20 + "px");
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
  // Muxing, Disk placement and Files & permissions (Phase 5b): the v2
  // widths cover every status text of the tool (tool-status,
  // toolStatusTexts), never only the rows on screen.
  assert.match(src("components/MuxPage.tsx"), /useToolColumnStyle\(/);
  assert.match(src("components/DiskPlacementPage.tsx"), /useToolColumnStyle\(/);
  assert.match(src("components/FileCheckPage.tsx"), /useToolColumnStyle\(/);
  assert.match(src("use-tool-table.ts"), /toolStatusTexts\(kind, t\)/);
  // Measured again after a language change, document.fonts.ready and every
  // later face (useFontsLoaded, Phase 5a; tool-fonts.test.mjs runs it).
  const hook = src("use-tool-table.ts");
  assert.match(hook, /const fonts = useFontsLoaded\(\);/);
  assert.match(hook, /\n\s+locale,\n\s+fonts,\n\s+coarse,\n\s+\],/);
  const fonts = src("hooks/useFontsLoaded.ts");
  assert.match(fonts, /const fonts = document\.fonts;/);
  assert.match(fonts, /fonts\.ready\.then\(next\)/);
  assert.match(fonts, /fonts\.addEventListener\("loadingdone", next\)/);
});

test("mux status tags show short text and expose the complete status label", () => {
  const code = src("components/MuxStatusDialog.tsx");
  // From the one source of the tool status views (Phase 5b), shown by the
  // v2 StatusValue: the short text in the tag, the label as its title
  // (tool-status.test.mjs pins the views to the 1.7.0 tag; the tag itself,
  // StatusTag, is pinned by the tool tests). The dialog's own 1.7.0 tag left
  // with Phase 5d, Task 8.
  assert.match(code, /<StatusValue view=\{muxStatusView\(j, t\)\} \/>/);
  assert.doesNotMatch(code, /MuxStatusTag|aria-label=\{view\.long\}/);
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
  assert.match(
    src("components/PasswordCard.tsx"),
    /<PasswordDialog demo=\{demo\}/,
  );
  const card = src("components/dialog/PasswordDialog.tsx");
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
