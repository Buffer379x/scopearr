import test from "node:test";
import assert from "node:assert/strict";
import * as languages from "../src/languages.ts";
import { src, squash } from "./helpers/sources.mjs";
import {
  componentHarness,
  find,
  loadSource,
  nodes,
  text,
} from "./helpers/component-harness.mjs";

// Stored language values stay canonical German (parser.go); the file dialog
// names them in the interface language, as the language flags already do.
test("languages name canonical values in the interface language", () => {
  const { audioLanguageListLabel } = languages;
  assert.equal(typeof audioLanguageListLabel, "function");
  const same = (key) => key;
  assert.equal(
    audioLanguageListLabel("Deutsch, Englisch", "en", same),
    "German, English",
  );
  assert.equal(
    audioLanguageListLabel("Deutsch, Englisch", "de", same),
    "Deutsch, Englisch",
  );
  assert.equal(audioLanguageListLabel("Englisch", "es", same), "inglés");
  assert.equal(
    audioLanguageListLabel("Klingonisch", "en", same),
    "Klingonisch",
  );
  assert.equal(audioLanguageListLabel("", "en", same), "");
  assert.equal(audioLanguageListLabel("und", "en", same), "Unknown");
});

test("file details route language evidence through the label", () => {
  const code = squash(src("components/FileDialog.tsx"));
  for (const call of [
    "shown(k, e.filename)",
    "shown(k, e.api)",
    "shown(k, e.emby)",
    "shown(k, e.mediainfo)",
    "formatValue=",
  ])
    assert.ok(code.includes(call), call);
  assert.ok(!code.includes('{e.api || "—"}'), "raw Radarr/Sonarr value");
});

// Setup is the same component with an uninitialized status.
test("login footer separates the version from the tagline", () => {
  for (const initialized of [true, false]) {
    const harness = componentHarness(
      "Login",
      { status: { version: "2.0.0", initialized }, done: async () => {} },
      { modules: { "../api": { api: async () => ({}) } } },
    );
    const shown = text(harness.render());
    assert.ok(
      shown.includes("Scopearr 2.0.0 · For your own server"),
      `${initialized ? "login" : "setup"}: ${shown}`,
    );
  }
});

// The source menu shows values through formatValue; the choice it reports is
// the source alone, so the stored value stays the canonical one.
test("source menu translates values and reports the canonical source", async () => {
  const same = (key) => key;
  const formatValue = (value) =>
    languages.audioLanguageListLabel(value, "en", same);
  const element = { closest: () => ({}), focus() {} };
  const chosen = [];
  const evidence = {
    filename: "Deutsch, Englisch",
    api: "",
    mediainfo: "Deutsch",
    origin: "mediainfo",
    conflict: true,
    confirmed: { source: "mediainfo", value: "Deutsch", at: 0 },
  };
  const harness = componentHarness(
    "EvidenceSourceMenu",
    {
      evidence,
      field: "Languages",
      formatValue,
      ruleConflict: false,
      busy: false,
      choose: async (source) => {
        chosen.push(source);
      },
    },
    {
      modules: {
        // The menu is open and rendered into its dialog.
        "preact/hooks": {
          useRef: () => ({ current: element }),
          useState: (initial) => [initial === false ? true : initial, () => {}],
          useLayoutEffect: () => {},
        },
        "preact/compat": { createPortal: (vnode) => vnode },
        "../evidence-source": loadSource("evidence-source.ts"),
        "../notifications": loadSource("notifications.ts"),
      },
    },
  );
  const tree = harness.render();
  const options = nodes(tree).filter(
    (node) => node.props?.role === "menuitemradio",
  );
  assert.deepEqual(
    options.map((node) => text(node)),
    ["Filename · German, English", "MediaInfo · German"],
  );
  const confirmation = nodes(tree).find(
    (node) => node.type === "span" && node.props?.role === "img",
  );
  assert.match(
    confirmation.props["aria-label"],
    /^Confirmed manually: MediaInfo · German · /,
  );
  assert.ok(!text(tree).includes("Deutsch"), text(tree));
  for (const option of options) await option.props.onClick();
  await find(tree, "button", "Automatic").props.onClick();
  assert.deepEqual(chosen, ["filename", "mediainfo", null]);
  assert.equal(evidence.filename, "Deutsch, Englisch");
  assert.equal(evidence.confirmed.value, "Deutsch");
});
