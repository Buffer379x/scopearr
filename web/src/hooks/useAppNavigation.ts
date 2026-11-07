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
import { filesTabVisible } from "../filecheck";
import { t } from "../i18n";
import { muxTabVisible } from "../mux-spec";
import { disksTabVisible } from "../placement";
import { createRouteHistory, type Arrival } from "../route-history";
import { formatRoute, MOVIE_SORT_FIELDS, parseRoute } from "../router";
import type { NavTarget, Route, SettingsSectionId, ToolView } from "../router";
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

// The instance filter of a library query set, or cleared when empty.
function withInstance(query: string, instance: string) {
  const params = new URLSearchParams(query);
  if (instance) params.set("instance", instance);
  else params.delete("instance");
  return params.toString();
}
const searchQuery = (q: string) => new URLSearchParams({ q }).toString();

export type AppView = Exclude<Route["view"], "settings">;
// Asks the open settings page whether another section may open; true when
// allowed (unsaved changes of the section are then discarded).
export type SectionGuard = (next: string) => Promise<boolean>;
export type AppNavigation = {
  view: AppView;
  service: Service;
  filters: Record<Service, string>;
  page: number;
  movieSort: FilmSort;
  settingsOpen: boolean;
  settingsSection: string;
  // The route of this state (its hash is the address of the view). revision
  // counts accepted Back/Forward steps and links, and pushes that open the
  // same page with other page parameters; settingsMount counts settings
  // reopened after canLeaveRules() allowed leaving them (the header Settings
  // button); libraryEntry counts libraries opened by a link or an action
  // (not by Back, Forward or a replace). Pages start again when they change.
  route: Route;
  revision: number;
  settingsMount: number;
  libraryEntry: number;
  // The shown route came from Back or Forward: its tool page takes what the
  // route leaves out as defaults, not from storage. A start, an action and
  // an entry without an index (a typed hash) fill the gaps from storage.
  fromHistory: boolean;
  // In-app links: openLink asks like Back and Forward (at most one
  // question), then runs the action of the target as a push; false when
  // declined. linkHref is the route that action opens from this state.
  openLink(target: NavTarget): Promise<boolean>;
  linkHref(target: NavTarget): string;
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
    [libraryEntry, setLibraryEntry] = useState(0),
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
  // A tab opens in the route; its page shows it (settings tabs follow the
  // route).
  const openSettings = (section = "connections", tab?: string) => {
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
  // A link to the shown route starts its page again, too. An entry without
  // an index starts like a page load: storage fills what its route leaves
  // out (tool pages, the library sort).
  const apply = (next: string, { link = false, fresh = false }: Arrival) => {
    const target = parseRoute(next);
    pushNext.current = false;
    applied.current = renders.current;
    if (next !== written.current || link) setRevision((n) => n + 1);
    written.current = next;
    setFromHistory(!fresh);
    if (target.view === "settings") {
      if (leaving.current && settingsOpen) setSettingsMount((n) => n + 1);
      setSettingsSection(target.section);
      setSettingsTab(target.tab);
      setPageQuery(target.query);
      setSettingsOpen(true);
    } else {
      setSettingsOpen(false);
      if (target.view === "library") {
        const { service, filters, page } = target;
        const sort = target.sort || (fresh ? initialMovieSort(service) : null);
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
  // Whether the newest step arrived fresh (typed) or as a history step.
  const newestFresh = useRef(false);
  const external = async (next: string, arrival: Arrival) => {
    if (!arrival.link) newestFresh.current = !!arrival.fresh;
    // While asked, further steps only move the target: the answer applies
    // to the newest entry, as that entry arrived. A link to the shown route
    // never asks and takes no freshness from an earlier step.
    if (asking.current) return;
    if (next === written.current && !arrival.link) return routes.accept();
    asking.current = true;
    const allowed = await allows(parseRoute(next)).catch(() => false);
    asking.current = false;
    if (allowed)
      apply(routes.hash(), {
        link: arrival.link,
        fresh: !arrival.link && newestFresh.current,
      });
    else routes.restore();
  };
  const onExternal = useRef(external);
  onExternal.current = external;
  useEffect(() => {
    const stop = routes.listen(
      (next, arrival) => void onExternal.current(next, arrival),
    );
    return () => {
      stop();
      routes.dispose();
    };
  }, []);
  // Another settings tab starts without the query of the last one (the log
  // filters belong to the Log tab).
  const replaceRoute = ({ tab, query }: { tab?: string; query?: string }) => {
    if (tab !== undefined && tab !== settingsTab) {
      setSettingsTab(tab);
      setPageQuery(query ?? "");
    } else if (query !== undefined) setPageQuery(query);
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
  // instance); a query target replaces the service's filters. Each call is
  // a library entry, also one to the shown library.
  const openLibrary = (
    target: Service,
    to: { instance: string } | { query: string },
  ) => {
    begin();
    setLibraryEntry((n) => n + 1);
    setSettingsOpen(false);
    setView("library");
    setFilters((current) => ({
      ...current,
      [target]:
        "query" in to ? to.query : withInstance(current[target], to.instance),
    }));
    setPage(1);
    setService(target);
  };
  // The open tool keeps its parameters.
  const keptToolQuery = (tool: ToolView) =>
    settingsOpen || view !== tool ? "" : pageQuery;
  const openTool = (tool: ToolView) => {
    begin();
    setPageQuery(keptToolQuery(tool));
    setSettingsOpen(false);
    setView(tool);
  };
  // Opens a tool on one search, which its page reads from the route; an
  // open tool starts again with it. A blank search opens the tool.
  const searchTool = (tool: ToolView, q: string) => {
    if (!q.trim()) return openTool(tool);
    const query = searchQuery(q);
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
  // The route the action of a link opens from this state.
  const routeOf = (target: NavTarget): Route => {
    switch (target.view) {
      case "statistics":
        return { view: "statistics" };
      case "library":
        return {
          view: "library",
          service: target.service,
          filters:
            "query" in target
              ? target.query
              : withInstance(filters[target.service], target.instance),
          page: 1,
          sort: sorts[target.service],
        };
      case "settings":
        return {
          view: "settings",
          section: target.section,
          tab: target.tab || "",
          query: "",
        };
      default:
        return {
          view: target.view,
          query: target.q?.trim()
            ? searchQuery(target.q)
            : keptToolQuery(target.view),
        };
    }
  };
  const linkHref = (target: NavTarget) => formatRoute(routeOf(target));
  const openLink = async (target: NavTarget) => {
    const route = parseRoute(linkHref(target));
    if (!(await allows(route).catch(() => false))) return false;
    if (route.view === "settings") openSettings(route.section, route.tab);
    else if (target.view === "statistics") openDashboard();
    else if (target.view === "library")
      openLibrary(
        target.service,
        "query" in target
          ? { query: target.query }
          : { instance: target.instance },
      );
    else if (target.view !== "settings")
      searchTool(target.view, target.q || "");
    return true;
  };
  return {
    view,
    service,
    filters,
    page,
    movieSort,
    settingsOpen,
    settingsSection,
    route,
    revision,
    settingsMount,
    libraryEntry,
    fromHistory,
    openLink,
    linkHref,
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
    setSettingsDirty,
    setSectionGuard,
  };
}
