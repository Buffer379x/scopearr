import { FileCheckScanDialog } from "./FileCheckScanDialog";
import {
  FileCheckCommandsDialog,
  downloadFileCheckScript,
} from "./FileCheckCommandsDialog";
import { scanReportTime } from "../scan-report";
import { CompactProgress } from "./CompactProgress";
import { MultiFilter } from "./MultiFilter";
import { FilterRow } from "./FilterRow";
import { useToolPresets } from "../hooks/useToolPresets";
import {
  readSessionPreference,
  writeSessionPreference,
} from "../browser-storage";
import { useRowRemoval } from "../hooks/useRowRemoval";
import { toolColumn } from "../tool-table";
import { useToolTableStyle } from "../use-tool-table";
import { SkippedRootsNotice, rootPresentation } from "./RootCoverage";
import { ICON } from "../ui";
import { placementMessage } from "../placement-messages";
import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import {
  ArrowLeft,
  ArrowRight,
  CircleAlert,
  ClipboardList,
  FolderCog,
  Folder,
  Info,
  LoaderCircle,
  Play,
  ScanSearch,
  Square,
  Terminal,
  Trash2,
} from "lucide-preact";
import { api } from "../api";
import {
  readPreference,
  removePreference,
  writePreference,
  readToolFilters,
} from "../browser-storage";
import { confirmDeletion } from "../confirmation";
import { instancesOf } from "../instances";
import { t, useI18n } from "../i18n";
import {
  defaultFileCheckSettings,
  fileCheckColumnLabels,
  fileCheckFixable,
  fileCheckFixLabel,
  fileCheckKindHelp,
  fileCheckKindLabels,
  fileCheckKinds,
  fileCheckModeText,
  fileCheckOrderedColumns,
  fileCheckSortFields,
  fileCheckStatus,
  fileCheckStatusLabels,
  fileCheckStatusTone,
} from "../filecheck";
import type {
  FileCheckActivity,
  FileCheckItem,
  FileCheckResults,
  FileCheckSettings,
  Settings,
} from "../types";
import { compactBytes as bytes, count } from "../ui";
import { HelpPopover } from "./HelpPopover";
import { reportError, useScanErrorToast } from "../tool-feedback";
import { ActiveFilterBar, CSVExport, FilterCheckList } from "./ToolFilters";
import { filterChips, toggleFilter, toolFilterQuery } from "../tool-filters";
import { Modal } from "./Modal";
import { DetailRow } from "./MuxPathDialog";
import {
  formatTableSort,
  nextTableSort,
  parseTableSort,
  SortableHeader,
  type TableSort,
} from "./SortableHeader";

export function fileCheckSelectable(item: Pick<FileCheckItem, "jobStatus">) {
  return !["queued", "running", "succeeded"].includes(item.jobStatus);
}

export function fileCheckVisibleSelection(
  selected: number[],
  items: Pick<FileCheckItem, "id" | "jobStatus">[],
) {
  const visible = new Set(
    items.filter(fileCheckSelectable).map((item) => item.id),
  );
  return selected.filter((id) => visible.has(id));
}

export function FileCheckStatusTag({
  item,
}: {
  item: Pick<FileCheckItem, "jobStatus" | "fix" | "message">;
}) {
  const status = fileCheckStatus(item);
  return (
    <span
      class={"tag status-" + (fileCheckStatusTone[status] || "neutral")}
      title={item.message ? t(item.message) : undefined}
    >
      {t(fileCheckStatusLabels[status] || status)}
    </span>
  );
}

