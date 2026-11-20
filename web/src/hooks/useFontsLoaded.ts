import { useEffect, useState } from "preact/hooks";

// A revision of the loaded web fonts: it grows when document.fonts.ready is
// fulfilled and with every later loadingdone, such as the v2 typeface
// arriving after fontsReady in main.tsx gave up (ready can be fulfilled
// before the face is requested). Measurements that use the body font take
// it as a dependency. 0 without document.fonts.
export function useFontsLoaded(): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts) return;
    let active = true;
    const next = () => {
      if (active) setRevision((value) => value + 1);
    };
    void fonts.ready.then(next);
    fonts.addEventListener("loadingdone", next);
    return () => {
      active = false;
      fonts.removeEventListener("loadingdone", next);
    };
  }, []);
  return revision;
}
