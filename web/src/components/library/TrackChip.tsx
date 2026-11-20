import type { ComponentChildren, JSX } from "preact";
import { useContext } from "preact/hooks";
import { userColorStyle } from "../../color";
import { getLocale, t, useI18n } from "../../i18n";
import { audioLanguageLabel, isUnknownAudioLanguage } from "../../languages";
import { tagIsDisplayed, tagPresentation } from "../../tag-display";
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
// labels the chip shows and without a hidden codec or channel value (as Tag
// respectHidden, which left it out entirely).
export function trackChipName(
  track: TrackView,
  labels: Record<string, string>,
  hidden: Record<string, boolean>,
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
    {
      codec: !tagIsDisplayed(hidden, "audio", track.codec),
      channels: !tagIsDisplayed(hidden, "channels", track.channels),
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
// color, muted (v2-trk-unknown) when it is unknown.
function segment(part: "a" | "c", shown: TagPresentation | null, key = "") {
  if (!shown) return null;
  return (
    <span
      key={key}
      class={
        "v2-trk-" +
        part +
        (!shown.asTag ? " v2-trk-text" : shown.unknown ? " v2-trk-unknown" : "")
      }
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
// The flag segment of one language, muted when it is unknown.
const flagSegment = (language: string) => (
  <span
    class={
      "v2-trk-f" + (isUnknownAudioLanguage(language) ? " v2-trk-unknown" : "")
    }
  >
    {flag(language)}
  </span>
);
// The segments shown, with a space between each two, so a chip's text
// reads as separate words ("DTS 5.1") that its name holds (WCAG 2.5.3).
// The spaces between the chip's flex items are not rendered.
const apart = (parts: ComponentChildren[]) =>
  parts
    .filter((part) => part !== null && part !== false && part !== undefined)
    .flatMap((part, at) => (at ? [" ", part] : [part]));
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
    apart([
      flagSegment(track.language),
      segment("a", present("audio", track.codec)),
      segment("c", present("channels", track.channels)),
    ]),
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
    apart([
      loose.languages.length > 0 && (
        <span class="v2-trk-f">{loose.languages.map(flag)}</span>
      ),
      ...loose.codecs.map((value) =>
        segment("a", present("audio", value), value),
      ),
      ...loose.channels.map((value) =>
        segment("c", present("channels", value), value),
      ),
    ]),
  );
}

// A file without any audio value, as the 1.7.0 audio cell: an unknown
// language and an "Unknown" audio tag (hidden with audio:__unknown__), one
// muted chip without a menu.
export function UnknownChip(): JSX.Element {
  useI18n();
  const present = usePresent();
  return chip(
    "v2-trk v2-trk--unknown",
    t("Unknown"),
    undefined,
    false,
    apart([flagSegment(""), segment("a", present("audio", ""))]),
  );
}
