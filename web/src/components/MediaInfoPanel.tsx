import { useEffect, useState } from "preact/hooks";
import type { MediaFile } from "../types";
import { t, useI18n } from "../i18n";
import {
  readSessionPreference,
  writeSessionPreference,
} from "../browser-storage";
import { audioLanguageLabel } from "../languages";
import { labels } from "../ui";
import { Tabs } from "./dialog/Tabs";
import {
  mediaInfoValues,
  mediaInfoSection,
  mediaInfoTrackRows,
} from "../mediainfo";
// The MediaInfo tab of File & metadata (docs/STYLEGUIDE.md, Part 1, 10.9;
// Phase 5d, E15): its notices, then the MediaInfo sections as Tabs (Result
// and each kind of track that has data, kept for the session, falling back
// to Result) with the last read on the row's right. Result and a single
// track are v2 tables with card rows; several tracks are one table, a
// track per column, that scrolls in its named region with the attribute
// column sticky (v2-table--sticky-first) and never turns into cards.
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
  const rows = trackRows.map((row) => (
    <tr key={row.field} class="v2-row">
      <th scope="row">{t(row.field)}</th>
      {row.values.map((value, index) => (
        <td key={index} data-label={t("Value")}>
          {row.field === "Language" && value !== "—"
            ? t(audioLanguageLabel(value, locale))
            : value}
        </td>
      ))}
    </tr>
  ));
  useEffect(() => {
    if (section !== savedSection) {
      setSavedSection(section);
      writeSessionPreference("scopearr-mediainfo-section", section);
    }
  }, [section, savedSection]);
  const sections = result
    ? [
        { value: "result", label: t("Result") },
        ...["General", "Video", "Audio", "Text"].flatMap((type) => {
          const count =
            result.tracks?.filter((track) => track.type === type).length || 0;
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
      ]
    : [];
  return (
    <section
      class="v2-modal-panel"
      role="tabpanel"
      id="file-detail-panel-mediainfo"
      aria-labelledby="file-detail-tab-mediainfo"
    >
      {!result && (
        <p class="v2-modal-hint">
          {t("Not read yet. Use Read with MediaInfo below.")}
        </p>
      )}
      {error && (
        <p class="v2-notice v2-notice--error" role="alert">
          {error}
        </p>
      )}
      {result?.ambiguous && (
        <p class="v2-notice v2-notice--warn">
          {t(
            "Several video tracks have no unique default. No values were applied.",
          )}
        </p>
      )}
      {result && (
        <div class="v2-modal-sec">
          <Tabs
            id="mediainfo-section"
            label={t("MediaInfo sections")}
            value={section}
            change={(value) => {
              setSavedSection(value);
              writeSessionPreference("scopearr-mediainfo-section", value);
            }}
            items={sections}
            accessory={t("Last read: {date} · MediaInfo {version}", {
              date: new Date(result.scannedAt).toLocaleString(locale),
              version: result.version,
            })}
          />
          <div
            role="tabpanel"
            id={"mediainfo-section-panel-" + section}
            aria-labelledby={"mediainfo-section-tab-" + section}
          >
            {section === "result" ? (
              <div class="v2-table-scroll" data-overflow="">
                <table class="v2-table">
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
                        key={field}
                        class={
                          file.evidence[field]?.conflict
                            ? "v2-row v2-row--warn"
                            : "v2-row"
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
            ) : tracks.length === 1 ? (
              <div class="v2-table-scroll" data-overflow="">
                <table class="v2-table">
                  <thead>
                    <tr>
                      <th scope="col">{t("Attribute")}</th>
                      <th scope="col">{t("Value")}</th>
                    </tr>
                  </thead>
                  <tbody>{rows}</tbody>
                </table>
              </div>
            ) : (
              <div
                class="v2-table-scroll"
                data-overflow=""
                role="region"
                aria-label={
                  sections.find((item) => item.value === section)?.label
                }
                tabIndex={0}
              >
                <table class="v2-table v2-table--sticky-first">
                  <thead>
                    <tr>
                      <th scope="col">{t("Attribute")}</th>
                      {tracks.map((track, index) => (
                        <th scope="col" key={index}>
                          #{index + 1} ·{" "}
                          {t(
                            audioLanguageLabel(
                              track.fields.Language || "",
                              locale,
                            ),
                          )}
                          {["Default", "Forced"]
                            .filter((flag) =>
                              /^(yes|true|1)$/i.test(track.fields[flag] || ""),
                            )
                            .map((flag) => (
                              <span class="v2-modal-hint" key={flag}>
                                {" "}
                                {t(flag)}
                              </span>
                            ))}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>{rows}</tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
