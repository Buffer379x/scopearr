import { hasActiveFieldConfirmation } from "./confirmation-summary.ts";
import type { MediaFile } from "./types";

type AudioTrack = NonNullable<MediaFile["audioTracks"]>[number];
// Keep the track order and duplicates. Counts alone do not establish an LFE layout.
export function audioChannelLayout(track: AudioTrack): string {
  const layout = (track.channelLayout || "").trim().toLowerCase();
  if (layout === "mono") return "1.0";
  if (layout === "stereo") return "2.0";
  if (layout === "quad") return "4.0";
  const standard = /^(\d\.\d)(\(.+\))?$/.exec(layout);
  if (standard) return standard[1];
  return Number.isSafeInteger(track.channels) && track.channels > 0
    ? `${track.channels} ch`
    : "";
}
export function channelRows(
  file: Pick<MediaFile, "audioTracks" | "channels"> &
    Partial<Pick<MediaFile, "evidence">>,
): string[] {
  return file.audioTracks?.length &&
    !hasActiveFieldConfirmation(file, "channels")
    ? file.audioTracks.map(audioChannelLayout)
    : file.channels
      ? file.channels.split(" + ")
      : [""];
}
