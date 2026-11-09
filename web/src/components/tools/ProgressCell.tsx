import type { JSX } from "preact";
import { percent } from "../../ui";

// The progress cell of a tool row (docs/STYLEGUIDE.md, Part 1, 10.10):
// while the row waits or runs a progress bar, --tool-progress-w wide, its
// fill at --v and its percent in a fixed slot ("—" while waiting, without
// a value); otherwise "—". It replaces the 1.7.0 CompactProgress.
export function ProgressCell({
  status,
  value,
  label,
}: {
  status: string;
  value: number;
  label: string;
}): JSX.Element {
  if (status !== "queued" && status !== "running") return <>—</>;
  const running = status === "running";
  const v = running ? Math.min(100, Math.max(0, value || 0)) : 0;
  return (
    <div
      class="v2-progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={running ? v : undefined}
      style={{ "--v": String(v) }}
    >
      <span class="v2-progress-bar" aria-hidden="true">
        <span />
      </span>
      <span class="v2-progress-pct" aria-hidden="true">
        {running ? percent(v) : "—"}
      </span>
    </div>
  );
}
