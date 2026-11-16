import {
  ChevronLeft,
  ChevronRight,
  Database,
  HardDrive,
  Moon,
} from "lucide-preact";
import type { JSX } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { t } from "../../i18n";
import { DISK_PLACEHOLDERS, type DiskCardModel } from "../../tool-list";
import { compactBytes as bytes, ICON, percent } from "../../ui";

// From this share of used space the bar takes the warning tone.
const WARN_SHARE = 85;

// The disk row of Disk placement (docs/STYLEGUIDE.md, Part 1, 10.2, rulings
// R-L and D29): div.v2-disks-wrap holds section.v2-disks, one line of
// --stat-h whatever the number of disks, the cards in columns of at least
// --disk-card-min that scroll sideways when they do not fit, and the two
// arrow buttons. Only while it overflows is the row a focusable named
// region (ruling I9, the TableCard pattern: a ResizeObserver on the row);
// focused, it stays one until focus leaves.
// A mouse has no sideways gesture, so while something is cut off at an
// end that end has an arrow button (absent, not hidden, while nothing is
// cut off there: no tab stop, no layout shift), a vertical wheel notch
// over the row scrolls it by one card as long as it can go that way, and
// the fade (data-more-start, data-more-end) shows only at an end with more
// behind it. Shift+wheel and a trackpad scroll it as before. Nothing is
// stored.
// Until the first status answer and without disks (null or empty) three
// placeholder cards hold the row; they are hidden from assistive
// technology, so the row is then never a region or a tab stop, even
// while they overflow (Phase 5b, Task 7 review), and has no buttons.
export function DiskCards({
  disks,
}: {
  disks: DiskCardModel[] | null;
}): JSX.Element {
  const row = useRef<HTMLElement>(null);
  const prev = useRef<HTMLButtonElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [focused, setFocused] = useState(false);
  const [more, setMore] = useState({ start: false, end: false });
  const shown = disks?.length ?? 0;
  useLayoutEffect(() => {
    const region = row.current;
    if (!region) return;
    const measure = () => {
      setOverflow(region.scrollWidth > region.clientWidth + 0.5);
      const start = region.scrollLeft > 1;
      const end =
        region.scrollLeft + region.clientWidth < region.scrollWidth - 1;
      // A button that holds focus and goes away hands it to the row.
      for (const [gone, button] of [
        [!start, prev.current],
        [!end, next.current],
      ] as const)
        if (gone && button && document.activeElement === button)
          region.focus({ preventScroll: true });
      setMore((was) =>
        was.start === start && was.end === end ? was : { start, end },
      );
    };
    // One notch of a mouse wheel (a whole step, or lines) moves the row by
    // one card; a trackpad's small vertical deltas, sideways deltas and
    // Ctrl+wheel (zoom) are left to the browser.
    let lastStep = 0;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.shiftKey) return;
      const dy = event.deltaY;
      if (!dy || Math.abs(event.deltaX) >= Math.abs(dy)) return;
      if (event.deltaMode === 0 && Math.abs(dy) < 40) return;
      const dir = dy > 0 ? 1 : -1;
      const room =
        dir > 0
          ? region.scrollLeft + region.clientWidth < region.scrollWidth - 1
          : region.scrollLeft > 1;
      if (!room) return;
      event.preventDefault();
      const now = event.timeStamp;
      if (now - lastStep < 120) return;
      lastStep = now;
      const cards = region.children;
      const pitch =
        cards.length > 1
          ? (cards[1] as HTMLElement).offsetLeft -
            (cards[0] as HTMLElement).offsetLeft
          : region.clientWidth;
      region.scrollBy({ left: dir * pitch, behavior: motion() });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(region);
    region.addEventListener("scroll", measure, { passive: true });
    region.addEventListener("wheel", wheel, { passive: false });
    measure();
    return () => {
      observer.disconnect();
      region.removeEventListener("scroll", measure);
      region.removeEventListener("wheel", wheel);
    };
  }, [shown]);
  const named = shown > 0 && (overflow || focused);
  const arrows = shown > 0 && overflow;
  // One visible width less the fade, so the card cut off at the end
  // arrives as the first one and snap settles on a card.
  const page = (dir: 1 | -1) => {
    const region = row.current;
    if (!region) return;
    region.scrollBy({
      left: dir * Math.max(region.clientWidth - 48, 48),
      behavior: motion(),
    });
  };
  return (
    <div class="v2-disks-wrap">
      <section
        ref={row}
        class="v2-disks"
        role={named ? "region" : undefined}
        aria-label={named ? t("Disks and pools") : undefined}
        tabIndex={named ? 0 : undefined}
        data-overflow={overflow ? "" : undefined}
        data-more-start={overflow && more.start ? "" : undefined}
        data-more-end={overflow && more.end ? "" : undefined}
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
      {arrows && more.start && (
        <button
          ref={prev}
          type="button"
          class="v2-icon-btn v2-disks-nav v2-disks-nav--start"
          aria-label={t("Previous disks")}
          title={t("Previous disks")}
          onClick={() => page(-1)}
        >
          <ChevronLeft size={ICON.button} aria-hidden="true" />
        </button>
      )}
      {arrows && more.end && (
        <button
          ref={next}
          type="button"
          class="v2-icon-btn v2-disks-nav v2-disks-nav--end"
          aria-label={t("Next disks")}
          title={t("Next disks")}
          onClick={() => page(1)}
        >
          <ChevronRight size={ICON.button} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

// Smooth unless the user asked for less motion.
function motion(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}

// A disk card: the 40 tile (muted in standby), the name, its state (a
// pool always says it is no target; standby is then only in its title and
// the card's name) and the Target mark, the usage bar and the used and
// free space. Every card has
// the same parts, so all are as high; standby blocks and warns nothing.
// Each one-line text ends with "…" where the card is too narrow (820, 375)
// and carries its full text as its title (rc.2).
function diskCard(disk: DiskCardModel): JSX.Element {
  const used = t("{percent} used", {
    percent: percent(Math.round(disk.share)),
  });
  const free = t("{space} free", { space: bytes(disk.free) });
  const standby = disk.standby === true;
  const Icon = disk.pool ? Database : HardDrive;
  // The state's full text, also where it ends with "…" (rc.2).
  const stateTitle = disk.pool
    ? t("Pool (not a target)") + (standby ? " · " + t("Standby") : "")
    : standby
      ? t("Standby")
      : undefined;
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
        <span class="v2-disk-name" title={disk.name}>
          {disk.name}
        </span>
        <span class="v2-disk-state" title={stateTitle}>
          {disk.pool ? (
            <span class="v2-disk-state-text">{t("Pool (not a target)")}</span>
          ) : standby ? (
            <>
              <Moon size={ICON.chip} aria-hidden="true" />
              <span class="v2-disk-state-text">{t("Standby")}</span>
            </>
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
        <span title={used}>{used}</span>
        <span class="v2-disk-free" title={free}>
          {free}
        </span>
      </div>
    </article>
  );
}
