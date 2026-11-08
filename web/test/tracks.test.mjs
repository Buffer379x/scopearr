import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPACT_CODEC_CHARS,
  compactTracks,
  fileTracks,
  looseActions,
  trackActions,
  trackName,
} from "../src/tracks.ts";

// A file's audio tracks for the TracksCell (Phase 5a, task 2): the logic of
// the 1.7.0 AudioCell and channelRows as pure functions.

const file = (fields) => ({
  language: "",
  audio: "",
  channels: "",
  evidence: {},
  ...fields,
});
const measured = [
  {
    index: 1,
    language: "Deutsch",
    codec: "DTS",
    channels: 6,
    channelLayout: "5.1(side)",
    title: "",
    default: true,
  },
  {
    index: 2,
    language: "Englisch",
    codec: "AC-3",
    channels: 2,
    channelLayout: "stereo",
    title: "Commentary",
    default: false,
  },
  {
    index: 3,
    language: "",
    codec: "",
    channels: 8,
    channelLayout: "",
    title: "",
    default: false,
  },
];
const views = [
  {
    position: 1,
    language: "Deutsch",
    codec: "DTS",
    channels: "5.1",
    title: "",
    isDefault: true,
  },
  {
    position: 2,
    language: "Englisch",
    codec: "AC-3",
    channels: "2.0",
    title: "Commentary",
    isDefault: false,
  },
  {
    position: 3,
    language: "",
    codec: "",
    channels: "8 ch",
    title: "",
    isDefault: false,
  },
];
const confirmed = (field, value) => ({
  [field]: {
    confirmed: { source: "filename", value, at: 1 },
    filename: value,
    api: "",
    origin: "filename",
    conflict: false,
  },
});

test("file tracks follow the 1.7.0 audio cell", () => {
  const reported = {
    language: "Deutsch, Englisch, Französisch",
    audio: "DTS + AC-3 + AAC",
    channels: "5.1 + 2.0",
    audioTracks: measured,
  };
  // Measured tracks, channels normalized; values reported without a track
  // (Französisch, AAC) are loose.
  assert.deepEqual(fileTracks(file(reported)), {
    tracks: views,
    loose: { languages: ["Französisch"], codecs: ["AAC"], channels: [] },
  });
  assert.deepEqual(
    fileTracks(
      file({
        ...reported,
        language: "Deutsch, Englisch",
        audio: "DTS + AC-3",
      }),
    ),
    { tracks: views, loose: null },
  );
  // An active audio or language confirmation shows the file's values only.
  for (const evidence of [
    confirmed("audio", "DTS"),
    confirmed("language", "Deutsch"),
  ])
    assert.deepEqual(fileTracks(file({ ...reported, evidence })), {
      tracks: [],
      loose: {
        languages: ["Deutsch", "Englisch", "Französisch"],
        codecs: ["DTS", "AC-3", "AAC"],
        channels: ["5.1", "2.0", "8 ch"],
      },
    });
  // A retained confirmation whose source is gone is not active.
  assert.deepEqual(
    fileTracks(
      file({
        ...reported,
        evidence: {
          audio: {
            confirmed: { source: "mediainfo", value: "DTS", at: 1 },
            filename: "",
            api: "",
            origin: "",
            conflict: false,
          },
        },
      }),
    ).tracks,
    views,
  );
  // A confirmed channel value keeps the file's channels.
  assert.deepEqual(
    fileTracks(
      file({
        ...reported,
        evidence: {
          ...confirmed("audio", "DTS"),
          ...confirmed("channels", "7.1"),
        },
        channels: "7.1",
      }),
    ).loose.channels,
    ["7.1"],
  );
  // Without measured tracks every reported value is loose.
  assert.deepEqual(
    fileTracks(
      file({ language: "Deutsch", audio: "AC-3", channels: "5.1 + 2.0" }),
    ),
    {
      tracks: [],
      loose: {
        languages: ["Deutsch"],
        codecs: ["AC-3"],
        channels: ["5.1", "2.0"],
      },
    },
  );
  // Without any audio value there is nothing to show.
  assert.deepEqual(fileTracks(file({})), { tracks: [], loose: null });
  assert.deepEqual(fileTracks(file({ audioTracks: [] })), {
    tracks: [],
    loose: null,
  });
});

test("two tracks share a row only when their codecs are short", () => {
  assert.equal(COMPACT_CODEC_CHARS, 12);
  const tracks = (...codecs) =>
    codecs.map((codec, i) => ({ ...views[0], position: i + 1, codec }));
  const shown = ({ shown, more }) => [shown.map((t) => t.codec), more];
  assert.deepEqual(shown(compactTracks([])), [[], 0]);
  assert.deepEqual(shown(compactTracks(tracks("AC-3"))), [["AC-3"], 0]);
  assert.deepEqual(shown(compactTracks(tracks("AC-3", "AAC"))), [
    ["AC-3", "AAC"],
    0,
  ]);
  // 6 + 6 = 12 characters still share the row; 9 + 4 do not.
  assert.deepEqual(shown(compactTracks(tracks("E-AC-3", "DTS-HD"))), [
    ["E-AC-3", "DTS-HD"],
    0,
  ]);
  assert.deepEqual(shown(compactTracks(tracks("DTS-HD MA", "AC-3"))), [
    ["DTS-HD MA"],
    1,
  ]);
  assert.deepEqual(shown(compactTracks(tracks("AC-3", "AAC", "DTS", "FLAC"))), [
    ["AC-3", "AAC"],
    2,
  ]);
  assert.deepEqual(shown(compactTracks(tracks("DTS-HD MA", "E-AC-3", "AAC"))), [
    ["DTS-HD MA"],
    2,
  ]);
});

test("track names list number, language, codec, channels, default and title", () => {
  const words = {
    track: (n) => "Track " + n,
    language: (value) =>
      ({ Deutsch: "German", Englisch: "English", "": "Unknown" })[value] ??
      value,
    unknownChannels: "Unknown channels",
    defaultTrack: "Default track",
  };
  assert.deepEqual(
    views.map((track) => trackName(track, words)),
    [
      "Track 1 · German · DTS · 5.1 · Default track",
      "Track 2 · English · AC-3 · 2.0 · Commentary",
      "Track 3 · Unknown · Unknown · 8 ch",
    ],
  );
  assert.equal(
    trackName(
      {
        ...views[0],
        position: 4,
        channels: "",
        title: "Director",
        isDefault: true,
      },
      words,
    ),
    "Track 4 · German · DTS · Unknown channels · Default track · Director",
  );
});

test("track actions name only known parts", () => {
  assert.deepEqual(trackActions(views[0]), [
    { kind: "language", value: "Deutsch" },
    { kind: "codec", value: "DTS" },
    { kind: "channels", value: "5.1" },
    { kind: "combo", language: "Deutsch", codec: "DTS" },
  ]);
  assert.deepEqual(trackActions(views[2]), [
    { kind: "channels", value: "8 ch" },
  ]);
  // An unknown language ("und") is no part to filter by.
  assert.deepEqual(
    trackActions({ ...views[0], language: "und", codec: "AAC", channels: "" }),
    [{ kind: "codec", value: "AAC" }],
  );
  // A loose chip has no "same track".
  assert.deepEqual(
    looseActions({
      languages: ["Französisch", "und"],
      codecs: ["AAC"],
      channels: ["2.0"],
    }),
    [
      { kind: "language", value: "Französisch" },
      { kind: "codec", value: "AAC" },
      { kind: "channels", value: "2.0" },
    ],
  );
  assert.deepEqual(
    looseActions({ languages: [], codecs: [], channels: [] }),
    [],
  );
});
