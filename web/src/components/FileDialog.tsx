import { hasActiveFieldConfirmation } from "../confirmation-summary";
import { MediaInfoPanel } from "./MediaInfoPanel";
import {
  readSessionPreference,
  writeSessionPreference,
} from "../browser-storage";
import { useMediaInfoRead } from "../useMediaInfoRead";
import { mediaInfoVisible, mediaInfoReadAvailable } from "../mediainfo";
import { Tabs } from "./dialog/Tabs";
import { EvidenceSourceMenu, evidenceSourceLabel } from "./EvidenceSourceMenu";
import { audioChannelLayout } from "../audio-channels";
import { ICON } from "../ui";
import { useEffect, useRef, useState } from "preact/hooks";
import { ApiError, api } from "../api";
import { markedForMuxing } from "../mux-selection";
import { notify } from "../notifications";
import type { MuxJob, Status } from "../types";
import { t, useI18n } from "../i18n";
import { audioLanguageListLabel } from "../languages";
import { LanguageFlag, LanguageFlags } from "./LanguageFlag";
import { Modal, ModalFoot } from "./dialog/Modal";
import { HelpTip } from "./list/HelpTip";
import { MediaTag } from "./list/MediaTag";
import { RowButton } from "./list/RowButton";
import { RenameCompanionsDialog } from "./RenameCompanionsDialog";
import {
  splitFilename,
  renameState,
  renameResultTone,
  type RenameResult,
  type RenamePreview,
} from "../file-rename";

import {
  TriangleAlert,
  OctagonAlert,
  ScanSearch,
  Scissors,
  Info,
  Pencil,
  Check,
  X,
  LoaderCircle,
  ChevronUp,
  ChevronDown,
} from "lucide-preact";
import type { MediaFile } from "../types";

import { embyMatchLabels, labels } from "../ui";

// Where the file dialog stands in the filtered list and how it pages
// (Phase 5d, E16): the library hands it over (Task 7); without it the
// count is not shown and both paging buttons are locked.
export type FilePager = {
  index: number;
  total: number;
  prev?(): void;
  next?(): void;
  busy: boolean;
};

