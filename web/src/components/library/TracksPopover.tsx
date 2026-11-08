import type { JSX } from "preact";
import { useContext } from "preact/hooks";
import { t, useI18n } from "../../i18n";
import type { TrackView } from "../../tracks";
import type { MediaFile } from "../../types";
import { TagLabels } from "../../ui";
import { Popover } from "../frame/Popover";
import { languageName, TrackChip, trackChipName } from "./TrackChip";

// Every track of a file (docs/STYLEGUIDE.md, Part 1, 10.10): a Popover
// dialog "Audio tracks of {title}" at the track width, with a table of the
// static chips, their language, title and default (Yes or No).
export function TracksPopover({
  file,
  tracks,
  anchor,
  close,
}: {
  file: MediaFile;
  tracks: TrackView[];
  anchor: HTMLElement;
  close(returnFocus: boolean): void;
}): JSX.Element {
  useI18n();
  const labels = useContext(TagLabels);
  const label = t("Audio tracks of {title}", { title: file.title });
  return (
    <Popover
      anchor={anchor}
      placement="bottom-end"
      role="dialog"
      label={label}
      wide="track"
      close={close}
    >
      <p class="v2-pop-title">{label}</p>
      <table class="v2-trk-table">
        <thead>
          <tr>
            <th scope="col">{t("Track")}</th>
            <th scope="col">{t("Language")}</th>
            <th scope="col">{t("Title")}</th>
            <th scope="col">{t("Default")}</th>
          </tr>
        </thead>
        <tbody>
          {tracks.map((track) => (
            <tr key={track.position}>
              <td>
                <TrackChip track={track} name={trackChipName(track, labels)} />
              </td>
              <td>{languageName(track.language)}</td>
              <td>{track.title || <span class="v2-trk-quiet">—</span>}</td>
              <td>{track.isDefault ? t("Yes") : t("No")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Popover>
  );
}