function FileCheckDetailDialog({
  item,
  options,
  commands,
  close,
  fix,
  disabled,
}: {
  item: FileCheckItem;
  options: FileCheckSettings;
  fix: () => void;
  disabled: boolean;
  commands: () => void;
  close: () => void;
}) {
  useI18n();
  const target = item.dir ? options.dirMode : options.fileMode;
  return (
    <Modal title={item.title} close={close} className="filecheck-details">
      <div class="filename-box">
        <code>{item.rel}</code>
      </div>
      <p class="placement-status-line">
        <span class="tag">{t(fileCheckKindLabels[item.kind])}</span>{" "}
        <FileCheckStatusTag item={item} />
      </p>
      <div class="notice filecheck-reason">
        {t(fileCheckKindHelp[item.kind])}
      </div>
      <div class="mux-check-list">
        <DetailRow label={t("Service")} value={item.instance} />
        <DetailRow
          label={t("Current permissions")}
          value={`${fileCheckModeText(item.mode, item.dir)} · ${item.uid}:${item.gid}`}
        />
        <DetailRow
          label={t("Target permissions")}
          value={`${fileCheckModeText(parseInt(target, 8), item.dir)} · ${options.ownerUid}:${options.ownerGid}`}
        />
        {!item.dir && <DetailRow label={t("Size")} value={bytes(item.size)} />}
        <DetailRow
          label={t("Fix")}
          value={t(fileCheckFixLabel(item, options))}
        />
        {item.note && (
          <DetailRow label={t("Note")} value={placementMessage(item.note, t)} />
        )}
      </div>
      {item.fix === "manual" && !item.note.includes("cannot assign") && (
        <p class="notice">
          {t(
            "Scopearr runs without root and cannot change this item. Use the terminal command.",
          )}
        </p>
      )}
      {item.message && item.fix !== "manual" && (
        <p class="notice">{t(item.message)}</p>
      )}
      <div class="modal-actions">
        <button class="button" onClick={commands}>
          <Terminal size={ICON.label} />
          {t("Terminal command")}
        </button>
        <button class="button" onClick={close}>
          {t("Close")}
        </button>
        <button
          class="button primary mobile-row-action"
          disabled={disabled}
          onClick={fix}
        >
          <Play size={ICON.label} />
          {t("Fix")}
        </button>
      </div>
    </Modal>
  );
}

