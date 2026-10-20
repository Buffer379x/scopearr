import type { MuxSettings, MuxSpec, MuxTrack, Status } from "./types";
import { audioLanguage } from "./languages.ts";
export const defaultMuxSettings = (): MuxSettings => ({
  workDir: "",
  enabled: false,
  channel: "stable" as const,
  pathMappings: {},
  deleteOriginal: true,
  notifyMedia: true,
  keepFinished: 7,
});
export function cleanMuxName(name: string) {
  return name.replace(/\.mkv$/i, "");
}
export function muxTabVisible(status: Pick<Status, "mux">) {
  const m = status.mux;
  return !!m?.enabled && m.pending + m.running + m.failed > 0;
}
export function validateMuxSpec(tracks: MuxTrack[], spec: MuxSpec): string {
  const name = cleanMuxName(spec.outputName);
  if (
    !name ||
    new TextEncoder().encode(name).length > 200 ||
    /^\./.test(name) ||
    /[/\\\p{Cc}]/u.test(name) ||
    /\.partial$|\.scopearr-backup/i.test(name)
  )
    return "Invalid output filename";
  const kept = tracks.filter((t) => spec.tracks[t.id]?.keep);
  if (
    !kept.length ||
    (tracks.some((t) => t.type === "video") &&
      !kept.some((t) => t.type === "video"))
  )
    return "Keep at least one track and one video track when present";
  const defaults: Record<string, number> = {};
  for (const t of kept) {
    const p = spec.tracks[t.id];
    if (p.default && (defaults[t.type] = (defaults[t.type] || 0) + 1) > 1)
      return "Only one default track per type is allowed";
    if ([...p.name].length > 256 || /\p{Cc}/u.test(p.name))
      return "Invalid track name";
    if (
      p.language.length > 63 ||
      !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(p.language) ||
      (p.language.split("-")[0].toLowerCase() !== "und" &&
        !audioLanguage(p.language.split("-")[0]))
    )
      return "Invalid track language";
  }
  return "";
}
