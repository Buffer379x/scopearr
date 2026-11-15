import { useState } from "preact/hooks";
import { t, useI18n } from "../i18n";
import { defaultFileCheckSettings } from "../filecheck";
import type { FileCheckSettings } from "../types";
import { Modal, ModalFoot } from "./dialog/Modal";
import { field } from "./settings/Field";

// Allowed and ignored names (Phase 5d, Task 10; E21): a v2 modal (lg) with
// the two lists side by side (one under the other on a narrow body), each a
// field with its hint. Apply hands the trimmed lines to `save` (from
// Settings that writes the settings draft, not a request) and closes.
export function FileCheckNamesDialog({
  options,
  save,
  close,
  disabled = false,
}: {
  options: FileCheckSettings;
  save: (allowed: string[], ignore: string[]) => void;
  close: () => void;
  disabled?: boolean;
}) {
  useI18n();
  const [allowed, setAllowed] = useState(options.allowed.join("\n")),
    [ignore, setIgnore] = useState(options.ignore.join("\n"));
  const lines = (value: string) =>
    value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  const list = (
    id: string,
    label: string,
    hint: string,
    value: string,
    change: (value: string) => void,
  ) =>
    field(
      id,
      label,
      (a) => (
        <textarea
          {...a}
          class="v2-textarea"
          disabled={disabled}
          rows={12}
          value={value}
          onInput={(e) => change(e.currentTarget.value)}
        />
      ),
      { hint },
    );
  return (
    <Modal
      id="fileCheckNames"
      title={t("Allowed and ignored names")}
      close={close}
      foot={
        <ModalFoot>
          <button
            type="button"
            class="v2-btn"
            disabled={disabled}
            onClick={() =>
              setAllowed(defaultFileCheckSettings.allowed.join("\n"))
            }
          >
            {t("Reset allowed names")}
          </button>
          <button
            type="button"
            class="v2-btn v2-btn--primary"
            disabled={disabled}
            onClick={() => {
              save(lines(allowed), lines(ignore));
              close();
            }}
          >
            {t("Apply")}
          </button>
        </ModalFoot>
      }
    >
      <div class="v2-modal-stack">
        <div class="v2-modal-cols">
          <div class="v2-modal-col">
            {list(
              "filecheck-allowed",
              t("Allowed names"),
              t(
                "Never reported as orphaned. One pattern per line; a trailing / matches folders.",
              ),
              allowed,
              setAllowed,
            )}
          </div>
          <div class="v2-modal-col">
            {list(
              "filecheck-ignore",
              t("Ignored names"),
              t("Never reported at all."),
              ignore,
              setIgnore,
            )}
          </div>
        </div>
        <p class="v2-modal-hint">{t("Changes apply to the next scan.")}</p>
      </div>
    </Modal>
  );
}
