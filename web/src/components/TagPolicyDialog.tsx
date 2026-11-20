import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { t, useI18n } from "../i18n";
import { labels } from "../ui";
import type { TagTransition, TagDecision } from "../tag-policy";
import { Modal, ModalFoot } from "./dialog/Modal";

// Confirm tag synchronization changes (Phase 5d, Task 11, E22): a v2 modal
// (md). One section per service with its enabled and disabled groups and
// up to two radio groups, each named by its heading, with their hints.
// Confirm and save waits until every service has its choices and turns
// danger with an overwrite or a removal; busy locks everything, Close and
// Escape too.
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
  useI18n();
  const [choices, setChoices] = useState<Record<string, TagDecision>>({});
  const update = (service: string, patch: TagDecision) =>
    setChoices((v) => ({ ...v, [service]: { ...v[service], ...patch } }));
  const complete = changes.every(
    (c) =>
      (!c.needsMode || choices[c.service]?.mode) &&
      (!c.disabled.length || choices[c.service]?.disable),
  );
  const radio = (
    service: string,
    group: "mode" | "disable",
    value: TagDecision["mode"] | TagDecision["disable"],
    label: string,
  ) => (
    <label class="v2-ff-check" key={value}>
      <input
        type="radio"
        class="v2-check"
        name={service + "-" + group}
        checked={choices[service]?.[group] === value}
        disabled={busy}
        onChange={() => update(service, { [group]: value })}
      />
      {label}
    </label>
  );
  const group = (
    service: string,
    kind: "mode" | "disable",
    title: string,
    children: ComponentChildren,
  ) => {
    const id = "tag-policy-" + service + "-" + kind;
    return (
      <div class="v2-modal-sec" role="radiogroup" aria-labelledby={id}>
        <h4 class="v2-modal-h" id={id}>
          {title}
        </h4>
        {children}
      </div>
    );
  };
  return (
    <Modal
      id="tagPolicy"
      title={t("Confirm tag synchronization changes")}
      close={close}
      closeDisabled={busy}
      foot={
        <ModalFoot>
          <button type="button" class="v2-btn" disabled={busy} onClick={close}>
            {t("Cancel")}
          </button>
          <button
            type="button"
            class={
              Object.values(choices).some(
                (c) => c.mode === "replace" || c.disable === "delete",
              )
                ? "v2-btn v2-btn--danger"
                : "v2-btn v2-btn--primary"
            }
            disabled={busy || !complete}
            onClick={() => void save(choices)}
          >
            {t("Confirm and save")}
          </button>
        </ModalFoot>
      }
    >
      <div class="v2-modal-stack">
        <p class="v2-modal-hint">
          {t(
            "Choose how existing tags should be handled before saving. No upstream changes happen until you save.",
          )}
        </p>
        {changes.map((c) => (
          <section class="v2-modal-sec" key={c.service}>
            <h3 class="v2-modal-h">{c.name || c.service}</h3>
            {!!c.enabled.length && (
              <p class="v2-modal-text">
                {t("Enabled groups: {groups}", {
                  groups: c.enabled.map((k) => labels[k]).join(", "),
                })}
              </p>
            )}
            {!!c.disabled.length && (
              <p class="v2-modal-text">
                {t("Disabled groups: {groups}", {
                  groups: c.disabled.map((k) => labels[k]).join(", "),
                })}
              </p>
            )}
            {c.needsMode &&
              group(
                c.service,
                "mode",
                t("Existing assignments"),
                <>
                  {radio(c.service, "mode", "add", t("Keep and only add"))}
                  {radio(
                    c.service,
                    "mode",
                    "replace",
                    t("Overwrite assignments"),
                  )}
                  <p class="v2-modal-hint">
                    {t(
                      "Keep and only add preserves tags from other sources. Technical tags set by Scopearr are updated when a file changes.",
                    )}
                  </p>
                  <p class="v2-modal-hint">
                    {t(
                      "Overwrite replaces existing assignments with the selected groups, including groups previously kept while disabled.",
                    )}
                  </p>
                </>,
              )}
            {!!c.disabled.length &&
              group(
                c.service,
                "disable",
                t("Disabled groups"),
                <>
                  {radio(
                    c.service,
                    "disable",
                    "keep",
                    t("Keep their existing tags"),
                  )}
                  {radio(
                    c.service,
                    "disable",
                    "delete",
                    t(
                      c.media
                        ? "Remove tag assignments"
                        : "Remove assignments and unused definitions",
                    ),
                  )}
                  <p class="v2-modal-hint">
                    {t(
                      "Kept groups remain untouched during future syncs. Shared tags and definitions still referenced by other service settings are retained. Cleanup needs an enabled, reachable service.",
                    )}
                  </p>
                </>,
              )}
          </section>
        ))}
      </div>
    </Modal>
  );
}
