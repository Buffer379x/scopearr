import {
  CircleAlert,
  OctagonAlert,
  Scissors,
  TriangleAlert,
} from "lucide-preact";
import type { JSX } from "preact";
import { t, useI18n } from "../../i18n";
import { muxStatusLabels } from "../../mux-spec";
import type { MediaFile, MuxJob, Settings } from "../../types";
import { defaultWarningColors, ICON } from "../../ui";
import { RowMark } from "../list/RowMark";
import { infoShown } from "./InfoButtons";

// The marks after a title (docs/STYLEGUIDE.md, Part 1, 10.10; ruling R-H),
// RowMarks with their 13 icon (ICON.sort) in the order and visibility of
// the info icon settings: metadata (a metadata conflict) and recognition
// (a rule conflict) in the user's warning colors (Settings → Display), each
// opening File & metadata; mux (accent) only with a mux job, opening it;
// then the outliers (info, an image): "Technical outliers", "Language
// outliers" or both. The names and titles are those of 1.7.0.
export function TitleMarks({
  file,
  settings,
  muxJob,
  openMux,
  openDetails,
}: {
  file: MediaFile;
  settings: Settings | null;
  muxJob?: MuxJob;
  openMux(): void;
  openDetails(): void;
}): JSX.Element {
  useI18n();
  const colors = settings?.warningColors;
  const marks: Record<string, JSX.Element | null> = {
    metadata: file.conflict ? (
      <RowMark
        key="metadata"
        tone="warn"
        label={t("Show conflicting metadata")}
        title={t("Metadata disagreement")}
        color={colors?.metadata || defaultWarningColors.metadata}
        icon={<TriangleAlert size={ICON.sort} />}
        onClick={openDetails}
      />
    ) : null,
    recognition: file.ruleConflict ? (
      <RowMark
        key="recognition"
        tone="warn"
        label={t("Show recognition conflicts")}
        title={t("Conflicting recognition rules")}
        color={colors?.recognition || defaultWarningColors.recognition}
        icon={<OctagonAlert size={ICON.sort} />}
        onClick={openDetails}
      />
    ) : null,
    mux: muxJob ? (
      <RowMark
        key="mux"
        tone="accent"
        label={t("Marked for muxing · {status}", {
          status: t(muxStatusLabels[muxJob.status] || muxJob.status),
        })}
        icon={<Scissors size={ICON.sort} />}
        onClick={openMux}
      />
    ) : null,
  };
  const outliers = [
    file.seasonOutlier ? t("Technical outliers") : "",
    file.languageOutlier ? t("Language outliers") : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      {infoShown(settings, ["metadata", "recognition", "mux"]).map(
        (key) => marks[key],
      )}
      {outliers && (
        <RowMark
          key="outliers"
          tone="info"
          label={outliers}
          icon={<CircleAlert size={ICON.sort} />}
        />
      )}
    </>
  );
}
