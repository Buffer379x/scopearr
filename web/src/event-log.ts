export type EventLevel = "error" | "warning" | "info";
export type LogEvent = {
  id: number;
  ts: number;
  level: EventLevel;
  source: string;
  instance: string;
  message: string;
  params: Record<string, string | number | string[]>;
  subject: string;
  detail: string;
  repeat: number;
};
export type EventPage = {
  events: LogEvent[];
  total: number;
  counts: Record<"level" | "source" | "instance", Record<string, number>>;
};
export type LogFilter = {
  q?: string;
  level?: string[];
  source?: string[];
  instance?: string[];
};

export const eventLevels: EventLevel[] = ["error", "warning", "info"];
export const eventSources: Record<string, string> = {
  system: "System",
  auth: "Sign-in",
  settings: "Settings",
  sync: "Synchronization",
  tags: "Tag sync",
  webhook: "Webhooks",
  media: "Media servers",
  mux: "Mux",
  placement: "Disk placement",
  filecheck: "Files & permissions",
  rename: "Rename",
  metadata: "Metadata",
  mediainfo: "MediaInfo",
};
export const levelTag: Record<EventLevel, string> = {
  error: "status-error",
  warning: "status-warn",
  info: "status-info",
};
export const levelLabel: Record<EventLevel, string> = {
  error: "Error",
  warning: "Warning",
  info: "Info",
};
export const LOG_PAGE_SIZE = 25;
export const SYSTEM_TAB_KEY = "scopearr-system-tab";

export function eventQuery(
  filter: LogFilter,
  sort: { field: string; direction: "asc" | "desc" } | null,
  page = 1,
) {
  const query = new URLSearchParams();
  if (filter.q?.trim()) query.set("q", filter.q.trim());
  for (const key of ["level", "source", "instance"] as const)
    for (const value of filter[key] || []) query.append(key, value);
  query.set("sort", sort?.field || "ts");
  query.set("dir", sort?.direction || "desc");
  query.set("limit", String(LOG_PAGE_SIZE));
  query.set("offset", String((page - 1) * LOG_PAGE_SIZE));
  return query.toString();
}

// The log filter of the System → Log route, with the names of eventQuery.
export function logQuery(filter: LogFilter) {
  const query = new URLSearchParams();
  if (filter.q?.trim()) query.set("q", filter.q.trim());
  for (const key of ["level", "source", "instance"] as const)
    for (const value of filter[key] || []) if (value) query.append(key, value);
  return query.toString();
}
export function parseLogQuery(query: string): LogFilter {
  const params = new URLSearchParams(query),
    filter: LogFilter = {};
  const q = params.get("q")?.trim();
  if (q) filter.q = q;
  for (const key of ["level", "source", "instance"] as const) {
    const values = params.getAll(key).filter(Boolean);
    if (values.length) filter[key] = values;
  }
  return filter;
}

// Silent reloads only keep the newest page current; other views stay still.
export const autoReloads = (
  visible: boolean,
  sort: { field: string; direction: string } | null,
  page: number,
) =>
  visible &&
  page === 1 &&
  (!sort || (sort.field === "ts" && sort.direction === "desc"));

// The event of an in-app link, heard by the route history (route-history.ts).
export const LINK_EVENT = "scopearr:link";

// Deep links into System → Log: the route carries the filter, and the app
// follows it like any link (see router.ts). The router first writes a
// waiting replace and starts the shown route again when the link leads
// there (cancelling the event), as 1.7.0 returned to page 1; otherwise the
// link sets the hash. This module has no runtime imports so its helpers
// stay testable in Node.
export function openLog(filter: LogFilter = {}) {
  const query = logQuery(filter);
  const hash = "#/settings/system/log" + (query ? "?" + query : "");
  const link = new CustomEvent(LINK_EVENT, {
    detail: hash,
    cancelable: true,
  });
  if (window.dispatchEvent(link)) window.location.hash = hash;
}

export function eventMessage(
  event: Pick<LogEvent, "message" | "params">,
  translate: (key: string, params?: Record<string, string | number>) => string,
) {
  const params: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(event.params)) {
    params[key] = Array.isArray(value)
      ? value
          .map((area) => {
            const translated = translate(area);
            if (translated !== area) return translated;
            const separator = area.indexOf(" · ");
            return separator < 0
              ? translated
              : translate(area.slice(0, separator)) + area.slice(separator);
          })
          .join(", ")
      : value;
  }
  return translate(event.message, params);
}
