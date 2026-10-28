import { usePolling } from "../hooks/usePolling";
import { CompactProgress } from "./CompactProgress";
import { FilterRow } from "./FilterRow";
import { useToolPresets } from "../hooks/useToolPresets";
import {
  readSessionPreference,
  writeSessionPreference,
} from "../browser-storage";
import { Tooltip } from "../ui";
import { useRowRemoval } from "../hooks/useRowRemoval";
import { toolColumn } from "../tool-table";
import { useToolTableStyle } from "../use-tool-table";
import { MultiFilter } from "./MultiFilter";
import { ICON } from "../ui";
import { placementMessage } from "../placement-messages";
import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import {
  ArrowLeft,
  ArrowRight,
  CircleAlert,
  ClipboardList,
  HardDrive,
  Info,
  LoaderCircle,
  Play,
  ScanSearch,
  Square,
  Terminal,
  Trash2,
} from "lucide-preact";
import { api } from "../api";
import { confirmAction } from "../confirmation";
import {
  readPreference,
  removePreference,
  writePreference,
  readToolFilters,
} from "../browser-storage";
import { instancesOf } from "../instances";
import { t, useI18n } from "../i18n";
import {
  defaultUnraidSettings,
  placementCompact,
  placementReportNotices,
  placementDisksBySize,
  placementOrderedColumns,
  placementSelectable,
  placementSelection,
  placementSortable,
  placementStatusShort,
  placementScanCompleted,
} from "../placement";
import type {
  PlacementActivity,
  PlacementItem,
  PlacementResults,
  PlacementScan,
  Settings,
  UnraidSettings,
  UnraidStatus,
} from "../types";
import { compactBytes as bytes, count } from "../ui";
import { HelpPopover } from "./HelpPopover";
import { reportError, useScanErrorToast } from "../tool-feedback";
import { ActiveFilterBar, CSVExport, FilterCheckList } from "./ToolFilters";
import { filterChips, toggleFilter, toolFilterQuery } from "../tool-filters";
import { Modal } from "./Modal";
import { PlacementScanDialog } from "./PlacementScanDialog";
import {
  formatTableSort,
  nextTableSort,
  parseTableSort,
  SortableHeader,
  type TableSort,
} from "./SortableHeader";
import {
  DiskTag,
  PlacementDetailDialog,
  PlacementLogDialog,
  PlacementStatusDialog,
  PlacementStatusTag,
  PlacementSummaryDialog,
} from "./PlacementDialogs";

