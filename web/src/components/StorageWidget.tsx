import { usePolling } from "../hooks/usePolling";
import { ICON } from "../ui";
import { ChevronLeft, ChevronRight } from "lucide-preact";
import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { readPreference, writePreference } from "../browser-storage";
import { getLocale, t, useI18n } from "../i18n";
import type { Settings, StorageData } from "../types";
export function storageBytes(n: number) {
  const divisor = n >= 1e12 ? 1e12 : 1e9;
  return (
    new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 }).format(
      n / divisor,
    ) + (divisor === 1e12 ? " TB" : " GB")
  );
}
export function StorageWidget({
  settings,
  scope,
}: {
  settings: Settings;
  scope: string;
}) {
  useI18n();
  const [data, setData] = useState<StorageData | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(readPreference("scopearr-storage-areas") || "{}");
    } catch {
      return {};
    }
  });
  useEffect(
    () => writePreference("scopearr-storage-areas", JSON.stringify(selected)),
    [selected],
  );
  const [error, setError] = useState(false);
  usePolling(
    async (signal) => {
      try {
        const next = await api<StorageData>(
          "storage",
          "GET",
          undefined,
          signal,
        );
        if (!signal.aborted) {
          setData(next);
          setError(false);
        }
      } catch (error) {
        if (!signal.aborted) setError(true);
      }
    },
    () => 60000,
    [JSON.stringify(settings.widgets.storage)],
  );
  const areas = data?.areas[scope] || [];
  const total = areas.find((a) => a.key === selected[scope]) || areas[0];
  const used = total?.total ? (total.used / total.total) * 100 : 0;
  return (
    <article class="distribution-card storage-widget">
      <div class="distribution-title">
        <h3>{t("Storage")}</h3>
      </div>
      {!!areas.length && (
        <div
          class="storage-area-navigation"
          role="group"
          aria-label={t("Storage area")}
        >
          <button
            class="icon-button"
            type="button"
            disabled={areas.length < 2}
            aria-label={t("Previous storage area")}
            onClick={() =>
              setSelected({
                ...selected,
                [scope]:
                  areas[
                    (areas.indexOf(total!) - 1 + areas.length) % areas.length
                  ].key,
              })
            }
            title={t("Previous storage area")}
          >
            <ChevronLeft size={ICON.button} />
          </button>
          <strong title={total?.paths.join(" · ")}>
            {total?.label.replace(/^radarr · |^sonarr · /, "")}
          </strong>
          <button
            class="icon-button"
            type="button"
            disabled={areas.length < 2}
            aria-label={t("Next storage area")}
            onClick={() =>
              setSelected({
                ...selected,
                [scope]: areas[(areas.indexOf(total!) + 1) % areas.length].key,
              })
            }
            title={t("Next storage area")}
          >
            <ChevronRight size={ICON.button} />
          </button>
        </div>
      )}
      {total && total.total > 0 ? (
        <>
          <div
            class="storage-chart"
            title={total.paths.join(" · ")}
            role="img"
            aria-label={t("{used} used · {free} free", {
              used: storageBytes(total.used),
              free: storageBytes(total.free),
            })}
            style={{
              background: `conic-gradient(${settings.widgets.colors.used} 0% ${used}%, ${settings.widgets.colors.free} ${used}% 100%)`,
            }}
          >
            <div>
              <strong>{storageBytes(total.total)}</strong>
              <span>{t("Total space")}</span>
            </div>
          </div>
          <dl class="storage-legend">
            {["used", "free"].map((key) => (
              <div>
                <dt>
                  <span
                    class="chart-dot"
                    style={{ backgroundColor: settings.widgets.colors[key] }}
                  />
                  {t(key === "used" ? "Used space" : "Free space")}
                </dt>
                <dd>
                  {storageBytes(key === "used" ? total.used : total.free)}
                </dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p class="quiet">
          {t(
            error
              ? "Storage readings are stale or unavailable"
              : "Select storage paths in Settings → Widgets.",
          )}
        </p>
      )}
      {total?.error && <p class="quiet">{t(total.error)}</p>}
    </article>
  );
}
