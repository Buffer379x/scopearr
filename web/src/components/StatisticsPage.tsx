import { percent } from "../ui";
import { ICON } from "../ui";
import { readPreference, writePreference } from "../browser-storage";
import { groupResolutionBuckets } from "../resolution-groups";
import { presentedTagLabel } from "../tag-labels";
import { HelpPopover } from "./HelpPopover";
import { matchingGroups, matchingCount } from "../media-matching";
import { dashboardOrder, dashboardScope } from "../dashboard-widgets";
import { StorageWidget } from "./StorageWidget";
import { getLocale, t, useI18n } from "../i18n";
import {
  ChartNoAxesColumnIncreasing,
  Database,
  LoaderCircle,
} from "lucide-preact";
import { useContext, useEffect, useState } from "preact/hooks";
import type { Statistics, Status, Settings } from "../types";

import { LanguageFlag } from "./LanguageFlag";
import { audioLanguageLabel } from "../languages";
import { api } from "../api";
import { count, labels, Tag, TagColors, TagLabels } from "../ui";
const chartPalette = [
  "#62b69d",
  "#729acb",
  "#b59ad9",
  "#d4b56f",
  "#ce8da8",
  "#78b5c2",
  "#aaa96e",
  "#c9946c",
];
export function StatisticsPage({
  status,
  settings,
  onFilter,
}: {
  status: Status;
  settings: Settings | null;
  onFilter: (field: string, value: string, scope: string) => void;
}) {
  useI18n();
  const [data, setData] = useState<Statistics | null>(null),
    [scope, setScope] = useState(() =>
      dashboardScope(readPreference("scopearr-dashboard-scope")),
    ),
    [retry, setRetry] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setError("");
    api<Statistics>("statistics", "GET", undefined, controller.signal)
      .then((value) => {
        if (current) setData(value);
      })
      .catch((e) => {
        if (current && e.name !== "AbortError") setError(e.message);
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [
    JSON.stringify(status.sync),
    status.recognitionRevision,
    status.cacheRevision,
    retry,
  ]);
  const order = settings?.widgets.order ?? dashboardOrder;
  const visible = settings?.widgets.visible ?? dashboardOrder;
  const widgets: Record<string, import("preact").ComponentChildren> = data
    ? {
        ...Object.fromEntries(
          ["resolution", "codec", "source", "audio"].map((field) => [
            field,
            <DistributionChart
              field={field}
              buckets={
                field === "resolution"
                  ? groupResolutionBuckets(
                      data.distributions[scope]?.[field] || [],
                      settings?.groupSD !== false,
                    )
                  : data.distributions[scope]?.[field] || []
              }
              totalOverride={
                field === "audio" ? data.fileTotals[scope] || 0 : undefined
              }
              onFilter={(value) => onFilter(field, value, scope)}
            />,
          ]),
        ),
        language: (
          <LanguageDistribution
            buckets={data.distributions[scope]?.language || []}
            total={data.languageTotals[scope] || 0}
            onFilter={(value) => onFilter("language", value, scope)}
          />
        ),
        storage: settings && (
          <StorageWidget settings={settings} scope={scope} />
        ),
      }
    : {};
  return (
    <section class="statistics-page" aria-label={t("Dashboard")}>
      <div class="statistics-heading">
        <div>
          <h1>{t("Dashboard")}</h1>
        </div>
        <span class="quiet">
          <Database size={ICON.label} />
          {t("From the local cache")}
        </span>
      </div>

      {error && (
        <button class="button" onClick={() => setRetry((value) => value + 1)}>
          {t("Retry")}
        </button>
      )}
      {!data && !error && (
        <p class="quiet">
          <LoaderCircle class="spin" size={ICON.button} />
          {t("Loading dashboard …")}
        </p>
      )}
      {data && (
        <>
          <div class="stat-widgets">
            {[
              {
                label: t("Movies"),
                value: data.movies,
                detail: t("with existing files"),
              },
              {
                label: t("TV series"),
                value: data.series,
                detail: t("with existing episodes"),
              },
              {
                label: t("Episodes"),
                value: data.episodes,
                detail: t("including specials and multi-episode files"),
              },
              {
                label: t("Media files"),
                value: data.files,
                detail: t("movie and episode files"),
              },
            ].map((widget) => (
              <article class="stat-widget">
                <div>
                  <span>{widget.label}</span>
                </div>
                <strong>{count(widget.value)}</strong>
                <small>{widget.detail}</small>
              </article>
            ))}
          </div>
          <section class="quality-widgets" aria-label={t("Metadata quality")}>
            <article class="stat-widget">
              <span>{t("Incomplete metadata")}</span>
              <strong>{count(data.incomplete)}</strong>
              <small>
                {t(
                  "Resolution, codec, source, audio and language; HDR may be SDR or unknown.",
                )}
              </small>
            </article>
            <article class="stat-widget">
              <span>{t("Media server matching")}</span>
              <dl>
                {matchingGroups.map((group) => (
                  <div>
                    <dt>
                      {t(group.label)}{" "}
                      <HelpPopover label={group.label} text={group.help} />
                    </dt>
                    <dd>{count(matchingCount(data.emby, group.states))}</dd>
                  </div>
                ))}
              </dl>
            </article>
          </section>
          <div class="distribution-heading">
            <div>
              <h2>{t("Distribution")}</h2>
            </div>
            <div
              class="statistics-scopes"
              role="group"
              aria-label={t("Statistics scope")}
            >
              {[
                { value: "all", label: t("Entire library") },
                { value: "radarr", label: t("Movies") },
                { value: "sonarr", label: t("TV series") },
              ].map((item) => (
                <button
                  class={scope === item.value ? "active" : ""}
                  aria-pressed={scope === item.value}
                  onClick={() => {
                    const next = dashboardScope(item.value);
                    setScope(next);
                    writePreference("scopearr-dashboard-scope", next);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div class="dashboard-widget-grid">
            {order
              .filter((id) => visible.includes(id))
              .map((id) => (
                <div key={id} class="dashboard-widget-slot">
                  {widgets[id]}
                </div>
              ))}
          </div>
          {!visible.length && (
            <p class="quiet">{t("No dashboard widgets selected.")}</p>
          )}
        </>
      )}
    </section>
  );
}
function DistributionChart({
  field,
  buckets,
  onFilter,
  totalOverride,
}: {
  totalOverride?: number;
  field: string;
  onFilter: (value: string) => void;
  buckets: { value: string; count: number }[];
}) {
  useI18n();
  const [expanded, setExpanded] = useState(false);
  const colors = useContext(TagColors);
  const tagLabels = useContext(TagLabels);
  const bucketLabel = (value: string) =>
    presentedTagLabel(field, value, tagLabels) || t("Unknown");
  const total = totalOverride ?? buckets.reduce((sum, b) => sum + b.count, 0);
  const heading = field === "audio" ? t("Audio") : labels[field];
  const occurrences = buckets.reduce((sum, b) => sum + b.count, 0);
  const colored = [...buckets]
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .map((bucket, i) => ({
      ...bucket,
      color:
        colors[field + ":" + (bucket.value || "__unknown__")] ||
        (!bucket.value ? "#87949c" : chartPalette[i % chartPalette.length]),
    }));
  return (
    <article class="distribution-card">
      <div class="distribution-title">
        <h3>{heading}</h3>
      </div>
      {total ? (
        <>
          <div
            class="distribution-stack"
            role="img"
            aria-label={
              labels[field] +
              ": " +
              colored
                .map((b) => bucketLabel(b.value) + " " + count(b.count))
                .join(", ")
            }
          >
            {colored.map((b) => (
              <span
                style={{
                  width: (b.count / occurrences) * 100 + "%",
                  backgroundColor: b.color,
                }}
                title={bucketLabel(b.value) + ": " + count(b.count)}
              />
            ))}
          </div>
          <ul class="distribution-list">
            {(expanded ? colored : colored.slice(0, 5)).map((b) => (
              <li>
                <button
                  type="button"
                  class="distribution-label chart-filter"
                  onClick={() => onFilter(b.value)}
                  aria-label={t("Filter {field}: {value}", {
                    field: labels[field],
                    value: bucketLabel(b.value),
                  })}
                  title={t("Filter {field}: {value}", {
                    field: labels[field],
                    value: bucketLabel(b.value),
                  })}
                >
                  <span
                    class="chart-dot"
                    style={{ backgroundColor: b.color }}
                  />
                  <Tag
                    value={b.value}
                    kind={
                      field === "resolution" ? "resolution r" + b.value : field
                    }
                  />
                  <b>{count(b.count)}</b>
                  <span>{percent((b.count / total) * 100)}</span>
                </button>
                <div class="distribution-track">
                  <span
                    style={{
                      width: (b.count / total) * 100 + "%",
                      backgroundColor: b.color,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
          {colored.length > 5 && (
            <button
              class="button widget-expand"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {t(expanded ? "Less" : "More")}
            </button>
          )}
        </>
      ) : (
        <div class="statistics-empty">
          <ChartNoAxesColumnIncreasing size={ICON.empty} />
          <p>{t("No files in cache yet")}</p>
        </div>
      )}
    </article>
  );
}

function LanguageDistribution({
  buckets,
  total,
  onFilter,
}: {
  buckets: { value: string; count: number }[];
  total: number;
  onFilter: (value: string) => void;
}) {
  useI18n();
  const [expanded, setExpanded] = useState(false);
  const ranked = [...buckets].sort(
    (a, b) => b.count - a.count || a.value.localeCompare(b.value),
  );
  return (
    <article class="distribution-card language-distribution">
      <div class="distribution-title">
        <h3>{t("Language")}</h3>
      </div>
      {total ? (
        <ul class="distribution-list">
          {(expanded ? ranked : ranked.slice(0, 5)).map((bucket, i) => {
            const label = t(audioLanguageLabel(bucket.value, getLocale())),
              percentage = (bucket.count / total) * 100;
            return (
              <li>
                <button
                  class="distribution-label chart-filter language-chart-filter"
                  onClick={() => onFilter(bucket.value)}
                  aria-label={t("Filter language: {value}", { value: label })}
                  title={t("Filter language: {value}", { value: label })}
                >
                  <LanguageFlag value={bucket.value} focusable={false} />
                  <span>{label}</span>
                  <b>{count(bucket.count)}</b>
                  <span>{percent(percentage)}</span>
                </button>
                <div class="distribution-track">
                  <span
                    style={{
                      width: percentage + "%",
                      backgroundColor: chartPalette[i % chartPalette.length],
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p class="quiet">{t("No files in cache yet")}</p>
      )}
      {ranked.length > 5 && (
        <button
          class="button widget-expand"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {t(expanded ? "Less" : "More")}
        </button>
      )}
    </article>
  );
}
