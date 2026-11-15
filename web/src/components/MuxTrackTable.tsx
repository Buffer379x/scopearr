import type { MuxJob, MuxSpec, MuxTrackSpec } from "../types";
import { t } from "../i18n";
import { audioLanguageList, loadLanguageRegistry } from "../languages";
import { useRef, useState } from "preact/hooks";
import { useTableOverflow } from "../hooks/useTableOverflow";
import { useLanguageRegistry } from "../hooks/useLanguageRegistry";
import { LanguageFlag } from "./LanguageFlag";
export function MuxTrackTable({
  job,
  spec,
  change,
  disabled,
}: {
  job: MuxJob;
  spec: MuxSpec;
  change: (spec: MuxSpec) => void;
  disabled: boolean;
}) {
  // The language list offers every registry entry. Mounting starts the load;
  // after a failed load, opening a language picker tries again once the
  // wait in loadLanguageRegistry is over.
  useLanguageRegistry(true);
  const scroll = useRef<HTMLDivElement>(null);
  const overflow = useTableOverflow(scroll);
  const [focused, setFocused] = useState(false);
  const named = overflow || focused;
  const track = (id: number, patch: Partial<MuxTrackSpec>) =>
    change({
      ...spec,
      tracks: { ...spec.tracks, [id]: { ...spec.tracks[id], ...patch } },
    });
  const heads = [
    "Keep",
    "Type",
    "ID",
    "Codec",
    "Language",
    "Name",
    "Default",
    "Forced",
    "Details",
  ];
  return (
    <div
      ref={scroll}
      class="v2-table-scroll"
      role={named ? "region" : undefined}
      aria-label={named ? job.title : undefined}
      tabIndex={named ? 0 : undefined}
      data-overflow={overflow ? "" : undefined}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <table class="v2-table v2-table--edit">
        <thead>
          <tr>
            {heads.map((s) => (
              <th scope="col">{t(s)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {job.source.tracks.map((row) => {
            const p = spec.tracks[row.id];
            if (!p) return null;
            return (
              <tr key={row.id} class="v2-row">
                <td data-label={t("Keep")}>
                  <input
                    type="checkbox"
                    class="v2-check"
                    aria-label={t("Keep track {id}", { id: row.id })}
                    disabled={disabled}
                    checked={p.keep}
                    onChange={(e) =>
                      track(row.id, { keep: e.currentTarget.checked })
                    }
                  />
                </td>
                <td data-label={t("Type")}>
                  {t(
                    { video: "Video", audio: "Audio", subtitles: "Subtitles" }[
                      row.type
                    ] || row.type,
                  )}
                </td>
                <td class="v2-table-num" data-label={t("ID")}>
                  {row.id}
                </td>
                <td data-label={t("Codec")}>{row.codec}</td>
                <td data-label={t("Language")}>
                  <span class="v2-table-items">
                    <LanguageFlag value={p.language} />
                    <input
                      list="mux-languages"
                      class="v2-input"
                      aria-label={t("Track language")}
                      onFocus={() => void loadLanguageRegistry()}
                      disabled={disabled || !p.keep}
                      value={p.language}
                      onInput={(e) =>
                        track(row.id, { language: e.currentTarget.value })
                      }
                    />
                  </span>
                </td>
                <td data-label={t("Name")}>
                  <input
                    class="v2-input"
                    aria-label={t("Track name")}
                    disabled={disabled || !p.keep}
                    maxLength={256}
                    value={p.name}
                    onInput={(e) =>
                      track(row.id, { name: e.currentTarget.value })
                    }
                  />
                </td>
                <td data-label={t("Default")}>
                  <input
                    type="checkbox"
                    class="v2-check"
                    aria-label={t("Default track")}
                    disabled={disabled || !p.keep}
                    checked={p.default}
                    onChange={(e) =>
                      track(row.id, { default: e.currentTarget.checked })
                    }
                  />
                </td>
                <td data-label={t("Forced")}>
                  <input
                    type="checkbox"
                    class="v2-check"
                    aria-label={t("Forced track")}
                    disabled={disabled || !p.keep}
                    checked={p.forced}
                    onChange={(e) =>
                      track(row.id, { forced: e.currentTarget.checked })
                    }
                  />
                </td>
                <td data-label={t("Details")}>
                  {row.dimensions || row.channels || "—"}
                </td>
              </tr>
            );
          })}
          {(["chapters", "attachments"] as const).map((key) => (
            <tr key={key} class="v2-row">
              <td class="v2-table-sel">
                <input
                  type="checkbox"
                  class="v2-check"
                  aria-label={t(
                    key === "chapters" ? "Keep chapters" : "Keep attachments",
                  )}
                  disabled={disabled}
                  checked={spec[key]}
                  onChange={(e) =>
                    change({ ...spec, [key]: e.currentTarget.checked })
                  }
                />
              </td>
              <td colSpan={8}>
                {t(key === "chapters" ? "Chapters" : "Attachments")} (
                {job.source[key]})
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <datalist id="mux-languages">
        <option value="und" />
        {audioLanguageList().map((l) => (
          <option value={l.codes[0] || l.id}>{l.name}</option>
        ))}
      </datalist>
    </div>
  );
}
