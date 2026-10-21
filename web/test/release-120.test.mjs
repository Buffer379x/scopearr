import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanMuxName,
  muxTabVisible,
  validateMuxSpec,
} from "../src/mux-spec.ts";
const tracks = [
  { id: 0, type: "video" },
  { id: 1, type: "audio" },
  { id: 2, type: "audio" },
];
const spec = () => ({
  outputName: "Movie",
  tracks: {
    0: { keep: true, language: "und", name: "", default: true },
    1: { keep: true, language: "en", name: "", default: true },
    2: { keep: false, language: "de", name: "", default: true },
  },
});
test("mux tab includes completed jobs and remains opt-in", () => {
  assert.equal(muxTabVisible({}), false);
  assert.equal(
    muxTabVisible({
      mux: { enabled: false, pending: 1, running: 0, failed: 0 },
    }),
    false,
  );
  assert.equal(
    muxTabVisible({
      mux: { enabled: true, pending: 0, running: 0, failed: 0 },
    }),
    true,
  );
  assert.equal(
    muxTabVisible({
      mux: { enabled: true, pending: 1, running: 0, failed: 0 },
    }),
    true,
  );
});
test("mux validation protects filenames, video and default flags", () => {
  assert.equal(validateMuxSpec(tracks, spec()), "");
  for (const outputName of [
    "../x",
    ".x",
    "a/b",
    "a\\b",
    "x.partial",
    "x.scopearr-backup-1",
    "a\nb",
    "a".repeat(201),
  ])
    assert.equal(
      validateMuxSpec(tracks, { ...spec(), outputName }),
      "Invalid output filename",
    );
  const noVideo = spec();
  noVideo.tracks[0].keep = false;
  assert.ok(validateMuxSpec(tracks, noVideo));
  const defaults = spec();
  defaults.tracks[2].keep = true;
  assert.equal(
    validateMuxSpec(tracks, defaults),
    "Only one default track per type is allowed",
  );
  assert.equal(cleanMuxName("Movie.MKV"), "Movie");
});
