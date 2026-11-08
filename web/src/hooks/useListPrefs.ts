import { useEffect, useState } from "preact/hooks";
import { LIST_PREFS_EVENT, readListPrefs } from "../list-prefs";
import type { ListPrefs } from "../list-prefs";

// The list preferences (list-prefs.ts) for a shown list: the first render
// reads them, and every write (LIST_PREFS_EVENT) reads them again; an
// unchanged choice keeps its object.
export function useListPrefs(): ListPrefs {
  const [prefs, setPrefs] = useState(readListPrefs);
  useEffect(() => {
    const update = () => {
      const next = readListPrefs();
      setPrefs((current) =>
        current.density === next.density && current.stacked === next.stacked
          ? current
          : next,
      );
    };
    update();
    window.addEventListener(LIST_PREFS_EVENT, update);
    return () => window.removeEventListener(LIST_PREFS_EVENT, update);
  }, []);
  return prefs;
}
