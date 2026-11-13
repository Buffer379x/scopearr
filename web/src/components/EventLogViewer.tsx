import { usePolling } from "../hooks/usePolling";
import {
  Copy,
  Download,
  LoaderCircle,
  RefreshCw,
  ScrollText,
  Trash2,
} from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";
import { confirmDeletion } from "../confirmation";
import {
  autoReloads,
  eventMessage as formatEventMessage,
  eventQuery,
  eventSources,
  levelLabel,
  levelTag,
  LOG_PAGE_SIZE,
  logQuery,
  parseLogQuery,
  type EventPage,
  type LogEvent,
  type LogFilter,
} from "../event-log";
import { useDrawerAnchor } from "../hooks/useDrawerAnchor";
import { lazyChunk, useLazyChunk } from "../hooks/useLazyChunk";
import { t, useI18n } from "../i18n";
import { notify } from "../notifications";
import {
  asFilmSort,
  logApply,
  logChips,
  logCountPath,
  logDraft,
  logGroups,
  type LogDraft,
} from "../settings-model";
import type { Status } from "../types";
import { count, ICON } from "../ui";
import { Modal } from "./Modal";
import { nextTableSort, type TableSort } from "./SortableHeader";
import { ChipsRow } from "./list/ChipsRow";
import { FilterBar } from "./list/FilterBar";
import { ListEmpty } from "./list/ListEmpty";
import { itemRange, PageNav } from "./list/PageNav";
import { SortHeader } from "./list/SortHeader";
import { TableCard } from "./list/TableCard";
import { table } from "./settings/Card";
import type LogFilterDrawer from "./settings/LogFilterDrawer";
import { StatusTag } from "./tools/StatusTag";

// The log's filter drawer, a chunk of its own (5b ruling I4), loaded on
// its first opening (and preloaded at idle); the failure handler sits on
// the import() itself, so a chunk that cannot load resolves null.
const drawerChunk = lazyChunk<typeof LogFilterDrawer>(() =>
  import("./settings/LogFilterDrawer").then(
    (chunk) => chunk.default,
    () => null,
  ),
);
const NBSP = "\u00a0";
// The rows the table reserves until its first answer: a page, then the
// rows of the last answer in this session (none: the empty state's place).
let reserved = LOG_PAGE_SIZE;

