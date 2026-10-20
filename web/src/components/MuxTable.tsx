import type { JSX } from "preact";
import {
  SlidersHorizontal,
  Terminal,
  Trash2,
  CircleStop,
  X,
} from "lucide-preact";
import type { MuxJob } from "../types";
import { t } from "../i18n";
import { bytes } from "../ui";
import {
  muxColumnLabels,
  muxStartable,
  muxSelection,
  effectiveMuxStatus,
  muxStatusLabels,
} from "../mux-spec";
import { MuxStatusTag } from "./MuxStatusDialog";
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
}: {
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
}) {
  const selection = muxSelection(jobs, selected);
  return (
    <div class="table-wrap">
      <table class="mux-table">
        <thead>
          <tr>
            {columns.map((field) => (
              <th scope="col" key={field}>
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
                      setSelected(e.currentTarget.checked ? selection.ids : [])
                    }
                  />
                ) : !["buttons", "actions"].includes(field) ? (
                  t(muxColumnLabels[field])
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => {
            const can = muxStartable(j),
              active = ["queued", "running"].includes(j.status);
            const actionLabel = active
              ? "Cancel mux job: {filename}"
              : j.status === "succeeded"
                ? "Remove mux job: {filename}"
                : "Delete mux job: {filename}";
            const cells: Record<string, JSX.Element> = {
              select: (
                <td>
                  <input
                    type="checkbox"
                    aria-label={t("Select job {id}", { id: j.id })}
                    title={
                      can
                        ? undefined
                        : t(
                            j.status === "draft"
                              ? "Save the mux options first"
                              : active
                                ? "Job is running"
                                : "Job cannot be started",
                          )
                    }
                    checked={can && selected.includes(j.id)}
                    disabled={busy || !can}
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
                <td>
                  <div class="info-actions">
                    <button
                      class="row-icon info-action"
                      aria-label={t("Mux options")}
                      title={t("Mux options")}
                      onClick={() => options(j)}
                    >
                      <SlidersHorizontal size={15} />
                    </button>
                    <button
                      class="row-icon info-action"
                      aria-label={t("Terminal")}
                      title={t("Terminal")}
                      onClick={() => terminal(j)}
                    >
                      <Terminal size={15} />
                    </button>
                  </div>
                </td>
              ),
              filename: (
                <td class="title-cell">
                  <b>{j.sourceName}</b>
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
                <td>
                  <button
                    class="mux-status-button"
                    aria-label={t("Status: {label}. Show checks", {
                      label: t(muxStatusLabels[effectiveMuxStatus(j)]),
                    })}
                    onClick={() => status(j)}
                  >
                    <MuxStatusTag job={j} />
                  </button>
                </td>
              ),
              progress: (
                <td>
                  {["running", "queued", "succeeded"].includes(j.status) ? (
                    <div class="mux-progress">
                      <progress
                        max={100}
                        value={
                          j.status === "queued"
                            ? undefined
                            : j.status === "succeeded"
                              ? 100
                              : j.progress
                        }
                        aria-label={t("Mux progress")}
                      />
                      <small>
                        {j.status === "queued"
                          ? "—"
                          : (j.status === "succeeded" ? 100 : j.progress) +
                            " %"}
                      </small>
                    </div>
                  ) : (
                    "—"
                  )}
                </td>
              ),
              actions: (
                <td>
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
                          : t(actionLabel, { filename: j.sourceName })
                      }
                      aria-label={t(actionLabel, { filename: j.sourceName })}
                      onClick={() => remove(j)}
                    >
                      {active ? (
                        j.status === "running" ? (
                          <CircleStop size={16} />
                        ) : (
                          <X size={16} />
                        )
                      ) : (
                        <Trash2 size={16} />
                      )}
                    </button>
                  )}
                </td>
              ),
            };
            return (
              <tr key={j.id} title={j.title}>
                {columns.map((field) => cells[field])}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
