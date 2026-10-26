import { useFileSelection } from "../hooks/useFileSelection";
import { MuxSelectionActions } from "./MuxSelectionActions";
import { nextTableSort } from "./SortableHeader";
import { openJobCount } from "../tool-table";
import { ICON } from "../ui";
import { instancesOf, instanceLabel } from "../instances";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  ChartNoAxesColumnIncreasing,
  Bookmark,
  Columns3,
  Database,
  Download,
  Film,
  FolderCog,
  HardDrive,
  Info,
  LoaderCircle,
  LogOut,
  Moon,
  RotateCcw,
  Search,
  Scissors,
  Settings as SettingsIcon,
  Sun,
  Tag as TagIcon,
  Tv,
  Wrench,
} from "lucide-preact";
import { lazy, Suspense } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  readNavigation,
  removePreference,
  writeSessionPreference,
  readPreference,
  writePreference,
} from "../browser-storage";
removePreference("scopearr-log-seen");

import { confirmDeletion, confirmDiscard } from "../confirmation";
import { t, useI18n } from "../i18n";
import { notify } from "../notifications";
import { applyInterfaceTheme } from "../themes";
import type {
  CustomTag,
  FilmSort,
  MediaFile,
  Preset,
  Results,
  MuxJob,
  Service,
  Settings,
  Status,
} from "../types";
import {
  TagLabels,
  SDListGrouping,
  HiddenTags,
  TagVisibility,
  TagInformation,
} from "../ui";
import { CustomBulk } from "./CustomBulk";
import { LibraryTable } from "./LibraryTable";

