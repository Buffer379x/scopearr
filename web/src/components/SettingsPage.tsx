import { colorFields } from "../ui";
import { instanceByID } from "../instances";
import { t, useI18n } from "../i18n";
import { notify } from "../notifications";
import type { CustomTag } from "../types";
import { AppearanceSettings, useDisplayTab } from "./AppearanceSettings";
import { ConnectionSettings } from "./ConnectionSettings";
import { CustomTagsSettings } from "./CustomTagsSettings";
import {
  SystemSettingsInfo,
  SystemSettingsLog,
  useSystemTab,
} from "./SystemSettings";
import { SettingsHeader } from "./settings/SettingsHeader";
import { TagColorsCard, type CatalogTag } from "./settings/TagColorsCard";
import { WarningColorsCard } from "./settings/WarningColorsCard";
import { TagPolicyDialog } from "./TagPolicyDialog";
import { TagReview } from "./TagReview";
import { WidgetsSettings } from "./WidgetsSettings";

import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { Settings, Status } from "../types";
import type { syncSummary } from "../frame-status";

import { api } from "../api";
import {
  setBandPreference,
  setTheme,
  storedBand,
  type Theme,
} from "../appearance";
import type { SectionGuard } from "../hooks/useAppNavigation";
import { lazyChunk, useLazyChunk } from "../hooks/useLazyChunk";
import { useSettingsDraft } from "../hooks/useSettingsDraft";
import type { SettingsSectionId } from "../router";
import { displayDirty } from "../settings-model";

