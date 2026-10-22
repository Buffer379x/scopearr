import { placementMessage } from "../placement-messages";
import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ClipboardList,
  HardDrive,
  Info,
  LoaderCircle,
  Play,
  ScanSearch,
  Search,
  Square,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-preact";
import { api } from "../api";
import { readPreference, writePreference } from "../browser-storage";
import { instancesOf, instanceLabel } from "../instances";
import { t, useI18n } from "../i18n";
import {
  defaultUnraidSettings,
  placementOrderedColumns,
  placementSelection,
  placementQueueIds,
  placementStartable,
  placementStatusLabels,
  placementScanCompleted,
} from "../placement";
import type {
  PlacementActivity,
  PlacementItem,
  PlacementResults,
  Settings,
  UnraidSettings,
  UnraidStatus,
} from "../types";
import { compactBytes as bytes, count } from "../ui";
import { HelpPopover } from "./HelpPopover";
import {
  PlacementDetailDialog,
  PlacementLogDialog,
  PlacementStatusDialog,
  PlacementSummaryDialog,
} from "./PlacementDialogs";

export function DiskPlacementPage({
  settings,
  changed,
  setup,
}: {
  settings: Settings | null;
  changed: () => unknown;
  setup: () => void;
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
  const [collapsed, setCollapsed] = useState(
    readPreference("scopearr-placement-collapsed") === "true",
  );
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [target, setTarget] = useState(""),
    [kind, setKind] = useState(""),
    [order, setOrder] = useState("default"),
    [page, setPage] = useState(1);
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
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [speed, setSpeed] = useState(0);
  const [summary, setSummary] = useState(false),
    [dialog, setDialog] = useState<{
      kind: "details" | "status" | "log";
      item: PlacementItem;
    }>();
  const lastSummary = useRef<string>(),
    sample = useRef({ at: 0, bytes: 0 });
  const limit = settings?.pageSize || 100;
  const reload = () => setRevision((n) => n + 1);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const load = async () => {
      const q = new URLSearchParams({
        q: query,
        status,
        target,
        kind,
        order,
        offset: String((page - 1) * limit),
        limit: String(limit),
      });
      try {
        const [next, unraid, list] = await Promise.all([
          api<PlacementActivity>(
            "placement/scan",
            "GET",
            undefined,
            controller.signal,
          ),
          api<UnraidStatus>(
            "unraid/status",
            "GET",
            undefined,
            controller.signal,
          ),
          api<PlacementResults>(
            "placement/items?" + q,
            "GET",
            undefined,
            controller.signal,
          ),
        ]);
        if (!live) return;
        setActivity(next);
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
        timer = setTimeout(
          load,
          next.scan.running || next.running || next.queued ? 1000 : 10000,
        );
      } catch (e) {
        if (live) {
          setLoading(false);
          if ((e as Error).name !== "AbortError")
            setError((e as Error).message);
          timer = setTimeout(load, 10000);
        }
      }
    };
    timer = setTimeout(load, query ? 180 : 0);
    return () => {
      live = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, status, target, kind, order, page, limit, revision]);
  const scan = activity?.scan,
    active = !!(activity?.queued || activity?.running),
    scanning = !!scan?.running;
  const pages = Math.max(1, Math.ceil(results.total / limit));
  useEffect(() => {
    if (page > pages && !loading) setPage(pages);
  }, [page, pages, loading]);
  const action = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await run();
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const startScan = () =>
    action(async () => {
      if (!options.libraries.length)
        throw new Error(t("Select at least one library"));
      if (
        !Number.isInteger(options.reserveGiB) ||
        options.reserveGiB < 0 ||
        options.reserveGiB > 10240
      )
        throw new Error(
          t("Free space reserve must be between 0 and 10240 GiB"),
        );
      await api("placement/scan", "POST", {
        libraries: libraries.every((c) => options.libraries.includes(c.id))
          ? []
          : options.libraries,
        seriesGrouping: options.seriesGrouping,
        excludedDisks: options.excludedDisks,
        reserveGiB: options.reserveGiB,
        verifyChecksum: options.verifyChecksum,
      });
      setSelected([]);
      changed();
    });
  const start = (ids?: number[]) =>
    action(async () => {
      const list = await api<PlacementResults>(
        "placement/items?" +
          new URLSearchParams({ limit: "1", order: ids ? order : "default" }),
      );
      await api("placement/start", "POST", {
        ids: placementQueueIds(list.selectableIds, ids),
      });
      setSelected([]);
    });
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
    setTarget(value);
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
    pickTarget(value);
  };
  const selection = placementSelection(results.items, selected),
    columns = placementOrderedColumns(settings);
  const counts = activity?.counts || scan?.counts || {};
  const eligible = counts.several ?? scan?.several ?? 0;
  const updateOptions = (patch: Partial<UnraidSettings>) =>
    setOptions((current) => ({ ...current, ...patch }));
  const toggle = (values: string[], value: string, checked: boolean) =>
    checked ? [...values, value] : values.filter((v) => v !== value);
  const showItemStatus = (item: PlacementItem) =>
    placementStatusLabels[item.jobStatus || item.scanStatus] ||
    item.jobStatus ||
    item.scanStatus;
  return (
    <>
      <section class="library-intro">
        <h1>{t("Disk placement")}</h1>
        <span>
          {t("{count} items on several disks", { count: count(eligible) })}
        </span>
      </section>
      <section
        class={
          "filter-panel filter-panel-v2 placement-panel" +
          (collapsed ? " collapsed" : "")
        }
        aria-label={t("Disk placement scan")}
      >
        <div class="filter-always-visible">
          <label class="search-field">
            <span>{t("Title or folder")}</span>
            <div class="input-wrap">
              <Search size={17} />
              <input
                value={query}
                placeholder={t("Search title or folder …")}
                onInput={(e) => {
                  setQuery(e.currentTarget.value);
                  setPage(1);
                }}
              />
            </div>
          </label>
          <div class="preset-toolbar">
            <button
              class="button primary"
              disabled={busy || (!scanning && (active || !service?.ready))}
              title={active ? t("Finish or cancel moves first") : undefined}
              onClick={() =>
                scanning
                  ? action(() => api("placement/scan", "DELETE"))
                  : startScan()
              }
            >
              {scanning ? <Square size={16} /> : <ScanSearch size={16} />}
              {t(scanning ? "Cancel scan" : "Scan")}
            </button>
          </div>
          <div class="filter-icon-tools">
            <button
              class="icon-button"
              disabled={!scan?.finishedAt}
              aria-label={t("Summary")}
              title={t("Summary")}
              onClick={() => setSummary(true)}
            >
              <ClipboardList size={18} />
            </button>
            <button
              class="icon-button"
              aria-label={t(
                collapsed ? "Show scan options" : "Hide scan options",
              )}
              aria-expanded={!collapsed}
              aria-controls="placement-scan-options"
              onClick={() => {
                const next = !collapsed;
                setCollapsed(next);
                writePreference("scopearr-placement-collapsed", String(next));
              }}
            >
              <ChevronDown size={18} class={collapsed ? "" : "rotated"} />
            </button>
          </div>
        </div>
        {!collapsed && (
          <div class="filter-groups" id="placement-scan-options">
            <section class="attribute-filters">
              <h3>{t("Libraries")}</h3>
              <div class="placement-options">
                {libraries.map((c) => (
                  <label class="check-field" key={c.id}>
                    <input
                      type="checkbox"
                      disabled={busy || scanning || active}
                      checked={options.libraries.includes(c.id)}
                      onChange={(e) =>
                        updateOptions({
                          libraries: toggle(
                            options.libraries,
                            c.id,
                            e.currentTarget.checked,
                          ),
                        })
                      }
                    />
                    {instanceLabel(c)}
                  </label>
                ))}
                {!libraries.length && (
                  <p class="quiet">{t("No enabled libraries")}</p>
                )}
              </div>
            </section>
            <section class="attribute-filters">
              <h3>{t("Series")}</h3>
              <div class="placement-options">
                {(
                  [
                    ["series", "Group by series"],
                    ["season", "Group by season folder"],
                  ] as const
                ).map(([value, label]) => (
                  <label class="check-field" key={value}>
                    <input
                      type="radio"
                      name="placement-series-grouping"
                      disabled={busy || scanning || active}
                      checked={options.seriesGrouping === value}
                      onChange={() => updateOptions({ seriesGrouping: value })}
                    />
                    {t(label)}
                  </label>
                ))}
              </div>
            </section>
            <section class="attribute-filters">
              <h3>{t("Target disks")}</h3>
              <div class="placement-options">
                {service?.disks.map((d) => (
                  <div class="placement-disk-option" key={d.name}>
                    {d.kind === "array" ? (
                      <label class="check-field">
                        <input
                          type="checkbox"
                          disabled={busy || scanning || active}
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
            </section>
            <section class="attribute-filters">
              <h3>{t("Safety")}</h3>
              <div class="placement-options">
                <label>
                  {t("Free space to keep on the target disk (GiB)")}
                  <input
                    type="number"
                    min="0"
                    max="10240"
                    step="1"
                    disabled={busy || scanning || active}
                    value={
                      Number.isFinite(options.reserveGiB)
                        ? options.reserveGiB
                        : ""
                    }
                    onInput={(e) =>
                      updateOptions({
                        reserveGiB: e.currentTarget.valueAsNumber,
                      })
                    }
                  />
                </label>
                <label class="check-field">
                  <input
                    type="checkbox"
                    disabled={busy || scanning || active}
                    checked={options.verifyChecksum}
                    onChange={(e) =>
                      updateOptions({ verifyChecksum: e.currentTarget.checked })
                    }
                  />
                  {t("Verify copies with checksums (slower)")}
                </label>
                <p class={service?.state.warning ? "notice" : "quiet"}>
                  {t(
                    service?.state.warning ||
                      (service?.state.mover
                        ? "Mover is running"
                        : service?.state.parity
                          ? "Parity operation in progress"
                          : "Mover and parity are idle"),
                  )}
                </p>
              </div>
            </section>
          </div>
        )}
        <div class="filter-footer placement-footer" aria-live="polite">
          {scanning ? (
            <div class="placement-overall-progress">
              <progress max={scan?.total || 1} value={scan?.checked || 0} />
              <span>
                {t("Scanning {disk} · {checked} of {total} items", {
                  disk: scan?.disk || "…",
                  checked: count(scan?.checked || 0),
                  total: count(scan?.total || 0),
                })}
              </span>
            </div>
          ) : active ? (
            <div class="placement-overall-progress">
              <progress
                max={activity?.totalBytes || 1}
                value={activity?.bytesDone || 0}
              />
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
            </div>
          ) : (
            <>
              <div class="placement-chips">
                {[
                  ["several", "Several disks", eligible],
                  [
                    "waiting_for_mover",
                    "Waiting for mover",
                    counts.waiting_for_mover || 0,
                  ],
                  ["conflict", "Conflict", counts.conflict || 0],
                  ["no_space", "No space", counts.no_space || 0],
                  ["errors", "Errors", counts.errors || counts.error || 0],
                  ["moved", "Moved", activity?.moved || 0],
                ].map(([value, label, n]) => (
                  <button
                    class={"filter-chip" + (status === value ? " active" : "")}
                    aria-pressed={status === value}
                    onClick={() => {
                      setStatus(status === value ? "" : String(value));
                      setPage(1);
                    }}
                  >
                    {t(String(label))} {count(Number(n))}
                  </button>
                ))}
              </div>
              {scan?.finishedAt && (
                <span class="quiet">
                  {t("Last scan")}:{" "}
                  {new Date(scan.finishedAt).toLocaleString(locale)} (
                  {Math.ceil(scan.duration)} s)
                </span>
              )}
            </>
          )}
          <HelpPopover
            label="Scan information"
            text="Reads folder metadata only. Disks may spin up if their directory data is not cached."
          />
        </div>
      </section>
      {(error || scan?.error) && (
        <p class="notice" role="alert">
          {error || placementMessage(scan?.error || "", t)}
        </p>
      )}
      <section class="library-section">
        <div class="results-heading">
          <div>
            <h2>
              {t("Items on several disks")} <span>{count(results.total)}</span>
              {loading && <LoaderCircle size={14} class="spin" />}
            </h2>
          </div>
          <div class="results-tools">
            <button
              class="button"
              disabled={busy || scanning || !selected.length}
              onClick={() => start(selected)}
            >
              <Play size={15} />
              {t("Start selected")}
              {selected.length ? ` (${count(selected.length)})` : ""}
            </button>
            <button
              class="button"
              disabled={busy || scanning || !eligible}
              onClick={() => start()}
            >
              <Play size={15} />
              {t("Start all")}
            </button>
            {active && (
              <button
                class="button"
                disabled={busy}
                onClick={() => action(() => api("placement/cancel", "POST"))}
              >
                <Square size={15} />
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
              <Trash2 size={15} />
              {t("Remove moved items")}
            </button>
          </div>
        </div>
        <div class="results-tools placement-result-filters">
          {target && (
            <button class="filter-chip active" onClick={() => pickTarget("")}>
              {t("Target")}: {target}
              <X size={13} />
            </button>
          )}
          <label>
            {t("Kind")}
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.currentTarget.value);
                setPage(1);
              }}
            >
              <option value="">{t("All")}</option>
              <option value="small_files">{t("Small files")}</option>
              <option value="media_files">{t("Media files")}</option>
            </select>
          </label>
          <label>
            {t("Sort")}
            <select
              value={order}
              onChange={(e) => {
                setOrder(e.currentTarget.value);
                setPage(1);
              }}
            >
              <option value="default">{t("Ready, kind, move size")}</option>
              <option value="title">{t("Title")}</option>
              <option value="size">{t("Size")}</option>
              <option value="move">{t("Move size")}</option>
              <option value="target">{t("Target")}</option>
            </select>
          </label>
        </div>
        {!service?.ready && !loading ? (
          <div class="empty-state">
            <HardDrive size={28} />
            <h3>{t("Set up Unraid disk placement")}</h3>
            <p>
              {t(
                service?.error ||
                  "Enable the MKVToolNix service and configure path mappings first",
              )}
            </p>
            <button class="button" onClick={setup}>
              {t("Set up service")}
            </button>
          </div>
        ) : !results.items.length && !loading ? (
          <div class="empty-state">
            <HardDrive size={28} />
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
          </div>
        ) : (
          <div class="table-wrap placement-table-wrap">
            <table class="placement-table">
              <thead>
                <tr>
                  {columns.map((field) => (
                    <th scope="col" key={field}>
                      {field === "select" ? (
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
                      ) : field !== "actions" ? (
                        t(
                          (
                            {
                              title: "Title",
                              service: "Service",
                              size: "Size",
                              disks: "Disks",
                              target: "Target",
                              move: "Move",
                              kind: "Kind",
                              status: "Status",
                              progress: "Progress",
                            } as Record<string, string>
                          )[field],
                        )
                      ) : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.items.map((item) => {
                  const cells: Record<string, JSX.Element> = {
                    select: (
                      <td>
                        <input
                          type="checkbox"
                          aria-label={t("Select item {title}", {
                            title: item.title,
                          })}
                          disabled={
                            busy || scanning || !placementStartable(item)
                          }
                          checked={
                            placementStartable(item) &&
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
                      <td>
                        <div class="info-actions">
                          <button
                            class="row-icon info-action"
                            aria-label={t("Details for {title}", {
                              title: item.title,
                            })}
                            title={t("Details")}
                            onClick={() => detail(item, "details")}
                          >
                            <Info size={15} />
                          </button>
                          <button
                            class="row-icon info-action"
                            aria-label={t("Start item {title}", {
                              title: item.title,
                            })}
                            title={t("Start")}
                            disabled={
                              busy || scanning || !placementStartable(item)
                            }
                            onClick={() => start([item.id])}
                          >
                            <Play size={15} />
                          </button>
                          <button
                            class="row-icon info-action"
                            aria-label={t("Log for {title}", {
                              title: item.title,
                            })}
                            title={t("Log")}
                            onClick={() => detail(item, "log")}
                          >
                            <SquareTerminal size={15} />
                          </button>
                        </div>
                      </td>
                    ),
                    title: (
                      <td>
                        <strong>
                          {item.season === -1
                            ? item.title.replace(
                                / · Series folder$/,
                                " · " + t("Series folder"),
                              )
                            : item.title}
                        </strong>
                        <small class="placement-relative">{item.rel}</small>
                      </td>
                    ),
                    service: <td>{item.instance}</td>,
                    size: <td>{bytes(item.totalBytes)}</td>,
                    disks: (
                      <td>
                        <div class="tag-list">
                          {Object.entries(item.disks || {}).map(
                            ([disk, data]) => (
                              <span
                                class={
                                  "tag" +
                                  (disk === item.target
                                    ? " placement-target-tag"
                                    : "")
                                }
                              >
                                {disk} · {bytes(data.bytes)}
                              </span>
                            ),
                          )}
                        </div>
                      </td>
                    ),
                    target: <td>{item.target || "—"}</td>,
                    move: (
                      <td>
                        {bytes(item.moveBytes)}
                        <small class="placement-relative">
                          {t("{count} files", { count: count(item.moveFiles) })}
                        </small>
                      </td>
                    ),
                    kind: (
                      <td>
                        {item.kind && (
                          <span class="tag">
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
                      <td>
                        <button
                          class={
                            "mux-status-button mux-status-" +
                            (item.jobStatus || item.scanStatus)
                          }
                          title={
                            item.message
                              ? placementMessage(item.message, t)
                              : undefined
                          }
                          onClick={() => detail(item, "status")}
                        >
                          {t(showItemStatus(item))}
                        </button>
                        {item.message?.startsWith("Waiting:") && (
                          <small class="placement-relative">
                            {placementMessage(item.message, t)}
                          </small>
                        )}
                      </td>
                    ),
                    progress: (
                      <td>
                        <div class="mux-progress">
                          <progress max="100" value={item.progress} />
                          <span>{item.progress} %</span>
                          {item.jobStatus === "running" && (
                            <small>{bytes(speed)}/s</small>
                          )}
                        </div>
                      </td>
                    ),
                  };
                  return (
                    <tr key={item.id}>
                      {columns.map((field) => cells[field])}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div class="pagination">
          <span>{t("{count} items", { count: count(results.total) })}</span>
          <div>
            <button
              class="icon-button"
              aria-label={t("Previous page")}
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              <ArrowLeft size={16} />
            </button>
            <span>{t("Page {page} / {pages}", { page, pages })}</span>
            <button
              class="icon-button"
              aria-label={t("Next page")}
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
            >
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </section>
      {summary && scan?.finishedAt && (
        <PlacementSummaryDialog
          scan={scan}
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
          close={() => setDialog(undefined)}
        />
      )}
      {dialog?.kind === "status" && (
        <PlacementStatusDialog
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
