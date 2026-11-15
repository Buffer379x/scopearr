import { ICON } from "../ui";
import { Check, LoaderCircle } from "lucide-preact";
import { useContext, useState } from "preact/hooks";
import { confirmDiscard } from "../confirmation";
import { t, useI18n } from "../i18n";
import { sameRuleDraft } from "../rule-draft";
import {
  recognitionFields as fields,
  recognitionModes as modes,
} from "../recognition-options";
import type { RecognitionRule } from "../types";
import { CustomTagNames, labels } from "../ui";
import { Modal, ModalFoot } from "./dialog/Modal";
import { check } from "./settings/Check";
import { field, fieldGroup } from "./settings/Field";

const FORM = "rule-editor-form";

// Edit recognition rule (Phase 5d, Task 11, E22): a v2 modal (lg). Every
// 1.7.0 field in form#rule-editor-form, two columns of fields (one on a
// phone), the help line and Advanced matching as a disclosure; Save rule
// is the form's submit in the foot. Closing with a change asks "Discard
// your unsaved rule changes?"; while it asks or saves, Close, Escape and
// both buttons are off.
export function RuleEditor({
  rule,
  busy,
  close,
  save,
}: {
  rule: RecognitionRule;
  busy: boolean;
  close: () => void;
  save: (rule: RecognitionRule) => Promise<void>;
}) {
  useI18n();
  const customNames = useContext(CustomTagNames);
  const [draft, setDraft] = useState(rule);
  const [asking, setAsking] = useState(false);
  const requestClose = async () => {
    if (busy || asking) return;
    if (sameRuleDraft([draft], [rule])) {
      close();
      return;
    }
    setAsking(true);
    const accepted = await confirmDiscard(
      t("Discard your unsaved rule changes?"),
    );
    setAsking(false);
    if (accepted) close();
  };
  const patch = (value: Partial<RecognitionRule>) =>
    setDraft({ ...draft, ...value });
  return (
    <Modal
      id="ruleEditor"
      title={t("Edit recognition rule")}
      close={() => void requestClose()}
      closeDisabled={busy || asking}
      foot={
        <ModalFoot>
          <button
            type="button"
            class="v2-btn"
            disabled={busy || asking}
            onClick={() => void requestClose()}
          >
            {t("Cancel")}
          </button>
          <button
            type="submit"
            class="v2-btn v2-btn--primary"
            form={FORM}
            disabled={busy || asking}
            aria-busy={busy}
          >
            {busy ? (
              <LoaderCircle class="spin" size={ICON.label} />
            ) : (
              <Check size={ICON.label} />
            )}
            {t(busy ? "Saving rule…" : "Save rule")}
          </button>
        </ModalFoot>
      }
    >
      <form
        id={FORM}
        class="v2-modal-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!busy) await save(draft);
        }}
      >
        <div class="v2-form">
          {field("rule-name", t("Name"), (a) => (
            <input
              {...a}
              class="v2-input"
              disabled={busy}
              required
              maxLength={80}
              value={draft.name}
              onInput={(e) => patch({ name: e.currentTarget.value })}
            />
          ))}
          {field("rule-field", t("Attribute"), (a) => (
            <select
              {...a}
              class="v2-select"
              disabled={busy}
              value={draft.field}
              onChange={(e) =>
                patch({
                  field: e.currentTarget.value,
                  comparisonPattern:
                    e.currentTarget.value === "audio"
                      ? draft.comparisonPattern
                      : "",
                  mode:
                    e.currentTarget.value === "custom" ? "direct" : draft.mode,
                  value:
                    e.currentTarget.value === "custom"
                      ? Object.keys(customNames)[0] || ""
                      : draft.value,
                })
              }
            >
              {fields.map((value) => (
                <option key={value} value={value}>
                  {labels[value]}
                </option>
              ))}
            </select>
          ))}
          {field("rule-match", t("Match type"), (a) => (
            <select
              {...a}
              class="v2-select"
              disabled={busy}
              value={draft.match}
              onChange={(e) =>
                patch({
                  match: e.currentTarget.value as RecognitionRule["match"],
                })
              }
            >
              <option value="token">{t("Token")}</option>
              <option value="regex">{t("Regular expression")}</option>
            </select>
          ))}
          {field(
            "rule-pattern",
            t("Pattern"),
            (a) => (
              <input
                {...a}
                class="v2-input"
                disabled={busy}
                required
                maxLength={500}
                value={draft.pattern}
                onInput={(e) => patch({ pattern: e.currentTarget.value })}
              />
            ),
            {
              hint:
                draft.match === "token"
                  ? t(
                      "Tokens match literal text, including separators such as .Ultra.HD. Use a regular expression for alternate spellings or separators.",
                    )
                  : undefined,
            },
          )}
          {field("rule-value", t("Result"), (a) =>
            draft.field === "custom" ? (
              <select
                {...a}
                class="v2-select"
                disabled={busy}
                required
                value={draft.value}
                onChange={(e) => patch({ value: e.currentTarget.value })}
              >
                <option value="">{t("Select a custom tag")}</option>
                {Object.entries(customNames).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                {...a}
                class="v2-input"
                disabled={busy}
                required
                maxLength={80}
                value={draft.value}
                onInput={(e) => patch({ value: e.currentTarget.value })}
              />
            ),
          )}
          {field(
            "rule-mode",
            t("Mode"),
            (a) => (
              <select
                {...a}
                class="v2-select"
                value={draft.mode}
                disabled={busy || draft.field === "custom"}
                onChange={(e) =>
                  patch({
                    mode: e.currentTarget.value as RecognitionRule["mode"],
                  })
                }
              >
                {Object.entries(modes).map(([mode, label]) => (
                  <option key={mode} value={mode}>
                    {t(label)}
                  </option>
                ))}
              </select>
            ),
            {
              hint: t(
                "Priority applies within each mode. Only if missing keeps existing results; use Explicit override to replace an already recognized value.",
              ),
            },
          )}
          {field("rule-priority", t("Priority"), (a) => (
            <input
              {...a}
              class="v2-input"
              disabled={busy}
              required
              type="number"
              min={0}
              max={10000}
              step={1}
              value={draft.priority}
              onInput={(e) =>
                patch({ priority: Number(e.currentTarget.value) })
              }
            />
          ))}
          {fieldGroup(
            <>
              {check(
                t("Enabled"),
                draft.enabled,
                (enabled) => patch({ enabled }),
                busy,
              )}
              {check(
                t("Tag color"),
                draft.tag !== false,
                (tag) => patch({ tag }),
                busy,
              )}
            </>,
          )}
        </div>
        <p class="v2-modal-hint">
          {t(
            "Matching is case-insensitive. Tokens require separators. Regular expressions use Go RE2 syntax; capture groups can be referenced with $1 in the result.",
          )}
        </p>
        <details class="v2-modal-more">
          <summary>{t("Advanced matching")}</summary>
          <div class="v2-modal-form">
            {draft.field === "audio" &&
              field(
                "rule-codecs",
                t("Equivalent metadata codecs (regular expression)"),
                (a) => (
                  <input
                    {...a}
                    class="v2-input"
                    disabled={busy}
                    maxLength={500}
                    value={draft.comparisonPattern || ""}
                    placeholder="^DTS(?:-HD(?: MA)?)?$"
                    onInput={(e) =>
                      patch({ comparisonPattern: e.currentTarget.value })
                    }
                  />
                ),
                {
                  hint: t(
                    "Matching codec names are equivalent for warnings only. Clear this expression to compare strictly; displayed audio tracks stay unchanged.",
                  ),
                },
              )}
            {field(
              "rule-unless",
              t("Skip when filename matches this expression"),
              (a) => (
                <input
                  {...a}
                  class="v2-input"
                  disabled={busy}
                  maxLength={500}
                  value={draft.unless || ""}
                  onInput={(e) => patch({ unless: e.currentTarget.value })}
                />
              ),
            )}
            {fieldGroup(
              <>
                {check(
                  t("Consume matched text before subsequent rules"),
                  draft.consume,
                  (consume) => patch({ consume }),
                  busy,
                )}
                <p class="v2-modal-hint">
                  {t(
                    "Useful for audio variants such as DTS-HD before DTS. Applies within the same attribute and mode.",
                  )}
                </p>
              </>,
            )}
          </div>
        </details>
        {busy && (
          <p class="v2-notice v2-modal-line" role="status" aria-live="polite">
            <LoaderCircle class="spin" size={ICON.close} />
            <span>
              {t(
                "Saving rule and updating the cached library. Keep this dialog open until saving completes.",
              )}
            </span>
          </p>
        )}
      </form>
    </Modal>
  );
}
