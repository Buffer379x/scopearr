import { instancesOf, instanceLabel } from "../instances";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bookmark,
  Columns3,
  Database,
  Download,
  Film,
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
} from "lucide-preact";
import { lazy, Suspense } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
import { readPreference, writePreference } from "../browser-storage";
import { confirmDeletion } from "../confirmation";
import { t, useI18n } from "../i18n";
import { notify } from "../notifications";
import { applyInterfaceTheme } from "../themes";
import type {
  CustomTag,
  FilmSort,
  MediaFile,
  Preset,
  Results,
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
import { muxTabVisible } from "../mux-spec";
import { FileDialog } from "./FileDialog";
import { FilterPanel } from "./FilterPanel";
import { Modal } from "./Modal";
import { StatisticsPage } from "./StatisticsPage";
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
  "size",
  "hdr",
  "bitDepth",
  "audio",
  "channels",
  "custom",
];
function initialMovieSort(): FilmSort {
  try {
    const saved = JSON.parse(readPreference("scopearr-film-sort") || "null");
    if (saved?.field === "language") saved.field = "audio";
    if (
      saved &&
      movieSortFields.includes(saved.field) &&
      (saved.direction === "asc" || saved.direction === "desc")
    )
      return saved;
  } catch {}
  return { field: "title", direction: "asc" };
}
export function Library({
  status,
  refresh,
}: {
  status: Status;
  refresh: () => Promise<void>;
}) {
  useI18n();
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
  const [service, setService] = useState<Service>("radarr"),
    [view, setView] = useState<"library" | "statistics" | "mux">("statistics"),
    [movieSort, setMovieSort] = useState<FilmSort>(initialMovieSort),
    [filters, setFilters] = useState<Record<Service, string>>({
      radarr: "",
      sonarr: "",
    }),
    [page, setPage] = useState(1),
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
    [settingsOpen, setSettingsOpen] = useState(false),
    [settingsSection, setSettingsSection] = useState("connections"),
    [collapsed, setCollapsed] = useState(true),
    [filename, setFilename] = useState<MediaFile | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [theme, setTheme] = useState(readPreference("scopearr-theme") || "dark"),
    [savePreset, setSavePreset] = useState(false),
    [presetName, setPresetName] = useState(""),
    [presetError, setPresetError] = useState("");
  useEffect(() => {
    if (notice) {
      notify(notice);
      setNotice("");
    }
  }, [notice]);
  const libraryScroll = useRef(0);
  const q = new URLSearchParams(filters[service]);
  const libraryInstances = instancesOf(settings, true).filter(
    (instance) => instance.type === service,
  );
  const syncCount = libraryInstances.reduce(
    (total, instance) => total + (status.sync?.[instance.id]?.count || 0),
    0,
  );
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
    writePreference("scopearr-film-sort", JSON.stringify(movieSort));
  }, [movieSort]);
  const loadSettings = async () => setSettings(await api<Settings>("settings"));
  const loadPresets = async () => setPresets(await api<Preset[]>("presets"));
  useEffect(() => {
    loadSettings().catch(() => {});
    loadPresets().catch(() => {});
  }, []);
  useFacets(
    view === "library" && !settingsOpen,
    service,
    `${syncRevision}:${status.cacheRevision}:${status.recognitionRevision}:${customRevision}:${settings?.listInfoVisible.join(",")}`,
    setFacets,
  );
  useLibraryQuery({
    view: settingsOpen ? "settings" : view,
    service,
    filters,
    page,
    movieSort,
    lastSuccess: `${syncRevision}:${status.cacheRevision}:${status.recognitionRevision}:${customRevision}:${settings?.listInfoVisible.join(",")}`,
    seasonMode: settings?.seasonMode,
    pageSize: settings?.pageSize,
    setResults,
    setBusy,
  });
  useEffect(() => {
    setPage(1);
  }, [settings?.pageSize]);
  const openSettings = (section = "connections") => {
    if (!settingsOpen) libraryScroll.current = window.scrollY;
    setSettingsSection(section);
    setSettingsOpen(true);
  };
  const canLeaveRules = () => {
    if (
      settingsOpen &&
      settingsDirty &&
      !confirm(t("Discard unsaved settings changes?"))
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
  const exportQuery = new URLSearchParams(filters[service]);
  exportQuery.set("service", service);
  exportQuery.set("lang", getLocale());
  if (service === "radarr" || movieSort.field === "info") {
    exportQuery.set("sort", movieSort.field);
    exportQuery.set("dir", movieSort.direction);
  }
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
    setMovieSort({
      field,
      direction:
        movieSort.field === field && movieSort.direction === "asc"
          ? "desc"
          : "asc",
    });
    setPage(1);
  };
  const pages = Math.max(1, Math.ceil(results.displayTotal / results.pageSize));
  useEffect(() => {
    if (!busy && results.page === page && page > pages) setPage(pages);
  }, [busy, results.page, page, pages]);
  useEffect(() => {
    if (view === "mux" && !muxTabVisible(status)) setView("library");
  }, [
    view,
    status.mux?.enabled,
    status.mux?.pending,
    status.mux?.running,
    status.mux?.failed,
  ]);
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
                        <span class="brand-caption">
                          {t("LIBRARY EXPLORER")}
                        </span>
                      </a>
                      <nav class="tabs" aria-label={t("Main navigation")}>
                        <button
                          class={view === "statistics" ? "active" : ""}
                          onClick={() => {
                            if (!canLeaveRules()) return;
                            setView("statistics");
                          }}
                        >
                          <BarChart3 size={17} />
                          {t("Dashboard")}
                        </button>

                        <button
                          class={
                            view === "library" && service === "radarr"
                              ? "active"
                              : ""
                          }
                          onClick={() => {
                            if (!canLeaveRules()) return;
                            setCollapsed(true);
                            setView("library");
                            if (service === "radarr") return;
                            setService("radarr");
                            setPage(1);
                            setResults(emptyResults);
                          }}
                        >
                          <Film size={17} /> {t("Movies")}
                        </button>
                        <button
                          class={
                            view === "library" && service === "sonarr"
                              ? "active"
                              : ""
                          }
                          onClick={() => {
                            if (!canLeaveRules()) return;
                            setCollapsed(true);
                            setView("library");
                            if (service === "sonarr") return;
                            setService("sonarr");
                            setPage(1);
                            setResults(emptyResults);
                          }}
                        >
                          <Tv size={17} /> {t("TV series")}
                        </button>
                        {muxTabVisible(status) && (
                          <button
                            class={view === "mux" ? "active" : ""}
                            onClick={() => {
                              if (canLeaveRules()) setView("mux");
                            }}
                          >
                            <Scissors size={17} /> {t("Muxing")}{" "}
                            {status.mux!.pending +
                              status.mux!.running +
                              status.mux!.failed >
                              0 && (
                              <span class="chip mux-count">
                                {status.mux!.pending +
                                  status.mux!.running +
                                  status.mux!.failed}
                              </span>
                            )}
                          </button>
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
                        >
                          {theme === "dark" ? (
                            <Sun size={18} />
                          ) : (
                            <Moon size={18} />
                          )}
                        </button>
                        <button
                          class="icon-button"
                          aria-label={t("Settings")}
                          onClick={() => {
                            if (canLeaveRules()) openSettings();
                          }}
                        >
                          <SettingsIcon size={18} />
                        </button>
                        <button
                          class="icon-button"
                          aria-label={t("Sign out")}
                          onClick={async () => {
                            await api("logout", "POST");
                            await refresh();
                          }}
                        >
                          <LogOut size={18} />
                        </button>
                      </div>
                    </header>
                    {status.demo && (
                      <div class="demo-bar">
                        <span>
                          <Info size={14} />
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
                            onDirty={setSettingsDirty}
                            refresh={refresh}
                            status={status}
                            demo={status.demo}
                            saved={async (settings) => {
                              setSettings(settings);
                              await refresh();
                            }}
                          />
                        ) : view === "mux" ? (
                          <MuxPage
                            settings={settings}
                            changed={refresh}
                            names={status.serviceNames || {}}
                            installed={!!status.mux?.installed}
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
                                <Database size={24} />
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
                                  onClick={() => {
                                    if (canLeaveRules()) openSettings();
                                  }}
                                >
                                  {t("Set up service")}
                                  <ArrowUpRight size={16} />
                                </button>
                              </div>
                            )}
                            <FilterPanel
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
                                    )}{" "}
                                    <span>{count(results.total)}</span>
                                    {busy && (
                                      <LoaderCircle size={16} class="spin" />
                                    )}
                                  </h2>
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
                                    <Columns3 size={15} />{" "}
                                    {showAllColumns[service]
                                      ? t("Default view")
                                      : t("All columns")}
                                  </button>
                                  <button
                                    type="button"
                                    class="button"
                                    disabled={!results.total}
                                    onClick={() => setCustomOpen(true)}
                                  >
                                    <TagIcon size={15} />
                                    {t("Set tag")}
                                  </button>
                                  <a
                                    class="button"
                                    href={"/api/export?" + exportQuery}
                                  >
                                    <Download size={15} />
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
                                    <Search size={32} />
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
                                        <RotateCcw size={16} />
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
                                    t(" · by series and season")}
                                </span>
                                <div>
                                  <button
                                    class="icon-button"
                                    aria-label={t("Previous page")}
                                    disabled={page <= 1}
                                    onClick={() => setPage(page - 1)}
                                  >
                                    <ArrowLeft size={16} />
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
                                  >
                                    <ArrowRight size={16} />
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
                                count: count(total),
                              },
                            ),
                          );
                          await loadCustom();
                          await refresh();
                          if (singleCustom === null) setPage(1);
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
                          <button class="primary">
                            <Bookmark size={16} />
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
