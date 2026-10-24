import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";
import { t } from "../i18n";
import { notify } from "../notifications";
import type { FileKey } from "../types";
import { fileKey, mergeSelection, selectionLimit } from "../file-selection";
export { fileKey, groupSelected } from "../file-selection";
export function useFileSelection(scope: string, query: URLSearchParams) {
  const [selected, setSelected] = useState<Record<string, FileKey>>({});
  const [busy, setBusy] = useState(false);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const request = useRef(0);
  useEffect(() => {
    ++request.current;
    setSelected({});
    setBusy(false);
  }, [scope]);
  const toggle = (keys: FileKey[], checked: boolean) =>
    setSelected((current) => {
      const next = mergeSelection(current, keys, checked);
      if (
        checked &&
        new Set([...Object.keys(current), ...keys.map(fileKey)]).size >
          selectionLimit
      )
        notify(t("Selection limited to 10,000 files."), "warning");
      return next;
    });
  const fetchSelection = async (group?: {
    service: string;
    mediaId: number;
    season?: number;
  }) => {
    const id = ++request.current,
      expected = scope,
      q = new URLSearchParams(query);
    if (group) {
      q.set("groupService", group.service);
      q.set("mediaId", String(group.mediaId));
      if (group.season !== undefined) q.set("season", String(group.season));
    }
    setBusy(true);
    try {
      const out = await api<{
        keys: FileKey[];
        total: number;
        truncated: boolean;
      }>("files/selection?" + q);
      if (id !== request.current || expected !== currentScope.current) return;
      toggle(out.keys, true);
      if (out.truncated)
        notify(t("Selection limited to 10,000 files."), "warning");
    } catch {
      // api() already reports the error; retain the previous selection.
    } finally {
      if (id === request.current) setBusy(false);
    }
  };
  const group = (
    service: string,
    mediaId: number,
    season: number | undefined,
    checked: boolean,
  ) => {
    if (checked) return fetchSelection({ service, mediaId, season });
    toggle(
      Object.values(selected).filter(
        (k) =>
          k.service === service &&
          k.mediaId === mediaId &&
          (season === undefined || k.season === season),
      ),
      false,
    );
  };
  return {
    selected,
    keys: Object.values(selected),
    busy,
    toggle,
    group,
    all: () => fetchSelection(),
    clear: () => {
      ++request.current;
      setSelected({});
      setBusy(false);
    },
  };
}
