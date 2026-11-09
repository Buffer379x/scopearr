import { ChevronLeft, ChevronRight, HardDrive } from "lucide-preact";
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { api } from "../../api";
import { readPreference, writePreference } from "../../browser-storage";
import { storageBytes, storageRing } from "../../dashboard-model";
import { usePolling } from "../../hooks/usePolling";
import { t, useI18n } from "../../i18n";
import type { Settings, StorageData } from "../../types";
import { ICON, percent } from "../../ui";

// Keeps an empty value's line (a placeholder before the data).
const NBSP = "\u00a0";

// The ring in a 120 viewBox: radius 52 and the --ring-stroke (CSS) fit it.
const R = 52;
const LENGTH = 2 * Math.PI * R;
const arc = (share: number) => ((LENGTH * share) / 100).toFixed(2);

// Storage in the widget row (docs/STYLEGUIDE.md, Part 1, 10.10 and 11.3):
// the 1.7.0 StorageWidget as a ring. The areas of the scope with their
// buttons, remembered per scope in scopearr-storage-areas; a reading every
// 60s; used and free in the user's colors, the used share in the middle,
// and the legend Used, Free and Total, one line each. Before the first
// reading the ring shows its track; without a reading (no paths, or an
// error) the 1.7.0 hint takes the ring's place. An area's error reads below
// in at most two lines (in full as its title and to screen readers), so the
// ring's place keeps its height in every state.
export function StorageCard({
  settings,
  scope,
}: {
  settings: Settings;
  scope: string;
}): JSX.Element {
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
      } catch {
        if (!signal.aborted) setError(true);
      }
    },
    () => 60000,
    [JSON.stringify(settings.widgets.storage)],
  );
  const areas = data?.areas[scope] || [];
  const area = areas.find((a) => a.key === selected[scope]) || areas[0];
  const ring = storageRing(area);
  const step = (by: number) =>
    setSelected({
      ...selected,
      [scope]:
        areas[(areas.indexOf(area!) + by + areas.length) % areas.length].key,
    });
  const colors = settings.widgets.colors;
  const paths = area?.paths.join(" · ");
  // An area's own error, under the legend or the hint (1.7.0).
  const areaError = area?.error && (
    <p class="v2-ring-error" title={t(area.error)}>
      {t(area.error)}
    </p>
  );
  const legend: [string, string | undefined, number | undefined][] = [
    ["Used space", colors.used, ring?.used],
    ["Free space", colors.free, ring?.free],
    ["Total space", undefined, ring?.total],
  ];
  return (
    <article class="v2-card v2-widget">
      <div class="v2-widget-head">
        <span class="v2-tile v2-tile--md" aria-hidden="true">
          <HardDrive size={ICON.large} />
        </span>
        <div class="v2-widget-name">
          <h2 class="v2-widget-title">{t("Storage")}</h2>
          <p class="v2-widget-sub" title={paths}>
            {area ? area.label.replace(/^radarr · |^sonarr · /, "") : NBSP}
          </p>
        </div>
        {!!areas.length && (
          <div class="v2-ring-nav" role="group" aria-label={t("Storage area")}>
            {(
              [
                [-1, "Previous storage area", ChevronLeft],
                [1, "Next storage area", ChevronRight],
              ] as const
            ).map(([by, label, Icon]) => (
              <button
                key={label}
                type="button"
                class="v2-icon-btn v2-icon-btn--sm"
                disabled={areas.length < 2}
                aria-label={t(label)}
                title={t(label)}
                onClick={() => step(by)}
              >
                <Icon size={ICON.button} />
              </button>
            ))}
          </div>
        )}
      </div>
      <div class="v2-ring">
        {ring || (!data && !error) ? (
          <>
            <div
              class="v2-ring-chart"
              role={ring ? "img" : undefined}
              aria-label={
                ring
                  ? t("{used} used · {free} free", {
                      used: storageBytes(ring.used),
                      free: storageBytes(ring.free),
                    })
                  : undefined
              }
              title={paths}
            >
              <svg viewBox="0 0 120 120" aria-hidden="true">
                <circle class="v2-ring-track" cx="60" cy="60" r={R} />
                {ring && (
                  <>
                    <circle
                      class="v2-ring-arc"
                      cx="60"
                      cy="60"
                      r={R}
                      stroke={colors.used}
                      strokeDasharray={arc(ring.share) + " " + LENGTH}
                    />
                    <circle
                      class="v2-ring-arc"
                      cx="60"
                      cy="60"
                      r={R}
                      stroke={colors.free}
                      strokeDasharray={arc(100 - ring.share) + " " + LENGTH}
                      strokeDashoffset={"-" + arc(ring.share)}
                    />
                  </>
                )}
              </svg>
              <b class="v2-ring-value">{ring ? percent(ring.share) : ""}</b>
            </div>
            <div class="v2-ring-side">
              <dl class="v2-ring-legend">
                {legend.map(([label, color, bytes]) => (
                  <div key={label}>
                    <dt>
                      <span
                        class={color ? "v2-dot" : "v2-dot v2-dot--off"}
                        style={color ? { background: color } : undefined}
                      />
                      <span class="v2-ring-label">{t(label)}</span>
                    </dt>
                    <dd>{bytes === undefined ? NBSP : storageBytes(bytes)}</dd>
                  </div>
                ))}
              </dl>
              {areaError}
            </div>
          </>
        ) : (
          <div class="v2-ring-side">
            <p class="v2-ring-note">
              {t(
                error
                  ? "Storage readings are stale or unavailable"
                  : "Select storage paths in Settings → Widgets.",
              )}
            </p>
            {areaError}
          </div>
        )}
      </div>
    </article>
  );
}
