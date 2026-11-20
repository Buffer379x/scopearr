import { scanCoverageReason } from "../scan-coverage";
import { HelpTip } from "./list/HelpTip";
import { placementMessage } from "../placement-messages";
import { useState } from "preact/hooks";
import { CircleAlert, LoaderCircle } from "lucide-preact";
import { api } from "../api";
import { notify } from "../notifications";
import { t } from "../i18n";
import { ICON } from "../ui";
import type { ScanRoot } from "../types";

type Props = {
  roots: ScanRoot[];
  saved: () => unknown;
  setup: () => void;
  disabled: boolean;
};
export function SkippedRootsNotice({
  roots: allRoots,
  saved,
  setup,
  disabled,
}: Props) {
  const roots = allRoots.filter((root) => !root.mapped || !!root.pathWarning);
  const [busy, setBusy] = useState(false);
  const apply = async (root?: string) => {
    setBusy(true);
    try {
      await api(
        "unraid/mappings/apply",
        "POST",
        root ? { roots: [root] } : { all: true },
      );
      notify(t("Mapping saved. Start a new scan."));
      await saved();
    } catch {
    } finally {
      setBusy(false);
    }
  };
  if (!roots.length) return null;
  const suggestions = roots.filter((root) => !root.mapped && root.suggestion);
  return (
    <div class="v2-notice v2-notice--warn v2-notice--setup" role="status">
      <CircleAlert size={ICON.button} />
      <div class="v2-notice-body v2-modal-sec">
        <p>
          {t(
            roots.some((root) => !root.mapped)
              ? "Some root folders have no path mapping. Map them and start a new scan."
              : "Check the detected share paths before starting file work.",
          )}
        </p>
        <ul class="v2-modal-list">
          {[...roots]
            .sort(
              (a, b) =>
                Number(a.mapped) - Number(b.mapped) ||
                a.arrPath.localeCompare(b.arrPath),
            )
            .map((root) => (
              <li key={root.arrPath}>
                <span
                  class={
                    "v2-dot" +
                    (!root.mapped || root.localExists === false
                      ? " v2-dot--warn"
                      : "")
                  }
                  aria-hidden="true"
                />
                <span>
                  {root.share || root.arrPath} · {root.instances.join(", ")} ·{" "}
                  {root.mapped
                    ? root.localExists === false
                      ? t("Directory not found")
                      : t("{count} items", { count: root.items })
                    : t("No path mapping")}
                </span>
                {root.pathWarning && (
                  <small class="v2-modal-hint">
                    {placementMessage(root.pathWarning, t)}
                  </small>
                )}
                {!root.mapped &&
                  (root.suggestion ? (
                    <button
                      type="button"
                      class="v2-text-btn"
                      disabled={disabled || busy}
                      onClick={() => apply(root.arrPath)}
                    >
                      {busy && (
                        <LoaderCircle class="v2-spin" size={ICON.label} />
                      )}{" "}
                      {t("Apply mapping ({path})", { path: root.suggestion })}
                    </button>
                  ) : (
                    <button type="button" class="v2-text-btn" onClick={setup}>
                      {t("Map in settings")}
                    </button>
                  ))}
              </li>
            ))}
        </ul>
        {suggestions.length > 1 && (
          <div class="v2-modal-line">
            <button
              type="button"
              class="v2-btn v2-btn--sm"
              disabled={disabled || busy}
              onClick={() => apply()}
            >
              {t("Apply all ({count})", { count: suggestions.length })}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
// A saved mapping takes effect in setup immediately; only the results await the
// next explicit scan. Keep coverage from the previous scan otherwise intact.
export function rootPresentation(roots: ScanRoot[], mappings: string) {
  return roots.map((root) =>
    !root.mapped &&
    root.suggestion &&
    mappings
      .split("\n")
      .some((line) => line.trim() === root.arrPath + " => " + root.suggestion)
      ? { ...root, mapped: true, localExists: true, skipped: 0 }
      : root,
  );
}

export function RootScanNotice({ root }: { root: ScanRoot }) {
  const missing = Math.max(0, root.items - (root.scanned || 0));
  if (!missing) return null;
  const reason = t(scanCoverageReason(root));
  return (
    <HelpTip
      tone="notice"
      label="Scan coverage"
      text={
        t("{count} items were not scanned.", { count: missing }) + " " + reason
      }
    />
  );
}
