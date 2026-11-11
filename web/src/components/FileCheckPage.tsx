import {
  ArrowUpRight,
  CircleAlert,
  Folder,
  FolderCog,
  Info,
  ListChecks,
  LoaderCircle,
  Play,
  Square,
  Terminal,
  Trash2,
} from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";
import { removePreference } from "../browser-storage";
import { confirmDeletion } from "../confirmation";
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
} from "../filecheck";
import { useLazyChunk } from "../hooks/useLazyChunk";
import { usePolling } from "../hooks/usePolling";
import { useRowRemoval } from "../hooks/useRowRemoval";
import { useToolPageState, type ToolRoute } from "../hooks/useToolPageState";
import { useToolPresets } from "../hooks/useToolPresets";
import { t, useI18n } from "../i18n";
import { instancesOf } from "../instances";
import { placementMessage } from "../placement-messages";
import { scanReportTime } from "../scan-report";
import { reportError, useScanErrorToast } from "../tool-feedback";
import { filterChips, toolFilterQuery } from "../tool-filters";
import {
  draftOf,
  fileCheckKpis,
  kpiChoice,
  toolCountPath,
  type ToolGroup,
  type ToolOption,
} from "../tool-list";
import { fileCheckStatusView } from "../tool-status";
import type {
  FileCheckActivity,
  FileCheckItem,
  FileCheckResults,
  FileCheckSettings,
  Settings,
} from "../types";
import { compactBytes as bytes, count, ICON } from "../ui";
import { useToolColumnStyle } from "../use-tool-table";
import {
  FileCheckCommandsDialog,
  downloadFileCheckScript,
} from "./FileCheckCommandsDialog";
import { FileCheckDetailDialog } from "./FileCheckDetailDialog";
import { FileCheckScanDialog } from "./FileCheckScanDialog";
import { ListEmpty } from "./list/ListEmpty";
import { RowButton } from "./list/RowButton";
import { CountTool } from "./list/TableCard";
import { Modal } from "./Modal";
import { PageHeader } from "./PageHeader";
import { itemRange } from "./Pagination";
import { SkippedRootsNotice, rootPresentation } from "./RootCoverage";
import { formatTableSort } from "./SortableHeader";
import { toolDrawerChunk } from "./tools/drawer-chunk";
import { ProgressCell } from "./tools/ProgressCell";
import { ReportButton, ScanButton } from "./tools/ScanButton";
import { StatusTag } from "./tools/StatusTag";
import { ToolCard } from "./tools/ToolCard";
import { ToolKpis } from "./tools/ToolKpis";
import { ToolTable, type ToolColumn } from "./tools/ToolTable";

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

// Info: Details and Terminal (Details only at ≤ 739); Actions: Fix and
// Remove (only Remove at ≤ 739).
const BUTTONS = { info: 2, actions: 2, infoPhone: 1, actionsPhone: 1 };

