import {
  ArrowUpRight,
  CircleAlert,
  CircleMinus,
  Info,
  ListChecks,
  LoaderCircle,
  Play,
  RotateCcw,
  Scissors,
  ScrollText,
  SlidersHorizontal,
  Square,
  Terminal,
  Trash2,
  X,
} from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";
import {
  confirmAction,
  confirmDeletion,
  confirmDiscard,
} from "../confirmation";
import { openLog } from "../event-log";
import { useDrawerAnchor } from "../hooks/useDrawerAnchor";
import { useLazyChunk } from "../hooks/useLazyChunk";
import { useMuxSelection } from "../hooks/useMuxSelection";
import { usePolling } from "../hooks/usePolling";
import { useRowRemoval } from "../hooks/useRowRemoval";
import { useToolPageState, type ToolRoute } from "../hooks/useToolPageState";
import { useToolPresets } from "../hooks/useToolPresets";
import { t, useI18n } from "../i18n";
import { removePreference } from "../browser-storage";
import { muxSelectedJobs } from "../mux-selection";
import {
  cleanMuxName,
  effectiveMuxStatus,
  muxColumnLabels,
  muxColumns,
  muxFilterJobs,
  muxSortable,
  muxSortJobs,
  muxStartable,
  muxStatusLabels,
  validateMuxSpec,
} from "../mux-spec";
import { notify } from "../notifications";
import { filterChips, toolFilterQuery } from "../tool-filters";
import {
  draftOf,
  kpiChoice,
  muxDraftCount,
  muxKpis,
  type ToolGroup,
} from "../tool-list";
import { muxStatusView } from "../tool-status";
import { muxOpenJobs } from "../tool-table";
import type { MuxJob, MuxSpec, Settings } from "../types";
import { bytes, ICON } from "../ui";
import { useToolColumnStyle } from "../use-tool-table";
import { ListEmpty } from "./list/ListEmpty";
import { itemRange } from "./list/PageNav";
import { RowButton } from "./list/RowButton";
import { CountTool } from "./list/TableCard";
import { MuxOptionsDialog } from "./MuxOptionsDialog";
import { MuxStatusDialog } from "./MuxStatusDialog";
import { MuxTerminalDialog } from "./MuxTerminalDialog";
import { PageHeader } from "./PageHeader";
import { toolDrawerChunk } from "./tools/drawer-chunk";
import { ProgressCell } from "./tools/ProgressCell";
import { StatusTag } from "./tools/StatusTag";
import { ToolCard } from "./tools/ToolCard";
import { ToolKpis } from "./tools/ToolKpis";
import { ToolTable, type ToolColumn } from "./tools/ToolTable";

// The filter drawer's status values, in the 1.7.0 order.
const STATUS_ORDER = [
  "ready",
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "warning",
  "draft",
  "needs_review",
  "needs_attention",
];
// Info: Details (phones), Mux options and Terminal (above 739); Actions:
// Start and the removing action (above 739), only the removing one below.
const BUTTONS = { info: 2, actions: 2, infoPhone: 1, actionsPhone: 1 };
const HELP = [
  {
    heading: "How muxing works",
    text: "Files you mark for muxing in Movies or TV series appear here. Open a job's options to choose tracks and the output name, then start it alone or together with others. Jobs run one at a time; the original is handled as configured in Settings → Services → MKVToolNix.",
  },
];

