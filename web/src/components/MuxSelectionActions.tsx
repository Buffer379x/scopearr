import { Scissors, CircleMinus, LoaderCircle } from "lucide-preact";
import { t } from "../i18n";
import { ICON } from "../ui";
import { useMuxSelection } from "../hooks/useMuxSelection";
import type { FileKey, MuxJob } from "../types";
// The 1.7.0 view of the mux selection actions (the mux page), on the logic
// it shares with the library's SelectionTools (useMuxSelection).
export function MuxSelectionActions({
  files,
  jobs,
  installed,
  changed,
  busyChanged,
  actions = ["mark", "remove"],
  busy = false,
}: {
  actions?: ("mark" | "remove")[];
  busy?: boolean;
  files: FileKey[];
  jobs: MuxJob[];
  installed: boolean;
  changed: () => Promise<void>;
  busyChanged: (busy: boolean) => void;
}) {
  const { working, done, total, marked, removable, run } = useMuxSelection({
    files,
    jobs,
    installed,
    changed,
    busyChanged,
  });
  const markLabel =
    working === "mark"
      ? t("Marking … {done}/{total}", { done, total })
      : t("Mark for muxing ({count})", { count: files.length });
  const removeLabel =
    working === "remove"
      ? t("Removing … {done}/{total}", { done, total })
      : t("Remove mux marking ({count})", { count: marked });
  return (
    <>
      {actions.includes("mark") && (
        <button
          class="button selection-action"
          type="button"
          disabled={busy || !!working || !files.length || !installed}
          aria-label={markLabel}
          title={
            markLabel +
            " · " +
            t(
              !files.length
                ? "Select entries first."
                : !installed
                  ? "Install MKVToolNix first."
                  : "Mark selected files for muxing",
            )
          }
          onClick={() => void run(false)}
        >
          {working === "mark" ? (
            <LoaderCircle class="spin" size={ICON.label} />
          ) : (
            <Scissors size={ICON.label} />
          )}
          <span class="selection-action-label">{markLabel}</span>
        </button>
      )}
      {actions.includes("remove") && (
        <button
          class="button selection-action"
          type="button"
          disabled={busy || !!working || !marked || !removable}
          aria-label={removeLabel}
          title={
            removeLabel +
            " · " +
            t(
              !files.length
                ? "Select entries first."
                : !marked
                  ? "None of the selected files is marked."
                  : !removable
                    ? "None of the selected jobs can be removed."
                    : "Remove mux marking",
            )
          }
          onClick={() => void run(true)}
        >
          {working === "remove" ? (
            <LoaderCircle class="spin" size={ICON.label} />
          ) : (
            <CircleMinus size={ICON.label} />
          )}
          <span class="selection-action-label">{removeLabel}</span>
        </button>
      )}
    </>
  );
}
