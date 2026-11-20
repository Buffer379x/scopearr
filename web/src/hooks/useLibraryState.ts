import { useFileSelection } from "./useFileSelection";
import { useOpenedSeries } from "../series-collapse";
import { instancesOf } from "../instances";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { confirmDeletion } from "../confirmation";
import { t } from "../i18n";
import { notify } from "../notifications";
import type {
  FileKey,
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
import { limitTrackCombos, withDrawerDraft } from "../library-filters";
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
    libraryEntry,
  } = navigation;
  // The collapsed series view (rc.4 R2) pages by series while the series
  // are grouped (the default title order); in another order it lists files.
  const seriesView = service === "sonarr" && navigation.seriesView,
    bySeries = seriesView && movieSort.field === "title";
  // Results remember their service and their paging (rc.5 S1): another
  // service, or the other paging of the TV library, shows none until its
  // own arrive (Back and Forward switch the service without a library entry)
  // and is not loaded until then (its placeholder rows show). A page of
  // series holds every episode of its series; drawn expanded while the
  // page of files loads, it would be hundreds or thousands of rows.
  const [arrived, setArrived] = useState<{
    service: Service;
    bySeries: boolean;
    results: Results;
  } | null>(null);
  const loaded = arrived?.service === service && arrived.bySeries === bySeries;
  const results = loaded ? arrived.results : emptyResults;
  const setResults = (results: Results) =>
    setArrived({ service, bySeries, results });
  // The facets of the service last loaded; the drawer shows them while it
  // loads them again, so an open value list keeps its values.
  const [shownFacets, setFacets] = useState<{
      service: Service;
      values: Record<string, string[]>;
    } | null>(null),
    [presetIds, setPresetIds] = useState<Record<Service, number | undefined>>({
      radarr: undefined,
      sonarr: undefined,
    }),
    // The open filter drawer's anchor (the Filters button), else null.
    [drawer, setDrawer] = useState<HTMLElement | null>(null),
    [filename, setFilename] = useState<MediaFile | null>(null),
    [busy, setBusy] = useState(false),
    // The request under way only opens series of the page shown (D33a).
    [expanding, setExpanding] = useState(false),
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
  // The route's filters with at most 16 track combinations (a longer deep
  // link would be answered with 400): every request and view reads these.
  const query = limitTrackCombos(filters[service]);
  const q = new URLSearchParams(query);
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
  const displayColumns = columnOrder.filter((field) =>
    visibleColumns.includes(field),
  );
  // Facets load only while the drawer is open (ruling P11/M15).
  useFacets(
    !!drawer && view === "library" && !settingsOpen,
    service,
    `${renameRevision}:${syncRevision}:${status.cacheRevision}:${status.recognitionRevision}:${customRevision}:${settings?.listInfoVisible.join(",")}`,
    (values) => setFacets({ service, values }),
  );
  const facets = shownFacets?.service === service ? shownFacets.values : null;
  const lastSuccess = `${renameRevision}:${syncRevision}:${status.cacheRevision}:${status.recognitionRevision}:${customRevision}:${settings?.listInfoVisible.join(",")}`;
  // A page of series is asked as summaries (D33a): only the series opened
  // carry their files (expand). A series closed again keeps its files until
  // the page, its filters or its data change, so closing asks nothing and
  // opening it again shows it at once.
  const opened = useOpenedSeries();
  const asked = useRef({ base: "", keys: [] as string[] });
  const askBase = JSON.stringify([
    service,
    query,
    page,
    movieSort,
    lastSuccess,
    settings?.seasonMode,
    settings?.pageSize,
  ]);
  if (bySeries) {
    if (asked.current.base !== askBase)
      asked.current = { base: askBase, keys: [...opened].sort() };
    else if ([...opened].some((key) => !asked.current.keys.includes(key)))
      asked.current = {
        base: askBase,
        keys: [...new Set([...asked.current.keys, ...opened])].sort(),
      };
  }
  useLibraryQuery({
    view: settingsOpen ? "settings" : view,
    service,
    filters: { ...filters, [service]: query },
    page,
    movieSort,
    lastSuccess,
    seasonMode: settings?.seasonMode,
    pageSize: settings?.pageSize,
    bySeries,
    // Without the Info column (the series' chevrons) every series shows
    // its episodes, so the page is asked whole.
    summary: displayColumns.includes("info"),
    expand: bySeries ? asked.current.keys : [],
    setResults,
    setBusy: (value, only) => {
      setBusy(value);
      setExpanding(value && !!only);
    },
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
  // Replaces the service's filters at once (a chip, the track menu), on
  // page 1.
  const replaceFilters = (next: string) => {
    setFilters((current) => ({
      ...current,
      [service]: limitTrackCombos(next),
    }));
    setPage(1);
  };
  // Apply in the drawer: one replace of the drawer's filters, on page 1;
  // the search and the instance stay the current ones.
  const applyFilters = (draft: string) => {
    setFilters((current) => ({
      ...current,
      [service]: withDrawerDraft(current[service], draft),
    }));
    setPage(1);
  };
  const openDrawer = (anchor: HTMLElement) => setDrawer(anchor);
  const closeDrawer = () => setDrawer(null);
  // Back or Forward to another page or service closes the drawer, so it
  // never opens again by itself.
  useEffect(() => {
    setDrawer(null);
  }, [view, service, settingsOpen]);
  // A dashboard tag opens its library on that filter, with no preset chosen
  // and without the results of other filters.
  const openDashboardFilter = async (
    field: string,
    value: string,
    scope: string,
  ) => {
    const target = dashboardService(scope, service);
    if (
      !(await navigation.openLink({
        view: "library",
        service: target,
        query: makeDashboardFilter(field, value, scope).query,
      }))
    )
      return;
    setPresetIds((current) => ({ ...current, [target]: undefined }));
    setArrived(null);
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
          canonicalPresetQuery(p.query) === canonicalPresetQuery(query),
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
        query,
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
  const exportQuery = new URLSearchParams(query);
  exportQuery.set("service", service);
  exportQuery.set("lang", getLocale());
  exportQuery.set("sort", movieSort.field);
  exportQuery.set("dir", movieSort.direction);
  // Every file of the page in the display order, each with its file when
  // the answer holds it: a page of series summaries (D33a) lists the files
  // of its closed series by their keys only. The selection, the page's box
  // and paging in File & metadata count all of them.
  const entries = pageEntries(results);
  const pageKeys = entries.map((entry) => entry.key);
  const [selectionWorking, setSelectionWorking] = useState(false);
  const selection = useFileSelection(
    JSON.stringify([
      settingsOpen ? "settings" : view,
      service,
      query,
      page,
      movieSort,
      settings?.seasonMode,
      settings?.pageSize,
      bySeries,
    ]),
    pageKeys,
  );
  const active = [...q.entries()].filter(
    ([k]) => k !== "sort" && k !== "dir" && !k.endsWith("Op"),
  );
  // A preset matches the filters as they are, or, without an instance of
  // its own, the filters beside the instance (the segment is navigation).
  const bare = new URLSearchParams(query);
  bare.delete("instance");
  const current = [query, bare.toString()].map(canonicalPresetQuery);
  const matchingPresets = presets.filter(
    (p) =>
      p.service === service && current.includes(canonicalPresetQuery(p.query)),
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
  // A library opened by a link or an action starts without a selection and
  // with the drawer closed; Back, Forward and replaces keep both. Before the
  // paint, so the opened library never shows the old state.
  const entry = useRef(libraryEntry);
  useLayoutEffect(() => {
    if (entry.current === libraryEntry) return;
    entry.current = libraryEntry;
    selection.clear();
    setDrawer(null);
  }, [libraryEntry]);
  return {
    customOpen,
    setCustomOpen,
    singleCustom,
    setSingleCustom,
    results,
    loaded,
    facets,
    presetIds,
    drawer,
    openDrawer,
    closeDrawer,
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
    query,
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
    replaceFilters,
    applyFilters,
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
    seriesView,
    bySeries,
    expanding,
    entries,
    pageKeys,
  };
}

export type PageEntry = { key: FileKey; file?: MediaFile };
const keyOfFile = (f: MediaFile): FileKey => ({
  service: f.service,
  id: f.id,
  mediaId: f.mediaId,
  season: f.season,
  filename: f.filename,
  title: f.title,
});
// The files of a page (see above): the answer's files, or for a page of
// series summaries each series' keys, with the files the answer holds.
export function pageEntries(results: Results): PageEntry[] {
  if (!results.series)
    return results.files.map((file) => ({ key: keyOfFile(file), file }));
  const held = new Map(
    results.files.map((file) => [file.service + ":" + file.id, file]),
  );
  return results.series.flatMap((s) =>
    s.keys.map(([id, season]) => {
      const file = held.get(s.service + ":" + id);
      return file
        ? { key: keyOfFile(file), file }
        : { key: { service: s.service, id, mediaId: s.mediaId, season } };
    }),
  );
}