// The Files & permissions tool page (docs/STYLEGUIDE.md, Part 1, 11.1),
// without the transition sheet: the page header with “{count} open” (open,
// manual and failed findings), Scan report and Scan on the band, the KPI
// row (Items checked of the last report, then Open, Fixed and Manual as
// status filters, ruling R-G), then the tool card “Findings”: search,
// presets and the filter drawer (its own chunk: Shares from two, Kind and
// Status, counted by filecheck/items with limit=1), the chips with the page
// tools, the activity in its hint line (ruling R-J) and the tool table.
// Every 1.7.0 rule stays: polling (1s while a scan or a fix runs, else
// 10s, the busy state after 300ms), the selection (every finding but
// waiting, running and fixed ones, cleared on a filter, share, page or
// sort change, pruned to the shown rows on every answer), Fix selected
// for the fixable findings and Fix all (more than one asks), Terminal
// commands for the selection or every match, the scan report opening by
// itself when a scan ends with its kinds and root mappings, the scan error
// toast and every dialog (1.7.0 until 5d).
export function FileCheckPage({
  settings,
  changed,
  setup,
  route,
}: {
  settings: Settings | null;
  changed: () => unknown;
  setup: (service?: string) => void;
  route?: ToolRoute;
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
  useEffect(() => {
    removePreference("scopearr-filecheck-collapsed");
  }, []);
  const { filters, changeFilters, sort, sortBy, page, setPage } =
    useToolPageState(
      "filecheck",
      {
        statuses: ["open", "manual", "fixed", "failed", "active"],
        kinds: fileCheckKinds,
        sorts: Object.keys(fileCheckSortFields),
      },
      { resetPageOnSort: true },
      route,
    );
  const [shares, setShares] = useState<string[]>([]);
  const { q: query, statuses, kinds } = filters;
  const setQuery = (q: string) => changeFilters({ q });
  const [activity, setActivity] = useState<FileCheckActivity>(),
    [results, setResults] = useState<FileCheckResults>({
      items: [],
      total: 0,
      selectableIds: [],
    });
  const [selected, setSelected] = useState<number[]>([]),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [answered, setAnswered] = useState(false),
    [revision, setRevision] = useState(0),
    [drawer, setDrawer] = useState<HTMLElement | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: "details"; item: FileCheckItem }
    | { kind: "commands"; text: string; hostPaths: boolean }
    | { kind: "scan" }
    | { kind: "summary" }
  >();
  const lastScan = useRef<string>();
  const closeDrawer = () => setDrawer(null);
  const Drawer = useLazyChunk(toolDrawerChunk, !!drawer, closeDrawer);
  // Focus goes back to the Filters button once the drawer has closed,
  // unless it went elsewhere meanwhile.
  const anchor = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (drawer) {
      anchor.current = drawer;
      return;
    }
    const last = anchor.current;
    anchor.current = null;
    if (!last?.isConnected) return;
    const focused = document.activeElement;
    if (!focused || focused === document.body)
      last.focus({ preventScroll: true });
  }, [drawer]);
  const limit = settings?.pageSize || 100;
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
          api<FileCheckActivity>("filecheck/scan", "GET", undefined, signal),
          api<FileCheckResults>(
            "filecheck/items?" + q,
            "GET",
            undefined,
            signal,
          ),
        ]);
        if (signal.aborted) return;
        setActivity(next);
        setResults(list);
        setSelected((current) =>
          fileCheckVisibleSelection(current, list.items),
        );
        setLoading(false);
        setAnswered(true);
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
        return next;
      } catch (e) {
        if (!signal.aborted) {
          setLoading(false);
          setAnswered(true);
        }
      } finally {
        clearTimeout(delayed);
      }
    },
    (next) =>
      next && (next.scan.running || next.running || next.queued) ? 1000 : 10000,
    [filters, shares, formatTableSort(sort), page, limit, revision],
    { startDelay: query ? 180 : 0 },
  );
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
  const kindOptions: ToolOption[] = fileCheckKinds
    .filter((k) => counts["kind:" + k] !== undefined || kinds.includes(k))
    .map((value) => ({
      value,
      label: t(fileCheckKindLabels[value]),
      count: hasResults ? counts["kind:" + value] || 0 : undefined,
    }));
  const statusOptions: ToolOption[] = [
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
  // The shares of the results, then a chosen one they no longer hold, so
  // it can be cleared.
  const shareNames = Object.keys(results.shares || {});
  const shareOptions: ToolOption[] = [
    ...shareNames,
    ...shares.filter((value) => !shareNames.includes(value)),
  ].map((value) => ({
    value,
    label: value,
    count: results.shares?.[value] || 0,
  }));
  const chips = [
    ...filterChips(
      t("Shares"),
      shareNames.map((value) => ({ value, label: value })),
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
  const reset = () => {
    setShares([]);
    changeFilters({ statuses: [], targets: [], kinds: [], q: "" });
  };
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
  const style = useToolColumnStyle(
    columns,
    "files",
    fileCheckColumnLabels,
    BUTTONS,
  );

  // The activity of the hint line (ruling R-J): the scan, else the fixes
  // with a wait for a mux job or a disk placement move.
  const hint = scanning
    ? t("Scanning {checked} of {total} items", {
        checked: count(scan?.checked || 0),
        total: count(scan?.total || 0),
      })
    : active
      ? t("Fixing · {count} waiting", { count: activity?.queued || 0 }) +
        (activity?.fileWork && activity.fileWork !== "files"
          ? " · " +
            t(
              activity.fileWork === "mux"
                ? "Waiting: a mux job is running"
                : "Waiting: disk placement is moving files",
            )
          : "")
      : "";

  const ready = !!activity?.ready;
  const rows = ready
    ? results.items.filter((item) => !removal.hidden.has(item.id))
    : [];
  const label = (key: string) => t(fileCheckColumnLabels[key]);
  // Every row keeps its buttons in the same places (ruling I14): Fix comes
  // first and is always there, locked while the finding cannot be fixed;
  // Remove follows for a fixed finding, so its absence moves nothing, and
  // the column's width holds both.
  const cells: Record<
    string,
    Omit<ToolColumn<FileCheckItem>, "key" | "label">
  > = {
    actions: {
      info: true,
      cell: (item) => (
        <div class="v2-table-items">
          <RowButton
            label={t("Details for {title}", { title: item.rel })}
            title={t("Details")}
            icon={<Info size={ICON.row} />}
            onClick={() => setDialog({ kind: "details", item })}
          />
          <RowButton
            label={t("Terminal for {title}", { title: item.rel })}
            title={t("Terminal")}
            icon={<Terminal size={ICON.row} />}
            only="desk"
            onClick={() => void commands([item.id])}
          />
        </div>
      ),
    },
    title: {
      grow: true,
      sort: "title",
      cell: (item) => (
        <>
          <div class="v2-table-name" title={item.title}>
            {item.title}
          </div>
          <div class="v2-table-sub">{item.instance}</div>
        </>
      ),
    },
    path: {
      sort: "path",
      cell: (item) => (
        <>
          <div class="v2-table-line" title={item.rel}>
            {item.dir && <Folder size={ICON.label} aria-hidden="true" />}
            <span class="v2-table-name">{item.rel}</span>
          </div>
          {item.note && (
            <div class="v2-table-sub">{placementMessage(item.note, t)}</div>
          )}
        </>
      ),
    },
    kind: {
      sort: "kind",
      cell: (item) => (
        <span title={t(fileCheckKindHelp[item.kind])}>
          {t(fileCheckKindLabels[item.kind])}
        </span>
      ),
    },
    current: {
      sort: "current",
      cell: (item) => (
        <>
          <div class="v2-table-mono">
            {fileCheckModeText(item.mode, item.dir)}
          </div>
          <div class="v2-table-sub">
            {item.uid}:{item.gid}
            {!item.dir && " · " + bytes(item.size)}
          </div>
        </>
      ),
    },
    // A manual fix in the warning tone, as the 1.7.0 status-warn text.
    fix: {
      sort: "fix",
      cell: (item) => {
        const text = t(fileCheckFixLabel(item, options));
        return item.fix === "manual" ? (
          <span class="v2-st" data-tone="warn">
            {text}
          </span>
        ) : (
          text
        );
      },
    },
    status: {
      sort: "status",
      cell: (item) => {
        const view = fileCheckStatusView(item, t);
        return (
          <StatusTag
            view={view}
            openLabel={t("Status: {label}. Show details", {
              label: view.text,
            })}
            open={() => setDialog({ kind: "details", item })}
          />
        );
      },
    },
    progress: {
      sort: "progress",
      cell: (item) => (
        <ProgressCell
          status={item.jobStatus}
          value={item.progress}
          label={t("Progress")}
        />
      ),
    },
    remove: {
      cell: (item) => {
        const name = t("Remove {title} from the list", { title: item.rel });
        return (
          <div class="v2-table-items">
            <RowButton
              label={t("Fix {path}", { path: item.rel })}
              title={t("Fix")}
              icon={<Play size={ICON.row} />}
              only="desk"
              disabled={busy || scanning || !fileCheckFixable(item)}
              onClick={() => void fix([item.id])}
            />
            {item.jobStatus === "succeeded" && (
              <RowButton
                label={name}
                tone="danger"
                icon={
                  removal.removing.has(item.id) ? (
                    <LoaderCircle class="v2-spin" size={ICON.row} />
                  ) : (
                    <Trash2 size={ICON.row} />
                  )
                }
                disabled={busy}
                onClick={() =>
                  void removal.remove(item.id, () =>
                    api(`filecheck/items/${item.id}`, "DELETE"),
                  )
                }
              />
            )}
          </div>
        );
      },
    },
  };
  const tableColumns: ToolColumn<FileCheckItem>[] = columns
    .filter((key) => key !== "select")
    .map((key) => ({ key, label: label(key), ...cells[key] }));
  const title = t("Findings");
  // The drawer's fields in the 1.7.0 order: Shares (from two shares, or
  // while one is chosen), Kind and Status.
  const groups: ToolGroup[] = [
    ...(shareNames.length >= 2 || shares.length > 0
      ? [{ key: "shares" as const, label: t("Shares"), options: shareOptions }]
      : []),
    { key: "kinds", label: t("Kind"), options: kindOptions },
    { key: "statuses", label: t("Status"), options: statusOptions },
  ];
  const emptyState = !answered ? (
    <ListEmpty
      icon={<FolderCog size={ICON.empty} />}
      title={t("No scan yet")}
      pending
    />
  ) : !ready ? (
    <ListEmpty
      icon={<CircleAlert size={ICON.empty} />}
      title={t(
        activity?.error ||
          "Enable the MKVToolNix service and configure path mappings first",
      )}
    >
      <p>
        <button
          type="button"
          class="v2-btn v2-btn--primary"
          onClick={() => setup()}
        >
          {t("Open settings")}
          <ArrowUpRight size={ICON.label} />
        </button>
      </p>
    </ListEmpty>
  ) : !rows.length ? (
    <ListEmpty
      icon={<FolderCog size={ICON.empty} />}
      title={t(
        !scan?.finishedAt
          ? "No scan yet"
          : !scan.findings
            ? "Everything looks fine"
            : "No matching findings",
      )}
    >
      <p>
        {t(
          !scan?.finishedAt
            ? "Choose your libraries and checks, then click Scan."
            : "Change the filters or scan again.",
        )}
      </p>
    </ListEmpty>
  ) : null;
  return (
    <>
      {toolPresets.dialogs}
      <PageHeader
        title={t("Files & permissions")}
        meta={t("{count} open", {
          count:
            (counts.open || 0) + (counts.manual || 0) + (counts.failed || 0),
        })}
        metaTitle={t("Open items")}
        actions={
          <>
            <ReportButton
              notices={reportNotices}
              disabled={!report?.finishedAt}
              open={() => setDialog({ kind: "summary" })}
            />
            <ScanButton
              scanning={scanning}
              ready={mappingChanged}
              disabled={busy || (!scanning && !activity?.ready)}
              press={() =>
                scanning
                  ? void action(() => api("filecheck/scan", "DELETE"))
                  : setDialog({ kind: "scan" })
              }
            />
          </>
        }
      />
      <div class="v2-list-page">
        <ToolKpis
          kpis={fileCheckKpis(activity ?? null)}
          statuses={statuses}
          choose={(kpi) =>
            changeFilters({ statuses: kpiChoice(statuses, kpi) })
          }
        />
        <ToolCard
          id="filecheck"
          title={title}
          total={results.total}
          busy={loading || !!hint}
          activity={hint}
          search={{
            label: t("Title or path"),
            placeholder: t("Search title or path …"),
            value: query,
            change: setQuery,
          }}
          presets={toolPresets}
          allLabel={t("All findings")}
          active={chips.length > 0}
          filters={{
            count: statuses.length + kinds.length + shares.length,
            expanded: !!drawer,
            open: setDrawer,
          }}
          chips={chips}
          reset={reset}
          tools={
            <>
              {/* The selection is the page's (pruned to the shown rows on
                  every answer, cleared on a page change): its slot holds
                  the page size. */}
              <CountTool
                icon={<Play size={ICON.label} />}
                text={t("Fix selected")}
                count={selectedFixable.length}
                max={limit}
                title={
                  !selectedFixable.length
                    ? t(
                        "None of the selected findings can be fixed automatically. Use Terminal commands.",
                      )
                    : t("Fix selected")
                }
                disabled={busy || scanning || !selectedFixable.length}
                onClick={() => fix(selectedFixable)}
              />
              <button
                type="button"
                class="v2-btn v2-btn--sm"
                disabled={busy || scanning || !results.selectableIds.length}
                title={t("Fix all")}
                onClick={() => void fix()}
              >
                <ListChecks size={ICON.label} />
                <span class="v2-tc-label">{t("Fix all")}</span>
              </button>
              <CountTool
                icon={<Terminal size={ICON.label} />}
                text={t("Terminal commands")}
                count={selected.length}
                max={limit}
                title={t("Terminal commands")}
                disabled={busy || !results.total}
                onClick={() =>
                  selected.length
                    ? void commands(selected)
                    : setDialog({
                        kind: "commands",
                        text: "",
                        hostPaths: !!activity?.physical,
                      })
                }
              />
              <button
                type="button"
                class="v2-btn v2-btn--sm"
                disabled={busy || !active}
                title={t("Cancel")}
                onClick={() =>
                  void action(() => api("filecheck/cancel", "POST"))
                }
              >
                <Square size={ICON.label} />
                <span class="v2-tc-label">{t("Cancel")}</span>
              </button>
              <button
                type="button"
                class="v2-btn v2-btn--sm"
                disabled={busy || scanning || !activity?.fixed}
                title={t("Remove completed")}
                onClick={() =>
                  void action(() => api("filecheck/items?fixed=1", "DELETE"))
                }
              >
                <Trash2 size={ICON.label} />
                <span class="v2-tc-label">{t("Remove completed")}</span>
              </button>
            </>
          }
          csv={{
            href: "/api/filecheck/export.csv?" + exportQuery,
            enabled: results.total > 0,
          }}
          help={[
            ...(scan?.finishedAt
              ? [{ heading: "Last scan", text: scanInfo, raw: true }]
              : []),
            {
              heading: "How scanning works",
              text: "Choose services and checks in the Scan dialog. Reads folder metadata only and never opens files. Disks may spin up if their directory data is not cached.",
            },
          ]}
          pager={{
            page,
            pages,
            setPage,
            summary: itemRange(page, limit, results.total),
          }}
        >
          <ToolTable<FileCheckItem>
            rows={rows}
            keyOf={(item) => item.id}
            columns={tableColumns}
            style={style}
            sort={sort}
            onSort={sortBy}
            selection={{
              selected,
              set: setSelected,
              selectable: fileCheckSelectable,
              disabled: busy || scanning,
              allLabel: t("Select all visible findings"),
              rowLabel: (item) =>
                t("Select finding {path}", { path: item.rel }),
              keepOthers: true,
            }}
            removing={removal.removing}
          />
          {emptyState}
        </ToolCard>
      </div>
      {Drawer && (
        <Drawer
          subtitle={title}
          groups={groups}
          initial={draftOf(filters, shares)}
          countPath={(draft) => toolCountPath("files", query, draft)}
          apply={(draft) => {
            setShares(draft.shares);
            changeFilters({ statuses: draft.statuses, kinds: draft.kinds });
          }}
          close={closeDrawer}
        />
      )}
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
            setup={() => setup("mux")}
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
