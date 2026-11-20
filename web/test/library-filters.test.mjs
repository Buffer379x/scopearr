import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTRIBUTE_FIELDS,
  STATE_FIELDS,
  TRACK_COMBO_MAX,
  activeFilterCount,
  fieldOperator,
  fieldValues,
  filterChips,
  filterOptions,
  formatTrackCombo,
  matchCountPath,
  parseTrackCombo,
  placeholderRows,
  rangeInput,
  stateChoice,
  stateFieldsFor,
  trackCombos,
  withFieldOperator,
  withFieldValues,
  withRangeInput,
  withStateChoice,
  withTrackAction,
  withTrackCombos,
  limitTrackCombos,
} from "../src/library-filters.ts";

// The library's filters as pure functions over the route's query string
// (Phase 5a, task 2). Every expectation is a literal: the 1.7.0 filter panel
// (FilterPanel, MultiFilter, StateFilter) wrote and named these parameters.

const spec = (name) => STATE_FIELDS.find((field) => field.name === name);

test("operators write the 1.7.0 parameters", () => {
  assert.deepEqual(
    [...ATTRIBUTE_FIELDS],
    [
      "resolution",
      "codec",
      "source",
      "processing",
      "family",
      "bitDepth",
      "hdr",
      "audio",
      "language",
      "channels",
      "custom",
    ],
  );
  assert.equal(fieldOperator("codec=x265&codecOp=not", "codec"), "not");
  assert.equal(fieldOperator("hdrOp=notAll", "hdr"), "notAll");
  assert.equal(fieldOperator("", "hdr"), "eq");
  assert.equal(fieldOperator("hdrOp=bogus", "hdr"), "eq");
  // = and ≠, all and not all, each stored as <field>Op; eq removes the key.
  assert.equal(
    withFieldOperator("codec=x265", "codec", "not"),
    "codec=x265&codecOp=not",
  );
  assert.equal(
    withFieldOperator("hdrOp=all&hdr=HDR10", "hdr", "notAll"),
    "hdr=HDR10&hdrOp=notAll",
  );
  assert.equal(
    withFieldOperator("codec=x265&codecOp=not&q=alien", "codec", "eq"),
    "codec=x265&q=alien",
  );
  assert.equal(withFieldOperator("q=alien", "audio", "eq"), "q=alien");
  // Values keep their order and move to the end, as 1.7.0's change() did;
  // an emptied field keeps its prepared operator.
  assert.deepEqual(fieldValues("codec=x265&q=alien&codec=AV1", "codec"), [
    "x265",
    "AV1",
  ]);
  assert.deepEqual(fieldValues("q=alien", "codec"), []);
  assert.equal(
    withFieldValues("codec=x264&q=alien", "codec", ["x265", "AV1"]),
    "q=alien&codec=x265&codec=AV1",
  );
  assert.equal(
    withFieldValues("codec=x265&codecOp=not", "codec", []),
    "codecOp=not",
  );
});