// File & metadata (docs/STYLEGUIDE.md, Part 1, 10.9; Phase 5d, E12–E15):
// the v2 modal "file" (1040 × 800, fixed height) with the mini-label title.
// Its head holds the title line, the filename line with the pencil (which
// turns the same line into the rename field) and, on the right, the paging
// buttons; then the File details tabs (the row always reserved) and the
// scrolling body; the foot has the count and the actions in fixed slots.
// After a rename that the library has read again, the dialog stays on the
// renamed file (user decision F1): `renamed(filename)` asks the library to
// find it; otherwise it closes as in 1.7.0.
export function FileDialog({
  file: initialFile,
  warningColors,
  close,
  providers,
  muxAvailable,
  openMux,
  renameAvailable,
  renamed,
  metadataUpdated,
  pager,
}: {
  muxAvailable?: boolean;
  renameAvailable?: boolean;
  renamed?: (filename?: string) => void;
  metadataUpdated?: (file: MediaFile) => void;
  openMux?: () => void;
  providers: { id: string; name: string }[];
  file: MediaFile;
  warningColors: Record<string, string>;
  close: () => void;
  pager?: FilePager;
}) {
  const { locale } = useI18n();
  // Stored languages stay canonical; show them in the interface language.
  const shown = (field: string, value?: string) =>
    field === "language" && value
      ? audioLanguageListLabel(value, locale, t)
      : value || "";
  const [file, setFile] = useState(initialFile);
  const [tab, setTab] = useState(
    () => readSessionPreference("scopearr-file-dialog-tab") || "overview",
  );
  const [mediaStatus, setMediaStatus] = useState<Status>();
  useEffect(() => {
    let active = true;
    api<Status>("status")
      .then((value) => {
        if (active) setMediaStatus(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const showMediaInfo = mediaInfoVisible(
    !!mediaStatus?.mediaInfo?.enabled,
    file.mediaInfo,
  );
  const canReadMediaInfo = mediaInfoReadAvailable(mediaStatus?.mediaInfo);
  const [readVersion, setReadVersion] = useState(0);
  const mediaInfoRead = useMediaInfoRead(file, (next) => {
    writeSessionPreference("scopearr-mediainfo-section", "result");
    setReadVersion((value) => value + 1);
    setFile(next);
    metadataUpdated?.(next);
    setTab("mediainfo");
    writeSessionPreference("scopearr-file-dialog-tab", "mediainfo");
  });
  const [confirmationBusy, setConfirmationBusy] = useState(false);
  useEffect(() => setFile(initialFile), [initialFile]);
  const [muxJob, setMuxJob] = useState<MuxJob>();
  const [muxBusy, setMuxBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [preview, setPreview] = useState<RenamePreview>();
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pencil = useRef<HTMLButtonElement>(null);
  // The field was open: once it closes, focus goes back to the pencil.
  const wasEditing = useRef(false);
  const [stem, extension] = splitFilename(file.filename);
  const validation = renameState(file.filename, name);
  const blocked = !renameAvailable
    ? "Renaming requires the media mount and path mapping under Settings → Services → MKVToolNix"
    : muxJob
      ? "Remove the mux job for this file first"
      : "";
  useEffect(() => {
    if (editing) {
      wasEditing.current = true;
      input.current?.focus();
      input.current?.select();
    } else if (wasEditing.current) {
      wasEditing.current = false;
      pencil.current?.focus();
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
    setPreview(p);
  }
  async function saveRename(companions: boolean, p: RenamePreview) {
    setPreview(undefined);
    setRenaming(true);
    try {
      const result = await api<RenameResult>("files/rename", "POST", {
        ...request,
        companions,
        companionNames: p.companions.map((c) => c.from),
      });
      notify(
        result.warning
          ? t(result.warning)
          : t("File renamed. Radarr/Sonarr and media servers were updated."),
        renameResultTone(result),
      );
      if (result.refresh === "completed" && renamed) {
        // The library reads the file again and shows it under its new name.
        setFile((current) => ({ ...current, filename: p.filename }));
        setEditing(false);
        renamed(p.filename);
      } else {
        close();
        renamed?.();
      }
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

  const identity = (file.series ? file.series + " · " : "") + file.title;
  const message =
    editing && validation.error ? (
      <p class="v2-modal-error" role="alert">
        {t(validation.error)}
      </p>
    ) : renaming ? (
      <p class="v2-modal-hint" role="status">
        {t("Renaming and rescanning …")}
      </p>
    ) : null;
  // A button whose text changes holds all its texts in one place, the
  // hidden ones v2-btn-alt, so it keeps the width of its longest.
  const labelsOf = (texts: string[], current: string) => [
    <span key={current}>{t(current)}</span>,
    ...texts
      .filter((text) => text !== current)
      .map((text) => (
        <span key={text} class="v2-btn-alt" aria-hidden="true">
          {t(text)}
        </span>
      )),
  ];
  const muxLabel = muxBusy
    ? "Identifying…"
    : muxJob
      ? "Open Muxing tab"
      : "Mark for muxing";

  return (
    <Modal
      id="file"
      eyebrow
      title={t("File & metadata")}
      close={close}
      cancel={editing ? cancelEdit : close}
      closeDisabled={renaming || !!preview}
      head={
        <div class="v2-file">
          <p class="v2-file-name" title={identity}>
            <span class="v2-sr-only">
              {t(isEpisode ? "Episode" : "Title")}{" "}
            </span>
            {identity}
          </p>
          <div class="v2-file-path">
            {editing ? (
              <>
                <div class="v2-input-group v2-file-rename">
                  <input
                    id="rename-filename"
                    ref={input}
                    class="v2-input"
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
                  <span class="v2-file-ext">{extension}</span>
                </div>
                <RowButton
                  size="sm"
                  label={t("Rename file")}
                  icon={
                    renaming ? (
                      <LoaderCircle size={ICON.button} class="spin" />
                    ) : (
                      <Check size={ICON.button} />
                    )
                  }
                  disabled={
                    !validation.canSave || renaming || !!blocked || !jobsLoaded
                  }
                  onClick={startRename}
                />
                <RowButton
                  size="sm"
                  label={t("Cancel renaming")}
                  icon={<X size={ICON.button} />}
                  disabled={renaming}
                  onClick={cancelEdit}
                />
              </>
            ) : (
              <>
                <code title={file.filename}>
                  {stem}
                  <span class="v2-file-ext">{extension}</span>
                </code>
                <RowButton
                  size="sm"
                  label={t("Rename file")}
                  title={t(blocked || "Rename file")}
                  icon={<Pencil size={ICON.button} />}
                  buttonRef={pencil}
                  disabled={!!blocked || !jobsLoaded || muxBusy}
                  onClick={() => {
                    setName(stem);
                    setEditing(true);
                  }}
                />
              </>
            )}
          </div>
          {message}
        </div>
      }
      tools={
        <div class="v2-file-pager">
          <RowButton
            label={t("Previous file")}
            icon={<ChevronUp size={ICON.button} />}
            disabled={!pager?.prev || pager.busy}
            onClick={() => pager?.prev?.()}
          />
          <RowButton
            label={t("Next file")}
            icon={<ChevronDown size={ICON.button} />}
            disabled={!pager?.next || pager.busy}
            onClick={() => pager?.next?.()}
          />
        </div>
      }
      bar={
        <Tabs
          id="file-detail"
          label={t("File details")}
          value={tab === "mediainfo" ? "mediainfo" : "overview"}
          change={(value) => {
            setTab(value);
            writeSessionPreference("scopearr-file-dialog-tab", value);
          }}
          items={
            showMediaInfo
              ? [
                  { value: "overview", label: t("Overview") },
                  { value: "mediainfo", label: "MediaInfo" },
                ]
              : []
          }
          reserve
        />
      }
      foot={
        <ModalFoot
          lead={
            pager ? (
              <span aria-live="polite">
                {t("{index} of {total}", {
                  index: pager.index,
                  total: pager.total,
                })}
              </span>
            ) : null
          }
        >
          <div class="v2-file-actions">
            {muxAvailable &&
              muxJob &&
              !["running", "queued"].includes(muxJob.status) && (
                <button
                  type="button"
                  class="v2-btn"
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
            {canReadMediaInfo && (
              <button
                type="button"
                class="v2-btn"
                disabled={mediaInfoRead.busy || !!mediaStatus?.demo}
                title={
                  mediaStatus?.demo
                    ? t("MediaInfo reads are disabled in demo mode")
                    : undefined
                }
                onClick={() => void mediaInfoRead.read()}
              >
                {mediaInfoRead.busy ? (
                  <LoaderCircle class="spin" size={ICON.button} />
                ) : (
                  <ScanSearch size={ICON.button} />
                )}
                {labelsOf(
                  ["Read with MediaInfo", "Read again"],
                  file.mediaInfo ? "Read again" : "Read with MediaInfo",
                )}
              </button>
            )}
            {muxAvailable && (
              <button
                type="button"
                class="v2-btn"
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
                    notify(...markedForMuxing(1, true, t));
                  } catch {
                  } finally {
                    setMuxBusy(false);
                  }
                }}
              >
                <Scissors size={ICON.button} />
                {labelsOf(
                  ["Mark for muxing", "Open Muxing tab", "Identifying…"],
                  muxLabel,
                )}
              </button>
            )}
          </div>
          <button
            type="button"
            class="v2-btn v2-btn--primary"
            disabled={renaming || !!preview}
            onClick={close}
          >
            {t("Close")}
          </button>
        </ModalFoot>
      }
    >
      {preview && (
        <RenameCompanionsDialog
          preview={preview}
          service={file.service}
          close={() => setPreview(undefined)}
          save={(companions) => void saveRename(companions, preview)}
        />
      )}
      {showMediaInfo && tab === "mediainfo" ? (
        <MediaInfoPanel
          key={readVersion}
          file={file}
          error={mediaInfoRead.error}
        />
      ) : (
        <div
          class="v2-modal-panel"
          role={showMediaInfo ? "tabpanel" : undefined}
          id="file-detail-panel-overview"
          aria-labelledby={
            showMediaInfo ? "file-detail-tab-overview" : undefined
          }
        >
          {file.metadataIncomplete && (
            <p class="v2-notice">
              <Info size={ICON.label} />{" "}
              {t(
                "Incomplete metadata. Undetected attributes do not prove their absence.",
              )}
            </p>
          )}
          <section
            class="v2-modal-sec"
            aria-label={t("Audio track information")}
          >
            <h3 class="v2-modal-h">
              {t("Audio tracks")}
              {file.mediaOrigin === "mediainfo" && file.mediaInfo && (
                <span class="v2-modal-hint">
                  MediaInfo ·{" "}
                  {new Date(file.mediaInfo.scannedAt).toLocaleString()}
                </span>
              )}
              {!!file.audioTracks?.length &&
                file.mediaOrigin !== "mediainfo" && (
                  <HelpTip
                    label="Audio tracks"
                    text="Matched using existing media server metadata. The file was uniquely identified by filename and size."
                  />
                )}
            </h3>
            {file.audioTracks?.length ? (
              <ul class="v2-modal-list">
                {file.audioTracks.map((track) => (
                  <li key={track.index}>
                    <span>#{track.index}</span>
                    <LanguageFlag value={track.language} />
                    <MediaTag value={track.codec} kind="audio" />
                    <span title={track.channelLayout || undefined}>
                      {audioChannelLayout(track) || t("Unknown channels")}
                    </span>
                    {track.default && <span>{t("Default")}</span>}
                    {track.title && (
                      <span class="v2-modal-hint">({track.title})</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <>
                <p class="v2-modal-text">
                  {t("Detected languages:")}{" "}
                  <LanguageFlags value={file.language} />{" "}
                  {t(" · Detected codecs:")} <b>{file.audio || t("Unknown")}</b>
                  {file.audioStreamCount > 0 && (
                    <>
                      {t(" · {count} audio tracks reported by API", {
                        count: file.audioStreamCount,
                      })}
                    </>
                  )}
                </p>
                <p class="v2-modal-hint">
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
          </section>
          {file.mediaServers &&
            providers.some((provider) => file.mediaServers?.[provider.id]) && (
              <section class="v2-modal-sec">
                <h3 class="v2-modal-h">{t("Media server matching")}</h3>
                {providers
                  .filter((provider) => file.mediaServers?.[provider.id])
                  .map((provider) => {
                    const server = file.mediaServers![provider.id];
                    const video = server.video;
                    return (
                      <p class="v2-modal-text" key={provider.id}>
                        <b>{provider.name}</b> ·{" "}
                        {embyMatchLabels[server.status] || server.status}
                        {video && (
                          <span>
                            {" · "}
                            {t("Video")}
                            {": "}
                            {[
                              video.width && video.height
                                ? video.width + " × " + video.height
                                : video.resolution,
                              video.codec,
                              video.bitDepth
                                ? t("{value} bit", { value: video.bitDepth })
                                : "",
                            ]
                              .filter(Boolean)
                              .join(" · ") || t("Unknown")}
                          </span>
                        )}
                      </p>
                    );
                  })}
              </section>
            )}
          {(file.seasonOutlier || file.languageOutlier) && (
            <section class="v2-modal-sec">
              <h3 class="v2-modal-h">{t("Season outliers")}</h3>
              {Object.entries(file.seasonReasons || {}).map(([key, value]) => (
                <p class="v2-modal-text" key={key}>
                  {key === "codec" ? t("Codec family") : labels[key] || key}:{" "}
                  {t("Season majority")} ·{" "}
                  {key === "language" ? <LanguageFlags value={value} /> : value}
                </p>
              ))}
            </section>
          )}
          {!!file.recognitionConflicts?.length && (
            <section
              class="v2-modal-sec"
              aria-label={t("Conflicting recognition rules")}
            >
              <h3 class="v2-modal-h">
                <OctagonAlert
                  size={ICON.button}
                  style={{ color: warningColors.recognition }}
                  aria-hidden="true"
                />
                {t("Conflicting recognition rules")}
              </h3>
              <ul class="v2-modal-list">
                {file.recognitionConflicts.map((c) => (
                  <li key={c.field}>
                    <b>
                      {labels[c.field] || c.field}:{" "}
                      {c.values.map((v) => shown(c.field, v)).join(" / ")}
                    </b>
                    <span class="v2-modal-hint">{c.ruleNames.join(" · ")}</span>
                  </li>
                ))}
              </ul>
              <p class="v2-modal-hint">
                {t(
                  "The first matching rule wins by priority, then rule ID. Edit rules to resolve the conflict.",
                )}
              </p>
            </section>
          )}
          <div class="v2-table-scroll" data-overflow="">
            <table class="v2-table">
              <thead>
                <tr>
                  <th scope="col">{t("Attribute")}</th>
                  <th scope="col">{t("Filename")}</th>
                  <th scope="col">Radarr / Sonarr</th>
                  <th scope="col">{t("Media server")}</th>
                  {file.mediaInfo && <th scope="col">MediaInfo</th>}
                  <th scope="col">{t("Used")}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(file.evidence).map(([k, e]) => (
                  <tr
                    key={k}
                    class={e.conflict ? "v2-row v2-row--warn" : "v2-row"}
                  >
                    <th scope="row">{labels[k] || k}</th>
                    <td data-label={t("Filename")}>
                      {shown(k, e.filename) || "—"}
                    </td>
                    <td data-label="Radarr / Sonarr">
                      <span class="v2-table-items">
                        {shown(k, e.api) || "—"}
                        {e.apiDiffers && !e.conflict && (
                          <span
                            role="img"
                            title={t(
                              e.emby
                                ? "The file and media server agree. Radarr/Sonarr report a different value; shown for information only."
                                : "Radarr/Sonarr report a different value; shown for information only.",
                            )}
                            aria-label={t(
                              e.emby
                                ? "The file and media server agree. Radarr/Sonarr report a different value; shown for information only."
                                : "Radarr/Sonarr report a different value; shown for information only.",
                            )}
                          >
                            <Info size={ICON.label} />
                          </span>
                        )}
                        {k === "source" &&
                          !hasActiveFieldConfirmation(file, k) &&
                          !e.conflict &&
                          !e.apiDiffers &&
                          e.filename &&
                          e.api &&
                          e.filename !== e.api && (
                            <span
                              class="v2-modal-hint"
                              title={t(
                                "Radarr/Sonarr report a broader category; the filename is more specific.",
                              )}
                            >
                              {t("Category")}
                            </span>
                          )}
                      </span>
                    </td>
                    <td data-label={t("Media server")}>
                      <span class="v2-table-items">
                        {shown(k, e.emby) || "—"}
                        {e.mediaServerDiffers && (
                          <span
                            role="img"
                            title={t(
                              "MediaInfo reports a different value; shown for information only.",
                            )}
                            aria-label={t(
                              "MediaInfo reports a different value; shown for information only.",
                            )}
                          >
                            <Info size={ICON.label} />
                          </span>
                        )}
                      </span>
                    </td>
                    {file.mediaInfo && (
                      <td data-label="MediaInfo">
                        {shown(k, e.mediainfo) || "—"}
                      </td>
                    )}
                    <td data-label={t("Used")}>
                      <span class="v2-table-items">
                        <EvidenceSourceMenu
                          evidence={e}
                          field={labels[k] || k}
                          formatValue={(value) => shown(k, value)}
                          ruleConflict={
                            !!file.recognitionConflicts?.some(
                              (c) => c.field === k,
                            )
                          }
                          busy={confirmationBusy}
                          choose={async (source) => {
                            setConfirmationBusy(true);
                            try {
                              const updated = source
                                ? await api<MediaFile>(
                                    "files/confirmation",
                                    "PUT",
                                    {
                                      service: file.service,
                                      fileId: file.id,
                                      field: k,
                                      source,
                                    },
                                  )
                                : await api<MediaFile>(
                                    "files/confirmation?" +
                                      new URLSearchParams({
                                        service: file.service,
                                        fileId: String(file.id),
                                        field: k,
                                      }),
                                    "DELETE",
                                  );
                              setFile(updated);
                              metadataUpdated?.(updated);
                              notify(
                                source
                                  ? t("Confirmed: {field} uses {source}.", {
                                      field: labels[k] || k,
                                      source: evidenceSourceLabel(source),
                                    })
                                  : t("Confirmation removed."),
                                "success",
                              );
                            } finally {
                              setConfirmationBusy(false);
                            }
                          }}
                        />
                        {e.conflict && (
                          <TriangleAlert
                            size={ICON.label}
                            style={{ color: warningColors.metadata }}
                            aria-hidden="true"
                          />
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
