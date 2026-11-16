import { ChevronDown, ChevronUp, Layers } from "lucide-preact";
import { Fragment, type ComponentChildren, type JSX } from "preact";
import { channelRows } from "../../audio-channels";
import { fileKey, groupSelected } from "../../file-selection";
import type { useFileSelection } from "../../hooks/useFileSelection";
import { t, useI18n } from "../../i18n";
import { instanceLabel, instancesOf } from "../../instances";
import type { TrackFilterAction } from "../../library-filters";
import type {
  FileKey,
  FilmSort,
  MediaFile,
  MuxJob,
  Service,
  Settings,
} from "../../types";
import { bytes, columnLabels, ICON, TagInformation } from "../../ui";
import { SelectionBox } from "../SelectionBox";
import { MediaTag } from "../list/MediaTag";
import { RowButton } from "../list/RowButton";
import { SortHeader } from "../list/SortHeader";
import { CustomTagsCell } from "./CustomTagsCell";
import { InfoButtons } from "./InfoButtons";
import { TitleCell } from "./TitleCell";
import { TracksCell } from "./TracksCell";

// Columns of numbers: right aligned in tabular figures, and on a narrow
// card their column label goes before them.
const NUMERIC = ["year", "size", "bitDepth"];
const pad = (n: number) => String(n).padStart(2, "0");
const NBSP = "\u00a0";
const keyOf = (f: MediaFile): FileKey => ({
  service: f.service,
  id: f.id,
  mediaId: f.mediaId,
  season: f.season,
  filename: f.filename,
  title: f.title,
});
// A row's id for the series toggle's aria-controls (a file key or a
// season, made safe for an id).
const rowId = (...parts: (string | number)[]) =>
  "v2-sr-" + parts.join("-").replace(/[^\w-]/g, "_");
// The cell classes of a column: its place on a narrow card (title, info,
// a wide one of two tracks) and the numbers.
const CELL: Record<string, string> = {
  title: "v2-table-title",
  info: "v2-table-info",
  audio: "v2-table-wide",
  custom: "v2-table-wide",
};

