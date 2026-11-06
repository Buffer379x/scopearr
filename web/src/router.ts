import { parseToolFilters } from "./browser-storage";
import type { ToolFilters } from "./browser-storage";
import type { TableSort } from "./components/SortableHeader";
import { logQuery, parseLogQuery } from "./event-log";
import type { FilmSort, Service } from "./types";

// Hash routes (#/…) as pure functions. Path segments use encodeURIComponent,
// queries URLSearchParams (space = "+"). formatRoute returns the one canonical
// form, so comparisons run through formatRoute(parseRoute(hash)).

export type ToolView = "mux" | "disks" | "files";
export const SETTINGS_SECTIONS = [
  "connections",
  "appearance",
  "widgets",
  "custom",
  "recognition",
  "system",
] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number];
export const MOVIE_SORT_FIELDS: readonly string[] = [
  "info",
  "title",
  "year",
  "resolution",
  "codec",
  "source",
  "processing",
  "size",
  "hdr",
  "bitDepth",
  "audio",
  "channels",
  "custom",
];
export type Route =
  | { view: "statistics" }
  | {
      view: "library";
      service: Service;
      filters: string;
      page: number;
      sort: FilmSort | null;
    }
  | { view: ToolView; query: string }
  | {
      view: "settings";
      section: SettingsSectionId;
      tab: string;
      query: string;
    };
export const DEFAULT_ROUTE: Route = { view: "statistics" };

const toolPaths: Record<ToolView, string> = {
  mux: "mux",
  disks: "placement",
  files: "files",
};
// Repeatable filter keys per tool, in URL order between q and sort.
const toolFilterKeys: Record<ToolView, readonly string[]> = {
  mux: ["status"],
  disks: ["status", "target", "kind"],
  files: ["status", "kind"],
};
// Connection tabs are service tab IDs, which the page checks; other sections
// accept only these tabs or none.
const settingsTabs: Partial<Record<SettingsSectionId, readonly string[]>> = {
  appearance: ["general", "lists", "colors"],
  system: ["info", "log"],
};
const libraryReserved = ["page", "sort", "dir", "service"];

const withQuery = (query: string) => (query ? "?" + query : "");

function pageNumber(value: string | null) {
  const page = /^\d+$/.test(value || "") ? Number(value) : 0;
  return Number.isSafeInteger(page) && page >= 1 ? page : undefined;
}

function sortOf(
  field: string | null,
  direction: string | null,
  fields?: readonly string[],
): { field: string; direction: "asc" | "desc" } | null {
  return field &&
    (!fields || fields.includes(field)) &&
    (direction === "asc" || direction === "desc")
    ? { field, direction }
    : null;
}

// q, the tool's own filter keys, sort+dir and a page from 2, in that order.
function toolQuery(view: ToolView, params: URLSearchParams) {
  const query = new URLSearchParams();
  const q = params.get("q");
  if (q) query.set("q", q);
  for (const key of toolFilterKeys[view])
    for (const value of params.getAll(key)) if (value) query.append(key, value);
  const sort = sortOf(params.get("sort"), params.get("dir"));
  if (sort) {
    query.set("sort", sort.field);
    query.set("dir", sort.direction);
  }
  const page = pageNumber(params.get("page"));
  if (page && page > 1) query.set("page", String(page));
  return query.toString();
}

function settingsRoute(
  section: string,
  tab: string,
  query: string,
): Extract<Route, { view: "settings" }> {
  const known = (SETTINGS_SECTIONS as readonly string[]).includes(section),
    id = known ? (section as SettingsSectionId) : "connections";
  const kept =
    known &&
    (id === "connections" ? tab !== "" : !!settingsTabs[id]?.includes(tab))
      ? tab
      : "";
  return {
    view: "settings",
    section: id,
    tab: kept,
    query:
      id === "system" && kept === "log" ? logQuery(parseLogQuery(query)) : "",
  };
}

