import { CompactProgress } from "./CompactProgress";
import { toolColumn } from "../tool-table";
import { useToolTableStyle } from "../use-tool-table";
import { ICON } from "../ui";
import type { JSX } from "preact";
import {
  Info,
  LoaderCircle,
  SlidersHorizontal,
  Terminal,
  Trash2,
  Square,
  X,
} from "lucide-preact";
import type { MuxJob } from "../types";
import { t } from "../i18n";
import { bytes } from "../ui";
import {
  muxColumnLabels,
  muxSelection,
  effectiveMuxStatus,
  muxStatusLabels,
  muxStatusShort,
  muxSortable,
} from "../mux-spec";
import { MuxStatusTag } from "./MuxStatusDialog";
import { SortableHeader, type TableSort } from "./SortableHeader";
export function MuxTable({
  jobs,
  names,
  columns,
  selected,
  setSelected,
  busy,
  options,
  terminal,
  status,
  remove,
  sort,
  sortBy,
  removing,
}: {
  removing: Set<number>;
  jobs: MuxJob[];
  names: Record<string, string>;
  columns: string[];
  selected: number[];
  setSelected: (ids: number[]) => void;
  busy: boolean;
  options: (j: MuxJob) => void;
  terminal: (j: MuxJob) => void;
  status: (j: MuxJob) => void;
  remove: (j: MuxJob) => void;
  sort: TableSort;
  sortBy: (field: string) => void;
}) {
  const selection = muxSelection(jobs, selected);
  const tableStyle = useToolTableStyle(
    columns,
    "mux",
    muxColumnLabels,
    muxStatusShort,
  );
  return (
    <div class="table-wrap mux-table-wrap">
      <table class="data-table mux-table tool-table" style={tableStyle}>
        <colgroup>
          {columns.map((field) => (
            <col key={field} class={"tool-col-" + toolColumn(field, "mux")} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((field) =>
              muxSortable.has(field) ? (
                <SortableHeader
                  key={field}
                  label={t(muxColumnLabels[field])}
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
                    "col-control " + (field === "actions" ? "col-remove" : "")
                  }
                >
                  {field === "select" ? (
                    <input
                      type="checkbox"
                      aria-label={t("Select all")}
                      disabled={busy || !selection.ids.length}
                      checked={selection.all}
                      ref={(el) => {
                        if (el) el.indeterminate = selection.partial;
                      }}
                      onChange={(e) =>
                        setSelected(
                          e.currentTarget.checked ? selection.ids : [],
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
          {jobs.map((j) => {
            const active = ["queued", "running"].includes(j.status);
            const actionLabel = active
              ? "Cancel mux job: {filename}"
              : j.status === "succeeded"
                ? "Remove {title} from the list"
                : "Delete mux job: {filename}";
            const cells: Record<string, JSX.Element> = {
              select: (
                <td class="col-control">
                  <input
                    type="checkbox"
                    aria-label={t("Select job {id}", { id: j.id })}
                    checked={selected.includes(j.id)}
                    disabled={busy}
                    onChange={(e) =>
                      setSelected(
                        e.currentTarget.checked
                          ? [...selected, j.id]
                          : selected.filter((id) => id !== j.id),
                      )
                    }
                  />
                </td>
              ),
              buttons: (
                <td class="col-control tool-actions">
                  <div class="info-actions">
                    <button
                      class="row-icon info-action mobile-row-action"
                      title={t("Details")}
                      aria-label={t("Details for {title}", { title: j.title })}
                      onClick={() => status(j)}
                    >
                      <Info size={ICON.row} />
                    </button>
                    <button
                      class="row-icon info-action desktop-row-action"
                      aria-label={t("Mux options for {title}", {
                        title: j.title,
                      })}
                      title={t("Mux options")}
                      onClick={() => options(j)}
                    >
                      <SlidersHorizontal size={ICON.row} />
                    </button>
                    <button
                      class="row-icon info-action desktop-row-action"
                      aria-label={t("Terminal for {title}", { title: j.title })}
                      title={t("Terminal")}
                      onClick={() => terminal(j)}
                    >
                      <Terminal size={ICON.row} />
                    </button>
                  </div>
                </td>
              ),
              filename: (
                <td class="title-cell">
                  <strong class="cell-title" title={j.sourceName}>
                    {j.sourceName}
                  </strong>
                </td>
              ),
              size: <td class="nowrap">{bytes(j.source.size)}</td>,
              origin: (
                <td>
                  {names[j.service] ||
                    (j.service.startsWith("sonarr") ? "Sonarr" : "Radarr")}
                </td>
              ),
              status: (
                <td class="col-status">
                  <button
                    class="status-button"
                    aria-label={t("Status: {label}. Show checks", {
                      label: t(muxStatusLabels[effectiveMuxStatus(j)]),
                    })}
                    onClick={() => status(j)}
                    title={t("Status: {label}. Show checks", {
                      label: t(muxStatusLabels[effectiveMuxStatus(j)]),
                    })}
                  >
                    <MuxStatusTag job={j} />
                  </button>
                </td>
              ),
              progress: (
                <td class="col-progress">
                  <CompactProgress
                    status={j.status}
                    value={j.progress}
                    label={t("Progress")}
                  />
                </td>
              ),
              actions: (
                <td class="col-control col-remove col-control">
                  {j.status !== "needs_attention" && (
                    <button
                      class={
                        "icon-button " +
                        (j.status === "succeeded"
                          ? "success-button"
                          : "danger-button")
                      }
                      disabled={busy || (!active && !!j.backupName)}
                      title={
                        !active && j.backupName
                          ? t(
                              "Delete or keep the preserved backup in the mux options first",
                            )
                          : t(actionLabel, {
                              filename: j.sourceName,
                              title: j.sourceName,
                            })
                      }
                      aria-label={t(actionLabel, {
                        filename: j.sourceName,
                        title: j.sourceName,
                      })}
                      onClick={() => remove(j)}
                    >
                      {removing.has(j.id) ? (
                        <LoaderCircle class="spin" size={ICON.button} />
                      ) : active ? (
                        j.status === "running" ? (
                          <Square size={ICON.button} />
                        ) : (
                          <X size={ICON.button} />
                        )
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
                key={j.id}
                title={j.title}
                class={
                  (removing.has(j.id) ? "row-removing" : "") +
                  (selected.includes(j.id) ? " is-selected" : "")
                }
              >
                {columns.map((field) => cells[field])}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
