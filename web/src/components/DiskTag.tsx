import { t } from "../i18n";
import { placementCompact, placementDiskTone } from "../placement";
import type { PlacementItem } from "../types";
import { compactBytes as bytes } from "../ui";
import { Tooltip } from "./list/Tooltip";

// A disk of a placement item as a 1.7.0 tag (target or source tone), with
// its tooltip: the disk placement page and its dialogs, and the rename
// preview of File & metadata. A module of its own, so the library chunk
// (the rename preview) does not carry the placement dialogs.
export function DiskTag({
  item,
  disk,
  focusable = true,
}: {
  item: Pick<PlacementItem, "disks" | "target"> &
    Partial<Pick<PlacementItem, "scanStatus">>;
  disk: string;
  focusable?: boolean;
}) {
  const tone = placementDiskTone(item, disk);
  const stats = item.disks?.[disk] || { bytes: 0, files: 0, dirs: 0 };
  const content = placementCompact(item) ? (
    <>{t("Located on {disk}", { disk })}</>
  ) : (
    <>
      {disk} · {t(disk === item.target ? "Target disk" : "Source disk")} ·{" "}
      {bytes(stats.bytes)} · {t("{count} files", { count: stats.files })}
      {stats.dirs > 0 && <> · {t("{count} folders", { count: stats.dirs })}</>}
    </>
  );
  const tag = (
    <span
      tabIndex={focusable ? 0 : undefined}
      class={"tag placement-disk-tag" + (tone ? " placement-disk-" + tone : "")}
    >
      {disk}
    </span>
  );
  return focusable ? <Tooltip content={content}>{tag}</Tooltip> : tag;
}