export function parseRoute(hash: string): Route {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash,
    mark = raw.indexOf("?"),
    path = mark < 0 ? raw : raw.slice(0, mark),
    query = mark < 0 ? "" : raw.slice(mark + 1);
  if (!path.startsWith("/")) return DEFAULT_ROUTE;
  let segments: string[];
  try {
    // Re-encoding rejects lone surrogates, so every parsed route formats.
    segments = path
      .slice(1)
      .split("/")
      .map((segment) => {
        const value = decodeURIComponent(segment);
        encodeURIComponent(value);
        return value;
      });
  } catch {
    return DEFAULT_ROUTE;
  }
  const [first, second = "", third = ""] = segments,
    params = new URLSearchParams(query);
  if (segments.length === 1 && (first === "movies" || first === "series")) {
    const filters = new URLSearchParams();
    for (const [key, value] of params)
      if (!libraryReserved.includes(key)) filters.append(key, value);
    return {
      view: "library",
      service: first === "movies" ? "radarr" : "sonarr",
      filters: filters.toString(),
      page: pageNumber(params.get("page")) || 1,
      sort: sortOf(params.get("sort"), params.get("dir"), MOVIE_SORT_FIELDS),
    };
  }
  const tool = (Object.keys(toolPaths) as ToolView[]).find(
    (view) => toolPaths[view] === second,
  );
  if (segments.length === 2 && first === "tools" && tool)
    return { view: tool, query: toolQuery(tool, params) };
  if (segments.length <= 3 && first === "settings")
    return settingsRoute(second, third, query);
  return DEFAULT_ROUTE;
}

export function formatRoute(route: Route): string {
  switch (route.view) {
    case "library": {
      const query = new URLSearchParams(route.filters);
      for (const key of libraryReserved) query.delete(key);
      if (Number.isSafeInteger(route.page) && route.page > 1)
        query.set("page", String(route.page));
      const sort = sortOf(
        route.sort?.field || null,
        route.sort?.direction || null,
        MOVIE_SORT_FIELDS,
      );
      if (sort && !(sort.field === "title" && sort.direction === "asc")) {
        query.set("sort", sort.field);
        query.set("dir", sort.direction);
      }
      return (
        (route.service === "sonarr" ? "#/series" : "#/movies") +
        withQuery(query.toString())
      );
    }
    case "mux":
    case "disks":
    case "files":
      return (
        "#/tools/" +
        toolPaths[route.view] +
        withQuery(toolQuery(route.view, new URLSearchParams(route.query)))
      );
    case "settings": {
      const settings = settingsRoute(route.section, route.tab, route.query);
      return (
        "#/settings/" +
        settings.section +
        (settings.tab ? "/" + encodeURIComponent(settings.tab) : "") +
        withQuery(settings.query)
      );
    }
    default:
      return "#/dashboard";
  }
}

// The parts of a tool page's state that its route names; storage fills the
// rest. URL filters without a page start on page 1.
export function toolRouteState(
  query: string,
  allowed: {
    statuses: readonly string[];
    kinds?: readonly string[];
    sorts: readonly string[];
  },
): { filters?: ToolFilters; sort?: TableSort; page?: number } {
  const params = new URLSearchParams(query),
    state: { filters?: ToolFilters; sort?: TableSort; page?: number } = {};
  const values = (key: string) => params.getAll(key).filter(Boolean);
  if (
    params.get("q") ||
    ["status", "target", "kind"].some((key) => values(key).length)
  )
    state.filters = parseToolFilters(
      JSON.stringify({
        q: params.get("q") || "",
        statuses: values("status"),
        targets: values("target"),
        kinds: values("kind"),
      }),
      allowed,
    );
  const sort = sortOf(params.get("sort"), params.get("dir"), allowed.sorts);
  if (sort) state.sort = sort;
  const page = pageNumber(params.get("page")) || (state.filters ? 1 : 0);
  if (page) state.page = page;
  return state;
}

export function toolRouteQuery(
  view: ToolView,
  {
    filters,
    sort,
    page,
  }: { filters: ToolFilters; sort: TableSort; page: number },
) {
  const query = new URLSearchParams({ q: filters.q });
  for (const value of filters.statuses) query.append("status", value);
  for (const value of filters.targets) query.append("target", value);
  for (const value of filters.kinds) query.append("kind", value);
  if (sort) {
    query.set("sort", sort.field);
    query.set("dir", sort.direction);
  }
  query.set("page", String(page));
  return toolQuery(view, query);
}
