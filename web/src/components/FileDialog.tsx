import { ICON } from "../ui";
import { useEffect, useRef, useState } from "preact/hooks";
import { ApiError, api } from "../api";
import { notify } from "../notifications";
import type { MuxJob } from "../types";
import { t, useI18n } from "../i18n";
import { LanguageFlag, LanguageFlags } from "./LanguageFlag";
import { Modal } from "./Modal";
import { HelpPopover } from "./HelpPopover";
import { RenameCompanionsDialog } from "./RenameCompanionsDialog";
import { confirmAction } from "../confirmation";
import {
  splitFilename,
  renameState,
  companionDecision,
  type RenamePreview,
} from "../file-rename";

import {
  TriangleAlert,
  OctagonAlert,
  FileVideo2,
  Info,
  Pencil,
  Check,
  X,
  LoaderCircle,
} from "lucide-preact";
import type { MediaFile } from "../types";

import { embyMatchLabels, labels, Tag } from "../ui";
export function FileDialog({
  file,
  warningColors,
  close,
  providers,
  muxAvailable,
  openMux,
  renameAvailable,
  renamed,
}: {
  muxAvailable?: boolean;
  renameAvailable?: boolean;
  renamed?: () => void;
  openMux?: () => void;
  providers: { id: string; name: string }[];
  file: MediaFile;
  warningColors: Record<string, string>;
  close: () => void;
}) {
  useI18n();
  const [muxJob, setMuxJob] = useState<MuxJob>();
  const [muxBusy, setMuxBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [preview, setPreview] = useState<RenamePreview>();
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [stem, extension] = splitFilename(file.filename);
  const validation = renameState(file.filename, name);
  const blocked = !renameAvailable
    ? "Renaming requires the media mount and path mapping under Settings → Services → MKVToolNix"
    : muxJob
      ? "Remove the mux job for this file first"
      : "";
  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);
  function cancelEdit() {
    setPreview(undefined);
    setEditing(false);
  }
  const isEpisode =
    file.service === "sonarr" || file.service.startsWith("sonarr-");
  const request = { service: file.service, fileId: file.id, name };
  async function loadPreview() {
    const p = await api<RenamePreview>("files/rename/preview", "POST", request);
    if (!companionDecision(p.companions).confirm) setPreview(p);
    else if (
      await confirmAction(
        t(
          isEpisode
            ? "Rename this file? Sonarr rescans the series and all connected services are updated."
            : "Rename this file? Radarr rescans the movie and all connected services are updated.",
        ),
        "Rename file",
      )
    )
      await saveRename(false, p);
  }
  async function saveRename(companions: boolean, p: RenamePreview) {
    setPreview(undefined);
    setRenaming(true);
    try {
      const result = await api<{ refresh: string; warning?: string }>(
        "files/rename",
        "POST",
        {
          ...request,
          companions,
          companionNames: p.companions.map((c) => c.from),
        },
      );
      notify(
        result.warning
          ? t(result.warning)
          : t("File renamed. Radarr/Sonarr and media servers were updated."),
        result.refresh === "completed" ? "success" : "warning",
      );
      close();
      renamed?.();
    } catch (e) {
      if (
        e instanceof ApiError &&
        e.message === t("Companion files changed. Review them again")
      ) {
        try {
          await loadPreview();
        } catch {}
      }
    } finally {
      setRenaming(false);
    }
  }
  async function startRename() {
    if (!validation.canSave || renaming || blocked || !jobsLoaded) return;
    setRenaming(true);
    try {
      await loadPreview();
    } catch {
    } finally {
      setRenaming(false);
    }
  }
  useEffect(() => {
    let active = true;
    setJobsLoaded(false);
    if (muxAvailable || renameAvailable)
      api<MuxJob[]>(
        "mux/jobs?service=" +
          encodeURIComponent(file.service) +
          "&fileId=" +
          file.id,
      )
        .then((j) => {
          if (active) {
            setMuxJob(j[0]);
            setJobsLoaded(true);
          }
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [file.service, file.id, muxAvailable, renameAvailable]);

  return (
    <Modal
      title={t("File & metadata")}
      close={close}
      cancel={editing ? cancelEdit : close}
      closeDisabled={renaming || !!preview}
      wide
    >
      {muxAvailable && (
        <div class="row-actions file-dialog-actions">
          <button
            type="button"
            class="button"
            disabled={muxBusy}
            onClick={async () => {
              if (muxJob) {
                openMux?.();
                return;
              }
              setMuxBusy(true);
              try {
                const j = await api<MuxJob>("mux/jobs", "POST", {
                  service: file.service,
                  fileId: file.id,
                });
                setMuxJob(j);
                notify(
                  t("Marked for muxing."),
                  "success",
                );
              } catch {
              } finally {
                setMuxBusy(false);
              }
            }}
          >
            {t(
              muxBusy
                ? "Identifying…"
                : muxJob
                  ? "Open Muxing tab"
                  : "Mark for muxing",
            )}
          </button>
          {muxJob && !["running", "queued"].includes(muxJob.status) && (
            <button
              type="button"
              class="button"
              disabled={muxBusy || !!muxJob.backupName}
              onClick={async () => {
                setMuxBusy(true);
                try {
                  await api("mux/jobs?id=" + muxJob.id, "DELETE");
                  setMuxJob(undefined);
                } catch {
                } finally {
                  setMuxBusy(false);
                }
              }}
            >
              {t("Remove mux marking")}
            </button>
          )}
        </div>
      )}
      <section class="file-dialog-section file-identity">
        <div class="file-identity-row">
          <span class="file-identity-label">
            {t(isEpisode ? "Episode" : "Title")}
          </span>
          <div class="file-identity-title">
            {file.series && file.series + " · "}
            {file.title}
          </div>
        </div>
        <div class="file-identity-row">
          <label
            class="file-identity-label"
            for={editing ? "rename-filename" : undefined}
          >
            {t("Filename")}
          </label>
          <div class="filename-box compact">
            <FileVideo2 size={ICON.close} />
            {editing ? (
              <>
                <div class="input-suffix">
                  <input
                    id="rename-filename"
                    ref={input}
                    aria-label={t("Filename")}
                    value={name}
                    disabled={renaming}
                    aria-invalid={!!validation.error}
                    onInput={(e) => setName(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void startRename();
                      }
                      if (e.key === "Escape" && !renaming) {
                        e.preventDefault();
                        e.stopPropagation();
                        cancelEdit();
                      }
                    }}
                  />
                  <span>{extension}</span>
                </div>
                <button
                  class="icon-button"
                  aria-label={t("Rename file")}
                  title={t("Rename file")}
                  disabled={
                    !validation.canSave || renaming || !!blocked || !jobsLoaded
                  }
                  onClick={startRename}
                >
                  {renaming ? (
                    <LoaderCircle size={ICON.button} class="spin" />
                  ) : (
                    <Check size={ICON.button} />
                  )}
                </button>
                <button
                  class="icon-button"
                  aria-label={t("Cancel renaming")}
                  disabled={renaming}
                  onClick={cancelEdit}
                  title={t("Cancel renaming")}
                >
                  <X size={ICON.button} />
                </button>
              </>
            ) : (
              <>
                <code>{file.filename}</code>
                <button
                  class="icon-button filename-edit"
                  aria-label={t("Rename file")}
                  title={t(blocked || "Rename file")}
                  disabled={!!blocked || !jobsLoaded || muxBusy}
                  onClick={() => {
                    setName(stem);
                    setEditing(true);
                  }}
                >
                  <Pencil size={ICON.button} />
                </button>
              </>
            )}
          </div>
        </div>
        {editing && validation.error && (
          <p class="error" role="alert">
            {t(validation.error)}
          </p>
        )}
        {renaming && <p role="status">{t("Renaming and rescanning …")}</p>}
      </section>
      {preview && (
        <RenameCompanionsDialog
          preview={preview}
          close={() => setPreview(undefined)}
          save={(companions) => void saveRename(companions, preview)}
        />
      )}
      {file.metadataIncomplete && (
        <p class="notice">
          <Info size={ICON.label} />
          {t(
            "Incomplete metadata. Undetected attributes do not prove their absence.",
          )}
        </p>
      )}
      <section
        class="file-dialog-section audio-information"
        aria-label={t("Audio track information")}
      >
        <h4>
          {t("Audio tracks")}
          {!!file.audioTracks?.length && (
            <HelpPopover
              label={t("Audio tracks")}
              text="Matched using existing media server metadata. The file was uniquely identified by filename and size."
            />
          )}
        </h4>
        {file.audioTracks?.length ? (
          <>
            <ul class="audio-track-list">
              {file.audioTracks.map((track) => (
                <li key={track.index}>
                  <span>#{track.index}</span>
                  <LanguageFlag value={track.language} />
                  <Tag value={track.codec} kind="audio" />
                  <span>
                    {track.channelLayout ||
                      (track.channels
                        ? t("{count} channels", { count: track.channels })
                        : t("Unknown channels"))}
                  </span>
                  {track.default && <span>{t("Default")}</span>}
                  {track.title && (
                    <span class="audio-track-title">({track.title})</span>
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p>
              {t("Detected languages:")} <LanguageFlags value={file.language} />{" "}
              {t(" · Detected codecs:")} <b>{file.audio || t("Unknown")}</b>
              {file.audioStreamCount > 0 && (
                <>
                  {t(" · {count} audio tracks reported by API", {
                    count: file.audioStreamCount,
                  })}
                </>
              )}
            </p>
            <p class="quiet">
              {file.embyMatch && embyMatchLabels[file.embyMatch] && (
                <>
                  <b>{embyMatchLabels[file.embyMatch]}.</b>{" "}
                </>
              )}
              {t(
                "Language → codec mapping unavailable. Radarr and Sonarr do not provide per-track attributes. Connect a media server in settings to enrich them. Additional codecs may be missing from the metadata.",
              )}
            </p>
          </>
        )}
        {file.mediaServers &&
          providers.some((provider) => file.mediaServers?.[provider.id]) && (
            <div class="file-dialog-subsection media-server-details">
              <h4>{t("Media server matching")}</h4>
              {providers
                .filter((provider) => file.mediaServers?.[provider.id])
                .map((provider) => (
                  <p>
                    <b>{provider.name}</b> ·{" "}
                    {embyMatchLabels[file.mediaServers![provider.id].status] ||
                      file.mediaServers![provider.id].status}
                    {file.mediaServers![provider.id].video && (
                      <span class="media-video-summary">
                        {" · "}
                        {t("Video")}
                        {": "}
                        {[
                          file.mediaServers![provider.id].video!.width &&
                          file.mediaServers![provider.id].video!.height
                            ? file.mediaServers![provider.id].video!.width +
                              " × " +
                              file.mediaServers![provider.id].video!.height
                            : file.mediaServers![provider.id].video!.resolution,
                          file.mediaServers![provider.id].video!.codec,
                          file.mediaServers![provider.id].video!.bitDepth
                            ? t("{value} bit", {
                                value:
                                  file.mediaServers![provider.id].video!
                                    .bitDepth!,
                              })
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" · ") || t("Unknown")}
                      </span>
                    )}
                  </p>
                ))}
            </div>
          )}
      </section>
      {(file.seasonOutlier || file.languageOutlier) && (
        <section class="file-dialog-section season-outlier-details">
          <h4>{t("Season outliers")}</h4>
          {Object.entries(file.seasonReasons || {}).map(([key, value]) => (
            <p>
              {key === "codec" ? t("Codec family") : labels[key] || key}:{" "}
              {t("Season majority")} ·{" "}
              {key === "language" ? <LanguageFlags value={value} /> : value}
            </p>
          ))}
        </section>
      )}
      {!!file.recognitionConflicts?.length && (
        <section
          class="file-dialog-section recognition-conflict-details"
          aria-label={t("Conflicting recognition rules")}
        >
          <h4 style={{ color: warningColors.recognition }}>
            <OctagonAlert size={ICON.button} />{" "}
            {t("Conflicting recognition rules")}
          </h4>
          <ul>
            {file.recognitionConflicts.map((c) => (
              <li>
                <b>
                  {labels[c.field] || c.field}: {c.values.join(" / ")}
                </b>
                <p class="quiet">{c.ruleNames.join(" · ")}</p>
              </li>
            ))}
          </ul>
          <p class="quiet">
            {t(
              "The first matching rule wins by priority, then rule ID. Edit rules to resolve the conflict.",
            )}
          </p>
        </section>
      )}
      <div class="table-wrap">
        <table class="detail-table stack-mobile">
          <thead>
            <tr>
              <th scope="col">{t("Attribute")}</th>
              <th scope="col">{t("Filename")}</th>
              <th scope="col">Radarr / Sonarr</th>
              <th scope="col">{t("Media server")}</th>
              <th scope="col">{t("Used")}</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(file.evidence).map(([k, e]) => (
              <tr class={e.conflict ? "evidence-conflict" : ""}>
                <th scope="row">{labels[k] || k}</th>
                <td data-label={t("Filename")}>{e.filename || "—"}</td>
                <td data-label="Radarr / Sonarr">{e.api || "—"}</td>
                <td data-label={t("Media server")}>{e.emby || "—"}</td>
                <td data-label={t("Used")}>
                  <span class="detail-value">
                    {e.conflict && (
                      <span class="detail-conflict-marker" aria-hidden="true">
                        •
                      </span>
                    )}
                    {e.origin === "rule"
                      ? t("Recognition rule")
                      : e.origin === "filename"
                        ? t("Filename")
                        : e.origin === "api"
                          ? "API"
                          : e.origin === "emby"
                            ? t("Media server")
                            : e.origin === "mediaServer"
                              ? t("Media server")
                              : e.origin === "combined"
                                ? t("Enriched")
                                : t("Unknown")}
                    {e.conflict && (
                      <TriangleAlert
                        size={ICON.label}
                        style={{ color: warningColors.metadata }}
                      />
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
