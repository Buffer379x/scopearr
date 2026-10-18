import { t, useI18n } from "../i18n";
import { LanguageFlag, LanguageFlags } from "./LanguageFlag";
import { Modal } from "./Modal";

import { AlertTriangle, OctagonAlert, FileVideo2, Info } from "lucide-preact";
import type { MediaFile } from "../types";

import { embyMatchLabels, labels, Tag } from "../ui";
export function FileDialog({
  file,
  warningColors,
  close,
  providers,
}: {
  providers: { id: string; name: string }[];
  file: MediaFile;
  warningColors: Record<string, string>;
  close: () => void;
}) {
  useI18n();
  return (
    <Modal title={t("File & metadata")} close={close} wide>
      <h3>
        {file.series && file.series + " · "}
        {file.title}
      </h3>
      <div class="filename-box">
        <FileVideo2 size={20} />
        <code>{file.filename}</code>
      </div>
      <p class="quiet">
        {t(
          "Filename first, then Radarr/Sonarr. Uniquely matched media servers fill missing video metadata and provide per-track audio and languages. Conflicts are marked.",
        )}
      </p>
      {file.metadataIncomplete && (
        <p class="notice">
          <Info size={15} />
          {t(
            "Incomplete metadata. Undetected attributes do not prove their absence.",
          )}
        </p>
      )}
      {file.mediaServers &&
        providers.some((provider) => file.mediaServers?.[provider.id]) && (
          <section class="media-server-details">
            <h4>{t("Media server matching")}</h4>
            {providers
              .filter((provider) => file.mediaServers?.[provider.id])
              .map((provider) => (
                <p>
                  <b>{provider.name}</b> ·{" "}
                  {embyMatchLabels[file.mediaServers![provider.id].status] ||
                    file.mediaServers![provider.id].status}
                  {file.mediaServers![provider.id].video && (
                    <span class="quiet media-video-summary">
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
          </section>
        )}
      {(file.seasonOutlier || file.languageOutlier) && (
        <section class="season-outlier-details">
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
      <section
        class="audio-information"
        aria-label={t("Audio track information")}
      >
        <h4>{t("Audio tracks")}</h4>
        {file.audioTracks?.length ? (
          <>
            <p class="quiet">
              {t(
                "Matched using existing media server metadata. The file was uniquely identified by filename and size.",
              )}
            </p>
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
                  <span>{track.default ? t("Default") : ""}</span>
                  {track.title && <small>{track.title}</small>}
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
        <p class="quiet">
          {t(
            "Channels use the filename or Radarr/Sonarr first, then all known media-server audio layouts. Counts without a reported layout remain channel counts.",
          )}
        </p>
      </section>
      {!!file.recognitionConflicts?.length && (
        <section
          class="recognition-conflict-details"
          aria-label={t("Conflicting recognition rules")}
        >
          <h4 style={{ color: warningColors.recognition }}>
            <OctagonAlert size={16} /> {t("Conflicting recognition rules")}
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
      <div class="evidence-table">
        <div class="evidence-head">
          <span>{t("Attribute")}</span>
          <span>{t("Filename")}</span>
          <span>Radarr / Sonarr</span>
          <span>{t("Media server")}</span>
          <span>{t("Used")}</span>
        </div>
        {Object.entries(file.evidence).map(([k, e]) => (
          <div class={e.conflict ? "evidence-conflict" : ""}>
            <b>{labels[k] || k}</b>
            <span data-label={t("Filename")}>{e.filename || "—"}</span>
            <span data-label="Radarr / Sonarr">{e.api || "—"}</span>
            <span data-label={t("Media server")}>{e.emby || "—"}</span>
            <span data-label={t("Used")}>
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
                <AlertTriangle
                  size={14}
                  style={{ color: warningColors.metadata }}
                />
              )}
            </span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
