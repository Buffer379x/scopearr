import {
  ICON,
  CardHeading,
  SegmentedTabs,
  columnLabels,
  defaultColumnOrder,
  defaultColumns,
} from "../ui";
import { placementColumns, placementColumnLabels } from "../placement";
import { fileCheckColumns, fileCheckColumnLabels } from "../filecheck";
import { Layers, RotateCcw } from "lucide-preact";
import { useState, type Dispatch, type StateUpdater } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { LanguageSelect, t, useI18n } from "../i18n";
import { interfaceThemes, themeLabels } from "../themes";
import {
  readSessionPreference,
  writeSessionPreference,
} from "../browser-storage";
import { confirmReset } from "../confirmation";
import type { Settings, Service } from "../types";
import { OrderedList } from "./OrderedList";
import { ListLayoutSettings } from "./ListLayoutSettings";
export function AppearanceSettings({
  cfg,
  setCfg,
  draftLocale,
  setDraftLocale,
  hidden,
  colors,
  dirtyTabs,
}: {
  cfg: Settings;
  setCfg: Dispatch<StateUpdater<Settings>>;
  draftLocale: string;
  setDraftLocale: (locale: string) => void;
  hidden: boolean;
  colors: ComponentChildren;
  dirtyTabs: Record<string, boolean>;
}) {
  useI18n();
  const [tab, setTab] = useState(() => {
      const saved = readSessionPreference("scopearr-display-tab");
      return ["general", "lists", "colors"].includes(saved || "")
        ? saved!
        : "general";
    }),
    [columns, setColumns] = useState(() => {
      const saved = readSessionPreference("scopearr-columns-tab");
      return ["radarr", "sonarr", "filecheck", "placement"].includes(
        saved || "",
      )
        ? saved!
        : "radarr";
    });
  const library = columns === "radarr" || columns === "sonarr",
    service = columns as Service;
  const order = library
    ? cfg.columnOrder[service]
    : columns === "filecheck"
      ? cfg.filecheckColumnOrder || fileCheckColumns
      : cfg.placementColumnOrder || placementColumns;
  const visible = library
    ? cfg.visibleColumns[service]
    : columns === "filecheck"
      ? cfg.filecheckVisibleColumns || fileCheckColumns
      : cfg.placementVisibleColumns || placementColumns;
  const names = library
    ? columnLabels
    : Object.fromEntries(
        Object.entries(
          columns === "filecheck"
            ? fileCheckColumnLabels
            : placementColumnLabels,
        ).map(([k, v]) => [k, t(v)]),
      );
  const columnTitle = t(
    columns === "radarr"
      ? "Movies"
      : columns === "sonarr"
        ? "TV series"
        : columns === "filecheck"
          ? "Files & permissions"
          : "Disk placement",
  );
  function changeColumns(order: string[], visible: string[]) {
    setCfg((current) =>
      library
        ? {
            ...current,
            columnOrder: { ...current.columnOrder, [service]: order },
            visibleColumns: { ...current.visibleColumns, [service]: visible },
          }
        : columns === "filecheck"
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
  return (
    <div class="settings-section" hidden={hidden}>
      <SegmentedTabs
        id="display"
        label={t("Display sections")}
        value={tab}
        change={(value) => {
          setTab(value);
          writeSessionPreference("scopearr-display-tab", value);
        }}
        items={[
          {
            value: "general",
            label: (
              <>
                {t("General")}
                {dirtyTabs.general && (
                  <span class="dirty-dot" aria-label={t("Unsaved changes")}>
                    •
                  </span>
                )}
              </>
            ),
          },
          {
            value: "lists",
            label: (
              <>
                {t("Lists & columns")}
                {dirtyTabs.lists && (
                  <span class="dirty-dot" aria-label={t("Unsaved changes")}>
                    •
                  </span>
                )}
              </>
            ),
          },
          {
            value: "colors",
            label: (
              <>
                {t("Colors")}
                {dirtyTabs.colors && (
                  <span class="dirty-dot" aria-label={t("Unsaved changes")}>
                    •
                  </span>
                )}
              </>
            ),
          },
        ]}
      />
      <div
        id={"display-panel-" + tab}
        role="tabpanel"
        aria-labelledby={"display-tab-" + tab}
      >
        {tab === "general" && (
          <>
            <div class="appearance-preferences">
              <section class="connection">
                <h3 class="card-title">{t("Interface language")}</h3>
                <LanguageSelect value={draftLocale} onChange={setDraftLocale} />
                <small>
                  {t(
                    "Applied after saving in this browser. Media names and filter values stay unchanged.",
                  )}
                </small>
              </section>
              <section class="connection">
                <h3 class="card-title">{t("Interface theme")}</h3>
                <select
                  aria-label={t("Interface theme")}
                  value={cfg.interfaceTheme || "default"}
                  onChange={(e) =>
                    setCfg({ ...cfg, interfaceTheme: e.currentTarget.value })
                  }
                >
                  {interfaceThemes.map((theme) => (
                    <option value={theme}>{t(themeLabels[theme])}</option>
                  ))}
                </select>
                <small>
                  {t(
                    "Applied after saving. Every theme supports dark and light mode; layout and tag colors stay unchanged.",
                  )}
                </small>
              </section>
            </div>
            <div class="appearance-preferences">
              <section class="connection">
                <h3 class="card-title">
                  <Layers size={ICON.button} />
                  {t("TV view")}
                </h3>
                <label>
                  {t("Results with active filters")}
                  <select
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
                </label>
                <small>
                  {t(
                    "One matching file is enough to show its season in context.",
                  )}
                </small>
              </section>
              <section class="connection">
                <h3 class="card-title">{t("Pagination")}</h3>
                <label>
                  {t("Entries per page")}
                  <input
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
                </label>
                <small>
                  {t(
                    "Shared by movies and TV series. Default: 100. Allowed: 1–1000.",
                  )}
                </small>
              </section>
            </div>
            <section class="connection">
              <h3 class="card-title">{t("Resolution groups")}</h3>
              <label class="check-field">
                <input
                  type="checkbox"
                  checked={cfg.groupSD !== false}
                  onChange={(e) =>
                    setCfg({
                      ...cfg,
                      groupSD: e.currentTarget.checked,
                      groupSDLists: e.currentTarget.checked
                        ? cfg.groupSDLists
                        : false,
                    })
                  }
                />
                {t("Group resolutions below 720p as SD on the dashboard")}
              </label>
              <label
                class={
                  "check-field" +
                  (cfg.groupSD === false ? " disabled-preference" : "")
                }
              >
                <input
                  type="checkbox"
                  checked={!!cfg.groupSDLists}
                  disabled={cfg.groupSD === false}
                  onChange={(e) =>
                    setCfg({ ...cfg, groupSDLists: e.currentTarget.checked })
                  }
                />
                {t("Also group SD in library lists and resolution filters")}
              </label>
              <small>
                {t(
                  "Only known resolutions below 720p are grouped. Unknown stays separate. File details, exports and synchronization retain the original values.",
                )}
              </small>
            </section>
          </>
        )}
        {tab === "lists" && (
          <div class="appearance-lists">
            <ListLayoutSettings settings={cfg} changed={setCfg} />
            <section class="connection">
              <CardHeading
                title={columnTitle + " · " + t("Columns")}
                description={t(
                  "Choose visible columns and move them with the arrows. The order runs left to right, including hidden columns. Both are saved permanently. Filters and CSV still include all fields.",
                )}
                actions={
                  <button
                    type="button"
                    class="icon-button"
                    aria-label={t("Reset columns for {list}", {
                      list: columnTitle,
                    })}
                    title={t("Reset columns for {list}", { list: columnTitle })}
                    onClick={async () => {
                      if (await confirmReset(t("Restore defaults?")))
                        changeColumns(
                          library
                            ? [...defaultColumnOrder]
                            : columns === "filecheck"
                              ? [...fileCheckColumns]
                              : [...placementColumns],
                          library
                            ? [...defaultColumns]
                            : columns === "filecheck"
                              ? [...fileCheckColumns]
                              : [...placementColumns],
                        );
                    }}
                  >
                    <RotateCcw size={ICON.button} />
                  </button>
                }
              />
              <SegmentedTabs
                id="columns"
                label={t("Columns")}
                value={columns}
                change={(value) => {
                  setColumns(value);
                  writeSessionPreference("scopearr-columns-tab", value);
                }}
                items={[
                  { value: "radarr", label: t("Movies") },
                  { value: "sonarr", label: t("TV series") },
                  { value: "filecheck", label: t("Files & permissions") },
                  { value: "placement", label: t("Disk placement") },
                ]}
              />
              <div
                id={"columns-panel-" + columns}
                role="tabpanel"
                aria-labelledby={"columns-tab-" + columns}
              >
                <OrderedList
                  order={order}
                  visible={visible}
                  labels={names}
                  fixed={library ? [] : ["select"]}
                  alwaysVisible={library ? ["title"] : ["select"]}
                  ariaPrefix={columnTitle}
                  change={changeColumns}
                />
              </div>
            </section>
          </div>
        )}
        {tab === "colors" && colors}
      </div>
    </div>
  );
}
