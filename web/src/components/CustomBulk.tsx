import { AutoTagMark, autoTagHint } from "./AutoTagMark";
import { confirmDeletion, confirmAction } from "../confirmation";
import { useEffect, useRef, useState } from "preact/hooks";
import { Plus } from "lucide-preact";
import { api } from "../api";
import { t, useI18n } from "../i18n";
import type { CustomSelection } from "../types";
import { Modal } from "./Modal";
import { count, ICON } from "../ui";
export function CustomBulk({
  query,
  files,
  settings,
  single = false,
  close,
  saved,
}: {
  query: string;
  files?: import("../types").FileKey[];
  settings?: import("../types").Settings | null;
  single?: boolean;
  close: () => void;
  saved: (total: number) => Promise<void>;
}) {
  useI18n();
  const [selection, setSelection] = useState<CustomSelection | null>(null),
    [changes, setChanges] = useState<Record<string, boolean>>({}),
    [newTags, setNewTags] = useState<{ key: string; name: string }[]>([]),
    [name, setName] = useState(""),
    [nameError, setNameError] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submitting = useRef(false);
  useEffect(() => {
    api<CustomSelection>(
      files ? "custom-selection" : "custom-selection?" + query,
      files ? "POST" : "GET",
      files ? { files } : undefined,
    )
      .then(setSelection)
      .catch((e) => setError(e.message));
  }, [query, JSON.stringify(files)]);
  const limitReached =
    (selection?.tags.length || 0) +
      newTags.filter((tag) => changes[tag.key]).length >=
    128;
  const addTag = () => {
    if (!selection || busy || limitReached) return;
    const trimmed = name.trim();
    if (!trimmed || [...trimmed].length > 80 || /\p{Cc}/u.test(trimmed)) {
      setNameError(t("Enter a tag name between 1 and 80 characters"));
      return;
    }
    const duplicate = selection.tags.find(
      (tag) => tag.name.toLowerCase() === trimmed.toLowerCase(),
    );
    const pending = newTags.find(
      (tag) => tag.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (duplicate || pending) {
      const key = duplicate ? String(duplicate.id) : pending!.key;
      if (!duplicate?.protected)
        setChanges((current) => ({ ...current, [key]: true }));
      setNameError(t("A custom tag with this name already exists"));
      return;
    }
    const key = `new:${newTags.length + 1}`;
    setNewTags((current) => [...current, { key, name: trimmed }]);
    setChanges((current) => ({ ...current, [key]: true }));
    setName("");
    setNameError("");
  };
  const appliedChanges = Object.fromEntries(
    Object.entries(changes).filter(
      ([key, on]) => !key.startsWith("new:") || on,
    ),
  );
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
              : files
                ? "Changes apply to {count} selected files."
                : "Changes apply to all {count} matching files, across every page.",
            { count: selection.total },
          )}
        </p>
      )}
      <p class="quiet">
        {t("Automatically detected tags can return on the next sync.")}
      </p>
      {error && (
        <p class="notice" role="alert">
          {t(error)}
        </p>
      )}
      {!selection && !error && <p role="status">{t("Loading …")}</p>}
      {selection && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (submitting.current || !Object.keys(appliedChanges).length)
              return;
            submitting.current = true;
            setBusy(true);
            setError("");
            try {
              const removing = Object.values(appliedChanges).some((on) => !on);
              if (
                removing &&
                !(await confirmDeletion(
                  t(
                    single
                      ? "Remove selected tags from this file?"
                      : "You are about to remove tags from {count} items.",
                    { count: selection.total },
                  ),
                  false,
                  t("Remove"),
                ))
              )
                return;
              if (
                !removing &&
                selection.total > 1 &&
                !(await confirmAction(
                  t("You are about to change tags for {count} items.", {
                    count: selection.total,
                  }),
                  t("Change"),
                ))
              )
                return;
              const result = await api<{ total: number }>(
                "custom-selection",
                "PUT",
                {
                  query: files ? undefined : query,
                  files,
                  changes: appliedChanges,
                  create: newTags.filter((tag) => changes[tag.key]),
                },
              );
              await saved(result.total);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              submitting.current = false;
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
                <label class="check-field" key={id}>
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
            {newTags.map((tag) => (
              <label class="check-field" key={tag.key}>
                <input
                  type="checkbox"
                  disabled={busy || (!changes[tag.key] && limitReached)}
                  checked={!!changes[tag.key]}
                  onChange={(e) =>
                    setChanges({
                      ...changes,
                      [tag.key]: e.currentTarget.checked,
                    })
                  }
                />
                <span>
                  {tag.name} <em class="cell-hint">{t("New")}</em>
                </span>
              </label>
            ))}
          </div>
          {!selection.tags.length && !newTags.length && (
            <p>{t("No custom tags yet. Add one below.")}</p>
          )}
          <label class="custom-bulk-create">
            <span>{t("New tag")}</span>
            <div class="custom-tag-create-row">
              <input
                value={name}
                maxLength={80}
                placeholder={t("New tag")}
                disabled={busy || limitReached}
                aria-invalid={!!nameError}
                aria-describedby={
                  nameError || limitReached
                    ? "custom-tag-create-help"
                    : undefined
                }
                onInput={(e) => {
                  setName(e.currentTarget.value);
                  setNameError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                }}
              />
              <button
                type="button"
                class="button control-lg"
                disabled={busy || limitReached}
                onClick={addTag}
              >
                <Plus size={ICON.label} />
                {t("Add")}
              </button>
            </div>
            {(nameError || limitReached) && (
              <small id="custom-tag-create-help" role="status">
                {nameError || t("At most 128 custom tags are allowed")}
              </small>
            )}
          </label>
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
                busy || !selection.total || !Object.keys(appliedChanges).length
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
