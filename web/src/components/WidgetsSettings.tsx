import { RefreshCw, RotateCcw } from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";
import { confirmReset } from "../confirmation";
import { dashboardLabels, dashboardOrder } from "../dashboard-widgets";
import { storageBytes } from "../dashboard-model";
import { t, useI18n } from "../i18n";
import { instanceLabel, instancesOf, isMediaType } from "../instances";
import { keepOrder } from "../settings-model";
import type { Settings, StorageData } from "../types";
import { ICON } from "../ui";
import { HelpTip } from "./list/HelpTip";
import { RowButton } from "./list/RowButton";
import { card, colorTable } from "./settings/Card";
import { check } from "./settings/Check";
import { OrderList } from "./settings/ColumnOrderEditor";
import { field } from "./settings/Field";

// The storage chart colors with their defaults.
const STORAGE_COLORS = [
  ["used", "Used space", "#729acb"],
  ["free", "Free space", "#62b69d"],
] as const;

// Settings → Widgets (docs/STYLEGUIDE.md, Part 1, 11.4): a v2-set-grid of
// the cards "Dashboard widgets" (the OrderList, Restore defaults in its
// head) and "Storage colors" (a v2 table), then the card "Storage" with an
// inset card per library service (two columns from 1120, as in 1.7.0):
// Refresh storage in its head, its paths (checkbox, size on its own line;
// a chosen one with its name, Shared storage and the group) and, after
// them, its error. Chosen paths show from the first paint ("—" for the
// size until the answer; the hint without paths waits invisibly), the
// reported ones follow, and no path moves once shown (keepOrder; an
// unticked one keeps its row until the answer). Every value is the
// settings draft, as in 1.7.0.
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
  const shown = useRef<Record<string, string[]>>({});
  useEffect(() => {
    api<StorageData>("storage")
      .then(setData)
      .catch(() => {});
  }, []);
  const widgets = settings.widgets;
  const set = (next: Partial<Settings["widgets"]>) =>
    changed({ ...settings, widgets: { ...widgets, ...next } });
  function select(
    service: string,
    path: string,
    checked: boolean,
    sharedGroup = "",
    name?: string,
  ) {
    // An edit keeps the stored entry in place; a newly ticked path is
    // appended, so the stored order (the order shown) follows no edit.
    const existing = widgets.storage[service] || [];
    const entry = {
      path,
      sharedGroup,
      name: name ?? existing.find((s) => s.path === path)?.name ?? path,
    };
    set({
      storage: {
        ...widgets.storage,
        [service]: !checked
          ? existing.filter((s) => s.path !== path)
          : existing.some((s) => s.path === path)
            ? existing.map((s) => (s.path === path ? entry : s))
            : [...existing, entry],
      },
    });
  }
  const restore = t("Restore defaults");
  const services = instancesOf(settings, true).filter(
    (instance) => !isMediaType(instance.type),
  );
  return (
    <>
      <div class="v2-set-grid">
        {card(
          "dashboard-widgets",
          t("Dashboard widgets"),
          <OrderList
            order={widgets.order ?? dashboardOrder}
            visible={widgets.visible ?? dashboardOrder}
            labels={Object.fromEntries(
              Object.entries(dashboardLabels).map(([k, v]) => [k, t(v)]),
            )}
            ariaPrefix={t("Dashboard widgets")}
            change={(order, visible) => set({ order, visible })}
          />,
          <button
            type="button"
            class="v2-icon-btn"
            title={restore}
            aria-label={restore}
            onClick={async () => {
              if (await confirmReset(t("Restore defaults?")))
                set({
                  order: [...dashboardOrder],
                  visible: [...dashboardOrder],
                });
            }}
          >
            <RotateCcw size={ICON.button} />
          </button>,
        )}
        {card(
          "storage-colors",
          t("Storage colors"),
          colorTable(
            [t("Tag preview"), t("Color"), t("Reset")],
            STORAGE_COLORS.map(([key, name, initial]) => [
              key,
              [
                <span class="v2-table-items">
                  <span
                    class="v2-dot"
                    aria-hidden="true"
                    style={{ background: widgets.colors[key] }}
                  />
                  {t(name)}
                </span>,
                <input
                  type="color"
                  class="v2-color"
                  aria-label={t(name)}
                  value={widgets.colors[key]}
                  onInput={(e) =>
                    set({
                      colors: {
                        ...widgets.colors,
                        [key]: e.currentTarget.value,
                      },
                    })
                  }
                />,
                <RowButton
                  label={t("Restore defaults: {name}", { name: t(name) })}
                  icon={<RotateCcw size={ICON.button} />}
                  onClick={async () => {
                    if (await confirmReset(t("Restore defaults?")))
                      set({ colors: { ...widgets.colors, [key]: initial } });
                  }}
                />,
              ],
            ]),
          ),
        )}
      </div>
      {card(
        "storage",
        t("Storage"),
        <>
          <p>
            {t(
              "Select the filesystems included in the dashboard. Paths are reported by the service, not by Unraid share settings.",
            )}
          </p>
          {!!services.length && (
            <div class="v2-set-grid">
              {services.map((instance) => {
                const service = instance.id;
                const snapshot = data?.services[service];
                const selected = widgets.storage[service] || [];
                // Until the answer an unticked path keeps its row.
                const before = shown.current[service] ?? [];
                const paths = (shown.current[service] = keepOrder(before, [
                  ...(data ? [] : before),
                  ...selected.map((d) => d.path),
                  ...(snapshot?.disks || []).map((d) => d.path),
                ]));
                return card(
                  "storage-" + service,
                  instanceLabel(instance),
                  <>
                    {paths.length ? (
                      <ul class="v2-set-paths">
                        {paths.map((path, at) => {
                          const chosen = selected.find((d) => d.path === path),
                            disk = snapshot?.disks.find((d) => d.path === path),
                            id = "storage-" + service + "-" + at;
                          return (
                            <li key={path}>
                              {check(path, !!chosen, (on) =>
                                select(service, path, on, chosen?.sharedGroup),
                              )}
                              <small>
                                {!data
                                  ? "—"
                                  : disk
                                    ? t("{total} total · {free} free", {
                                        total: storageBytes(disk.totalSpace),
                                        free: storageBytes(disk.freeSpace),
                                      })
                                    : t(
                                        "A selected storage path is unavailable",
                                      )}
                              </small>
                              {chosen && (
                                <div class="v2-form">
                                  {field(id + "-name", t("Name"), (a) => (
                                    <input
                                      {...a}
                                      class="v2-input"
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
                                  ))}
                                  {check(
                                    t("Shared storage"),
                                    !!chosen.sharedGroup,
                                    (on) =>
                                      select(
                                        service,
                                        path,
                                        true,
                                        on ? "shared" : "",
                                      ),
                                  )}
                                  {!!chosen.sharedGroup &&
                                    field(
                                      id + "-group",
                                      t("Shared storage group"),
                                      (a) => (
                                        <input
                                          {...a}
                                          class="v2-input"
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
                                      ),
                                      {
                                        help: (
                                          <HelpTip
                                            label="Shared storage group"
                                            text="Use the same group name only for duplicate paths reporting the same filesystem capacity. Each selected area has its own chart; overlapping shares are not added."
                                          />
                                        ),
                                      },
                                    )}
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p class={data ? undefined : "v2-set-wait"}>
                        {t("Refresh storage to load available paths.")}
                      </p>
                    )}
                    {snapshot?.error && (
                      <div class="v2-notice v2-notice--error">
                        {t(snapshot.error)}
                      </div>
                    )}
                  </>,
                  <button
                    type="button"
                    class="v2-btn v2-btn--sm"
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
                    <span class="v2-btn-icon" aria-hidden="true">
                      <RefreshCw
                        size={ICON.button}
                        class={busy === service ? "v2-spin" : undefined}
                      />
                    </span>
                    {t("Refresh storage")}
                  </button>,
                  "v2-card--inset",
                );
              })}
            </div>
          )}
        </>,
      )}
    </>
  );
}
