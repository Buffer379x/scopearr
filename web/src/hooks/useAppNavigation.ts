import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type StateUpdater,
} from "preact/hooks";
import {
  readNavigation,
  readPreference,
  writePreference,
  writeSessionPreference,
  type NavigationState,
} from "../browser-storage";
import { nextTableSort } from "../components/SortableHeader";
import { confirmDiscard } from "../confirmation";
import { SYSTEM_TAB_KEY } from "../event-log";
import { filesTabVisible } from "../filecheck";
import { t } from "../i18n";
import { muxTabVisible } from "../mux-spec";
import { disksTabVisible } from "../placement";
import { MOVIE_SORT_FIELDS } from "../router";
import type { ToolView } from "../router";
import type { FilmSort, Service, Status } from "../types";

const defaultLibrarySort: FilmSort = { field: "title", direction: "asc" };
function initialMovieSort(service: Service): FilmSort | null {
  try {
    const saved = JSON.parse(
      readPreference(
        service === "sonarr" ? "scopearr-series-sort" : "scopearr-film-sort",
      ) || "null",
    );
    if (saved?.field === "language") saved.field = "audio";
    if (
      saved &&
      MOVIE_SORT_FIELDS.includes(saved.field) &&
      (saved.direction === "asc" || saved.direction === "desc")
    )
      return saved.field === "title" && saved.direction === "asc"
        ? null
        : saved;
  } catch {}
  return null;
}

// The session keys the tabbed settings sections start from.
const settingsTabKeys = new Map([
  ["connections", "scopearr-service-settings"],
  ["appearance", "scopearr-display-tab"],
  ["system", SYSTEM_TAB_KEY],
]);

export type AppView = NavigationState["view"];
export type AppNavigation = {
  view: AppView;
  service: Service;
  filters: Record<Service, string>;
  page: number;
  sorts: Record<Service, FilmSort | null>;
  movieSort: FilmSort;
  settingsOpen: boolean;
  settingsSection: string;
  placementFileSearch: boolean;
  // Actions that open another view. They are synchronous; callers that can
  // leave open settings await canLeaveRules() first.
  openDashboard(): void;
  openLibrary(
    service: Service,
    target: { instance: string } | { query: string },
  ): void;
  openTool(tool: ToolView): void;
  openFiles(path: string): void;
  openMuxFile(name: string): void;
  openSettings(section?: string, tab?: string): void;
  // Filter, page and sort changes within the current view.
  setFilters: Dispatch<StateUpdater<Record<Service, string>>>;
  setPage: Dispatch<StateUpdater<number>>;
  sortLibrary(field: string): void;
  pruneCustomFilters(ids: Set<string>): void;
  // The leave guard for unsaved settings.
  canLeaveRules(): Promise<boolean>;
  setSettingsDirty(dirty: boolean): void;
};

// The current page, library filters and settings section persist per tab in
// sessionStorage (scopearr-navigation) and are restored on mount. Pages change
// them only through the named actions below.
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
  const [sorts, setSorts] = useState<Record<Service, FilmSort | null>>(() => ({
    radarr: initialMovieSort("radarr"),
    sonarr: initialMovieSort("sonarr"),
  }));
  const movieSort = sorts[service] || defaultLibrarySort;
  const setMovieSort = (value: FilmSort | null) =>
    setSorts((current) => ({ ...current, [service]: value }));
  useEffect(() => {
    writePreference(
      "scopearr-film-sort",
      JSON.stringify(sorts.radarr || defaultLibrarySort),
    );
    writePreference(
      "scopearr-series-sort",
      JSON.stringify(sorts.sonarr || defaultLibrarySort),
    );
  }, [sorts]);
  const sortLibrary = (field: string) => {
    setMovieSort(nextTableSort(sorts[service], field));
    setPage(1);
  };
  const libraryScroll = useRef(0);
  const openSettings = (section = "connections", tab?: string) => {
    const tabKey = settingsTabKeys.get(section);
    if (tabKey && tab !== undefined) writeSessionPreference(tabKey, tab);
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
  const openDashboard = () => setView("statistics");
  // An instance target sets or clears the instance filter (empty = every
  // instance); a query target replaces the service's filters.
  const openLibrary = (
    target: Service,
    to: { instance: string } | { query: string },
  ) => {
    setView("library");
    setFilters((current) => {
      if ("query" in to) return { ...current, [target]: to.query };
      const n = new URLSearchParams(current[target]);
      if (to.instance) n.set("instance", to.instance);
      else n.delete("instance");
      return { ...current, [target]: n.toString() };
    });
    setPage(1);
    setService(target);
  };
  const openTool = (tool: ToolView) => setView(tool);
  // Disk placement opens one path in Files & permissions, even while that
  // tool is hidden.
  const openFiles = (path: string) => {
    setPlacementFileSearch(true);
    writePreference(
      "scopearr-filecheck-filters",
      JSON.stringify({
        q: path,
        statuses: [],
        targets: [],
        kinds: [],
      }),
    );
    writeSessionPreference("scopearr-filecheck-page", "1");
    setView("files");
  };
  const openMuxFile = (name: string) => {
    writePreference(
      "scopearr-mux-filters",
      JSON.stringify({ q: name, statuses: [] }),
    );
    setView("mux");
  };
  return {
    view,
    service,
    filters,
    page,
    sorts,
    movieSort,
    settingsOpen,
    settingsSection,
    placementFileSearch,
    openDashboard,
    openLibrary,
    openTool,
    openFiles,
    openMuxFile,
    openSettings,
    setFilters,
    setPage,
    sortLibrary,
    pruneCustomFilters,
    canLeaveRules,
    setSettingsDirty,
  };
}
