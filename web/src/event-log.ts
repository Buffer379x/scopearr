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
export const LOG_PAGE_SIZE = 100;
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

// Silent reloads only keep the newest page current; other views stay still.
export const autoReloads = (
  visible: boolean,
  sort: { field: string; direction: string } | null,
  page: number,
) =>
  visible &&
  page === 1 &&
  (!sort || (sort.field === "ts" && sort.direction === "desc"));

// Deep links into System → Log. The viewer takes the pending filter when it
// mounts, or immediately when it is already open. This module has no runtime
// imports so its helpers stay testable in Node.
let pending: LogFilter | undefined;
export function openLog(filter: LogFilter = {}) {
  pending = filter;
  window.dispatchEvent(new CustomEvent("scopearr-open-log"));
}
export const logRequested = () => pending !== undefined;
export function takeLogFilter() {
  const filter = pending;
  pending = undefined;
  return filter;
}

export function eventMessage(event: Pick<LogEvent, "message" | "params">, translate: (key: string, params?: Record<string, string | number>) => string) {
  const params: Record<string, string | number> = {};
  for (const [key,value] of Object.entries(event.params)) {
    params[key] = Array.isArray(value) ? value.map((area) => {
      const translated = translate(area);
      if (translated !== area) return translated;
      const separator = area.indexOf(" · ");
      return separator < 0 ? translated : translate(area.slice(0, separator)) + area.slice(separator);
    }).join(", ") : value;
  }
  return translate(event.message, params);
}
