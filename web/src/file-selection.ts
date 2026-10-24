import type { FileKey } from "./types";
export const fileKey = (file: FileKey) => file.service + ":" + file.id;
export const selectionLimit = 10000;
export function mergeSelection(
  current: Record<string, FileKey>,
  keys: FileKey[],
  checked: boolean,
) {
  const next = { ...current };
  let count = Object.keys(next).length;
  for (const key of keys) {
    const id = fileKey(key);
    if (checked) {
      if (next[id]) next[id] = key;
      else if (count < selectionLimit) {
        next[id] = key;
        count++;
      }
    } else delete next[id];
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