const eventMessage = (e: LogEvent) => formatEventMessage(e, t);

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
// The filters start from the route query and replace it when they change;
// a link starts the viewer again (key in SystemSettingsLog), which keeps the
// sort.
export function EventLogViewer({
  status,
  demo,
  query: routeQuery,
  setQuery,
  sort,
  setSort,
}: {
  status: Status;
  demo: boolean;
  query: string;
  setQuery: (query: string) => void;
  sort: TableSort;
  setSort: (sort: TableSort) => void;
}) {
  useI18n();
  const [filter, setFilter] = useState<LogFilter>(() =>
    parseLogQuery(routeQuery),
  );
  const [search, setSearch] = useState(filter.q || "");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<EventPage>();
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<LogEvent>();
  const request = useRef(0);
  const query = eventQuery(filter, sort, page);
  const serviceName = (id: string) => status.serviceNames?.[id] || id;
  const load = async (quiet = false, signal?: AbortSignal) => {
    const id = ++request.current;
    if (!quiet) setBusy(true);
    try {
      const next = await api<EventPage>(
        "events?" + query,
        "GET",
        undefined,
        signal,
        {
          notifyErrors: !quiet,
        },
      );
      if (id === request.current && !signal?.aborted) {
        reserved = next.events.length;
        setData(next);
      }
    } catch {
      // api() reports the error; the previous list stays visible.
    } finally {
      if (id === request.current && !signal?.aborted) setBusy(false);
    }
  };
  const loadedQuery = useRef<string>();
  usePolling(
    async (signal) => {
      const quiet = loadedQuery.current === query;
      loadedQuery.current = query;
      await load(quiet, signal);
    },
    () => (autoReloads(true, sort, page) ? 10000 : null),
    [query],
  );
  useEffect(() => {
    const timer = setTimeout(() => {
      if ((filter.q || "") === search) return;
      setFilter((current) => ({ ...current, q: search }));
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const filterQuery = logQuery(filter);
  useEffect(() => {
    if (filterQuery !== routeQuery) setQuery(filterQuery);
  }, [filterQuery]);
  const change = (key: keyof LogDraft, values: string[]) => {
    setFilter((current) => ({ ...current, [key]: values }));
    setPage(1);
  };
  const reset = () => {
    setFilter({});
    setSearch("");
    setPage(1);
  };
  // The Filters button that opened the drawer (null: closed); focus goes
  // back to it once the drawer has closed.
  const [drawer, setDrawer] = useState<HTMLElement | null>(null);
  const closeDrawer = () => setDrawer(null);
  const Drawer = useLazyChunk(drawerChunk, !!drawer, closeDrawer);
  useDrawerAnchor(drawer);
  const counts = data?.counts || emptyPage.counts;
  const sourceLabel = (key: string) => t(eventSources[key] || key);
  const labels = {
    level: (value: string) =>
      t(levelLabel[value as keyof typeof levelLabel] || value),
    source: sourceLabel,
    instance: serviceName,
  };
  // The chips of the applied filter with the 1.7.0 labels; each removes
  // its filter at once, back on page 1.
  const chips = logChips(filter, labels, t).map((chip) => ({
    key: chip.key,
    label: chip.label,
    excluded: false,
    remove: () => {
      if (chip.field === "q") {
        setSearch("");
        setFilter((current) => ({ ...current, q: "" }));
        setPage(1);
      } else
        change(
          chip.field,
          (filter[chip.field] || []).filter((item) => item !== chip.value),
        );
    },
  }));
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
  const heads = [t("Time"), t("Level"), t("Source"), t("Message")];
  const fields = ["ts", "level", "source"];
  // Time, Level and Source sort (asc, desc, then the default: newest
  // first, nextTableSort), back on page 1; Message is a plain head.
  // Message takes the rest of the row (v2-table-title).
  const sortHead = (at: number) =>
    !fields[at] ? (
      <th key="message" scope="col" class="v2-table-title">
        {heads[at]}
      </th>
    ) : (
      <SortHeader
        key={fields[at]}
        label={heads[at]}
        field={fields[at]}
        sort={asFilmSort(sort, "")}
        onSort={(field) => {
          setSort(nextTableSort(sort, field));
          setPage(1);
        }}
      />
    );
  const rows = (data?.events || []).map((e): [string, ComponentChildren[]] => [
    String(e.id),
    [
      <>
        <div class="v2-table-name" title={new Date(e.ts).toISOString()}>
          {eventTime(e.ts)}
        </div>
        <div class="v2-table-sub">{eventDay(e.ts)}</div>
      </>,
      <StatusTag
        view={{
          tone: levelTag[e.level].slice(7) as "error" | "warn" | "info",
          text: t(levelLabel[e.level]),
          long: t(levelLabel[e.level]),
        }}
      />,
      <>
        <div>{sourceLabel(e.source)}</div>
        {e.instance && (
          <div class="v2-table-sub">{serviceName(e.instance)}</div>
        )}
      </>,
      <>
        <div class="v2-table-line">
          {e.detail || e.subject ? (
            <button
              type="button"
              class="v2-text-btn v2-set-msg"
              onClick={() => setSelected(e)}
            >
              {eventMessage(e)}
            </button>
          ) : (
            <span>{eventMessage(e)}</span>
          )}
          {e.repeat > 1 && (
            <span
              class="v2-count v2-count--on"
              title={t("{repeat} occurrences combined in 10 minutes", {
                repeat: e.repeat,
              })}
            >
              ×{e.repeat}
            </span>
          )}
        </div>
        {e.subject && <div class="v2-table-sub">{e.subject}</div>}
      </>,
    ],
  ]);
  // Until the first answer: rows of the same cells (the time with its
  // day), hidden from assistive technology, as many as the last answer.
  const placeholders = Array.from(
    { length: reserved },
    (_, i): [string, ComponentChildren[], string] => [
      "placeholder" + i,
      heads.map((_, at) =>
        at === 0 ? (
          <>
            <div class="v2-table-name">{NBSP}</div>
            <div class="v2-table-sub">{NBSP}</div>
          </>
        ) : (
          NBSP
        ),
      ),
      "v2-row--placeholder",
    ],
  );
  const empty = (pending: boolean) => (
    <ListEmpty
      icon={<ScrollText size={ICON.empty} />}
      title={t(
        chips.length
          ? "No matching entries."
          : "No entries in the last 24 hours.",
      )}
      pending={pending}
    >
      {!!chips.length && (
        <button type="button" class="v2-btn" onClick={reset}>
          {t("Reset filters")}
        </button>
      )}
    </ListEmpty>
  );
  const title = t("Log");
  return (
    <>
      <TableCard
        id="event-log"
        title={title}
        count={total}
        countTitle={t("Entries in the list")}
        busy={busy}
        hint={t(
          "Events from the last 24 hours. Older entries are removed automatically.",
        )}
        bar={
          <FilterBar
            search={{
              label: t("Search"),
              placeholder: t("Log search …"),
              value: search,
              change: setSearch,
            }}
            filters={{
              count:
                (filter.level?.length || 0) +
                (filter.source?.length || 0) +
                (filter.instance?.length || 0),
              expanded: !!drawer,
              open: setDrawer,
            }}
          />
        }
        chips={
          <ChipsRow
            label={t("Filters")}
            chips={chips}
            empty={t("No active filters")}
            reset={reset}
            tools={
              <>
                <button
                  type="button"
                  class="v2-icon-btn v2-icon-btn--sm"
                  aria-label={t("Refresh log")}
                  title={t("Refresh log")}
                  disabled={busy}
                  onClick={() => void load()}
                >
                  {busy ? (
                    <LoaderCircle size={ICON.button} class="v2-spin" />
                  ) : (
                    <RefreshCw size={ICON.button} />
                  )}
                </button>
                <a
                  class="v2-icon-btn v2-icon-btn--sm"
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
                  class="v2-icon-btn v2-icon-btn--sm v2-icon-btn--danger"
                  aria-label={t("Clear log")}
                  title={t(
                    demo ? "The demo log cannot be cleared" : "Clear log",
                  )}
                  disabled={demo}
                  onClick={() => void clear()}
                >
                  <Trash2 size={ICON.button} />
                </button>
              </>
            }
          />
        }
        density="comfortable"
        regionLabel={title}
        foot={
          <PageNav
            page={page}
            pages={pages}
            setPage={setPage}
            summary={itemRange(page, LOG_PAGE_SIZE, total)}
          />
        }
      >
        {!data
          ? reserved
            ? table(heads, placeholders, undefined, sortHead, 3)
            : empty(true)
          : rows.length
            ? table(heads, rows, undefined, sortHead, 3)
            : empty(false)}
      </TableCard>
      {Drawer && (
        <Drawer
          subtitle={title}
          groups={logGroups(counts, filter, labels, t)}
          initial={logDraft(filter)}
          countPath={(draft) => logCountPath(filter, draft)}
          apply={(draft) => {
            setFilter((current) => logApply(current, draft));
            setPage(1);
          }}
          close={closeDrawer}
        />
      )}
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
    </>
  );
}