// The Muxing tool page (docs/STYLEGUIDE.md, Part 1, 11.1), without the
// transition sheet: the page header with “{count} open” (muxOpenJobs, the
// effective statuses, as the Open card counts) and Show in log, the KPI
// row (Open, Running, Failed, Successful as status filters), the setup
// notice without MKVToolNix, then the tool card: search, presets and the
// filter drawer (its own chunk, the Status values, counted locally), the
// chips with the page tools and the tool table. Every 1.7.0 rule stays:
// polling (2s while a job runs, else 15s), the selection (every row,
// cleared on a filter, sort, page or page size change, trimmed on reload),
// Start selected and Start all for startable jobs only (more than one
// asks), Remove mux marking through useMuxSelection, Remove completed for
// successful jobs without a kept backup and the dialogs (1.7.0 until 5d).
export function MuxPage({
  changed,
  names,
  installed,
  settings,
  setup,
  route,
}: {
  changed: () => unknown;
  names: Record<string, string>;
  installed: boolean;
  setup: () => void;
  settings: Settings | null;
  route?: ToolRoute;
}) {
  useI18n();
  const { filters, setFilters, sort, sortBy, page, setPage } = useToolPageState(
    "mux",
    {
      statuses: Object.keys(muxStatusLabels),
      sorts: [...muxSortable],
    },
    { resetPageOnSort: false },
    route,
  );
  useEffect(() => {
    removePreference("scopearr-mux-filter-collapsed");
  }, []);
  const [jobs, setJobs] = useState<MuxJob[]>([]),
    [drafts, setDrafts] = useState<Record<number, MuxSpec>>({}),
    [revisions, setRevisions] = useState<Record<number, number>>({}),
    [selected, setSelected] = useState<number[]>([]),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [drawer, setDrawer] = useState<HTMLElement | null>(null),
    [dialog, setDialog] = useState<{
      id: number;
      kind: "options" | "status" | "terminal";
    }>();
  const closeDrawer = () => setDrawer(null);
  const Drawer = useLazyChunk(toolDrawerChunk, !!drawer, closeDrawer);
  // Focus goes back to the Filters button once the drawer has closed,
  // unless it went elsewhere meanwhile.
  useDrawerAnchor(drawer);
  const load = (signal?: AbortSignal) =>
    api<MuxJob[]>("mux/jobs", "GET", undefined, signal).then((next) => {
      if (!signal?.aborted) {
        setJobs(next);
        setLoading(false);
      }
      return next;
    });
  const removal = useRowRemoval(async () => {
    await load();
    changed();
  });
  const active = jobs.some((job) => ["queued", "running"].includes(job.status));
  const pollingStarted = useRef(false);
  const startDelay = pollingStarted.current ? (active ? 2000 : 15000) : 0;
  pollingStarted.current = true;
  usePolling(
    async (signal) => {
      try {
        return await load(signal);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    (next) =>
      (next || jobs).some((j) => ["queued", "running"].includes(j.status))
        ? 2000
        : 15000,
    [active],
    { startDelay },
  );
  const discard = (id: number) => {
    setDrafts((old) => {
      const next = { ...old };
      delete next[id];
      return next;
    });
    setRevisions((old) => {
      const next = { ...old };
      delete next[id];
      return next;
    });
  };
  const edit = (j: MuxJob, spec: MuxSpec) => {
    setRevisions((old) => ({ ...old, [j.id]: old[j.id] ?? j.revision }));
    setDrafts((old) => ({ ...old, [j.id]: spec }));
  };
  const action = async (run: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await run();
      await load();
      changed();
    } catch {
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  };
  const save = async (j: MuxJob) => {
    const spec = drafts[j.id] || j.spec;
    const error = validateMuxSpec(j.source.tracks, spec);
    if (error) {
      notify(t(error), "error");
      throw new Error(error);
    }
    await api("mux/jobs?id=" + j.id, "PUT", {
      spec: { ...spec, outputName: cleanMuxName(spec.outputName) },
      revision: revisions[j.id] ?? j.revision,
    });
    discard(j.id);
    notify(t("Mux options saved. The job is ready."));
  };
  const start = async (selection: number[]) => {
    const ids = jobs
      .filter((j) => selection.includes(j.id) && muxStartable(j))
      .map((j) => j.id);
    if (!ids.length) return;
    if (
      ids.length > 1 &&
      !(await confirmAction(
        t("You are about to start {count} jobs.", { count: ids.length }),
        t("Start"),
      ))
    )
      return;
    await action(async () => {
      const result = await api<{ rejected: Record<string, string> }>(
        "mux/run",
        "POST",
        { ids },
      );
      for (const reason of Object.values(result.rejected))
        notify(t(reason), "warning");
      setSelected([]);
    });
  };
  const remove = async (j: MuxJob) => {
    const active = ["queued", "running"].includes(j.status);
    if (
      j.status !== "succeeded" &&
      !(await confirmDeletion(
        t(
          active
            ? "Cancel this mux job? The original remains unchanged before replacement."
            : "Delete this mux job? The media file is not changed.",
        ),
      ))
    )
      return;
    if (active) await action(() => api("mux/cancel?id=" + j.id, "POST"));
    else await removal.remove(j.id, () => api("mux/jobs?id=" + j.id, "DELETE"));
    discard(j.id);
  };
  const close = async () => {
    if (
      dialog?.kind === "options" &&
      drafts[dialog.id] &&
      !(await confirmDiscard(t("Discard unsaved mux options?")))
    )
      return;
    if (dialog?.kind === "options") discard(dialog.id);
    setDialog(undefined);
  };
  const job = jobs.find((j) => j.id === dialog?.id);
  const ranked = muxSortJobs(jobs, sort, names);
  const visible = muxFilterJobs(ranked, filters).filter(
    (job) => !removal.hidden.has(job.id),
  );
  const limit = settings?.pageSize || 100;
  const pages = Math.max(1, Math.ceil(visible.length / limit));
  const pageJobs = visible.slice((page - 1) * limit, page * limit);
  const selectedJobs = muxSelectedJobs(pageJobs, selected);
  const pageSelection = selectedJobs.map((j) => j.id);
  const startable = selectedJobs.filter(muxStartable).length;
  const selectionScope = JSON.stringify([filters, sort, page, limit]);
  useEffect(() => setSelected([]), [selectionScope]);
  useEffect(
    () =>
      setSelected((current) =>
        current.filter((id) => pageJobs.some((j) => j.id === id)),
      ),
    [pageJobs.map((j) => j.id).join(",")],
  );

  const previousFilters = useRef(JSON.stringify([filters, limit]));
  useEffect(() => {
    const next = JSON.stringify([filters, limit]);
    if (previousFilters.current !== next) setPage(1);
    previousFilters.current = next;
  }, [filters, limit]);
  useEffect(() => {
    if (!loading && page > pages) setPage(pages);
  }, [page, pages, loading]);
  const statusOptions = STATUS_ORDER.map((value) => ({
    value,
    label: t(value === "succeeded" ? "Completed" : muxStatusLabels[value]),
    count: jobs.filter((j) => effectiveMuxStatus(j) === value).length,
  }));
  const chips = [
    ...filterChips(t("Status"), statusOptions, filters.statuses, (value) =>
      setFilters({
        ...filters,
        statuses: filters.statuses.filter((v) => v !== value),
      }),
    ),
    ...(filters.q
      ? [
          {
            key: "q",
            label: t("Search") + ": " + filters.q,
            remove: () => setFilters({ ...filters, q: "" }),
          },
        ]
      : []),
  ];
  const reset = () =>
    setFilters({ statuses: [], targets: [], kinds: [], q: "" });
  const toolPresets = useToolPresets(
    "tool:mux",
    toolFilterQuery(filters.q, { status: filters.statuses }),
    (q) =>
      setFilters({
        q: q.get("q") || "",
        statuses: q.getAll("status"),
        targets: [],
        kinds: [],
      }),
  );
  const groups: ToolGroup[] = [
    { key: "statuses", label: t("Status"), options: statusOptions },
  ];
  const style = useToolColumnStyle(muxColumns, "mux", muxColumnLabels, BUTTONS);

  // Remove mux marking (1.7.0 MuxSelectionActions, ruling I6): the shared
  // mux selection of the selected jobs' files; while it runs, its slot
  // counts the files handled, its icon turns, its title reads "Removing …
  // {done}/{total}" and a polite live region, there only during the run,
  // announces that at each quarter of the run, as the libraries' tools.
  const marking = useMuxSelection({
    files: selectedJobs.map((j) => ({ service: j.service, id: j.fileId })),
    jobs,
    installed,
    busyChanged: setBusy,
    changed: async () => {
      setSelected([]);
      await load();
      await changed();
    },
  });
  const removing = marking.working === "remove";
  const quarter = marking.total
    ? Math.floor((marking.done * 4) / marking.total)
    : 0;
  const reached = {
    done: Math.ceil((quarter * marking.total) / 4),
    total: marking.total,
  };
  const markingText = removing
    ? t("Removing … {done}/{total}", {
        done: marking.done,
        total: marking.total,
      })
    : t("Remove mux marking ({count})", { count: marking.marked });

  const label = (key: string) => t(muxColumnLabels[key]);
  // Every row keeps its buttons in the same places (ruling I14): Start
  // comes first and is always there, locked while the job cannot start;
  // the removing action follows, so a missing one (an action needed) moves
  // nothing, and the column's width holds both.
  const cells: Record<string, Omit<ToolColumn<MuxJob>, "key" | "label">> = {
    buttons: {
      info: true,
      cell: (j) => (
        <div class="v2-table-items">
          <RowButton
            label={t("Details for {title}", { title: j.title })}
            title={t("Details")}
            icon={<Info size={ICON.row} />}
            only="phone"
            onClick={() => setDialog({ id: j.id, kind: "status" })}
          />
          <RowButton
            label={t("Mux options for {title}", { title: j.title })}
            title={t("Mux options")}
            icon={<SlidersHorizontal size={ICON.row} />}
            only="desk"
            onClick={() => setDialog({ id: j.id, kind: "options" })}
          />
          <RowButton
            label={t("Terminal for {title}", { title: j.title })}
            title={t("Terminal")}
            icon={<Terminal size={ICON.row} />}
            only="desk"
            onClick={() => setDialog({ id: j.id, kind: "terminal" })}
          />
        </div>
      ),
    },
    filename: {
      grow: true,
      sort: "filename",
      cell: (j) => (
        <>
          <div class="v2-table-name" title={j.sourceName}>
            {j.sourceName}
          </div>
          <div class="v2-table-sub" title={j.title}>
            {j.title}
          </div>
        </>
      ),
    },
    size: {
      numeric: true,
      clip: true,
      sort: "size",
      cell: (j) => bytes(j.source.size),
    },
    // An instance name is user data: it may end in an ellipsis.
    origin: {
      sort: "origin",
      clip: true,
      cell: (j) => {
        const name =
          names[j.service] ||
          (j.service.startsWith("sonarr") ? "Sonarr" : "Radarr");
        return <span title={name}>{name}</span>;
      },
    },
    // Wide: in card rows the status takes a line of its own, as a status
    // text can be wider than a cell (Disk placement's rule).
    status: {
      sort: "status",
      wide: true,
      cell: (j) => {
        const view = muxStatusView(j, t);
        return (
          <StatusTag
            view={view}
            openLabel={t("Status: {label}. Show checks", { label: view.text })}
            open={() => setDialog({ id: j.id, kind: "status" })}
          />
        );
      },
    },
    progress: {
      sort: "progress",
      cell: (j) => (
        <ProgressCell
          status={j.status}
          value={j.progress}
          label={t("Progress")}
        />
      ),
    },
    actions: {
      cell: (j) => {
        const running = ["queued", "running"].includes(j.status);
        const kept = !running && !!j.backupName;
        const name = t(
          running
            ? "Cancel mux job: {filename}"
            : j.status === "succeeded"
              ? "Remove {title} from the list"
              : "Delete mux job: {filename}",
          { filename: j.sourceName, title: j.sourceName },
        );
        const retry = ["failed", "cancelled"].includes(j.status);
        return (
          <div class="v2-table-items">
            <RowButton
              label={t("Start item {title}", { title: j.title })}
              icon={
                retry ? <RotateCcw size={ICON.row} /> : <Play size={ICON.row} />
              }
              only="desk"
              disabled={busy || !installed || !muxStartable(j)}
              onClick={() => void start([j.id])}
            />
            {j.status !== "needs_attention" && (
              <RowButton
                label={name}
                title={
                  kept
                    ? t(
                        "Delete or keep the preserved backup in the mux options first",
                      )
                    : name
                }
                tone="danger"
                icon={
                  removal.removing.has(j.id) ? (
                    <LoaderCircle class="v2-spin" size={ICON.row} />
                  ) : j.status === "running" ? (
                    <Square size={ICON.row} />
                  ) : running ? (
                    <X size={ICON.row} />
                  ) : (
                    <Trash2 size={ICON.row} />
                  )
                }
                disabled={busy || kept}
                onClick={() => void remove(j)}
              />
            )}
          </div>
        );
      },
    },
  };
  const columns: ToolColumn<MuxJob>[] = muxColumns
    .filter((key) => key !== "select")
    .map((key) => ({ key, label: label(key), ...cells[key] }));
  const completed = jobs.filter(
    (j) => j.status === "succeeded" && !j.backupName,
  );
  const title = t("Jobs");
  return (
    <>
      {toolPresets.dialogs}
      <PageHeader
        title={t("Muxing")}
        meta={t("{count} open", { count: muxOpenJobs(jobs) })}
        metaTitle={t("Open items")}
        actions={
          <button
            type="button"
            class="v2-btn v2-btn--on-band"
            onClick={() => openLog({ source: ["mux"] })}
          >
            <ScrollText size={ICON.button} />
            {t("Show in log")}
          </button>
        }
      />
      <div class="v2-list-page">
        <ToolKpis
          kpis={muxKpis(loading ? null : jobs)}
          statuses={filters.statuses}
          choose={(kpi) =>
            setFilters({
              ...filters,
              statuses: kpiChoice(filters.statuses, kpi),
            })
          }
        />
        {!installed && (
          <div class="v2-notice v2-notice--setup">
            <CircleAlert size={ICON.large} aria-hidden="true" />
            <div class="v2-notice-body">
              <b>{t("Install MKVToolNix first")}</b>
            </div>
            <button
              type="button"
              class="v2-btn v2-btn--primary"
              onClick={setup}
            >
              {t("Open settings")}
              <ArrowUpRight size={ICON.label} />
            </button>
          </div>
        )}
        <ToolCard
          id="mux"
          title={title}
          total={visible.length}
          busy={loading}
          dimmed={loading}
          search={{
            label: t("Filename"),
            placeholder: t("Search filename …"),
            value: filters.q,
            change: (value) => setFilters({ ...filters, q: value }),
          }}
          presets={toolPresets}
          allLabel={t("All jobs")}
          active={chips.length > 0}
          filters={{
            count: filters.statuses.length,
            expanded: !!drawer,
            open: setDrawer,
          }}
          chips={chips}
          reset={reset}
          tools={
            <>
              <CountTool
                icon={<Play size={ICON.label} />}
                text={t("Start selected")}
                count={startable}
                max={limit}
                title={t("Start selected")}
                disabled={busy || !installed || !startable}
                onClick={() => void start(pageSelection)}
              />
              <CountTool
                icon={
                  removing ? (
                    <LoaderCircle class="v2-spin" size={ICON.label} />
                  ) : (
                    <CircleMinus size={ICON.label} />
                  )
                }
                text={t("Remove mux marking ({count})")}
                count={removing ? marking.done : marking.marked}
                on={removing}
                max={limit}
                title={
                  markingText +
                  " · " +
                  t(
                    !selectedJobs.length
                      ? "Select entries first."
                      : !marking.marked
                        ? "None of the selected files is marked."
                        : !marking.removable
                          ? "None of the selected jobs can be removed."
                          : "Remove mux marking",
                  )
                }
                disabled={
                  busy ||
                  !!marking.working ||
                  !marking.marked ||
                  !marking.removable
                }
                onClick={() => void marking.run(true)}
              />
              {marking.working && (
                <span class="v2-sr-only" aria-live="polite">
                  {quarter ? t("Removing … {done}/{total}", reached) : ""}
                </span>
              )}
              <button
                type="button"
                class="v2-btn v2-btn--sm"
                disabled={busy || !installed || !jobs.some(muxStartable)}
                title={t("Starts all ready jobs, including filtered ones")}
                onClick={() =>
                  void start(jobs.filter(muxStartable).map((j) => j.id))
                }
              >
                <ListChecks size={ICON.label} />
                <span class="v2-tc-label">{t("Start all")}</span>
              </button>
              <button
                type="button"
                class="v2-btn v2-btn--sm"
                disabled={busy || !completed.length}
                title={t("Remove completed")}
                onClick={() =>
                  void action(async () => {
                    for (const j of completed)
                      await api("mux/jobs?id=" + j.id, "DELETE");
                  })
                }
              >
                <Trash2 size={ICON.label} />
                <span class="v2-tc-label">{t("Remove completed")}</span>
              </button>
            </>
          }
          help={HELP}
          pager={{
            page,
            pages,
            setPage,
            summary: itemRange(page, limit, visible.length),
          }}
        >
          <ToolTable
            rows={pageJobs}
            keyOf={(j) => j.id}
            columns={columns}
            style={style}
            sort={sort}
            onSort={sortBy}
            selection={{
              selected: pageSelection,
              set: setSelected,
              selectable: () => true,
              disabled: busy,
              allLabel: t("Select all"),
              rowLabel: (j) => t("Select job {id}", { id: j.id }),
            }}
            removing={removal.removing}
          />
          {!visible.length && (
            <ListEmpty
              icon={<Scissors size={ICON.empty} />}
              title={t(chips.length ? "No matching jobs." : "No mux jobs.")}
              pending={loading}
            >
              <p>
                {t(
                  chips.length
                    ? "Change the filters."
                    : "Mark a file in its details to add a mux job.",
                )}
              </p>
            </ListEmpty>
          )}
        </ToolCard>
      </div>
      {Drawer && (
        <Drawer
          list="mux"
          subtitle={title}
          groups={groups}
          initial={draftOf(filters, [])}
          localCount={(draft) => muxDraftCount(jobs, filters.q, draft)}
          apply={(draft) =>
            setFilters({ ...filters, statuses: draft.statuses })
          }
          close={closeDrawer}
        />
      )}
      {job && dialog?.kind === "options" && (
        <MuxOptionsDialog
          job={job}
          spec={drafts[job.id] || job.spec}
          dirty={!!drafts[job.id]}
          busy={busy}
          edit={(spec) => edit(job, spec)}
          save={() =>
            action(async () => {
              await save(job);
              // A saved draft is gone, so closing needs no discard prompt.
              setDialog(undefined);
            })
          }
          discard={() => discard(job.id)}
          close={close}
          action={(route) =>
            action(async () => {
              if (
                route === "backup" &&
                !(await confirmDeletion(
                  t("Permanently delete this preserved original backup?"),
                ))
              )
                return;
              await api(`mux/jobs/${route}?id=${job.id}`, "POST");
              if (route === "identify") discard(job.id);
            })
          }
        />
      )}{" "}
      {job && dialog?.kind === "status" && (
        <MuxStatusDialog
          job={job}
          workDir={!!settings?.mux?.workDir}
          options={() => setDialog({ id: job.id, kind: "options" })}
          terminal={() => setDialog({ id: job.id, kind: "terminal" })}
          busy={busy}
          close={close}
          refresh={() =>
            action(async () => {
              if (job.status === "needs_review")
                await api("mux/jobs/identify?id=" + job.id, "POST");
              else await api("mux/jobs?id=" + job.id + "&fresh=1");
            })
          }
        />
      )}{" "}
      {job && dialog?.kind === "terminal" && (
        <MuxTerminalDialog key={job.id} job={job} close={close} />
      )}
    </>
  );
}
