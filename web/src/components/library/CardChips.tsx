import type { JSX } from "preact";
import { useContext } from "preact/hooks";
import { channelRows } from "../../audio-channels";
import { useI18n } from "../../i18n";
import { tagIsDisplayed } from "../../tag-display";
import { fileTracks } from "../../tracks";
import type { MediaFile, Settings } from "../../types";
import { bytes, HiddenTags, TagLabels } from "../../ui";
import { CustomTag } from "../list/CustomTag";
import { MediaTag } from "../list/MediaTag";
import {
  LooseChip,
  looseChipName,
  TrackChip,
  trackChipName,
} from "./TrackChip";

// The columns a phone card leaves out of its chip line: the title and its
// year stand on the first line, Info lives in the row menu.
const OFF_LINE = ["title", "year", "info"];
const known = (value: string) =>
  !!value.trim() && value.trim().toLowerCase() !== "unknown";

// The chip line of a phone card (docs/STYLEGUIDE.md, Part 1, 10.10; rc.4
// R6): the values of the visible columns in column order, on one line that
// fades out at its end (no wrap; the whole file is in File & metadata).
// Resolution, codec and source always (an unknown value as its muted tag),
// every other column only with a known value: processing without
// "Unknown", the HDR values, the bit depth, the size, a track chip per
// audio track (and the values without a track), a channels tag per track
// and the custom tags. Nothing in it is interactive, so a cut chip is no
// hidden target: the track chips are spans without their menu and an auto
// tag keeps its mark without its button (the edit dialog explains it).
export function CardChips({
  file,
  columns,
  settings,
}: {
  file: MediaFile;
  columns: string[];
  settings: Settings | null;
}): JSX.Element {
  useI18n();
  const labels = useContext(TagLabels);
  const hidden = useContext(HiddenTags);
  const chips = (field: string): (JSX.Element | null)[] => {
    switch (field) {
      case "resolution":
        return [
          <MediaTag
            key={field}
            respectHidden
            value={file.resolution}
            kind="resolution"
          />,
        ];
      case "codec":
        return [
          <MediaTag
            key={field}
            respectHidden
            value={file.codec}
            kind="codec"
            title={file.family}
          />,
        ];
      case "source":
        return [<MediaTag key={field} respectHidden value={file.source} />];
      case "processing":
        return known(file.processing)
          ? [
              <MediaTag
                key={field}
                respectHidden
                value={file.processing}
                kind="processing"
              />,
            ]
          : [];
      case "hdr":
        return (file.hdr ? file.hdr.split(" + ") : [])
          .filter(known)
          .map((value) => (
            <MediaTag
              key={field + value}
              respectHidden
              value={value}
              kind="hdr"
            />
          ));
      case "bitDepth":
        return known(file.bitDepth)
          ? [
              <MediaTag
                key={field}
                respectHidden
                value={file.bitDepth}
                kind="bitDepth"
              />,
            ]
          : [];
      case "size":
        return file.size > 0
          ? [
              <span key={field} class="v2-tag v2-tag--size">
                {bytes(file.size)}
              </span>,
            ]
          : [];
      case "audio": {
        const { tracks, loose } = fileTracks(file);
        const shown = loose && {
          languages: loose.languages,
          codecs: loose.codecs.filter((value) =>
            tagIsDisplayed(hidden, "audio", value),
          ),
          channels: loose.channels.filter((value) =>
            tagIsDisplayed(hidden, "channels", value),
          ),
        };
        return [
          ...tracks.map((track) => (
            <TrackChip
              key={"audio" + track.position}
              track={track}
              name={trackChipName(track, labels, hidden)}
            />
          )),
          shown &&
          shown.languages.length +
            shown.codecs.length +
            shown.channels.length ? (
            <LooseChip
              key="loose"
              loose={shown}
              name={looseChipName(shown, labels, tracks.length > 0)}
            />
          ) : null,
        ];
      }
      case "channels":
        return channelRows(file)
          .filter(known)
          .map((value, index) => (
            <MediaTag
              key={field + index}
              respectHidden
              value={value}
              kind="channels"
            />
          ));
      case "custom":
        return (file.custom || [])
          .filter((tag) => tagIsDisplayed(hidden, "custom", String(tag.id)))
          .map((tag) => (
            <CustomTag
              key={"custom" + tag.id}
              tag={tag}
              settings={settings}
              plain
            />
          ));
    }
    return [];
  };
  return (
    <div class="v2-table-chips">
      {columns.filter((field) => !OFF_LINE.includes(field)).flatMap(chips)}
    </div>
  );
}
