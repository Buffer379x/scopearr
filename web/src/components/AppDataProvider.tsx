import { createContext, type ComponentChildren, type JSX } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";
import { t } from "../i18n";
import { notify } from "../notifications";
import type { CustomTag, Preset, Settings, Status } from "../types";
import {
  CustomTagNames,
  HiddenTags,
  SDListGrouping,
  TagColors,
  TagLabels,
  TagTextColors,
  TagVisibility,
} from "../ui";

export type AppData = {
  settings: Settings | null;
  setSettings: (s: Settings | null) => void;
  loadSettings: () => Promise<void>;
  presets: Preset[];
  loadPresets: () => Promise<void>;
  customTags: CustomTag[];
  customRevision: number;
  loadCustom: () => Promise<CustomTag[] | undefined>;
};

const AppDataContext = createContext<AppData | null>(null);

// Loads settings, presets, custom tags and tag presentation once for the app
// and provides them with the tag presentation contexts.
export function AppDataProvider({
  status,
  customTagsLoaded,
  children,
}: {
  status: Status;
  refresh: () => Promise<void>;
  customTagsLoaded: (ids: Set<string>) => void;
  children: ComponentChildren;
}): JSX.Element {
  const [customTags, setCustomTags] = useState<CustomTag[]>([]);
  const [customRevision, setCustomRevision] = useState(0);
  const reviewNotified = useRef<Record<string, boolean>>({});
  useEffect(() => {
    for (const service of Object.keys(status.tagSync || {})) {
      const required = !!status.tagSync?.[service]?.approvalRequired;
      if (required && !reviewNotified.current[service])
        notify(t("Tag removals need review in Settings → System."), "warning");
      reviewNotified.current[service] = required;
    }
  }, [status.tagSync]);
  const [tagLabels, setTagLabels] = useState<Record<string, string>>({});
  const [tagVisibility, setTagVisibility] = useState<Record<
    string,
    string[]
  > | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    api<{ tags: Record<string, string[]>; labels: Record<string, string> }>(
      "tag-presentation",
      "GET",
      undefined,
      controller.signal,
    )
      .then((tags) => {
        if (current) {
          setTagVisibility(tags.tags);
          setTagLabels(tags.labels);
        }
      })
      .catch(() => {});
    return () => {
      current = false;
      controller.abort();
    };
  }, [status.recognitionRevision, JSON.stringify(status.sync), customRevision]);
  const customRequest = useRef(0);
  useEffect(
    () => () => {
      ++customRequest.current;
    },
    [],
  );
  const loadCustom = async () => {
    const request = ++customRequest.current;
    const tags = await api<CustomTag[]>("custom-tags");
    if (request !== customRequest.current) return;
    setCustomTags(tags);
    setCustomRevision((value) => value + 1);
    const ids = new Set(tags.map((tag) => String(tag.id)));
    customTagsLoaded(ids);
    return tags;
  };
  useEffect(() => {
    loadCustom().catch(() => {});
  }, [status.cacheRevision]);
  const [settings, setSettings] = useState<Settings | null>(null),
    [presets, setPresets] = useState<Preset[]>([]);
  const loadSettings = async () => setSettings(await api<Settings>("settings"));
  const loadPresets = async () => setPresets(await api<Preset[]>("presets"));
  useEffect(() => {
    loadSettings().catch(() => {});
    loadPresets().catch(() => {});
  }, []);
  return (
    <AppDataContext.Provider
      value={{
        settings,
        setSettings,
        loadSettings,
        presets,
        loadPresets,
        customTags,
        customRevision,
        loadCustom,
      }}
    >
      <CustomTagNames.Provider
        value={Object.fromEntries(
          customTags.map((tag) => [
            String(tag.id),
            tag.displayName || tag.name,
          ]),
        )}
      >
        <TagLabels.Provider value={tagLabels}>
          <SDListGrouping.Provider
            value={settings?.groupSD !== false && !!settings?.groupSDLists}
          >
            <TagVisibility.Provider value={tagVisibility}>
              <HiddenTags.Provider value={settings?.hiddenTags || {}}>
                <TagColors.Provider value={settings?.tagColors || {}}>
                  <TagTextColors.Provider value={settings?.tagTextColors || {}}>
                    {children}
                  </TagTextColors.Provider>
                </TagColors.Provider>
              </HiddenTags.Provider>
            </TagVisibility.Provider>
          </SDListGrouping.Provider>
        </TagLabels.Provider>
      </CustomTagNames.Provider>
    </AppDataContext.Provider>
  );
}

export function useAppData(): AppData {
  const data = useContext(AppDataContext);
  if (!data) throw new Error("useAppData must be used inside AppDataProvider");
  return data;
}
