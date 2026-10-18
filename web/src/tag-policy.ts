import type { Connection, TagGroups } from "./types";
export const tagFields: (keyof TagGroups)[] = [
  "resolution",
  "codec",
  "source",
  "hdr",
  "bitDepth",
  "audio",
  "channels",
  "language",
  "custom",
];
export type TagTransition = {
  service: string;
  name?: string;
  media?: boolean;
  enabled: string[];
  disabled: string[];
  needsMode: boolean;
};
export function tagTransition(
  service: string,
  before: Connection,
  after: Connection,
): TagTransition {
  const enabled = tagFields.filter(
    (field) => after.tagSync?.[field] && !before.tagSync?.[field],
  );
  const disabled = tagFields.filter(
    (field) => !after.tagSync?.[field] && before.tagSync?.[field],
  );
  const active = tagFields.some((field) => after.tagSync?.[field]);
  return {
    service,
    name: after.name || after.type || service,
    media: after.type === "emby" || after.type === "jellyfin",
    enabled,
    disabled,
    needsMode:
      enabled.length > 0 ||
      (active &&
        (before.url !== after.url ||
          (before.sourceIds || "") !== (after.sourceIds || "") ||
          (before.tagSyncMode || "replace") !==
            (after.tagSyncMode || "replace"))),
  };
}
export type TagDecision = {
  mode?: "add" | "replace";
  disable?: "keep" | "delete";
};
