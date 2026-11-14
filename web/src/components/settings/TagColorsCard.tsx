import { RotateCcw, Trash2 } from "lucide-preact";
import type { JSX } from "preact";
import { useContext, type Dispatch, type StateUpdater } from "preact/hooks";
import { api } from "../../api";
import { colorStyle } from "../../color";
import { confirmDeletion, confirmReset } from "../../confirmation";
import { getLocale, t, useI18n } from "../../i18n";
import { audioLanguageLabel } from "../../languages";
import { notify } from "../../notifications";
import { SD_RESOLUTION } from "../../resolution-groups";
import { presentedTagLabel } from "../../tag-labels";
import type { CustomTag, Settings } from "../../types";
import {
  ICON,
  TagColors,
  TagLabels,
  TagTextColors,
  colorFields,
  defaultColor,
  labels,
} from "../../ui";
import { LanguageFlag } from "../LanguageFlag";
import { HelpTip } from "../list/HelpTip";
import { MediaTag } from "../list/MediaTag";
import { RowButton } from "../list/RowButton";
import { TEXT_CYCLE, card, colorTable } from "./Card";
import { field } from "./Field";

export type CatalogTag = {
  field: string;
  value: string;
  count: number;
  mediaServer?: boolean;
};

// Display → Colors, the card "Tag colors" (docs/STYLEGUIDE.md, Part 1,
// 11.4), as in 1.7.0: the select "Tag field" and a v2 table of the field's
// values (stored overrides of inactive values stay saved but never come
// back): the preview with the draft's colors (MediaTag, or the language
// flag) and the media server mark, the count, Display, the color, the text
// color cycling Automatic → Black → White, Reset and Delete (locked for
// the virtual SD, linked or protected values), each with its question.
export function TagColorsCard({
  cfg,
  setCfg,
  customTags,
  catalog,
  recognized,
  colorField,
  setColorField,
  customChanged,
  saved,
  refresh,
  setCatalog,
  setRecognized,
}: {
  cfg: Settings;
  setCfg: Dispatch<StateUpdater<Settings>>;
  customTags: CustomTag[];
  catalog: CatalogTag[];
  recognized: Record<string, string[]>;
  colorField: string;
  setColorField(field: string): void;
  customChanged(): Promise<unknown>;
  saved(settings: Settings): Promise<void>;
  refresh(): Promise<void>;
  setCatalog: Dispatch<StateUpdater<CatalogTag[]>>;
  setRecognized: Dispatch<StateUpdater<Record<string, string[]>>>;
}): JSX.Element {
  useI18n();
  const tagLabels = useContext(TagLabels);
  const values = [...new Set(recognized[colorField] || [])]
    .filter(
      (value) =>
        colorField !== "resolution" ||
        value !== SD_RESOLUTION ||
        cfg.groupSD !== false,
    )
    .sort();
  const setColor = (key: string, color?: string) =>
    setCfg((current) => {
      const colors = { ...current.tagColors };
      const textColors = { ...current.tagTextColors };
      if (color) colors[key] = color;
      else {
        delete colors[key];
        delete textColors[key];
      }
      return { ...current, tagColors: colors, tagTextColors: textColors };
    });
  const setTextColor = (key: string, color: string) =>
    setCfg((current) => {
      const colors = { ...current.tagTextColors };
      if (color) colors[key] = color;
      else delete colors[key];
      return { ...current, tagTextColors: colors };
    });
  const heads = [
    "Tag preview",
    "Count",
    "Display column",
    "Color",
    "Text",
    "Reset",
    "Actions",
  ].map((head) => t(head));
  return card(
    "tag-colors",
    t("Tag colors"),
    <>
      <p>
        {t(
          "Custom colors apply to both libraries and themes. They remain saved until reset.",
        )}
      </p>
      <div class="v2-form">
        {field("tag-color-field", t("Tag field"), (a) => (
          <select
            {...a}
            class="v2-select"
            value={colorField}
            onChange={(e) => setColorField(e.currentTarget.value)}
          >
            {colorFields.map((key) => (
              <option key={key} value={key}>
                {labels[key]}
              </option>
            ))}
          </select>
        ))}
      </div>
      <TagColors.Provider value={cfg.tagColors || {}}>
        <TagTextColors.Provider value={cfg.tagTextColors || {}}>
          {colorTable(
            heads,
            values
              .filter(
                (value) => colorField !== "language" || value !== "__unknown__",
              )
              .map((value) => {
                const key = colorField + ":" + value;
                const custom = customTags.find(
                  (tag) => String(tag.id) === value,
                );
                const row = catalog.find(
                  (entry) =>
                    entry.field === colorField && entry.value === value,
                );
                const links =
                  (colorField === "custom" ? custom : row)?.count || 0;
                const label =
                  value === "__unknown__"
                    ? t("Unknown")
                    : colorField === "language"
                      ? t(audioLanguageLabel(value, getLocale()))
                      : colorField === "custom"
                        ? custom?.name || value
                        : presentedTagLabel(colorField, value, tagLabels);
                const text = cfg.tagTextColors?.[key];
                const color =
                  cfg.tagColors?.[key] || defaultColor(colorField, value);
                const [shown, next] = TEXT_CYCLE[text || ""] ?? [
                  "Automatic",
                  "#000000",
                ];
                const cells = [
                  <span class="v2-table-items">
                    {colorField === "language" ? (
                      <LanguageFlag
                        value={value}
                        colors={cfg.tagColors || {}}
                      />
                    ) : (
                      <MediaTag
                        kind={colorField}
                        forceTag
                        value={value === "__unknown__" ? "" : value}
                      />
                    )}
                    {row?.mediaServer && (
                      <HelpTip
                        label="Media server metadata"
                        text="This value is used from Emby or Jellyfin metadata in your library. A tag rule may also recognize the same value. This marker does not change tag display, filtering or synchronization."
                      />
                    )}
                  </span>,
                  links,
                  <input
                    type="checkbox"
                    class="v2-check"
                    aria-label={t("Display tag: {value}", { value: label })}
                    checked={!cfg.hiddenTags?.[key]}
                    onChange={(e) => {
                      const hiddenTags = { ...cfg.hiddenTags };
                      if (e.currentTarget.checked) delete hiddenTags[key];
                      else hiddenTags[key] = true;
                      setCfg({ ...cfg, hiddenTags });
                    }}
                  />,
                  <input
                    type="color"
                    class="v2-color"
                    aria-label={t("Color for {value}", { value: label })}
                    value={color}
                    onInput={(e) => setColor(key, e.currentTarget.value)}
                  />,
                  <RowButton
                    label={
                      t("Text color for {value}", { value: label }) +
                      ": " +
                      t(shown)
                    }
                    title={t(shown)}
                    disabled={colorField === "language"}
                    icon={
                      <span aria-hidden="true" style={colorStyle(color, text)}>
                        Aa
                      </span>
                    }
                    onClick={() => setTextColor(key, next)}
                  />,
                  <RowButton
                    label={t("Default color for {value}", { value: label })}
                    icon={<RotateCcw size={ICON.button} />}
                    disabled={!cfg.tagColors?.[key] && !text}
                    onClick={async () => {
                      if (
                        await confirmReset(
                          t("Reset background and text colors for {value}?", {
                            value: label,
                          }),
                        )
                      )
                        setColor(key);
                    }}
                  />,
                  <RowButton
                    label={t("Delete tag: {name}", { name: label })}
                    icon={<Trash2 size={ICON.button} />}
                    tone="danger"
                    disabled={
                      (colorField === "resolution" &&
                        value === SD_RESOLUTION) ||
                      links > 0 ||
                      !!custom?.protected
                    }
                    onClick={async () => {
                      if (
                        !(await confirmDeletion(
                          t("Delete tag {name}?", { name: label }),
                        ))
                      )
                        return;
                      try {
                        if (colorField === "custom") {
                          await api("custom-tags/batch", "PUT", {
                            original: customTags,
                            tags: customTags.filter(
                              (tag) => String(tag.id) !== value,
                            ),
                          });
                          await customChanged();
                        } else {
                          await api("tag-catalog", "DELETE", {
                            field: colorField,
                            value,
                          });
                          await saved(await api<Settings>("settings"));
                        }
                        setCatalog((old) =>
                          old.filter(
                            (entry) =>
                              entry.field !== colorField ||
                              entry.value !== value,
                          ),
                        );
                        setRecognized((old) => ({
                          ...old,
                          [colorField]: (old[colorField] || []).filter(
                            (v) => v !== value,
                          ),
                        }));
                        setColor(key);
                        setCfg((current) => {
                          const hiddenTags = { ...current.hiddenTags };
                          delete hiddenTags[key];
                          return { ...current, hiddenTags };
                        });
                        await refresh();
                        notify(t("Settings saved."));
                      } catch {}
                    }}
                  />,
                ];
                return [value, cells];
              }),
            1,
            "v2-set-colors",
          )}
        </TagTextColors.Provider>
      </TagColors.Provider>
      {!values.length && (
        <p>
          {t(
            colorField === "custom"
              ? "No custom tags assigned yet. Assign tags in your library or add a filename rule."
              : "No tags detected yet. Sync a library first.",
          )}
        </p>
      )}
    </>,
  );
}