// Tag rules is a lazy chunk (lazyChunk: one import at a time, once more
// after a failure, the error notice when it cannot load; a module without
// the page counts as a failure). Until it has arrived, the area's band
// stands in its place with Save locked, so the band never shows a gap. Not
// a Suspense fallback: one that renders the band sets the shell's title on
// each mount, and Suspense mounts its fallback again on every render of the
// shell while it waits, so that loop starved the chunk's own request. The
// import's failure is handled on the import() itself, inside Vite's preload
// wrapper: the idle preload runs on every area, and a failure there must
// never raise vite:preloadError (preload-recovery.ts would reload the page).
const rulesChunk = lazyChunk(() =>
  import("./RecognitionPage").then(
    (module) => module?.RecognitionPage ?? null,
    () => null,
  ),
);
const keepBand = () => {};
export function SettingsPage({
  customTags,
  customChanged,
  settings,
  status,
  summary,
  demo,
  saved,
  onDirty,
  refresh,
  section,
  registerSectionGuard,
  tab,
  setTab,
  logQuery,
  setLogQuery,
  revision,
  theme,
  onTheme,
}: {
  customTags: CustomTag[];
  customChanged: () => Promise<CustomTag[] | undefined>;
  settings: Settings;
  status: Status;
  // The frame's sync summary, for the status lines of the service cards
  // and System → Info.
  summary: ReturnType<typeof syncSummary>;
  demo: boolean;
  saved: (settings: Settings) => Promise<void>;
  onDirty: (dirty: boolean) => void;
  refresh: () => Promise<void>;
  section: string;
  registerSectionGuard: (
    guard: SectionGuard | null,
    replacing?: SectionGuard,
  ) => void;
  // The route's tab of this section and the log query of System → Log;
  // revision starts the log again for a link to it.
  tab: string;
  setTab: (tab: string) => void;
  logQuery: string;
  setLogQuery: (query: string) => void;
  revision: number;
  // The shell's shown mode and its setter: a saved mode draft goes there,
  // so the topbar and the palette follow (ruling P1).
  theme: Theme;
  onTheme: (theme: Theme) => void;
}) {
  const { locale } = useI18n();
  const settingsFormId = useId();
  const [pendingReview, setPendingReview] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogTag[]>([]);
  const {
    cfg,
    setCfg,
    draftLocale,
    setDraftLocale,
    draftPrefs,
    setDraftPrefs,
    savedPrefs,
    look,
    setLook,
    mode,
    dirty,
    setRulesDirty,
    setCustomDirty,
    busy,
    confirmSectionChange,
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
    onDirty,
    saved,
    theme,
    // After a successful save: the band, then the mode on <html>, and the
    // shell follows.
    appearance: (next) => {
      const root = document.documentElement;
      if (next.band !== undefined) setBandPreference(root, next.band);
      if (next.mode) {
        setTheme(root, next.mode);
        onTheme(next.mode);
      }
    },
  });
  // Navigation away from this section asks through the guard of the current
  // draft, so it is registered on every render. On unmount it is dropped
  // only while it is still the registered one: a page that started again
  // keeps its own.
  const guard = useRef(confirmSectionChange);
  guard.current = confirmSectionChange;
  registerSectionGuard(confirmSectionChange);
  useEffect(() => () => registerSectionGuard(null, guard.current), []);
  // The rules page once its chunk is there (preloaded at idle on every
  // area); when it cannot load, the band stays (keepBand).
  const Rules = useLazyChunk(rulesChunk, section === "recognition", keepBand);
  // Hidden sections never read another section's tab.
  const sectionTab = (id: string) => (section === id ? tab : "");
  const [systemTab, setSystemTab] = useSystemTab(sectionTab("system"), setTab);
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

  // The band shown: the draft's (null: no choice), else the stored one.
  const savedBand = storedBand(),
    band = look.band !== undefined ? look.band : savedBand;
  const [displayTab, setDisplayTab] = useDisplayTab(
    sectionTab("appearance"),
    setTab,
  );
  const displayTabs = displayDirty(cfg, settings, {
    locale: draftLocale,
    savedLocale: locale,
    prefs: draftPrefs,
    savedPrefs,
    mode: mode ?? theme,
    savedMode: theme,
    band,
    savedBand,
  });
  // Every area is on the v2 blocks (Phase 5c); Custom tags and Tag rules
  // render their own band, so this page renders none for them.
  const ownBand = section === "custom" || section === "recognition";

  return (
    <section class="v2-set-page" aria-label={t("Settings")}>
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
      {!ownBand && (
        <SettingsHeader
          section={section as SettingsSectionId}
          save={
            section === "system"
              ? undefined
              : { form: settingsFormId, busy, disabled: !dirty, dirty }
          }
          segment={
            section === "appearance"
              ? {
                  label: t("Display sections"),
                  idPrefix: "display",
                  value: displayTab,
                  items: [
                    {
                      value: "general",
                      label: t("General"),
                      dirty: displayTabs.general,
                    },
                    {
                      value: "lists",
                      label: t("Lists & columns"),
                      dirty: displayTabs.lists,
                    },
                    {
                      value: "colors",
                      label: t("Colors"),
                      dirty: displayTabs.colors,
                    },
                  ],
                  select: setDisplayTab,
                }
              : section === "system"
                ? {
                    label: t("System sections"),
                    idPrefix: "system",
                    value: systemTab,
                    items: [
                      { value: "info", label: t("Info") },
                      { value: "log", label: t("Log") },
                    ],
                    select: setSystemTab,
                  }
                : undefined
          }
        />
      )}
      <div class="v2-set-layout">
        <div class="v2-set-content">
          {section === "recognition" &&
            (Rules ? (
              <Rules onDirty={setRulesDirty} saved={refresh} />
            ) : (
              <SettingsHeader
                section="recognition"
                save={{ busy: false, disabled: true, dirty: false }}
              />
            ))}
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
            class="v2-set"
            onSubmit={submit}
            hidden={ownBand || (section === "system" && systemTab === "log")}
          >
            {demo && !ownBand && section !== "system" && (
              <div class="v2-notice">
                {t(
                  "Demo connections are locked. Try the TV view, default columns and tag colors.",
                )}
              </div>
            )}
            {section === "widgets" && (
              <WidgetsSettings settings={cfg} changed={setCfg} demo={demo} />
            )}
            <ConnectionSettings
              cfg={cfg}
              setCfg={setCfg}
              settings={settings}
              status={status}
              summary={summary}
              refresh={refresh}
              reviewTags={setPendingReview}
              demo={demo}
              hidden={section !== "connections"}
              tab={sectionTab("connections")}
              setTab={setTab}
            />
            <AppearanceSettings
              cfg={cfg}
              saved={settings}
              setCfg={setCfg}
              draftLocale={draftLocale}
              setDraftLocale={setDraftLocale}
              draftPrefs={draftPrefs}
              setDraftPrefs={setDraftPrefs}
              colors={
                <>
                  <WarningColorsCard cfg={cfg} setCfg={setCfg} />
                  <TagColorsCard
                    cfg={cfg}
                    setCfg={setCfg}
                    customTags={customTags}
                    catalog={catalog}
                    recognized={recognized}
                    colorField={colorField}
                    setColorField={setColorField}
                    customChanged={customChanged}
                    saved={saved}
                    refresh={refresh}
                    setCatalog={setCatalog}
                    setRecognized={setRecognized}
                  />
                </>
              }
              mode={mode ?? theme}
              band={band}
              changeLook={(next) =>
                setLook({
                  mode: next.mode === theme ? undefined : next.mode,
                  band: next.band === savedBand ? undefined : next.band,
                })
              }
              hidden={section !== "appearance"}
              tab={displayTab}
            />
            <SystemSettingsInfo
              active={section === "system" && systemTab === "info"}
              status={status}
              settings={settings}
              summary={summary}
              demo={demo}
              refresh={refresh}
              reviewTags={(service) => setPendingReview(service)}
            />
          </form>
          {section === "system" && systemTab === "log" && (
            <SystemSettingsLog
              revision={revision}
              status={status}
              demo={demo}
              query={logQuery}
              setQuery={setLogQuery}
            />
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
