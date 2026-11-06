import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type StateUpdater,
} from "preact/hooks";
import {
  readPreference,
  readSessionPreference,
  removeSessionPreference,
  writePreference,
  writeSessionPreference,
} from "../browser-storage";
import { nextTableSort } from "../components/SortableHeader";
import { confirmDiscard } from "../confirmation";
import { SYSTEM_TAB_KEY } from "../event-log";
import { filesTabVisible } from "../filecheck";
import { t } from "../i18n";
import { muxTabVisible } from "../mux-spec";
import { disksTabVisible } from "../placement";
import { createRouteHistory } from "../route-history";
import { formatRoute, MOVIE_SORT_FIELDS, parseRoute } from "../router";
import type { Route, SettingsSectionId, ToolView } from "../router";
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

// Both libraries' filters, so the library that is not in the route keeps its
// filters through a reload, as the stored navigation state of 1.7.0 did.
const LIBRARY_FILTERS_KEY = "scopearr-library-filters";
function storedLibraryFilters(): Record<Service, string> {
  try {
    const value = JSON.parse(
      readSessionPreference(LIBRARY_FILTERS_KEY) || "null",
    );
    return {
      radarr: typeof value?.radarr === "string" ? value.radarr : "",
      sonarr: typeof value?.sonarr === "string" ? value.sonarr : "",
    };
  } catch {
    return { radarr: "", sonarr: "" };
  }
}

export type AppView = Exclude<Route["view"], "settings">;
// Asks the open settings page whether another section may open; true when
// allowed (unsaved changes of the section are then discarded).
export type SectionGuard = (next: string) => Promise<boolean>;
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
  // The route of this state (its hash is the address of the view). revision
  // counts accepted Back/Forward steps and links, and pushes that open the
  // same page with other page parameters; settingsMount counts settings
  // reopened after canLeaveRules() allowed leaving them (the header Settings
  // button). Pages start again when they change.
  route: Route;
  revision: number;
  settingsMount: number;
  // The shown route came from Back, Forward or a typed link: its tool page
  // takes what the route leaves out as defaults, not from storage.
  fromHistory: boolean;
  // Actions that open another view push a history entry when the hash
  // changes. They are synchronous and never ask: every caller awaits
  // canLeaveRules() first, the section buttons ask through changeSection.
  openDashboard(): void;
  openLibrary(
    service: Service,
    target: { instance: string } | { query: string },
  ): void;
  openTool(tool: ToolView): void;
  openFiles(path: string): void;
  openMuxFile(name: string): void;
  openSettings(section?: string, tab?: string): void;
  // Filter, page and sort changes within the current view, and the
  // parameters a page owns (settings tab, tool or log query), replace the
  // current entry.
  setFilters: Dispatch<StateUpdater<Record<Service, string>>>;
  setPage: Dispatch<StateUpdater<number>>;
  sortLibrary(field: string): void;
  pruneCustomFilters(ids: Set<string>): void;
  replaceRoute(patch: { tab?: string; query?: string }): void;
  // The leave guards for unsaved settings. The settings page registers its
  // section guard while it is mounted; with `replacing`, only that guard is
  // replaced.
  canLeaveRules(): Promise<boolean>;
  canChangeSection(next: string): Promise<boolean>;
  setSettingsDirty(dirty: boolean): void;
  setSectionGuard(guard: SectionGuard | null, replacing?: SectionGuard): void;
};

