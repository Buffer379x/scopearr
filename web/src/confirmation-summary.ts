import type { Evidence, MediaFile } from "./types";

// A missing selected source makes a retained confirmation marker ineffective.
// Summary consumers use resolved scalars; raw tracks stay available in details.
export function hasActiveFieldConfirmation(
  file: { evidence?: MediaFile["evidence"] },
  field: string,
): boolean {
  const evidence = file.evidence?.[field];
  if (!evidence?.confirmed) return false;
  const sourceKey: Record<string, keyof Evidence> = {
    filename: "filename",
    api: "api",
    mediaServer: "emby",
    mediainfo: "mediainfo",
  };
  const key = sourceKey[evidence.confirmed.source];
  const value = key ? evidence[key] : undefined;
  return typeof value === "string" && value.trim() !== "";
}