test("state fields follow service and MediaInfo", () => {
  const names = (fields) => fields.map((field) => field.name);
  const matching = [
    "mediaMatched",
    "mediaMissing",
    "mediaAmbiguous",
    "mediaConflicting",
    "mediaNoTracks",
    "mediaPending",
    "mediaUnconfigured",
  ];
  assert.deepEqual(names(stateFieldsFor("radarr", "", false)), [
    "conflict",
    "ruleConflict",
    "confirmed",
    "metadata",
    ...matching,
  ]);
  // MediaInfo only when it is enabled or its filter is set.
  for (const [query, enabled] of [
    ["", true],
    ["mediaInfo=false", false],
  ])
    assert.deepEqual(names(stateFieldsFor("radarr", query, enabled)), [
      "conflict",
      "ruleConflict",
      "confirmed",
      "mediaInfo",
      "metadata",
      ...matching,
    ]);
  // TV series add the two season outliers after the metadata status.
  assert.deepEqual(names(stateFieldsFor("sonarr", "", false)), [
    "conflict",
    "ruleConflict",
    "confirmed",
    "metadata",
    "seasonOutlier",
    "languageOutlier",
    ...matching,
  ]);
  assert.deepEqual(
    STATE_FIELDS.map((field) => [
      field.name,
      field.label,
      field.group,
      field.positive,
      field.negative,
    ]),
    [
      ["conflict", "Metadata disagreement", "quality", "true", "false"],
      [
        "ruleConflict",
        "Conflicting recognition rules",
        "quality",
        "true",
        "false",
      ],
      ["confirmed", "Manually confirmed", "quality", "true", "false"],
      ["mediaInfo", "MediaInfo read", "quality", "true", "false"],
      ["metadata", "Incomplete metadata", "quality", "incomplete", "complete"],
      ["seasonOutlier", "Technical outliers", "quality", "true", "false"],
      ["languageOutlier", "Language outliers", "quality", "true", "false"],
      [
        "mediaMatched",
        "Matched with audio tracks",
        "matching",
        "true",
        "false",
      ],
      ["mediaMissing", "Not found", "matching", "true", "false"],
      ["mediaAmbiguous", "Ambiguous", "matching", "true", "false"],
      [
        "mediaConflicting",
        "Conflicting media server metadata",
        "matching",
        "true",
        "false",
      ],
      [
        "mediaNoTracks",
        "Matched, audio tracks missing",
        "matching",
        "true",
        "false",
      ],
      [
        "mediaPending",
        "Awaiting media server matching",
        "matching",
        "true",
        "false",
      ],
      [
        "mediaUnconfigured",
        "Without media server enrichment",
        "matching",
        "true",
        "false",
      ],
    ],
  );
  assert.equal(
    spec("metadata").help,
    "At least one required media attribute is unknown: resolution, codec, source, audio or language. Excluding this selects complete metadata; HDR may be SDR or unknown.",
  );
  assert.equal(
    spec("mediaPending").help,
    "The file is awaiting a media-server match after a cache or file update. Excluding this removes pending items.",
  );
  assert.ok(spec("seasonOutlier").series && spec("languageOutlier").series);
  assert.ok(spec("mediaInfo").mediaInfo);
  assert.ok(
    STATE_FIELDS.every((field) => field.help),
    "every state field has its help",
  );
  // A set value is active; the negative value excludes.
  assert.deepEqual(stateChoice("conflict=true", spec("conflict")), {
    active: true,
    exclude: false,
  });
  assert.deepEqual(stateChoice("conflict=false", spec("conflict")), {
    active: true,
    exclude: true,
  });
  assert.deepEqual(stateChoice("metadata=complete", spec("metadata")), {
    active: true,
    exclude: true,
  });
  assert.deepEqual(stateChoice("conflict=maybe", spec("conflict")), {
    active: false,
    exclude: false,
  });
  assert.equal(
    withStateChoice("q=alien", spec("conflict"), {
      active: true,
      exclude: true,
    }),
    "q=alien&conflict=false",
  );
  assert.equal(
    withStateChoice("conflict=true&q=alien", spec("conflict"), {
      active: false,
      exclude: false,
    }),
    "q=alien",
  );
});

test("preparing a state operator activates nothing", () => {
  // StateFilter.tsx: an operator chosen for an unchecked filter changes no
  // parameter; an inactive choice removes the key.
  assert.equal(
    withStateChoice("q=alien", spec("conflict"), {
      active: false,
      exclude: true,
    }),
    "q=alien",
  );
  assert.equal(
    withStateChoice("", spec("metadata"), { active: false, exclude: true }),
    "",
  );
  // An active filter switches to the other value.
  assert.equal(
    withStateChoice("metadata=incomplete", spec("metadata"), {
      active: true,
      exclude: true,
    }),
    "metadata=complete",
  );
  assert.equal(
    withStateChoice("mediaMissing=false", spec("mediaMissing"), {
      active: true,
      exclude: false,
    }),
    "mediaMissing=true",
  );
});

