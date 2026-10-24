import { HelpPopover } from "./HelpPopover";
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
    <div class="notice root-skip-notice" role="status">
      <CircleAlert size={ICON.button} />
      <div class="root-coverage">
        <p>
          {t(
            roots.some((root) => !root.mapped)
              ? "Some root folders have no path mapping. Map them and start a new scan."
              : "Check the detected share paths before starting file work.",
          )}
        </p>
        {[...roots]
          .sort(
            (a, b) =>
              Number(a.mapped) - Number(b.mapped) ||
              a.arrPath.localeCompare(b.arrPath),
          )
          .map((root) => (
            <div
              class={
                "root-coverage-row" +
                (!root.mapped || root.localExists === false
                  ? " root-unmapped"
                  : "")
              }
              key={root.arrPath}
            >
              <span class="root-dot" aria-hidden="true" />
              <div>
                <span>
                  {root.share || root.arrPath} · {root.instances.join(", ")} ·{" "}
                  {root.mapped
                    ? root.localExists === false
                      ? t("Directory not found")
                      : t("{count} items", { count: root.items })
                    : t("No path mapping")}
                </span>
                {root.pathWarning && (
                  <p class="quiet">{placementMessage(root.pathWarning, t)}</p>
                )}
                {!root.mapped &&
                  (root.suggestion ? (
                    <button
                      class="text-button"
                      disabled={disabled || busy}
                      onClick={() => apply(root.arrPath)}
                    >
                      {busy && <LoaderCircle class="spin" size={ICON.label} />}{" "}
                      {t("Apply mapping ({path})", { path: root.suggestion })}
                    </button>
                  ) : (
                    <button class="text-button" onClick={setup}>
                      {t("Map in settings")}
                    </button>
                  ))}
              </div>
            </div>
          ))}
        {suggestions.length > 1 && (
          <button
            class="button"
            disabled={disabled || busy}
            onClick={() => apply()}
          >
            {t("Apply all ({count})", { count: suggestions.length })}
          </button>
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
  const reason = (root.unselected || 0) >= (root.outside_share || 0) && (root.unselected || 0) > 0
    ? t("Instance not selected")
    : (root.outside_share || 0) > 0 ? t("Outside the share") : t("Path warning");
  return <HelpPopover variant="notice" label="Scan coverage" text={t("{count} items were not scanned.", { count: missing }) + " " + reason} />;
}
