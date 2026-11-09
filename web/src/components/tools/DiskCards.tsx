import { Database, HardDrive, Moon } from "lucide-preact";
import type { JSX } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { t } from "../../i18n";
import { DISK_PLACEHOLDERS, type DiskCardModel } from "../../tool-list";
import { compactBytes as bytes, ICON, percent } from "../../ui";

// From this share of used space the bar takes the warning tone.
const WARN_SHARE = 85;

// The disk row of Disk placement (docs/STYLEGUIDE.md, Part 1, 10.2, ruling
// R-L): section.v2-disks, one line of --stat-h whatever the number of
// disks, the cards in columns of at least --disk-card-min that scroll
// sideways when they do not fit. Only while it overflows is the row a
// focusable named region (ruling I9, the TableCard pattern: a
// ResizeObserver on the row); focused, it stays one until focus leaves.
// Until the first status answer and without disks (null or empty) three
// placeholder cards hold the row.
export function DiskCards({
  disks,
}: {
  disks: DiskCardModel[] | null;
}): JSX.Element {
  const row = useRef<HTMLElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [focused, setFocused] = useState(false);
  const shown = disks?.length ?? 0;
  useLayoutEffect(() => {
    const region = row.current;
    if (!region) return;
    const measure = () =>
      setOverflow(region.scrollWidth > region.clientWidth + 0.5);
    const observer = new ResizeObserver(measure);
    observer.observe(region);
    measure();
    return () => observer.disconnect();
  }, [shown]);
  const named = overflow || focused;
  return (
    <section
      ref={row}
      class="v2-disks"
      role={named ? "region" : undefined}
      aria-label={named ? t("Disks and pools") : undefined}
      tabIndex={named ? 0 : undefined}
      data-overflow={overflow ? "" : undefined}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      {disks?.length
        ? disks.map(diskCard)
        : Array.from({ length: DISK_PLACEHOLDERS }, (_, n) => (
            <article
              key={n}
              class="v2-card v2-disk v2-disk--ph"
              aria-hidden="true"
            />
          ))}
    </section>
  );
}

// A disk card: the 40 tile (muted in standby), the name, its state and the
// Target mark, the usage bar and the used and free space. Every card has
// the same parts, so all are as high; standby blocks and warns nothing.
function diskCard(disk: DiskCardModel): JSX.Element {
  const used = t("{percent} used", {
    percent: percent(Math.round(disk.share)),
  });
  const free = t("{space} free", { space: bytes(disk.free) });
  const standby = disk.standby === true;
  const Icon = disk.pool ? Database : HardDrive;
  return (
    <article
      key={disk.name}
      class="v2-card v2-disk"
      aria-label={[
        disk.name,
        used,
        free,
        ...(standby ? [t("Standby")] : []),
      ].join(" · ")}
    >
      <span
        class={"v2-tile v2-tile--md" + (standby ? "" : " v2-tile--grad")}
        aria-hidden="true"
      >
        <Icon size={ICON.large} />
      </span>
      <div class="v2-disk-top">
        <span class="v2-disk-name">{disk.name}</span>
        <span class="v2-disk-state">
          {standby ? (
            <>
              <Moon size={ICON.chip} aria-hidden="true" />
              {t("Standby")}
            </>
          ) : disk.pool ? (
            t("Pool (not a target)")
          ) : null}
        </span>
        {disk.target && <span class="v2-tag v2-tag--disk">{t("Target")}</span>}
      </div>
      <div
        class="v2-disk-bar"
        aria-hidden="true"
        data-warn={disk.share >= WARN_SHARE ? "" : undefined}
        style={{ "--v": String(Math.round(disk.share)) }}
      >
        <span />
      </div>
      <div class="v2-disk-meta">
        <span>{used}</span>
        <span class="v2-disk-free">{free}</span>
      </div>
    </article>
  );
}
