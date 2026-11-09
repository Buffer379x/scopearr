import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import { t } from "../../i18n";
import {
  placementCompact,
  placementDisksBySize,
  placementDiskTone,
} from "../../placement";
import type { PlacementItem } from "../../types";
import { compactBytes as bytes } from "../../ui";

// Ids of the tags' descriptions: unique on the page, kept per tag.
let described = 0;

// A disk of a tool row (docs/STYLEGUIDE.md, Part 1, 2.5 and 10.7): the
// target in the accent (v2-tag--disk), a source in the warning tone
// (v2-tag--disk-src), monospace, the disk name as its only text and name.
// The 1.7.0 tooltip text is its title and its description, a v2-sr-only
// span it names in aria-describedby; it takes no focus and carries no
// aria-label (ruling I8): the Details dialog holds every disk with its
// sizes. The target column's disk is the target even when the item has no
// data on it (1.7.0 showed it untoned).
export function ToolDiskTag({
  item,
  disk,
}: {
  item: Pick<PlacementItem, "disks" | "target" | "scanStatus">;
  disk: string;
}): JSX.Element {
  const id = useRef("");
  if (!id.current) id.current = "v2-disk-tag-" + ++described;
  const target =
    disk === item.target || placementDiskTone(item, disk) === "target";
  const stats = item.disks?.[disk] || { bytes: 0, files: 0, dirs: 0 };
  const long = placementCompact(item)
    ? t("Located on {disk}", { disk })
    : [
        disk,
        t(disk === item.target ? "Target disk" : "Source disk"),
        bytes(stats.bytes),
        t("{count} files", { count: stats.files }),
        ...(stats.dirs > 0
          ? [t("{count} folders", { count: stats.dirs })]
          : []),
      ].join(" · ");
  return (
    <>
      <span
        class={"v2-tag " + (target ? "v2-tag--disk" : "v2-tag--disk-src")}
        title={long}
        aria-describedby={id.current}
      >
        {disk}
      </span>
      <span id={id.current} class="v2-sr-only">
        {long}
      </span>
    </>
  );
}

// The disks cell of a placement row: two tags by size, then "+n" for the
// others (named "Show all disks for {title}", the others with their sizes
// as title), which opens Details; without disks a dash.
export function DiskTagCell({
  item,
  more,
}: {
  item: PlacementItem;
  more(): void;
}): JSX.Element {
  const disks = placementDisksBySize(item);
  if (!disks.length) return <>—</>;
  const rest = disks.slice(2);
  return (
    <div class="v2-table-items">
      {disks.slice(0, 2).map(([disk]) => (
        <ToolDiskTag key={disk} item={item} disk={disk} />
      ))}
      {rest.length > 0 && (
        <button
          type="button"
          class="v2-tag v2-tag--more"
          aria-label={t("Show all disks for {title}", { title: item.title })}
          title={rest
            .map(([disk, stats]) => disk + " · " + bytes(stats.bytes))
            .join("; ")}
          onClick={() => more()}
        >
          +{rest.length}
        </button>
      )}
    </div>
  );
}
