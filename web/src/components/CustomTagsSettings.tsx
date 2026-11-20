import { LoaderCircle, Plus, RotateCcw, Tag, Trash2 } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";
import { colorStyle } from "../color";
import { confirmDeletion, confirmReset } from "../confirmation";
import { t, useI18n } from "../i18n";
import { instanceByID, instanceLabel } from "../instances";
import { notify } from "../notifications";
import type { CustomTag as TagEntry, Settings } from "../types";
import {
  HiddenTags,
  ICON,
  TagColors,
  TagTextColors,
  defaultColor,
} from "../ui";
import { autoTagHint, CustomTag } from "./list/CustomTag";
import { HelpTip } from "./list/HelpTip";
import { ListEmpty } from "./list/ListEmpty";
import { RowButton } from "./list/RowButton";
import { TableCard } from "./list/TableCard";
import { TEXT_CYCLE, table } from "./settings/Card";
import { SettingsHeader } from "./settings/SettingsHeader";

// The help on Count, also the reason on a Delete locked by entries.
const COUNT_HELP =
  "Number of linked Scopearr file entries. A tag with entries cannot be deleted; remove its assignments first. Auto-tags stay protected even at zero.";

// Settings → Custom tags (docs/STYLEGUIDE.md, Part 1, 11.4): its own band
// (the SettingsHeader; Save settings saves the colors of the settings
// draft, as in 1.7.0) and the card "Tags", a TableCard without chips and
// footer: its count, the 1.7.0 hint, and in its head the creation (Tag
// name, Add tag, Enter; a duplicate warns) and the help (ruling R-P). A v2
// table of Name (the field "Tag name: {name}", saved on Enter or on leaving
// it, and the CustomTag preview in the draft's colors), Management, Count,
// Color, Text (Automatic → Black → White), Reset and Delete (locked while
// the tag has entries or is protected). Creating, renaming and deleting
// save at once with the 1.7.0 request; the area's own guard (onDirty)
// reports a typed name or an unsaved rename, as in 1.7.0.
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
  tags: TagEntry[];
  changed: () => Promise<void>;
  onDirty: (value: boolean) => void;
}) {
  useI18n();
  const [drafts, setDrafts] = useState<TagEntry[]>(structuredClone(tags));
  const baseline = useRef<TagEntry[]>(structuredClone(tags));
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
  const paint = (id: number, value?: string, text?: string) => {
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
    next: TagEntry[],
    changedID?: number,
  ): Promise<boolean> => {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    const previous = baseline.current;
    try {
      const saved = await api<TagEntry[]>("custom-tags/batch", "PUT", {
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
  const rename = async (tag: TagEntry, value: string) => {
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
  const heads = [
    "Name",
    "Management",
    "Count",
    "Color",
    "Text",
    "Reset",
    "Actions",
  ].map((head) => t(head));
  // The 1.7.0 help: Management as one translated text, the rest by key.
  const help = [
    {
      heading: "Management",
      raw: true,
      text: [
        t(
          "Manual · Created in Scopearr. You assign it in the library with Set tags or in file details.",
        ),
        t(
          "Scopearr rule · An enabled tag rule (Settings → Tag rules) assigns it from the filename. Manual assignments remain possible.",
        ),
        t(
          "Shared · Linked to a tag with the same name in Radarr/Sonarr through tag import. Assignments read from the service and your own assignments stay separate. Sending your changes back requires the outbound Custom group.",
        ),
        t(
          "Radarr/Sonarr Auto-Tag · An automatic tagging rule in Radarr/Sonarr uses this tag. The service controls its assignments; the name and deletion are protected. Display name and colors stay editable.",
        ),
      ].join("\n\n"),
    },
    {
      heading: "Count",
      text: COUNT_HELP,
    },
    {
      heading: "Name",
      text: "Changing the name only changes the display name in Scopearr. Synchronization keeps the original name, so Radarr/Sonarr definitions are not renamed.",
    },
    {
      heading: "Colors",
      text: "Background and text color apply everywhere the tag is shown. Reset restores the automatic colors. Colors are saved with Save.",
    },
    {
      heading: "Creating tags",
      text: "Add tags here or directly in the Set tags dialog. New tags from the dialog appear here automatically.",
    },
  ];
  const rows = drafts.map((tag): [string, ComponentChildren[]] => {
    const key = "custom:" + tag.id;
    const text = settings.tagTextColors[key];
    const color =
      settings.tagColors[key] || defaultColor("custom", String(tag.id));
    const [shown, next] = TEXT_CYCLE[text || ""] ?? ["Automatic", "#000000"];
    const hint = tag.protected ? autoTagHint(tag, settings) : undefined;
    return [
      String(tag.id),
      [
        <span class="v2-table-items v2-set-tag">
          <input
            class="v2-input"
            aria-label={t("Tag name: {name}", { name: tag.name })}
            maxLength={80}
            required
            value={tag.displayName || tag.name}
            disabled={busy}
            onInput={(e) => {
              const value = e.currentTarget.value;
              setDrafts((current) =>
                current.map((r) =>
                  r.id === tag.id ? { ...r, displayName: value } : r,
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
          <CustomTag tag={tag} settings={settings} />
        </span>,
        <span title={hint}>
          {tag.protected
            ? [...new Set(tag.rules?.map((r) => r.split(" · ")[0]) || [])]
                .map(
                  (s) =>
                    instanceLabel(instanceByID(settings, s) || { id: s }) +
                    " Auto-Tag",
                )
                .join(" / ")
            : t(
                tag.localRule
                  ? "Scopearr rule"
                  : tag.sources?.length
                    ? "Shared"
                    : "Manual",
              )}
        </span>,
        tag.count || 0,
        <input
          type="color"
          class="v2-color"
          aria-label={t("Color for {value}", { value: tag.name })}
          value={color}
          onInput={(e) => paint(tag.id, e.currentTarget.value)}
        />,
        <RowButton
          label={
            t("Text color for {value}", { value: tag.name }) + ": " + t(shown)
          }
          title={t(shown)}
          icon={
            <span aria-hidden="true" style={colorStyle(color, text)}>
              Aa
            </span>
          }
          onClick={() => paint(tag.id, undefined, next)}
        />,
        <RowButton
          label={t("Default color for {value}", { value: tag.name })}
          icon={<RotateCcw size={ICON.button} />}
          disabled={!settings.tagColors[key] && !text}
          onClick={async () => {
            if (
              await confirmReset(
                t("Reset background and text colors for {value}?", {
                  value: tag.name,
                }),
              )
            )
              paint(tag.id);
          }}
        />,
        <RowButton
          label={t("Delete tag: {name}", { name: tag.name })}
          title={hint ?? (tag.count ? t(COUNT_HELP) : undefined)}
          icon={<Trash2 size={ICON.button} />}
          tone="danger"
          disabled={busy || tag.protected || !!tag.count}
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
        />,
      ],
    ];
  });
  return (
    <>
      <SettingsHeader
        section="custom"
        save={{
          action: saveColors,
          busy: savingColors,
          disabled: !colorsDirty,
          dirty: colorsDirty,
        }}
      />
      <div class="v2-set">
        <TableCard
          id="custom-tags"
          title={t("Tags")}
          count={drafts.length}
          countTitle={t("Items in the list")}
          busy={busy}
          hint={t("Names are saved when you press Enter or leave the field.")}
          density="comfortable"
          regionLabel={t("Custom tags")}
          bar={
            <form
              class="v2-filter-bar"
              onSubmit={(e) => {
                e.preventDefault();
                void add();
              }}
            >
              <div class="v2-input-group">
                <Tag class="v2-input-icon" size={ICON.button} />
                <input
                  class="v2-input"
                  aria-label={t("Tag name")}
                  placeholder={t("Tag name")}
                  required
                  maxLength={80}
                  value={name}
                  disabled={busy}
                  onInput={(e) => setName(e.currentTarget.value)}
                />
              </div>
              <button
                type="submit"
                class="v2-btn v2-btn--primary"
                disabled={busy || !name.trim()}
              >
                <span class="v2-btn-icon" aria-hidden="true">
                  {busy ? (
                    <LoaderCircle class="v2-spin" size={ICON.button} />
                  ) : (
                    <Plus size={ICON.button} />
                  )}
                </span>
                {t("Add tag")}
              </button>
              <HelpTip label="Custom tags help" sections={help} />
            </form>
          }
        >
          {drafts.length ? (
            <TagColors.Provider value={settings.tagColors || {}}>
              <TagTextColors.Provider value={settings.tagTextColors || {}}>
                <HiddenTags.Provider value={{}}>
                  {table(heads, rows, 2)}
                </HiddenTags.Provider>
              </TagTextColors.Provider>
            </TagColors.Provider>
          ) : (
            <ListEmpty
              icon={<Tag size={ICON.empty} />}
              title={t("No custom tags yet.")}
            />
          )}
        </TableCard>
      </div>
    </>
  );
}
