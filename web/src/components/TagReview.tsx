import { ICON } from "../ui";
import { instanceLabel, isMediaType } from "../instances";
import { useEffect, useState } from "preact/hooks";
import { RefreshCw, Trash2 } from "lucide-preact";
import { api } from "../api";
import { t, useI18n } from "../i18n";
import type { Connection as ServiceConfig, ServiceInstance } from "../types";
import { Modal, ModalFoot } from "./dialog/Modal";
import { TableScroll } from "./dialog/TableScroll";
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
    <details class="v2-modal-more">
      <summary>
        {t("{count} affected titles", { count: row.assignments })}
      </summary>
      <ul class="v2-modal-list">
        {targets.map((target) => (
          <li key={target.id}>{target.title || "#" + target.id}</li>
        ))}
      </ul>
      {row.assignments > 10 && (
        <div class="v2-modal-line">
          <button
            type="button"
            class="v2-btn v2-btn--sm"
            disabled={busy || page <= 1}
            onClick={() => void load(page - 1)}
          >
            {t("Previous page")}
          </button>
          <button
            type="button"
            class="v2-btn v2-btn--sm"
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
// Review tag removals (Phase 5d, Task 11, E22): a v2 modal (lg, fixed).
// The hint, an error as an alert notice, one section per service: while
// the preview loads its heading and a placeholder line (screen readers
// hear "Loading …"), then its table (Tag, Origin, Assignments to remove,
// Definition; card rows on a phone) with the affected titles of a tag
// behind a disclosure, in pages. The foot holds Cancel, Refresh preview
// and Confirm changes (danger); a failure resets the preview, so Confirm
// changes waits for a new one. Busy locks Close and Escape.
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
  const label = (service: string) =>
    instanceLabel(
      requests.find((request) => request.service === service)?.config || {
        id: service,
      },
    );
  return (
    <Modal
      id="tagReview"
      title={t("Review tag removals")}
      close={close}
      closeDisabled={busy}
      foot={
        <ModalFoot>
          <button type="button" class="v2-btn" disabled={busy} onClick={close}>
            {t("Cancel")}
          </button>
          <button
            type="button"
            class="v2-btn"
            disabled={busy}
            onClick={() => void load()}
          >
            <RefreshCw size={ICON.label} />
            {t("Refresh preview")}
          </button>
          <button
            type="button"
            class="v2-btn v2-btn--danger"
            disabled={busy || !previews}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await confirm(
                  Object.fromEntries(
                    previews!.map((p) => [p.service, p.token]),
                  ),
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
        </ModalFoot>
      }
    >
      <div class="v2-modal-stack">
        <p class="v2-modal-hint">
          {t(
            "No tags are changed until you confirm. Changed remote data requires a new preview.",
          )}
        </p>
        {error && (
          <p class="v2-notice v2-notice--error" role="alert">
            {error}
          </p>
        )}
        {!previews && !error && (
          <>
            {requests.map((request) => (
              <section
                class="v2-modal-sec"
                key={request.service}
                aria-hidden="true"
              >
                <h3 class="v2-modal-h">{label(request.service)}</h3>
                <p class="v2-modal-hint">—</p>
              </section>
            ))}
            <span class="v2-sr-only" role="status">
              {t("Loading …")}
            </span>
          </>
        )}
        {previews?.map((preview) => {
          const request = requests.find((r) => r.service === preview.service);
          return (
            <section class="v2-modal-sec" key={preview.service}>
              <h3 class="v2-modal-h">{label(preview.service)}</h3>
              {!preview.rows.length ? (
                <p class="v2-modal-text">{t("No tags will be removed.")}</p>
              ) : (
                <TableScroll label={label(preview.service)}>
                  <table class="v2-table">
                    <thead>
                      <tr>
                        <th scope="col">{t("Tag")}</th>
                        <th scope="col">{t("Origin")}</th>
                        <th scope="col">{t("Assignments to remove")}</th>
                        <th scope="col">{t("Definition")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row) => (
                        <tr key={row.id} class="v2-row">
                          <td data-label={t("Tag")}>{row.label}</td>
                          <td data-label={t("Origin")}>
                            {t(
                              row.origin === "scopearr"
                                ? "Created by Scopearr"
                                : row.origin === "existing"
                                  ? "Already present"
                                  : "Origin not recorded",
                            )}
                          </td>
                          <td data-label={t("Assignments to remove")}>
                            {row.assignments ? (
                              <Targets
                                request={request!}
                                preview={preview}
                                row={row}
                              />
                            ) : (
                              "0"
                            )}
                          </td>
                          <td data-label={t("Definition")}>
                            {t(
                              isMediaType(request?.config.type)
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
                </TableScroll>
              )}
            </section>
          );
        })}
      </div>
    </Modal>
  );
}
