import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type StateUpdater,
} from "preact/hooks";
import {
  readNavigation,
  writeSessionPreference,
  type NavigationState,
} from "../browser-storage";
import { confirmDiscard } from "../confirmation";
import { filesTabVisible } from "../filecheck";
import { t } from "../i18n";
import { muxTabVisible } from "../mux-spec";
import { disksTabVisible } from "../placement";
import type { Service, Status } from "../types";

export type AppView = NavigationState["view"];
export type AppNavigation = {
  view: AppView;
  setView: (v: AppView) => void;
  service: Service;
  setService: (s: Service) => void;
  filters: Record<Service, string>;
  setFilters: Dispatch<StateUpdater<Record<Service, string>>>;
  page: number;
  setPage: Dispatch<StateUpdater<number>>;
  settingsOpen: boolean;
  settingsSection: string;
  setSettingsSection: (s: string) => void;
  setSettingsDirty: (dirty: boolean) => void;
  placementFileSearch: boolean;
  setPlacementFileSearch: (v: boolean) => void;
  openSettings: (section?: string) => void;
  canLeaveRules: () => Promise<boolean>;
  pruneCustomFilters: (ids: Set<string>) => void;
};

// The current page, library filters and settings section persist per tab in
// sessionStorage (scopearr-navigation) and are restored on mount.
export function useAppNavigation(status: Status): AppNavigation {
  const [navigation] = useState(readNavigation);
  const [service, setService] = useState<Service>(navigation.service),
    [view, setView] = useState<
      "library" | "statistics" | "mux" | "disks" | "files"
    >(navigation.view),
    [filters, setFilters] = useState<Record<Service, string>>(
      navigation.filters,
    ),
    [page, setPage] = useState(navigation.page),
    [settingsDirty, setSettingsDirty] = useState(false),
    [settingsOpen, setSettingsOpen] = useState(navigation.settingsOpen),
    [settingsSection, setSettingsSection] = useState(
      navigation.settingsSection,
    );
  useEffect(() => {
    writeSessionPreference(
      "scopearr-navigation",
      JSON.stringify({
        view,
        service,
        page,
        filters,
        settingsOpen,
        settingsSection,
      }),
    );
  }, [view, service, page, filters, settingsOpen, settingsSection]);
  const libraryScroll = useRef(0);
  const openSettings = (section = "connections") => {
    if (!settingsOpen) libraryScroll.current = window.scrollY;
    setSettingsSection(section);
    setSettingsOpen(true);
  };
  useEffect(() => {
    // An open settings dialog switches itself; otherwise open it on System.
    const open = () => {
      if (!settingsOpen) openSettings("system");
    };
    window.addEventListener("scopearr-open-log", open);
    return () => window.removeEventListener("scopearr-open-log", open);
  });
  const canLeaveRules = async () => {
    if (
      settingsOpen &&
      settingsDirty &&
      !(await confirmDiscard(t("Discard unsaved settings changes?")))
    )
      return false;
    setSettingsOpen(false);
    return true;
  };
  // Drops custom tag filters whose tag no longer exists.
  const pruneCustomFilters = (ids: Set<string>) =>
    setFilters(
      (current) =>
        Object.fromEntries(
          Object.entries(current).map(([service, query]) => {
            const q = new URLSearchParams(query);
            const selected = q.getAll("custom");
            q.delete("custom");
            selected
              .filter((id) => id === "__unknown__" || ids.has(id))
              .forEach((id) => q.append("custom", id));
            if (!q.has("custom")) q.delete("customOp");
            return [service, q.toString()];
          }),
        ) as Record<Service, string>,
    );
  const [placementFileSearch, setPlacementFileSearch] = useState(false);
  useEffect(() => {
    if (view === "disks" && !disksTabVisible(status)) setView("library");
  }, [view, status.unraid?.enabled]);
  useEffect(() => {
    if (view === "mux" && !muxTabVisible(status)) setView("library");
    if (view === "files" && !filesTabVisible(status) && !placementFileSearch)
      setView("library");
    if (view !== "files" && placementFileSearch) setPlacementFileSearch(false);
  }, [
    view,
    status.mux?.enabled,
    status.mux?.pending,
    status.mux?.running,
    status.mux?.failed,
    status.files?.available,
    placementFileSearch,
  ]);
  return {
    view,
    setView,
    service,
    setService,
    filters,
    setFilters,
    page,
    setPage,
    settingsOpen,
    settingsSection,
    setSettingsSection,
    setSettingsDirty,
    placementFileSearch,
    setPlacementFileSearch,
    openSettings,
    canLeaveRules,
    pruneCustomFilters,
  };
}
