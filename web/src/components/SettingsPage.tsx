import { SettingsSectionHeading } from "./SettingsSectionHeading";
import { colorStyle } from "../color";
import { ICON, CardHeading } from "../ui";
import { instanceByID } from "../instances";
import { presentedTagLabel } from "../tag-labels";
import { SD_RESOLUTION } from "../resolution-groups";
import { Trash2 } from "lucide-preact";
import { lazy, Suspense } from "preact/compat";
import { confirmDeletion, confirmReset } from "../confirmation";
import { getLocale, t, useI18n } from "../i18n";
import { audioLanguageLabel } from "../languages";
import { notify } from "../notifications";
import type { CustomTag } from "../types";
import { AppearanceSettings } from "./AppearanceSettings";
import { ConnectionSettings } from "./ConnectionSettings";
import { CustomTagsSettings } from "./CustomTagsSettings";
import { LanguageFlag } from "./LanguageFlag";
import { HelpPopover } from "./HelpPopover";
import {
  SystemSettingsInfo,
  SystemSettingsLog,
  useSystemTab,
} from "./SystemSettings";
import { PageHeader } from "./PageHeader";
import { TagPolicyDialog } from "./TagPolicyDialog";
import { TagReview } from "./TagReview";
import { WidgetsSettings } from "./WidgetsSettings";
const RecognitionPage = lazy(() =>
  import("./RecognitionPage").then((module) => ({
    default: module.RecognitionPage,
  })),
);

import { TriangleAlert, OctagonAlert, RotateCcw } from "lucide-preact";
import { useContext, useEffect, useId, useRef, useState } from "preact/hooks";
import type { Settings, Status } from "../types";

