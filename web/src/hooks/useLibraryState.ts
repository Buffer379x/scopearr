import { useFileSelection } from "./useFileSelection";
import { instancesOf } from "../instances";
import { useEffect, useRef, useState } from "preact/hooks";
import { confirmDeletion } from "../confirmation";
import { t } from "../i18n";
import { notify } from "../notifications";
import type {
  MediaFile,
  Preset,
  Results,
  MuxJob,
  Service,
  Status,
} from "../types";
import { api, ApiError } from "../api";
import { dashboardService, makeDashboardFilter } from "../dashboard-filter";
import type { AppNavigation } from "./useAppNavigation";
import type { AppData } from "../components/AppDataProvider";
import { useFacets, useLibraryQuery } from "./useLibraryQuery";
import { getLocale } from "../i18n";
import { canonicalPresetQuery } from "../preset-query";
import {
  defaultColumnOrder,
  defaultColumns,
  emptyResults,
  FilterUpdate,
} from "../ui";

export type LibraryState = ReturnType<typeof useLibraryState>;

// Library results, presets, selection and dialogs state. The shell
// owns it, so switching to a tool page and back keeps it.
export function useLibraryState({
  status,
  navigation,
  data,
}: {
  status: Status;
  navigation: AppNavigation;
  data: AppData;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const [singleCustom, setSingleCustom] = useState<MediaFile | null>(null);
  const { settings, presets, loadPresets, customRevision } = data;
  const {
    view,
    service,
    filters,
    setFilters,
    page,
    setPage,
    movieSort,
    settingsOpen,
    canLeaveRules,
  } = navigation;
  // Results remember their service; another service shows none until its
  // own arrive (Back and Forward switch the service without openLibrary).
  const [loaded, setLoaded] = useState({ service, results: emptyResults });
  const results = loaded.service === service ? loaded.results : emptyResults;
  const setResults = (results: Results) => setLoaded({ service, results });
  const [facets, setFacets] = useState<Record<string, string[]>>({}),
    [presetIds, setPresetIds] = useState<Record<Service, number | undefined>>({
      radarr: undefined,
      sonarr: undefined,
    }),
    [showAllColumns, setShowAllColumns] = useState<Record<Service, boolean>>({
      radarr: false,
      sonarr: false,
    }),
    [collapsed, setCollapsed] = useState(true),
    [filename, setFilename] = useState<MediaFile | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [savePreset, setSavePreset] = useState(false),
    [presetName, setPresetName] = useState(""),
    [presetError, setPresetError] = useState("");
  useEffect(() => {
    if (notice) {
      notify(notice);
      setNotice("");
    }
  }, [notice]);
  const q = new URLSearchParams(filters[service]);
  const libraryInstances = instancesOf(settings, !status.demo).filter(
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
  const openDashboardFilter = async (
    field: string,
    value: string,
    scope: string,
  ) => {
    if (!(await canLeaveRules())) return;
    const target = dashboardService(scope, service);
    setPresetIds((current) => ({ ...current, [target]: undefined }));
    setCollapsed(true);
    setResults(emptyResults);
    navigation.openLibrary(target, {
      query: makeDashboardFilter(field, value, scope).query,
    });
  };
  // Presets are offered on the library for its current service only, so a
  // preset changes the filters and nothing else.
  const applyPreset = (p: Preset) => {
    selection.clear();
    setPresetIds({ ...presetIds, [p.service]: p.id });
    const n = new URLSearchParams(p.query);
    n.delete("service");
    n.delete("sort");
    n.delete("dir");
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
  const pages = Math.max(1, Math.ceil(results.displayTotal / results.pageSize));
  useEffect(() => {
    if (!busy && results.page === page && page > pages) setPage(pages);
  }, [busy, results.page, page, pages]);
  // Navigates to a library; an empty instance shows every instance of that type.
  const openLibrary = async (target: Service, instance: string) => {
    if (!(await canLeaveRules())) return;
    selection.clear();
    setCollapsed(true);
    if (service !== target) setResults(emptyResults);
    navigation.openLibrary(target, { instance });
  };
  return {
    customOpen,
    setCustomOpen,
    singleCustom,
    setSingleCustom,
    results,
    facets,
    presetIds,
    showAllColumns,
    setShowAllColumns,
    collapsed,
    setCollapsed,
    filename,
    setFilename,
    busy,
    setNotice,
    savePreset,
    setSavePreset,
    presetName,
    setPresetName,
    presetError,
    setPresetError,
    q,
    libraryInstances,
    syncCount,
    renameRevision,
    setRenameRevision,
    configured,
    visibleColumns,
    columnOrder,
    displayColumns,
    change,
    openDashboardFilter,
    applyPreset,
    reset,
    doSavePreset,
    muxJobs,
    loadMuxJobs,
    exportQuery,
    selectionWorking,
    setSelectionWorking,
    selection,
    active,
    selectedPreset,
    deletePreset,
    pages,
    openLibrary,
  };
}
