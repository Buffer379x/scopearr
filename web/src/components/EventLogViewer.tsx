import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Download,
  LoaderCircle,
  RefreshCw,
  ScrollText,
  Search,
  Trash2,
} from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";
import { confirmDeletion } from "../confirmation";
import {
  autoReloads,
  eventLevels,
  eventQuery,
  eventSources,
  levelLabel,
  levelTag,
  LOG_PAGE_SIZE,
  takeLogFilter,
  type EventPage,
  type LogEvent,
  type LogFilter,
} from "../event-log";
import { t, useI18n } from "../i18n";
import { markLogSeen } from "../log-seen";
import { notify } from "../notifications";
import type { MuxJob, Status } from "../types";
import { CardHeading, count, ICON } from "../ui";
import { Modal } from "./Modal";
import { MultiFilter } from "./MultiFilter";
import { MuxTerminalDialog } from "./MuxTerminalDialog";
import {
  SortableHeader,
  nextTableSort,
  type TableSort,
} from "./SortableHeader";
import { ActiveFilterBar } from "./ToolFilters";

const eventMessage = (e: LogEvent) => t(e.message, e.params);

const dayStart = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
function eventDay(ts: number, now = Date.now()) {
  const days = Math.round((dayStart(now) - dayStart(ts)) / 86_400_000);
  return days <= 0
    ? t("Today")
    : days === 1
      ? t("Yesterday")
      : new Date(ts).toLocaleDateString();
}
const eventTime = (ts: number) =>
  new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

function eventText(e: LogEvent, service?: string) {
  return [
    new Date(e.ts).toISOString(),
    e.level.toUpperCase(),
    "[" +
      t(eventSources[e.source] || e.source) +
      (service ? "/" + service : "") +
      "]",
    eventMessage(e),
    e.subject && "· " + e.subject,
    e.repeat > 1 && "×" + e.repeat,
    e.detail && "· " + e.detail,
  ]
    .filter(Boolean)
    .join(" ");
}

const emptyPage: EventPage = {
  events: [],
  total: 0,
  counts: { level: {}, source: {}, instance: {} },
};
const filterKeys = ["level", "source", "instance"] as const;

