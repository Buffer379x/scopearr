import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalPresetQuery } from "../src/preset-query.ts";
import * as mediaInfo from "../src/mediainfo.ts";
const src = (path) =>
  readFileSync(new URL("../src/" + path, import.meta.url), "utf8");

test("MediaInfo preset preserves both include and exclude choices", () => {
  for (const state of ["true", "false"])
    assert.equal(
      new URLSearchParams(
        canonicalPresetQuery("mediaInfo=" + state + "&confirmed=true&page=7"),
      ).get("mediaInfo"),
      state,
    );
});
test("state filters explain confirmation and current MediaInfo results and retain disabled active choices", () => {
  const code = src("components/FilterPanel.tsx");
  assert.match(code, /name="confirmed"[\s\S]*?help=/);
  assert.match(code, /mediaInfoEnabled\s*\|\|\s*q\.has\("mediaInfo"\)/);
  assert.match(code, /name="mediaInfo"[\s\S]*?help=/);
  assert.match(code, /mediaInfo: t\("MediaInfo read"\)/);
  assert.match(
    src("components/Library.tsx"),
    /mediaInfoEnabled=\{!!settings\?\.mediaInfo\?\.enabled\}/,
  );
});
test("custom tag heading help explains all five management topics", () => {
  const code = src("components/CustomTagsSettings.tsx");
  assert.match(code, /<HelpPopover[\s\S]*label="Custom tags help"/);
  for (const heading of [
    "Management",
    "Count",
    "Name",
    "Colors",
    "Creating tags",
  ])
    assert.match(code, new RegExp('heading: "' + heading + '"'));
});
test("MediaInfo sections retain present selection and fall back when reread removes its tracks", () => {
  assert.equal(typeof mediaInfo.mediaInfoSection, "function");
  const result = {
    tracks: [
      { type: "Video", fields: { Format: "AVC" } },
      { type: "Audio", fields: { Language: "de" } },
      { type: "Text", fields: { Language: "en" } },
    ],
  };
  assert.equal(mediaInfo.mediaInfoSection("Audio", result), "Audio");
  assert.equal(mediaInfo.mediaInfoSection("Text", result), "Text");
  assert.equal(
    mediaInfo.mediaInfoSection("Text", { tracks: result.tracks.slice(0, 2) }),
    "result",
  );
  assert.equal(mediaInfo.mediaInfoSection("bad", result), "result");
  assert.equal(mediaInfo.mediaInfoSection("Audio", undefined), "result");
  assert.equal(
    mediaInfo.mediaInfoSection("Audio", {
      tracks: [{ type: "Audio", fields: {} }],
    }),
    "result",
  );
});
test("track comparison aligns union of nonempty attributes and keeps absent values visible", () => {
  assert.equal(typeof mediaInfo.mediaInfoTrackRows, "function");
  assert.deepEqual(
    mediaInfo.mediaInfoTrackRows([
      { fields: { Format: "AAC", Language: "de", Channels: "2", Unused: "" } },
      {
        fields: {
          Format: "AC-3",
          Language: "en",
          BitRate: "640000",
          Unused: "",
        },
      },
    ]),
    [
      { field: "Format", values: ["AAC", "AC-3"] },
      { field: "Language", values: ["de", "en"] },
      { field: "Channels", values: ["2", "—"] },
      { field: "BitRate", values: ["—", "640000"] },
    ],
  );
});
test("MediaInfo uses accessible section panels and track columns rather than expandable details", () => {
  const code = src("components/MediaInfoPanel.tsx");
  assert.doesNotMatch(code, /<details|<summary/);
  assert.match(code, /<SegmentedTabs[\s\S]*id="mediainfo-section"/);
  assert.match(code, /scopearr-mediainfo-section/);
  assert.match(code, /value: "result", label: t\("Result"\)/);
  assert.match(code, /tracks\.map\([\s\S]*?<th scope="col"/);
  assert.match(code, /role="tabpanel"[\s\S]*?mediainfo-section-panel-/);
});
test("file dialog width is scoped and the Used column stays on one line", () => {
  assert.match(src("components/FileDialog.tsx"), /className="file-dialog"/);
  assert.match(
    src("styles/dialogs.css"),
    /\.modal\.wide\.file-dialog\s*\{[^}]*--layout-1060/,
  );
  assert.match(
    src("styles/dialogs.css"),
    /\.evidence-used\s*\{[^}]*white-space: nowrap/,
  );
});
