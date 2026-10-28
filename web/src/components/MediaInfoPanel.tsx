import { useEffect, useState } from "preact/hooks";
import type { MediaFile } from "../types";
import { t, useI18n } from "../i18n";
import {
  readSessionPreference,
  writeSessionPreference,
} from "../browser-storage";
import { audioLanguageLabel } from "../languages";
import { labels } from "../ui";
import { DialogTabs } from "./DialogTabs";
import {
  mediaInfoValues,
  mediaInfoSection,
  mediaInfoTrackRows,
} from "../mediainfo";
export function MediaInfoPanel({
  file,
  error = "",
}: {
  file: MediaFile;
  error?: string;
}) {
  const { locale } = useI18n();
  const result = file.mediaInfo;
  const values = result ? mediaInfoValues(result) : {};
  const [savedSection, setSavedSection] = useState(
    () => readSessionPreference("scopearr-mediainfo-section") || "result",
  );
  const section = mediaInfoSection(savedSection, result);
  const tracks = (result?.tracks || []).filter(
    (track) => track.type === section,
  );
  const trackRows = mediaInfoTrackRows(tracks);
  useEffect(() => {
    if (section !== savedSection) {
      setSavedSection(section);
      writeSessionPreference("scopearr-mediainfo-section", section);
    }
  }, [section, savedSection]);
  return (
    <section
      class="dialog-tabs-panel mediainfo-panel"
      role="tabpanel"
      id="file-detail-panel-mediainfo"
      aria-labelledby="file-detail-tab-mediainfo"
    >
      {!result && (
        <p class="quiet">{t("Not read yet. Use Read with MediaInfo above.")}</p>
      )}
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
        <DialogTabs
          id="mediainfo-section"
          label={t("MediaInfo sections")}
          value={section}
          change={(value) => {
            setSavedSection(value);
            writeSessionPreference("scopearr-mediainfo-section", value);
          }}
          items={[
            { value: "result", label: t("Result") },
            ...["General", "Video", "Audio", "Text"].flatMap((type) => {
              const count =
                result.tracks?.filter((track) => track.type === type).length ||
                0;
              return count && mediaInfoSection(type, result) === type
                ? [
                    {
                      value: type,
                      label:
                        type === "Audio"
                          ? t("Audio ({count})", { count })
                          : type === "Text"
                            ? t("Subtitles ({count})", { count })
                            : t(type),
                    },
                  ]
                : [];
            }),
          ]}
          accessory={
            <span class="quiet">
              {t("Last read: {date} · MediaInfo {version}", {
                date: new Date(result.scannedAt).toLocaleString(locale),
                version: result.version,
              })}
            </span>
          }
        >
          <div
            class="dialog-tabs-panel"
            role="tabpanel"
            id={"mediainfo-section-panel-" + section}
            aria-labelledby={"mediainfo-section-tab-" + section}
          >
            {section === "result" ? (
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
                          file.evidence[field]?.conflict
                            ? "evidence-conflict"
                            : ""
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
            ) : (
              <div class="table-wrap">
                <table
                  class={
                    "detail-table" +
                    (tracks.length === 1
                      ? " stack-mobile"
                      : " mediainfo-track-table")
                  }
                >
                  <thead>
                    <tr>
                      <th scope="col">{t("Attribute")}</th>
                      {tracks.length === 1 ? (
                        <th scope="col">{t("Value")}</th>
                      ) : (
                        tracks.map((track, index) => (
                          <th scope="col" key={index}>
                            <span class="ordered-label">
                              #{index + 1} ·{" "}
                              {t(
                                audioLanguageLabel(
                                  track.fields.Language || "",
                                  locale,
                                ),
                              )}
                              {["Default", "Forced"]
                                .filter((flag) =>
                                  /^(yes|true|1)$/i.test(
                                    track.fields[flag] || "",
                                  ),
                                )
                                .map((flag) => (
                                  <em class="cell-hint" key={flag}>
                                    {t(flag)}
                                  </em>
                                ))}
                            </span>
                          </th>
                        ))
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {trackRows.map((row) => (
                      <tr key={row.field}>
                        <th scope="row" class="cell-title">
                          {t(row.field)}
                        </th>
                        {row.values.map((value, index) => (
                          <td key={index} data-label={t("Value")}>
                            {row.field === "Language" && value !== "—"
                              ? t(audioLanguageLabel(value, locale))
                              : value}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </DialogTabs>
      )}
    </section>
  );
}
