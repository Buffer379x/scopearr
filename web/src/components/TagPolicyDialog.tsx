import { useState } from "preact/hooks";
import { t } from "../i18n";
import { labels } from "../ui";
import type { TagTransition, TagDecision } from "../tag-policy";
import { Modal } from "./Modal";
export function TagPolicyDialog({
  changes,
  busy,
  close,
  save,
}: {
  changes: TagTransition[];
  busy: boolean;
  close: () => void;
  save: (choices: Record<string, TagDecision>) => Promise<void>;
}) {
  const [choices, setChoices] = useState<Record<string, TagDecision>>({});
  const update = (service: string, patch: TagDecision) =>
    setChoices((v) => ({ ...v, [service]: { ...v[service], ...patch } }));
  const complete = changes.every(
    (c) =>
      (!c.needsMode || choices[c.service]?.mode) &&
      (!c.disabled.length || choices[c.service]?.disable),
  );
  return (
    <Modal
      title={t("Confirm tag synchronization changes")}
      close={() => {
        if (!busy) close();
      }}
      className="tag-policy-dialog"
    >
      <p class="quiet">
        {t(
          "Choose how existing tags should be handled before saving. No upstream changes happen until you save.",
        )}
      </p>
      {changes.map((c) => (
        <section class="connection" key={c.service}>
          <h3>{c.name || c.service}</h3>
          {!!c.enabled.length && (
            <p>
              {t("Enabled groups: {groups}", {
                groups: c.enabled.map((k) => labels[k]).join(", "),
              })}
            </p>
          )}
          {!!c.disabled.length && (
            <p>
              {t("Disabled groups: {groups}", {
                groups: c.disabled.map((k) => labels[k]).join(", "),
              })}
            </p>
          )}
          {c.needsMode && (
            <fieldset class="tag-policy-options">
              <legend>{t("Existing assignments")}</legend>
              <label>
                <input
                  type="radio"
                  name={c.service + "-mode"}
                  checked={choices[c.service]?.mode === "add"}
                  disabled={busy}
                  onChange={() => update(c.service, { mode: "add" })}
                />
                {t("Keep and only add")}
              </label>
              <label>
                <input
                  type="radio"
                  name={c.service + "-mode"}
                  checked={choices[c.service]?.mode === "replace"}
                  disabled={busy}
                  onChange={() => update(c.service, { mode: "replace" })}
                />
                {t("Overwrite assignments")}
              </label>
              <small>
                {t(
                  "Overwrite replaces existing assignments with the selected groups, including groups previously kept while disabled.",
                )}
              </small>
            </fieldset>
          )}
          {!!c.disabled.length && (
            <fieldset class="tag-policy-options">
              <legend>{t("Disabled groups")}</legend>
              <label>
                <input
                  type="radio"
                  name={c.service + "-disable"}
                  checked={choices[c.service]?.disable === "keep"}
                  disabled={busy}
                  onChange={() => update(c.service, { disable: "keep" })}
                />
                {t("Keep their existing tags")}
              </label>
              <label>
                <input
                  type="radio"
                  name={c.service + "-disable"}
                  checked={choices[c.service]?.disable === "delete"}
                  disabled={busy}
                  onChange={() => update(c.service, { disable: "delete" })}
                />
                {t(
                  c.media
                    ? "Remove tag assignments"
                    : "Remove assignments and unused definitions",
                )}
              </label>
              <small>
                {t(
                  "Kept groups remain untouched during future syncs. Shared tags and definitions still referenced by other service settings are retained. Cleanup needs an enabled, reachable service.",
                )}
              </small>
            </fieldset>
          )}
        </section>
      ))}
      <div class="dialog-actions">
        <button type="button" class="button" disabled={busy} onClick={close}>
          {t("Cancel")}
        </button>
        <button
          type="button"
          class={
            Object.values(choices).some(
              (c) => c.mode === "replace" || c.disable === "delete",
            )
              ? "button danger-button"
              : "button primary"
          }
          disabled={busy || !complete}
          onClick={() => void save(choices)}
        >
          {t("Confirm and save")}
        </button>
      </div>
    </Modal>
  );
}
