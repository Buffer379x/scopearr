import { CSVExport } from "./ToolFilters";
import { MuxSelectionActions } from "./MuxSelectionActions";
import { ICON } from "../ui";
import { EmptyState } from "./EmptyState";
import { PageHeader } from "./PageHeader";
import { Pagination } from "./Pagination";
import { SavePresetDialog } from "./SavePresetDialog";
import { instancesOf, instanceLabel } from "../instances";
import {
  ArrowUpRight,
  Bookmark,
  Columns3,
  Database,
  LoaderCircle,
  RotateCcw,
  Search,
  Tag as TagIcon,
} from "lucide-preact";
import { t } from "../i18n";
import type { Settings, Status } from "../types";
import { TagInformation } from "../ui";
import { CustomBulk } from "./CustomBulk";
import { LibraryTable } from "./LibraryTable";
import type { AppNavigation } from "../hooks/useAppNavigation";
import type { LibraryState } from "../hooks/useLibraryState";
import { useAppData } from "./AppDataProvider";
import { count, defaultWarningColors } from "../ui";
import { FileDialog } from "./FileDialog";
import { FilterPanel } from "./FilterPanel";

type LibraryProps = {
  status: Status;
  refresh: () => Promise<void>;
  settings: Settings | null;
  library: LibraryState;
  navigation: AppNavigation;
};

// The movie or TV library: header, filters, results table and pagination.
export function LibraryPage({
  status,
  refresh,
  settings,
  library,
  navigation,
}: LibraryProps) {
  const { presets } = useAppData();
  const {
    service,
    page,
    setPage,
    movieSort,
    sortLibrary,
    openMuxFile,
    openSettings,
    canLeaveRules,
  } = navigation;
  const {
    setCustomOpen,
    setSingleCustom,
    results,
    facets,
    showAllColumns,
    setShowAllColumns,
    collapsed,
    setCollapsed,
    setFilename,
    busy,
    setSavePreset,
    setPresetError,
    q,
    libraryInstances,
    syncCount,
    setRenameRevision,
    configured,
    visibleColumns,
    columnOrder,
    displayColumns,
    change,
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
  } = library;
  return (
    <>
      <PageHeader
        title={service === "radarr" ? t("Movie library") : t("TV library")}
        meta={
          <>
            {count(syncCount)} {t("files in cache")}
          </>
        }
      />
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
        export={
          <CSVExport
            href={"/api/export?" + exportQuery}
            enabled={results.total > 0}
          />
        }
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
        <div class="results-heading library-results-heading">
          <div>
            <h2>
              {t(service === "radarr" ? "Your movies" : "Your TV series")}
              {q.get("instance") &&
                libraryInstances.some((i) => i.id === q.get("instance")) &&
                " · " +
                  instanceLabel(
                    libraryInstances.find((i) => i.id === q.get("instance"))!,
                  )}{" "}
              <span class="heading-count" title={t("Items in the list")}>
                {count(results.total)}
              </span>
              {busy && <LoaderCircle size={ICON.button} class="spin" />}
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
              class="button compact-selection-action"
              aria-label={
                showAllColumns[service] ? t("Default view") : t("All columns")
              }
              aria-pressed={showAllColumns[service]}
              disabled={
                visibleColumns.length === columnOrder.length &&
                !showAllColumns[service]
              }
              title={
                (showAllColumns[service]
                  ? t("Default view")
                  : t("All columns")) +
                " · " +
                (showAllColumns[service]
                  ? t("Return to saved columns")
                  : t("Show hidden columns in the saved order"))
              }
              onClick={() =>
                setShowAllColumns({
                  ...showAllColumns,
                  [service]: !showAllColumns[service],
                })
              }
            >
              <Columns3 size={ICON.label} />{" "}
              <span class="selection-action-label">
                {showAllColumns[service] ? t("Default view") : t("All columns")}
              </span>
            </button>
            <MuxSelectionActions
              compact
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
              class="button selection-action compact-selection-action"
              aria-label={t("Set tag ({count})", {
                count: selection.keys.length,
              })}
              disabled={selectionWorking || !selection.keys.length}
              title={
                t("Set tag ({count})", {
                  count: selection.keys.length,
                }) +
                " · " +
                t(
                  !selection.keys.length
                    ? "Select entries first."
                    : "Set tags for selected files",
                )
              }
              onClick={() => setCustomOpen(true)}
            >
              <TagIcon size={ICON.label} />
              <span class="selection-action-label">
                {t("Set tag ({count})", {
                  count: selection.keys.length,
                })}
              </span>
              <span class="selection-action-count" aria-hidden="true">
                {count(selection.keys.length)}
              </span>
            </button>
          </div>
        </div>
        <div class={"table-wrap" + (busy ? " busy" : "")} aria-busy={busy}>
          <LibraryTable
            files={results.files}
            selection={{
              ...selection,
              busy: selectionWorking,
            }}
            muxJobs={muxJobs}
            openMux={(file) => openMuxFile(file.filename)}
            service={service}
            settings={settings}
            displayColumns={displayColumns}
            movieSort={movieSort}
            sortColumn={sortLibrary}
            setFilename={setFilename}
            setSingleCustom={setSingleCustom}
          />
          {!results.files.length && !busy && (
            <EmptyState
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
              <button
                class={active.length ? "icon-button" : "button"}
                title={active.length ? t("Reset filters") : undefined}
                aria-label={
                  active.length ? t("Reset filters") : t("Open settings")
                }
                onClick={active.length ? reset : () => openSettings()}
              >
                {active.length ? (
                  <RotateCcw size={ICON.button} />
                ) : (
                  t("Open settings")
                )}
              </button>
            </EmptyState>
          )}
        </div>
        <Pagination
          page={page}
          pages={pages}
          setPage={setPage}
          summary={
            <>
              {results.displayTotal
                ? t("{from}–{to} of {total} files", {
                    from: count((page - 1) * results.pageSize + 1),
                    to: count(
                      Math.min(page * results.pageSize, results.displayTotal),
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
      </section>
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
  const { service, openTool } = navigation;
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
  } = library;
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
      {filename && (
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
            renamed={() => {
              setFilename(null);
              setRenameRevision((n) => n + 1);
              void refresh();
            }}
            openMux={async () => {
              await refresh();
              setFilename(null);
              openTool("mux");
            }}
            file={filename}
            close={() => setFilename(null)}
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
          <button type="submit" class="primary">
            <Bookmark size={ICON.label} />
            {t("Save view")}
          </button>
        </SavePresetDialog>
      )}
    </>
  );
}
