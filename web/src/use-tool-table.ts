import { useEffect, useMemo, useState } from "preact/hooks";
import { useFontsLoaded } from "./hooks/useFontsLoaded";
import { t, useI18n } from "./i18n";
import {
  domToolMetrics,
  toolColumnStyle,
  toolStatusTexts,
} from "./tool-columns";
import type { ToolButtons } from "./tool-columns";
import type { ToolKind } from "./tool-list";

// Whether the primary pointer is coarse (touch), following changes: the
// selection column is wider then (domToolMetrics).
const COARSE = "(pointer: coarse)";
function useCoarsePointer(): boolean {
  const [query] = useState(() =>
    typeof matchMedia === "function" ? matchMedia(COARSE) : null,
  );
  const [coarse, setCoarse] = useState(!!query?.matches);
  useEffect(() => {
    if (!query) return;
    const update = () => setCoarse(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return coarse;
}

// The v2 tool table's widths (docs/STYLEGUIDE.md, Part 1, 10.10): the
// translated labels (English keys), every status text of the tool and the
// v2 metrics, measured again after a language change and whenever a face
// loads (useFontsLoaded), and when the pointer turns coarse or fine.
// Nothing of the rows goes in.
export function useToolColumnStyle(
  columns: readonly string[],
  kind: ToolKind,
  labels: Record<string, string>,
  buttons: ToolButtons,
): Record<string, string> {
  const { locale } = useI18n();
  const fonts = useFontsLoaded();
  const coarse = useCoarsePointer();
  const { info, actions, infoPhone, actionsPhone } = buttons;
  return useMemo(
    () =>
      toolColumnStyle(
        columns,
        kind,
        Object.fromEntries(
          Object.entries(labels).map(([key, label]) => [key, t(label)]),
        ),
        toolStatusTexts(kind, t),
        { info, actions, infoPhone, actionsPhone },
        domToolMetrics(coarse),
      ),
    [
      columns.join(),
      kind,
      JSON.stringify(labels),
      info,
      actions,
      infoPhone,
      actionsPhone,
      locale,
      fonts,
      coarse,
    ],
  );
}
