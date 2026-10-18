import { serviceType } from "./instances.ts";
import type { Connection, MediaFile } from "./types";
export function entryLink(
  connection: Connection | undefined,
  file: Pick<MediaFile, "service" | "mediaId" | "titleSlug">,
): string | undefined {
  if (
    !connection ||
    !Number.isSafeInteger(file.mediaId) ||
    file.mediaId <= 0 ||
    !["radarr", "sonarr"].includes(serviceType(file.service) || "")
  )
    return;
  try {
    const base = new URL(connection.url);
    if (
      !["https:", "http:"].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    )
      return;
    if (
      file.titleSlug &&
      /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,255}$/u.test(file.titleSlug)
    )
      return (
        base.href.replace(/\/+$/, "") +
        (serviceType(file.service) === "radarr" ? "/movie/" : "/series/") +
        encodeURIComponent(file.titleSlug)
      );
    if (connection.enabled && connection.hasKey)
      return (
        "/api/open-entry?service=" +
        encodeURIComponent(file.service) +
        "&mediaId=" +
        file.mediaId
      );
  } catch {
    /* Invalid/empty configured addresses have no navigable link. */
  }
}
