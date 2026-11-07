import { logQuery, parseLogQuery } from "./event-log";
import { pageNumber, searchOf, sortOf, TOOLS, toolQuery } from "./tool-route";
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
export const DEFAULT_ROUTE: Route = Object.freeze({ view: "statistics" });
// What an in-app link opens; its action fills in the rest from the current
// state (see useAppNavigation: openLink, linkHref).
export type NavTarget =
  | { view: "statistics" }
  // Sets or clears only the instance filter.
  | { view: "library"; service: Service; instance: string }
  // Replaces the filters of the service.
  | { view: "library"; service: Service; query: string }
  | { view: ToolView; q?: string }
  | { view: "settings"; section: SettingsSectionId; tab?: string };
// Connection tabs are service tab IDs, which the page checks; other sections
// accept only these tabs or none.
const settingsTabs: Partial<Record<SettingsSectionId, readonly string[]>> = {
  appearance: ["general", "lists", "colors"],
  system: ["info", "log"],
};
const libraryReserved = ["page", "sort", "dir", "service"];

const withQuery = (query: string) => (query ? "?" + query : "");

// The filters of a library query in their order, without the reserved keys
// and without a blank search.
function libraryFilters(params: URLSearchParams) {
  const filters = new URLSearchParams();
  for (const [key, value] of params)
    if (!libraryReserved.includes(key) && (key !== "q" || searchOf(value)))
      filters.append(key, value);
  return filters;
}

// title/asc is the library default and reads as null, like a stored sort.
function librarySort(field: string | null, direction: string | null) {
  const sort = sortOf(field, direction, MOVIE_SORT_FIELDS);
  return sort?.field === "title" && sort.direction === "asc" ? null : sort;
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
  if (segments.length === 1 && (first === "movies" || first === "series"))
    return {
      view: "library",
      service: first === "movies" ? "radarr" : "sonarr",
      filters: libraryFilters(params).toString(),
      page: pageNumber(params.get("page")) || 1,
      sort: librarySort(params.get("sort"), params.get("dir")),
    };
  const tool = (Object.keys(TOOLS) as ToolView[]).find(
    (view) => TOOLS[view].path === second,
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
      const query = libraryFilters(new URLSearchParams(route.filters));
      if (Number.isSafeInteger(route.page) && route.page > 1)
        query.set("page", String(route.page));
      const sort = librarySort(
        route.sort?.field || null,
        route.sort?.direction || null,
      );
      if (sort) {
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
        TOOLS[route.view].path +
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
