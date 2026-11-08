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
import { tagIsDisplayed } from "../../tag-display";
import type { MediaFile } from "../../types";
import { HiddenTags, TagLabels } from "../../ui";
import {
  LooseChip,
  looseChipName,
  TrackChip,
  trackChipName,
  UnknownChip,
} from "./TrackChip";
import { TrackMenu } from "./TrackMenu";
import { TracksPopover } from "./TracksPopover";

// The audio tracks column (docs/STYLEGUIDE.md, Part 1, 10.10). Compact: at
// most two chips and +n, which opens every track in TracksPopover; stacked:
// every track on a line of its own. Values without a track assignment form
// one dashed chip; a file without any audio value shows the muted Unknown
// chip, as 1.7.0. A hidden codec or channel value leaves names and menus;
// a loose chip of hidden values only, without a language, is not shown. A
// chip with a known part opens its TrackMenu; one menu or popover is open
// at a time, and a second press closes it.
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
  const hidden = useContext(HiddenTags);
  const [open, setOpen] = useState<{
    key: string;
    anchor: HTMLElement;
  } | null>(null);
  const { tracks, loose: reported } = fileTracks(file);
  const shows = (kind: "audio" | "channels", value: string) =>
    tagIsDisplayed(hidden, kind, value);
  // No hidden value in a menu, as in the drawer's options.
  const visible = (action: TrackFilterAction) =>
    action.kind === "codec"
      ? shows("audio", action.value)
      : action.kind === "channels"
        ? shows("channels", action.value)
        : action.kind === "combo"
          ? (!action.codec || shows("audio", action.codec)) &&
            (!action.channels || shows("channels", action.channels))
          : true;
  const loose = reported && {
    languages: reported.languages,
    codecs: reported.codecs.filter((value) => shows("audio", value)),
    channels: reported.channels.filter((value) => shows("channels", value)),
  };
  const looseShown =
    !!loose &&
    loose.languages.length + loose.codecs.length + loose.channels.length > 0;
  // A loose channel value is offered only when the stored channels field
  // holds it, so its filter finds the file.
  const stored = file.channels.split(" + ");
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
        name={trackChipName(track, labels, hidden)}
        onOpen={opener(key, trackActions(track).filter(visible))}
        expanded={open?.key === key}
        stretch={stacked}
      />
    );
  });
  const looseChip = loose && looseShown && (
    <LooseChip
      loose={loose}
      name={looseChipName(loose, labels, tracks.length > 0)}
      onOpen={opener(
        "loose",
        looseActions(loose).filter(
          (action) =>
            action.kind !== "channels" || stored.includes(action.value),
        ),
      )}
      expanded={open?.key === "loose"}
    />
  );
  const actions = open && menus[open.key];
  return (
    <div class={stacked ? "v2-trk-stack" : "v2-trk-row"}>
      {!tracks.length && !reported && <UnknownChip />}
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
