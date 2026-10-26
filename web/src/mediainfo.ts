import { audioChannelLayout } from "./audio-channels.ts";
import type { MediaInfoResult } from "./types";
export const mediaInfoVisible = (
  enabled: boolean,
  result?: Partial<MediaInfoResult>,
) => enabled || !!result;
export function mediaInfoValues(
  result: MediaInfoResult,
): Record<string, string> {
  if (result.ambiguous) return {};
  return {
    resolution: result.video?.resolution || "",
    codec: result.video?.codec || "",
    bitDepth: result.video?.bitDepth || "",
    audio: result.audio || "",
    channels: [
      ...new Set(
        (result.audioTracks || []).map(audioChannelLayout).filter(Boolean),
      ),
    ].join(" + "),
    language: result.language || "",
    hdr: result.hdr || "",
  };
}

export function mediaInfoSection(
  saved: string,
  result?: Pick<MediaInfoResult, "tracks">,
): string {
  return ["General", "Video", "Audio", "Text"].includes(saved) &&
    result?.tracks?.some(
      (track) =>
        track.type === saved &&
        Object.values(track.fields).some((value) => value.trim()),
    )
    ? saved
    : "result";
}
export function mediaInfoTrackRows(
  tracks: { fields: Record<string, string> }[],
): { field: string; values: string[] }[] {
  return [...new Set(tracks.flatMap((track) => Object.keys(track.fields)))]
    .filter((field) => tracks.some((track) => track.fields[field]?.trim()))
    .map((field) => ({
      field,
      values: tracks.map((track) => track.fields[field] || "—"),
    }));
}

export function mediaInfoReadAvailable(status?: {
  enabled?: boolean;
  installed?: boolean;
}): boolean {
  return !!status?.enabled && !!status?.installed;
}
