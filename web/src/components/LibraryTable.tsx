import { instancesOf, instanceLabel } from "../instances";
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  Layers,
  Tag as TagIcon,
} from "lucide-preact";
import type { JSX } from "preact";
import { t, useI18n } from "../i18n";
import type { FilmSort, MediaFile, Service, Settings } from "../types";
import { bytes, columnLabels, Tag, TagInformation } from "../ui";
import { AudioCell } from "./AudioCell";
import { autoTagHint, AutoTagMark } from "./AutoTagMark";
import { ChannelsCell } from "./ChannelsCell";
import { RowInfo } from "./RowInfo";

export function LibraryTable({
  files,
  service,
  settings,
  displayColumns,
  movieSort,
  sortColumn,
  setFilename,
  setSingleCustom,
}: {
  files: MediaFile[];
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
  const columnHeader = (field: string, label: string, titleCell = false) => {
    const current = movieSort.field === field;
    return (
      <th
        key={field}
        scope="col"
        class={titleCell ? "title-cell" : undefined}
        aria-sort={
          service === "radarr" || field === "info"
            ? current
              ? movieSort.direction === "asc"
                ? "ascending"
                : "descending"
              : "none"
            : undefined
        }
      >
        {service === "radarr" || field === "info" ? (
          <button
            class={"column-sort" + (current ? " current" : "")}
            onClick={() => sortColumn(field)}
            aria-label={t("Sort by {field}", { field: label })}
            title={t(
              current && movieSort.direction === "asc"
                ? "Sort {field} descending"
                : "Sort {field} ascending",
              { field: label },
            )}
          >
            {label}
            {current ? (
              movieSort.direction === "asc" ? (
                <ArrowUp size={13} />
              ) : (
                <ArrowDown size={13} />
              )
            ) : (
              <ArrowDownUp size={13} />
            )}
          </button>
        ) : (
          label
        )}
      </th>
    );
  };

  return (
    <table class={displayColumns.includes("custom") ? "with-custom" : ""}>
      <thead>
        <tr>
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
            (!prev ||
              prev.service !== f.service ||
              prev.mediaId !== f.mediaId ||
              prev.season !== f.season);
          const cells: Record<string, JSX.Element> = {
            title: (
              <td key="title" class="title-cell">
                <div class="title-line">
                  <b>{f.title}</b>
                  {showInstance && (
                    <small class="instance-label">
                      {f.instanceName || instanceNames[f.service] || f.service}
                    </small>
                  )}
                </div>
                {service === "sonarr" && (
                  <small class="episode-filename">{f.filename}</small>
                )}
                {!f.matched && (
                  <small class="context-label">
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
                />
              </td>
            ),
            year: (
              <td key="year" class="year-cell">
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
              <td key="bitDepth">
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
                    <TagIcon size={15} />
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
              {group && (
                <tr
                  class={
                    "season-row" +
                    (outlierSeasons.has(`${f.service}/${f.mediaId}/${f.season}`)
                      ? " has-outlier"
                      : "")
                  }
                >
                  <td colSpan={displayColumns.length}>
                    <Layers size={15} />
                    <strong>
                      {f.series} <span>—</span>{" "}
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
                    !f.matched ? "context-row" : "",
                    f.seasonOutlier ? "technical-outlier" : "",
                    f.languageOutlier ? "language-outlier" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
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
