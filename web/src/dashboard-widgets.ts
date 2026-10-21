export const dashboardOrder = [
  "resolution",
  "codec",
  "source",
  "audio",
  "language",
  "storage",
];
export const dashboardLabels: Record<string, string> = {
  resolution: "Resolution",
  codec: "Codec",
  source: "Source",
  audio: "Audio",
  language: "Language",
  storage: "Storage",
};

export function dashboardScope(
  saved: string | null | undefined,
): "all" | "radarr" | "sonarr" {
  return saved === "radarr" || saved === "sonarr" ? saved : "all";
}
