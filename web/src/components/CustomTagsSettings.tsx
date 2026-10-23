import { ICON } from "../ui";
import { instanceByID, instanceLabel } from "../instances";
import { AutoTagMark, autoTagHint } from "./AutoTagMark";
import { defaultColor } from "../ui";
import { confirmReset, confirmDeletion } from "../confirmation";
import { useEffect, useRef, useState } from "preact/hooks";
import { Plus, Trash2, LoaderCircle, RotateCcw, Check } from "lucide-preact";
import type { CustomTag, Settings } from "../types";
import { api } from "../api";
import { notify } from "../notifications";
import { t, useI18n } from "../i18n";
export function CustomTagsSettings({
  tags,
  changed,
  onDirty,
  settings,
  setSettings,
  saveColors,
  colorsDirty,
  savingColors,
}: {
  settings: Settings;
  setSettings: (next: Settings) => void;
  saveColors: () => void;
  colorsDirty: boolean;
  savingColors: boolean;
  tags: CustomTag[];
  changed: () => Promise<void>;
  onDirty: (value: boolean) => void;
}) {
  useI18n();
  const [drafts, setDrafts] = useState<CustomTag[]>(structuredClone(tags));
  const baseline = useRef<CustomTag[]>(structuredClone(tags));
  const pending = useRef(false);
  const [name, setName] = useState(""),
    [busy, setBusy] = useState(false);
  const dirty =
    !!name.trim() ||
    JSON.stringify(baseline.current) !== JSON.stringify(drafts);
  useEffect(() => onDirty(dirty || busy), [dirty, busy]);
  useEffect(() => () => onDirty(false), []);
  useEffect(() => {
    if (!dirty && !busy) {
      baseline.current = structuredClone(tags);
      setDrafts(structuredClone(tags));
    }
  }, [JSON.stringify(tags)]);
  const color = (id: number, value?: string, text?: string) => {
    const key = "custom:" + id;
    const colors = { ...settings.tagColors };
    const texts = { ...settings.tagTextColors };
    if (value) colors[key] = value;
    else if (text === undefined) {
      delete colors[key];
      delete texts[key];
    }
    if (text !== undefined) {
      if (text) texts[key] = text;
      else delete texts[key];
    }
    setSettings({ ...settings, tagColors: colors, tagTextColors: texts });
  };
  const commit = async (
    next: CustomTag[],
    changedID?: number,
  ): Promise<boolean> => {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    const previous = baseline.current;
    try {
      const saved = await api<CustomTag[]>("custom-tags/batch", "PUT", {
        original: previous,
        tags: next,
      });
      baseline.current = saved;
      setDrafts((current) =>
        saved.map((tag) => {
          const draft = current.find((r) => r.id === tag.id),
            old = previous.find((r) => r.id === tag.id);
          return tag.id !== changedID &&
            draft &&
            old &&
            draft.displayName !== old.displayName
            ? { ...tag, displayName: draft.displayName }
            : tag;
        }),
      );
      notify(t("Settings saved."));
      try {
        await changed();
      } catch {
        /* The committed snapshot stays authoritative if a refresh fails. */
      }
      return true;
    } catch {
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const add = async () => {
    const value = name.trim();
    if (!value || pending.current) return;
    if (
      baseline.current.some(
        (tag) => tag.name.toLocaleLowerCase() === value.toLocaleLowerCase(),
      )
    ) {
      notify(t("A custom tag with this name already exists"), "warning");
      return;
    }
    if (await commit([...baseline.current, { id: -1, name: value }], -1))
      setName("");
  };
  const rename = async (tag: CustomTag, value: string) => {
    const old = baseline.current.find((r) => r.id === tag.id);
    if (!old || value === (old.displayName || old.name)) return;
    if (
      !value.trim() ||
      !(await commit(
        baseline.current.map((r) =>
          r.id === tag.id ? { ...r, displayName: value.trim() } : r,
        ),
        tag.id,
      ))
    ) {
      setDrafts((current) =>
        current.map((r) =>
          r.id === tag.id
            ? {
                ...r,
                displayName:
                  baseline.current.find((b) => b.id === tag.id)?.displayName ||
                  "",
              }
            : r,
        ),
      );
    }
  };
  return (
    <section class="custom-tags-settings" aria-label={t("Custom tags")}>
      <header class="settings-section-heading">
        <h2>{t("Custom tags")}</h2>
        <button
          type="button"
          class="primary"
          disabled={savingColors || !colorsDirty}
          onClick={saveColors}
        >
          <Check size={ICON.label} />
          {t("Save colors")}
        </button>
        <p class="quiet">
          {t(
            "Create tags here, assign them in your library or use them in filename rules.",
          )}
        </p>
      </header>
      <section class="settings-card">
        <form
          class="custom-tag-create"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <label>
            {t("Tag name")}
            <input
              required
              maxLength={80}
              value={name}
              disabled={busy}
              onInput={(e) => setName(e.currentTarget.value)}
            />
          </label>
          <button type="submit" class="button" disabled={busy || !name.trim()}>
            {busy ? (
              <LoaderCircle size={ICON.label} class="spin" />
            ) : (
              <Plus size={ICON.label} />
            )}{" "}
            {t("Add tag")}
          </button>
        </form>
        <p class="quiet">
          {t("Names are saved when you press Enter or leave the field.")}
        </p>
        <div class="table-wrap color-table-wrap">
          <table class="color-settings-table custom-tags-settings-table">
            <thead>
              <tr>
                <th>{t("Name")}</th>
                <th>{t("Management")}</th>
                <th>{t("Count")}</th>
                <th>{t("Color")}</th>
                <th>{t("Text")}</th>
                <th>{t("Reset column")}</th>
                <th>{t("Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((tag) => (
                <tr key={tag.id}>
                  <td>
                    <div class="custom-tag-name">
                      <AutoTagMark tag={tag} settings={settings} />
                      <input
                        aria-label={t("Tag name: {name}", { name: tag.name })}
                        maxLength={80}
                        required
                        value={tag.displayName || tag.name}
                        disabled={busy}
                        onInput={(e) => {
                          const value = e.currentTarget.value;
                          setDrafts((current) =>
                            current.map((r) =>
                              r.id === tag.id
                                ? { ...r, displayName: value }
                                : r,
                            ),
                          );
                        }}
                        onBlur={(e) => void rename(tag, e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            e.currentTarget.blur();
                          }
                        }}
                      />
                    </div>
                  </td>
                  <td
                    title={
                      tag.protected ? autoTagHint(tag, settings) : undefined
                    }
                  >
                    {tag.protected
                      ? [
                          ...new Set(
                            tag.rules?.map((r) => r.split(" · ")[0]) || [],
                          ),
                        ]
                          .map(
                            (s) =>
                              instanceLabel(
                                instanceByID(settings, s) || { id: s },
                              ) + " Auto-Tag",
                          )
                          .join(" / ")
                      : t(
                          tag.localRule
                            ? "Scopearr rule"
                            : tag.sources?.length
                              ? "Shared"
                              : "Manual",
                        )}
                  </td>
                  <td class="tag-link-count">{tag.count || 0}</td>
                  <td>
                    <input
                      type="color"
                      aria-label={t("Color for {value}", { value: tag.name })}
                      value={
                        settings.tagColors["custom:" + tag.id] ||
                        defaultColor("custom", String(tag.id))
                      }
                      onInput={(e) => color(tag.id, e.currentTarget.value)}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      class="icon-button tag-text-color color-action"
                      aria-label={t("Text color for {value}", {
                        value: tag.name,
                      })}
                      title={t(
                        settings.tagTextColors["custom:" + tag.id] === "#000000"
                          ? "Black"
                          : settings.tagTextColors["custom:" + tag.id] ===
                              "#ffffff"
                            ? "White"
                            : "Automatic",
                      )}
                      onClick={() =>
                        color(
                          tag.id,
                          undefined,
                          settings.tagTextColors["custom:" + tag.id] ===
                            "#000000"
                            ? "#ffffff"
                            : settings.tagTextColors["custom:" + tag.id] ===
                                "#ffffff"
                              ? ""
                              : "#000000",
                        )
                      }
                    >
                      <span>A</span>
                      <span aria-hidden="true">
                        {settings.tagTextColors["custom:" + tag.id] ===
                        "#000000"
                          ? "●"
                          : settings.tagTextColors["custom:" + tag.id] ===
                              "#ffffff"
                            ? "○"
                            : "◐"}
                      </span>
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      class="icon-button color-action"
                      disabled={
                        !settings.tagColors["custom:" + tag.id] &&
                        !settings.tagTextColors["custom:" + tag.id]
                      }
                      aria-label={t("Default color for {value}", {
                        value: tag.name,
                      })}
                      onClick={async () => {
                        if (
                          await confirmReset(
                            t("Reset background and text colors for {value}?", {
                              value: tag.name,
                            }),
                          )
                        )
                          color(tag.id);
                      }}
                      title={t("Default color for {value}", {
                        value: tag.name,
                      })}
                    >
                      <RotateCcw size={ICON.button} />
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      class="icon-button color-action danger-button"
                      disabled={busy || tag.protected || !!tag.count}
                      aria-label={t("Delete tag: {name}", { name: tag.name })}
                      title={
                        tag.protected
                          ? autoTagHint(tag, settings)
                          : t("Delete tag: {name}", { name: tag.name })
                      }
                      onClick={async () => {
                        if (pending.current) return;
                        if (
                          await confirmDeletion(
                            t(
                              "Delete {name}, its assignments and matching filename rules?",
                              { name: tag.name },
                            ),
                          )
                        )
                          await commit(
                            baseline.current.filter((r) => r.id !== tag.id),
                            tag.id,
                          );
                      }}
                    >
                      <Trash2 size={ICON.button} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!drafts.length && (
            <p class="quiet empty-rules">{t("No custom tags yet.")}</p>
          )}
        </div>
      </section>
    </section>
  );
}
