import type { JSX } from "preact";
import { useContext, useState } from "preact/hooks";
import { t, useI18n } from "../../i18n";
import type { TrackFilterAction } from "../../library-filters";
import {
  compactTracks,
  fileTracks,
  looseActions,
  trackActions,
} from "../../tracks";
import type { MediaFile } from "../../types";
import { TagLabels } from "../../ui";
import {
  LooseChip,
  looseChipName,
  TrackChip,
  trackChipName,
} from "./TrackChip";
import { TrackMenu } from "./TrackMenu";
import { TracksPopover } from "./TracksPopover";

// The audio tracks column (docs/STYLEGUIDE.md, Part 1, 10.10). Compact: at
// most two chips and +n, which opens every track in TracksPopover; stacked:
// every track on a line of its own. Values without a track assignment form
// one dashed chip; a file without any audio value shows "—" (ruling
// P11/M6). A chip with a known part opens its TrackMenu; one menu or
// popover is open at a time, and a second press closes it.
export function TracksCell({
  file,
  stacked,
  onFilter,
}: {
  file: MediaFile;
  stacked: boolean;
  onFilter(action: TrackFilterAction): void;
}): JSX.Element {
  useI18n();
  const labels = useContext(TagLabels);
  const [open, setOpen] = useState<{
    key: string;
    anchor: HTMLElement;
  } | null>(null);
  const { tracks, loose } = fileTracks(file);
  if (!tracks.length && !loose) return <span class="v2-trk-quiet">—</span>;
  const { shown, more } = stacked
    ? { shown: tracks, more: 0 }
    : compactTracks(tracks);
  const toggle = (key: string) => (anchor: HTMLElement) =>
    setOpen(open?.key === key ? null : { key, anchor });
  // The menu of each chip, by its key: the track's position, or "loose".
  const menus: Record<string, TrackFilterAction[]> = {};
  const opener = (key: string, actions: TrackFilterAction[]) => {
    menus[key] = actions;
    return actions.length ? toggle(key) : undefined;
  };
  const close = () => setOpen(null);
  const all = t("Show all {count} audio tracks", { count: tracks.length });
  const chips = shown.map((track) => {
    const key = String(track.position);
    return (
      <TrackChip
        key={key}
        track={track}
        name={trackChipName(track, labels)}
        onOpen={opener(key, trackActions(track))}
        expanded={open?.key === key}
        stretch={stacked}
      />
    );
  });
  const looseChip = loose && (
    <LooseChip
      loose={loose}
      name={looseChipName(loose, labels, tracks.length > 0)}
      onOpen={opener("loose", looseActions(loose))}
      expanded={open?.key === "loose"}
    />
  );
  const actions = open && menus[open.key];
  return (
    <div class={stacked ? "v2-trk-stack" : "v2-trk-row"}>
      {chips}
      {more > 0 && (
        <button
          type="button"
          class="v2-trk v2-trk--more"
          aria-haspopup="dialog"
          aria-expanded={open?.key === "more"}
          aria-label={all}
          title={all}
          onClick={(event) => toggle("more")(event.currentTarget)}
        >
          +{more}
        </button>
      )}
      {looseChip}
      {open && actions && (
        <TrackMenu
          anchor={open.anchor}
          actions={actions}
          choose={onFilter}
          close={close}
        />
      )}
      {open?.key === "more" && more > 0 && (
        <TracksPopover
          file={file}
          tracks={tracks}
          anchor={open.anchor}
          close={close}
        />
      )}
    </div>
  );
}