test("ranges keep years and convert gigabytes to bytes", () => {
  assert.equal(rangeInput("yearMin=2010", "year", "min"), "2010");
  assert.equal(rangeInput("yearMin=2010", "year", "max"), "");
  assert.equal(withRangeInput("", "year", "max", "2020"), "yearMax=2020");
  assert.equal(
    withRangeInput("yearMax=2020&q=alien", "year", "max", ""),
    "q=alien",
  );
  // The size fields read and write gigabytes (10^9 bytes) as 1.7.0 did.
  assert.equal(withRangeInput("", "size", "min", "1.5"), "sizeMin=1500000000");
  assert.equal(withRangeInput("", "size", "max", "0.1"), "sizeMax=100000000");
  assert.equal(rangeInput("sizeMin=1500000000", "size", "min"), "1.5");
  assert.equal(rangeInput("sizeMax=250000000", "size", "max"), "0.25");
  assert.equal(rangeInput("q=alien", "size", "max"), "");
  assert.equal(withRangeInput("sizeMin=1500000000", "size", "min", ""), "");
});

test("filter options keep the 1.7.0 lists", () => {
  const translations = { Unknown: "Unbekannt", "No custom tags": "Keine" };
  const ctx = {
    locale: "en",
    translate: (key) => translations[key] ?? key,
    customNames: { 7: "Kids", 9: "Anime" },
    tagLabels: { "source:WEBDL": "WEB-DL" },
    groupSD: true,
    hidden: { "source:CAM": true },
  };
  const pairs = (options) => options.map(({ value, label }) => [value, label]);
  // SD groups the lines below 720; unknown sorts last.
  assert.deepEqual(
    pairs(
      filterOptions(
        "resolution",
        ["1080p", "480p", "576p", "2160p", ""],
        [],
        ctx,
      ),
    ),
    [
      ["1080p", "1080p"],
      ["2160p", "2160p"],
      ["__sd__", "SD"],
      ["", "Unbekannt"],
    ],
  );
  // Without grouping, a selected SD drill-down stays offered.
  assert.deepEqual(
    pairs(
      filterOptions("resolution", ["480p", "1080p"], ["__sd__"], {
        ...ctx,
        groupSD: false,
      }),
    ),
    [
      ["1080p", "1080p"],
      ["480p", "480p"],
      ["__sd__", "SD"],
    ],
  );
  // Hidden tags leave the list; recognition labels name the values.
  assert.deepEqual(
    pairs(
      filterOptions(
        "source",
        ["WEBDL", "CAM", "BluRay", "__unknown__"],
        [],
        ctx,
      ),
    ),
    [
      ["BluRay", "BluRay"],
      ["WEBDL", "WEB-DL"],
      ["__unknown__", "Unbekannt"],
    ],
  );
  // Custom tags by their names; no tag reads "No custom tags".
  assert.deepEqual(
    pairs(filterOptions("custom", ["9", "7", "__unknown__", "12"], [], ctx)),
    [
      ["12", "12"],
      ["9", "Anime"],
      ["7", "Kids"],
      ["__unknown__", "Keine"],
    ],
  );
  // Languages by their names in the interface language, sorted there.
  assert.deepEqual(
    pairs(
      filterOptions(
        "language",
        ["Englisch", "Deutsch", "Französisch", ""],
        [],
        ctx,
      ),
    ),
    [
      ["Englisch", "English"],
      ["Französisch", "French"],
      ["Deutsch", "German"],
      ["", "Unbekannt"],
    ],
  );
  assert.deepEqual(
    pairs(
      filterOptions("language", ["Englisch", "Deutsch", "Französisch"], [], {
        ...ctx,
        locale: "de",
      }),
    ),
    [
      ["Deutsch", "Deutsch"],
      ["Englisch", "Englisch"],
      ["Französisch", "Französisch"],
    ],
  );
  assert.deepEqual(filterOptions("audio", [], [], ctx), []);
});

