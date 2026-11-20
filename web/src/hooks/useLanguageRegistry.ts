import { useEffect, useState } from "preact/hooks";
import {
  languageRegistryLoaded,
  loadLanguageRegistry,
  onLanguageRegistry,
} from "../languages";

// Renders the component again once the full language registry has loaded, so
// names and flags of languages outside the core appear. With `load`, mounting
// starts the load (for lists that offer every language).
export function useLanguageRegistry(load = false): boolean {
  const [loaded, setLoaded] = useState(languageRegistryLoaded);
  useEffect(() => {
    const stop = onLanguageRegistry(() => setLoaded(true));
    // The registry may have loaded between the first render and this effect.
    if (languageRegistryLoaded()) setLoaded(true);
    else if (load) void loadLanguageRegistry();
    return stop;
  }, [load]);
  return loaded;
}
