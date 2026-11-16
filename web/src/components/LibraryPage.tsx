import {
  ArrowUpRight,
  Bookmark,
  ChevronsDownUp,
  ChevronsUpDown,
  Database,
  Download,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-preact";
import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "preact/hooks";
import { getLocale, t, useI18n } from "../i18n";
import { instanceLabel, instancesOf } from "../instances";
import { audioLanguageLabel } from "../languages";
import {
  activeFilterCount,
  filterChips,
  placeholderRows,
  withTrackAction,
} from "../library-filters";
import { presentedTagLabel } from "../tag-labels";
import type { Settings, Status } from "../types";
import {
  count,
  defaultWarningColors,
  embyMatchLabels,
  ICON,
  labels,
  TagInformation,
  TagLabels,
} from "../ui";
import type { AppNavigation } from "../hooks/useAppNavigation";
import { useFilePager } from "../hooks/useFilePager";
import { useLazyChunk } from "../hooks/useLazyChunk";
import type { LibraryState } from "../hooks/useLibraryState";
import { useListPrefs } from "../hooks/useListPrefs";
import { useAppData } from "./AppDataProvider";
import { CustomBulk } from "./CustomBulk";
import { renameFollowUp, type PendingRename } from "../file-rename";
import { fileKey, routeStep } from "../file-paging";
import {
  resetSeries,
  seriesKey,
  setSeriesOpen,
  useCollapsedSeries,
  useOpenedSeries,
} from "../series-collapse";
import { PageHeader } from "./PageHeader";
import { SavePresetDialog } from "./SavePresetDialog";
import { drawerChunk } from "./library/drawer-chunk";
import { fileDialogChunk } from "./library/file-dialog-chunk";
import { ColumnsMenu } from "./library/ColumnsMenu";
import { InstanceSegment } from "./library/InstanceSegment";
import { MediaTable } from "./library/MediaTable";
import { SelectionTools } from "./library/SelectionTools";
import { ChipsRow } from "./list/ChipsRow";
import { FilterBar } from "./list/FilterBar";
import { ListEmpty } from "./list/ListEmpty";
import { PageNav } from "./list/PageNav";
import { TableCard } from "./list/TableCard";

type LibraryProps = {
  status: Status;
  refresh: () => Promise<void>;
  settings: Settings | null;
  library: LibraryState;
  navigation: AppNavigation;
};

// The movie or TV library (docs/STYLEGUIDE.md, Part 1, 11.1), without the
// transition sheet: the page header with the instance segment, the setup
// notice of a library that is not set up, then the table card: the filter
// bar, the chips row with the page tools, the media table and the pager.
// The filter drawer is a chunk of its own, preloaded at idle and opened
// from the Filters button; its focus returns there.
export function LibraryPage({
  status,
  refresh,
  settings,
  library,
  navigation,
}: LibraryProps) {
  useI18n();
  const { presets, setSettings } = useAppData();
  const tagLabels = useContext(TagLabels);
  const prefs = useListPrefs();
  const {
    service,
    page,
    setPage,
    movieSort,
    sortLibrary,
    openMuxFile,
    openSettings,
    canLeaveRules,
    linkHref,
    openLink,
    setSeriesView,
    seriesViewEntry,
  } = navigation;
  const {
    setCustomOpen,
    setSingleCustom,
    results,
    loaded,
    facets,
    drawer,
    openDrawer,
    closeDrawer,
    setFilename,
    busy,
    setSavePreset,
    setPresetError,
    query,
    q,
    libraryInstances,
    syncCount,
    setRenameRevision,
    configured,
    visibleColumns,
    columnOrder,
    displayColumns,
    change,
    replaceFilters,
    applyFilters,
    applyPreset,
    reset,
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
  } = library;
  const Drawer = useLazyChunk(drawerChunk, !!drawer, closeDrawer);
  // Focus goes back to the Filters button once the drawer has closed,
  // unless it went elsewhere meanwhile.
  const anchor = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (drawer) {
      anchor.current = drawer;
      return;
    }
    const last = anchor.current;
    anchor.current = null;
    const focused = document.activeElement;
    if (last?.isConnected && (!focused || focused === document.body))
      last.focus({ preventScroll: true });
  }, [drawer]);
  const instance = libraryInstances.find((i) => i.id === q.get("instance"));
  const title =
    t(service === "radarr" ? "Your movies" : "Your TV series") +
    (instance ? " · " + instanceLabel(instance) : "");
  // The instance segment follows the sidebar: enabled instances only.
  const segment = instancesOf(settings, true)
    .filter((i) => i.type === service)
    .map((i) => ({ id: i.id, name: instanceLabel(i) }));
  const servicePresets = presets.filter((p) => p.service === service);
  const chips = filterChips(query, {
    field: (key) => labels[key],
    value: (key, value) =>
      key === "embyMatch"
        ? embyMatchLabels[value] || value
        : key === "language"
          ? t(audioLanguageLabel(value, getLocale()))
          : presentedTagLabel(key, value, tagLabels),
    // As 1.7.0: the instance's label (its name, else its service's name).
    instance: (id) => {
      const found = libraryInstances.find((i) => i.id === id);
      return found ? instanceLabel(found) : id;
    },
    translate: t,
  });
  const exportName = t("Export CSV");
  const exportIcon = <Download size={ICON.button} />;
  const empty = loaded && !busy && !results.files.length;
  const settingsAction = async () => {
    if (await canLeaveRules()) openSettings();
  };
  // The series the user collapsed (rc.3 K3), or in the collapsed series
  // view (rc.4 R2) every series of the page but the ones opened, and the
  // live region's word on the last toggle. A search for a series' exact
  // title (quick search's TV series) shows that series' episodes once it is
  // listed, once per search, so it can be collapsed again. Switching the
  // view and a link into one start it again.
  const collapsedSeries = useCollapsedSeries(),
    openedSeries = useOpenedSeries();
  const collapsed = seriesView
    ? new Set(
        results.files.map(seriesKey).filter((key) => !openedSeries.has(key)),
      )
    : collapsedSeries;
  const viewEntry = useRef(seriesViewEntry);
  useLayoutEffect(() => {
    if (viewEntry.current === seriesViewEntry) return;
    viewEntry.current = seriesViewEntry;
    resetSeries(seriesView);
  }, [seriesViewEntry]);
  const [announced, setAnnounced] = useState("");
  const searched = (q.get("q") || "").trim().toLowerCase();
  const expandedFor = useRef("");
  useEffect(() => {
    if (service !== "sonarr" || !searched || expandedFor.current === searched)
      return;
    const hits = results.files.filter(
      (f) => f.series.trim().toLowerCase() === searched,
    );
    if (!hits.length) return;
    expandedFor.current = searched;
    for (const f of hits) setSeriesOpen(seriesKey(f), true, seriesView);
  }, [service, searched, results]);
  const viewName = t(seriesView ? "Expand all series" : "Collapse all series");
  return (
    <>
      <PageHeader
        title={service === "radarr" ? t("Movie library") : t("TV library")}
        meta={
          <>
            {count(syncCount)} {t("files in cache")}
          </>
        }
        actions={
          segment.length > 1 && (
            <InstanceSegment
              service={service}
              instances={segment}
              current={q.get("instance") || ""}
              hrefOf={linkHref}
              open={(target) => void openLink(target)}
            />
          )
        }
      />
      <div class="v2-list-page">
        {!status.demo && settings && !configured && (
          <div class="v2-notice v2-notice--setup">
            <Database size={ICON.large} aria-hidden="true" />
            <div class="v2-notice-body">
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
              type="button"
              class="v2-btn v2-btn--primary"
              onClick={settingsAction}
            >
              {t("Set up service")}
              <ArrowUpRight size={ICON.label} />
            </button>
          </div>
        )}
        <TableCard
          id="library"
          title={title}
          count={results.total}
          countTitle={t("Items in the list")}
          busy={busy}
          hint={
            service === "sonarr" &&
            settings?.seasonMode === "season" &&
            movieSort.field !== "title"
              ? t(
                  "Season context is hidden while sorting by another column. Choose the default title order to show season groups again.",
                )
              : undefined
          }
          bar={
            <FilterBar
              search={{
                label: t("Title or filename"),
                placeholder: t(
                  service === "radarr"
                    ? "Search movie or file …"
                    : "Series, episode or file …",
                ),
                value: q.get("q") || "",
                change: (value) => change("q", value ? [value] : []),
              }}
              preset={{
                label: t("Filter preset"),
                value: selectedPreset ? String(selectedPreset.id) : "all",
                options: [
                  { value: "all", label: t("All files") },
                  ...servicePresets.map((p) => ({
                    value: String(p.id),
                    label: p.name,
                  })),
                ],
                // The instance alone is no selection (it is navigation).
                custom:
                  !selectedPreset && active.some(([k]) => k !== "instance"),
                choose: (value) => {
                  const preset = servicePresets.find(
                    (p) => String(p.id) === value,
                  );
                  if (preset) applyPreset(preset);
                  else reset();
                },
              }}
              filters={{
                count: activeFilterCount(query),
                expanded: !!drawer,
                open: openDrawer,
              }}
            />
          }
          chips={
            <ChipsRow
              label={t("Filters")}
              chips={chips.map((chip) => ({
                key: chip.key,
                label: chip.label,
                excluded: chip.excluded,
                remove: () => replaceFilters(chip.without),
              }))}
              empty={t("No active filters")}
              reset={reset}
              tools={
                <>
                  <SelectionTools
                    selection={selection}
                    muxJobs={muxJobs}
                    installed={!!status.mux?.installed}
                    changed={async () => {
                      await loadMuxJobs();
                      setRenameRevision((n) => n + 1);
                      await refresh();
                    }}
                    busyChanged={setSelectionWorking}
                    editTags={() => setCustomOpen(true)}
                    working={selectionWorking}
                    capacity={settings?.pageSize || results.pageSize}
                  />
                  <span class="v2-tc-sep" aria-hidden="true" />
                  {service === "sonarr" && (
                    <button
                      type="button"
                      data-series-view
                      class="v2-icon-btn"
                      aria-label={viewName}
                      title={
                        movieSort.field === "title"
                          ? viewName
                          : t("Sort by title to group the series.")
                      }
                      disabled={movieSort.field !== "title"}
                      onClick={() => setSeriesView(!seriesView)}
                    >
                      {seriesView ? (
                        <ChevronsUpDown size={ICON.button} />
                      ) : (
                        <ChevronsDownUp size={ICON.button} />
                      )}
                    </button>
                  )}
                  <ColumnsMenu
                    key={service}
                    service={service}
                    settings={settings}
                    order={columnOrder}
                    visible={visibleColumns}
                    saved={setSettings}
                    hrefOf={linkHref}
                    open={(target) => void openLink(target)}
                  />
                  <span class="v2-tc-sep" aria-hidden="true" />
                  <button
                    type="button"
                    class="v2-icon-btn"
                    aria-label={t("Save preset")}
                    title={t("Save filters as a permanent preset")}
                    onClick={() => {
                      setPresetError("");
                      setSavePreset(true);
                    }}
                  >
                    <Bookmark size={ICON.button} />
                  </button>
                  <button
                    type="button"
                    class="v2-icon-btn"
                    aria-label={t("Delete selected preset")}
                    title={t("Delete selected preset")}
                    disabled={!selectedPreset}
                    onClick={() => void deletePreset()}
                  >
                    <Trash2 size={ICON.button} />
                  </button>
                  <span class="v2-tc-sep" aria-hidden="true" />
                  {results.total > 0 ? (
                    <a
                      class="v2-icon-btn"
                      href={"/api/export?" + exportQuery}
                      download
                      aria-label={exportName}
                      title={exportName}
                    >
                      {exportIcon}
                    </a>
                  ) : (
                    <span
                      class="v2-icon-btn"
                      role="link"
                      aria-disabled="true"
                      aria-label={exportName}
                      title={exportName}
                    >
                      {exportIcon}
                    </span>
                  )}
                </>
              }
            />
          }
          density={prefs.density}
          regionLabel={title}
          foot={
            <PageNav
              page={page}
              pages={pages}
              setPage={setPage}
              summary={
                <>
                  {results.pagedBy === "series"
                    ? results.displayTotal
                      ? t("{from}–{to} of {total} series", {
                          from: count((page - 1) * results.pageSize + 1),
                          to: count(
                            Math.min(
                              page * results.pageSize,
                              results.displayTotal,
                            ),
                          ),
                          total: count(results.displayTotal),
                        })
                      : t("0 series")
                    : results.displayTotal
                      ? t("{from}–{to} of {total} files", {
                          from: count((page - 1) * results.pageSize + 1),
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
                </>
              }
            />
          }
        >
          <MediaTable
            files={results.files}
            placeholders={placeholderRows(
              loaded,
              settings?.pageSize || results.pageSize,
              syncCount,
            )}
            service={service}
            settings={settings}
            columns={displayColumns}
            sort={movieSort}
            onSort={sortLibrary}
            selection={{ ...selection, busy: selectionWorking }}
            muxJobs={muxJobs}
            openMux={async (file) => {
              if (await canLeaveRules()) openMuxFile(file.filename);
            }}
            openDetails={setFilename}
            editTags={setSingleCustom}
            stacked={prefs.stacked[service]}
            filename={prefs.filename[service]}
            onTrackFilter={(action) =>
              applyFilters(withTrackAction(query, action))
            }
            collapsed={collapsed}
            toggleSeries={(key, name, open) => {
              setSeriesOpen(key, open, seriesView);
              setAnnounced(
                t(
                  open ? "Episodes shown: {title}" : "Episodes hidden: {title}",
                  {
                    title: name,
                  },
                ),
              );
            }}
          />
          {empty && (
            <ListEmpty
              icon={<Search size={ICON.empty} />}
              title={
                active.length
                  ? t("No matching files.")
                  : t("Your overview starts here.")
              }
            >
              <p>
                {active.length
                  ? t("Adjust or reset your filters.")
                  : t("Connect a service and start the first sync.")}
              </p>
              {active.length ? (
                <button type="button" class="v2-btn" onClick={reset}>
                  <RotateCcw size={ICON.label} />
                  {t("Reset filters")}
                </button>
              ) : (
                <button type="button" class="v2-btn" onClick={settingsAction}>
                  {t("Open settings")}
                </button>
              )}
            </ListEmpty>
          )}
        </TableCard>
        {service === "sonarr" && (
          <p class="v2-sr-only" aria-live="polite">
            {announced}
          </p>
        )}
      </div>
      {Drawer && (
        <Drawer
          service={service}
          title={title}
          query={query}
          facets={facets}
          mediaInfoEnabled={!!settings?.mediaInfo?.enabled}
          apply={applyFilters}
          close={closeDrawer}
        />
      )}
    </>
  );
}

// The library's custom tag, file and save preset dialogs, rendered after main.
export function LibraryDialogs({
  status,
  refresh,
  settings,
  library,
  navigation,
}: LibraryProps) {
  const { loadCustom } = useAppData();
  const {
    service,
    openTool,
    canLeaveRules,
    route,
    setFile,
    setPage,
    movieSort,
  } = navigation;
  const {
    customOpen,
    setCustomOpen,
    singleCustom,
    setSingleCustom,
    filename,
    setFilename,
    setNotice,
    savePreset,
    setSavePreset,
    presetName,
    setPresetName,
    presetError,
    setRenameRevision,
    doSavePreset,
    exportQuery,
    selection,
    results,
    loaded,
    busy,
    seriesView,
  } = library;
  // A rename the library reads again (R-F, user decision F1): once the
  // next results arrive, File & metadata shows the file under its new name,
  // or closes as in 1.7.0 when that page does not list it; closing it or a
  // failed reload forgets the rename (renameFollowUp).
  const [renamedTo, setRenamedTo] = useState<PendingRename<
    typeof results
  > | null>(null);
  // File & metadata on an episode of a collapsed series (a quick search, a
  // deep link, paging) shows that series' episodes (rc.3 K3), in either
  // series view (rc.4 R2).
  useEffect(() => {
    if (filename?.service && filename.series)
      setSeriesOpen(seriesKey(filename), true, seriesView);
  }, [filename]);
  const FileDialog = useLazyChunk(
    fileDialogChunk,
    !!filename,
    () => setFilename(null),
    navigation.view === "library",
  );
  useEffect(() => {
    const step = renameFollowUp(renamedTo, !!filename, results, busy);
    if (step.pending !== renamedTo) setRenamedTo(step.pending);
    if ("file" in step) setFilename(step.file);
  }, [renamedTo, filename, results, busy]);
  // The dialog route (E17, R-H). A file key the dialog does not show yet
  // (a quick search, a deep link, a reload) opens it once that file is on
  // the loaded page; when a new answer does not list it, the key goes
  // quietly, as it does when no request follows it (routeStep). Opening,
  // paging and closing write the key back (a replace); a key the dialog
  // wrote is never reopened.
  const shown = filename ? fileKey(filename) : "",
    wanted = (route.view === "library" && route.file) || "",
    wantedFrom = useRef<{
      key: string;
      results: typeof results;
      checked: boolean;
    }>(),
    mirrored = useRef(shown),
    [check, setCheck] = useState(0);
  if (wantedFrom.current?.key !== wanted)
    wantedFrom.current = { key: wanted, results, checked: false };
  useEffect(() => {
    const from = wantedFrom.current!,
      hit = results.files.find((f) => fileKey(f) === wanted);
    const step = routeStep({
      wanted,
      shown,
      mirrored: mirrored.current,
      onPage: !!hit,
      settled: loaded && !busy,
      fresh: results !== from.results,
      checked: from.checked,
    });
    if (step === "open") setFilename(hit!);
    else if (step === "drop") setFile("");
    else if (step === "check") {
      from.checked = true;
      setCheck((n) => n + 1);
    }
  }, [wanted, results, loaded, busy, check]);
  useEffect(() => {
    if (shown === mirrored.current) return;
    mirrored.current = shown;
    setFile(shown);
  }, [shown]);
  // Paging through the whole filtered list (E16, R-G, F2); the season
  // view pages on its loaded page.
  const position = filename
    ? results.files.findIndex(
        (f) => f.service === filename.service && f.id === filename.id,
      )
    : -1;
  const pager = useFilePager({
    results,
    position: position < 0 ? null : position,
    grouped:
      service === "sonarr" &&
      settings?.seasonMode === "season" &&
      movieSort.field === "title",
    active: !!filename,
    loading: busy,
    setPage,
    open: setFilename,
  });
  return (
    <>
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
              t("Custom tags updated for {count} matching files.", {
                count: total,
              }),
            );
            await loadCustom();
            await refresh();
            setRenameRevision((n) => n + 1);
            setCustomOpen(false);
            setSingleCustom(null);
          }}
        />
      )}
      {filename && FileDialog && (
        <TagInformation.Provider value={filename.informationOnly || {}}>
          <FileDialog
            providers={instancesOf(settings, true)
              .filter(
                (instance) =>
                  instance.type === "emby" || instance.type === "jellyfin",
              )
              .map((instance) => ({
                id: instance.id,
                name: instanceLabel(instance),
              }))}
            warningColors={settings?.warningColors || defaultWarningColors}
            muxAvailable={!!status.mux?.enabled && !!status.mux?.installed}
            renameAvailable={!!status.mux?.enabled && !status.demo}
            metadataUpdated={(updated) => {
              setFilename(updated);
              setRenameRevision((n) => n + 1);
            }}
            renamed={(name) => {
              if (name)
                setRenamedTo({
                  service: filename.service,
                  name,
                  before: results,
                  started: false,
                });
              else setFilename(null);
              setRenameRevision((n) => n + 1);
              void refresh();
            }}
            openMux={async () => {
              if (!(await canLeaveRules())) return;
              await refresh();
              setFilename(null);
              openTool("mux");
            }}
            file={filename}
            close={() => setFilename(null)}
            pager={pager}
          />
        </TagInformation.Provider>
      )}{" "}
      {savePreset && (
        <SavePresetDialog
          description={t(
            service === "radarr"
              ? "Save the current filter combination for movies."
              : "Save the current filter combination for TV series.",
          )}
          name={presetName}
          setName={setPresetName}
          placeholder={t("For example: 1080p · x264")}
          error={presetError}
          submit={doSavePreset}
          close={() => setSavePreset(false)}
        >
          <button
            type="submit"
            form="save-preset-form"
            class="v2-btn v2-btn--primary"
          >
            <Bookmark size={ICON.label} />
            {t("Save view")}
          </button>
        </SavePresetDialog>
      )}
    </>
  );
}
