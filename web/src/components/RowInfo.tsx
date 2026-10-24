import { muxStatusLabels } from "../mux-spec";
import { ICON, Tooltip } from "../ui";
import { instanceByID, instanceLabel, serviceType } from "../instances";
import {
  Scissors,
  TriangleAlert,
  FileVideo2,
  Film,
  Link2,
  OctagonAlert,
} from "lucide-preact";
import { MediaServerLink } from "./MediaServerLink";
import type { MediaFile, Settings } from "../types";
import { defaultWarningColors } from "../ui";
import { entryLink } from "../entry-link";
import { t, useI18n } from "../i18n";
export const infoOrder = [
  "link",
  "media",
  "details",
  "metadata",
  "recognition",
  "mux",
];
export function RowInfo({
  file,
  settings,
  details,
  muxJob,
  openMux,
}: {
  file: MediaFile;
  settings: Settings | null;
  details: () => void;
  muxJob?: import("../types").MuxJob;
  openMux?: () => void;
}) {
  useI18n();
  const href = entryLink(instanceByID(settings, file.service), file);
  const linkLabel = t("Open {service} entry in a new tab", {
    service: instanceLabel(
      instanceByID(settings, file.service) || { id: file.service },
    ),
  });
  const visible = settings?.listInfoVisible || infoOrder;
  const buttons = {
    mux:
      muxJob && openMux ? (
        <Tooltip
          content={t("Marked for muxing · {status}", {
            status: t(muxStatusLabels[muxJob.status] || muxJob.status),
          })}
        >
          <button
            type="button"
            class="row-icon info-action mux-mark"
            aria-label={t("Marked for muxing · {status}", {
              status: t(muxStatusLabels[muxJob.status] || muxJob.status),
            })}
            onClick={openMux}
          >
            <Scissors size={ICON.row} />
          </button>
        </Tooltip>
      ) : null,
    link: href ? (
      <a
        class="row-icon info-action"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        referrerPolicy="no-referrer"
        title={linkLabel}
        aria-label={linkLabel}
      >
        <Link2 size={ICON.row} />
      </a>
    ) : (
      <button
        class="row-icon info-action"
        disabled
        aria-label={linkLabel}
        title={t(
          "Entry link unavailable. Configure the service and synchronize the library.",
        )}
      >
        <Link2 size={ICON.row} />
      </button>
    ),
    media: <MediaServerLink file={file} settings={settings} />,
    details: (
      <Tooltip content={file.filename}>
        <button
          class="row-icon file-button info-action"
          aria-label={t("Filename and metadata: {title}", {
            title: file.title,
          })}
          onClick={details}
        >
          {(file.type || serviceType(file.service)) === "radarr" ? (
            <Film size={ICON.row} />
          ) : (
            <FileVideo2 size={ICON.row} />
          )}
        </button>
      </Tooltip>
    ),
    metadata: file.conflict ? (
      <button
        class="row-icon info-action info-warning"
        title={t("Metadata disagreement")}
        style={{
          color:
            settings?.warningColors.metadata || defaultWarningColors.metadata,
        }}
        aria-label={t("Show conflicting metadata")}
        onClick={details}
      >
        <TriangleAlert size={ICON.row} />
      </button>
    ) : null,
    recognition: file.ruleConflict ? (
      <button
        class="row-icon info-action info-warning"
        title={t("Conflicting recognition rules")}
        style={{
          color:
            settings?.warningColors.recognition ||
            defaultWarningColors.recognition,
        }}
        aria-label={t("Show recognition conflicts")}
        onClick={details}
      >
        <OctagonAlert size={ICON.row} />
      </button>
    ) : null,
  };
  return (
    <div class="info-actions">
      {(settings?.listInfoOrder || infoOrder)
        .filter((key) => visible.includes(key))
        .map((key) => buttons[key as keyof typeof buttons])}
    </div>
  );
}
