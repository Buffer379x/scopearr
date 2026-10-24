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
import { ListLayoutSettings, infoLabels } from "./ListLayoutSettings";
export function AppearanceSettings({
  cfg,
  saved,
  setCfg,
  draftLocale,
  setDraftLocale,
  hidden,
  colors,
  dirtyTabs,
}: {
  cfg: Settings;
  saved: Settings;
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
      return ["icons", "radarr", "sonarr", "filecheck", "placement"].includes(
        saved || "",
      )
        ? saved!
        : "icons";
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
    columns === "icons"
      ? "Icons"
      : columns === "radarr"
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
          <section class="connection list-columns-card">
            <CardHeading
              title={t("Lists & columns")}
              description={t(
                "Choose visible icons and columns and move them with the arrows (left to right, including hidden entries). Warnings appear only for affected files. Filters and CSV always include all fields. Changes apply after saving.",
              )}
              actions={
                <button
                  type="button"
                  class="icon-button"
                  title={t("Reset order for {tab}", { tab: columnTitle })}
                  aria-label={t("Reset order for {tab}", { tab: columnTitle })}
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
              label={t("Lists & columns")}
              value={columns}
              change={(value) => {
                setColumns(value);
                writeSessionPreference("scopearr-columns-tab", value);
              }}
              items={[
                ["icons", "Icons", ["listInfoOrder", "listInfoVisible"]],
                ["radarr", "Movies", ["columnOrder", "visibleColumns"]],
                ["sonarr", "TV series", ["columnOrder", "visibleColumns"]],
                [
                  "filecheck",
                  "Files & permissions",
                  ["filecheckColumnOrder", "filecheckVisibleColumns"],
                ],
                [
                  "placement",
                  "Disk placement",
                  ["placementColumnOrder", "placementVisibleColumns"],
                ],
              ].map(([value, label, keys]) => ({
                value: String(value),
                label: (
                  <>
                    {t(String(label))}
                    {(keys as (keyof Settings)[]).some(
                      (key) =>
                        JSON.stringify(
                          value === "radarr" || value === "sonarr"
                            ? (cfg[key] as Record<string, unknown>)[
                                String(value)
                              ]
                            : cfg[key],
                        ) !==
                        JSON.stringify(
                          value === "radarr" || value === "sonarr"
                            ? (saved[key] as Record<string, unknown>)[
                                String(value)
                              ]
                            : saved[key],
                        ),
                    ) && (
                      <span class="dirty-dot" aria-label={t("Unsaved changes")}>
                        •
                      </span>
                    )}
                  </>
                ),
              }))}
            />
            <div
              id={"columns-panel-" + columns}
              role="tabpanel"
              aria-labelledby={"columns-tab-" + columns}
            >
              {columns === "icons" ? (
                <ListLayoutSettings settings={cfg} changed={setCfg} />
              ) : (
                <OrderedList
                  order={library ? ["select", ...order] : order}
                  visible={library ? ["select", ...visible] : visible}
                  labels={{ ...names, select: t("Selection") }}
                  fixed={["select"]}
                  alwaysVisible={library ? ["select", "title"] : ["select"]}
                  ariaPrefix={columnTitle}
                  change={(next, shown) =>
                    changeColumns(
                      library ? next.filter((k) => k !== "select") : next,
                      library ? shown.filter((k) => k !== "select") : shown,
                    )
                  }
                />
              )}
            </div>
          </section>
        )}
        {tab === "colors" && colors}
      </div>
    </div>
  );
}
