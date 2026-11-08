import type { ComponentChildren, JSX } from "preact";
import { useContext } from "preact/hooks";
import { userColorStyle } from "../../color";
import { getLocale, t, useI18n } from "../../i18n";
import { audioLanguageLabel } from "../../languages";
import { tagPresentation } from "../../tag-display";
import type { TagPresentation } from "../../tag-display";
import { presentedTagLabel } from "../../tag-labels";
import { trackName } from "../../tracks";
import type { LooseTracks, TrackView } from "../../tracks";
import {
  HiddenTags,
  TagColors,
  TagInformation,
  TagLabels,
  TagTextColors,
  TagVisibility,
} from "../../ui";
import { LanguageFlag } from "../LanguageFlag";

// A language as the interface names it ("German", "Unknown").
export const languageName = (value: string) =>
  t(audioLanguageLabel(value, getLocale()));
// A codec ("audio") or channel value as its tag reads: the user's tag label.
export const valueLabel = (
  kind: "audio" | "channels",
  value: string,
  labels: Record<string, string>,
) => value && presentedTagLabel(kind, value, labels);

// "Track 1 · German · DTS · 5.1[ · Default track][ · title]", with the
// labels the chip shows.
export function trackChipName(
  track: TrackView,
  labels: Record<string, string>,
): string {
  return trackName(
    {
      ...track,
      codec: valueLabel("audio", track.codec, labels),
      channels: valueLabel("channels", track.channels, labels),
    },
    {
      track: (number) => t("Track {number}", { number }),
      language: languageName,
      unknownChannels: t("Unknown channels"),
      defaultTrack: t("Default track"),
    },
  );
}
// A chip without a track assignment is named by its values (languages ·
// codecs · channels); beside tracks the 1.7.0 hint comes first.
export function looseChipName(
  loose: LooseTracks,
  labels: Record<string, string>,
  beside: boolean,
): string {
  return [
    beside ? t("Additional reported values without track attribution") : "",
    loose.languages.map(languageName).join(", "),
    loose.codecs.map((value) => valueLabel("audio", value, labels)).join(", "),
    loose.channels
      .map((value) => valueLabel("channels", value, labels))
      .join(", "),
  ]
    .filter(Boolean)
    .join(" · ");
}

// The 1.7.0 tag rules of the audio and channels cells (ruling P4): what
// tagPresentation decides for a value with respectHidden.
function usePresent() {
  const input = {
    visibility: useContext(TagVisibility),
    information: useContext(TagInformation),
    hidden: useContext(HiddenTags),
    colors: useContext(TagColors),
    textColors: useContext(TagTextColors),
    tagLabels: useContext(TagLabels),
    customNames: {},
    groupSD: false,
    translate: t,
  };
  return (kind: "audio" | "channels", value: string) =>
    tagPresentation({ ...input, value, kind, respectHidden: true });
}
// A codec (a) or channels (c) segment: none for a hidden value, plain text
// (v2-trk-text) for an information-only one, else the value with its user
// color.
function segment(part: "a" | "c", shown: TagPresentation | null, key = "") {
  if (!shown) return null;
  return (
    <span
      key={key}
      class={"v2-trk-" + part + (shown.asTag ? "" : " v2-trk-text")}
      style={
        shown.asTag ? userColorStyle(shown.color, shown.textColor) : undefined
      }
    >
      {shown.text}
    </span>
  );
}
const flag = (value: string) => (
  <LanguageFlag key={value} value={value} focusable={false} />
);
// With a menu a button (aria-haspopup, aria-expanded), else a span; the
// name is also the title.
function chip(
  className: string,
  name: string,
  onOpen: ((anchor: HTMLElement) => void) | undefined,
  expanded: boolean,
  children: ComponentChildren,
) {
  return onOpen ? (
    <button
      type="button"
      class={className}
      aria-haspopup="menu"
      aria-expanded={expanded}
      aria-label={name}
      title={name}
      onClick={(event) => onOpen(event.currentTarget)}
    >
      {children}
    </button>
  ) : (
    <span class={className} title={name}>
      {children}
    </span>
  );
}

// The track chip (docs/STYLEGUIDE.md, Part 1, 2.5 and 10.10): one chip
// [flag | codec | channels] in the audio tag surface, without a default dot;
// stretch fills a stack's width.
export function TrackChip({
  track,
  name,
  onOpen,
  expanded = false,
  stretch = false,
}: {
  track: TrackView;
  name: string;
  onOpen?(anchor: HTMLElement): void;
  expanded?: boolean;
  stretch?: boolean;
}): JSX.Element {
  useI18n();
  const present = usePresent();
  return chip(
    "v2-trk" + (stretch ? " v2-trk--stretch" : ""),
    name,
    onOpen,
    expanded,
    <>
      <span class="v2-trk-f">{flag(track.language)}</span>
      {segment("a", present("audio", track.codec))}
      {segment("c", present("channels", track.channels))}
    </>,
  );
}

// Values without a track assignment: one dashed chip, the languages' flags
// in one segment and a segment per codec and per channel value.
export function LooseChip({
  loose,
  name,
  onOpen,
  expanded = false,
}: {
  loose: LooseTracks;
  name: string;
  onOpen?(anchor: HTMLElement): void;
  expanded?: boolean;
}): JSX.Element {
  useI18n();
  const present = usePresent();
  return chip(
    "v2-trk v2-trk--loose",
    name,
    onOpen,
    expanded,
    <>
      {loose.languages.length > 0 && (
        <span class="v2-trk-f">{loose.languages.map(flag)}</span>
      )}
      {loose.codecs.map((value) =>
        segment("a", present("audio", value), value),
      )}
      {loose.channels.map((value) =>
        segment("c", present("channels", value), value),
      )}
    </>,
  );
}
