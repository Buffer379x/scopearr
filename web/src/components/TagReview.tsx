import { ICON } from "../ui";
import { instanceLabel, isMediaType } from "../instances";
import { useEffect, useState } from "preact/hooks";
import { LoaderCircle, RefreshCw, Trash2 } from "lucide-preact";
import { api } from "../api";
import { t, useI18n } from "../i18n";
import type { Connection as ServiceConfig, ServiceInstance } from "../types";
import { Modal } from "./Modal";
export type TagReviewRequest = {
  service: string;
  config: ServiceConfig;
  instances?: ServiceInstance[];
};
export type TagPreview = {
  service: string;
  token: string;
  approvalRequired: boolean;
  rows: {
    id: string | number;
    label: string;
    origin: string;
    assignments: number;
    deleteDefinition: boolean;
    retained: boolean;
    targets: { id: string | number; title: string }[];
  }[];
  targets?: { id: string | number; title: string }[];
  targetTotal?: number;
  targetPage?: number;
};
function Targets({
  request,
  preview,
  row,
}: {
  request: TagReviewRequest;
  preview: TagPreview;
  row: TagPreview["rows"][number];
}) {
  const [targets, setTargets] = useState(row.targets),
    [page, setPage] = useState(0),
    [busy, setBusy] = useState(false);
  const load = async (next: number) => {
    setBusy(true);
    try {
      const out = await api<TagPreview>("tag-preview", "POST", {
        ...request,
        token: preview.token,
        tagId: row.id,
        page: next,
      });
      setTargets(out.targets || []);
      setPage(next);
    } catch {
    } finally {
      setBusy(false);
    }
  };
  return (
    <details>
      <summary>
        {t("{count} affected titles", { count: row.assignments })}
      </summary>
      <ul>
        {targets.map((target) => (
          <li key={target.id}>{target.title || "#" + target.id}</li>
        ))}
      </ul>
      {row.assignments > 10 && (
        <div class="modal-actions">
          <button
            type="button"
            class="button"
            disabled={busy || page <= 1}
            onClick={() => void load(page - 1)}
          >
            {t("Previous page")}
          </button>
          <button
            type="button"
            class="button"
            disabled={busy || (page > 0 && page * 100 >= row.assignments)}
            onClick={() => void load(page + 1)}
          >
            {t(page ? "Next page" : "Show affected titles")}
          </button>
        </div>
      )}
    </details>
  );
}
export function TagReview({
  requests,
  initial,
  close,
  confirm,
}: {
  requests: TagReviewRequest[];
  initial?: TagPreview[];
  close: () => void;
  confirm: (tokens: Record<string, string>) => Promise<void>;
}) {
  useI18n();
  const [previews, setPreviews] = useState<TagPreview[] | null>(
      initial || null,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = async () => {
    setBusy(true);
    setError("");
    try {
      const values: TagPreview[] = [];
      for (const request of requests)
        values.push(await api<TagPreview>("tag-preview", "POST", request));
      setPreviews(values);
    } catch (e) {
      setError((e as Error).message);
      setPreviews(null);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!initial) void load();
  }, []);
  return (
    <Modal
      title={t("Review tag removals")}
      close={() => {
        if (!busy) close();
      }}
      className="tag-preview-dialog"
    >
      <p class="quiet">
        {t(
          "No tags are changed until you confirm. Changed remote data requires a new preview.",
        )}
      </p>
      {error && <p role="alert">{error}</p>}
      {!previews && !error && (
        <p role="status">
          <LoaderCircle size={ICON.button} class="spin" />
          {t("Loading …")}
        </p>
      )}
      {previews?.map((preview) => (
        <section class="connection" key={preview.service}>
          <h3>
            {instanceLabel(
              requests.find((request) => request.service === preview.service)
                ?.config || { id: preview.service },
            )}
          </h3>
          {!preview.rows.length ? (
            <p>{t("No tags will be removed.")}</p>
          ) : (
            <div class="table-wrap">
              <table class="tag-preview-table">
                <thead>
                  <tr>
                    <th>{t("Tag")}</th>
                    <th>{t("Origin")}</th>
                    <th>{t("Assignments to remove")}</th>
                    <th>{t("Definition")}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.label}</td>
                      <td>
                        {t(
                          row.origin === "scopearr"
                            ? "Created by Scopearr"
                            : row.origin === "existing"
                              ? "Already present"
                              : "Origin not recorded",
                        )}
                      </td>
                      <td>
                        {row.assignments ? (
                          <Targets
                            request={requests.find(
                              (r) => r.service === preview.service,
                            )!}
                            preview={preview}
                            row={row}
                          />
                        ) : (
                          "0"
                        )}
                      </td>
                      <td>
                        {t(
                          isMediaType(
                            requests.find(
                              (request) => request.service === preview.service,
                            )?.config.type,
                          )
                            ? "Not applicable"
                            : row.deleteDefinition
                              ? "Delete unused definition"
                              : row.retained
                                ? "Keep: still referenced"
                                : "Keep definition",
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
      <div class="modal-actions">
        <button type="button" class="button" disabled={busy} onClick={close}>
          {t("Cancel")}
        </button>
        <button
          type="button"
          class="button"
          disabled={busy}
          onClick={() => void load()}
        >
          <RefreshCw size={ICON.label} />
          {t("Refresh preview")}
        </button>
        <button
          type="button"
          class="button danger-button"
          disabled={busy || !previews}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await confirm(
                Object.fromEntries(previews!.map((p) => [p.service, p.token])),
              );
            } catch (e) {
              setError((e as Error).message);
              setPreviews(null);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Trash2 size={ICON.label} />
          {t("Confirm changes")}
        </button>
      </div>
    </Modal>
  );
}
