import { RotateCw } from "lucide-preact";
import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { readPreference, writePreference } from "../browser-storage";
import { dashboardService, makeDashboardFilter } from "../dashboard-filter";
import { dashboardWidgets, kpiModels } from "../dashboard-model";
import { dashboardOrder, dashboardScope } from "../dashboard-widgets";
import { t, useI18n } from "../i18n";
import { groupResolutionBuckets } from "../resolution-groups";
import type { NavTarget } from "../router";
import type { Service, Settings, Statistics, Status } from "../types";
import { ICON } from "../ui";
import { DistributionCard } from "./dashboard/DistributionCard";
import { IncompleteCard } from "./dashboard/IncompleteCard";
import { KpiCard } from "./dashboard/KpiCard";
import { MatchingCard } from "./dashboard/MatchingCard";
import { StorageCard } from "./dashboard/StorageCard";
import { Segmented } from "./list/Segmented";
import { PageHeader } from "./PageHeader";

// The dashboard (docs/STYLEGUIDE.md, Part 1, 11.3), without the transition
// sheet: the KPI row, the widget row (Incomplete metadata, Media server
// matching, Storage when the widget settings show it, ruling R-E), the
// scope tabs and the grid of the visible distributions in the order of the
// settings. Every card is there from the first paint and keeps its size;
// only screen readers hear "Loading dashboard …". A failed load offers
// Retry in the header's action slot. Each KPI opens its list; a value or
// Show opens the filtered list of the scope's service (openDashboardFilter).
export function StatisticsPage({
  status,
  settings,
  service,
  hrefOf,
  open,
  onFilter,
}: {
  status: Status;
  settings: Settings | null;
  service: Service;
  hrefOf(target: NavTarget): string;
  open(target: NavTarget): void;
  onFilter(field: string, value: string, scope: string): void;
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
  const widgets = dashboardWidgets(
    settings?.widgets.order ?? dashboardOrder,
    settings?.widgets.visible ?? dashboardOrder,
  );
  const filterHref = (field: string, value: string) =>
    hrefOf({
      view: "library",
      service: dashboardService(scope, service),
      query: makeDashboardFilter(field, value, scope).query,
    });
  // The 1.7.0 buckets and totals: SD grouped as the settings say, audio
  // shares of the files, language shares of the language totals.
  const buckets = (field: string) => {
    const values = data?.distributions[scope]?.[field] || [];
    return field === "resolution"
      ? groupResolutionBuckets(values, settings?.groupSD !== false)
      : values;
  };
  const total = (field: string) =>
    !data
      ? null
      : field === "audio"
        ? data.fileTotals[scope] || 0
        : field === "language"
          ? data.languageTotals[scope] || 0
          : buckets(field).reduce((sum, bucket) => sum + bucket.count, 0);
  return (
    <div class="v2-dash">
      <PageHeader
        title={t("Dashboard")}
        meta={t("From the local cache")}
        actions={
          error ? (
            <button
              type="button"
              class="v2-btn"
              onClick={() => setRetry((value) => value + 1)}
            >
              <RotateCw size={ICON.button} aria-hidden="true" />
              {t("Retry")}
            </button>
          ) : undefined
        }
      />
      <p class="v2-sr-only" role="status">
        {!data && !error ? t("Loading dashboard …") : ""}
      </p>
      <div class="v2-dash-kpis">
        {kpiModels(data).map((kpi) => (
          <KpiCard
            key={kpi.key}
            model={kpi}
            href={hrefOf(kpi.target)}
            open={() => open(kpi.target)}
          />
        ))}
      </div>
      <div class="v2-dash-row">
        <IncompleteCard
          count={data ? data.incomplete : null}
          href={filterHref("metadata", "incomplete")}
          open={() => onFilter("metadata", "incomplete", scope)}
        />
        <MatchingCard
          counts={data ? data.emby : null}
          files={data ? data.files : null}
        />
        {widgets.storage && settings && (
          <StorageCard settings={settings} scope={scope} />
        )}
      </div>
      <div class="v2-dash-head">
        <h2>{t("Distribution")}</h2>
        <Segmented
          kind="tabs"
          label={t("Statistics scope")}
          idPrefix="dashboard-scope"
          value={scope}
          items={[
            { value: "all", label: t("Entire library") },
            { value: "radarr", label: t("Movies") },
            { value: "sonarr", label: t("TV series") },
          ]}
          select={(value) => {
            const next = dashboardScope(value);
            setScope(next);
            writePreference("scopearr-dashboard-scope", next);
          }}
        />
      </div>
      <div
        class="v2-dash-grid"
        role="tabpanel"
        id={"dashboard-scope-panel-" + scope}
        aria-labelledby={"dashboard-scope-tab-" + scope}
      >
        {widgets.distributions.map((field) => (
          <DistributionCard
            key={field}
            field={field}
            buckets={data ? buckets(field) : null}
            total={total(field)}
            hrefOf={(value) => filterHref(field, value)}
            open={(value) => onFilter(field, value, scope)}
          />
        ))}
        {!widgets.distributions.length && !widgets.storage && (
          <p class="v2-dash-note">{t("No dashboard widgets selected.")}</p>
        )}
      </div>
    </div>
  );
}
