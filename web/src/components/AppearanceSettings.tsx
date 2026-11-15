import { ICON, columnLabels, defaultColumnOrder, defaultColumns } from "../ui";
import { placementColumns, placementColumnLabels } from "../placement";
import { fileCheckColumns, fileCheckColumnLabels } from "../filecheck";
import { RotateCcw } from "lucide-preact";
import { useState, type Dispatch, type StateUpdater } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { catalogs, t, useI18n } from "../i18n";
import {
  readSessionPreference,
  writeSessionPreference,
} from "../browser-storage";
import { confirmReset } from "../confirmation";
import type { BandStyle, Theme } from "../appearance";
import type { ListPrefs } from "../list-prefs";
import { columnsDirty, type ColumnsTab } from "../settings-model";
import type { Settings, Service } from "../types";
import { Segmented } from "./list/Segmented";
import { ModeBandCard } from "./settings/ModeBandCard";
import { PalettePicker } from "./settings/PalettePicker";
import { PalettePreview } from "./settings/PalettePreview";
import { ColumnOrderEditor } from "./settings/ColumnOrderEditor";
import { card } from "./settings/Card";
import { field, fieldGroup } from "./settings/Field";
import { check } from "./settings/Check";
import { ListLayoutSettings, infoLabels } from "./ListLayoutSettings";

const displayTabs = ["general", "lists", "colors"];
const COLUMN_TABS: [ColumnsTab, string][] = [
  ["icons", "Icons"],
  ["radarr", "Movies"],
  ["sonarr", "TV series"],
  ["filecheck", "Files & permissions"],
  ["placement", "Disk placement"],
];

// The tab of Display (the band's segment "Display sections", SettingsPage):
// the route's tab; without one, the tab chosen last in this browser tab.
// Choosing writes both.
export function useDisplayTab(
  routeTab: string,
  setRouteTab: (tab: string) => void,
): [string, (tab: string) => void] {
  const [stored, setStored] = useState(() => {
    const saved = readSessionPreference("scopearr-display-tab");
    return displayTabs.includes(saved || "") ? saved! : "general";
  });
  return [
    displayTabs.includes(routeTab) ? routeTab : stored,
    (tab: string) => {
      setStored(tab);
      writeSessionPreference("scopearr-display-tab", tab);
      setRouteTab(tab);
    },
  ];
}

