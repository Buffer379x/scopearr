import type { FileKey } from "./types";
export const fileKey = (file: FileKey) => file.service + ":" + file.id;
export function mergeSelection(
  current: Record<string, FileKey>,
  keys: FileKey[],
  checked: boolean,
) {
  const next = { ...current };
  for (const key of keys) {
    const id = fileKey(key);
    if (checked) next[id] = key;
    else delete next[id];
  }
  return next;
}
export function groupSelected(
  keys: FileKey[],
  service: string,
  mediaId: number,
  season?: number,
) {
  return keys.filter(
    (k) =>
      k.service === service &&
      k.mediaId === mediaId &&
      (season === undefined || k.season === season),
  ).length;
}

export function visibleGroupKeys(
  keys: FileKey[],
  service: string,
  mediaId: number,
  season?: number,
) {
  return keys.filter(
    (k) =>
      k.service === service &&
      k.mediaId === mediaId &&
      (season === undefined || k.season === season),
  );
}
export function pageSelection(
  saved: { scope: string; values: Record<string, FileKey> },
  scope: string,
  visible: FileKey[],
) {
  if (saved.scope !== scope) return {};
  return Object.fromEntries(
    visible.filter((k) => saved.values[fileKey(k)]).map((k) => [fileKey(k), k]),
  );
}