// The view lives in the URL hash (see router.ts): it starts from the route,
// writes every change back (push for actions, replace otherwise) and follows
// Back, Forward and links after the leave guards agree.
export function useAppNavigation(status: Status): AppNavigation {
  const [routes] = useState(() =>
    createRouteHistory(window, {
      storage: {
        getItem: readSessionPreference,
        setItem: writeSessionPreference,
        removeItem: removeSessionPreference,
      },
    }),
  );
  const [start] = useState(() => parseRoute(routes.hash()));
  const library = start.view === "library" ? start : undefined,
    settings = start.view === "settings" ? start : undefined;
  const [service, setService] = useState<Service>(library?.service || "radarr"),
    [view, setView] = useState<AppView>(
      start.view === "settings" ? "statistics" : start.view,
    ),
    [filters, setFilters] = useState<Record<Service, string>>(() => {
      const stored = storedLibraryFilters();
      if (library) stored[library.service] = library.filters;
      return stored;
    }),
    [page, setPage] = useState(library?.page || 1),
    [settingsDirty, setSettingsDirty] = useState(false),
    [settingsOpen, setSettingsOpen] = useState(!!settings),
    [settingsSection, setSettingsSection] = useState<string>(
      settings?.section || "connections",
    ),
    [settingsTab, setSettingsTab] = useState(settings?.tab || ""),
    // The tool or settings query of the route; its page owns the meaning.
    [pageQuery, setPageQuery] = useState(
      start.view === "statistics" || start.view === "library"
        ? ""
        : start.query,
    ),
    [revision, setRevision] = useState(0),
    [settingsMount, setSettingsMount] = useState(0),
    [fromHistory, setFromHistory] = useState(false),
    // Every action renders, so its sync effect consumes its intent.
    [, setTick] = useState(0);
  useEffect(() => {
    writeSessionPreference(LIBRARY_FILTERS_KEY, JSON.stringify(filters));
  }, [filters]);
  const [sorts, setSorts] = useState<Record<Service, FilmSort | null>>(() => {
    const stored = {
      radarr: initialMovieSort("radarr"),
      sonarr: initialMovieSort("sonarr"),
    };
    if (library?.sort) stored[library.service] = library.sort;
    return stored;
  });
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
  const hash = formatRoute(
    settingsOpen
      ? {
          view: "settings",
          section: settingsSection as SettingsSectionId,
          tab: settingsTab,
          query: pageQuery,
        }
      : view === "library"
        ? {
            view,
            service,
            filters: filters[service],
            page,
            sort: sorts[service],
          }
        : view === "statistics"
          ? { view }
          : { view, query: pageQuery },
  );
  const route = parseRoute(hash);
  // pushNext: an action ran since the last sync. written: the hash last
  // written or accepted. leaving: canLeaveRules() allowed leaving the open
  // settings, so a settings route that follows starts the page again (1.7.0
  // closed and reopened it). applied: the last render before an accepted
  // Back/Forward step; its effects may still wait for a paint and must not
  // write the old route back.
  const pushNext = useRef(false),
    written = useRef<string>(),
    leaving = useRef(false),
    asking = useRef(false),
    renders = useRef(0),
    applied = useRef(0);
  const rendered = ++renders.current;
  useEffect(() => {
    // An allowed leave that no action used ends with this render.
    leaving.current = false;
    if (rendered <= applied.current) return;
    const push = pushNext.current;
    pushNext.current = false;
    if (hash === written.current) return;
    const first = written.current === undefined;
    written.current = hash;
    if (push) routes.push(hash);
    else routes.replace(hash);
    // The start is canonical at once, without an entry.
    if (first) routes.flush();
  });
  // Starts an action; true when leaving the open settings was allowed.
  const begin = () => {
    pushNext.current = true;
    setTick((n) => n + 1);
    setFromHistory(false);
    const left = leaving.current;
    leaving.current = false;
    return left;
  };
  const openSettings = (section = "connections", tab?: string) => {
    const tabKey = settingsTabKeys.get(section);
    if (tabKey && tab !== undefined) writeSessionPreference(tabKey, tab);
    const next = formatRoute({
      view: "settings",
      section: section as SettingsSectionId,
      tab: tab || "",
      query: "",
    });
    const left = begin();
    if (settingsOpen && left) setSettingsMount((n) => n + 1);
    else if (settingsOpen && section === settingsSection && next !== hash)
      setRevision((n) => n + 1);
    setSettingsSection(section);
    setSettingsTab(tab || "");
    setPageQuery("");
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
  const sectionGuard = useRef<SectionGuard | null>(null);
  const setSectionGuard = (
    guard: SectionGuard | null,
    replacing?: SectionGuard,
  ) => {
    if (!replacing || sectionGuard.current === replacing)
      sectionGuard.current = guard;
  };
  const canChangeSection = async (next: string) =>
    !sectionGuard.current || sectionGuard.current(next);
  const canLeaveRules = async () => {
    if (!settingsOpen) return true;
    if (
      settingsDirty &&
      !(await confirmDiscard(t("Discard unsaved settings changes?")))
    )
      return false;
    leaving.current = true;
    return true;
  };
  // Back, Forward and links ask the same questions before their route
  // applies; a decline returns to the shown entry.
  const allows = async (target: Route) =>
    !settingsOpen ||
    (target.view !== "settings"
      ? canLeaveRules()
      : target.section === settingsSection || canChangeSection(target.section));
  const apply = (next: string) => {
    const target = parseRoute(next);
    pushNext.current = false;
    applied.current = renders.current;
    if (next !== written.current) setRevision((n) => n + 1);
    written.current = next;
    setFromHistory(true);
    if (target.view === "settings") {
      if (leaving.current && settingsOpen) setSettingsMount((n) => n + 1);
      setSettingsSection(target.section);
      setSettingsTab(target.tab);
      setPageQuery(target.query);
      setSettingsOpen(true);
    } else {
      setSettingsOpen(false);
      if (target.view === "library") {
        const { service, filters, page, sort } = target;
        setView("library");
        setService(service);
        setFilters((current) =>
          current[service] === filters
            ? current
            : { ...current, [service]: filters },
        );
        setPage(page);
        setSorts((current) =>
          JSON.stringify(current[service]) === JSON.stringify(sort)
            ? current
            : { ...current, [service]: sort },
        );
      } else {
        setView(target.view);
        setPageQuery(target.view === "statistics" ? "" : target.query);
      }
    }
    leaving.current = false;
    routes.accept();
  };
  const external = async (next: string) => {
    // While asked, further steps only move the target: the answer applies
    // to the newest entry.
    if (asking.current) return;
    if (next === written.current) return routes.accept();
    asking.current = true;
    const allowed = await allows(parseRoute(next)).catch(() => false);
    asking.current = false;
    if (allowed) apply(routes.hash());
    else routes.restore();
  };
  const onExternal = useRef(external);
  onExternal.current = external;
  useEffect(() => {
    const stop = routes.listen((next) => void onExternal.current(next));
    return () => {
      stop();
      routes.dispose();
    };
  }, []);
  const replaceRoute = ({ tab, query }: { tab?: string; query?: string }) => {
    if (tab !== undefined) setSettingsTab(tab);
    if (query !== undefined) setPageQuery(query);
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
  const openDashboard = () => {
    begin();
    setSettingsOpen(false);
    setView("statistics");
  };
  // An instance target sets or clears the instance filter (empty = every
  // instance); a query target replaces the service's filters.
  const openLibrary = (
    target: Service,
    to: { instance: string } | { query: string },
  ) => {
    begin();
    setSettingsOpen(false);
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
  // The open tool keeps its parameters.
  const openTool = (tool: ToolView) => {
    begin();
    if (settingsOpen || view !== tool) setPageQuery("");
    setSettingsOpen(false);
    setView(tool);
  };
  // Opens a tool on one search, which its page reads from the route; an
  // open tool starts again with it.
  const searchTool = (tool: ToolView, q: string) => {
    const query = new URLSearchParams({ q }).toString();
    begin();
    if (
      !settingsOpen &&
      view === tool &&
      formatRoute({ view: tool, query }) !== hash
    )
      setRevision((n) => n + 1);
    setSettingsOpen(false);
    setPageQuery(query);
    setView(tool);
  };
  // Disk placement opens one path in Files & permissions, even while that
  // tool is hidden.
  const openFiles = (path: string) => {
    setPlacementFileSearch(true);
    searchTool("files", path);
  };
  const openMuxFile = (name: string) => searchTool("mux", name);
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
    route,
    revision,
    settingsMount,
    fromHistory,
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
    replaceRoute,
    canLeaveRules,
    canChangeSection,
    setSettingsDirty,
    setSectionGuard,
  };
}