const placementHeaderLabels: Record<string, string> = {
  actions: "Info",
  title: "Title",
  service: "Service",
  size: "Size",
  disks: "Disks",
  target: "Target",
  move: "Move",
  kind: "Kind",
  status: "Status",
  progress: "Progress",
};
export function DiskPlacementPage({
  settings,
  changed,
  setup,
  openFiles,
}: {
  settings: Settings | null;
  changed: () => unknown;
  setup: () => void;
  openFiles: (path: string) => void;
}) {
  const { locale } = useI18n();
  const libraries = settings
    ? instancesOf(settings).filter(
        (c) => c.enabled && (c.type === "radarr" || c.type === "sonarr"),
      )
    : [];
  const [options, setOptions] = useState<UnraidSettings>({
    ...defaultUnraidSettings,
  });
  useEffect(() => {
    const u = settings?.unraid || defaultUnraidSettings;
    setOptions({
      ...u,
      libraries: u.libraries.length
        ? [...u.libraries]
        : libraries.map((c) => c.id),
    });
  }, [JSON.stringify(settings?.unraid), libraries.map((c) => c.id).join(",")]);
  const [collapsed, setCollapsed] = useState(true);
  useEffect(() => {
    removePreference("scopearr-placement-collapsed");
  }, []);
  const [filters, setFilters] = useState(() =>
    readToolFilters("scopearr-placement-filters", {
      statuses: [
        "all",
        "one_disk",
        "empty",
        "several_split",
        "several_empty_folders",
        "several_empty",
        "several_waiting_for_mover",
        "several_seasons_spread",
        "several_errors",
        "not_found",
        "seasons_spread",
        "several",
        "waiting_for_mover",
        "conflict",
        "no_space",
        "errors",
        "no_arr",
        "moved",
        "ok",
        "split",
        "empty_folders",
        "foreign_owner",
        "outside_share",
        "error",
        "queued",
        "running",
        "succeeded",
        "failed",
        "cancelled",
        "needs_review",
        "needs_attention",
      ],
      kinds: ["small_files", "media_files"],
    }),
  );
  const [shares, setShares] = useState<string[]>([]);
  const { q: query, statuses, targets, kinds } = filters;
  const changeFilters = (patch: Partial<typeof filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };
  const setQuery = (q: string) => changeFilters({ q });
  useEffect(() => {
    writePreference("scopearr-placement-filters", JSON.stringify(filters));
  }, [filters]);
  const [sort, setSortState] = useState<TableSort>(
      parseTableSort(readPreference("scopearr-placement-sort")),
    ),
    [editDisks, setEditDisks] = useState(false),
    [page, setPage] = useState(() =>
      Math.max(
        1,
        Number(readSessionPreference("scopearr-placement-page")) || 1,
      ),
    );
  const sortBy = (field: string) => {
    const next = nextTableSort(sort, field);
    setSortState(next);
    writePreference("scopearr-placement-sort", formatTableSort(next));
    setPage(1);
  };
  const [service, setService] = useState<UnraidStatus>(),
    [activity, setActivity] = useState<PlacementActivity>(),
    [results, setResults] = useState<PlacementResults>({
      items: [],
      total: 0,
      selectableIds: [],
    });
  const [selected, setSelected] = useState<number[]>([]),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0),
    [speed, setSpeed] = useState(0);
  const [scanDialog, setScanDialog] = useState(false);
  const [report, setReport] = useState<PlacementScan>();
  const [summary, setSummary] = useState(false),
    [dialog, setDialog] = useState<{
      kind: "details" | "status" | "log";
      item: PlacementItem;
    }>();
  const lastSummary = useRef<string>(),
    sample = useRef({ at: 0, bytes: 0 });
  const limit = settings?.pageSize || 100;
  useEffect(() => {
    writeSessionPreference("scopearr-placement-page", String(page));
  }, [page]);
  const reload = () => setRevision((n) => n + 1);
  const removal = useRowRemoval(async () => {
    reload();
    await changed();
  });
  usePolling(
    async (signal) => {
      const delayed = setTimeout(() => {
        if (!signal.aborted) setLoading(true);
      }, 300);
      const q = toolFilterQuery(query, {
        status: statuses,
        target: targets,
        kind: kinds,
        share: shares,
      });
      const paging = new URLSearchParams({
        ...(sort ? { sort: sort.field, dir: sort.direction } : {}),
        offset: String((page - 1) * limit),
        limit: String(limit),
      });
      for (const [key, value] of paging) q.set(key, value);
      try {
        const [next, unraid, list] = await Promise.all([
          api<PlacementActivity>("placement/scan", "GET", undefined, signal),
          api<UnraidStatus>("unraid/status", "GET", undefined, signal),
          api<PlacementResults>(
            "placement/items?" + q,
            "GET",
            undefined,
            signal,
          ),
        ]);
        if (signal.aborted) return;
        setActivity(next);
        const completed =
          next.report || (!next.scan.running ? next.scan : undefined);
        if (completed?.finishedAt) setReport(completed);
        setService(unraid);
        setResults(list);
        setLoading(false);
        if (placementScanCompleted(lastSummary.current, next.scan)) {
          setSummary(true);
          setSelected([]);
        }
        lastSummary.current = next.scan.finishedAt || "";
        const now = Date.now();
        const elapsed = (now - sample.current.at) / 1000;
        setSpeed(
          next.running && sample.current.at && elapsed > 0
            ? Math.max(0, (next.bytesDone - sample.current.bytes) / elapsed)
            : 0,
        );
        sample.current = { at: now, bytes: next.bytesDone };
        return next;
      } catch (e) {
        if (!signal.aborted) setLoading(false);
      } finally {
        clearTimeout(delayed);
      }
    },
    (next) =>
      next && (next.scan.running || next.running || next.queued) ? 1000 : 10000,
    [filters, shares, formatTableSort(sort), page, limit, revision],
    { startDelay: query ? 180 : 0 },
  );
  const scan = activity?.scan,
    active = !!(activity?.queued || activity?.running),
    scanning = !!scan?.running;
  const pages = Math.max(1, Math.ceil(results.total / limit));
  useEffect(() => {
    if (page > pages && !loading) setPage(pages);
  }, [page, pages, loading]);
  const action = async (run: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await run();
      reload();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };
  const startScan = async () => {
    setBusy(true);
    try {
      if (!options.libraries.length)
        throw new Error(t("Select at least one library"));
      if (
        !Number.isInteger(options.reserveGB) ||
        options.reserveGB < 0 ||
        options.reserveGB > 10240
      )
        throw new Error(t("Free space reserve must be between 0 and 10240 GB"));
      await api("placement/scan", "POST", {
        libraries: libraries.every((c) => options.libraries.includes(c.id))
          ? []
          : options.libraries,
        seriesGrouping: options.seriesGrouping,
        excludedDisks: options.excludedDisks,
        reserveGB: options.reserveGB,
      });
      setSelected([]);
      setScanDialog(false);
      reload();
      changed();
    } finally {
      setBusy(false);
    }
  };
  // The server queues in its fixed processing order; display sorting is ignored.
  const start = async (ids?: number[]) => {
    const targets = ids || results.selectableIds;
    const owners = targets.reduce(
      (total, id) => total + (results.ownerChanges?.[id] || 0),
      0,
    );
    if (
      (targets.length > 1 || owners > 0) &&
      !(await confirmAction(
        t("You are about to move {count} items.", { count: targets.length }) +
          (owners
            ? " " +
              t("{count} files change owner to 99:100.", { count: owners })
            : ""),
        t("Move"),
      ))
    )
      return;
    await action(async () => {
      await api("placement/start", "POST", { ids: targets });
      setSelected([]);
    });
  };
  const detail = async (
    item: PlacementItem,
    kind: "details" | "status" | "log",
  ) => {
    if (kind === "log") {
      setDialog({ kind, item });
      return;
    }
    await action(async () =>
      setDialog({
        kind,
        item: await api<PlacementItem>(`placement/items/${item.id}`),
      }),
    );
  };
  const pickTarget = (value: string) => {
    changeFilters({
      targets: toggleFilter(targets, value, !targets.includes(value)),
    });
    setPage(1);
    setSummary(false);
  };
  const selectTarget = async (value: string) => {
    await action(async () => {
      const list = await api<PlacementResults>(
        "placement/items?" + new URLSearchParams({ target: value, limit: "1" }),
      );
      setSelected((current) => [
        ...new Set([...current, ...list.selectableIds]),
      ]);
    });
    setSummary(false);
    changeFilters({ targets: toggleFilter(targets, value, true) });
  };
  const selection = placementSelection(results.items, selected),
    columns = placementOrderedColumns(settings);
  const counts = activity?.counts || scan?.counts || {};
  const eligible = results.selectableIds.length;
  const updateOptions = (patch: Partial<UnraidSettings>) =>
    setOptions((current) => ({ ...current, ...patch }));
  const toggle = (values: string[], value: string, checked: boolean) =>
    checked ? [...values, value] : values.filter((v) => v !== value);
  const hasResults = !!scan?.finishedAt;
  const statusOptions = [
    ["all", "All scanned", counts.all || 0],
    ["several", "Several disks", counts.several || 0],
    ["one_disk", "On one disk", counts.one_disk || 0],
    ["empty", "Empty folders", counts.empty || 0],
    ["empty_folders", "Empty copies", counts.empty_folders || 0],
    ["not_found", "Not found", counts.not_found || 0],
    ["seasons_spread", "Seasons spread", counts.seasons_spread || 0],
    ["waiting_for_mover", "Mover", counts.waiting_for_mover || 0],
    ["conflict", "Conflict", counts.conflict || 0],
    ["no_space", "No space", counts.no_space || 0],
    ["errors", "Errors", counts.errors || 0],
    ["no_arr", "Without Arr entry", counts.no_arr || 0],
    ["moved", "Completed", activity?.moved || 0],
  ]
    .filter(
      ([value]) => value !== "waiting_for_mover" || !!counts.waiting_for_mover,
    )
    .map(([value, label, n]) => ({
      value: String(value),
      label: t(String(label)),
      count: hasResults ? Number(n) : undefined,
    }));
  for (const value of statuses)
    if (!statusOptions.some((option) => option.value === value))
      statusOptions.push({
        value,
        label:
          value === "waiting_for_mover"
            ? t("Mover (previous scan)")
            : value.startsWith("several_")
              ? t("Several disks") +
                " · " +
                t(
                  value === "several_errors"
                    ? "Errors"
                    : placementStatusShort[value.slice(8)] || value,
                )
              : t(placementStatusShort[value] || value),
        count: hasResults ? counts[value] || 0 : undefined,
      });
  const kindOptions = [
    { value: "small_files", label: t("Small files") },
    { value: "media_files", label: t("Media files") },
  ];
  // Changed share choices since the last scan highlight the manual Scan action.
  const mappingChanged =
    !!scan?.finishedAt &&
    JSON.stringify(settings?.unraid?.shareDirs || {}) !==
      JSON.stringify(scan?.options?.shareDirs || {});
  const reportNotices = placementReportNotices(report);
  useScanErrorToast(
    "scopearr-placement-seen-scan-error",
    scan,
    (error) => placementMessage(error, t),
    { source: ["placement"] },
  );
  const exportQuery = toolFilterQuery(query, {
    status: statuses,
    target: targets,
    kind: kinds,
    share: shares,
  });
  if (sort) {
    exportQuery.set("sort", sort.field);
    exportQuery.set("dir", sort.direction);
  }
  const chips = [
    ...filterChips(t("Kind"), kindOptions, kinds, (value) =>
      changeFilters({ kinds: kinds.filter((k) => k !== value) }),
    ),
    ...filterChips(
      t("Share"),
      Object.keys(results.shares || {}).map((value) => ({
        value,
        label: value,
      })),
      shares,
      (value) => {
        setShares(shares.filter((v) => v !== value));
        setPage(1);
      },
    ),
    ...filterChips(t("Status"), statusOptions, statuses, (value) =>
      changeFilters({ statuses: statuses.filter((v) => v !== value) }),
    ),
    ...filterChips(
      t("Target"),
      [...targets].sort().map((value) => ({ value, label: value })),
      targets,
      (value) => changeFilters({ targets: targets.filter((v) => v !== value) }),
    ),
    ...(query
      ? [
          {
            key: "q",
            label: t("Search") + ": " + query,
            remove: () => setQuery(""),
          },
        ]
      : []),
  ];
  const scanInfo =
    t(
      service?.state.warning ||
        (service?.state.mover
          ? "Mover is running"
          : service?.state.parity
            ? "Parity operation in progress"
            : "Mover and parity are idle"),
    ) +
    (scan?.finishedAt
      ? "\n" +
        t("Last scan") +
        ": " +
        new Date(scan.finishedAt).toLocaleString(locale) +
        " (" +
        Math.ceil(scan.duration) +
        " s)"
      : "");
  const toolPresets = useToolPresets(
    "tool:placement",
    toolFilterQuery(query, {
      status: statuses,
      target: targets,
      kind: kinds,
      share: shares,
    }),
    (q) => {
      changeFilters({
        q: q.get("q") || "",
        statuses: q.getAll("status"),
        targets: q.getAll("target"),
        kinds: q.getAll("kind"),
      });
      setShares(q.getAll("share"));
    },
    results.shares,
  );
  useEffect(() => setSelected([]), [filters, shares]);
  const tableStyle = useToolTableStyle(
    columns,
    "placement",
    placementHeaderLabels,
    placementStatusShort,
  );
  return (
    <>
      {toolPresets.dialogs}
      <section class="library-intro">
        <h1>{t("Disk placement")}</h1>
        <span title={t("Open items")}>
          {t("{count} open", { count: counts.open || 0 })}
        </span>
      </section>
      <section
        class={
          "filter-panel filter-panel-v2 placement-panel" +
          (collapsed ? " collapsed" : "")
        }
        aria-label={t("Disk placement filters")}
      >
        <FilterRow
          allLabel={t("All items")}
          label={t("Title or folder")}
          placeholder={t("Search title or folder …")}
          value={query}
          change={setQuery}
          collapsed={collapsed}
          setCollapsed={setCollapsed}
          controls="placement-result-filters"
          {...toolPresets}
        />
        {!collapsed && (
          <div class="filter-groups" id="placement-result-filters">
            <section class="tool-result-filters">
              {(Object.keys(results.shares || {}).length >= 2 ||
                shares.length > 0) && (
                <div class="share-filter">
                  <MultiFilter
                    name="share"
                    heading
                    values={Object.keys(results.shares || {})}
                    counts={results.shares}
                    selected={shares}
                    includeOnly
                    operator="eq"
                    operatorChange={() => {}}
                    change={(value) => {
                      setShares((current) =>
                        typeof value === "function" ? value(current) : value,
                      );
                      setPage(1);
                    }}
                  />
                </div>
              )}
              <FilterCheckList
                title={t("Status")}
                options={statusOptions}
                selected={statuses}
                toggle={(value, checked) =>
                  changeFilters({
                    statuses: toggleFilter(statuses, value, checked),
                  })
                }
              />
              <FilterCheckList
                title={t("Kind")}
                options={kindOptions}
                selected={kinds}
                toggle={(value, checked) =>
                  changeFilters({ kinds: toggleFilter(kinds, value, checked) })
                }
              />
            </section>
          </div>
        )}
        <ActiveFilterBar
          export={
            <CSVExport
              href={"/api/placement/export.csv?" + exportQuery}
              enabled={results.total > 0}
            />
          }
          chips={chips}
          reset={() => {
            setShares([]);
            changeFilters({ statuses: [], targets: [], kinds: [], q: "" });
          }}
          tools={
            <button
              class="icon-button dot-trigger"
              disabled={!report?.finishedAt}
              aria-label={
                reportNotices
                  ? t("Scan report · contains notices")
                  : t("Scan report")
              }
              title={
                reportNotices
                  ? t("Scan report · contains notices")
                  : t("Scan report")
              }
              onClick={() => setSummary(true)}
            >
              <ClipboardList size={ICON.button} />
              {reportNotices && <span class="notification-dot" />}
            </button>
          }

          help={
            <HelpPopover
              label="Help"
              sections={[
                ...(scan?.finishedAt
                  ? [{ heading: "Last scan", text: scanInfo, raw: true }]
                  : []),
                {
                  heading: "How scanning works",
                  text: "Reads folder metadata only. Disks may spin up if their directory data is not cached.",
                },
              ]}
            />
          }
        />
      </section>
      <section class="library-section">
        <div class="results-heading">
          <div>
            <h2>
              {t("Items")}{" "}
              <span class="heading-count" title={t("Items in the list")}>
                {count(results.total)}
              </span>
              {(scanning || active) && (
                <span class="tool-activity" aria-live="polite">
                  <LoaderCircle size={ICON.label} class="spin" />
                  {scanning ? (
                    <span class="tool-activity-text">
                      <span>
                        {t("Scanning {disk} · {checked} of {total} items", {
                          disk: scan?.disk || "…",
                          checked: count(scan?.checked || 0),
                          total: count(scan?.total || 0),
                        })}
                      </span>
                    </span>
                  ) : active ? (
                    <span class="tool-activity-text">
                      <span>
                        {t(
                          "Moving {current} of {total} · {done} of {size} · {speed}/s",
                          {
                            current: count(
                              (activity?.moved || 0) + (activity?.running || 0),
                            ),
                            total: count(
                              (activity?.moved || 0) +
                                (activity?.running || 0) +
                                (activity?.queued || 0),
                            ),
                            done: bytes(activity?.bytesDone || 0),
                            size: bytes(activity?.totalBytes || 0),
                            speed: bytes(speed),
                          },
                        )}
                      </span>
                      {activity?.fileWork === "mux" && (
                        <span>{t("Waiting: a mux job is running")}</span>
                      )}
                    </span>
                  ) : null}
                </span>
              )}
              {loading && <LoaderCircle size={ICON.label} class="spin" />}
            </h2>
          </div>
          <div class="results-tools">
            <button
              class={"button primary" + (mappingChanged ? " scan-ready" : "")}
              disabled={busy}
              onClick={() =>
                scanning
                  ? action(() => api("placement/scan", "DELETE"))
                  : setScanDialog(true)
              }
            >
              {scanning ? (
                <Square size={ICON.label} />
              ) : (
                <ScanSearch size={ICON.label} />
              )}
              {t(scanning ? "Cancel scan" : "Scan")}
            </button>
            <button
              class="button"
              disabled={busy || scanning || !selected.length}
              onClick={() => start(selected)}
            >
              <Play size={ICON.label} />
              {t("Start selected")}
              {selected.length ? ` (${count(selected.length)})` : ""}
            </button>
            <button
              class="button"
              disabled={busy || scanning || !eligible}
              onClick={() => start()}
            >
              <Play size={ICON.label} />
              {t("Start all")}
            </button>
            {active && (
              <button
                class="button"
                disabled={busy}
                onClick={() => action(() => api("placement/cancel", "POST"))}
              >
                <Square size={ICON.label} />
                {t("Cancel")}
              </button>
            )}
            <button
              class="button"
              disabled={busy || scanning || !activity?.moved}
              onClick={() =>
                action(() => api("placement/items?moved=1", "DELETE"))
              }
            >
              <Trash2 size={ICON.label} />
              {t("Remove completed")}
            </button>
          </div>
        </div>

        {!service?.ready && !loading ? (
          <p class="notice">
            <CircleAlert size={ICON.button} />
            <span>
              {t(
                service?.error ||
                  "Enable the MKVToolNix service and configure path mappings first",
              )}{" "}
              <button class="text-button" onClick={setup}>
                {t("Open settings")}
              </button>
            </span>
          </p>
        ) : !results.items.length && !loading ? (
          <div class="empty-state">
            <HardDrive size={ICON.empty} />
            <h3>
              {t(
                !scan?.finishedAt
                  ? "No scan yet"
                  : !scan?.several && !scan?.unstartable
                    ? "Everything is on one disk"
                    : "No matching items",
              )}
            </h3>
            <p>
              {t(
                !scan?.finishedAt
                  ? "Choose your libraries and click Scan."
                  : "Change the filters or scan again.",
              )}
            </p>
            {!!results.hiddenOK && (
              <p>
                {t("No matches in this view. {count} matches on one disk.", {
                  count: results.hiddenOK,
                })}{" "}
                <button
                  class="text-button"
                  onClick={() => changeFilters({ statuses: ["ok"] })}
                >
                  {t("Show")}
                </button>
              </p>
            )}
          </div>
        ) : (
          <div
            class={"table-wrap placement-table-wrap" + (loading ? " busy" : "")}
          >
            <table
              class="data-table placement-table tool-table"
              style={tableStyle}
            >
              <colgroup>
                {columns.map((field) => (
                  <col
                    key={field}
                    class={"tool-col-" + toolColumn(field, "placement")}
                  />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {columns.map((field) =>
                    placementSortable.has(field) ? (
                      <SortableHeader
                        key={field}
                        label={t(placementHeaderLabels[field])}
                        active={sort?.field === field}
                        direction={sort?.direction || "asc"}
                        className={
                          field === "progress"
                            ? "col-progress"
                            : ["size", "move"].includes(field)
                              ? "number"
                              : undefined
                        }
                        onSort={() => sortBy(field)}
                      />
                    ) : (
                      <th
                        scope="col"
                        key={field}
                        class={
                          field === "remove"
                            ? "col-remove col-control"
                            : field === "progress"
                              ? "col-progress"
                              : field === "actions"
                                ? "col-info"
                                : "col-control"
                        }
                      >
                        {field === "actions" ? (
                          <span class="th-label">{t("Info")}</span>
                        ) : field === "select" ? (
                          <input
                            type="checkbox"
                            aria-label={t("Select all visible items")}
                            disabled={busy || scanning || !selection.ids.length}
                            checked={selection.all}
                            ref={(el) => {
                              if (el) el.indeterminate = selection.partial;
                            }}
                            onChange={(e) =>
                              setSelected((current) =>
                                e.currentTarget.checked
                                  ? [...new Set([...current, ...selection.ids])]
                                  : current.filter(
                                      (id) => !selection.ids.includes(id),
                                    ),
                              )
                            }
                          />
                        ) : null}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {results.items
                  .filter((item) => !removal.hidden.has(item.id))
                  .map((item) => {
                    const cells: Record<string, JSX.Element> = {
                      select: (
                        <td class="col-control">
                          <input
                            type="checkbox"
                            aria-label={t("Select item {title}", {
                              title: item.title,
                            })}
                            disabled={
                              busy || scanning || !placementSelectable(item)
                            }
                            checked={
                              placementSelectable(item) &&
                              selected.includes(item.id)
                            }
                            onChange={(e) =>
                              setSelected((current) =>
                                e.currentTarget.checked
                                  ? [...current, item.id]
                                  : current.filter((id) => id !== item.id),
                              )
                            }
                          />
                        </td>
                      ),
                      actions: (
                        <td class="col-control">
                          <div class="info-actions">
                            <button
                              class="row-icon info-action"
                              aria-label={t("Details for {title}", {
                                title: item.title,
                              })}
                              title={t("Details")}
                              onClick={() => detail(item, "details")}
                            >
                              <Info size={ICON.row} />
                            </button>
                            <button
                              class="row-icon info-action desktop-row-action"
                              aria-label={t("Start item {title}", {
                                title: item.title,
                              })}
                              title={t("Start")}
                              disabled={
                                busy || scanning || !placementSelectable(item)
                              }
                              onClick={() => start([item.id])}
                            >
                              <Play size={ICON.row} />
                            </button>
                            <button
                              class="row-icon info-action desktop-row-action"
                              aria-label={t("Terminal for {title}", {
                                title: item.title,
                              })}
                              title={t("Terminal")}
                              onClick={() => detail(item, "log")}
                            >
                              <Terminal size={ICON.row} />
                            </button>
                          </div>
                        </td>
                      ),
                      title: (
                        <td>
                          <strong class="cell-title" title={item.title}>
                            {item.season === -1
                              ? item.title.replace(
                                  / · Series folder$/,
                                  " · " + t("Series folder"),
                                )
                              : item.title}
                          </strong>
                          <small class="cell-sub" title={item.rel}>
                            {item.service
                              ? item.rel
                              : t("No Radarr/Sonarr entry") + " · " + item.rel}
                          </small>
                        </td>
                      ),
                      service: <td>{item.instance || "—"}</td>,
                      size: (
                        <td class="number">
                          {placementCompact(item)
                            ? "—"
                            : bytes(item.totalBytes)}
                        </td>
                      ),
                      disks: (
                        <td>
                          <div class="placement-disk-list">
                            {!Object.keys(item.disks || {}).length && "—"}
                            {placementDisksBySize(item)
                              .slice(0, 2)
                              .map(([disk]) => (
                                <div class="placement-disk-row" key={disk}>
                                  <DiskTag item={item} disk={disk} />
                                </div>
                              ))}
                            {Object.keys(item.disks || {}).length > 2 && (
                              <Tooltip
                                content={placementDisksBySize(item)
                                  .slice(2)
                                  .map(
                                    ([disk, stats]) =>
                                      `${disk} · ${bytes(stats.bytes)}`,
                                  )
                                  .join("; ")}
                              >
                                <button
                                  class="tag disk-more"
                                  aria-label={t("Show all disks for {title}", {
                                    title: item.title,
                                  })}
                                  onClick={() => detail(item, "details")}
                                >
                                  +{Object.keys(item.disks || {}).length - 2}
                                </button>
                              </Tooltip>
                            )}
                          </div>
                        </td>
                      ),
                      target: (
                        <td>
                          {item.target ? (
                            <DiskTag item={item} disk={item.target} />
                          ) : (
                            "—"
                          )}
                        </td>
                      ),
                      move: (
                        <td class="number">
                          {bytes(item.moveBytes)}
                          <small class="cell-sub">
                            {t("{count} files", { count: item.moveFiles })}
                          </small>
                        </td>
                      ),
                      kind: (
                        <td>
                          {item.kind && (
                            <span class="cell-kind">
                              {t(
                                item.kind === "small_files"
                                  ? "Small files"
                                  : "Media files",
                              )}
                            </span>
                          )}
                        </td>
                      ),
                      status: (
                        <td class="col-status">
                          <button
                            class="status-button"
                            aria-label={t("Status: {label}. Show checks", {
                              label: t(
                                placementStatusShort[
                                  item.jobStatus || item.scanStatus
                                ] || item.scanStatus,
                              ),
                            })}
                            onClick={() => detail(item, "status")}
                            title={t("Status: {label}. Show checks", {
                              label: t(
                                placementStatusShort[
                                  item.jobStatus || item.scanStatus
                                ] || item.scanStatus,
                              ),
                            })}
                          >
                            <PlacementStatusTag item={item} />
                          </button>
                        </td>
                      ),
                      progress: (
                        <td class="col-progress">
                          <CompactProgress
                            status={item.jobStatus}
                            value={item.progress}
                            label={t("Progress")}
                          />
                        </td>
                      ),
                      remove: (
                        <td class="col-remove col-control">
                          {item.jobStatus === "succeeded" && (
                            <button
                              class="icon-button success-button"
                              disabled={busy}
                              aria-label={t("Remove {title} from the list", {
                                title: item.title,
                              })}
                              title={t("Remove {title} from the list", {
                                title: item.title,
                              })}
                              onClick={() =>
                                removal.remove(item.id, () =>
                                  api(`placement/items/${item.id}`, "DELETE"),
                                )
                              }
                            >
                              {removal.removing.has(item.id) ? (
                                <LoaderCircle class="spin" size={ICON.button} />
                              ) : (
                                <Trash2 size={ICON.button} />
                              )}
                            </button>
                          )}
                        </td>
                      ),
                    };
                    return (
                      <tr
                        key={item.id}
                        class={
                          (removal.removing.has(item.id)
                            ? "row-removing"
                            : "") +
                          (selected.includes(item.id) ? " is-selected" : "")
                        }
                      >
                        {columns.map((field) => cells[field])}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
        <div class="pagination">
          <span title={t("Items in the list")}>
            {t("{from}–{to} of {total}", {
              from: results.total ? count((page - 1) * limit + 1) : "0",
              to: count(Math.min(page * limit, results.total)),
              total: count(results.total),
            })}
          </span>
          <div>
            <button
              class="icon-button"
              aria-label={t("Previous page")}
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              title={t("Previous page")}
            >
              <ArrowLeft size={ICON.button} />
            </button>
            <span>{t("Page {page} / {pages}", { page, pages })}</span>
            <button
              class="icon-button"
              aria-label={t("Next page")}
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
              title={t("Next page")}
            >
              <ArrowRight size={ICON.button} />
            </button>
          </div>
        </div>
      </section>
      {scanDialog && (
        <PlacementScanDialog
          libraries={libraries}
          options={options}
          service={service}
          busy={busy}
          active={active}
          update={updateOptions}
          editDisks={() => setEditDisks(true)}
          start={startScan}
          close={() => setScanDialog(false)}
        />
      )}
      {editDisks && (
        <Modal
          title={t("Target disks")}
          close={() => setEditDisks(false)}
          className="placement-disk-dialog"
        >
          <div class="placement-options">
            {service?.disks.map((d) => (
              <div class="placement-disk-option" key={d.name}>
                {d.kind === "array" ? (
                  <label class="check-field">
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={!options.excludedDisks.includes(d.name)}
                      onChange={(e) =>
                        updateOptions({
                          excludedDisks: toggle(
                            options.excludedDisks,
                            d.name,
                            !e.currentTarget.checked,
                          ),
                        })
                      }
                    />
                    <span>{d.name}</span>
                  </label>
                ) : (
                  <span class="quiet">
                    {d.name} · {t("Pool (not a target)")}
                  </span>
                )}
                <progress
                  max={d.total || 1}
                  value={d.total - d.free}
                  aria-label={t("Used space on {disk}", { disk: d.name })}
                />
                <small>
                  {bytes(d.total - d.free)} / {bytes(d.total)} ·{" "}
                  {t("{space} free", { space: bytes(d.free) })}
                </small>
              </div>
            ))}
          </div>
          <div class="modal-actions">
            <button class="button" onClick={() => setEditDisks(false)}>
              {t("Done")}
            </button>
          </div>
        </Modal>
      )}
      {summary && report?.finishedAt && (
        <PlacementSummaryDialog
          scan={report}
          scanning={scanning}
          counts={counts}
          openSettings={() => {
            setSummary(false);
            setup();
          }}
          rootFilter={(share, status) => {
            setShares(share ? [share] : []);
            changeFilters({
              statuses: status ? [status] : ["all"],
              q: "",
              targets: [],
              kinds: [],
            });
            setSummary(false);
          }}
          close={() => setSummary(false)}
          filter={pickTarget}
          select={selectTarget}
          busy={busy}
        />
      )}
      {dialog?.kind === "details" && (
        <PlacementDetailDialog
          item={dialog.item}
          disks={service?.disks || []}
          diskRoot={settings?.unraid?.diskRoot || "/unraid"}
          start={() => start([dialog.item.id])}
          terminal={() => detail(dialog.item, "log")}
          disabled={busy || scanning || !placementSelectable(dialog.item)}
          close={() => setDialog(undefined)}
        />
      )}
      {dialog?.kind === "status" && (
        <PlacementStatusDialog
          openFiles={openFiles}
          item={dialog.item}
          service={service}
          busy={
            busy || scanning || active || dialog.item.jobStatus === "succeeded"
          }
          close={() => setDialog(undefined)}
          recheck={() =>
            action(async () => {
              const item = await api<PlacementItem>(
                `placement/items/${dialog.item.id}/recheck`,
                "POST",
              );
              setDialog({ kind: "status", item });
            })
          }
        />
      )}
      {dialog?.kind === "log" && (
        <PlacementLogDialog
          item={dialog.item}
          close={() => setDialog(undefined)}
        />
      )}
    </>
  );
}
