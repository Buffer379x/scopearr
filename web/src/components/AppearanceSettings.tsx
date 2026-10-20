import { Layers } from "lucide-preact";
import type { Dispatch, StateUpdater } from "preact/hooks";
import { LanguageSelect, t, useI18n } from "../i18n";
import { interfaceThemes, themeLabels } from "../themes";
import type { Service, Settings } from "../types";
import { columnLabels, defaultColumnOrder, defaultColumns } from "../ui";
import { ColumnOptions } from "./ColumnOptions";
import { muxColumns, muxColumnLabels } from "../mux-spec";
import { ListLayoutSettings } from "./ListLayoutSettings";

export function AppearanceSettings({
  cfg,
  setCfg,
  draftLocale,
  setDraftLocale,
  hidden,
}: {
  cfg: Settings;
  setCfg: Dispatch<StateUpdater<Settings>>;
  draftLocale: string;
  setDraftLocale: (locale: string) => void;
  hidden: boolean;
}) {
  useI18n();
  return (
    <div class="settings-section" hidden={hidden}>
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
            <Layers size={16} />
            {t("TV view")}
          </h3>
          <label>
            {t("Results with active filters")}
            <select
              value={cfg.seasonMode}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  seasonMode: e.currentTarget.value as Settings["seasonMode"],
                })
              }
            >
              <option value="matches">{t("Show matching files only")}</option>
              <option value="season">
                {t("Full matching season · highlight matches")}
              </option>
            </select>
          </label>
          <small>
            {t("One matching file is enough to show its season in context.")}
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
        <h3 class="card-title">{t("Additional settings")}</h3>
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
      <ListLayoutSettings settings={cfg} changed={(next) => setCfg(next)} />
      <section class="connection">
        <h3 class="card-title">{t("Default columns")}</h3>
        <p class="quiet">
          {t(
            "Choose visible columns and move them with the arrows. The order runs left to right, including hidden columns. Both are saved permanently. Filters and CSV still include all fields.",
          )}
        </p>
        <div class="column-settings">
          {(["radarr", "sonarr"] as Service[]).map((service) => (
            <section class="columns-group">
              <h3 class="card-title">
                {service === "radarr"
                  ? t("Movies · Radarr")
                  : t("TV series · Sonarr")}
              </h3>
              <ColumnOptions
                order={cfg.columnOrder[service]}
                visible={cfg.visibleColumns[service]}
                labels={{
                  ...columnLabels,
                  title:
                    service === "radarr"
                      ? t("Title (always visible)")
                      : t("Episode (always visible)"),
                }}
                alwaysVisible={["title"]}
                ariaPrefix={t(service === "radarr" ? "Movies" : "TV series")}
                onChange={(order, visible) =>
                  setCfg((current) => ({
                    ...current,
                    columnOrder: { ...current.columnOrder, [service]: order },
                    visibleColumns: {
                      ...current.visibleColumns,
                      [service]: visible,
                    },
                  }))
                }
                onReset={() =>
                  setCfg((current) => ({
                    ...current,
                    columnOrder: {
                      ...current.columnOrder,
                      [service]: [...defaultColumnOrder],
                    },
                    visibleColumns: {
                      ...current.visibleColumns,
                      [service]: [...defaultColumns],
                    },
                  }))
                }
              />
            </section>
          ))}
        </div>
      </section>{" "}
      {cfg.mux?.enabled && (
        <section class="connection">
          <h3 class="card-title">{t("Muxing columns")}</h3>
          <p class="quiet">
            {t(
              "Choose visible columns of the Muxing list and move them with the arrows. The selection stays first and the filename remains visible.",
            )}
          </p>
          <div class="column-settings">
            <section class="columns-group">
              <ColumnOptions
                order={cfg.muxColumnOrder || muxColumns}
                visible={cfg.muxVisibleColumns || muxColumns}
                labels={Object.fromEntries(
                  Object.entries(muxColumnLabels).map(([key, label]) => [
                    key,
                    t(key === "filename" ? "Filename (always visible)" : label),
                  ]),
                )}
                fixed={["select"]}
                alwaysVisible={["select", "filename"]}
                ariaPrefix={t("Muxing")}
                onChange={(order, visible) =>
                  setCfg((current) => ({
                    ...current,
                    muxColumnOrder: order,
                    muxVisibleColumns: visible,
                  }))
                }
                onReset={() =>
                  setCfg((current) => ({
                    ...current,
                    muxColumnOrder: [...muxColumns],
                    muxVisibleColumns: [...muxColumns],
                  }))
                }
              />
            </section>
          </div>
        </section>
      )}
    </div>
  );
}