export function EventLogViewer({
  status,
  demo,
}: {
  status: Status;
  demo: boolean;
}) {
  useI18n();
  const [filter, setFilter] = useState<LogFilter>(() => takeLogFilter() || {});
  const [search, setSearch] = useState(filter.q || "");
  const [sort, setSort] = useState<TableSort>(null);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<EventPage>();
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<LogEvent>();
  const [job, setJob] = useState<MuxJob>();
  const request = useRef(0);
  const query = eventQuery(filter, sort, page);
  const serviceName = (id: string) => status.serviceNames?.[id] || id;
  const load = async (quiet = false) => {
    const id = ++request.current;
    if (!quiet) setBusy(true);
    try {
      const next = await api<EventPage>(
        "events?" + query,
        "GET",
        undefined,
        undefined,
        {
          notifyErrors: !quiet,
        },
      );
      if (id === request.current) setData(next);
    } catch {
      // api() reports the error; the previous list stays visible.
    } finally {
      if (id === request.current) setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, [query]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if ((filter.q || "") === search) return;
      setFilter((current) => ({ ...current, q: search }));
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (autoReloads(document.visibilityState === "visible", sort, page))
        void load(true);
    }, 10_000);
    return () => clearInterval(timer);
  }, [query]);
  useEffect(() => {
    markLogSeen(status.events?.lastError || 0);
  }, [status.events?.lastError]);
  useEffect(() => {
    const open = () => {
      const next = takeLogFilter();
      if (!next) return;
      setFilter(next);
      setSearch(next.q || "");
      setPage(1);
    };
    window.addEventListener("scopearr-open-log", open);
    return () => window.removeEventListener("scopearr-open-log", open);
  }, []);
  const change = (key: (typeof filterKeys)[number], values: string[]) => {
    setFilter((current) => ({ ...current, [key]: values }));
    setPage(1);
  };
  const reset = () => {
    setFilter({});
    setSearch("");
    setPage(1);
  };
  const counts = data?.counts || emptyPage.counts;
  const sourceLabel = (key: string) => t(eventSources[key] || key);
  const optionLabel = {
    level: (value: string) =>
      t(levelLabel[value as keyof typeof levelLabel] || value),
    source: sourceLabel,
    instance: serviceName,
  };
  const chips = [
    ...(filter.q
      ? [
          {
            key: "q",
            label: t("Search: {value}", { value: filter.q }),
            remove: () => {
              setSearch("");
              setFilter((current) => ({ ...current, q: "" }));
            },
          },
        ]
      : []),
    ...filterKeys.flatMap((key) =>
      (filter[key] || []).map((value) => ({
        key: key + ":" + value,
        label: optionLabel[key](value),
        remove: () =>
          change(
            key,
            (filter[key] || []).filter((item) => item !== value),
          ),
      })),
    ),
  ];
  const total = data?.total || 0;
  const pages = Math.max(1, Math.ceil(total / LOG_PAGE_SIZE));
  const exportHref = (format: string) =>
    "/api/events/export?" +
    query.replace(/&?(limit|offset)=\d+/g, "") +
    "&format=" +
    format;
  const clear = async () => {
    if (!(await confirmDeletion(t("You are about to clear the log.")))) return;
    try {
      await api("events", "DELETE");
      setPage(1);
      await load();
    } catch {}
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(t("Copied"));
    } catch {
      notify(t("Could not copy"), "error");
    }
  };
  const openJob = async (id: number) => {
    try {
      const jobs = await api<MuxJob[]>("mux/jobs");
      const found = jobs.find((item) => item.id === id);
      if (found) setJob(found);
      else notify(t("The job no longer exists."), "warning");
    } catch {}
  };
  const header = (field: string, label: string, className: string) => (
    <SortableHeader
      label={t(label)}
      className={className}
      active={sort?.field === field}
      direction={sort?.direction || "asc"}
      onSort={() => {
        setSort(nextTableSort(sort, field));
        setPage(1);
      }}
    />
  );
  return (
    <section class="settings-card event-log">
      <CardHeading
        icon={<ScrollText size={ICON.button} />}
        title={t("Log")}
        actions={
          <>
            <span class="filter-count" title={t("Entries in the list")}>
              {count(total)}
            </span>
            <button
              type="button"
              class="icon-button"
              aria-label={t("Refresh log")}
              title={t("Refresh log")}
              disabled={busy}
              onClick={() => void load()}
            >
              {busy ? (
                <LoaderCircle size={ICON.button} class="spin" />
              ) : (
                <RefreshCw size={ICON.button} />
              )}
            </button>
            <a
              class="icon-button"
              href={exportHref("txt")}
              download
              aria-label={t("Download log")}
              title={t("Download log as text · JSON via the context menu")}
              onContextMenu={(e) => {
                e.preventDefault();
                window.location.href = exportHref("json");
              }}
            >
              <Download size={ICON.button} />
            </a>
            <button
              type="button"
              class="icon-button danger-button"
              aria-label={t("Clear log")}
              title={t(demo ? "The demo log cannot be cleared" : "Clear log")}
              disabled={demo}
              onClick={() => void clear()}
            >
              <Trash2 size={ICON.button} />
            </button>
          </>
        }
        description={t(
          "Events from the last 24 hours. Older entries are removed automatically.",
        )}
      />
      <div class="compact-filter-row">
        <label class="search-field">
          <span>{t("Search")}</span>
          <div class="input-wrap">
            <Search size={ICON.button} />
            <input
              type="search"
              placeholder={t("Log search …")}
              value={search}
              onInput={(e) => setSearch(e.currentTarget.value)}
            />
          </div>
        </label>
        <MultiFilter
          name="event-level"
          label={t("Level")}
          optionLabel={optionLabel.level}
          includeOnly
          values={eventLevels}
          counts={counts.level}
          selected={filter.level || []}
          operator="eq"
          operatorChange={() => {}}
          change={(update) =>
            change(
              "level",
              typeof update === "function"
                ? update(filter.level || [])
                : update,
            )
          }
        />
        <MultiFilter
          name="event-source"
          label={t("Source")}
          optionLabel={sourceLabel}
          includeOnly
          values={Object.keys(eventSources).filter(
            (key) => counts.source[key] || filter.source?.includes(key),
          )}
          counts={counts.source}
          selected={filter.source || []}
          operator="eq"
          operatorChange={() => {}}
          change={(update) =>
            change(
              "source",
              typeof update === "function"
                ? update(filter.source || [])
                : update,
            )
          }
        />
        {(Object.keys(counts.instance).length > 0 ||
          !!filter.instance?.length) && (
          <MultiFilter
            name="event-instance"
            label={t("Service")}
            optionLabel={serviceName}
            includeOnly
            values={[
              ...new Set([
                ...Object.keys(counts.instance),
                ...(filter.instance || []),
              ]),
            ]}
            counts={counts.instance}
            selected={filter.instance || []}
            operator="eq"
            operatorChange={() => {}}
            change={(update) =>
              change(
                "instance",
                typeof update === "function"
                  ? update(filter.instance || [])
                  : update,
              )
            }
          />
        )}
      </div>
      <ActiveFilterBar chips={chips} reset={reset} />
      {data && !data.events.length ? (
        <div class="empty-state">
          <ScrollText size={ICON.empty} />
          <h3>
            {t(
              chips.length
                ? "No matching entries."
                : "No entries in the last 24 hours.",
            )}
          </h3>
          {!!chips.length && (
            <button type="button" class="button" onClick={reset}>
              {t("Reset filters")}
            </button>
          )}
        </div>
      ) : (
        <div class="table-wrap">
          <table class="data-table event-log-table">
            <thead>
              <tr>
                {header("ts", "Time", "event-col-time")}
                {header("level", "Level", "event-col-level")}
                {header("source", "Source", "event-col-source")}
                <th scope="col">{t("Message")}</th>
              </tr>
            </thead>
            <tbody>
              {(data?.events || []).map((e) => (
                <tr key={e.id}>
                  <td class="event-time" title={new Date(e.ts).toISOString()}>
                    {eventTime(e.ts)}
                    <small class="cell-sub">{eventDay(e.ts)}</small>
                  </td>
                  <td>
                    <span class={"tag " + levelTag[e.level]}>
                      {t(levelLabel[e.level])}
                    </span>
                  </td>
                  <td>
                    {sourceLabel(e.source)}
                    {e.instance && (
                      <small class="cell-sub">{serviceName(e.instance)}</small>
                    )}
                  </td>
                  <td class="event-message">
                    <span class="event-message-line">
                      {e.detail || e.subject ? (
                        <button
                          type="button"
                          class="text-button cell-title"
                          onClick={() => setSelected(e)}
                        >
                          {eventMessage(e)}
                        </button>
                      ) : (
                        <span class="cell-title">{eventMessage(e)}</span>
                      )}
                      {e.repeat > 1 && (
                        <span
                          class="filter-count"
                          title={t(
                            "{repeat} occurrences combined in 10 minutes",
                            { repeat: e.repeat },
                          )}
                        >
                          ×{e.repeat}
                        </span>
                      )}
                    </span>
                    {e.subject && <small class="cell-sub">{e.subject}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div class="pagination">
        <span title={t("Items in the list")}>
          {t("{from}–{to} of {total}", {
            from: total ? count((page - 1) * LOG_PAGE_SIZE + 1) : "0",
            to: count(Math.min(page * LOG_PAGE_SIZE, total)),
            total: count(total),
          })}
        </span>
        <div>
          <button
            type="button"
            class="icon-button"
            aria-label={t("Previous page")}
            title={t("Previous page")}
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            <ArrowLeft size={ICON.button} />
          </button>
          <span>{t("Page {page} / {pages}", { page, pages })}</span>
          <button
            type="button"
            class="icon-button"
            aria-label={t("Next page")}
            title={t("Next page")}
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            <ArrowRight size={ICON.button} />
          </button>
        </div>
      </div>
      {selected && (
        <Modal title={t("Log entry")} close={() => setSelected(undefined)}>
          <dl class="key-values">
            <div>
              <dt>{t("Time")}</dt>
              <dd>
                {new Date(selected.ts).toLocaleString()}
                <small class="cell-sub">
                  {new Date(selected.ts).toISOString()}
                </small>
              </dd>
            </div>
            <div>
              <dt>{t("Level")}</dt>
              <dd>
                <span class={"tag " + levelTag[selected.level]}>
                  {t(levelLabel[selected.level])}
                </span>
              </dd>
            </div>
            <div>
              <dt>{t("Source")}</dt>
              <dd>{sourceLabel(selected.source)}</dd>
            </div>
            {selected.instance && (
              <div>
                <dt>{t("Service")}</dt>
                <dd>{serviceName(selected.instance)}</dd>
              </div>
            )}
            {selected.subject && (
              <div>
                <dt>{t("Subject")}</dt>
                <dd>{selected.subject}</dd>
              </div>
            )}
            <div>
              <dt>{t("Message")}</dt>
              <dd>{eventMessage(selected)}</dd>
            </div>
            {selected.repeat > 1 && (
              <div>
                <dt>{t("Repetitions")}</dt>
                <dd>{count(selected.repeat)}</dd>
              </div>
            )}
          </dl>
          {selected.detail && (
            <div class="event-detail">
              <div class="card-heading">
                <h3 class="card-title">{t("Details")}</h3>
                <button
                  type="button"
                  class="icon-button"
                  aria-label={t("Copy details")}
                  title={t("Copy details")}
                  onClick={() => void copy(selected.detail)}
                >
                  <Copy size={ICON.button} />
                </button>
              </div>
              <pre>{selected.detail}</pre>
            </div>
          )}
          <div class="modal-actions">
            {selected.source === "mux" &&
              typeof selected.params.job === "number" && (
                <button
                  type="button"
                  class="text-button"
                  onClick={() => void openJob(Number(selected.params.job))}
                >
                  {t("Open job log")}
                </button>
              )}
            <button
              type="button"
              class="button"
              onClick={() =>
                void copy(
                  eventText(
                    selected,
                    selected.instance ? serviceName(selected.instance) : "",
                  ),
                )
              }
            >
              <Copy size={ICON.label} />
              {t("Copy")}
            </button>
            <button
              type="button"
              class="button"
              onClick={() => setSelected(undefined)}
            >
              {t("Close")}
            </button>
          </div>
        </Modal>
      )}
      {job && <MuxTerminalDialog job={job} close={() => setJob(undefined)} />}
    </section>
  );
}
