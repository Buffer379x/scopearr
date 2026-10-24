import { HelpPopover } from "./HelpPopover";
import { FilterRow } from "./FilterRow";
import { useToolPresets } from "../hooks/useToolPresets";
import { count } from "../ui";
import {
  readSessionPreference,
  writeSessionPreference,
} from "../browser-storage";
import { muxOpenJobs } from "../tool-table";
import { useRowRemoval } from "../hooks/useRowRemoval";
import { ICON } from "../ui";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  Play,
  Trash2,
  CircleAlert,
  ArrowLeft,
  ArrowRight,
  LoaderCircle,
  Scissors,
} from "lucide-preact";
import { api } from "../api";
import type { MuxJob, MuxSpec, Settings } from "../types";
import { t, useI18n } from "../i18n";
import {
  confirmDeletion,
  confirmDiscard,
  confirmAction,
} from "../confirmation";
import {
  cleanMuxName,
  validateMuxSpec,
  muxStartable,
  muxColumns,
  muxSortJobs,
  muxFilterJobs,
  muxStatusLabels,
  effectiveMuxStatus,
} from "../mux-spec";
import {
  readPreference,
  removePreference,
  writePreference,
  readToolFilters,
} from "../browser-storage";
import {
  formatTableSort,
  nextTableSort,
  parseTableSort,
  type TableSort,
} from "./SortableHeader";
import { notify } from "../notifications";
import { MuxTable } from "./MuxTable";
import { MuxOptionsDialog } from "./MuxOptionsDialog";
import { MuxStatusDialog } from "./MuxStatusDialog";
import { MuxTerminalDialog } from "./MuxTerminalDialog";
import { ActiveFilterBar, FilterCheckList } from "./ToolFilters";
import { filterChips, toggleFilter, toolFilterQuery } from "../tool-filters";
export function MuxPage({
  changed,
  names,
  installed,
  settings,
  setup,
}: {
  changed: () => unknown;
  names: Record<string, string>;
  installed: boolean;
  setup: () => void;
  settings: Settings | null;
}) {
  useI18n();
  const [filters, setFilters] = useState(() =>
    readToolFilters("scopearr-mux-filters", {
      statuses: Object.keys(muxStatusLabels),
    }),
  );
  const [collapsed, setCollapsed] = useState(true);
  useEffect(() => {
    removePreference("scopearr-mux-filter-collapsed");
  }, []);
  useEffect(() => {
    writePreference("scopearr-mux-filters", JSON.stringify(filters));
  }, [filters]);
  const [sort, setSort] = useState<TableSort>(
    parseTableSort(readPreference("scopearr-mux-sort")),
  );
  const sortBy = (field: string) => {
    const next = nextTableSort(sort, field);
    setSort(next);
    writePreference("scopearr-mux-sort", formatTableSort(next));
  };
  const [jobs, setJobs] = useState<MuxJob[]>([]),
    [drafts, setDrafts] = useState<Record<number, MuxSpec>>({}),
    [revisions, setRevisions] = useState<Record<number, number>>({}),
    [selected, setSelected] = useState<number[]>([]),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [dialog, setDialog] = useState<{
      id: number;
      kind: "options" | "status" | "terminal";
    }>();
  const load = () =>
    api<MuxJob[]>("mux/jobs").then((next) => {
      setJobs(next);
      setLoading(false);
    });
  const removal = useRowRemoval(async () => {
    await load();
    changed();
  });
  const [page, setPage] = useState(() =>
    Math.max(1, Number(readSessionPreference("scopearr-mux-page")) || 1),
  );
  useEffect(() => {
    writeSessionPreference("scopearr-mux-page", String(page));
  }, [page]);
  const active = jobs.some((j) => ["queued", "running"].includes(j.status));
  useEffect(() => {
    load().catch(() => setLoading(false));
  }, []);
  useEffect(() => {
    const timer = setInterval(
      () => {
        if (!document.hidden) load().catch(() => {});
      },
      active ? 2000 : 15000,
    );
    return () => clearInterval(timer);
  }, [active]);
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
  const start = async (ids: number[]) => {
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
  const previousFilters = useRef(JSON.stringify([filters, limit]));
  useEffect(() => {
    const next = JSON.stringify([filters, limit]);
    if (previousFilters.current !== next) setPage(1);
    previousFilters.current = next;
  }, [filters, limit]);
  useEffect(() => {
    if (!loading && page > pages) setPage(pages);
  }, [page, pages, loading]);
  const statusOptions = [
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
  ].map((value) => ({
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
  return (
    <>
      {toolPresets.dialogs}
      <section class="library-intro">
        <h1>{t("Muxing")}</h1>
        <span title={t("Open items")}>
          {t("{count} open", { count: muxOpenJobs(jobs) })}
        </span>
      </section>
      <section
        class={
          "filter-panel filter-panel-v2 placement-panel mux-filter-panel" +
          (collapsed ? " collapsed" : "")
        }
        aria-label={t("Mux filters")}
      >
        <FilterRow
          allLabel={t("All jobs")}
          label={t("Filename")}
          placeholder={t("Search filename …")}
          value={filters.q}
          change={(value) => setFilters({ ...filters, q: value })}
          collapsed={collapsed}
          setCollapsed={setCollapsed}
          controls="mux-filters"
          {...toolPresets}
        />
        {!collapsed && (
          <div class="filter-groups" id="mux-filters">
            <section class="attribute-filters">
              <FilterCheckList
                title={t("Status")}
                options={statusOptions}
                selected={filters.statuses}
                toggle={(value, checked) =>
                  setFilters({
                    ...filters,
                    statuses: toggleFilter(filters.statuses, value, checked),
                  })
                }
              />
            </section>
          </div>
        )}
        <ActiveFilterBar
          chips={chips}
          help={
            <HelpPopover
              label="Help"
              sections={[
                {
                  heading: "How muxing works",
                  text: "Files you mark for muxing in Movies or TV series appear here. Open a job's options to choose tracks and the output name, then start it alone or together with others. Jobs run one at a time; the original is handled as configured in Settings → Services → MKVToolNix.",
                },
              ]}
            />
          }
          reset={() =>
            setFilters({ statuses: [], targets: [], kinds: [], q: "" })
          }
        />
      </section>
      {!installed && (
        <p class="notice">
          <CircleAlert size={ICON.button} />
          {t("Install MKVToolNix first")}{" "}
          <button class="text-button" onClick={setup}>
            {t("Open settings")}
          </button>
        </p>
      )}
      <section class="library-section">
        <div class="results-heading">
          <div>
            <h2>
              {t("Jobs")}{" "}
              <span title={t("Items in the list")}>
                {count(visible.length)}
              </span>
              {loading && <LoaderCircle size={ICON.label} class="spin" />}
            </h2>
          </div>
          <div class="results-tools">
            <button
              class="button"
              disabled={busy || !installed || !selected.length}
              onClick={() => start(selected)}
            >
              <Play size={ICON.label} />
              {t("Start selected")}
            </button>
            <button
              class="button"
              disabled={busy || !installed || !jobs.some(muxStartable)}
              title={t("Starts all ready jobs, including filtered ones")}
              onClick={() => start(jobs.filter(muxStartable).map((j) => j.id))}
            >
              <Play size={ICON.label} />
              {t("Start all")}
            </button>
            <button
              class="button"
              disabled={
                busy ||
                !jobs.some((j) => j.status === "succeeded" && !j.backupName)
              }
              onClick={() =>
                action(async () => {
                  for (const j of jobs.filter(
                    (j) => j.status === "succeeded" && !j.backupName,
                  ))
                    await api("mux/jobs?id=" + j.id, "DELETE");
                })
              }
            >
              <Trash2 size={ICON.label} />
              {t("Remove completed")}
            </button>
          </div>
        </div>
        {!!visible.length && (
          <MuxTable
            jobs={visible.slice((page - 1) * limit, page * limit)}
            removing={removal.removing}
            names={names}
            columns={muxColumns}
            sort={sort}
            sortBy={sortBy}
            selected={selected}
            setSelected={setSelected}
            busy={busy}
            options={(j) => setDialog({ id: j.id, kind: "options" })}
            terminal={(j) => setDialog({ id: j.id, kind: "terminal" })}
            status={(j) => setDialog({ id: j.id, kind: "status" })}
            remove={remove}
          />
        )}
        {!visible.length && (
          <div class="empty-state">
            <Scissors size={ICON.empty} />
            <h3>{t(chips.length ? "No matching jobs." : "No mux jobs.")}</h3>
            <p>
              {t(
                chips.length
                  ? "Change the filters."
                  : "Mark a file in its details to add a mux job.",
              )}
            </p>
          </div>
        )}
        <div class="pagination">
          <span title={t("Items in the list")}>
            {t("{from}–{to} of {total}", {
              from: visible.length ? count((page - 1) * limit + 1) : "0",
              to: count(Math.min(page * limit, visible.length)),
              total: count(visible.length),
            })}
          </span>
          <div>
            <button
              class="icon-button"
              title={t("Previous page")}
              aria-label={t("Previous page")}
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              <ArrowLeft size={ICON.button} />
            </button>
            <span>{t("Page {page} / {pages}", { page, pages })}</span>
            <button
              class="icon-button"
              title={t("Next page")}
              aria-label={t("Next page")}
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
            >
              <ArrowRight size={ICON.button} />
            </button>
          </div>
        </div>
      </section>
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
