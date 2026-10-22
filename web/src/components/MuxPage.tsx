import { useEffect, useState } from "preact/hooks";
import {
  Play,
  Trash2,
  LoaderCircle,
  Scissors,
  ChevronDown,
  Search,
} from "lucide-preact";
import { api } from "../api";
import type { MuxJob, MuxSpec, Settings } from "../types";
import { t, useI18n } from "../i18n";
import { confirmDeletion, confirmDiscard } from "../confirmation";
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
import { filterChips, toggleFilter } from "../tool-filters";
export function MuxPage({
  changed,
  names,
  installed,
  settings,
}: {
  changed: () => unknown;
  names: Record<string, string>;
  installed: boolean;
  settings: Settings | null;
}) {
  useI18n();
  const [filters, setFilters] = useState(() =>
    readToolFilters("scopearr-mux-filters"),
  );
  const [collapsed, setCollapsed] = useState(
    readPreference("scopearr-mux-filter-collapsed") === "true",
  );
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
  const start = (ids: number[]) =>
    action(async () => {
      const result = await api<{ rejected: Record<string, string> }>(
        "mux/run",
        "POST",
        { ids },
      );
      for (const reason of Object.values(result.rejected))
        notify(t(reason), "warning");
      setSelected([]);
    });
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
    await action(() =>
      api(
        active ? "mux/cancel?id=" + j.id : "mux/jobs?id=" + j.id,
        active ? "POST" : "DELETE",
      ),
    );
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
  const visible = muxFilterJobs(ranked, filters);
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
    label: t(muxStatusLabels[value]),
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
  return (
    <>
      <section class="library-intro">
        <h1>{t("Muxing")}</h1>
        <span>{t("{count} jobs", { count: jobs.length })}</span>
      </section>
      <section
        class={
          "filter-panel filter-panel-v2 placement-panel mux-filter-panel" +
          (collapsed ? " collapsed" : "")
        }
        aria-label={t("Mux filters")}
      >
        <div class="filter-always-visible">
          <label class="search-field">
            <span>{t("Filename")}</span>
            <div class="input-wrap">
              <Search size={17} />
              <input
                value={filters.q}
                placeholder={t("Search filename …")}
                onInput={(e) =>
                  setFilters({ ...filters, q: e.currentTarget.value })
                }
              />
            </div>
          </label>
          <div class="filter-icon-tools">
            <button
              class="icon-button"
              aria-label={t(collapsed ? "Show filters" : "Hide filters")}
              aria-expanded={!collapsed}
              aria-controls="mux-filters"
              onClick={() => {
                setCollapsed(!collapsed);
                writePreference(
                  "scopearr-mux-filter-collapsed",
                  String(!collapsed),
                );
              }}
            >
              <ChevronDown size={18} class={collapsed ? "" : "rotated"} />
            </button>
          </div>
        </div>
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
          reset={() =>
            setFilters({ statuses: [], targets: [], kinds: [], q: "" })
          }
        />
      </section>
      {!installed && (
        <div class="connect-card">{t("Install MKVToolNix first")}</div>
      )}
      <section class="library-section">
        <div class="results-heading">
          <div>
            <h2>
              {t("Your mux jobs")} <span>{visible.length}</span>
              {loading && <LoaderCircle size={14} class="spin" />}
            </h2>
          </div>
          <div class="results-tools">
            <button
              class="button"
              disabled={busy || !installed || !selected.length}
              onClick={() => start(selected)}
            >
              <Play size={15} />
              {t("Start selected")}
            </button>
            <button
              class="button"
              disabled={busy || !installed || !jobs.some(muxStartable)}
              title={t("Starts all ready jobs, including filtered ones")}
              onClick={() => start(jobs.filter(muxStartable).map((j) => j.id))}
            >
              <Play size={15} />
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
              <Trash2 size={15} />
              {t("Remove successful jobs")}
            </button>
          </div>
        </div>
        <MuxTable
          jobs={visible}
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
        {!visible.length && (
          <div class="empty-state">
            <Scissors size={28} />
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
      </section>
      {job && dialog?.kind === "options" && (
        <MuxOptionsDialog
          job={job}
          spec={drafts[job.id] || job.spec}
          dirty={!!drafts[job.id]}
          busy={busy}
          edit={(spec) => edit(job, spec)}
          save={() => action(() => save(job))}
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
