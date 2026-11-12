import type { JSX } from "preact";

// The switch (docs/STYLEGUIDE.md, Part 1, 10.4): label.v2-switch holds the
// native checkbox with the switch role, its track (hidden from assistive
// technology) and its text, so the label names it; keyboard, focus and
// forced colors stay the checkbox's. A confirmation stays the caller's.
export function Switch({
  label,
  checked,
  disabled = false,
  change,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  change(on: boolean): void;
}): JSX.Element {
  return (
    <label class="v2-switch">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => change(e.currentTarget.checked)}
      />
      <span class="v2-switch-track" aria-hidden="true" />
      {label}
    </label>
  );
}