// The media table of the libraries (docs/STYLEGUIDE.md, Part 1, 10.10):
// table.v2-table with the selection column (the page, each series and
// season, each file; tri-state, locked while a selection action runs),
// then the saved columns in their order, each sortable through SortHeader
// (the audio tracks with their sort menu). A TV series in its default sort
// has a series row and a season row before its files; the series row's
// Info cell holds its toggle (rc.3 K3): expanded by default, collapsed
// (`collapsed`, the session's choice) it hides the series' season and file
// rows, which still count for the boxes and the page. Each
// row edge tells a metadata or rule conflict (warn) or incomplete metadata
// (info); a season context row is muted. Until a service's first results
// the body holds `placeholders` rows of the row height, hidden from
// assistive technology: the same cells as a file row, each a no-break
// space (the title's two lines), so on a narrow card they wrap into the
// same lines as a file row. Every cell names its column (data-label), and the
// explicit table roles keep the semantics when a narrow card turns the
// rows into cards.
export function MediaTable(p: {
  files: MediaFile[];
  placeholders: number;
  service: Service;
  settings: Settings | null;
  columns: string[];
  sort: FilmSort;
  onSort(field: string): void;
  selection: ReturnType<typeof useFileSelection> & { busy: boolean };
  muxJobs: MuxJob[];
  openMux(file: MediaFile): void;
  openDetails(file: MediaFile): void;
  editTags(file: MediaFile): void;
  stacked: boolean;
  onTrackFilter(action: TrackFilterAction): void;
  collapsed?: ReadonlySet<string>;
  toggleSeries?(key: string, title: string, open: boolean): void;
}): JSX.Element {
  useI18n();
  const { files, service, settings, columns, sort, selection } = p;
  const own = instancesOf(settings, true).filter(
    (instance) => instance.type === service,
  );
  // Instance names, only when the service has more than one instance.
  const names =
    own.length > 1
      ? Object.fromEntries(
          own.map((instance) => [instance.id, instanceLabel(instance)]),
        )
      : null;
  const grouped = service === "sonarr" && sort.field === "title";
  // The series toggle lives in the Info column; without it every series
  // shows its episodes.
  const infoAt = grouped ? columns.indexOf("info") : -1;
  const isOpen = (series: string) => infoAt < 0 || !p.collapsed?.has(series);
  // The files of each series and season on this page, and the ids of a
  // series' season and file rows.
  const counts = new Map<string, number>();
  const seasons = new Map<string, Set<number>>();
  const outliers = new Set<string>();
  const members = new Map<string, string[]>();
  files.forEach((f, i) => {
    const series = f.service + "/" + f.mediaId;
    const season = series + "/" + f.season;
    counts.set(series, (counts.get(series) ?? 0) + 1);
    counts.set(season, (counts.get(season) ?? 0) + 1);
    seasons.set(series, (seasons.get(series) ?? new Set()).add(f.season));
    if (f.seasonOutlier || f.languageOutlier) outliers.add(season);
    if (infoAt < 0) return;
    const prev = files[i - 1];
    const ids = members.get(series) ?? [];
    if (
      !prev ||
      prev.service + "/" + prev.mediaId !== series ||
      prev.season !== f.season
    )
      ids.push(rowId(season));
    ids.push(rowId(f.service, f.id));
    members.set(series, ids);
  });
  const label = (field: string): string =>
    field === "title"
      ? service === "radarr"
        ? t("Title")
        : t("Episode")
      : field === "audio"
        ? t("Audio tracks")
        : columnLabels[field] || field;
  const box = (
    name: string,
    total: number,
    selected: number,
    change: (checked: boolean) => void,
  ) => (
    <label class="v2-table-hit">
      <SelectionBox
        className="v2-check"
        label={name}
        total={total}
        count={selected}
        disabled={selection.busy}
        change={change}
      />
    </label>
  );
  const selCell = (content: JSX.Element) => (
    <td role="cell" class="v2-table-sel">
      {content}
    </td>
  );
  const content = (f: MediaFile, field: string): ComponentChildren => {
    switch (field) {
      case "title":
        return (
          <TitleCell
            file={f}
            service={service}
            sort={sort}
            settings={settings}
            instance={
              names
                ? f.instanceName || names[f.service] || f.service
                : undefined
            }
            muxJob={p.muxJobs.find(
              (job) => job.service === f.service && job.fileId === f.id,
            )}
            openMux={() => p.openMux(f)}
            openDetails={() => p.openDetails(f)}
          />
        );
      case "info":
        return (
          <InfoButtons
            file={f}
            settings={settings}
            openDetails={() => p.openDetails(f)}
          />
        );
      case "year":
        return f.years.length ? f.years.join(" / ") : "—";
      case "resolution":
        return (
          <MediaTag respectHidden value={f.resolution} kind="resolution" />
        );
      case "codec":
        return (
          <MediaTag
            respectHidden
            value={f.codec}
            kind="codec"
            title={f.family}
          />
        );
      case "source":
        return <MediaTag respectHidden value={f.source} />;
      case "processing":
        return (
          <MediaTag respectHidden value={f.processing} kind="processing" />
        );
      case "size":
        return bytes(f.size);
      case "hdr":
        return (
          <div class="v2-table-items">
            {(f.hdr ? f.hdr.split(" + ") : [""]).map((value) => (
              <MediaTag key={value} respectHidden value={value} kind="hdr" />
            ))}
          </div>
        );
      case "bitDepth":
        return <MediaTag respectHidden value={f.bitDepth} kind="bitDepth" />;
      case "audio":
        return (
          <TracksCell file={f} stacked={p.stacked} onFilter={p.onTrackFilter} />
        );
      case "channels":
        return (
          <div class={p.stacked ? "v2-trk-stack" : "v2-trk-row"}>
            {channelRows(f).map((value, index) => (
              <MediaTag
                key={index}
                respectHidden
                value={value}
                kind="channels"
              />
            ))}
          </div>
        );
      case "custom":
        return (
          <CustomTagsCell
            file={f}
            settings={settings}
            edit={() => p.editTags(f)}
          />
        );
    }
    return null;
  };
  // A series row: the series and its counts across the columns; with the
  // Info column, that column's cell holds the toggle, the name the cells
  // on the title's side of it (the other side's cell stays empty).
  const seriesCells = (f: MediaFile, series: string) => {
    const name = (
      <>
        <div class="v2-table-name">{f.series}</div>
        <div class="v2-table-sub">
          {t("{count} episodes", {
            count: counts.get(series) ?? 0,
          }) +
            " · " +
            t("{count} seasons", {
              count: seasons.get(series)?.size ?? 0,
            })}
        </div>
      </>
    );
    if (infoAt < 0)
      return (
        <td role="cell" colSpan={columns.length}>
          {name}
        </td>
      );
    const before = infoAt,
      after = columns.length - infoAt - 1,
      first = columns.indexOf("title") < infoAt;
    const span = (n: number, named: boolean) =>
      n > 0 && (
        <td role="cell" colSpan={n} class={named ? undefined : "v2-table-gap"}>
          {named && name}
        </td>
      );
    const open = isOpen(series);
    return (
      <>
        {span(before, first)}
        <td role="cell" class="v2-table-info" data-label={label("info")}>
          <div class="v2-table-items">
            <RowButton
              label={t(
                open ? "Hide episodes: {title}" : "Show episodes: {title}",
                { title: f.series },
              )}
              icon={
                open ? (
                  <ChevronUp size={ICON.row} />
                ) : (
                  <ChevronDown size={ICON.row} />
                )
              }
              disclosure
              expanded={open}
              controls={open ? members.get(series)?.join(" ") : undefined}
              onClick={() => p.toggleSeries?.(series, f.series, !open)}
            />
          </div>
        </td>
        {span(after, !first)}
      </>
    );
  };
  const cellClass = (field: string) =>
    (NUMERIC.includes(field) ? "v2-table-num" : CELL[field]) || undefined;
  return (
    <table class="v2-table" role="table">
      <thead role="rowgroup">
        <tr role="row">
          <th role="columnheader" scope="col" class="v2-table-sel">
            {box(
              t("Select this page"),
              files.length,
              files.filter((f) => selection.selected[fileKey(f)]).length,
              (checked) => selection.toggle(files.map(keyOf), checked),
            )}
          </th>
          {columns.map((field) => (
            <SortHeader
              key={field}
              label={label(field)}
              field={field}
              sort={sort}
              onSort={p.onSort}
              numeric={NUMERIC.includes(field)}
              grow={field === "title"}
              menu={
                field === "audio"
                  ? {
                      fields: [
                        { field: "audio", label: t("Audio tracks") },
                        { field: "channels", label: t("Channels") },
                      ],
                    }
                  : undefined
              }
            />
          ))}
        </tr>
      </thead>
      <tbody role="rowgroup">
        {files.map((f, i) => {
          const prev = files[i - 1];
          const series = f.service + "/" + f.mediaId;
          const season = series + "/" + f.season;
          const newSeries =
            grouped &&
            (!prev || prev.service !== f.service || prev.mediaId !== f.mediaId);
          const newSeason = grouped && (newSeries || prev.season !== f.season);
          const selected = !!selection.selected[fileKey(f)];
          const open = isOpen(series);
          return (
            <Fragment key={fileKey(f)}>
              {newSeries && (
                <tr role="row" class="v2-row--series">
                  {selCell(
                    box(
                      t("Select series {name}", { name: f.series }),
                      counts.get(series) ?? 0,
                      groupSelected(selection.keys, f.service, f.mediaId),
                      (checked) =>
                        selection.group(
                          f.service,
                          f.mediaId,
                          undefined,
                          checked,
                        ),
                    ),
                  )}
                  {seriesCells(f, series)}
                </tr>
              )}
              {newSeason && open && (
                <tr
                  role="row"
                  id={infoAt < 0 ? undefined : rowId(season)}
                  class={
                    "v2-row--season" +
                    (outliers.has(season) ? " v2-row--outlier" : "")
                  }
                >
                  {selCell(
                    box(
                      t("Select season {number} of {series}", {
                        number: f.season,
                        series: f.series,
                      }),
                      counts.get(season) ?? 0,
                      groupSelected(
                        selection.keys,
                        f.service,
                        f.mediaId,
                        f.season,
                      ),
                      (checked) =>
                        selection.group(
                          f.service,
                          f.mediaId,
                          f.season,
                          checked,
                        ),
                    ),
                  )}
                  <td role="cell" colSpan={columns.length}>
                    <div class="v2-table-line">
                      <Layers size={ICON.label} />
                      <span class="v2-table-name">
                        {f.season === 0
                          ? t("Specials")
                          : t("Season {number}", { number: pad(f.season) })}
                      </span>
                      <span class="v2-table-sub">
                        {settings?.seasonMode === "season"
                          ? t("Season context enabled")
                          : t("Matching files")}
                      </span>
                    </div>
                  </td>
                </tr>
              )}
              {open && (
                <TagInformation.Provider value={f.informationOnly || {}}>
                  <tr
                    role="row"
                    id={infoAt < 0 ? undefined : rowId(f.service, f.id)}
                    class={[
                      "v2-row",
                      selected ? "v2-row--selected" : "",
                      !f.matched ? "v2-row--context" : "",
                      f.conflict || f.ruleConflict
                        ? "v2-row--warn"
                        : f.metadataIncomplete
                          ? "v2-row--info"
                          : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {selCell(
                      box(
                        t("Select {title}", { title: f.title }),
                        1,
                        selected ? 1 : 0,
                        (checked) => selection.toggle([keyOf(f)], checked),
                      ),
                    )}
                    {columns.map((field) => (
                      <td
                        key={field}
                        role="cell"
                        class={cellClass(field)}
                        data-label={label(field)}
                      >
                        {content(f, field)}
                      </td>
                    ))}
                  </tr>
                </TagInformation.Provider>
              )}
            </Fragment>
          );
        })}
        {Array.from({ length: p.placeholders }, (_, i) => (
          <tr
            key={"placeholder" + i}
            class="v2-row--placeholder"
            aria-hidden="true"
          >
            <td class="v2-table-sel">{NBSP}</td>
            {columns.map((field) => (
              <td key={field} class={cellClass(field)}>
                {field === "title" ? (
                  <>
                    <div class="v2-table-name">{NBSP}</div>
                    <div class="v2-table-sub">{NBSP}</div>
                  </>
                ) : (
                  NBSP
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
