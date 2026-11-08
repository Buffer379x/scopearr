// A file's audio tracks for the TracksCell (docs/STYLEGUIDE.md, Part 1,
// 10.10): the logic of the 1.7.0 AudioCell and channelRows. Tracks are
// measurements: an active audio or language confirmation shows the file's
// values instead, without a track assignment.
import { audioChannelLayout, channelRows } from "./audio-channels.ts";
import { hasActiveFieldConfirmation } from "./confirmation-summary.ts";
import { isUnknownAudioLanguage } from "./languages.ts";
import { formatTrackCombo } from "./library-filters.ts";
import type { TrackFilterAction } from "./library-filters.ts";
import type { MediaFile } from "./types";

// position: the track's place among the file's audio tracks, from 1;
// channels: its normalized layout ("5.1", "6 ch"); "" means unknown.
export type TrackView = {
  position: number;
  language: string;
  codec: string;
  channels: string;
  title: string;
  isDefault: boolean;
};
export type LooseTracks = {
  languages: string[];
  codecs: string[];
  channels: string[];
};
const unique = (values: string[]) => [
  ...new Set(values.map((value) => value.trim()).filter(Boolean)),
];
const loose = (values: LooseTracks) =>
  values.languages.length || values.codecs.length || values.channels.length
    ? values
    : null;
// tracks: the measured tracks; loose: values reported without a track (beside
// tracks: languages and codecs no track has), or all of the file's values.
// No tracks and no values: show "—".
export function fileTracks(file: MediaFile): {
  tracks: TrackView[];
  loose: LooseTracks | null;
} {
  const measured = file.audioTracks || [];
  if (
    measured.length &&
    !hasActiveFieldConfirmation(file, "audio") &&
    !hasActiveFieldConfirmation(file, "language")
  ) {
    const languages = new Set(measured.map((track) => track.language)),
      codecs = new Set(measured.map((track) => track.codec));
    return {
      tracks: measured.map((track, index) => ({
        position: index + 1,
        language: track.language || "",
        codec: track.codec || "",
        channels: audioChannelLayout(track),
        title: track.title || "",
        isDefault: !!track.default,
      })),
      loose: loose({
        languages: unique(file.language.split(", ")).filter(
          (value) => !languages.has(value),
        ),
        codecs: unique(file.audio.split(" + ")).filter(
          (value) => !codecs.has(value),
        ),
        channels: [],
      }),
    };
  }
  return {
    tracks: [],
    loose: loose({
      languages: unique(file.language.split(/[,;/|]/)),
      codecs: unique(file.audio.split(" + ")),
      channels: unique(channelRows(file)),
    }),
  };
}

// Compact: one chip, two when both codecs together have at most 12
// characters; the rest behind +n.
export const COMPACT_CODEC_CHARS = 12;
export function compactTracks(tracks: readonly TrackView[]): {
  shown: TrackView[];
  more: number;
} {
  const count =
    tracks.length > 1 &&
    [...tracks[0].codec].length + [...tracks[1].codec].length <=
      COMPACT_CODEC_CHARS
      ? 2
      : Math.min(tracks.length, 1);
  return { shown: tracks.slice(0, count), more: tracks.length - count };
}

// "Track 1 · German · DTS · 5.1[ · Default track][ · title]". An unknown
// codec reads as an unknown language does (language("")).
export type TrackWords = {
  track(n: number): string;
  language(value: string): string;
  unknownChannels: string;
  defaultTrack: string;
};
export function trackName(track: TrackView, words: TrackWords): string {
  return [
    words.track(track.position),
    words.language(track.language),
    track.codec || words.language(""),
    track.channels || words.unknownChannels,
    track.isDefault ? words.defaultTrack : "",
    track.title,
  ]
    .filter(Boolean)
    .join(" · ");
}

const known = (language: string) => !isUnknownAudioLanguage(language);
// The track menu: "Only {value}" for each known part, then language with
// codec on the same track when both are known.
export function trackActions(track: TrackView): TrackFilterAction[] {
  const actions = looseActions({
    languages: [track.language],
    codecs: [track.codec],
    channels: [track.channels],
  });
  // formatTrackCombo also leaves out a value the API would reject.
  if (
    known(track.language) &&
    track.codec.trim() &&
    formatTrackCombo({
      language: track.language,
      codec: track.codec,
      channels: "",
    })
  )
    actions.push({
      kind: "combo",
      language: track.language,
      codec: track.codec,
    });
  return actions;
}
// A loose chip's menu: every value on its own, no "same track".
export function looseActions(values: LooseTracks): TrackFilterAction[] {
  return [
    ...values.languages
      .filter(known)
      .map((value) => ({ kind: "language" as const, value })),
    ...values.codecs
      .filter((value) => value.trim())
      .map((value) => ({ kind: "codec" as const, value })),
    ...values.channels
      .filter((value) => value.trim())
      .map((value) => ({ kind: "channels" as const, value })),
  ];
}
