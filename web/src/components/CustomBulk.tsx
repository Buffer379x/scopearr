import { AutoTagMark, autoTagHint } from "./AutoTagMark";
import { confirmDeletion } from "../confirmation";
import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { t, useI18n } from "../i18n";
import type { CustomSelection } from "../types";
import { Modal } from "./Modal";
import { count } from "../ui";
export function CustomBulk({
  query,
  settings,
  single = false,
  close,
  saved,
}: {
  query: string;
  settings?: import("../types").Settings | null;
  single?: boolean;
  close: () => void;
  saved: (total: number) => Promise<void>;
}) {
  useI18n();
  const [selection, setSelection] = useState<CustomSelection | null>(null),
    [changes, setChanges] = useState<Record<string, boolean>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    api<CustomSelection>("custom-selection?" + query)
      .then(setSelection)
      .catch((e) => setError(e.message));
  }, [query]);
  return (
    <Modal
      title={t("Custom tags")}
      close={() => {
        if (!busy) close();
      }}
    >
      {selection && (
        <p class="quiet">
          {t(
            single
              ? "Changes apply only to this file."
              : "Changes apply to all {count} matching files, across every page.",
            {
              count: selection?.total || 0,
            },
          )}
        </p>
      )}
      <p class="quiet">
        {t("Automatically detected tags can return on the next sync.")}
      </p>

      {!selection && !error && <p role="status">{t("Loading …")}</p>}
      {selection && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              Object.values(changes).some((v) => !v) &&
              !(await confirmDeletion(
                t(
                  single
                    ? "Remove selected tags from this file?"
                    : "Remove selected tags from all {count} matching files?",
                  {
                    count: selection.total,
                  },
                ),
              ))
            )
              return;
            setBusy(true);
            setError("");
            try {
              const result = await api<{ total: number }>(
                "custom-selection",
                "PUT",
                { query, changes },
              );
              await saved(result.total);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <p class="quiet">
            {t(
              "Imported series tags apply to the entire series. Auto-tags are managed by their service.",
            )}
          </p>
          <div class="custom-tag-options">
            {selection.tags.map((tag) => {
              const id = String(tag.id),
                n = selection.counts[id] || 0,
                changed = Object.hasOwn(changes, id),
                checked = changed
                  ? changes[id]
                  : selection.total > 0 && n === selection.total,
                mixed = !changed && n > 0 && n < selection.total;
              return (
                <label class="check-field">
                  <input
                    type="checkbox"
                    disabled={busy || tag.protected}
                    title={
                      tag.protected ? autoTagHint(tag, settings) : undefined
                    }
                    checked={checked}
                    aria-checked={mixed ? "mixed" : checked}
                    ref={(el) => {
                      if (el) el.indeterminate = mixed;
                    }}
                    onChange={(e) =>
                      setChanges({ ...changes, [id]: e.currentTarget.checked })
                    }
                  />
                  <span>
                    <AutoTagMark tag={tag} settings={settings} />
                    {tag.displayName || tag.name}
                  </span>
                  <small>
                    {count(n)} / {count(selection.total)}
                  </small>
                </label>
              );
            })}
          </div>
          {!selection.tags.length && (
            <p>{t("Create custom tags in Settings first.")}</p>
          )}
          <div class="modal-actions">
            <button
              type="button"
              class="button"
              disabled={busy}
              onClick={close}
            >
              {t("Cancel")}
            </button>
            <button
              type="submit"
              class="primary"
              disabled={
                busy || !selection.total || !Object.keys(changes).length
              }
            >
              {t("Apply")}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
