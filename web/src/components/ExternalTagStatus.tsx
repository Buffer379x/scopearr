import { useState } from "preact/hooks";
import { RefreshCw } from "lucide-preact";
import type { Status } from "../types";
import { t } from "../i18n";
import { api } from "../api";
import { notify } from "../notifications";
import { date } from "../ui";
import { confirmDeletion } from "../confirmation";
export function ExternalTagStatus({
  service,
  status,
  disabled,
}: {
  service: string;
  status: Status;
  disabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const state = status.tagSync?.[service];
  async function act(body: object) {
    setBusy(true);
    try {
      await api("tag-import", "POST", { service, ...body });
      notify(t("Tag check queued."));
    } catch {
    } finally {
      setBusy(false);
    }
  }
  return (
    <div class="tag-sync-status">
      <b>{t("External tag check")}</b>
      <p class="quiet">
        {t("Last tag check: {date}", { date: date(state?.lastTagCheck) })}
      </p>
      {!!state?.importPending && (
        <p class="quiet">
          {t(
            "{count} pending external edits. Sending edits requires outbound Custom tag synchronization.",
            { count: state.importPending },
          )}
        </p>
      )}
      <button
        type="button"
        class="button"
        disabled={disabled || busy || state?.running}
        onClick={() => void act({})}
      >
        <RefreshCw size={15} />
        {t("Check tags now")}
      </button>
      {(state?.importConflicts || []).map((c) => (
        <div class="external-tag-conflict" key={c.mediaId + ":" + c.remoteId}>
          <p>
            {t("Tag conflict: {tag} · entry {id}", {
              tag: c.label,
              id: c.mediaId,
            })}
          </p>
          <div class="row-actions">
            <button
              type="button"
              class="button"
              disabled={busy}
              onClick={async () => {
                if (
                  !c.desired &&
                  !(await confirmDeletion(
                    t("Apply the pending removal of {tag} in the service?", {
                      tag: c.label,
                    }),
                  ))
                )
                  return;
                void act({
                  mediaId: c.mediaId,
                  remoteId: c.remoteId,
                  resolution: "local",
                });
              }}
            >
              {t("Keep local change")}
            </button>
            <button
              type="button"
              class="button"
              disabled={busy}
              onClick={() =>
                void act({
                  mediaId: c.mediaId,
                  remoteId: c.remoteId,
                  resolution: "remote",
                })
              }
            >
              {t("Use service state")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