test("track combinations round-trip and stay within sixteen", () => {
  assert.equal(TRACK_COMBO_MAX, 16);
  assert.deepEqual(parseTrackCombo("Deutsch|AC-3|5.1"), {
    language: "Deutsch",
    codec: "AC-3",
    channels: "5.1",
  });
  // An empty part means any value; __unknown__ an unknown one.
  assert.deepEqual(parseTrackCombo(" Deutsch || "), {
    language: "Deutsch",
    codec: "",
    channels: "",
  });
  assert.deepEqual(parseTrackCombo("__unknown__||5.1"), {
    language: "__unknown__",
    codec: "",
    channels: "5.1",
  });
  // Three parts, at least one set, each at most 80 characters (Go).
  for (const value of [
    "||",
    "Deutsch|AC-3",
    "a|b|c|d",
    "",
    "x".repeat(81) + "||",
  ])
    assert.equal(parseTrackCombo(value), null, value);
  assert.deepEqual(parseTrackCombo("x".repeat(80) + "||"), {
    language: "x".repeat(80),
    codec: "",
    channels: "",
  });
  assert.equal(
    formatTrackCombo({ language: "Deutsch", codec: "", channels: "" }),
    "Deutsch||",
  );
  assert.equal(
    formatTrackCombo({ language: " __unknown__ ", codec: "", channels: "5.1" }),
    "__unknown__||5.1",
  );
  assert.equal(
    formatTrackCombo({ language: "", codec: "", channels: "" }),
    null,
  );
  // "|" never ends up inside a part.
  assert.equal(
    formatTrackCombo({ language: "", codec: "AC-3|DTS", channels: "" }),
    null,
  );
  assert.deepEqual(
    trackCombos(
      "track=Deutsch%7CAC-3%7C&track=bad&trackOp=all&track=%7C%7C5.1",
    ),
    [
      { language: "Deutsch", codec: "AC-3", channels: "" },
      { language: "", codec: "", channels: "5.1" },
    ],
  );
  assert.equal(
    withTrackCombos("q=alien&trackOp=all", [
      { language: "Deutsch", codec: "AC-3", channels: "" },
      { language: "", codec: "", channels: "5.1" },
    ]),
    "q=alien&trackOp=all&track=Deutsch%7CAC-3%7C&track=%7C%7C5.1",
  );
  assert.equal(
    withTrackCombos("track=Deutsch%7C%7C", [
      { language: "", codec: "", channels: "" },
    ]),
    "",
  );
  // The seventeenth combination is dropped, reading and writing.
  const seventeen = Array.from({ length: 17 }, (_, i) => ({
    language: "",
    codec: "c" + i,
    channels: "",
  }));
  const written = new URLSearchParams(withTrackCombos("", seventeen)).getAll(
    "track",
  );
  assert.equal(written.length, 16);
  assert.equal(written[15], "|c15|");
  const query = seventeen.map((_, i) => "track=%7Cc" + i + "%7C").join("&");
  assert.equal(trackCombos(query).length, 16);
  assert.deepEqual(trackCombos(query)[15], {
    language: "",
    codec: "c15",
    channels: "",
  });
});

const words = {
  field: (key) =>
    ({
      resolution: "Resolution",
      codec: "Codec / encoder",
      hdr: "HDR",
      audio: "Audio codec",
      language: "Language",
      channels: "Channels",
      custom: "Custom",
    })[key],
  value: (key, value) =>
    key === "language"
      ? ({ Deutsch: "German", Englisch: "English" }[value] ?? value)
      : key === "embyMatch"
        ? ({ missing: "Not found in media server" }[value] ?? value)
        : value,
  instance: (id) => ({ "radarr-4k": "Radarr 4K" })[id] ?? id,
  translate: (key) => key,
};

