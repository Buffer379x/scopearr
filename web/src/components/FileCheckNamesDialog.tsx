import { useState } from "preact/hooks";
import { t, useI18n } from "../i18n";
import { defaultFileCheckSettings } from "../filecheck";
import type { FileCheckSettings } from "../types";
import { Modal } from "./Modal";
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
  return (
    <Modal wide title={t("Allowed and ignored names")} close={close}>
      <div class="filecheck-rules">
        <label>
          <span>{t("Allowed names")}</span>
          <small class="quiet">
            {t(
              "Never reported as orphaned. One pattern per line; a trailing / matches folders.",
            )}
          </small>
          <textarea
            disabled={disabled}
            rows={12}
            value={allowed}
            onInput={(e) => setAllowed(e.currentTarget.value)}
          />
        </label>
        <label>
          <span>{t("Ignored names")}</span>
          <small class="quiet">{t("Never reported at all.")}</small>
          <textarea
            disabled={disabled}
            rows={12}
            value={ignore}
            onInput={(e) => setIgnore(e.currentTarget.value)}
          />
        </label>
      </div>
      <p class="quiet">{t("Changes apply to the next scan.")}</p>
      <div class="modal-actions">
        <button
          type="button"
          class="button"
          disabled={disabled}
          onClick={() =>
            setAllowed(defaultFileCheckSettings.allowed.join("\n"))
          }
        >
          {t("Reset allowed names")}
        </button>
        <button
          type="button"
          class="button primary"
          disabled={disabled}
          onClick={() => {
            save(lines(allowed), lines(ignore));
            close();
          }}
        >
          {t("Apply")}
        </button>
      </div>
    </Modal>
  );
}
