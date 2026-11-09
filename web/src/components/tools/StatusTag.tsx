import type { JSX } from "preact";
import { t } from "../../i18n";
import type { ToolStatusView } from "../../tool-status";

// The status tag of a tool row (docs/STYLEGUIDE.md, Part 1, 10.7):
// span.v2-st[data-tone] with its dot and its short text, never truncated;
// the long text is its title, with "Last check: {blocker}" when a stored
// check found a blocker, which also puts a warning dot at the tag's corner
// (placed absolutely, so the tag keeps its size). With a dialog to open,
// the tag is the face of button.v2-st-btn, named and titled by openLabel,
// which names the text it shows (ruling I7).
export function StatusTag({
  view,
  open,
  openLabel,
}: {
  view: ToolStatusView;
  open?(): void;
  openLabel?: string;
}): JSX.Element {
  const tag = (
    <span
      class="v2-st"
      data-tone={view.tone}
      title={
        view.blocker
          ? view.long +
            " · " +
            t("Last check: {blocker}", { blocker: view.blocker })
          : view.long
      }
    >
      <span class="v2-st-dot" aria-hidden="true" />
      {view.text}
      {view.blocker && <span class="v2-dot v2-dot--warn" aria-hidden="true" />}
    </span>
  );
  if (!open) return tag;
  return (
    <button
      type="button"
      class="v2-st-btn"
      aria-label={openLabel}
      title={openLabel}
      onClick={() => open()}
    >
      {tag}
    </button>
  );
}