export function FileCheckPage({
  settings,
  changed,
  setup,
}: {
  settings: Settings | null;
  changed: () => unknown;
  setup: (service?: string) => void;
}) {
  const { locale } = useI18n();
  const libraries = settings
    ? instancesOf(settings).filter(
        (c) => c.enabled && (c.type === "radarr" || c.type === "sonarr"),
      )
    : [];
  const [options, setOptions] = useState<FileCheckSettings>({
    ...defaultFileCheckSettings,
  });
  useEffect(() => {
    const f = settings?.fileCheck || defaultFileCheckSettings;
    setOptions({
      ...f,
      ownerUid: settings?.unraid?.ownerUid ?? defaultFileCheckSettings.ownerUid,
      ownerGid: settings?.unraid?.ownerGid ?? defaultFileCheckSettings.ownerGid,
      libraries: f.libraries.length
        ? [...f.libraries]
        : libraries.map((c) => c.id),
    });
  }, [
    JSON.stringify(settings?.fileCheck),
    settings?.unraid?.ownerUid,
    settings?.unraid?.ownerGid,
    libraries.map((c) => c.id).join(","),
  ]);
  const [collapsed, setCollapsed] = useState(true);
  useEffect(() => {
    removePreference("scopearr-filecheck-collapsed");
  }, []);
  const [filters, setFilters] = useState(() =>
    readToolFilters("scopearr-filecheck-filters", {
      statuses: ["open", "manual", "fixed", "failed", "active"],
      kinds: fileCheckKinds,
    }),
  );
  const [shares, setShares] = useState<string[]>([]);
  const { q: query, statuses, kinds } = filters;
  const changeFilters = (patch: Partial<typeof filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };
  const setQuery = (q: string) => changeFilters({ q });
  useEffect(() => {
    writePreference("scopearr-filecheck-filters", JSON.stringify(filters));
  }, [filters]);
  const [sort, setSortState] = useState<TableSort>(
      parseTableSort(readPreference("scopearr-filecheck-sort")),
    ),
    [page, setPage] = useState(() =>
      Math.max(
        1,
        Number(readSessionPreference("scopearr-filecheck-page")) || 1,
      ),
    );
  const [activity, setActivity] = useState<FileCheckActivity>(),
    [results, setResults] = useState<FileCheckResults>({
      items: [],
      total: 0,
      selectableIds: [],
    });
  const [selected, setSelected] = useState<number[]>([]),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  const [dialog, setDialog] = useState<
    | { kind: "details"; item: FileCheckItem }
    | { kind: "commands"; text: string; hostPaths: boolean }
    | { kind: "scan" }
    | { kind: "summary" }
  >();
  const lastScan = useRef<string>();
  const limit = settings?.pageSize || 100;
  useEffect(() => {
    writeSessionPreference("scopearr-filecheck-page", String(page));
  }, [page]);
  const reload = () => setRevision((n) => n + 1);
  const removal = useRowRemoval(async () => {
    reload();
    await changed();
  });
  const sortBy = (field: string) => {
    const next = nextTableSort(sort, field);
    setSortState(next);
    writePreference("scopearr-filecheck-sort", formatTableSort(next));
    setPage(1);
  };
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const load = async () => {
      const delayed = setTimeout(() => {
        if (live) setLoading(true);
      }, 300);
      const q = toolFilterQuery(query, {
        status: statuses,
        kind: kinds,
        share: shares,
      });
      const paging = new URLSearchParams({
        ...(sort
          ? { sort: fileCheckSortFields[sort.field], dir: sort.direction }
          : {}),
        offset: String((page - 1) * limit),
        limit: String(limit),
      });
      for (const [key, value] of paging) q.set(key, value);
      try {
        const [next, list] = await Promise.all([
          api<FileCheckActivity>(
            "filecheck/scan",
            "GET",
            undefined,
            controller.signal,
          ),
          api<FileCheckResults>(
            "filecheck/items?" + q,
            "GET",
            undefined,
            controller.signal,
          ),
        ]);
        if (!live) return;
        setActivity(next);
        setResults(list);
        setSelected((current) =>
          fileCheckVisibleSelection(current, list.items),
        );
        setLoading(false);
        if (
          lastScan.current !== undefined &&
          !next.scan.running &&
          next.scan.finishedAt &&
          next.scan.finishedAt !== lastScan.current
        ) {
          setDialog({ kind: "summary" });
          setSelected([]);
        }
        lastScan.current = next.scan.finishedAt || "";
        timer = setTimeout(
          load,
          next.scan.running || next.running || next.queued ? 1000 : 10000,
        );
      } catch (e) {
        if (live) {
          setLoading(false);
          timer = setTimeout(load, 10000);
        }
      } finally {
        clearTimeout(delayed);
      }
    };
    timer = setTimeout(load, query ? 180 : 0);
    return () => {
      live = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [filters, shares, formatTableSort(sort), page, limit, revision]);
  const [mappingChanged, setMappingChanged] = useState(false);
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
  const startScan = async (next: FileCheckSettings) => {
    await api("filecheck/scan", "POST", next);
    setOptions(next);
    setSelected([]);
    setMappingChanged(false);
    setDialog(undefined);
    reload();
    changed();
  };
  const filterQuery = toolFilterQuery(query, {
    status: statuses,
    kind: kinds,
    share: shares,
  }).toString();
  const exportQuery = new URLSearchParams(filterQuery);
  if (sort) {
    exportQuery.set("sort", fileCheckSortFields[sort.field]);
    exportQuery.set("dir", sort.direction);
  }
  const fix = async (ids?: number[]) => {
    const n = ids ? ids.length : results.selectableIds.length;
    if (
      n > 1 &&
      !(await confirmDeletion(
        t("You are about to fix {count} findings.", { count: n }),
        false,
        t("Fix"),
      ))
    )
      return;
    await action(async () => {
      await api(
        "filecheck/fix",
        "POST",
        ids ? { ids } : { all: true, query: filterQuery },
      );
      setSelected([]);
    });
  };
  const commands = (ids?: number[]) =>
    action(async () => {
      const result = await api<{ text: string; hostPaths: boolean }>(
        "filecheck/commands",
        "POST",
        ids ? { ids } : { all: true, query: filterQuery },
      );
      if (!ids) {
        downloadFileCheckScript(result.text);
        return;
      }
      setDialog({ kind: "commands", ...result });
    });
  const pageIds = results.items
    .filter(fileCheckSelectable)
    .map((item) => item.id);
  const allSelected =
      pageIds.length > 0 && pageIds.every((id) => selected.includes(id)),
    someSelected = pageIds.some((id) => selected.includes(id));
  const columns = fileCheckOrderedColumns(settings);
  const counts = activity?.counts || {};
  const selectedFixable = results.selectableIds.filter((id) =>
    selected.includes(id),
  );
  const report =
    activity?.report || (scan?.finishedAt && !scanning ? scan : undefined);
  const reportTime = scanReportTime(report, locale);
  const disabled = busy || scanning || active;
  const reportNotices =
    !!report?.finishedAt &&
    (report.roots || []).some((root) => !root.mapped || !!root.pathWarning);
  useScanErrorToast(
    "scopearr-filecheck-seen-scan-error",
    scan,
    (error) => t(error),
    { source: ["filecheck"] },
  );
  const hasResults = !!scan?.finishedAt;
  const kindOptions = fileCheckKinds
    .filter((k) => counts["kind:" + k] !== undefined || kinds.includes(k))
    .map((value) => ({
      value,
      label: t(fileCheckKindLabels[value]),
      count: hasResults ? counts["kind:" + value] || 0 : undefined,
    }));
  const statusOptions = [
    ["open", "Open"],
    ["manual", "Manual"],
    ["fixed", "Completed"],
    ["failed", "Failed"],
  ].map(([value, label]) => ({
    value,
    label: t(label),
    count: hasResults ? counts[value] || 0 : undefined,
  }));
  if (
    statuses.includes("active") &&
    !statusOptions.some((option) => option.value === "active")
  )
    statusOptions.push({
      value: "active",
      label: t("Active"),
      count: undefined,
    });
  const chips = [
    ...filterChips(
      t("Shares"),
      Object.keys(results.shares || {}).map((value) => ({
        value,
        label: value,
      })),
      shares,
      (value) => {
        setShares((current) => current.filter((s) => s !== value));
        setPage(1);
      },
    ),
    ...filterChips(t("Kind"), kindOptions, kinds, (value) =>
      changeFilters({ kinds: kinds.filter((v) => v !== value) }),
    ),
    ...filterChips(t("Status"), statusOptions, statuses, (value) =>
      changeFilters({ statuses: statuses.filter((v) => v !== value) }),
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
  const scanInfo = scan?.finishedAt
    ? t("Last scan") +
      ": " +
      new Date(scan.finishedAt).toLocaleString(locale) +
      " (" +
      Math.ceil(scan.duration) +
      " s)"
    : t("No scan yet");
  const toolPresets = useToolPresets(
    "tool:filecheck",
    toolFilterQuery(query, { status: statuses, kind: kinds, share: shares }),
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
  useEffect(
    () => setSelected([]),
    [filters, shares, page, formatTableSort(sort)],
  );
  const tableStyle = useToolTableStyle(
    columns,
    "files",
    fileCheckColumnLabels,
    fileCheckStatusLabels,
  );
  return (
    <>
      {toolPresets.dialogs}
      <section class="library-intro">
        <h1>{t("Files & permissions")}</h1>
        <span title={t("Open items")}>
          {t("{count} open", {
            count:
              (counts.open || 0) + (counts.manual || 0) + (counts.failed || 0),
          })}
        </span>
      </section>
      <section
        class={
          "filter-panel filter-panel-v2 placement-panel filecheck-panel" +
          (collapsed ? " collapsed" : "")
        }
        aria-label={t("Files & permissions scan")}
      >
        <FilterRow
          allLabel={t("All findings")}
          label={t("Title or path")}
          placeholder={t("Search title or path …")}
          value={query}
          change={setQuery}
          collapsed={collapsed}
          setCollapsed={setCollapsed}
          controls="filecheck-result-filters"
          {...toolPresets}
        />
        {!collapsed && (
          <div class="filter-groups" id="filecheck-result-filters">
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
                title={t("Kind")}
                options={kindOptions}
                selected={kinds}
                toggle={(value, checked) =>
                  changeFilters({ kinds: toggleFilter(kinds, value, checked) })
                }
              />
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
            </section>
          </div>
        )}
        <ActiveFilterBar
          export={
            <CSVExport
              href={"/api/filecheck/export.csv?" + exportQuery}
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
              onClick={() => setDialog({ kind: "summary" })}
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
                  text: "Choose services and checks in the Scan dialog. Reads folder metadata only and never opens files. Disks may spin up if their directory data is not cached.",
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
              {t("Findings")}{" "}
              <span class="heading-count" title={t("Items in the list")}>
                {count(results.total)}
              </span>
              {(scanning || active) && (
                <span class="tool-activity" aria-live="polite">
                  <LoaderCircle size={ICON.label} class="spin" />
                  {scanning ? (
                    <span class="tool-activity-text">
                      <span>
                        {t("Scanning {checked} of {total} items", {
                          checked: count(scan?.checked || 0),
                          total: count(scan?.total || 0),
                        })}
                      </span>
                    </span>
                  ) : active ? (
                    <span class="tool-activity-text">
                      <span>
                        {t("Fixing · {count} waiting", {
                          count: activity?.queued || 0,
                        })}
                      </span>
                      {activity?.fileWork && activity.fileWork !== "files" && (
                        <span>
                          {t(
                            activity.fileWork === "mux"
                              ? "Waiting: a mux job is running"
                              : "Waiting: disk placement is moving files",
                          )}
                        </span>
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
              disabled={busy || (!scanning && !activity?.ready)}

              onClick={() =>
                scanning
                  ? action(() => api("filecheck/scan", "DELETE"))
                  : setDialog({ kind: "scan" })
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
              disabled={busy || scanning || !selectedFixable.length}
              title={
                !selectedFixable.length
                  ? t(
                      "None of the selected findings can be fixed automatically. Use Terminal commands.",
                    )
                  : undefined
              }
              onClick={() => fix(selectedFixable)}
            >
              <Play size={ICON.label} />
              {t("Fix selected")}
              {` (${count(selectedFixable.length)})`}
            </button>
            <button
              class="button"
              disabled={busy || scanning || !results.selectableIds.length}
              onClick={() => fix()}
            >
              <Play size={ICON.label} />
              {t("Fix all")}
            </button>
            {active && (
              <button
                class="button"
                disabled={busy}
                onClick={() => action(() => api("filecheck/cancel", "POST"))}
              >
                <Square size={ICON.label} />
                {t("Cancel")}
              </button>
            )}
            <button
              class="button"
              disabled={busy || !results.total}
              onClick={() =>
                selected.length
                  ? commands(selected)
                  : setDialog({
                      kind: "commands",
                      text: "",
                      hostPaths: !!activity?.physical,
                    })
              }
            >
              <Terminal size={ICON.label} />
              {t("Terminal commands")}
              {selected.length ? ` (${count(selected.length)})` : ""}
            </button>
            <button
              class="button"
              disabled={busy || scanning || !activity?.fixed}
              onClick={() =>
                action(() => api("filecheck/items?fixed=1", "DELETE"))
              }
            >
              <Trash2 size={ICON.label} />
              {t("Remove completed")}
            </button>
          </div>
        </div>

        {!activity?.ready && !loading ? (
          <p class="notice">
            <CircleAlert size={ICON.button} />
            <span>
              {t(
                activity?.error ||
                  "Enable the MKVToolNix service and configure path mappings first",
              )}{" "}
              <button class="text-button" onClick={() => setup()}>
                {t("Open settings")}
              </button>
            </span>
          </p>
        ) : !results.items.length && !loading ? (
          <div class="empty-state">
            <FolderCog size={ICON.empty} />
            <h3>
              {t(
                !scan?.finishedAt
                  ? "No scan yet"
                  : !scan.findings
                    ? "Everything looks fine"
                    : "No matching findings",
              )}
            </h3>
            <p>
              {t(
                !scan?.finishedAt
                  ? "Choose your libraries and checks, then click Scan."
                  : "Change the filters or scan again.",
              )}
            </p>
          </div>
        ) : (
          <div
            class={"table-wrap placement-table-wrap" + (loading ? " busy" : "")}
          >
            <table
              class="data-table placement-table filecheck-table tool-table"
              style={tableStyle}
            >
              <colgroup>
                {columns.map((field) => (
                  <col
                    key={field}
                    class={"tool-col-" + toolColumn(field, "files")}
                  />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {columns.map((field) =>
                    fileCheckSortFields[field] ? (
                      <SortableHeader
                        key={field}
                        label={t(fileCheckColumnLabels[field])}
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
                              : "col-control"
                        }
                      >
                        {field === "select" ? (
                          <input
                            type="checkbox"
                            aria-label={t("Select all visible findings")}
                            disabled={busy || scanning || !pageIds.length}
                            checked={allSelected}
                            ref={(el) => {
                              if (el)
                                el.indeterminate = someSelected && !allSelected;
                            }}
                            onChange={(e) =>
                              setSelected((current) =>
                                e.currentTarget.checked
                                  ? [...new Set([...current, ...pageIds])]
                                  : current.filter(
                                      (id) => !pageIds.includes(id),
                                    ),
                              )
                            }
                          />
                        ) : field === "progress" ? (
                          t(fileCheckColumnLabels[field])
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
                    const status = fileCheckStatus(item);
                    const cells: Record<string, JSX.Element> = {
                      select: (
                        <td class="col-control">
                          <input
                            type="checkbox"
                            aria-label={t("Select finding {path}", {
                              path: item.rel,
                            })}
                            disabled={
                              busy || scanning || !fileCheckSelectable(item)
                            }
                            checked={
                              fileCheckSelectable(item) &&
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
                        <td class="col-control tool-actions">
                          <div class="info-actions">
                            <button
                              class="row-icon info-action"
                              aria-label={t("Details for {title}", {
                                title: item.rel,
                              })}
                              title={t("Details")}
                              onClick={() =>
                                setDialog({ kind: "details", item })
                              }
                            >
                              <Info size={ICON.row} />
                            </button>
                            <button
                              class="row-icon info-action desktop-row-action"
                              aria-label={t("Fix {path}", { path: item.rel })}
                              title={t("Fix")}
                              disabled={
                                busy || scanning || !fileCheckFixable(item)
                              }
                              onClick={() => fix([item.id])}
                            >
                              <Play size={ICON.row} />
                            </button>
                          </div>
                        </td>
                      ),
                      title: (
                        <td>
                          <strong class="cell-title" title={item.title}>
                            {item.title}
                          </strong>
                          <small class="cell-sub">{item.instance}</small>
                        </td>
                      ),
                      path: (
                        <td class="filecheck-path">
                          {item.dir && <Folder size={ICON.label} />}
                          <span title={item.rel}>{item.rel}</span>
                          {item.note && (
                            <small class="cell-sub">
                              {placementMessage(item.note, t)}
                            </small>
                          )}
                        </td>
                      ),
                      kind: (
                        <td>
                          <span
                            class="cell-kind"
                            title={t(fileCheckKindHelp[item.kind])}
                          >
                            {t(fileCheckKindLabels[item.kind])}
                          </span>
                        </td>
                      ),
                      current: (
                        <td class="nowrap">
                          <code class="filecheck-mode">
                            {fileCheckModeText(item.mode, item.dir)}
                          </code>
                          <small class="cell-sub">
                            {item.uid}:{item.gid}
                            {!item.dir && " · " + bytes(item.size)}
                          </small>
                        </td>
                      ),
                      fix: (
                        <td>
                          <span
                            class={
                              "cell-kind" +
                              (item.fix === "manual" ? " status-warn" : "")
                            }
                          >
                            {t(fileCheckFixLabel(item, options))}
                          </span>
                        </td>
                      ),
                      status: (
                        <td class="col-status">
                          <button
                            class="status-button"
                            aria-label={t("Status: {label}. Show details", {
                              label: t(fileCheckStatusLabels[status] || status),
                            })}
                            onClick={() => setDialog({ kind: "details", item })}
                            title={t("Status: {label}. Show details", {
                              label: t(fileCheckStatusLabels[status] || status),
                            })}
                          >
                            <FileCheckStatusTag item={item} />
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
                                title: item.rel,
                              })}
                              title={t("Remove {title} from the list", {
                                title: item.rel,
                              })}
                              onClick={() =>
                                removal.remove(item.id, () =>
                                  api(`filecheck/items/${item.id}`, "DELETE"),
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
      {dialog?.kind === "details" && (
        <FileCheckDetailDialog
          item={dialog.item}
          fix={() => fix([dialog.item.id])}
          disabled={busy || scanning || !fileCheckFixable(dialog.item)}
          options={settings?.fileCheck || options}
          commands={() => commands([dialog.item.id])}
          close={() => setDialog(undefined)}
        />
      )}
      {dialog?.kind === "commands" && (
        <FileCheckCommandsDialog
          text={dialog.text}
          hostPaths={dialog.hostPaths}
          total={results.total}
          downloadAll={() => commands()}
          busy={busy || scanning}
          close={() => setDialog(undefined)}
        />
      )}
      {dialog?.kind === "scan" && (
        <FileCheckScanDialog
          settings={settings}
          options={options}
          physical={!!activity?.physical}
          fixesActive={active}
          scanning={scanning}
          start={startScan}
          openNames={() => {
            setDialog(undefined);
            setup("unraid");
          }}
          close={() => setDialog(undefined)}
        />
      )}
      {dialog?.kind === "summary" && report?.finishedAt && (
        <Modal
          wide
          title={t("Scan report")}
          close={() => setDialog(undefined)}
          className="placement-summary"
        >
          {scanning && (
            <p class="notice">
              {t("A new scan is running. This report shows the previous scan.")}
            </p>
          )}
          <dl class="key-values">
            {reportTime && (
              <div>
                <dt>{t("Scanned at")}</dt>
                <dd title={reportTime.iso}>{reportTime.date}</dd>
              </div>
            )}
            {reportTime?.duration && (
              <div>
                <dt>{t("Duration")}</dt>
                <dd>{reportTime.duration}</dd>
              </div>
            )}
            {[
              ["Items checked", count(report.checked)],
              ["Files checked", count(report.files)],
              ["Findings", count(report.findings)],
              ["Affected items", count(report.items)],
              ["Data in findings", bytes(report.bytes)],
              ["Manual fixes", count(report.fixes?.manual || 0)],
            ].map(([label, value]) => (
              <div>
                <dt>{t(String(label))}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <SkippedRootsNotice
            roots={rootPresentation(
              report?.roots || [],
              settings?.mux?.mappings || "",
            )}
            saved={async () => {
              setMappingChanged(true);
              await changed();
              reload();
            }}
            setup={setup}
            disabled={disabled}
          />
          <h3 class="card-title">{t("By kind")}</h3>
          <div class="table-wrap">
            <table class="detail-table placement-summary-table">
              <thead>
                <tr>
                  <th scope="col">{t("Kind")}</th>
                  <th scope="col" class="number">
                    {t("Findings")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {fileCheckKinds
                  .filter((k) => report.kinds?.[k])
                  .map((k) => (
                    <tr key={k}>
                      <td>
                        <button
                          class="text-button"
                          onClick={() => {
                            changeFilters({ kinds: [k] });
                            setPage(1);
                            setDialog(undefined);
                          }}
                        >
                          {t(fileCheckKindLabels[k])}
                        </button>
                      </td>
                      <td class="number">{count(report.kinds[k])}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div class="modal-actions">
            <button class="button" onClick={() => setDialog(undefined)}>
              {t("Close")}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
