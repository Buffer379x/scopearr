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