import { api, ApiError } from "../api";
import { dashboardService, makeDashboardFilter } from "../dashboard-filter";
import { useFacets, useLibraryQuery } from "../hooks/useLibraryQuery";
import { getLocale } from "../i18n";
import { canonicalPresetQuery } from "../preset-query";
import {
  count,
  CustomTagNames,
  defaultColumnOrder,
  defaultColumns,
  defaultWarningColors,
  emptyResults,
  FilterUpdate,
  TagColors,
  TagTextColors,
} from "../ui";
import { disksTabVisible } from "../placement";
import { filesTabVisible } from "../filecheck";
import { NavMenu, type NavMenuItem } from "./NavMenu";
import { muxTabVisible } from "../mux-spec";
import { FileDialog } from "./FileDialog";
import { FilterPanel } from "./FilterPanel";
import { Modal } from "./Modal";
import { StatisticsPage } from "./StatisticsPage";
const DiskPlacementPage = lazy(() =>
  import("./DiskPlacementPage").then((m) => ({ default: m.DiskPlacementPage })),
);
const FileCheckPage = lazy(() =>
  import("./FileCheckPage").then((m) => ({ default: m.FileCheckPage })),
);
const MuxPage = lazy(() =>
  import("./MuxPage").then((m) => ({ default: m.MuxPage })),
);
const SettingsDialog = lazy(() =>
  import("./SettingsDialog").then((module) => ({
    default: module.SettingsDialog,
  })),
);
const movieSortFields = [
  "info",
  "title",
  "year",
  "resolution",
  "codec",
  "source",
  "processing",
  "size",
  "hdr",
  "bitDepth",
  "audio",
  "channels",
  "custom",
];
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
      movieSortFields.includes(saved.field) &&
      (saved.direction === "asc" || saved.direction === "desc")
    )
      return saved.field === "title" && saved.direction === "asc"
        ? null
        : saved;
  } catch {}
  return null;
}
export function Library({
  status,
  refresh,
}: {
  status: Status;
  refresh: () => Promise<void>;
}) {
  useI18n();
  useEffect(() => {
    const header = document.querySelector<HTMLElement>(".header");
    if (!header) return;
    const measure = () =>
      document.documentElement.style.setProperty(
        "--app-header-height",
        header.getBoundingClientRect().height + "px",
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
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
  const [customOpen, setCustomOpen] = useState(false);
  const [singleCustom, setSingleCustom] = useState<MediaFile | null>(null);
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
    return tags;
  };
  useEffect(() => {
    loadCustom().catch(() => {});
  }, [status.cacheRevision]);
  const [navigation] = useState(readNavigation);
  const [service, setService] = useState<Service>(navigation.service),
    [view, setView] = useState<
      "library" | "statistics" | "mux" | "disks" | "files"
    >(navigation.view),
    [sorts, setSorts] = useState<Record<Service, FilmSort | null>>(() => ({
      radarr: initialMovieSort("radarr"),
      sonarr: initialMovieSort("sonarr"),
    })),
    [filters, setFilters] = useState<Record<Service, string>>(
      navigation.filters,
    ),
    [page, setPage] = useState(navigation.page),
    [results, setResults] = useState<Results>(emptyResults),
    [facets, setFacets] = useState<Record<string, string[]>>({}),
    [settings, setSettings] = useState<Settings | null>(null),
    [presets, setPresets] = useState<Preset[]>([]),
    [presetIds, setPresetIds] = useState<Record<Service, number | undefined>>({
      radarr: undefined,
      sonarr: undefined,
    }),
    [showAllColumns, setShowAllColumns] = useState<Record<Service, boolean>>({
      radarr: false,
      sonarr: false,
    }),
    [settingsDirty, setSettingsDirty] = useState(false),
    [settingsOpen, setSettingsOpen] = useState(navigation.settingsOpen),
    [settingsSection, setSettingsSection] = useState(
      navigation.settingsSection,
    ),
    [collapsed, setCollapsed] = useState(true),
    [filename, setFilename] = useState<MediaFile | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [theme, setTheme] = useState(readPreference("scopearr-theme") || "dark"),
    [savePreset, setSavePreset] = useState(false),
    [presetName, setPresetName] = useState(""),
    [presetError, setPresetError] = useState("");
  const movieSort = sorts[service] || defaultLibrarySort;
  const setMovieSort = (value: FilmSort | null) =>
    setSorts((current) => ({ ...current, [service]: value }));
  useEffect(() => {
    if (notice) {
      notify(notice);
      setNotice("");
    }
  }, [notice]);
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
  const q = new URLSearchParams(filters[service]);
  const libraryInstances = instancesOf(settings, true).filter(
    (instance) => instance.type === service,
  );
  const syncCount = libraryInstances.reduce(
    (total, instance) => total + (status.sync?.[instance.id]?.count || 0),
    0,
  );
  const [renameRevision, setRenameRevision] = useState(0);
  const syncRevision = libraryInstances
    .map((instance) => status.sync?.[instance.id]?.lastSuccess || "")
    .join(":");
  const configured = libraryInstances.length > 0;
  const visibleColumns = settings?.visibleColumns[service] || defaultColumns;
  const columnOrder = settings?.columnOrder[service] || defaultColumnOrder;
  const displayColumns = columnOrder.filter(
    (field) => showAllColumns[service] || visibleColumns.includes(field),
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    writePreference("scopearr-theme", theme);
  }, [theme]);
  useEffect(() => {
    applyInterfaceTheme(
      document.documentElement,
      settings?.interfaceTheme,
      theme,
    );
  }, [settings?.interfaceTheme, theme]);
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
  const loadSettings = async () => setSettings(await api<Settings>("settings"));
  const loadPresets = async () => setPresets(await api<Preset[]>("presets"));
  useEffect(() => {
    loadSettings().catch(() => {});
    loadPresets().catch(() => {});
  }, []);
  useFacets(
    view === "library" && !settingsOpen,
    service,
    `${renameRevision}:${syncRevision}:${status.cacheRevision}:${status.recognitionRevision}:${customRevision}:${settings?.listInfoVisible.join(",")}`,
    setFacets,
  );
  useLibraryQuery({
    view: settingsOpen ? "settings" : view,
    service,
    filters,
    page,
    movieSort,
    lastSuccess: `${renameRevision}:${syncRevision}:${status.cacheRevision}:${status.recognitionRevision}:${customRevision}:${settings?.listInfoVisible.join(",")}`,
    seasonMode: settings?.seasonMode,
    pageSize: settings?.pageSize,
    setResults,
    setBusy,
  });
  const previousPageSize = useRef<number>();
  useEffect(() => {
    if (
      previousPageSize.current !== undefined &&
      previousPageSize.current !== settings?.pageSize
    )
      setPage(1);
    previousPageSize.current = settings?.pageSize;
  }, [settings?.pageSize]);
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
  const change = (key: string, values: FilterUpdate) => {
    const updateFilters = (current: Record<Service, string>) => {
      const n = new URLSearchParams(current[service]);
      const next =
        typeof values === "function" ? values(n.getAll(key)) : values;
      n.delete(key);
      next.forEach((v) => n.append(key, v));
      return { ...current, [service]: n.toString() };
    };
    setFilters(updateFilters);
    setPage(1);
  };
  const openDashboardFilter = (field: string, value: string, scope: string) => {
    const target = dashboardService(scope, service);
    setFilters((current) => ({
      ...current,
      [target]: makeDashboardFilter(field, value, scope).query,
    }));
    setPresetIds((current) => ({ ...current, [target]: undefined }));
    setService(target);
    setCollapsed(true);
    setPage(1);
    setResults(emptyResults);
    setView("library");
  };
  const applyPreset = (p: Preset) => {
    selection.clear();
    setPresetIds({ ...presetIds, [p.service]: p.id });
    setService(p.service);
    const n = new URLSearchParams(p.query);
    n.delete("service");
    n.delete("sort");
    n.delete("dir");
    if (view !== "library" || service !== p.service) setCollapsed(true);
    setView("library");
    setFilters({ ...filters, [p.service]: n.toString() });
    setPage(1);
  };
  const reset = () => {
    setFilters({ ...filters, [service]: "" });
    setPage(1);
  };
  const doSavePreset = async (e: Event) => {
    e.preventDefault();
    try {
      const duplicate = presets.find(
        (p) =>
          p.service === service &&
          canonicalPresetQuery(p.query) ===
            canonicalPresetQuery(filters[service]),
      );
      if (duplicate) {
        notify(
          t("These filters are already saved as {name}.", {
            name: duplicate.name,
          }),
          "warning",
        );
        setPresetError(
          t("These filters are already saved as {name}.", {
            name: duplicate.name,
          }),
        );
        return;
      }
      const created = await api<Preset>("presets", "POST", {
        name: presetName,
        service,
        query: filters[service],
      });
      await loadPresets();
      setPresetIds({ ...presetIds, [service]: created.id });
      setSavePreset(false);
      setPresetName("");
      setNotice(t("Filter view saved."));
    } catch (e) {
      setPresetError(
        e instanceof ApiError && e.data.preset
          ? t("These filters are already saved as {name}.", {
              name: e.data.preset.name,
            })
          : (e as Error).message,
      );
    }
  };
  const [muxJobs, setMuxJobs] = useState<MuxJob[]>([]);
  const loadMuxJobs = async () => {
    if (status.mux?.enabled) setMuxJobs(await api<MuxJob[]>("mux/jobs"));
    else setMuxJobs([]);
  };
  useEffect(() => {
    void loadMuxJobs().catch(() => {});
  }, [
    view,
    filename,
    status.mux?.enabled,
    status.mux?.pending,
    status.mux?.running,
    status.mux?.failed,
  ]);
  const exportQuery = new URLSearchParams(filters[service]);
  exportQuery.set("service", service);
  exportQuery.set("lang", getLocale());
  exportQuery.set("sort", movieSort.field);
  exportQuery.set("dir", movieSort.direction);
  const pageKeys = results.files.map((f) => ({
    service: f.service,
    id: f.id,
    mediaId: f.mediaId,
    season: f.season,
    filename: f.filename,
    title: f.title,
  }));
  const [selectionWorking, setSelectionWorking] = useState(false);
  const selection = useFileSelection(
    JSON.stringify([
      settingsOpen ? "settings" : view,
      service,
      filters[service],
      page,
      movieSort,
      settings?.seasonMode,
      settings?.pageSize,
    ]),
    pageKeys,
  );
  const openMuxFile = (file: MediaFile) => {
    writePreference(
      "scopearr-mux-filters",
      JSON.stringify({ q: file.filename, statuses: [] }),
    );
    setView("mux");
  };
  const active = [...q.entries()].filter(
    ([k]) => k !== "sort" && k !== "dir" && !k.endsWith("Op"),
  );
  const matchingPresets = presets.filter(
    (p) =>
      p.service === service &&
      canonicalPresetQuery(p.query) === canonicalPresetQuery(filters[service]),
  );
  const selectedPreset =
    matchingPresets.find((p) => p.id === presetIds[service]) ||
    matchingPresets[0];
  const deletePreset = async () => {
    if (
      !selectedPreset ||
      !(await confirmDeletion(
        t("Delete preset {name}?", { name: selectedPreset.name }),
      ))
    )
      return;
    try {
      await api("presets?id=" + selectedPreset.id, "DELETE");
      await loadPresets();
      setNotice(t("Preset deleted."));
    } catch {}
  };
  const sortColumn = (field: string) => {
    setMovieSort(nextTableSort(sorts[service], field));
    setPage(1);
  };
  const [placementFileSearch, setPlacementFileSearch] = useState(false);
  const pages = Math.max(1, Math.ceil(results.displayTotal / results.pageSize));
  useEffect(() => {
    if (!busy && results.page === page && page > pages) setPage(pages);
  }, [busy, results.page, page, pages]);
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
  // Navigates to a library; an empty instance shows every instance of that type.
  const openLibrary = async (target: Service, instance: string) => {
    if (!(await canLeaveRules())) return;
    selection.clear();
    setCollapsed(true);
    setView("library");
    setFilters((current) => {
      const n = new URLSearchParams(current[target]);
      if (instance) n.set("instance", instance);
      else n.delete("instance");
      return { ...current, [target]: n.toString() };
    });
    setPage(1);
    if (service !== target) {
      setService(target);
      setResults(emptyResults);
    }
  };
  const muxBadge = muxTabVisible(status) ? openJobCount(status.mux) : 0;
  const toolItems: NavMenuItem[] = [
    ...(muxTabVisible(status)
      ? [
          {
            key: "mux",
            label: t("Muxing"),
            icon: <Scissors size={ICON.button} />,
            badge: muxBadge,
            active: view === "mux",
            select: async () => {
              if (await canLeaveRules()) setView("mux");
            },
          },
        ]
      : []),
    ...(disksTabVisible(status)
      ? [
          {
            key: "disks",
            badge: openJobCount(status.unraid),
            label: t("Disk placement"),
            icon: <HardDrive size={ICON.button} />,
            active: view === "disks",
            select: async () => {
              if (await canLeaveRules()) setView("disks");
            },
          },
        ]
      : []),
    ...(filesTabVisible(status)
      ? [
          {
            key: "files",
            badge: openJobCount(status.files),
            label: t("Files & permissions"),
            icon: <FolderCog size={ICON.button} />,
            active: view === "files",
            select: async () => {
              if (await canLeaveRules()) setView("files");
            },
          },
        ]
      : []),
  ];
  return (
    <CustomTagNames.Provider
      value={Object.fromEntries(
        customTags.map((tag) => [String(tag.id), tag.displayName || tag.name]),
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
                  <div class="shell">
                    <header class="header">
                      <a href="/" class="brand" aria-label={t("Scopearr home")}>
                        <img
                          src="/icon-64.png"
                          srcSet="/icon-64.png 1x, /icon-256.png 2x"
                          width="34"
                          height="34"
                          alt=""
                        />
                        <b>
                          Scopearr<span> / </span>
                        </b>
                      </a>
                      <nav class="tabs" aria-label={t("Main navigation")}>
                        <button
                          class={view === "statistics" ? "active" : ""}
                          onClick={async () => {
                            if (!(await canLeaveRules())) return;
                            setView("statistics");
                          }}
                        >
                          <ChartNoAxesColumnIncreasing size={ICON.button} />
                          {t("Dashboard")}
                        </button>
                        {(["radarr", "sonarr"] as const).map((type) => {
                          const all = instancesOf(settings, true).filter(
                            (instance) => instance.type === type,
                          );
                          const current =
                            view === "library" && service === type
                              ? new URLSearchParams(filters[type]).get(
                                  "instance",
                                ) || ""
                              : undefined;
                          const Icon = type === "radarr" ? Film : Tv;
                          const items: NavMenuItem[] = [
                            ...(all.length > 1
                              ? [
                                  {
                                    key: "all",
                                    label: t(
                                      type === "radarr"
                                        ? "All movies"
                                        : "All TV series",
                                    ),
                                    icon: <Icon size={ICON.button} />,
                                    active: current === "",
                                    select: () => openLibrary(type, ""),
                                  },
                                ]
                              : []),
                            ...all.map((instance) => ({
                              key: instance.id,
                              label: instanceLabel(instance),
                              icon: <Icon size={ICON.button} />,
                              // A single instance is the whole library.
                              active:
                                all.length > 1
                                  ? current === instance.id
                                  : current !== undefined,
                              select: () =>
                                openLibrary(
                                  type,
                                  all.length > 1 ? instance.id : "",
                                ),
                            })),
                          ];
                          const label = t(
                            type === "radarr" ? "Movies" : "TV series",
                          );
                          return items.length ? (
                            <NavMenu
                              key={type}
                              icon={<Icon size={ICON.button} />}
                              label={label}
                              items={items}
                            />
                          ) : (
                            <button
                              key={type}
                              class={current !== undefined ? "active" : ""}
                              onClick={() => openLibrary(type, "")}
                            >
                              <Icon size={ICON.label} /> {label}
                            </button>
                          );
                        })}
                        {toolItems.length > 0 && (
                          <NavMenu
                            icon={<Wrench size={ICON.button} />}
                            label={t("Tools")}
                            badge={toolItems.reduce(
                              (sum, item) => sum + (item.badge || 0),
                              0,
                            )}
                            badgeLabel={t("Tools, {count} open jobs", {
                              count: toolItems.reduce(
                                (sum, item) => sum + (item.badge || 0),
                                0,
                              ),
                            })}
                            items={toolItems}
                          />
                        )}
                      </nav>
                      <div class="header-actions">
                        <button
                          class="icon-button"
                          aria-label={
                            theme === "dark"
                              ? t("Light theme")
                              : t("Dark theme")
                          }
                          onClick={() =>
                            setTheme(theme === "dark" ? "light" : "dark")
                          }
                          title={
                            theme === "dark"
                              ? t("Light theme")
                              : t("Dark theme")
                          }
                        >
                          {theme === "dark" ? (
                            <Sun size={ICON.button} />
                          ) : (
                            <Moon size={ICON.button} />
                          )}
                        </button>
                        <button
                          class="icon-button"
                          aria-label={t("Settings")}
                          onClick={async () => {
                            if (await canLeaveRules()) openSettings();
                          }}
                          title={t("Settings")}
                        >
                          <SettingsIcon size={ICON.button} />
                        </button>
                        <button
                          class="icon-button"
                          aria-label={t("Sign out")}
                          onClick={async () => {
                            await api("logout", "POST");
                            await refresh();
                          }}
                          title={t("Sign out")}
                        >
                          <LogOut size={ICON.button} />
                        </button>
                      </div>
                    </header>
                    {status.demo && (
                      <div class="demo-bar">
                        <span>
                          <Info size={ICON.label} />
                          {t(
                            "Demo · sample data, no connection to your services",
                          )}
                        </span>
                      </div>
                    )}
                    <main class="main">
                      <Suspense fallback={null}>
                        {settingsOpen && settings ? (
                          <SettingsDialog
                            customTags={customTags}
                            customChanged={async () => {
                              const tags = await loadCustom();
                              await loadSettings();
                              await loadPresets();
                              await refresh();
                              return tags;
                            }}
                            settings={settings}
                            initialSection={settingsSection}
                            onSectionChange={setSettingsSection}
                            onDirty={setSettingsDirty}
                            refresh={refresh}
                            status={status}
                            demo={status.demo}
                            saved={async (settings) => {
                              setSettings(settings);
                              await refresh();
                            }}
                          />
                        ) : view === "files" ? (
                          <FileCheckPage
                            settings={settings}
                            changed={async () => {
                              setSettings(await api<Settings>("settings"));
                              await refresh();
                            }}
                            setup={() => {
                              writeSessionPreference(
                                "scopearr-service-settings",
                                "mux",
                              );
                              openSettings();
                            }}
                          />
                        ) : view === "disks" ? (
                          <DiskPlacementPage
                            openFiles={(path) => {
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
                              writeSessionPreference(
                                "scopearr-filecheck-page",
                                "1",
                              );
                              setView("files");
                            }}
                            settings={settings}
                            changed={async () => {
                              setSettings(await api<Settings>("settings"));
                              await refresh();
                            }}
                            setup={() => {
                              writeSessionPreference(
                                "scopearr-service-settings",
                                "mux",
                              );
                              openSettings();
                            }}
                          />
                        ) : view === "mux" ? (
                          <MuxPage
                            settings={settings}
                            changed={refresh}
                            names={status.serviceNames || {}}
                            installed={!!status.mux?.installed}
                            setup={() => {
                              writeSessionPreference(
                                "scopearr-service-settings",
                                "mux",
                              );
                              openSettings();
                            }}
                          />
                        ) : view === "statistics" ? (
                          <StatisticsPage
                            status={status}
                            settings={settings}
                            onFilter={openDashboardFilter}
                          />
                        ) : (
                          <>
                            <section class="library-intro">
                              <h1>
                                {service === "radarr"
                                  ? t("Movie library")
                                  : t("TV library")}
                              </h1>
                              <span>
                                {count(syncCount)} {t("files in cache")}
                              </span>
                            </section>
                            {!status.demo && settings && !configured && (
                              <div class="connect-card">
                                <Database size={ICON.empty} />
                                <div>
                                  <b>
                                    {t(
                                      service === "radarr"
                                        ? "Connect your movie library."
                                        : "Connect your TV library.",
                                    )}
                                  </b>
                                  <p>
                                    {t(
                                      "An address and API key are enough. Scopearr only reads existing data.",
                                    )}
                                  </p>
                                </div>
                                <button
                                  class="primary"
                                  onClick={async () => {
                                    if (await canLeaveRules()) openSettings();
                                  }}
                                >
                                  {t("Set up service")}
                                  <ArrowUpRight size={ICON.label} />
                                </button>
                              </div>
                            )}
                            <FilterPanel
                              mediaInfoEnabled={!!settings?.mediaInfo?.enabled}
                              q={q}
                              collapsed={collapsed}
                              setCollapsed={setCollapsed}
                              active={active}
                              service={service}
                              facets={facets}
                              presets={presets}
                              selectedPreset={selectedPreset}
                              applyPreset={applyPreset}
                              reset={reset}
                              setSavePreset={(value) => {
                                setPresetError("");
                                setSavePreset(value);
                              }}
                              deletePreset={deletePreset}
                              change={change}
                              instances={libraryInstances.map((instance) => ({
                                id: instance.id,
                                name: instanceLabel(instance),
                              }))}
                            />
                            <section class="library-section">
                              <div class="results-heading">
                                <div>
                                  <h2>
                                    {t(
                                      service === "radarr"
                                        ? "Your movies"
                                        : "Your TV series",
                                    )}
                                    {q.get("instance") &&
                                      libraryInstances.some(
                                        (i) => i.id === q.get("instance"),
                                      ) &&
                                      " · " +
                                        instanceLabel(
                                          libraryInstances.find(
                                            (i) => i.id === q.get("instance"),
                                          )!,
                                        )}{" "}
                                    <span
                                      class="heading-count"
                                      title={t("Items in the list")}
                                    >
                                      {count(results.total)}
                                    </span>
                                    {busy && (
                                      <LoaderCircle
                                        size={ICON.button}
                                        class="spin"
                                      />
                                    )}
                                  </h2>
                                  {service === "sonarr" &&
                                    settings?.seasonMode === "season" &&
                                    movieSort.field !== "title" && (
                                      <small class="quiet">
                                        {t(
                                          "Season context is hidden while sorting by another column. Choose the default title order to show season groups again.",
                                        )}
                                      </small>
                                    )}
                                </div>
                                <div class="results-tools">
                                  <button
                                    class="button"
                                    aria-pressed={showAllColumns[service]}
                                    disabled={
                                      visibleColumns.length ===
                                        columnOrder.length &&
                                      !showAllColumns[service]
                                    }
                                    title={
                                      showAllColumns[service]
                                        ? t("Return to saved columns")
                                        : t(
                                            "Show hidden columns in the saved order",
                                          )
                                    }
                                    onClick={() =>
                                      setShowAllColumns({
                                        ...showAllColumns,
                                        [service]: !showAllColumns[service],
                                      })
                                    }
                                  >
                                    <Columns3 size={ICON.label} />{" "}
                                    {showAllColumns[service]
                                      ? t("Default view")
                                      : t("All columns")}
                                  </button>
                                  <MuxSelectionActions
                                    busyChanged={setSelectionWorking}
                                    files={selection.keys}
                                    jobs={muxJobs}
                                    installed={!!status.mux?.installed}
                                    changed={async () => {
                                      await loadMuxJobs();
                                      setRenameRevision((n) => n + 1);
                                      await refresh();
                                    }}
                                  />
                                  <button
                                    type="button"
                                    class="button selection-action"
                                    disabled={
                                      selectionWorking || !selection.keys.length
                                    }
                                    title={t(
                                      !selection.keys.length
                                        ? "Select entries first."
                                        : "Set tags for selected files",
                                    )}
                                    onClick={() => setCustomOpen(true)}
                                  >
                                    <TagIcon size={ICON.label} />
                                    {t("Set tag ({count})", {
                                      count: selection.keys.length,
                                    })}
                                  </button>
                                  <a
                                    class="button"
                                    href={"/api/export?" + exportQuery}
                                  >
                                    <Download size={ICON.label} />
                                    {t("Export CSV")}
                                  </a>
                                </div>
                              </div>
                              <div
                                class={"table-wrap" + (busy ? " busy" : "")}
                                aria-busy={busy}
                              >
                                <LibraryTable
                                  files={results.files}
                                  selection={{
                                    ...selection,
                                    busy: selectionWorking,
                                  }}
                                  muxJobs={muxJobs}
                                  openMux={openMuxFile}
                                  service={service}
                                  settings={settings}
                                  displayColumns={displayColumns}
                                  movieSort={movieSort}
                                  sortColumn={sortColumn}
                                  setFilename={setFilename}
                                  setSingleCustom={setSingleCustom}
                                />
                                {!results.files.length && !busy && (
                                  <div class="empty-state">
                                    <Search size={ICON.empty} />
                                    <h3>
                                      {active.length
                                        ? t("No matching files.")
                                        : t("Your overview starts here.")}
                                    </h3>
                                    <p>
                                      {active.length
                                        ? t("Adjust or reset your filters.")
                                        : t(
                                            "Connect a service and start the first sync.",
                                          )}
                                    </p>
                                    <button
                                      class={
                                        active.length ? "icon-button" : "button"
                                      }
                                      title={
                                        active.length
                                          ? t("Reset filters")
                                          : undefined
                                      }
                                      aria-label={
                                        active.length
                                          ? t("Reset filters")
                                          : t("Open settings")
                                      }
                                      onClick={
                                        active.length
                                          ? reset
                                          : () => openSettings()
                                      }
                                    >
                                      {active.length ? (
                                        <RotateCcw size={ICON.button} />
                                      ) : (
                                        t("Open settings")
                                      )}
                                    </button>
                                  </div>
                                )}
                              </div>
                              <div class="pagination">
                                <span>
                                  {results.displayTotal
                                    ? t("{from}–{to} of {total} files", {
                                        from: count(
                                          (page - 1) * results.pageSize + 1,
                                        ),
                                        to: count(
                                          Math.min(
                                            page * results.pageSize,
                                            results.displayTotal,
                                          ),
                                        ),
                                        total: count(results.displayTotal),
                                      })
                                    : t("0 files")}
                                  {service === "sonarr" &&
                                    movieSort.field === "title" &&
                                    t(" · by series and season")}
                                </span>
                                <div>
                                  <button
                                    class="icon-button"
                                    aria-label={t("Previous page")}
                                    disabled={page <= 1}
                                    onClick={() => setPage(page - 1)}
                                    title={t("Previous page")}
                                  >
                                    <ArrowLeft size={ICON.button} />
                                  </button>
                                  <span>
                                    {t("Page {page} / {pages}", {
                                      page,
                                      pages,
                                    })}
                                  </span>
                                  <button
                                    class="icon-button"
                                    aria-label={t("Next page")}
                                    disabled={page >= pages}
                                    onClick={() => setPage(page + 1)}
                                    title={t("Next page")}
                                  >
                                    <ArrowRight size={ICON.button} />
                                  </button>
                                </div>
                              </div>
                            </section>
                          </>
                        )}
                      </Suspense>
                    </main>
                    {(customOpen || singleCustom !== null) && (
                      <CustomBulk
                        settings={settings}
                        files={
                          singleCustom === null
                            ? selection.keys.map(({ service, id }) => ({
                                service,
                                id,
                              }))
                            : undefined
                        }
                        query={
                          singleCustom !== null
                            ? new URLSearchParams({
                                service,
                                fileId: String(singleCustom.id),
                                instance: singleCustom.service,
                              }).toString()
                            : exportQuery.toString()
                        }
                        single={singleCustom !== null}
                        close={() => {
                          setCustomOpen(false);
                          setSingleCustom(null);
                        }}
                        saved={async (total) => {
                          setNotice(
                            t(
                              "Custom tags updated for {count} matching files.",
                              {
                                count: total,
                              },
                            ),
                          );
                          await loadCustom();
                          await refresh();
                          setRenameRevision((n) => n + 1);
                          setCustomOpen(false);
                          setSingleCustom(null);
                        }}
                      />
                    )}
                    {filename && (
                      <TagInformation.Provider
                        value={filename.informationOnly || {}}
                      >
                        <FileDialog
                          providers={instancesOf(settings, true)
                            .filter(
                              (instance) =>
                                instance.type === "emby" ||
                                instance.type === "jellyfin",
                            )
                            .map((instance) => ({
                              id: instance.id,
                              name: instanceLabel(instance),
                            }))}
                          warningColors={
                            settings?.warningColors || defaultWarningColors
                          }
                          muxAvailable={
                            !!status.mux?.enabled && !!status.mux?.installed
                          }
                          renameAvailable={
                            !!status.mux?.enabled && !status.demo
                          }
                          metadataUpdated={(updated) => {
                            setFilename(updated);
                            setRenameRevision((n) => n + 1);
                          }}
                          renamed={() => {
                            setFilename(null);
                            setRenameRevision((n) => n + 1);
                            void refresh();
                          }}
                          openMux={async () => {
                            await refresh();
                            setFilename(null);
                            setView("mux");
                          }}
                          file={filename}
                          close={() => setFilename(null)}
                        />
                      </TagInformation.Provider>
                    )}{" "}
                    {savePreset && (
                      <Modal
                        title={t("Save filter view")}
                        close={() => setSavePreset(false)}
                      >
                        <form onSubmit={doSavePreset}>
                          {presetError && (
                            <p class="error" role="alert">
                              {presetError}
                            </p>
                          )}
                          <p class="quiet">
                            {t(
                              service === "radarr"
                                ? "Save the current filter combination for movies."
                                : "Save the current filter combination for TV series.",
                            )}
                          </p>
                          <label>
                            {t("Name")}
                            <input
                              autoFocus
                              maxLength={80}
                              required
                              value={presetName}
                              placeholder={t("For example: 1080p · x264")}
                              onInput={(e) =>
                                setPresetName(e.currentTarget.value)
                              }
                            />
                          </label>
                          <button type="submit" class="primary">
                            <Bookmark size={ICON.label} />
                            {t("Save view")}
                          </button>
                        </form>
                      </Modal>
                    )}
                  </div>
                </TagTextColors.Provider>
              </TagColors.Provider>
            </HiddenTags.Provider>
          </TagVisibility.Provider>
        </SDListGrouping.Provider>
      </TagLabels.Provider>
    </CustomTagNames.Provider>
  );
}
