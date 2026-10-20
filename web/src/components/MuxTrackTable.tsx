import type { MuxJob, MuxSpec, MuxTrackSpec } from "../types";
import { t } from "../i18n";
import { audioLanguages } from "../languages";
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
  const track = (id: number, patch: Partial<MuxTrackSpec>) =>
    change({
      ...spec,
      tracks: { ...spec.tracks, [id]: { ...spec.tracks[id], ...patch } },
    });
  return (
    <div class="mux-table-scroll">
      <table class="color-settings-table mux-track-table">
        <thead>
          <tr>
            {[
              "Keep",
              "Type",
              "ID",
              "Codec",
              "Language",
              "Name",
              "Default",
              "Forced",
              "Details",
            ].map((s) => (
              <th scope="col">{t(s)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {job.source.tracks.map((row) => {
            const p = spec.tracks[row.id];
            if (!p) return null;
            return (
              <tr key={row.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={t("Keep track {id}", { id: row.id })}
                    disabled={disabled}
                    checked={p.keep}
                    onChange={(e) =>
                      track(row.id, { keep: e.currentTarget.checked })
                    }
                  />
                </td>
                <td>
                  {t(
                    { video: "Video", audio: "Audio", subtitles: "Subtitles" }[
                      row.type
                    ] || row.type,
                  )}
                </td>
                <td>{row.id}</td>
                <td>{row.codec}</td>
                <td>
                  <LanguageFlag value={p.language} />
                  <input
                    list="mux-languages"
                    aria-label={t("Track language")}
                    disabled={disabled || !p.keep}
                    value={p.language}
                    onInput={(e) =>
                      track(row.id, { language: e.currentTarget.value })
                    }
                  />
                </td>
                <td>
                  <input
                    aria-label={t("Track name")}
                    disabled={disabled || !p.keep}
                    maxLength={256}
                    value={p.name}
                    onInput={(e) =>
                      track(row.id, { name: e.currentTarget.value })
                    }
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={t("Default track")}
                    disabled={disabled || !p.keep}
                    checked={p.default}
                    onChange={(e) =>
                      track(row.id, { default: e.currentTarget.checked })
                    }
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={t("Forced track")}
                    disabled={disabled || !p.keep}
                    checked={p.forced}
                    onChange={(e) =>
                      track(row.id, { forced: e.currentTarget.checked })
                    }
                  />
                </td>
                <td>{row.dimensions || row.channels || "—"}</td>
              </tr>
            );
          })}
          {(["chapters", "attachments"] as const).map((key) => (
            <tr>
              <td>
                <input
                  type="checkbox"
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
        {audioLanguages.map((l) => (
          <option value={l.codes[0] || l.id}>{l.name}</option>
        ))}
      </datalist>
    </div>
  );
}
