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
import { Modal } from "./Modal";

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
      title={t("Edit recognition rule")}
      close={() => void requestClose()}
      closeDisabled={busy || asking}
      wide
    >
      <form
        class="rule-editor"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!busy) await save(draft);
        }}
      >
        <label>
          {t("Name")}
          <input
            disabled={busy}
            required
            maxLength={80}
            value={draft.name}
            onInput={(e) => patch({ name: e.currentTarget.value })}
          />
        </label>
        <label>
          {t("Attribute")}
          <select
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
            {fields.map((field) => (
              <option value={field}>{labels[field]}</option>
            ))}
          </select>
        </label>
        <label>
          {t("Match type")}
          <select
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
        </label>
        <label>
          {t("Pattern")}
          <input
            disabled={busy}
            required
            maxLength={500}
            value={draft.pattern}
            aria-label={t("Pattern")}
            aria-describedby={
              draft.match === "token" ? "rule-pattern-help" : undefined
            }
            onInput={(e) => patch({ pattern: e.currentTarget.value })}
          />
          {draft.match === "token" && (
            <small id="rule-pattern-help">
              {t(
                "Tokens match literal text, including separators such as .Ultra.HD. Use a regular expression for alternate spellings or separators.",
              )}
            </small>
          )}
        </label>
        <label>
          {t("Result")}
          {draft.field === "custom" ? (
            <select
              disabled={busy}
              required
              value={draft.value}
              onChange={(e) => patch({ value: e.currentTarget.value })}
            >
              <option value="">{t("Select a custom tag")}</option>
              {Object.entries(customNames).map(([id, name]) => (
                <option value={id}>{name}</option>
              ))}
            </select>
          ) : (
            <input
              disabled={busy}
              required
              maxLength={80}
              value={draft.value}
              onInput={(e) => patch({ value: e.currentTarget.value })}
            />
          )}
        </label>
        <label>
          {t("Mode")}
          <select
            value={draft.mode}
            aria-label={t("Mode")}
            aria-describedby="rule-mode-help"
            disabled={busy || draft.field === "custom"}
            onChange={(e) =>
              patch({ mode: e.currentTarget.value as RecognitionRule["mode"] })
            }
          >
            {Object.entries(modes).map(([mode, label]) => (
              <option value={mode}>{t(label)}</option>
            ))}
          </select>
          <small id="rule-mode-help">
            {t(
              "Priority applies within each mode. Only if missing keeps existing results; use Explicit override to replace an already recognized value.",
            )}
          </small>
        </label>
        <label>
          {t("Priority")}
          <input
            disabled={busy}
            required
            type="number"
            min={0}
            max={10000}
            step={1}
            value={draft.priority}
            onInput={(e) => patch({ priority: Number(e.currentTarget.value) })}
          />
        </label>
        <div class="rule-editor-options">
          <label class="check-field">
            <input
              disabled={busy}
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => patch({ enabled: e.currentTarget.checked })}
            />
            {t("Enabled")}
          </label>
          <label class="check-field">
            <input
              disabled={busy}
              type="checkbox"
              checked={draft.tag !== false}
              onChange={(e) => patch({ tag: e.currentTarget.checked })}
            />
            {t("Tag color")}
          </label>
        </div>
        <p class="quiet rule-editor-help">
          {t(
            "Matching is case-insensitive. Tokens require separators. Regular expressions use Go RE2 syntax; capture groups can be referenced with $1 in the result.",
          )}
        </p>
        <details class="rule-advanced">
          <summary>{t("Advanced matching")}</summary>
          {draft.field === "audio" && (
            <label>
              {t("Equivalent metadata codecs (regular expression)")}
              <input
                disabled={busy}
                maxLength={500}
                value={draft.comparisonPattern || ""}
                placeholder="^DTS(?:-HD(?: MA)?)?$"
                onInput={(e) =>
                  patch({ comparisonPattern: e.currentTarget.value })
                }
              />
              <small>
                {t(
                  "Matching codec names are equivalent for warnings only. Clear this expression to compare strictly; displayed audio tracks stay unchanged.",
                )}
              </small>
            </label>
          )}
          <label>
            {t("Skip when filename matches this expression")}
            <input
              disabled={busy}
              maxLength={500}
              value={draft.unless || ""}
              onInput={(e) => patch({ unless: e.currentTarget.value })}
            />
          </label>
          <label class="check-field">
            <input
              disabled={busy}
              type="checkbox"
              checked={draft.consume}
              onChange={(e) => patch({ consume: e.currentTarget.checked })}
            />
            {t("Consume matched text before subsequent rules")}
          </label>
          <p class="quiet">
            {t(
              "Useful for audio variants such as DTS-HD before DTS. Applies within the same attribute and mode.",
            )}
          </p>
        </details>
        {busy && (
          <div class="rule-save-status" role="status" aria-live="polite">
            <LoaderCircle class="spin" size={ICON.close} />
            <span>
              {t(
                "Saving rule and updating the cached library. Keep this dialog open until saving completes.",
              )}
            </span>
          </div>
        )}
        <div class="modal-actions">
          <button
            type="button"
            class="button"
            disabled={busy || asking}
            onClick={() => void requestClose()}
          >
            {t("Cancel")}
          </button>
          <button
            type="submit"
            class="primary"
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
        </div>
      </form>
    </Modal>
  );
}
