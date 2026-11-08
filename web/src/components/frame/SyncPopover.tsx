import { RefreshCw } from "lucide-preact";
import type { syncSummary } from "../../frame-status";
import { t } from "../../i18n";
import type { Status } from "../../types";
import { ICON } from "../../ui";
import type { ConnectionService } from "../../ui";
import { Popover } from "./Popover";

// The sync popover (docs/STYLEGUIDE.md, Part 1, 10.1; E16) behind the sync
// chip, card and drawer row: a dialog named "Synchronization" with every
// enabled instance, its state dot, its name, the status line of
// System → Info and its button, "Sync now" or "Match now" for a media
// server. The button is locked as on System → Info: in the demo, for a
// disabled instance, while its request is on its way and while it syncs.
// There is no "sync all". It is wide: the lines hold times and states that
// change while it is open, and it keeps its width.
export function SyncPopover({
  summary,
  status,
  demo,
  sync,
  syncing,
  close,
  anchor,
  placement,
}: {
  summary: ReturnType<typeof syncSummary>;
  status: Status;
  demo: boolean;
  sync(service: ConnectionService): Promise<void>;
  syncing: Record<string, boolean>;
  close(returnFocus: boolean): void;
  anchor: HTMLElement;
  placement: "bottom-end" | "right-end";
}) {
  return (
    <Popover
      anchor={anchor}
      placement={placement}
      role="dialog"
      label={t("Synchronization")}
      close={close}
      wide
    >
      <p class="v2-pop-title">{t("Synchronization")}</p>
      <ul class="v2-sync-list">
        {summary.services.map((service) => (
          <li key={service.id} class="v2-sync-item">
            <span
              class={
                "v2-dot" +
                (service.state === "ok" ? "" : " v2-dot--" + service.state)
              }
              aria-hidden="true"
            />
            <span class="v2-sync-main">
              <span class="v2-sync-name">{service.label}</span>
              <span class="v2-sync-state">{service.text}</span>
            </span>
            <button
              type="button"
              class="v2-btn v2-btn--sm"
              disabled={
                !!(
                  demo ||
                  !service.enabled ||
                  syncing[service.id] ||
                  status.sync?.[service.id]?.running
                )
              }
              onClick={(event) => {
                // The button locks at once; focus stays in the popover.
                (event.currentTarget as HTMLElement)
                  .closest<HTMLElement>(".v2-pop")
                  ?.focus();
                void sync(service.id);
              }}
            >
              <RefreshCw size={ICON.sort} aria-hidden="true" />
              {t(service.media ? "Match now" : "Sync now")}
            </button>
          </li>
        ))}
      </ul>
    </Popover>
  );
}
