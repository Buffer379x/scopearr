import {
  ArrowUpRight,
  CircleAlert,
  HardDrive,
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
import { confirmAction } from "../confirmation";
import { useDrawerAnchor } from "../hooks/useDrawerAnchor";
import { useLazyChunk } from "../hooks/useLazyChunk";
import { usePolling } from "../hooks/usePolling";
import { useRowRemoval } from "../hooks/useRowRemoval";
import { useToolPageState, type ToolRoute } from "../hooks/useToolPageState";
import { useToolPresets } from "../hooks/useToolPresets";
import { t, useI18n } from "../i18n";
import { instancesOf } from "../instances";
import {
  defaultUnraidSettings,
  placementColumnLabels,
  placementCompact,
  placementKindLabels,
  placementOrderedColumns,
  placementReportNotices,
  placementScanCompleted,
  placementSelectable,
  placementSortable,
  placementStatusShort,
} from "../placement";
import { placementMessage } from "../placement-messages";
import { reportError, useScanErrorToast } from "../tool-feedback";
import { filterChips, toggleFilter, toolFilterQuery } from "../tool-filters";
import {
  diskCardModels,
  draftOf,
  toolCountPath,
  type ToolGroup,
  type ToolOption,
} from "../tool-list";
import { placementStatusView } from "../tool-status";
import type {
  PlacementActivity,
  PlacementItem,
  PlacementResults,
  PlacementScan,
  Settings,
  UnraidSettings,
  UnraidStatus,
} from "../types";
import { compactBytes as bytes, count, ICON } from "../ui";
import { useToolColumnStyle } from "../use-tool-table";
import { ListEmpty } from "./list/ListEmpty";
import { itemRange } from "./list/PageNav";
import { RowButton } from "./list/RowButton";
import { CountTool } from "./list/TableCard";
import { TargetDisksDialog } from "./dialog/TargetDisksDialog";
import { PageHeader } from "./PageHeader";
import {
  PlacementDetailDialog,
  PlacementLogDialog,
  PlacementStatusDialog,
  PlacementSummaryDialog,
} from "./PlacementDialogs";
import { PlacementScanDialog } from "./PlacementScanDialog";
import { formatTableSort } from "../table-sort";
import { DiskCards } from "./tools/DiskCards";
import { toolDrawerChunk } from "./tools/drawer-chunk";
import { ProgressCell } from "./tools/ProgressCell";
import { ReportButton, ScanButton } from "./tools/ScanButton";
import { StatusTag } from "./tools/StatusTag";
import { ToolCard } from "./tools/ToolCard";
import { DiskTagCell, ToolDiskTag } from "./tools/ToolDiskTag";
import { ToolTable, type ToolColumn } from "./tools/ToolTable";

// Info: Details and Terminal (Details only at ≤ 739); Actions: Start and
// Remove (only Remove at ≤ 739).
const BUTTONS = { info: 2, actions: 2, infoPhone: 1, actionsPhone: 1 };
// The widest count Start selected's slot holds from the first paint on.
const START_SLOT = 9999;

// The Disk placement tool page (docs/STYLEGUIDE.md, Part 1, 11.1 and 11.2),
// without the transition sheet: the page header with “{count} open”, Scan
// report and Scan on the band, the disk row (a card per array disk and
// pool of unraid/status, standby from it, ruling R-B), then the tool card
// “Items”: search, presets and the filter drawer (its own chunk: Shares
// from two, Status and Kind, counted by placement/items with limit=1), the
// chips with the page tools, the activity in its hint line (ruling R-J)
// and the tool table. Every 1.7.0 rule stays: polling (1s while a scan or
// a move runs, else 10s, the busy state after 300ms), the selection (only
// startable rows, kept across pages, cleared on a filter or share change,
// but not by the target filter of the scan report's Select, and when a
// scan ends), the start question (more than one item or an
// owner change), the scan report opening by itself when a scan ends with
// its drilldowns, the scan error toast and every dialog (1.7.0 until 5d).
export function DiskPlacementPage({
  settings,
  changed,
  setup,
  openFiles,
  route,
}: {
  settings: Settings | null;
  changed: () => unknown;
  setup: () => void;
  openFiles: (path: string) => void;
  route?: ToolRoute;
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
  useEffect(() => {
    removePreference("scopearr-placement-collapsed");
  }, []);
  const { filters, changeFilters, sort, sortBy, page, setPage } =
    useToolPageState(
      "placement",
      {
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
        sorts: [...placementSortable],
      },
      { resetPageOnSort: true },
      route,
    );
  const [shares, setShares] = useState<string[]>([]);
  const { q: query, statuses, targets, kinds } = filters;
  const setQuery = (q: string) => changeFilters({ q });
  const [editDisks, setEditDisks] = useState(false);
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
    [answered, setAnswered] = useState(false),
    [revision, setRevision] = useState(0),
    [speed, setSpeed] = useState(0),
    [drawer, setDrawer] = useState<HTMLElement | null>(null);
  const [scanDialog, setScanDialog] = useState(false);
  const [report, setReport] = useState<PlacementScan>();
  const [summary, setSummary] = useState(false),
    [dialog, setDialog] = useState<{
      kind: "details" | "status" | "log";
      item: PlacementItem;
    }>();
  const lastSummary = useRef<string>(),
    sample = useRef({ at: 0, bytes: 0 });
  const closeDrawer = () => setDrawer(null);
  const Drawer = useLazyChunk(toolDrawerChunk, !!drawer, closeDrawer);
  // Focus goes back to the Filters button once the drawer has closed,
  // unless it went elsewhere meanwhile.
  useDrawerAnchor(drawer);
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
        setAnswered(true);
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
    // The selection stays only when the select request answered and the
    // target filter really changes; otherwise the next filter change would
    // keep a selection nobody made (Phase 6.3, 5b minor).
    let selectedTarget = false;
    await action(async () => {
      const list = await api<PlacementResults>(
        "placement/items?" + new URLSearchParams({ target: value, limit: "1" }),
      );
      setSelected((current) => [
        ...new Set([...current, ...list.selectableIds]),
      ]);
      selectedTarget = true;
    });
    if (!selectedTarget) return;
    setSummary(false);
    const next = toggleFilter(targets, value, true);
    // An unchanged target filter is not set again: a new filters object
    // would run the clearing effect and drop the selection just made.
    if (next.join() === targets.join()) return;
    keepSelection.current = true;
    changeFilters({ targets: next });
  };
  const columns = placementOrderedColumns(settings);
  const counts = activity?.counts || scan?.counts || {};
  const eligible = results.selectableIds.length;
  const updateOptions = (patch: Partial<UnraidSettings>) =>
    setOptions((current) => ({ ...current, ...patch }));
  const hasResults = !!scan?.finishedAt;
  const statusOptions: ToolOption[] = [
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
  const kindOptions: ToolOption[] = [
    { value: "small_files", label: t("Small files") },
    { value: "media_files", label: t("Media files") },
  ];
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
      shareNames.map((value) => ({ value, label: value })),
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
  const reset = () => {
    setShares([]);
    changeFilters({ statuses: [], targets: [], kinds: [], q: "" });
  };
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
  // A filter or share change clears the selection, except the target
  // filter that "select" in the scan report sets with the selection it
  // just made (fix wave: 1.7.0 cleared that selection again).
  const keepSelection = useRef(false);
  useEffect(() => {
    if (keepSelection.current) keepSelection.current = false;
    else setSelected([]);
  }, [filters, shares]);
  const style = useToolColumnStyle(
    columns,
    "placement",
    placementColumnLabels,
    BUTTONS,
  );

  // The activity of the hint line (ruling R-J): the scan, else the moves
  // with a wait for a mux job.
  const hint = scanning
    ? t("Scanning {disk} · {checked} of {total} items", {
        disk: scan?.disk || "…",
        checked: count(scan?.checked || 0),
        total: count(scan?.total || 0),
      })
    : active
      ? t("Moving {current} of {total} · {done} of {size} · {speed}/s", {
          current: count((activity?.moved || 0) + (activity?.running || 0)),
          total: count(
            (activity?.moved || 0) +
              (activity?.running || 0) +
              (activity?.queued || 0),
          ),
          done: bytes(activity?.bytesDone || 0),
          size: bytes(activity?.totalBytes || 0),
          speed: bytes(speed),
        }) +
        (activity?.fileWork === "mux"
          ? " · " + t("Waiting: a mux job is running")
          : "")
      : "";

  const ready = !!service?.ready;
  const rows = ready
    ? results.items.filter((item) => !removal.hidden.has(item.id))
    : [];
  const label = (key: string) => t(placementColumnLabels[key]);
  // Every row keeps its buttons in the same places (ruling I14): Start
  // comes first and is always there, locked while the item cannot start;
  // Remove follows for a moved item, so its absence moves nothing, and the
  // column's width holds both.
  const cells: Record<
    string,
    Omit<ToolColumn<PlacementItem>, "key" | "label">
  > = {
    actions: {
      info: true,
      cell: (item) => (
        <div class="v2-table-items">
          <RowButton
            label={t("Details for {title}", { title: item.title })}
            title={t("Details")}
            icon={<Info size={ICON.row} />}
            onClick={() => void detail(item, "details")}
          />
          <RowButton
            label={t("Terminal for {title}", { title: item.title })}
            title={t("Terminal")}
            icon={<Terminal size={ICON.row} />}
            only="desk"
            onClick={() => void detail(item, "log")}
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
            {item.season === -1
              ? item.title.replace(
                  / · Series folder$/,
                  " · " + t("Series folder"),
                )
              : item.title}
          </div>
          {(() => {
            const sub = item.service
              ? item.rel
              : t("No Radarr/Sonarr entry") + " · " + item.rel;
            return (
              <div class="v2-table-sub" title={sub}>
                {sub}
              </div>
            );
          })()}
        </>
      ),
    },
    // An instance name is user data: it may end in an ellipsis.
    service: {
      sort: "service",
      clip: true,
      cell: (item) =>
        item.instance ? (
          <span title={item.instance}>{item.instance}</span>
        ) : (
          "—"
        ),
    },
    size: {
      numeric: true,
      clip: true,
      sort: "size",
      cell: (item) => (placementCompact(item) ? "—" : bytes(item.totalBytes)),
    },
    disks: {
      wide: true,
      sort: "disks",
      cell: (item) => (
        <DiskTagCell item={item} more={() => void detail(item, "details")} />
      ),
    },
    target: {
      sort: "target",
      cell: (item) =>
        item.target ? <ToolDiskTag item={item} disk={item.target} /> : "—",
    },
    move: {
      numeric: true,
      clip: true,
      sort: "move",
      cell: (item) => (
        <>
          {bytes(item.moveBytes)}
          <div class="v2-table-sub">
            {t("{count} files", { count: item.moveFiles })}
          </div>
        </>
      ),
    },
    kind: {
      sort: "kind",
      clip: true,
      cell: (item) =>
        item.kind
          ? t(placementKindLabels[item.kind] || placementKindLabels.media_files)
          : "",
    },
    // Wide: in card rows the status takes a line of its own, as the wait
    // texts are wider than two cells.
    status: {
      sort: "status",
      wide: true,
      cell: (item) => {
        const view = placementStatusView(item, t);
        return (
          <StatusTag
            view={view}
            openLabel={t("Status: {label}. Show checks", { label: view.text })}
            open={() => void detail(item, "status")}
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
        const name = t("Remove {title} from the list", { title: item.title });
        return (
          <div class="v2-table-items">
            <RowButton
              label={t("Start item {title}", { title: item.title })}
              title={t("Start")}
              icon={<Play size={ICON.row} />}
              only="desk"
              disabled={busy || scanning || !placementSelectable(item)}
              onClick={() => void start([item.id])}
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
                    api(`placement/items/${item.id}`, "DELETE"),
                  )
                }
              />
            )}
          </div>
        );
      },
    },
  };
  const tableColumns: ToolColumn<PlacementItem>[] = columns
    .filter((key) => key !== "select")
    .map((key) => ({ key, label: label(key), ...cells[key] }));
  const title = t("Items");
  // The drawer's fields in the 1.7.0 order: Shares (from two shares, or
  // while one is chosen), Status and Kind.
  const groups: ToolGroup[] = [
    ...(shareNames.length >= 2 || shares.length > 0
      ? [{ key: "shares" as const, label: t("Shares"), options: shareOptions }]
      : []),
    { key: "statuses", label: t("Status"), options: statusOptions },
    { key: "kinds", label: t("Kind"), options: kindOptions },
  ];
  const emptyState = !answered ? (
    <ListEmpty
      icon={<HardDrive size={ICON.empty} />}
      title={t("No scan yet")}
      pending
    />
  ) : !ready ? (
    <ListEmpty
      icon={<CircleAlert size={ICON.empty} />}
      title={t(
        service?.error ||
          "Enable the MKVToolNix service and configure path mappings first",
      )}
    >
      <p>
        <button type="button" class="v2-btn v2-btn--primary" onClick={setup}>
          {t("Open settings")}
          <ArrowUpRight size={ICON.label} />
        </button>
      </p>
    </ListEmpty>
  ) : !rows.length ? (
    <ListEmpty
      icon={<HardDrive size={ICON.empty} />}
      title={t(
        !scan?.finishedAt
          ? "No scan yet"
          : !scan?.several && !scan?.unstartable
            ? "Everything is on one disk"
            : "No matching items",
      )}
    >
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
            type="button"
            class="v2-text-btn"
            onClick={() => changeFilters({ statuses: ["ok"] })}
          >
            {t("Show")}
          </button>
        </p>
      )}
    </ListEmpty>
  ) : null;
  return (
    <>
      {toolPresets.dialogs}
      <PageHeader
        title={t("Disk placement")}
        meta={t("{count} open", { count: counts.open || 0 })}
        metaTitle={t("Open items")}
        actions={
          <>
            <ReportButton
              notices={reportNotices}
              disabled={!report?.finishedAt}
              open={() => setSummary(true)}
            />
            <ScanButton
              scanning={scanning}
              ready={mappingChanged}
              disabled={busy}
              press={() =>
                scanning
                  ? void action(() => api("placement/scan", "DELETE"))
                  : setScanDialog(true)
              }
            />
          </>
        }
      />
      <div class="v2-list-page">
        <DiskCards
          disks={service ? diskCardModels(service.disks, results.items) : null}
        />
        <ToolCard
          id="placement"
          title={title}
          total={results.total}
          busy={loading || !!hint}
          dimmed={loading}
          activity={hint}
          search={{
            label: t("Title or folder"),
            placeholder: t("Search title or folder …"),
            value: query,
            change: setQuery,
          }}
          presets={toolPresets}
          allLabel={t("All items")}
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
              {/* The selection spans pages, so its slot holds a fixed
                  four-digit count from the first paint on, whatever the
                  page size, the filtered total or the last scan (a
                  selection of 10,000 or more widens it, a known limit). */}
              <CountTool
                icon={<Play size={ICON.label} />}
                text={t("Start selected")}
                count={selected.length}
                max={Math.max(limit, START_SLOT)}
                title={t("Start selected")}
                disabled={busy || scanning || !selected.length}
                onClick={() => void start(selected)}
              />
              <button
                type="button"
                class="v2-btn v2-btn--sm"
                disabled={busy || scanning || !eligible}
                title={t("Start all")}
                onClick={() => void start()}
              >
                <ListChecks size={ICON.label} />
                <span class="v2-tc-label">{t("Start all")}</span>
              </button>
              <button
                type="button"
                class="v2-btn v2-btn--sm"
                disabled={busy || !active}
                title={t("Cancel")}
                onClick={() =>
                  void action(() => api("placement/cancel", "POST"))
                }
              >
                <Square size={ICON.label} />
                <span class="v2-tc-label">{t("Cancel")}</span>
              </button>
              <button
                type="button"
                class="v2-btn v2-btn--sm"
                disabled={busy || scanning || !activity?.moved}
                title={t("Remove completed")}
                onClick={() =>
                  void action(() => api("placement/items?moved=1", "DELETE"))
                }
              >
                <Trash2 size={ICON.label} />
                <span class="v2-tc-label">{t("Remove completed")}</span>
              </button>
            </>
          }
          csv={{
            href: "/api/placement/export.csv?" + exportQuery,
            enabled: results.total > 0,
          }}
          help={[
            ...(scan?.finishedAt
              ? [{ heading: "Last scan", text: scanInfo, raw: true }]
              : []),
            {
              heading: "How scanning works",
              text: "Reads folder metadata only. Disks may spin up if their directory data is not cached.",
            },
          ]}
          pager={{
            page,
            pages,
            setPage,
            summary: itemRange(page, limit, results.total),
          }}
        >
          <ToolTable<PlacementItem>
            rows={rows}
            keyOf={(item) => item.id}
            columns={tableColumns}
            style={style}
            sort={sort}
            onSort={sortBy}
            selection={{
              selected,
              set: setSelected,
              selectable: placementSelectable,
              disabled: busy || scanning,
              allLabel: t("Select all visible items"),
              rowLabel: (item) =>
                t("Select item {title}", { title: item.title }),
              keepOthers: true,
            }}
            removing={removal.removing}
          />
          {emptyState}
        </ToolCard>
      </div>
      {Drawer && (
        <Drawer
          list="placement"
          subtitle={title}
          groups={groups}
          initial={draftOf(filters, shares)}
          countPath={(draft) => toolCountPath("placement", query, draft)}
          apply={(draft) => {
            setShares(draft.shares);
            changeFilters({ statuses: draft.statuses, kinds: draft.kinds });
          }}
          close={closeDrawer}
        />
      )}
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
        <TargetDisksDialog
          disks={service?.disks || []}
          excluded={options.excludedDisks}
          busy={busy}
          change={(excludedDisks) => updateOptions({ excludedDisks })}
          close={() => setEditDisks(false)}
        />
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
