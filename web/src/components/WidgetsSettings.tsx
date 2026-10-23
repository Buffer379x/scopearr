import { OrderedList } from "./OrderedList";
import { HelpPopover } from "./HelpPopover";
import { ICON, CardHeading } from "../ui";
import { instancesOf, instanceLabel, isMediaType } from "../instances";
import { useEffect, useState } from "preact/hooks";
import { RefreshCw, RotateCcw } from "lucide-preact";
import type { Settings, StorageData } from "../types";
import { t, useI18n } from "../i18n";
import { api } from "../api";
import { confirmReset } from "../confirmation";
import { dashboardOrder, dashboardLabels } from "../dashboard-widgets";
import { storageBytes } from "./StorageWidget";
export function WidgetsSettings({
  settings,
  changed,
  demo,
}: {
  settings: Settings;
  changed: (next: Settings) => void;
  demo: boolean;
}) {
  useI18n();
  const [data, setData] = useState<StorageData | null>(null);
  const [busy, setBusy] = useState<string>("");
  useEffect(() => {
    api<StorageData>("storage")
      .then(setData)
      .catch(() => {});
  }, []);
  function select(
    service: string,
    path: string,
    checked: boolean,
    sharedGroup = "",
    name?: string,
  ) {
    const existing = settings.widgets.storage[service] || [];
    changed({
      ...settings,
      widgets: {
        ...settings.widgets,
        storage: {
          ...settings.widgets.storage,
          [service]: checked
            ? [
                ...existing.filter((s) => s.path !== path),
                {
                  path,
                  sharedGroup,
                  name:
                    name ?? existing.find((s) => s.path === path)?.name ?? path,
                },
              ]
            : existing.filter((s) => s.path !== path),
        },
      },
    });
  }
  return (
    <>
      <div class="widgets-overview">
        <section class="connection">
          <CardHeading
            title={t("Dashboard widgets")}
            actions={
              <button
                type="button"
                class="icon-button"
                title={t("Restore defaults")}
                aria-label={t("Restore defaults")}
                onClick={async () => {
                  if (await confirmReset(t("Restore defaults?")))
                    changed({
                      ...settings,
                      widgets: {
                        ...settings.widgets,
                        order: [...dashboardOrder],
                        visible: [...dashboardOrder],
                      },
                    });
                }}
              >
                <RotateCcw size={ICON.button} />
              </button>
            }
          />
          <OrderedList
            order={settings.widgets.order ?? dashboardOrder}
            visible={settings.widgets.visible ?? dashboardOrder}
            labels={Object.fromEntries(
              Object.entries(dashboardLabels).map(([k, v]) => [k, t(v)]),
            )}
            ariaPrefix={t("Dashboard widgets")}
            change={(order, visible) =>
              changed({
                ...settings,
                widgets: { ...settings.widgets, order, visible },
              })
            }
          />
        </section>
        <section class="connection">
          <h3 class="card-title">{t("Storage colors")}</h3>
          <div class="table-wrap color-table-wrap">
            <table class="editor-table">
              <thead>
                <tr>
                  <th scope="col">{t("Tag preview")}</th>
                  <th scope="col">{t("Color")}</th>
                  <th scope="col">{t("Reset")}</th>
                </tr>
              </thead>
              <tbody>
                {["used", "free"].map((key) => (
                  <tr>
                    <td>
                      <span class="storage-color-preview">
                        <span
                          class="chart-dot"
                          style={{
                            backgroundColor: settings.widgets.colors[key],
                          }}
                        />
                        {t(key === "used" ? "Used space" : "Free space")}
                      </span>
                    </td>
                    <td>
                      <input
                        type="color"
                        aria-label={t(
                          key === "used" ? "Used space" : "Free space",
                        )}
                        value={settings.widgets.colors[key]}
                        onInput={(e) =>
                          changed({
                            ...settings,
                            widgets: {
                              ...settings.widgets,
                              colors: {
                                ...settings.widgets.colors,
                                [key]: e.currentTarget.value,
                              },
                            },
                          })
                        }
                      />
                    </td>
                    <td>
                      <button
                        class="icon-button color-action"
                        type="button"
                        title={t("Restore defaults")}
                        aria-label={t("Restore defaults")}
                        onClick={async () => {
                          if (await confirmReset(t("Restore defaults?")))
                            changed({
                              ...settings,
                              widgets: {
                                ...settings.widgets,
                                colors: {
                                  ...settings.widgets.colors,
                                  [key]: key === "used" ? "#729acb" : "#62b69d",
                                },
                              },
                            });
                        }}
                      >
                        <RotateCcw size={ICON.button} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <section class="connection">
        <CardHeading
          title={t("Storage")}
          description={t(
            "Select the filesystems included in the dashboard. Paths are reported by the service, not by Unraid share settings.",
          )}
        />
        <div class="storage-settings-grid">
          {instancesOf(settings, true)
            .filter((instance) => !isMediaType(instance.type))
            .map((instance) => {
              const service = instance.id;
              const snapshot = data?.services[service];
              const selected = settings.widgets.storage[service] || [];
              const paths = [
                ...new Set([
                  ...(snapshot?.disks || []).map((d) => d.path),
                  ...selected.map((d) => d.path),
                ]),
              ];
              return (
                <article class="storage-instance" key={service}>
                  <CardHeading
                    title={instanceLabel(instance)}
                    actions={
                      <button
                        type="button"
                        class="button"
                        disabled={demo || !!busy || !instance.enabled}
                        onClick={async () => {
                          setBusy(service);
                          try {
                            setData(
                              await api<StorageData>(
                                "storage/refresh",
                                "POST",
                                {
                                  service,
                                },
                              ),
                            );
                          } catch {
                          } finally {
                            setBusy("");
                          }
                        }}
                      >
                        <RefreshCw
                          size={ICON.label}
                          class={busy === service ? "spin" : ""}
                        />
                        {t("Refresh storage")}
                      </button>
                    }
                  />
                  {snapshot?.error && <p class="error">{t(snapshot.error)}</p>}
                  <div class="storage-paths">
                    {paths.map((path) => {
                      const chosen = selected.find((d) => d.path === path),
                        disk = snapshot?.disks.find((d) => d.path === path);
                      return (
                        <div class="storage-path" key={path}>
                          <label class="check-field">
                            <input
                              type="checkbox"
                              checked={!!chosen}
                              onChange={(e) =>
                                select(
                                  service,
                                  path,
                                  e.currentTarget.checked,
                                  chosen?.sharedGroup,
                                )
                              }
                            />
                            <span class="storage-path-label">{path}</span>
                          </label>
                          <small>
                            {disk
                              ? t("{total} total · {free} free", {
                                  total: storageBytes(disk.totalSpace),
                                  free: storageBytes(disk.freeSpace),
                                })
                              : t("A selected storage path is unavailable")}
                          </small>
                          {chosen && (
                            <div class="storage-shared">
                              <label>
                                {t("Name")}
                                <input
                                  value={chosen.name ?? path}
                                  maxLength={160}
                                  onInput={(e) =>
                                    select(
                                      service,
                                      path,
                                      true,
                                      chosen.sharedGroup,
                                      e.currentTarget.value,
                                    )
                                  }
                                />
                              </label>
                              <label class="check-field">
                                <input
                                  type="checkbox"
                                  checked={!!chosen.sharedGroup}
                                  onChange={(e) =>
                                    select(
                                      service,
                                      path,
                                      true,
                                      e.currentTarget.checked ? "shared" : "",
                                    )
                                  }
                                />
                                {t("Shared storage")}
                              </label>
                              {!!chosen.sharedGroup && (
                                <label>
                                  <span class="field-label-row">
                                    {t("Shared storage group")}
                                    <HelpPopover
                                      label="Shared storage group"
                                      text="Use the same group name only for duplicate paths reporting the same filesystem capacity. Each selected area has its own chart; overlapping shares are not added."
                                    />
                                  </span>
                                  <input
                                    value={chosen.sharedGroup}
                                    maxLength={80}
                                    onChange={(e) =>
                                      select(
                                        service,
                                        path,
                                        true,
                                        e.currentTarget.value.trim() ||
                                          "shared",
                                      )
                                    }
                                  />
                                </label>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {!paths.length && (
                    <p class="quiet">
                      {t("Refresh storage to load available paths.")}
                    </p>
                  )}
                </article>
              );
            })}
        </div>
      </section>
    </>
  );
}
