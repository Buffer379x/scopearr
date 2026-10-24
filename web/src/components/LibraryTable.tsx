import { SelectionBox } from "./SelectionBox";
import {
  fileKey,
  groupSelected,
  type useFileSelection,
} from "../hooks/useFileSelection";
import { ICON } from "../ui";
import { instancesOf, instanceLabel } from "../instances";
import { Layers, Tag as TagIcon } from "lucide-preact";
import type { JSX } from "preact";
import { t, useI18n } from "../i18n";
import type { FilmSort, MediaFile, Service, Settings } from "../types";
import { bytes, columnLabels, Tag, TagInformation } from "../ui";
import { AudioCell } from "./AudioCell";
import { autoTagHint, AutoTagMark } from "./AutoTagMark";
import { ChannelsCell } from "./ChannelsCell";
import { RowInfo } from "./RowInfo";
import { SortableHeader } from "./SortableHeader";

export function LibraryTable({
  files,
  groups,
  selection,
  muxJobs,
  openMux,
  service,
  settings,
  displayColumns,
  movieSort,
  sortColumn,
  setFilename,
  setSingleCustom,
}: {
  files: MediaFile[];
  groups: import("../types").FileGroup[];
  selection: ReturnType<typeof useFileSelection>;
  muxJobs: import("../types").MuxJob[];
  openMux: (file: MediaFile) => void;
  service: Service;
  settings: Settings | null;
  displayColumns: string[];
  movieSort: FilmSort;
  sortColumn: (field: string) => void;
  setFilename: (file: MediaFile) => void;
  setSingleCustom: (file: MediaFile) => void;
}) {
  useI18n();
  const libraryInstances = instancesOf(settings, true).filter(
    (instance) => instance.type === service,
  );
  const showInstance = libraryInstances.length > 1;
  const instanceNames = Object.fromEntries(
    libraryInstances.map((instance) => [instance.id, instanceLabel(instance)]),
  );
  const outlierSeasons = new Set(
    files
      .filter((file) => file.seasonOutlier || file.languageOutlier)
      .map((file) => `${file.service}/${file.mediaId}/${file.season}`),
  );
  const columnHeader = (field: string, label: string, titleCell = false) => (
    <SortableHeader
      key={field}
      label={label}
      className={
        titleCell
          ? "title-cell"
          : ["year", "size", "bitDepth", "channels"].includes(field)
            ? "number"
            : undefined
      }
      active={movieSort.field === field}
      direction={movieSort.direction}
      onSort={() => sortColumn(field)}
    />
  );

  return (
    <table
      class={
        "data-table" + (displayColumns.includes("custom") ? " with-custom" : "")
      }
    >
      <thead>
        <tr>
          <th scope="col" class="col-control">
            <SelectionBox
              label={t("Select this page")}
              total={files.length}
              count={files.filter((f) => selection.selected[fileKey(f)]).length}
              disabled={selection.busy}
              change={(checked) =>
                selection.toggle(
                  files.map((f) => ({
                    service: f.service,
                    id: f.id,
                    mediaId: f.mediaId,
                    season: f.season,
                    filename: f.filename,
                    title: f.title,
                  })),
                  checked,
                )
              }
            />
          </th>
          {displayColumns.map((field) =>
            columnHeader(
              field,
              field === "title"
                ? service === "radarr"
                  ? t("Title")
                  : t("Episode")
                : columnLabels[field],
              field === "title",
            ),
          )}
        </tr>
      </thead>
      <tbody>
        {files.map((f, i) => {
          const prev = files[i - 1];
          const group =
            service === "sonarr" &&
            movieSort.field === "title" &&
            (!prev ||
              prev.service !== f.service ||
              prev.mediaId !== f.mediaId ||
              prev.season !== f.season);
          const seriesGroup =
            service === "sonarr" &&
            movieSort.field === "title" &&
            (!prev || prev.service !== f.service || prev.mediaId !== f.mediaId);
          const series = groups.find(
            (g) =>
              g.service === f.service &&
              g.mediaId === f.mediaId &&
              g.season === undefined,
          );
          const season = groups.find(
            (g) =>
              g.service === f.service &&
              g.mediaId === f.mediaId &&
              g.season === f.season,
          );
          const cells: Record<string, JSX.Element> = {
            title: (
              <td key="title" class="title-cell">
                <div class="title-line">
                  <strong class="cell-title">
                    {service === "sonarr" && movieSort.field !== "title"
                      ? `${f.series} · S${String(f.season).padStart(2, "0")}E${(f.episodes || []).map((e) => String(e.number).padStart(2, "0")).join("–")}`
                      : f.title}
                  </strong>
                  {showInstance && (
                    <small class="instance-label">
                      {f.instanceName || instanceNames[f.service] || f.service}
                    </small>
                  )}
                </div>
                {service === "sonarr" && (
                  <small class="cell-sub">
                    {movieSort.field !== "title" ? f.title + " · " : ""}
                    {f.filename}
                  </small>
                )}
                {!f.matched && (
                  <small class="cell-sub">
                    {t("Season context · not a filter match")}
                  </small>
                )}
              </td>
            ),
            info: (
              <td key="info" class="info-cell">
                <RowInfo
                  file={f}
                  settings={settings}
                  details={() => setFilename(f)}
                  muxJob={muxJobs.find(
                    (j) => j.service === f.service && j.fileId === f.id,
                  )}
                  openMux={() => openMux(f)}
                />
              </td>
            ),
            year: (
              <td key="year" class="year-cell number">
                {f.years.length ? f.years.join(" / ") : "—"}
              </td>
            ),
            resolution: (
              <td key="resolution">
                <Tag
                  respectHidden
                  value={f.resolution}
                  kind={"resolution r" + f.resolution}
                />
              </td>
            ),
            codec: (
              <td key="codec">
                <Tag
                  respectHidden
                  value={f.codec}
                  kind="codec"
                  title={f.family}
                />
              </td>
            ),
            source: (
              <td key="source">
                <Tag respectHidden value={f.source} />
              </td>
            ),
            processing: (
              <td key="processing">
                <Tag respectHidden value={f.processing} kind="processing" />
              </td>
            ),
            size: (
              <td key="size" class="nowrap">
                {bytes(f.size)}
              </td>
            ),
            hdr: (
              <td key="hdr">
                <div class="source-tags">
                  {(f.hdr ? f.hdr.split(" + ") : [""]).map((value) => (
                    <Tag respectHidden value={value} kind="hdr" />
                  ))}
                </div>
              </td>
            ),
            bitDepth: (
              <td key="bitDepth" class="number">
                <Tag respectHidden kind="bitDepth" value={f.bitDepth} />
              </td>
            ),
            audio: (
              <td key="audio" class="audio-tracks-cell">
                <AudioCell file={f} />
              </td>
            ),
            custom: (
              <td key="custom" class="custom-cell">
                <div class="source-tags">
                  <button
                    class="icon-button single-tag-button"
                    aria-label={t("Edit custom tags: {title}", {
                      title: f.title,
                    })}
                    title={t("Edit custom tags: {title}", {
                      title: f.title,
                    })}
                    onClick={() => setSingleCustom(f)}
                  >
                    <TagIcon size={ICON.button} />
                  </button>
                  {(f.custom || []).map((tag) => (
                    <Tag
                      respectHidden
                      kind="custom"
                      value={String(tag.id)}
                      forceTag={tag.manual || tag.protected}
                      label={tag.displayName || tag.name}
                      title={
                        tag.protected
                          ? autoTagHint(tag, settings)
                          : tag.displayName || tag.name
                      }
                    >
                      <AutoTagMark tag={tag} settings={settings} />
                      {tag.displayName || tag.name}
                    </Tag>
                  ))}
                </div>
              </td>
            ),
            channels: (
              <td key="channels" class="audio-tracks-cell">
                <ChannelsCell file={f} />
              </td>
            ),
          };
          return (
            <>
              {seriesGroup && (
                <tr class="series-row">
                  <td class="col-control">
                    <SelectionBox
                      label={t("Select series {name}", { name: f.series })}
                      total={series?.total || 0}
                      count={groupSelected(
                        selection.keys,
                        f.service,
                        f.mediaId,
                      )}
                      disabled={selection.busy}
                      change={(checked) =>
                        void selection
                          .group(f.service, f.mediaId, undefined, checked)
                          ?.catch(() => {})
                      }
                    />
                  </td>
                  <td colSpan={displayColumns.length}>
                    <strong class="cell-title">
                      {f.series}
                      {series?.continued ? " " + t("(continued)") : ""}
                    </strong>
                    <small class="cell-sub">
                      {t("{count} episodes", { count: series?.total || 0 }) +
                        " · " +
                        t("{count} seasons", { count: series?.seasons || 0 })}
                    </small>
                  </td>
                </tr>
              )}
              {group && (
                <tr
                  class={
                    "season-row" +
                    (outlierSeasons.has(`${f.service}/${f.mediaId}/${f.season}`)
                      ? " has-outlier"
                      : "")
                  }
                >
                  <td class="col-control">
                    <SelectionBox
                      label={t("Select season {number} of {series}", {
                        number: f.season,
                        series: f.series,
                      })}
                      total={season?.total || 0}
                      count={groupSelected(
                        selection.keys,
                        f.service,
                        f.mediaId,
                        f.season,
                      )}
                      disabled={selection.busy}
                      change={(checked) =>
                        void selection
                          .group(f.service, f.mediaId, f.season, checked)
                          ?.catch(() => {})
                      }
                    />
                  </td>
                  <td colSpan={displayColumns.length}>
                    <Layers size={ICON.label} />
                    <strong>
                      {f.season === 0
                        ? t("Specials")
                        : t("Season {number}", {
                            number: String(f.season).padStart(2, "0"),
                          })}
                    </strong>
                    <span class="season-note">
                      {settings?.seasonMode === "season"
                        ? t("Season context enabled")
                        : t("Matching files")}
                    </span>
                  </td>
                </tr>
              )}
              <TagInformation.Provider value={f.informationOnly || {}}>
                <tr
                  key={f.service + f.id}
                  title={[
                    f.seasonOutlier ? t("Technical outliers") : "",
                    f.languageOutlier ? t("Language outliers") : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  class={[
                    selection.selected[fileKey(f)] ? "is-selected" : "",
                    !f.matched ? "context-row" : "",
                    f.seasonOutlier ? "technical-outlier" : "",
                    f.languageOutlier ? "language-outlier" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <td class="col-control">
                    <SelectionBox
                      label={t("Select {title}", { title: f.title })}
                      total={1}
                      count={selection.selected[fileKey(f)] ? 1 : 0}
                      disabled={selection.busy}
                      change={(checked) =>
                        selection.toggle(
                          [
                            {
                              service: f.service,
                              id: f.id,
                              mediaId: f.mediaId,
                              season: f.season,
                              filename: f.filename,
                              title: f.title,
                            },
                          ],
                          checked,
                        )
                      }
                    />
                  </td>
                  {displayColumns.map((field) => cells[field])}
                </tr>
              </TagInformation.Provider>
            </>
          );
        })}
      </tbody>
    </table>
  );
}
