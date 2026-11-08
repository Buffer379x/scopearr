import { CircleMinus, LoaderCircle, Scissors, Tag } from "lucide-preact";
import type { JSX } from "preact";
import type { useFileSelection } from "../../hooks/useFileSelection";
import { useMuxSelection } from "../../hooks/useMuxSelection";
import { t, useI18n } from "../../i18n";
import type { MuxJob } from "../../types";
import { ICON } from "../../ui";
import { CountTool } from "../list/TableCard";

// The selection actions of the library's chips row (docs/STYLEGUIDE.md,
// Part 1, 10.5 and 10.10): Mark for muxing and Remove mux marking through
// useMuxSelection (the rules of the 1.7.0 MuxSelectionActions), then Set
// tag ({count}), which opens the custom tags dialog for the selection.
// Each is a count tool; while a run works its icon turns and its name and
// title count the files handled. `working` locks all three while a
// selection action runs; `capacity` (the page size, the most files a
// selection holds) sets the width of their count slots.
export function SelectionTools({
  selection,
  muxJobs,
  installed,
  changed,
  busyChanged,
  editTags,
  working,
  capacity,
}: {
  selection: ReturnType<typeof useFileSelection>;
  muxJobs: MuxJob[];
  installed: boolean;
  changed(): Promise<void>;
  busyChanged(busy: boolean): void;
  editTags(): void;
  working: boolean;
  capacity: number;
}): JSX.Element {
  useI18n();
  const files = selection.keys;
  const mux = useMuxSelection({
    files,
    jobs: muxJobs,
    installed,
    changed,
    busyChanged,
  });
  const icon = (run: "mark" | "remove", Icon: typeof Scissors) =>
    mux.working === run ? (
      <LoaderCircle class="v2-spin" size={ICON.label} />
    ) : (
      <Icon size={ICON.label} />
    );
  const handled = { done: mux.done, total: mux.total };
  const markName =
    mux.working === "mark"
      ? t("Marking … {done}/{total}", handled)
      : t("Mark for muxing ({count})", { count: files.length });
  const removeName =
    mux.working === "remove"
      ? t("Removing … {done}/{total}", handled)
      : t("Remove mux marking ({count})", { count: mux.marked });
  const tagName = t("Set tag ({count})", { count: files.length });
  const locked = working || !!mux.working;
  return (
    <>
      <CountTool
        icon={icon("mark", Scissors)}
        text={t("Mark for muxing ({count})")}
        count={files.length}
        max={capacity}
        name={markName}
        title={
          markName +
          " · " +
          t(
            !files.length
              ? "Select entries first."
              : !installed
                ? "Install MKVToolNix first."
                : "Mark selected files for muxing",
          )
        }
        disabled={locked || !files.length || !installed}
        onClick={() => void mux.run(false)}
      />
      <CountTool
        icon={icon("remove", CircleMinus)}
        text={t("Remove mux marking ({count})")}
        count={mux.marked}
        max={capacity}
        name={removeName}
        title={
          removeName +
          " · " +
          t(
            !files.length
              ? "Select entries first."
              : !mux.marked
                ? "None of the selected files is marked."
                : !mux.removable
                  ? "None of the selected jobs can be removed."
                  : "Remove mux marking",
          )
        }
        disabled={locked || !mux.marked || !mux.removable}
        onClick={() => void mux.run(true)}
      />
      <CountTool
        icon={<Tag size={ICON.label} />}
        text={t("Set tag ({count})")}
        count={files.length}
        max={capacity}
        name={tagName}
        title={
          tagName +
          " · " +
          t(
            !files.length
              ? "Select entries first."
              : "Set tags for selected files",
          )
        }
        disabled={locked || !files.length}
        onClick={editTags}
      />
    </>
  );
}
