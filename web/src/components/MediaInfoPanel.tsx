import { LoaderCircle, ScanSearch } from "lucide-preact";
import { useState } from "preact/hooks";
import { api } from "../api";
import type { MediaFile } from "../types";
import { t, useI18n } from "../i18n";
import { ICON, labels } from "../ui";
import { mediaInfoValues } from "../mediainfo";
export function MediaInfoPanel({
  file,
  installed,
  enabled,
  demo,
  updated,
}: {
  file: MediaFile;
  installed: boolean;
  enabled: boolean;
  demo: boolean;
  updated: (file: MediaFile) => void;
}) {
  const { locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const result = file.mediaInfo;
  const values = result ? mediaInfoValues(result) : {};
  async function read() {
    setBusy(true);
    setError("");
    try {
      const next = await api<MediaFile>(
        "files/mediainfo",
        "POST",
        { service: file.service, fileId: file.id },
        undefined,
        { notifyErrors: false },
      );
      updated(next);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  const blocked = demo
    ? t("MediaInfo reads are disabled in demo mode")
    : !enabled
      ? t("Enable and save MediaInfo first")
      : !installed
        ? t("Install MediaInfo under Settings → Services → MediaInfo.")
        : "";
  return (
    <section
      class="file-dialog-section mediainfo-panel"
      role="tabpanel"
      id="file-detail-panel-mediainfo"
      aria-labelledby="file-detail-tab-mediainfo"
    >
      <div class="card-heading">
        <p class="quiet">
          {result
            ? t("Last read: {date} · MediaInfo {version}", {
                date: new Date(result.scannedAt).toLocaleString(locale),
                version: result.version,
              })
            : t("Not read yet")}
        </p>
        <button
          type="button"
          class="button"
          title={blocked || undefined}
          disabled={busy || !!blocked}
          onClick={() => void read()}
        >
          {busy ? (
            <LoaderCircle class="spin" size={ICON.label} />
          ) : (
            <ScanSearch size={ICON.label} />
          )}{" "}
          {t(result ? "Read again" : "Read file")}
        </button>
      </div>
      {error && (
        <p class="notice error" role="alert">
          {error}
        </p>
      )}
      {result?.ambiguous && (
        <p class="notice">
          {t(
            "Several video tracks have no unique default. No values were applied.",
          )}
        </p>
      )}
      {result && (
        <>
          <h4>{t("Result")}</h4>
          <div class="table-wrap">
            <table class="detail-table stack-mobile">
              <thead>
                <tr>
                  <th scope="col">{t("Attribute")}</th>
                  <th scope="col">{t("Scopearr value")}</th>
                  <th scope="col">MediaInfo</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(values).map(([field, value]) => (
                  <tr
                    class={
                      file.evidence[field]?.conflict ? "evidence-conflict" : ""
                    }
                  >
                    <th scope="row">{labels[field] || field}</th>
                    <td data-label={t("Scopearr value")}>
                      {(file[field as keyof MediaFile] as string) || "—"}
                    </td>
                    <td data-label="MediaInfo">{value || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {["General", "Video", "Audio", "Text"].map((type) => {
            const tracks = (result.tracks || []).filter(
              (track) => track.type === type,
            );
            return (
              !!tracks.length && (
                <details>
                  <summary>
                    {type === "Audio"
                      ? t("Audio ({count})", { count: tracks.length })
                      : type === "Text"
                        ? t("Subtitles ({count})", { count: tracks.length })
                        : t(type)}
                  </summary>
                  {tracks.map((track, index) => (
                    <div>
                      <h4>
                        {t(type === "Text" ? "Subtitles" : type)}{" "}
                        {tracks.length > 1 ? index + 1 : ""}
                      </h4>
                      <dl class="key-values">
                        {Object.entries(track.fields).map(([key, value]) => (
                          <div>
                            <dt>{t(key)}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  ))}
                </details>
              )
            );
          })}
        </>
      )}
    </section>
  );
}
