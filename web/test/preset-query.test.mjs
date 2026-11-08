import test from "node:test";
import assert from "node:assert/strict";
import { canonicalPresetQuery } from "../src/preset-query.ts";
import { activeFilterCount } from "../src/library-filters.ts";
test("preset identity normalizes selections, defaults, ranges, search and legacy aliases", () => {
  for (const [a, b] of [
    [
      "resolution=1080p&resolution=2160p&codec=x265",
      "codec=x265&resolution=2160p&resolution=1080p&resolution=1080p&resolutionOp=eq&page=4&sort=year&dir=desc",
    ],
    [
      "language=de&language=eng&languageOp=all",
      "language=Englisch&language=Deutsch&languageOp=all&sourceOp=not",
    ],
    ["yearMin=02010&sizeMin=0001024", "yearMin=2010&sizeMin=1024"],
    ["hdr=HDR10&hdrOp=notAll", "hdr=HDR10&hdrOp=not"],
    ["q=FOO++bar+foo", "q=bar+foo"],
  ])
    assert.equal(canonicalPresetQuery(a), canonicalPresetQuery(b));
  assert.notEqual(
    canonicalPresetQuery("codec=x265"),
    canonicalPresetQuery("codec=x265&codecOp=not"),
  );
  assert.notEqual(
    canonicalPresetQuery("hdr=HDR10&hdr=Dolby+Vision&hdrOp=all"),
    canonicalPresetQuery("hdr=HDR10&hdr=Dolby+Vision&hdrOp=notAll"),
  );
  assert.notEqual(
    canonicalPresetQuery("conflict=true"),
    canonicalPresetQuery("conflict=false"),
  );
});
test("media-server and season status filters remain part of saved preset identity", () => {
  assert.equal(
    canonicalPresetQuery("mediaMissing=true&mediaMatched=true&page=7"),
    canonicalPresetQuery("mediaMatched=true&mediaMissing=true"),
  );
  for (const key of [
    "mediaMatched",
    "mediaMissing",
    "mediaAmbiguous",
    "mediaConflicting",
    "mediaNoTracks",
    "mediaPending",
    "mediaUnconfigured",
    "seasonOutlier",
    "languageOutlier",
  ]) {
    assert.notEqual(
      canonicalPresetQuery(`${key}=true`),
      canonicalPresetQuery(""),
    );
    assert.notEqual(
      canonicalPresetQuery(`${key}=true`),
      canonicalPresetQuery(`${key}=false`),
    );
  }
});
// Ruling P5: audio track combinations belong to a preset's identity as
// presets.go:69-88 keeps them (trimmed, the language normalized, unknown
// apart from any, deduplicated and sorted; trackOp like the other fields).
test("audio track combinations are part of a preset's identity", () => {
  assert.equal(
    canonicalPresetQuery("track=Deutsch%7CAC-3%7C"),
    "track=Deutsch%7CAC-3%7C",
  );
  assert.equal(
    canonicalPresetQuery(
      "track=+ger+%7C+AC-3+%7C&track=und%7C%7C5.1&track=German%7CAC-3%7C&page=2&sort=year",
    ),
    "track=Deutsch%7CAC-3%7C&track=__unknown__%7C%7C5.1",
  );
  assert.equal(
    canonicalPresetQuery("track=%7C__unknown__%7C&codec=x265"),
    "codec=x265&track=%7C__unknown__%7C",
  );
  // One combination: all is eq, not all is not; an operator alone is dropped.
  assert.equal(
    canonicalPresetQuery("track=Deutsch%7C%7C&trackOp=all"),
    "track=Deutsch%7C%7C",
  );
  assert.equal(
    canonicalPresetQuery("track=Deutsch%7C%7C&trackOp=notAll"),
    "track=Deutsch%7C%7C&trackOp=not",
  );
  assert.equal(
    canonicalPresetQuery(
      "track=Englisch%7C%7C&track=Deutsch%7C%7C&trackOp=notAll",
    ),
    "track=Deutsch%7C%7C&track=Englisch%7C%7C&trackOp=notAll",
  );
  assert.equal(canonicalPresetQuery("trackOp=not"), "");
  assert.equal(
    canonicalPresetQuery("track=Deutsch%7C%7C&trackOp=eq"),
    "track=Deutsch%7C%7C",
  );
  // Values the API rejects carry no identity.
  for (const value of ["Deutsch%7CAC-3", "%7C%7C", "a%7Cb%7Cc%7Cd", ""])
    assert.equal(canonicalPresetQuery("track=" + value), "", value);
  assert.notEqual(
    canonicalPresetQuery("track=Deutsch%7C%7C&trackOp=not"),
    canonicalPresetQuery("track=Deutsch%7C%7C"),
  );
  assert.notEqual(
    canonicalPresetQuery("track=%7C%7C5.1"),
    canonicalPresetQuery("channels=5.1"),
  );
});
test("a track filter alone turns the preset select to a custom selection", () => {
  const presets = [
    { id: 1, query: "codec=x265" },
    { id: 2, query: "track=Deutsch%7CAC-3%7C" },
  ];
  const matching = (filters) =>
    presets
      .filter(
        (p) => canonicalPresetQuery(p.query) === canonicalPresetQuery(filters),
      )
      .map((p) => p.id);
  // A track-only preset is not the empty selection ("All files").
  assert.deepEqual(matching(""), []);
  assert.deepEqual(matching("track=ger%7CAC-3%7C"), [2]);
  // Active filters that match no preset are a custom selection.
  for (const filters of [
    "codec=x265&track=Deutsch%7C%7C",
    "track=Englisch%7CAC-3%7C",
  ]) {
    assert.deepEqual(matching(filters), [], filters);
    assert.ok(activeFilterCount(filters) > 0, filters);
  }
});
