import { RefreshCw } from "lucide-preact";
import type { syncSummary } from "../../frame-status";
import { t } from "../../i18n";
import { ICON } from "../../ui";

// The frame's sync state (docs/STYLEGUIDE.md, Part 1, 10.1) in one of three
// places, never two at once: the chip in the topbar (rail), the card in the
// expanded sidebar's footer, the row in the drawer head. Without any sync
// ("off") it names the synchronization instead of a bare "Last sync:".
// Each is a button; with onOpen it announces its popover (E15).
export function SyncStatus({
  summary,
  variant,
  onOpen,
  expanded = false,
}: {
  summary: ReturnType<typeof syncSummary>;
  variant: "chip" | "card" | "row";
  onOpen?(anchor: HTMLElement): void;
  // The popover is open (only with onOpen).
  expanded?: boolean;
}) {
  const off = summary.state === "off";
  const text = off ? t("Synchronization") : summary.text;
  const dot = (
    <span
      class={
        "v2-dot" +
        (summary.state === "ok" ? "" : " v2-dot--" + summary.state) +
        (variant === "chip" ? " v2-dot--ring" : "")
      }
      aria-hidden="true"
    />
  );
  const label = <span class="v2-sync-text">{text}</span>;
  const trigger = {
    type: "button" as const,
    title: text,
    ...(onOpen
      ? { "aria-haspopup": "dialog" as const, "aria-expanded": expanded }
      : {}),
    onClick: (event: MouseEvent) =>
      onOpen?.(event.currentTarget as HTMLElement),
  };
  if (variant === "chip")
    return (
      <button {...trigger} class="v2-pill v2-sync-chip" aria-label={text}>
        {dot}
        {label}
      </button>
    );
  if (variant === "row")
    return (
      <button {...trigger} class="v2-sync v2-sync--row">
        {dot}
        {label}
      </button>
    );
  return (
    <button {...trigger} class="v2-sync v2-sync--card">
      <span class="v2-tile v2-tile--grad" aria-hidden="true">
        <RefreshCw size={ICON.button} />
      </span>
      <span class="v2-sync-body">
        <span class="v2-sync-title">{t("Synchronization")}</span>
        <span class="v2-sync-line">
          {dot}
          {!off && label}
        </span>
      </span>
    </button>
  );
}