import { api } from "../api";
import type { SectionGuard } from "../hooks/useAppNavigation";
import { useSettingsDraft } from "../hooks/useSettingsDraft";
import {
  TagLabels,
  colorFields,
  defaultColor,
  defaultWarningColors,
  labels,
  Tag,
} from "../ui";
export function SettingsPage({
  customTags,
  customChanged,
  settings,
  status,
  demo,
  saved,
  onDirty,
  refresh,
  section,
  openSection,
  registerSectionGuard,
}: {
  customTags: CustomTag[];
  customChanged: () => Promise<CustomTag[] | undefined>;
  settings: Settings;
  status: Status;
  demo: boolean;
  saved: (settings: Settings) => Promise<void>;
  onDirty: (dirty: boolean) => void;
  refresh: () => Promise<void>;
  section: string;
  openSection: (next: string) => void;
  registerSectionGuard: (guard: SectionGuard | null) => void;
}) {
  const { locale } = useI18n();
  const tagLabels = useContext(TagLabels);
  const settingsFormId = useId();
  const [pendingReview, setPendingReview] = useState<string | null>(null);
  type CatalogTag = {
    field: string;
    value: string;
    count: number;
    mediaServer?: boolean;
  };
  const [catalog, setCatalog] = useState<CatalogTag[]>([]);
  useEffect(() => {
    const update = () => {
      const top =
        document.querySelector(".header")?.getBoundingClientRect().bottom || 0;
      document
        .querySelectorAll(".settings-section-heading")
        .forEach((el) =>
          el.classList.toggle(
            "scrolled",
            window.scrollY > 0 && el.getBoundingClientRect().top <= top + 1,
          ),
        );
    };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, []);
  const contentRef = useRef<HTMLDivElement>(null);
  const {
    cfg,
    setCfg,
    draftLocale,
    setDraftLocale,
    dirty,
    setRulesDirty,
    setCustomDirty,
    busy,
    confirmSectionChange,
    changeSection,
    saveSettings,
    submit,
    confirmTags,
    tagChanges,
    setTagChanges,
    tagSaveReview,
    setTagSaveReview,
  } = useSettingsDraft({
    settings,
    section,
    openSection,
    onDirty,
    saved,
  });
  // Navigation away from this section asks through the guard of the current
  // draft, so it is registered on every render and dropped on unmount.
  registerSectionGuard(confirmSectionChange);
  useEffect(() => () => registerSectionGuard(null), []);
  const [systemTab, setSystemTab] = useSystemTab();
  const [colorField, setColorField] = useState("resolution"),
    [recognized, setRecognized] = useState<Record<string, string[]>>({});
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    api<CatalogTag[]>("tag-catalog", "GET", undefined, controller.signal)
      .then((rows) => {
        if (!current) return;
        setCatalog(rows);
        const values: Record<string, string[]> = {};
        for (const field of colorFields) {
          values[field] =
            field === "custom"
              ? customTags.map((tag) => String(tag.id))
              : rows
                  .filter((row) => row.field === field)
                  .map((row) => row.value);
        }
        setRecognized(values);
      })
      .catch(() => {});
    return () => {
      current = false;
      controller.abort();
    };
  }, [
    customTags,
    status.recognitionRevision,
    status.cacheRevision,
    JSON.stringify(status.sync),
  ]);

  useEffect(() => {
    const open = () => {
      setSystemTab("log");
      void changeSection("system");
    };
    window.addEventListener("scopearr-open-log", open);
    return () => window.removeEventListener("scopearr-open-log", open);
  });
  // Stored overrides are retained for reactivation but never resurrect inactive values.
  const colorValues = [...new Set(recognized[colorField] || [])]
    .filter(
      (value) =>
        colorField !== "resolution" ||
        value !== SD_RESOLUTION ||
        cfg.groupSD !== false,
    )
    .sort();
  const setColor = (key: string, color?: string) => {
    setCfg((current) => {
      const colors = { ...current.tagColors };
      if (color) colors[key] = color;
      else delete colors[key];
      const textColors = { ...current.tagTextColors };
      if (!color) delete textColors[key];
      return { ...current, tagColors: colors, tagTextColors: textColors };
    });
  };
  const setTextColor = (key: string, color: string) => {
    setCfg((current) => {
      const colors = { ...current.tagTextColors };
      if (color) colors[key] = color;
      else delete colors[key];
      return { ...current, tagTextColors: colors };
    });
  };

  return (
    <section class="settings-page" aria-label={t("Settings")}>
      {tagSaveReview && (
        <TagReview
          requests={tagSaveReview.requests}
          initial={tagSaveReview.previews}
          close={() => setTagSaveReview(null)}
          confirm={(tokens) => saveSettings(tagSaveReview.next, tokens, true)}
        />
      )}
      {pendingReview && (
        <TagReview
          requests={[
            {
              service: pendingReview,
              config: instanceByID(settings, pendingReview)!,
              instances: settings.instances,
            },
          ]}
          close={() => setPendingReview(null)}
          confirm={async (tokens) => {
            await api("tag-approval", "POST", {
              service: pendingReview,
              token: tokens[pendingReview],
            });
            setPendingReview(null);
            await refresh();
            notify(t("Tag changes approved."));
          }}
        />
      )}
      {tagChanges && (
        <TagPolicyDialog
          changes={tagChanges}
          busy={busy}
          close={() => setTagChanges(null)}
          save={confirmTags}
        />
      )}
      <PageHeader as="div" title={t("Settings")} />
      <div class="settings-layout">
        <nav class="settings-tabs" aria-label={t("Settings sections")}>
          {[
            ["connections", t("Services")],
            ["appearance", t("Display")],
            ["widgets", t("Widgets")],
            ["custom", t("Custom tags")],
            ["recognition", t("Tag rules")],
            ["system", t("System")],
          ].map(([value, label]) => (
            <button
              type="button"
              class={section === value ? "active" : ""}
              aria-pressed={section === value}
              onClick={() => {
                changeSection(value);
                contentRef.current?.scrollTo({ top: 0 });
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <div class="settings-content" ref={contentRef}>
          {section === "recognition" && (
            <Suspense fallback={null}>
              <RecognitionPage onDirty={setRulesDirty} saved={refresh} />
            </Suspense>
          )}
          {section === "custom" && (
            <CustomTagsSettings
              tags={customTags}
              settings={cfg}
              setSettings={setCfg}
              saveColors={() => void saveSettings(cfg)}
              colorsDirty={dirty}
              savingColors={busy}
              changed={async () => {
                const tags = await customChanged();
                if (!tags) return;
                const ids = new Set(tags.map((tag) => String(tag.id)));
                setCfg((current) => ({
                  ...current,
                  tagColors: Object.fromEntries(
                    Object.entries(current.tagColors || {}).filter(
                      ([key]) =>
                        !key.startsWith("custom:") || ids.has(key.slice(7)),
                    ),
                  ),
                  tagTextColors: Object.fromEntries(
                    Object.entries(current.tagTextColors || {}).filter(
                      ([key]) =>
                        !key.startsWith("custom:") || ids.has(key.slice(7)),
                    ),
                  ),
                  hiddenTags: Object.fromEntries(
                    Object.entries(current.hiddenTags || {}).filter(
                      ([key]) =>
                        !key.startsWith("custom:") || ids.has(key.slice(7)),
                    ),
                  ),
                }));
              }}
              onDirty={setCustomDirty}
            />
          )}
          <form
            id={settingsFormId}
            onSubmit={submit}
            hidden={["recognition", "custom"].includes(section)}
          >
            <SettingsSectionHeading
              title={
                section === "connections"
                  ? "Services"
                  : section === "appearance"
                    ? "Display"
                    : section === "widgets"
                      ? "Widgets"
                      : "System"
              }
              description={
                section === "connections"
                  ? "Configure connections, synchronization intervals and optional outbound tags."
                  : section === "appearance"
                    ? "Choose your interface language, library layout and default columns."
                    : section === "widgets"
                      ? "Choose dashboard storage paths, shared groups and chart colors."
                      : "Check synchronization, manage backups and secure your account. The log shows events from the last 24 hours."
              }
              save={
                ["system", "recognition", "custom"].includes(section)
                  ? undefined
                  : { form: settingsFormId, busy, disabled: !dirty }
              }
            />
            {demo && !["system", "recognition", "custom"].includes(section) && (
              <div class="notice">
                {t(
                  "Demo connections are locked. Try the TV view, default columns and tag colors.",
                )}
              </div>
            )}
            <div class="settings-section" hidden={section !== "widgets"}>
              {section === "widgets" && (
                <WidgetsSettings settings={cfg} changed={setCfg} demo={demo} />
              )}
            </div>
            <ConnectionSettings
              cfg={cfg}
              setCfg={setCfg}
              settings={settings}
              demo={demo}
              hidden={section !== "connections"}
            />
            <AppearanceSettings
              cfg={cfg}
              saved={settings}
              setCfg={setCfg}
              draftLocale={draftLocale}
              setDraftLocale={setDraftLocale}
              dirtyTabs={{
                general:
                  draftLocale !== locale ||
                  [
                    "interfaceTheme",
                    "seasonMode",
                    "pageSize",
                    "groupSD",
                    "groupSDLists",
                  ].some(
                    (key) =>
                      JSON.stringify(cfg[key as keyof Settings]) !==
                      JSON.stringify(settings[key as keyof Settings]),
                  ),
                lists: [
                  "listInfoOrder",
                  "listInfoVisible",
                  "columnOrder",
                  "visibleColumns",
                  "filecheckColumnOrder",
                  "filecheckVisibleColumns",
                  "placementColumnOrder",
                  "placementVisibleColumns",
                ].some(
                  (key) =>
                    JSON.stringify(cfg[key as keyof Settings]) !==
                    JSON.stringify(settings[key as keyof Settings]),
                ),
                colors: [
                  "tagColors",
                  "tagTextColors",
                  "hiddenTags",
                  "warningColors",
                ].some(
                  (key) =>
                    JSON.stringify(cfg[key as keyof Settings]) !==
                    JSON.stringify(settings[key as keyof Settings]),
                ),
              }}
              colors={
                <div class="appearance-colors">
                  <section class="connection warning-color-settings">
                    <h3 class="card-title">{t("Warning colors")}</h3>
                    <p class="quiet">
                      {t(
                        "Metadata disagreements and conflicting recognition rules use separate icons.",
                      )}
                    </p>
                    <div class="table-wrap color-table-wrap">
                      <table class="editor-table warning-colors-table">
                        <thead>
                          <tr>
                            <th scope="col">{t("Tag preview")}</th>
                            <th class="col-control" scope="col">
                              <span class="sr-only">{t("Color")}</span>
                            </th>
                            <th class="col-control" scope="col">
                              <span class="sr-only">{t("Reset")}</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {["metadata", "recognition"].map((key) => (
                            <tr>
                              <td>
                                <label
                                  style={{ color: cfg.warningColors[key] }}
                                >
                                  {key === "metadata" ? (
                                    <TriangleAlert size={ICON.button} />
                                  ) : (
                                    <OctagonAlert size={ICON.button} />
                                  )}{" "}
                                  {t(
                                    key === "metadata"
                                      ? "Metadata disagreement"
                                      : "Conflicting recognition rules",
                                  )}
                                </label>
                              </td>
                              <td class="col-control">
                                <input
                                  type="color"
                                  aria-label={t(
                                    key === "metadata"
                                      ? "Metadata warning color"
                                      : "Recognition warning color",
                                  )}
                                  value={cfg.warningColors[key]}
                                  onInput={(e) =>
                                    setCfg({
                                      ...cfg,
                                      warningColors: {
                                        ...cfg.warningColors,
                                        [key]: e.currentTarget.value,
                                      },
                                    })
                                  }
                                />
                              </td>
                              <td class="col-control">
                                <button
                                  type="button"
                                  class="icon-button color-reset"
                                  aria-label={t("Restore defaults")}
                                  title={t("Restore defaults")}
                                  onClick={async () => {
                                    if (
                                      await confirmReset(
                                        t(
                                          "Reset this warning color to its default?",
                                        ),
                                      )
                                    )
                                      setCfg({
                                        ...cfg,
                                        warningColors: {
                                          ...cfg.warningColors,
                                          [key]: defaultWarningColors[key],
                                        },
                                      });
                                  }}
                                >
                                  <RotateCcw size={ICON.button} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                  <section class="connection tag-color-settings">
                    <CardHeading title={t("Tag colors")} />
                    <p class="quiet">
                      {t(
                        "Custom colors apply to both libraries and themes. They remain saved until reset.",
                      )}
                    </p>
                    <label class="standalone-field">
                      {t("Tag field")}
                      <select
                        aria-label={t("Tag field")}
                        value={colorField}
                        onChange={(e) => setColorField(e.currentTarget.value)}
                      >
                        {colorFields.map((field) => (
                          <option value={field}>{labels[field]}</option>
                        ))}
                      </select>
                    </label>
                    <div class="table-wrap color-table-wrap">
                      <table class="editor-table">
                        <thead>
                          <tr>
                            <th scope="col">{t("Tag preview")}</th>
                            <th scope="col" class="number">
                              {t("Count")}
                            </th>
                            <th
                              scope="col"
                              class="tag-display-column col-control"
                            >
                              <span class="sr-only">{t("Display column")}</span>
                            </th>
                            <th class="col-control" scope="col">
                              <span class="sr-only">{t("Color")}</span>
                            </th>
                            <th class="col-control" scope="col">
                              <span class="sr-only">{t("Text")}</span>
                            </th>
                            <th class="col-control" scope="col">
                              <span class="sr-only">{t("Reset")}</span>
                            </th>
                            <th class="col-control" scope="col">
                              <span class="sr-only">{t("Actions")}</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {colorValues
                            .filter(
                              (value) =>
                                colorField !== "language" ||
                                value !== "__unknown__",
                            )
                            .map((value) => {
                              const key = colorField + ":" + value;
                              const virtualSD =
                                colorField === "resolution" &&
                                value === SD_RESOLUTION;
                              const custom = customTags.find(
                                (tag) => String(tag.id) === value,
                              );
                              const links =
                                colorField === "custom"
                                  ? custom?.count || 0
                                  : catalog.find(
                                      (row) =>
                                        row.field === colorField &&
                                        row.value === value,
                                    )?.count || 0;
                              const label =
                                value === "__unknown__"
                                  ? t("Unknown")
                                  : colorField === "language"
                                    ? t(audioLanguageLabel(value, getLocale()))
                                    : colorField === "custom"
                                      ? customTags.find(
                                          (tag) => String(tag.id) === value,
                                        )?.name || value
                                      : presentedTagLabel(
                                          colorField,
                                          value,
                                          tagLabels,
                                        );
                              return (
                                <tr>
                                  <td>
                                    <span class="tag-preview-label">
                                      {colorField === "language" ? (
                                        <LanguageFlag
                                          value={value}
                                          colors={cfg.tagColors || {}}
                                        />
                                      ) : (
                                        <Tag
                                          kind={colorField}
                                          forceTag
                                          value={
                                            value === "__unknown__" ? "" : value
                                          }
                                          colors={cfg.tagColors || {}}
                                          textColors={cfg.tagTextColors || {}}
                                        ></Tag>
                                      )}
                                      {catalog.find(
                                        (row) =>
                                          row.field === colorField &&
                                          row.value === value,
                                      )?.mediaServer && (
                                        <HelpPopover
                                          variant="notice"
                                          label="Media server metadata"
                                          text="This value is used from Emby or Jellyfin metadata in your library. A tag rule may also recognize the same value. This marker does not change tag display, filtering or synchronization."
                                        />
                                      )}
                                    </span>
                                  </td>
                                  <td class="tag-link-count number">{links}</td>
                                  <td class="tag-display-column col-control">
                                    <label class="tag-display-toggle">
                                      <input
                                        type="checkbox"
                                        aria-label={t("Display tag: {value}", {
                                          value: label,
                                        })}
                                        checked={!cfg.hiddenTags?.[key]}
                                        onChange={(e) => {
                                          const hiddenTags = {
                                            ...cfg.hiddenTags,
                                          };
                                          if (e.currentTarget.checked)
                                            delete hiddenTags[key];
                                          else hiddenTags[key] = true;
                                          setCfg({ ...cfg, hiddenTags });
                                        }}
                                      />
                                    </label>
                                  </td>
                                  <td class="col-control">
                                    <input
                                      type="color"
                                      aria-label={t("Color for {value}", {
                                        value: label,
                                      })}
                                      value={
                                        cfg.tagColors?.[key] ||
                                        defaultColor(colorField, value)
                                      }
                                      onInput={(e) =>
                                        setColor(key, e.currentTarget.value)
                                      }
                                    />
                                  </td>
                                  <td class="col-control">
                                    <button
                                      type="button"
                                      class="icon-button tag-text-color color-action"
                                      disabled={colorField === "language"}
                                      aria-label={
                                        t("Text color for {value}", {
                                          value: label,
                                        }) +
                                        ": " +
                                        t(
                                          cfg.tagTextColors?.[key] === "#000000"
                                            ? "Black"
                                            : cfg.tagTextColors?.[key] ===
                                                "#ffffff"
                                              ? "White"
                                              : "Automatic",
                                        )
                                      }
                                      title={t(
                                        cfg.tagTextColors?.[key] === "#000000"
                                          ? "Black"
                                          : cfg.tagTextColors?.[key] ===
                                              "#ffffff"
                                            ? "White"
                                            : "Automatic",
                                      )}
                                      onClick={() =>
                                        setTextColor(
                                          key,
                                          cfg.tagTextColors?.[key] === "#000000"
                                            ? "#ffffff"
                                            : cfg.tagTextColors?.[key] ===
                                                "#ffffff"
                                              ? ""
                                              : "#000000",
                                        )
                                      }
                                    >
                                      <span
                                        aria-hidden="true"
                                        style={colorStyle(
                                          cfg.tagColors?.[key] ||
                                            defaultColor(colorField, value),
                                          cfg.tagTextColors?.[key],
                                        )}
                                      >
                                        Aa
                                      </span>
                                    </button>
                                  </td>
                                  <td class="col-control">
                                    <button
                                      type="button"
                                      class="icon-button color-action"
                                      disabled={
                                        !cfg.tagColors?.[key] &&
                                        !cfg.tagTextColors?.[key]
                                      }
                                      onClick={async () => {
                                        if (
                                          await confirmReset(
                                            t(
                                              "Reset background and text colors for {value}?",
                                              { value: label },
                                            ),
                                          )
                                        )
                                          setColor(key);
                                      }}
                                      aria-label={t(
                                        "Default color for {value}",
                                        {
                                          value: label,
                                        },
                                      )}
                                      title={t("Default color for {value}", {
                                        value: label,
                                      })}
                                    >
                                      <RotateCcw size={ICON.button} />
                                    </button>
                                  </td>
                                  <td class="col-control">
                                    <button
                                      type="button"
                                      class="icon-button danger-button color-action"
                                      aria-label={t("Delete tag: {name}", {
                                        name: label,
                                      })}
                                      disabled={
                                        virtualSD ||
                                        links > 0 ||
                                        !!custom?.protected
                                      }
                                      onClick={async () => {
                                        if (
                                          !(await confirmDeletion(
                                            t("Delete tag {name}?", {
                                              name: label,
                                            }),
                                          ))
                                        )
                                          return;
                                        try {
                                          if (colorField === "custom") {
                                            await api(
                                              "custom-tags/batch",
                                              "PUT",
                                              {
                                                original: customTags,
                                                tags: customTags.filter(
                                                  (tag) =>
                                                    String(tag.id) !== value,
                                                ),
                                              },
                                            );
                                            await customChanged();
                                          } else {
                                            await api("tag-catalog", "DELETE", {
                                              field: colorField,
                                              value,
                                            });
                                            await saved(
                                              await api<Settings>("settings"),
                                            );
                                          }
                                          setCatalog((old) =>
                                            old.filter(
                                              (row) =>
                                                row.field !== colorField ||
                                                row.value !== value,
                                            ),
                                          );
                                          setRecognized((old) => ({
                                            ...old,
                                            [colorField]: (
                                              old[colorField] || []
                                            ).filter((v) => v !== value),
                                          }));
                                          setColor(key);
                                          setCfg((current) => {
                                            const hiddenTags = {
                                              ...current.hiddenTags,
                                            };
                                            delete hiddenTags[key];
                                            return { ...current, hiddenTags };
                                          });
                                          await refresh();
                                          notify(t("Settings saved."));
                                        } catch {}
                                      }}
                                      title={t("Delete tag: {name}", {
                                        name: label,
                                      })}
                                    >
                                      <Trash2 size={ICON.button} />
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                    {!colorValues.length && (
                      <p class="quiet">
                        {t(
                          colorField === "custom"
                            ? "No custom tags assigned yet. Assign tags in your library or add a filename rule."
                            : "No tags detected yet. Sync a library first.",
                        )}
                      </p>
                    )}
                  </section>
                </div>
              }
              hidden={section !== "appearance"}
            />
            <SystemSettingsInfo
              active={section === "system"}
              tab={systemTab}
              setTab={setSystemTab}
              status={status}
              settings={settings}
              demo={demo}
              refresh={refresh}
              reviewTags={(service) => setPendingReview(service)}
            />
          </form>
          {section === "system" && systemTab === "log" && (
            <SystemSettingsLog status={status} demo={demo} />
          )}
          <form
            id="password-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (demo) return;
              const fields = new FormData(e.currentTarget);
              try {
                await api("password", "PUT", {
                  current: fields.get("current"),
                  password: fields.get("password"),
                });
                location.reload();
              } catch {}
            }}
          />
        </div>
      </div>
    </section>
  );
}
