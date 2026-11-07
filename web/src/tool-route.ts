import { parseToolFilters } from "./browser-storage";
import type { ToolFilters } from "./browser-storage";
import type { TableSort } from "./components/SortableHeader";
import type { ToolView } from "./router";

// Tool route queries and the parts router.ts shares with them. They live
// apart from router.ts, so the tool pages import them without pulling
// router.ts out of the Library chunk.

// The one tool table: each tool's route path, the name of its storage keys
// (scopearr-<storage>-filters/-sort/-page) and its repeatable filter keys,
// in URL order between q and sort.
export const TOOLS: Readonly<
  Record<
    ToolView,
    {
      path: "mux" | "placement" | "files";
      storage: "mux" | "placement" | "filecheck";
      filters: readonly string[];
    }
  >
> = Object.freeze({
  mux: Object.freeze({
    path: "mux",
    storage: "mux",
    filters: Object.freeze(["status"]),
  }),
  disks: Object.freeze({
    path: "placement",
    storage: "placement",
    filters: Object.freeze(["status", "target", "kind"]),
  }),
  files: Object.freeze({
    path: "files",
    storage: "filecheck",
    filters: Object.freeze(["status", "kind"]),
  }),
});

// Every repeatable filter key of the tools.
const filterKeys = [
  ...new Set(Object.values(TOOLS).flatMap((tool) => tool.filters)),
];

// An empty or blank search is no filter.
export const searchOf = (q: string | null) => (q?.trim() ? q : "");

export function pageNumber(value: string | null) {
  const page = /^\d+$/.test(value || "") ? Number(value) : 0;
  return Number.isSafeInteger(page) && page >= 1 ? page : undefined;
}

export function sortOf(
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
export function toolQuery(view: ToolView, params: URLSearchParams) {
  const query = new URLSearchParams();
  const q = searchOf(params.get("q"));
  if (q) query.set("q", q);
  for (const key of TOOLS[view].filters)
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
  const q = searchOf(params.get("q"));
  if (q || filterKeys.some((key) => values(key).length))
    state.filters = parseToolFilters(
      JSON.stringify({
        q,
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
