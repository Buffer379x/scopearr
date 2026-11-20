import { getLocale, t } from "./i18n";
import { dashboardOrder } from "./dashboard-widgets";
import type { NavTarget } from "./router";
import type { Statistics, StorageArea } from "./types";

// The dashboard's cards as data (docs/STYLEGUIDE.md, Part 1, 10.2, 10.10
// and 11.3): the KPI row, the distribution rows, which widgets show, and the
// storage ring.

// The four KPIs of 1.7.0 with their detail texts; Media files is the hero.
// value is null before the data. Each opens its list without filters (rc.4
// R1): Movies the movie library, TV series the TV library in its collapsed
// series view (a page of series), Episodes the TV library expanded; Media
// files spans both libraries and opens nothing (target null).
export type KpiModel = {
  key: "movies" | "series" | "episodes" | "files";
  label: string;
  detail: string;
  value: number | null;
  hero: boolean;
  target: NavTarget | null;
};
const KPIS = [
  ["movies", "Movies", "with existing files", "radarr"],
  ["series", "TV series", "with existing episodes", "sonarr"],
  [
    "episodes",
    "Episodes",
    "including specials and multi-episode files",
    "sonarr",
  ],
  ["files", "Media files", "movie and episode files", null],
] as const;
export function kpiModels(data: Statistics | null): KpiModel[] {
  return KPIS.map(([key, label, detail, service]) => ({
    key,
    label: t(label),
    detail: t(detail),
    value: data ? data[key] : null,
    hero: key === "files",
    target: service && {
      view: "library",
      service,
      query: "",
      ...(service === "sonarr" && { seriesView: key === "series" }),
    },
  }));
}

// A card shows five rows, More shows all. share: percent of total (0–100);
// hidden: the rows beyond the first five (More shows when it is above 0).
export const DISTRIBUTION_ROWS = 5;
export type DistributionRow = {
  value: string;
  count: number;
  share: number;
  unknown: boolean;
};
export function distributionRows(
  buckets: readonly { value: string; count: number }[],
  total: number,
  expanded: boolean,
): { rows: DistributionRow[]; hidden: number } {
  const rows = [...buckets]
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .map(({ value, count }) => ({
      value,
      count,
      share: total > 0 ? (count * 100) / total : 0,
      unknown: value === "" || value === "__unknown__",
    }));
  return {
    rows: expanded ? rows : rows.slice(0, DISTRIBUTION_ROWS),
    hidden: Math.max(0, rows.length - DISTRIBUTION_ROWS),
  };
}

// The visible distribution widgets in the order of the settings; storage
// sits in the widget row instead (ruling R-E).
export function dashboardWidgets(
  order: readonly string[],
  visible: readonly string[],
): { distributions: string[]; storage: boolean } {
  return {
    distributions: order.filter(
      (id) =>
        id !== "storage" && dashboardOrder.includes(id) && visible.includes(id),
    ),
    storage: visible.includes("storage"),
  };
}

// The ring of a storage area: none without a total. share: percent used.
export function storageRing(
  area: StorageArea | undefined,
): { used: number; free: number; total: number; share: number } | null {
  if (!area || !(area.total > 0)) return null;
  return {
    used: area.used,
    free: area.free,
    total: area.total,
    share: Math.min(100, Math.max(0, (area.used * 100) / area.total)),
  };
}

// Decimal gigabytes or terabytes with at most one decimal, as 1.7.0's
// StorageWidget wrote them.
export function storageBytes(n: number) {
  const divisor = n >= 1e12 ? 1e12 : 1e9;
  return (
    new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 }).format(
      n / divisor,
    ) + (divisor === 1e12 ? " TB" : " GB")
  );
}
