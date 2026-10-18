import { instancesOf, instanceLabel, isMediaType } from "../instances";
import { useEffect, useState } from "preact/hooks";
import { ArrowUp, ArrowDown, RefreshCw, RotateCcw } from "lucide-preact";
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
      <section class="connection">
        <h3 class="card-title">{t("Dashboard widgets")}</h3>
        <div class="table-wrap">
          <table class="dashboard-settings-table">
            <thead>
              <tr>
                <th>{t("Enabled")}</th>
                <th>{t("Widget")}</th>
                <th>{t("Order")}</th>
              </tr>
            </thead>
            <tbody>
              {(settings.widgets.order ?? dashboardOrder).map((id, index) => (
                <tr key={id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={t(dashboardLabels[id])}
                      checked={(
                        settings.widgets.visible ?? dashboardOrder
                      ).includes(id)}
                      onChange={(e) =>
                        changed({
                          ...settings,
                          widgets: {
                            ...settings.widgets,
                            visible: e.currentTarget.checked
                              ? [
                                  ...(settings.widgets.visible ??
                                    dashboardOrder),
                                  id,
                                ]
                              : (
                                  settings.widgets.visible ?? dashboardOrder
                                ).filter((key) => key !== id),
                          },
                        })
                      }
                    />
                  </td>
                  <td>{t(dashboardLabels[id])}</td>
                  <td>
                    <div class="column-move-tools">
                      {([-1, 1] as const).map((direction) => (
                        <button
                          type="button"
                          class="icon-button"
                          aria-label={
                            t(dashboardLabels[id]) +
                            " · " +
                            t(direction === -1 ? "Move up" : "Move down")
                          }
                          title={t(direction === -1 ? "Move up" : "Move down")}
                          disabled={
                            index + direction < 0 ||
                            index + direction >= settings.widgets.order.length
                          }
                          onClick={() => {
                            const order = [...settings.widgets.order];
                            [order[index], order[index + direction]] = [
                              order[index + direction],
                              order[index],
                            ];
                            changed({
                              ...settings,
                              widgets: { ...settings.widgets, order },
                            });
                          }}
                        >
                          {direction === -1 ? (
                            <ArrowUp size={14} />
                          ) : (
                            <ArrowDown size={14} />
                          )}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          class="icon-button list-layout-reset"
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
          <RotateCcw size={16} />
        </button>
      </section>
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
              <section class="connection storage-settings" key={service}>
                <h3 class="card-title">
                  {t("Storage {service}", {
                    service: instanceLabel(instance),
                  })}
                </h3>
                <p class="quiet">
                  {t(
                    "Select the filesystems included in the dashboard. Paths are reported by the service, not by Unraid share settings.",
                  )}
                </p>
                <button
                  type="button"
                  class="button"
                  disabled={demo || !!busy || !instance.enabled}
                  onClick={async () => {
                    setBusy(service);
                    try {
                      setData(
                        await api<StorageData>("storage/refresh", "POST", {
                          service,
                        }),
                      );
                    } catch {
                    } finally {
                      setBusy("");
                    }
                  }}
                >
                  <RefreshCw size={15} class={busy === service ? "spin" : ""} />
                  {t("Refresh storage")}
                </button>
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
                                {t("Shared storage group")}
                                <input
                                  value={chosen.sharedGroup}
                                  maxLength={80}
                                  onChange={(e) =>
                                    select(
                                      service,
                                      path,
                                      true,
                                      e.currentTarget.value.trim() || "shared",
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
                <small>
                  {t(
                    "Use the same group name only for duplicate paths reporting the same filesystem capacity. Each selected area has its own chart; overlapping shares are not added.",
                  )}
                </small>
              </section>
            );
          })}
      </div>
      <section class="connection">
        <h3 class="card-title">{t("Storage colors")}</h3>
        <div class="table-wrap color-table-wrap">
          <table class="color-settings-table">
            <thead>
              <tr>
                <th>{t("Tag preview")}</th>
                <th>{t("Color")}</th>
                <th>{t("Reset column")}</th>
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
                      <RotateCcw size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