// Settings → Display (docs/STYLEGUIDE.md, Part 1, 11.4): the panel of the
// band's segment. General: the card "Interface theme" (mode and band, the
// palettes, the preview), then language, TV view, pagination, row density
// and resolution groups. Lists & columns: the column editor of five lists
// with the card "Audio tracks" beside its preview. Colors: the caller's
// color cards. Language, row density, stacked tracks, mode and band are
// drafts of SettingsPage (useSettingsDraft); while another area is shown
// the hidden section renders neither list preference. The column tab stays
// in its session key.
export function AppearanceSettings({
  cfg,
  saved,
  setCfg,
  draftLocale,
  setDraftLocale,
  draftPrefs,
  setDraftPrefs,
  hidden,
  colors,
  tab,
  mode,
  band,
  changeLook,
}: {
  cfg: Settings;
  saved: Settings;
  setCfg: Dispatch<StateUpdater<Settings>>;
  draftLocale: string;
  setDraftLocale: (locale: string) => void;
  draftPrefs: ListPrefs;
  setDraftPrefs: (prefs: ListPrefs) => void;
  hidden: boolean;
  colors: ComponentChildren;
  tab: string;
  mode: Theme;
  band: BandStyle | null;
  changeLook(next: { mode: Theme; band: BandStyle | null }): void;
}) {
  useI18n();
  const [columns, setColumns] = useState<ColumnsTab>(() => {
    const saved = readSessionPreference("scopearr-columns-tab");
    return COLUMN_TABS.some(([key]) => key === saved)
      ? (saved as ColumnsTab)
      : "icons";
  });
  const library = columns === "radarr" || columns === "sonarr",
    service = columns as Service,
    filecheck = columns === "filecheck";
  // A tool list's columns, its default order and visibility alike.
  const all = filecheck ? fileCheckColumns : placementColumns;
  const order = library
    ? cfg.columnOrder[service]
    : (filecheck ? cfg.filecheckColumnOrder : cfg.placementColumnOrder) || all;
  const visible = library
    ? cfg.visibleColumns[service]
    : (filecheck ? cfg.filecheckVisibleColumns : cfg.placementVisibleColumns) ||
      all;
  const names = library
    ? columnLabels
    : Object.fromEntries(
        Object.entries(
          filecheck ? fileCheckColumnLabels : placementColumnLabels,
        ).map(([k, v]) => [k, t(v)]),
      );
  const columnTitle = t(COLUMN_TABS.find(([key]) => key === columns)![1]);
  const dirtyColumns = columnsDirty(cfg, saved);
  function changeColumns(order: string[], visible: string[]) {
    setCfg((current) =>
      library
        ? {
            ...current,
            columnOrder: { ...current.columnOrder, [service]: order },
            visibleColumns: { ...current.visibleColumns, [service]: visible },
          }
        : filecheck
          ? {
              ...current,
              filecheckColumnOrder: order,
              filecheckVisibleColumns: visible,
            }
          : {
              ...current,
              placementColumnOrder: order,
              placementVisibleColumns: visible,
            },
    );
  }
  const reset = t("Reset order for {tab}", { tab: columnTitle });
  // On every list, since it applies to both libraries.
  const stacked =
    !hidden &&
    card(
      "audio-tracks",
      t("Audio tracks"),
      <>
        {check(t("Show audio tracks stacked"), draftPrefs.stacked, (on) =>
          setDraftPrefs({ ...draftPrefs, stacked: on }),
        )}
        <small>
          {t(
            "Stacked shows every audio track on its own line; otherwise up to two show and the others on demand. Applied after saving in this browser.",
          )}
        </small>
      </>,
      undefined,
      "v2-card--inset",
    );
  return (
    <div
      class="v2-set"
      hidden={hidden}
      id={"display-panel-" + tab}
      role="tabpanel"
      aria-labelledby={"display-tab-" + tab}
    >
      {tab === "general" && (
        <>
          {card(
            "interface-theme",
            t("Interface theme"),
            <div class="v2-set-theme">
              <div>
                <ModeBandCard mode={mode} band={band} change={changeLook} />
                <span class="v2-set-label">{t("Palette")}</span>
                <PalettePicker
                  labelledBy="interface-theme-title"
                  value={cfg.interfaceTheme || "default"}
                  mode={mode}
                  change={(interfaceTheme) =>
                    setCfg({ ...cfg, interfaceTheme })
                  }
                />
              </div>
              <div>
                <span class="v2-set-label">{t("Preview")}</span>
                <PalettePreview
                  theme={cfg.interfaceTheme || "default"}
                  band={band}
                />
              </div>
            </div>,
            <p>
              {t(
                "Applied after saving. Every theme supports dark and light mode; layout and tag colors stay unchanged.",
              )}
            </p>,
          )}
          <div class="v2-set-grid v2-set-grid--even">
            {card(
              "interface-language",
              t("Interface language"),
              // A select named like its card, its hint below it.
              field(
                "interface-language",
                t("Interface language"),
                (a) => (
                  <select
                    class="v2-select"
                    {...a}
                    value={draftLocale}
                    onChange={(e) => setDraftLocale(e.currentTarget.value)}
                  >
                    {catalogs.map((catalog) => (
                      <option key={catalog.locale} value={catalog.locale}>
                        {catalog.name}
                      </option>
                    ))}
                  </select>
                ),
                {
                  hint: t(
                    "Applied after saving in this browser. Media names and filter values stay unchanged.",
                  ),
                  aria: true,
                },
              ),
            )}
            {card(
              "tv-view",
              t("TV view"),
              field(
                "tv-view-mode",
                t("Results with active filters"),
                (a) => (
                  <select
                    {...a}
                    class="v2-select"
                    value={cfg.seasonMode}
                    onChange={(e) =>
                      setCfg({
                        ...cfg,
                        seasonMode: e.currentTarget
                          .value as Settings["seasonMode"],
                      })
                    }
                  >
                    <option value="matches">
                      {t("Show matching files only")}
                    </option>
                    <option value="season">
                      {t("Full matching season · highlight matches")}
                    </option>
                  </select>
                ),
                {
                  hint: t(
                    "One matching file is enough to show its season in context.",
                  ),
                },
              ),
            )}
            {card(
              "pagination",
              t("Pagination"),
              field(
                "page-size",
                t("Entries per page"),
                (a) => (
                  <input
                    {...a}
                    class="v2-input"
                    type="number"
                    min="1"
                    max="1000"
                    step="1"
                    required
                    value={cfg.pageSize ?? 100}
                    onInput={(e) =>
                      setCfg({
                        ...cfg,
                        pageSize: Number(e.currentTarget.value),
                      })
                    }
                  />
                ),
                {
                  hint: t(
                    "Shared by movies and TV series. Default: 100. Allowed: 1–1000.",
                  ),
                },
              ),
            )}
            {!hidden &&
              card(
                "row-density",
                t("Row density"),
                field(
                  "row-density",
                  t("Row density"),
                  (a) => (
                    <select
                      class="v2-select"
                      {...a}
                      value={draftPrefs.density}
                      onChange={(e) =>
                        setDraftPrefs({
                          ...draftPrefs,
                          density:
                            e.currentTarget.value === "compact"
                              ? "compact"
                              : "comfortable",
                        })
                      }
                    >
                      <option value="comfortable">{t("Comfortable")}</option>
                      <option value="compact">{t("Compact")}</option>
                    </select>
                  ),
                  {
                    hint: t(
                      "Compact rows show more entries at once. Applied after saving in this browser.",
                    ),
                    aria: true,
                  },
                ),
              )}
            {card(
              "resolution-groups",
              t("Resolution groups"),
              fieldGroup(
                <>
                  {check(
                    t("Group resolutions below 720p as SD on the dashboard"),
                    cfg.groupSD !== false,
                    (on) =>
                      setCfg({
                        ...cfg,
                        groupSD: on,
                        groupSDLists: on ? cfg.groupSDLists : false,
                      }),
                  )}
                  {check(
                    t("Also group SD in library lists and resolution filters"),
                    !!cfg.groupSDLists,
                    (on) => setCfg({ ...cfg, groupSDLists: on }),
                    cfg.groupSD === false,
                  )}
                  <small>
                    {t(
                      "Only known resolutions below 720p are grouped. Unknown stays separate. File details, exports and synchronization retain the original values.",
                    )}
                  </small>
                </>,
              ),
            )}
          </div>
        </>
      )}
      {tab === "lists" &&
        card(
          "lists-columns",
          t("Lists & columns"),
          <>
            <p>
              {t(
                "Choose visible icons and columns and move them with the arrows (left to right, including hidden entries). Warnings appear only for affected files. Filters and CSV always include all fields. Changes apply after saving.",
              )}
            </p>
            <Segmented<ColumnsTab>
              label={t("Lists & columns")}
              kind="tabs"
              idPrefix="columns"
              value={columns}
              items={COLUMN_TABS.map(([value, label]) => ({
                value,
                label: t(label),
                dirty: dirtyColumns[value],
              }))}
              select={(value) => {
                setColumns(value);
                writeSessionPreference("scopearr-columns-tab", value);
              }}
            />
            <div
              id={"columns-panel-" + columns}
              role="tabpanel"
              aria-labelledby={"columns-tab-" + columns}
            >
              {columns === "icons" ? (
                <ListLayoutSettings settings={cfg} changed={setCfg}>
                  {stacked}
                </ListLayoutSettings>
              ) : (
                <ColumnOrderEditor
                  list={columnTitle}
                  order={library ? ["select", ...order] : order}
                  visible={library ? ["select", ...visible] : visible}
                  labels={{ ...names, select: t("Selection") }}
                  fixed={["select"]}
                  alwaysVisible={library ? ["select", "title"] : ["select"]}
                  change={(next, shown) =>
                    changeColumns(
                      library ? next.filter((k) => k !== "select") : next,
                      library ? shown.filter((k) => k !== "select") : shown,
                    )
                  }
                >
                  {stacked}
                </ColumnOrderEditor>
              )}
            </div>
          </>,
          <button
            type="button"
            class="v2-icon-btn"
            title={reset}
            aria-label={reset}
            onClick={async () => {
              if (
                !(await confirmReset(
                  t("Reset order for {tab}?", { tab: columnTitle }),
                ))
              )
                return;
              if (columns === "icons")
                setCfg({
                  ...cfg,
                  listInfoOrder: Object.keys(infoLabels),
                  listInfoVisible: Object.keys(infoLabels),
                });
              else
                changeColumns(
                  [...(library ? defaultColumnOrder : all)],
                  [...(library ? defaultColumns : all)],
                );
            }}
          >
            <RotateCcw size={ICON.button} />
          </button>,
        )}
      {tab === "colors" && colors}
    </div>
  );
}
