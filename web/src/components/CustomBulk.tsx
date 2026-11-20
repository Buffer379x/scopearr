import { Plus, Settings as Gear } from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";
import { confirmAction, confirmDeletion } from "../confirmation";
import { t, useI18n } from "../i18n";
import type { CustomSelection, CustomTag, Settings } from "../types";
import { count, ICON } from "../ui";
import { autoTagHint } from "./list/CustomTag";
import { AutoTagDialog } from "./dialog/AutoTagDialog";
import { Modal, ModalFoot } from "./dialog/Modal";
import { field } from "./settings/Field";

const FORM = "custom-tags-form";

// The gear beside a locked auto tag; it opens the explanation in a dialog.
export function AutoTagMark({
  tag,
  settings,
}: {
  tag: CustomTag;
  settings?: Settings | null;
}) {
  const [open, setOpen] = useState(false);
  if (!tag.protected) return null;
  const hint = autoTagHint(tag, settings);
  return (
    <>
      <button
        type="button"
        class="v2-ff-auto"
        title={hint}
        aria-label={hint}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Gear size={ICON.button} />
      </button>
      {open && <AutoTagDialog hint={hint} close={() => setOpen(false)} />}
    </>
  );
}
// Placeholder values until the selection answers (no “Loading …” line).
const PLACEHOLDERS = [0, 1, 2, 3, 4, 5];

// Custom tags (Phase 5d, E11): a fixed modal that sets the custom tags of
// one file, a selection or every matching file. Its scope sentence (its
// line reserved until the selection answers), the hints and an error; the
// tags in the CheckField look (label.v2-ff-opt pills with their count
// n / total), mixed where only some items have the tag, an auto tag locked
// with its explanation and auto mark; a new tag through the field “New tag”
// (Enter or Add; a duplicate picks the existing tag; 1–80 characters, at
// most 128 tags); Apply asks before removing or changing more than one
// item, and an error keeps the dialog open.
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
  const submitForm = async (e: Event) => {
    e.preventDefault();
    if (!selection || submitting.current || !Object.keys(appliedChanges).length)
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
      const result = await api<{ total: number }>("custom-selection", "PUT", {
        query: files ? undefined : query,
        files,
        changes: appliedChanges,
        create: newTags.filter((tag) => changes[tag.key]),
      });
      await saved(result.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const createHint =
    nameError || (limitReached ? t("At most 128 custom tags are allowed") : "");
  const imported = (
    <p class="v2-modal-hint">
      {t(
        "Imported series tags apply to the entire series. Auto-tags are managed by their service.",
      )}
    </p>
  );
  return (
    <Modal
      id="customTags"
      title={t("Custom tags")}
      close={close}
      closeDisabled={busy}
      foot={
        <ModalFoot>
          <button type="button" class="v2-btn" disabled={busy} onClick={close}>
            {t("Cancel")}
          </button>
          <button
            type="submit"
            form={FORM}
            class="v2-btn v2-btn--primary"
            disabled={
              busy || !selection?.total || !Object.keys(appliedChanges).length
            }
          >
            {t("Apply")}
          </button>
        </ModalFoot>
      }
    >
      <div class="v2-modal-sec">
        <p class="v2-modal-hint">
          {selection
            ? t(
                single
                  ? "Changes apply only to this file."
                  : files
                    ? "Changes apply to {count} selected files."
                    : "Changes apply to all {count} matching files, across every page.",
                { count: selection.total },
              )
            : "\u00a0"}
        </p>
        <p class="v2-modal-hint">
          {t("Automatically detected tags can return on the next sync.")}
        </p>
        {error && (
          <p class="v2-notice v2-notice--error" role="alert">
            {t(error)}
          </p>
        )}
      </div>
      {selection ? (
        <form
          id={FORM}
          class="v2-modal-sec v2-modal-form"
          onSubmit={submitForm}
        >
          {imported}
          {selection.tags.length || newTags.length ? (
            <div class="v2-ff-list">
              {selection.tags.map((tag) => {
                const id = String(tag.id),
                  n = selection.counts[id] || 0,
                  changed = Object.hasOwn(changes, id),
                  checked = changed
                    ? changes[id]
                    : selection.total > 0 && n === selection.total,
                  mixed = !changed && n > 0 && n < selection.total;
                return (
                  <label class="v2-ff-opt" key={id}>
                    <input
                      type="checkbox"
                      class="v2-check"
                      disabled={busy || !!tag.protected}
                      title={
                        tag.protected ? autoTagHint(tag, settings) : undefined
                      }
                      checked={checked}
                      aria-checked={mixed ? "mixed" : checked}
                      ref={(el) => {
                        if (el) el.indeterminate = mixed;
                      }}
                      onChange={(e) =>
                        setChanges({
                          ...changes,
                          [id]: e.currentTarget.checked,
                        })
                      }
                    />
                    <AutoTagMark tag={tag} settings={settings} />
                    {tag.displayName || tag.name}
                    <span class="v2-ff-n">
                      {count(n)} / {count(selection.total)}
                    </span>
                  </label>
                );
              })}
              {newTags.map((tag) => (
                <label class="v2-ff-opt" key={tag.key}>
                  <input
                    type="checkbox"
                    class="v2-check"
                    disabled={busy || (!changes[tag.key] && limitReached)}
                    checked={!!changes[tag.key]}
                    onChange={(e) =>
                      setChanges({
                        ...changes,
                        [tag.key]: e.currentTarget.checked,
                      })
                    }
                  />
                  {tag.name}
                  <span class="v2-ff-n">{t("New")}</span>
                </label>
              ))}
            </div>
          ) : (
            <p class="v2-modal-hint">
              {t("No custom tags yet. Add one below.")}
            </p>
          )}
          {field(
            "custom-tag-new",
            t("New tag"),
            (a) => (
              <div class="v2-modal-row">
                <input
                  {...a}
                  class="v2-input"
                  value={name}
                  maxLength={80}
                  placeholder={t("New tag")}
                  disabled={busy || limitReached}
                  aria-invalid={!!nameError}
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
                  class="v2-btn"
                  disabled={busy || limitReached}
                  onClick={addTag}
                >
                  <Plus size={ICON.label} />
                  {t("Add")}
                </button>
              </div>
            ),
            {
              hint: createHint ? (
                <span role="status">{createHint}</span>
              ) : undefined,
            },
          )}
        </form>
      ) : (
        !error && (
          <div class="v2-modal-sec">
            {imported}
            <div class="v2-ff-list" aria-hidden="true">
              {PLACEHOLDERS.map((n) => (
                <span class="v2-ff-ph" key={n} />
              ))}
            </div>
            <span class="v2-sr-only" role="status">
              {t("Loading …")}
            </span>
          </div>
        )
      )}
    </Modal>
  );
}
