import { Database, RefreshCw } from "lucide-preact";
import type { ComponentChildren } from "preact";
import type { syncSummary } from "../frame-status";
import { t, useI18n } from "../i18n";
import { instanceLabel, instancesOf, isMediaType } from "../instances";
import { serviceHead, serviceKind, serviceValues } from "../settings-model";
import type { Settings, Status } from "../types";
import type { ConnectionService } from "../ui";
import { count, date, ICON } from "../ui";
import { ExternalTagCheck } from "./ExternalTagStatus";
import { card } from "./settings/Card";
import { KeyValues } from "./settings/KeyValues";
import { libraryStatus } from "./settings/LibraryStatus";
import { ServiceStatus } from "./settings/ServiceStatus";
import { StatusTag } from "./tools/StatusTag";

// System → Info (docs/STYLEGUIDE.md, Part 1, 11.4; E18, ruling R-L): the
// cards Version (the installed version and the release check as one
// status line, its error below), Back up cache and Change password (the
// caller's card) side by side, then Service sync status with one inset
// block per service: its name, Sync now or Match now (locked as in 1.7.0,
// its icon turning while it runs), its status (the rows of its Services
// card, from the same texts) and, with external tags, the tag check.
export function SystemInfo({
  status,
  settings,
  summary,
  demo,
  syncing,
  manualSync,
  backup,
  reviewTags,
  password,
}: {
  status: Status;
  settings: Settings;
  // The frame's sync summary (AppShell): its line per instance is the
  // status line here, as in the sync popover.
  summary: ReturnType<typeof syncSummary>;
  demo: boolean;
  syncing: Record<string, boolean>;
  manualSync: (service: ConnectionService) => Promise<void>;
  backup: () => Promise<void>;
  reviewTags: (service: string) => void;
  password: ComponentChildren;
}) {
  useI18n();
  const release = status.releaseCheck;
  const check = !release?.successAt
    ? t("Checking for a new version …")
    : release.updateAvailable
      ? t("New version {version} available", { version: release.latest || "" })
      : t("Version is up to date");
  const tone = !release?.successAt
    ? "neutral"
    : release.updateAvailable
      ? "info"
      : "ok";
  return (
    <div class="v2-set">
      <div class="v2-set-grid v2-set-grid--3">
        {card(
          "system-version",
          t("Version"),
          <>
            <KeyValues
              rows={[
                {
                  key: "version",
                  label: t("Installed version"),
                  value: status.version,
                },
              ]}
            />
            <p role="status">
              <StatusTag view={{ tone, text: check, long: check }} />
            </p>
            {release?.error && <small>{t(release.error)}</small>}
          </>,
        )}
        {card(
          "system-backup",
          t("Back up cache"),
          <>
            <p>
              {t(
                "Back up cache and settings. A complete Appdata backup also requires the local key.",
              )}
            </p>
            <button
              type="button"
              class="v2-btn"
              onClick={() => void backup().catch(() => {})}
            >
              <Database size={ICON.label} />
              {t("Back up cache")}
            </button>
          </>,
        )}
        {password}
      </div>
      {card(
        "system-services",
        t("Service sync status"),
        <>
          <p>
            {t(
              "Service status reflects the last sync, not a live connection test.",
            )}
          </p>
          {instancesOf(settings, true).map((instance) => {
            const service = instance.id;
            const media = isMediaType(instance.type);
            const sync = status.sync?.[service];
            const busy = !!(syncing[service] || sync?.running);
            const tags = status.tagSync?.[service];
            const head = serviceHead(
              summary.services.find((row) => row.id === service),
              t,
            );
            return card(
              "system-service-" + service,
              instanceLabel(instance),
              <>
                <ServiceStatus
                  kind={serviceKind(instance.type)}
                  values={libraryStatus(
                    serviceValues(instance, status, t, { date, count }),
                    head,
                    media,
                    tags,
                    () => reviewTags(service),
                  )}
                />
                {instance.tagImport && (
                  <ExternalTagCheck
                    service={service}
                    status={status}
                    disabled={demo || !instance.enabled}
                  />
                )}
              </>,
              <button
                type="button"
                class="v2-btn"
                disabled={demo || !instance.enabled || busy}
                onClick={() => void manualSync(service)}
              >
                <span class="v2-btn-icon" aria-hidden="true">
                  <RefreshCw
                    size={ICON.button}
                    class={busy ? "v2-spin" : undefined}
                  />
                </span>
                {t(media ? "Match now" : "Sync now")}
              </button>,
              "v2-card--inset",
            );
          })}
        </>,
      )}
    </div>
  );
}
