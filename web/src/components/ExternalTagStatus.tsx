import { ICON } from "../ui";
import { useState } from "preact/hooks";
import { RefreshCw } from "lucide-preact";
import type { Status } from "../types";
import { t } from "../i18n";
import { api } from "../api";
import { notify } from "../notifications";
import { date } from "../ui";
import { confirmDeletion } from "../confirmation";

type TagState = NonNullable<Status["tagSync"]>[string];
type Conflict = NonNullable<TagState["importConflicts"]>[number];

// The external tag check of one service: Check tags now and the two
// answers to a conflict, the pending removal of a tag asking first.
function useTagCheck(service: string) {
  const [busy, setBusy] = useState(false);
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
  const resolve = async (c: Conflict, resolution: "local" | "remote") => {
    if (
      resolution === "local" &&
      !c.desired &&
      !(await confirmDeletion(
        t("Apply the pending removal of {tag} in the service?", {
          tag: c.label,
        }),
      ))
    )
      return;
    void act({ mediaId: c.mediaId, remoteId: c.remoteId, resolution });
  };
  return { busy, act, resolve };
}

// The External tags value of a service status (E9): the last check and
// the pending edits, one line.
export function externalTagText(state: TagState | undefined): string {
  const line = t("Last tag check: {date}", {
    date: date(state?.lastTagCheck),
  });
  return state?.importPending
    ? line +
        " · " +
        t(
          "{count} pending external edits. Sending edits requires outbound Custom tag synchronization.",
          { count: state.importPending },
        )
    : line;
}

// The check in the External tags section of a library card (ruling P4):
// Check tags now, then a warning per conflict with both answers.
export function ExternalTagCheck({
  service,
  status,
  disabled,
}: {
  service: string;
  status?: Status;
  disabled: boolean;
}) {
  const { busy, act, resolve } = useTagCheck(service);
  const state = status?.tagSync?.[service];
  return (
    <>
      <div class="v2-svc-actions">
        <button
          type="button"
          class="v2-btn v2-btn--sm"
          disabled={disabled || busy || state?.running}
          onClick={() => void act({})}
        >
          <RefreshCw size={ICON.label} />
          {t("Check tags now")}
        </button>
      </div>
      {(state?.importConflicts || []).map((c) => (
        <div
          class="v2-notice v2-notice--warn v2-notice--setup"
          key={c.mediaId + ":" + c.remoteId}
        >
          <span class="v2-notice-body">
            {t("Tag conflict: {tag} · entry {id}", {
              tag: c.label,
              id: c.mediaId,
            })}
          </span>
          <div class="v2-svc-actions">
            {(["local", "remote"] as const).map((resolution) => (
              <button
                type="button"
                class="v2-btn v2-btn--sm"
                key={resolution}
                disabled={busy}
                onClick={() => resolve(c, resolution)}
              >
                {t(
                  resolution === "local"
                    ? "Keep local change"
                    : "Use service state",
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

// The 1.7.0 block of System → Info, until Phase 5c rebuilds it.
export function ExternalTagStatus({
  service,
  status,
  disabled,
}: {
  service: string;
  status: Status;
  disabled: boolean;
}) {
  const { busy, act, resolve } = useTagCheck(service);
  const state = status.tagSync?.[service];
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
        <RefreshCw size={ICON.label} />
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
              onClick={() => resolve(c, "local")}
            >
              {t("Keep local change")}
            </button>
            <button
              type="button"
              class="button"
              disabled={busy}
              onClick={() => resolve(c, "remote")}
            >
              {t("Use service state")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
