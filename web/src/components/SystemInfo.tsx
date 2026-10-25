import { ICON, CardHeading } from "../ui";
import { instancesOf, instanceLabel, isMediaType } from "../instances";
import { Database, RefreshCw } from "lucide-preact";
import { t, useI18n } from "../i18n";
import type { Settings, Status } from "../types";
import type { ConnectionService } from "../ui";
import { count, date } from "../ui";
import { ExternalTagStatus } from "./ExternalTagStatus";
import type { ComponentChildren } from "preact";

export function SystemInfo({
  status,
  settings,
  demo,
  syncing,
  manualSync,
  backup,
  reviewTags,
  password,
}: {
  status: Status;
  settings: Settings;
  demo: boolean;
  syncing: Record<string, boolean>;
  manualSync: (service: ConnectionService) => Promise<void>;
  backup: () => Promise<void>;
  reviewTags: (service: string) => void;
  password: ComponentChildren;
}) {
  useI18n();
  return (
    <section class="system-info" aria-label={t("System")}>
      <div class="system-overview">
        <section class="settings-card">
          <CardHeading title={t("Version")} />
          <div class="system-version">
            {" "}
            <dl class="key-values">
              <div>
                <dt>{t("Installed version")}</dt>
                <dd>{status.version}</dd>
              </div>
            </dl>
            <p class="release-check-status" role="status">
              {status.releaseCheck?.successAt
                ? status.releaseCheck.updateAvailable
                  ? t("New version {version} available", {
                      version: status.releaseCheck.latest || "",
                    })
                  : t("Version is up to date")
                : t("Checking for a new version …")}
            </p>
            {status.releaseCheck?.error && (
              <small class="quiet">{t(status.releaseCheck.error)}</small>
            )}
          </div>
        </section>
        <section class="settings-card">
          <CardHeading
            title={t("Back up cache")}
            actions={
              <button
                type="button"
                class="button"
                onClick={() => void backup().catch(() => {})}
              >
                <Database size={ICON.label} />
                {t("Back up cache")}
              </button>
            }
          />{" "}
          <p class="quiet">
            {t(
              "Back up cache and settings. A complete Appdata backup also requires the local key.",
            )}
          </p>
        </section>
        {password}
      </div>
      <section class="settings-card system-service-card">
        <CardHeading title={t("Service sync status")} />
        <p class="quiet">
          {t(
            "Service status reflects the last sync, not a live connection test.",
          )}
        </p>
        <div class="system-services">
          {instancesOf(settings, true).map((instance) => {
            const service = instance.id;
            const media = isMediaType(instance.type);
            const sync = status.sync?.[service];
            const tags = status.tagSync?.[service];
            return (
              <article key={service}>
                <div class="system-service-heading">
                  <h4>{instanceLabel(instance)}</h4>{" "}
                  <button
                    type="button"
                    class="button system-sync-button"
                    disabled={
                      demo ||
                      !instance.enabled ||
                      syncing[service] ||
                      sync?.running
                    }
                    onClick={() => void manualSync(service)}
                  >
                    <RefreshCw
                      size={ICON.label}
                      class={sync?.running ? "spin" : ""}
                    />
                    {t(media ? "Match now" : "Sync now")}
                  </button>
                  {sync?.running && (
                    <progress aria-label={t("Sync in progress …")} />
                  )}
                </div>
                <p class={sync?.error ? "error" : ""}>
                  {!instance.enabled
                    ? t("Disabled")
                    : sync?.running
                      ? sync.queued
                        ? t("Sync waiting for a slot …")
                        : t("Sync in progress …")
                      : sync?.error
                        ? t("Sync failed · {error}", { error: t(sync.error) })
                        : t(
                            media ? "Last match: {date}" : "Last sync: {date}",
                            {
                              date: date(sync?.lastSuccess),
                            },
                          )}
                </p>
                {status.nextSync?.[service] && (
                  <small class="next-sync">
                    {t("Next sync: {date}", {
                      date: date(status.nextSync[service]),
                    })}
                  </small>
                )}
                {instance.webhookEnabled && (
                  <div class="webhook-status">
                    <b>{t("Realtime updates")}</b>
                    <p class="quiet">
                      {status.webhook?.[service]?.error
                        ? t(status.webhook[service].error)
                        : t("Last webhook update: {date}", {
                            date: date(status.webhook?.[service]?.lastSuccess),
                          })}
                    </p>
                    <small>
                      {t("{count} pending", {
                        count: status.webhook?.[service]?.pending || 0,
                      })}
                    </small>
                  </div>
                )}
                {instance.tagImport && (
                  <ExternalTagStatus
                    service={service}
                    status={status}
                    disabled={demo || !instance.enabled}
                  />
                )}
                <small>
                  {media ? (
                    t("{count} files matched", { count: sync?.count || 0 })
                  ) : (
                    <>
                      {count(sync?.count || 0)} {t("files in cache")}
                    </>
                  )}
                </small>
                {(Object.values(instance.tagSync || {}).some(Boolean) ||
                  tags?.running ||
                  tags?.pending ||
                  tags?.error ||
                  tags?.approvalRequired ||
                  !!tags?.retainedDefinitions) && (
                  <div class="tag-sync-status">
                    <b>{t("Tag synchronization")}</b>
                    <p class={tags?.error ? "error" : "quiet"}>
                      {tags?.error
                        ? t(tags.error)
                        : tags?.running
                          ? t("Tag synchronization in progress …")
                          : tags?.pending
                            ? t("Tag synchronization pending …")
                            : t("Last sync: {date}", {
                                date: date(tags?.lastSuccess),
                              })}
                    </p>
                    {!!tags?.retainedDefinitions && (
                      <p class="quiet">
                        {t(
                          "{count} tag definitions retained because the service still uses them.",
                          { count: tags.retainedDefinitions },
                        )}
                      </p>
                    )}
                    {tags?.approvalRequired && (
                      <button
                        type="button"
                        class="button"
                        onClick={() => reviewTags(service)}
                      >
                        {t("Review tag removals")}
                      </button>
                    )}
                    {tags?.running && (
                      <progress
                        aria-label={t("Tag synchronization in progress …")}
                      />
                    )}
                  </div>
                )}
                {sync?.error && sync.lastSuccess && (
                  <p class="quiet">
                    {t("Last successful sync")}: {date(sync.lastSuccess)}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </section>
  );
}
