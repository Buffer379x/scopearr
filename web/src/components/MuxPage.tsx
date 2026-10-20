import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import type { MuxJob, MuxSpec } from "../types";
import { t, useI18n } from "../i18n";
import { confirmDeletion } from "../confirmation";
import { cleanMuxName, validateMuxSpec } from "../mux-spec";
import { MuxTrackTable } from "./MuxTrackTable";
import { notify } from "../notifications";
export function MuxPage({
  changed,
  names,
  installed,
}: {
  changed: () => unknown;
  names: Record<string, string>;
  installed: boolean;
}) {
  useI18n();
  const [jobs, setJobs] = useState<MuxJob[]>([]);
  const [drafts, setDrafts] = useState<Record<number, MuxSpec>>({});
  const [revisions, setRevisions] = useState<Record<number, number>>({});
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const load = () => api<MuxJob[]>("mux/jobs").then(setJobs);
  useEffect(() => {
    load().catch(() => {});
    const timer = setInterval(() => {
      if (!document.hidden) load().catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, []);
  const edit = (j: MuxJob, spec: MuxSpec) => {
    setRevisions((r) => ({ ...r, [j.id]: r[j.id] ?? j.revision }));
    setDrafts((d) => ({ ...d, [j.id]: spec }));
  };
  const save = async (j: MuxJob) => {
    const spec = drafts[j.id];
    if (!spec) return j;
    const error = validateMuxSpec(j.source.tracks, spec);
    if (error) throw new Error(t(error));
    const next = await api<MuxJob>("mux/jobs?id=" + j.id, "PUT", {
      spec: { ...spec, outputName: cleanMuxName(spec.outputName) },
      revision: revisions[j.id] ?? j.revision,
    });
    setDrafts((d) => {
      const n = { ...d };
      delete n[j.id];
      setRevisions((r) => {
        const next = { ...r };
        delete next[j.id];
        return next;
      });
      return n;
    });
    return next;
  };
  const action = async (run: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await run();
      await load();
      changed();
    } catch (e) {
      notify((e as Error).message, "error");
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  };
  const start = async (ids: number[]) =>
    action(async () => {
      for (const j of jobs.filter((j) => ids.includes(j.id))) await save(j);
      const result = await api<{ rejected: Record<string, string> }>(
        "mux/run",
        "POST",
        { ids },
      );
      for (const reason of Object.values(result.rejected))
        notify(t(reason), "error");
    });
  const runnable = jobs.filter((j) =>
    ["draft", "failed", "cancelled"].includes(j.status),
  );
  return (
    <section class="mux-page">
      <div class="mux-heading">
        <div>
          <h1>{t("Muxing")}</h1>
          <p class="quiet">
            {t(
              "Jobs run one at a time. Output is always MKV. Originals are removed through the Arr recycle bin after verification.",
            )}
          </p>
        </div>
        <div class="row-actions">
          <button
            class="button"
            disabled={busy || !installed || !runnable.length}
            onClick={() => start(runnable.map((j) => j.id))}
          >
            {t("Start all")}
          </button>
          <button
            class="button"
            disabled={busy || !installed || !selected.length}
            onClick={() => start(selected)}
          >
            {t("Start selected")}
          </button>
          <button
            class="button"
            disabled={busy}
            onClick={() =>
              action(async () => {
                for (const j of jobs.filter(
                  (j) => j.status === "succeeded" && !j.backupName,
                ))
                  await api("mux/jobs?id=" + j.id, "DELETE");
              })
            }
          >
            {t("Remove successful jobs")}
          </button>
        </div>
      </div>
      {!installed && <p class="notice">{t("Install MKVToolNix first")}</p>}
      {!jobs.length && (
        <p class="notice">
          {t("Mark a file in its details to add a mux job.")}
        </p>
      )}
      {jobs.map((j) => {
        const spec = drafts[j.id] || j.spec;
        const locked = [
          "running",
          "queued",
          "succeeded",
          "needs_attention",
        ].includes(j.status);
        return (
          <article class="mux-job" key={j.id}>
            <header>
              <label class="check">
                <input
                  type="checkbox"
                  aria-label={t("Select job {id}", { id: j.id })}
                  checked={selected.includes(j.id)}
                  disabled={busy || locked}
                  onChange={(e) =>
                    setSelected((ids) =>
                      e.currentTarget.checked
                        ? [...ids, j.id]
                        : ids.filter((id) => id !== j.id),
                    )
                  }
                />
                <strong>{j.title}</strong>
              </label>
              <span class="chip">{t(j.status)}</span>
              <span class="quiet">
                {names[j.service] || j.service} ·{" "}
                {(j.source.size / 1073741824).toFixed(2)} GiB
              </span>
            </header>
            <code class="mux-filename">{j.sourceName}</code>
            <div class="mux-checks">
              {(
                [
                  "readable",
                  "writable",
                  "freeSpace",
                  "sizeMatches",
                  "unchanged",
                ] as const
              ).map((key) => (
                <span
                  class={
                    "chip " + (j.check[key] ? "mux-ok" : "mux-check-failed")
                  }
                >
                  {t(
                    {
                      readable: "Readable",
                      writable: "Directory writable",
                      freeSpace: "Enough free space",
                      sizeMatches: "Size matches",
                      unchanged: "File unchanged",
                    }[key],
                  )}
                  : {j.check[key] ? "✓" : "—"}
                </span>
              ))}
            </div>
            <details>
              <summary>{t("Edit tracks and output")}</summary>
              <MuxTrackTable
                job={j}
                spec={spec}
                disabled={locked || busy}
                change={(s) => edit(j, s)}
              />
              <label class="mux-output">
                {t("Output filename")}
                <span>
                  <input
                    value={spec.outputName}
                    disabled={locked || busy}
                    onInput={(e) =>
                      edit(j, { ...spec, outputName: e.currentTarget.value })
                    }
                  />
                  <b>.mkv</b>
                </span>
              </label>
              <label class="check">
                <input
                  type="checkbox"
                  checked={spec.deleteOriginal}
                  disabled={locked || busy}
                  onChange={(e) =>
                    edit(j, {
                      ...spec,
                      deleteOriginal: e.currentTarget.checked,
                    })
                  }
                />
                {t("Delete original after success")}
              </label>
              {!spec.deleteOriginal && (
                <p class="notice">
                  {t(
                    "A matching filename creates a preserved backup. A different filename keeps both media files; Arr chooses which file to import.",
                  )}
                </p>
              )}
              {drafts[j.id] && (
                <div class="row-actions">
                  <button
                    class="button"
                    disabled={busy}
                    onClick={() => action(() => save(j))}
                  >
                    {t("Save")}
                  </button>
                  <button
                    class="button"
                    disabled={busy}
                    onClick={() =>
                      setDrafts((d) => {
                        const n = { ...d };
                        delete n[j.id];
                        setRevisions((r) => {
                          const next = { ...r };
                          delete next[j.id];
                          return next;
                        });
                        return n;
                      })
                    }
                  >
                    {t("Discard")}
                  </button>
                </div>
              )}
            </details>
            <p role="status">{t(j.message || j.status)}</p>
            {j.status === "running" && (
              <progress
                role="progressbar"
                aria-label={t("Mux progress")}
                max={100}
                value={j.progress}
              >
                {j.progress}%
              </progress>
            )}
            {j.log && (
              <details>
                <summary>{t("Warnings and errors")}</summary>
                <pre>
                  {j.log
                    .split("\n")
                    .map((line) => t(line))
                    .join("\n")}
                </pre>
              </details>
            )}
            {j.backupName && (
              <p>
                {t("Preserved backup")}: <code>{j.backupName}</code>
              </p>
            )}
            <footer class="row-actions">
              {!locked && (
                <button
                  class="button"
                  disabled={busy || !installed}
                  onClick={() => start([j.id])}
                >
                  {t(
                    j.status === "failed" || j.status === "cancelled"
                      ? "Retry"
                      : "Start",
                  )}
                </button>
              )}
              {j.status === "needs_review" && (
                <button
                  class="button"
                  disabled={busy}
                  onClick={() =>
                    action(() => api("mux/jobs/identify?id=" + j.id, "POST"))
                  }
                >
                  {t("Identify again")}
                </button>
              )}
              {["running", "queued"].includes(j.status) && (
                <button
                  class="button"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      await confirmDeletion(
                        t(
                          "Cancel this mux job? The original remains unchanged before replacement.",
                        ),
                      )
                    )
                      action(() => api("mux/cancel?id=" + j.id, "POST"));
                  }}
                >
                  {t("Cancel")}
                </button>
              )}
              {j.status === "needs_attention" && (
                <button
                  class="button"
                  disabled={busy}
                  onClick={() =>
                    action(() => api("mux/jobs/rescan?id=" + j.id, "POST"))
                  }
                >
                  {t("Retry rescan")}
                </button>
              )}
              {j.backupName && (
                <button
                  class="button danger-button"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      await confirmDeletion(
                        t("Permanently delete this preserved original backup?"),
                      )
                    )
                      action(() => api("mux/jobs/backup?id=" + j.id, "POST"));
                  }}
                >
                  {t("Delete backup")}
                </button>
              )}
              {!["running", "queued"].includes(j.status) && (
                <button
                  class="button"
                  disabled={busy || !!j.backupName}
                  onClick={() =>
                    action(() => api("mux/jobs?id=" + j.id, "DELETE"))
                  }
                >
                  {t("Remove from list")}
                </button>
              )}
            </footer>
          </article>
        );
      })}
    </section>
  );
}