test("chips name every filter as 1.7.0 did", () => {
  const query = [
    "q=alien",
    "instance=radarr-4k",
    "resolution=1080p",
    "resolution=__unknown__",
    "resolutionOp=not",
    "hdr=HDR10",
    "hdr=Dolby+Vision",
    "hdrOp=all",
    "language=Deutsch",
    "conflict=false",
    "confirmed=false",
    "mediaInfo=true",
    "metadata=incomplete",
    "embyMatch=missing",
    "mediaMatched=true",
    "seasonOutlier=false",
    "yearMin=2010",
    "sizeMax=2000000000",
    "unknownYear=true",
    "track=Deutsch%7CAC-3%7C5.1",
    "track=__unknown__%7C%7C",
    "trackOp=notAll",
    "sort=year",
    "dir=desc",
  ].join("&");
  assert.deepEqual(
    filterChips(query, words).map((chip) => [chip.label, chip.excluded]),
    [
      ["Search: alien", false],
      ["Service: Radarr 4K", false],
      ["Resolution ≠ 1080p", true],
      ["Resolution ≠ Unknown", true],
      ["HDR contains all: HDR10 + Dolby Vision", false],
      ["Language: German", false],
      ["Metadata disagreement: is not", false],
      ["Manually confirmed: is not", true],
      ["MediaInfo read: is", false],
      ["Metadata status: incomplete", false],
      ["Media server matching: Not found in media server", false],
      ["Matched with audio tracks: is", false],
      ["Technical outliers: is not", false],
      ["From: 2010", false],
      ["Bytes to: 2000000000", false],
      ["Unknown year: true", false],
      [
        "Audio track combination does not contain all: German · AC-3 · 5.1 + Unknown",
        true,
      ],
    ],
  );
  // One chip per track combination, ≠ for not; empty parts are left out.
  assert.deepEqual(
    filterChips(
      "track=Englisch%7C%7C&track=%7CDTS%7C7.1&trackOp=not&metadata=complete&custom=__unknown__",
      words,
    ).map((chip) => [chip.label, chip.excluded]),
    [
      ["Audio track combination ≠ English", true],
      ["Audio track combination ≠ DTS · 7.1", true],
      ["Metadata status: complete", false],
      ["Custom: Unknown", false],
    ],
  );
  // A chip removes its value, or the whole field with all/not all; the
  // prepared operator stays, as 1.7.0's change() left it.
  const without = (q) =>
    filterChips(q, words).map((chip) => [chip.label, chip.without]);
  assert.deepEqual(
    without("hdr=HDR10&hdr=Dolby+Vision&hdrOp=all&codec=x265&codec=AV1"),
    [
      [
        "HDR contains all: HDR10 + Dolby Vision",
        "hdrOp=all&codec=x265&codec=AV1",
      ],
      [
        "Codec / encoder: x265",
        "hdr=HDR10&hdr=Dolby+Vision&hdrOp=all&codec=AV1",
      ],
      [
        "Codec / encoder: AV1",
        "hdr=HDR10&hdr=Dolby+Vision&hdrOp=all&codec=x265",
      ],
    ],
  );
  assert.deepEqual(without("codec=x264&codec=x265&resolution=1080p&q=alien"), [
    ["Codec / encoder: x264", "resolution=1080p&q=alien&codec=x265"],
    ["Codec / encoder: x265", "resolution=1080p&q=alien&codec=x264"],
    ["Resolution: 1080p", "codec=x264&codec=x265&q=alien"],
    ["Search: alien", "codec=x264&codec=x265&resolution=1080p"],
  ]);
  assert.deepEqual(without("track=Deutsch%7C%7C&track=%7CAC-3%7C"), [
    ["Audio track combination: German", "track=%7CAC-3%7C"],
    ["Audio track combination: AC-3", "track=Deutsch%7C%7C"],
  ]);
  // Every chip has its own key, also for a repeated value.
  const keys = filterChips(
    "codec=x265&codec=x265&hdr=A&hdr=B&hdrOp=all",
    words,
  ).map((chip) => chip.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(keys.length, 3);
  // Words come from the caller: labels and states go through translate.
  const marked = { ...words, translate: (key) => "<" + key + ">" };
  assert.deepEqual(
    filterChips(
      "q=alien&conflict=true&source=__unknown__&hdr=A&hdr=B&hdrOp=notAll",
      marked,
    ).map((chip) => chip.label),
    [
      "<Search>: alien",
      "<Metadata disagreement>: <is>",
      "source: <Unknown>",
      "HDR <does not contain all>: A + B",
    ],
  );
  assert.deepEqual(filterChips("", words), []);
  // An unknown part: channels by their own word; language and codec have
  // none and read "Unknown".
  assert.deepEqual(
    filterChips(
      "track=__unknown__%7C%7C&track=%7C__unknown__%7C&track=%7C%7C__unknown__&track=__unknown__%7C__unknown__%7C__unknown__",
      words,
    ).map((chip) => chip.label),
    [
      "Audio track combination: Unknown",
      "Audio track combination: Unknown",
      "Audio track combination: Unknown channels",
      "Audio track combination: Unknown · Unknown · Unknown channels",
    ],
  );
  assert.equal(
    filterChips("track=%7C%7C__unknown__", marked)[0].label,
    "<Audio track combination>: <Unknown channels>",
  );
});

test("the filter count leaves the search and the instance out", () => {
  assert.equal(activeFilterCount(""), 0);
  assert.equal(activeFilterCount("q=alien"), 0);
  // The instance segment is navigation, not a filter (final review I3).
  assert.equal(activeFilterCount("instance=radarr-4k"), 0);
  assert.equal(activeFilterCount("instance=radarr-4k&q=alien&codec=x265"), 1);
  assert.equal(activeFilterCount("q=alien&codec=x265&codec=AV1"), 2);
  // all and not all are one chip; an operator alone is no filter.
  assert.equal(activeFilterCount("hdr=HDR10&hdr=HLG&hdrOp=all"), 1);
  assert.equal(activeFilterCount("hdrOp=all&trackOp=not"), 0);
  assert.equal(
    activeFilterCount(
      "track=Deutsch%7C%7C&track=%7CDTS%7C&trackOp=notAll&instance=radarr-4k&metadata=incomplete",
    ),
    2,
  );
});

test("a track action replaces only its field", () => {
  assert.equal(
    withTrackAction("language=Englisch&languageOp=notAll&codec=x265", {
      kind: "language",
      value: "Deutsch",
    }),
    "codec=x265&language=Deutsch",
  );
  // The track's codec is the audio codec field.
  assert.equal(
    withTrackAction("audio=DTS&q=alien", { kind: "codec", value: "AC-3" }),
    "q=alien&audio=AC-3",
  );
  assert.equal(
    withTrackAction("channels=2.0&channelsOp=not", {
      kind: "channels",
      value: "5.1",
    }),
    "channels=5.1",
  );
  // Language with codec sets one track combination and resets its operator.
  assert.equal(
    withTrackAction(
      "track=Englisch%7C%7C&track=%7CDTS%7C&trackOp=not&language=Englisch",
      { kind: "combo", language: "Deutsch", codec: "AC-3" },
    ),
    "language=Englisch&track=Deutsch%7CAC-3%7C",
  );
});

test("the match count asks for one file", () => {
  assert.equal(
    matchCountPath(
      "sonarr",
      "q=alien&page=4&sort=year&dir=desc&limit=50&service=radarr&codec=x265",
    ),
    "files?q=alien&codec=x265&service=sonarr&limit=1",
  );
  assert.equal(matchCountPath("radarr", ""), "files?service=radarr&limit=1");
  // The instance and the track combinations with their operator stay.
  assert.equal(
    matchCountPath(
      "radarr",
      "instance=radarr-4k&track=Deutsch%7C%7C&track=%7CDTS%7C&trackOp=notAll&page=2",
    ),
    "files?instance=radarr-4k&track=Deutsch%7C%7C&track=%7CDTS%7C&trackOp=notAll&service=radarr&limit=1",
  );
});

test("a seventeenth combination is never read or written", () => {
  const tracks = (n) =>
    Array.from({ length: n }, (_, i) => "track=%7Cc" + (i + 1) + "%7C").join(
      "&",
    );
  const route = "q=alien&" + tracks(17) + "&trackOp=not";
  const within = "q=alien&" + tracks(16) + "&trackOp=not";
  // Chips and the count read the first 16.
  const chips = filterChips(route, words);
  assert.equal(chips.length, 17, "the search and 16 combinations");
  assert.equal(chips[16].label, "Audio track combination ≠ c16");
  assert.ok(chips.every((chip) => !chip.label.endsWith("c17")));
  assert.equal(activeFilterCount(route), 16);
  assert.equal(fieldValues(route, "track").length, 16);
  assert.equal(trackCombos(route).length, 16);
  // Removing any chip, and every other write, leaves the route within it.
  assert.equal(chips[0].without, tracks(16) + "&trackOp=not");
  assert.equal(
    chips[1].without,
    "q=alien&trackOp=not&" + tracks(16).replace("track=%7Cc1%7C&", ""),
  );
  assert.equal(
    withFieldOperator(route, "track", "all"),
    "q=alien&" + tracks(16) + "&trackOp=all",
  );
  assert.equal(
    withTrackAction(route, { kind: "language", value: "Deutsch" }),
    within + "&language=Deutsch",
  );
  assert.equal(
    withTrackAction(route, {
      kind: "combo",
      language: "Deutsch",
      codec: "DTS",
    }),
    "q=alien&track=Deutsch%7CDTS%7C",
  );
  assert.equal(
    withFieldValues(
      "",
      "track",
      fieldValues(tracks(16), "track").concat("|c17|"),
    ),
    tracks(16),
  );
  assert.equal(
    matchCountPath("radarr", route),
    "files?" + within + "&service=radarr&limit=1",
  );
  // With all/not all the one chip lists the first 16.
  assert.equal(
    filterChips(tracks(17) + "&trackOp=all", words)[0].label,
    "Audio track combination contains all: " +
      Array.from({ length: 16 }, (_, i) => "c" + (i + 1)).join(" + "),
  );
  // The route itself, trimmed only when it holds more than 16.
  assert.equal(limitTrackCombos(route), within);
  assert.equal(
    limitTrackCombos("q=a%20b&" + tracks(16)),
    "q=a%20b&" + tracks(16),
  );
});

test("a track part names one language, as Go reads it", () => {
  // Go's normLanguage splits on / , and ; and rejects two languages.
  for (const language of [
    "Deutsch, Englisch",
    "Deutsch/Englisch",
    "Deutsch;Englisch",
    "Deutsch / German, Englisch",
    "und/und",
    ",",
  ]) {
    assert.equal(parseTrackCombo(language + "|AC-3|"), null, language);
    assert.equal(
      formatTrackCombo({ language, codec: "AC-3", channels: "" }),
      null,
      language,
    );
  }
  // One language however written; an unknown name counts for none.
  for (const language of [
    "Deutsch",
    "Deutsch/German",
    "Deutsch,",
    "und/Deutsch",
    "und",
    "__unknown__",
  ])
    assert.equal(
      formatTrackCombo({ language, codec: "", channels: "" }),
      language + "||",
      language,
    );
  assert.deepEqual(
    trackCombos("track=Deutsch%2C+Englisch%7C%7C&track=Deutsch%7C%7C"),
    [{ language: "Deutsch", codec: "", channels: "" }],
  );
  // Codec and channels are exact values; a comma there is no list.
  assert.equal(
    formatTrackCombo({ language: "", codec: "DTS, AC-3", channels: "" }),
    "|DTS, AC-3|",
  );
});

test("placeholders cover the page until results arrive", () => {
  assert.equal(placeholderRows(false, 100, 12), 12);
  assert.equal(placeholderRows(false, 100, 5000), 100);
  assert.equal(placeholderRows(false, 50, 0), 0);
  assert.equal(placeholderRows(true, 100, 5000), 0);
});
