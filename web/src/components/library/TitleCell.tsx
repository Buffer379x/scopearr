import type { JSX } from "preact";
import { t, useI18n } from "../../i18n";
import type {
  FilmSort,
  MediaFile,
  MuxJob,
  Service,
  Settings,
} from "../../types";
import { TitleMarks } from "./TitleMarks";

const pad = (n: number) => String(n).padStart(2, "0");

// The title cell of a library row (docs/STYLEGUIDE.md, Part 1, 10.10): the
// title (an ellipsis, the full text in its title) with the TitleMarks
// after it, then one sub-line (an ellipsis too): the instance name when the
// service has more than one, then the filename (movies too). A TV series
// sorted by another column reads "Series · S01E02" (S01E02–03 for a file
// of two episodes) and "Episode title · filename"; a season context row
// (no filter match, its text muted) starts its sub-line with "Season
// context · not a filter match", so it keeps the row height. With the
// browser preference "Show the filename below the title" off (list-prefs.ts)
// the filename leaves the sub-line, stays in the name's tooltip and as
// screen-reader text; the row height is fixed (--tc-row), so nothing moves.
export function TitleCell({
  file,
  service,
  sort,
  settings,
  filename = true,
  instance,
  muxJob,
  openMux,
  openDetails,
}: {
  file: MediaFile;
  service: Service;
  sort: FilmSort;
  settings: Settings | null;
  // False hides the filename (browser preference); the row keeps its height.
  filename?: boolean;
  instance?: string;
  muxJob?: MuxJob;
  openMux(): void;
  openDetails(): void;
}): JSX.Element {
  useI18n();
  const flat = service === "sonarr" && sort.field !== "title";
  const name = flat
    ? `${file.series} · S${pad(file.season)}E${(file.episodes || []).map((e) => pad(e.number)).join("–")}`
    : file.title;
  const sub = [
    file.matched ? "" : t("Season context · not a filter match"),
    instance,
    flat ? file.title : "",
    filename ? file.filename : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <div class="v2-table-line">
        <span
          class="v2-table-name"
          title={filename ? name : `${name} · ${file.filename}`}
        >
          {name}
        </span>
        <TitleMarks
          file={file}
          settings={settings}
          muxJob={muxJob}
          openMux={openMux}
          openDetails={openDetails}
        />
      </div>
      {filename ? (
        <div class="v2-table-sub" title={sub}>
          {sub}
        </div>
      ) : (
        // Hidden by the preference: the sub-line's other parts stay, the
        // filename is only read aloud (and in the name's tooltip).
        <div class="v2-table-sub" title={sub || undefined}>
          {sub}
          <span class="v2-sr-only">{file.filename}</span>
        </div>
      )}
    </>
  );
}
