import type { ComponentChildren, JSX } from "preact";

// A checkbox (docs/STYLEGUIDE.md, Part 1, 10.4 and 10.11):
// label.v2-ff-check around its input.v2-check and its text. A helper, not
// a component, so the caller's tree holds the checkbox itself; change gets
// the input too (a confirmation can turn it back).
export function check(
  label: ComponentChildren,
  checked: boolean,
  change: (checked: boolean, input: HTMLInputElement) => void,
  disabled = false,
  key?: string,
): JSX.Element {
  return (
    <label class="v2-ff-check" key={key}>
      <input
        type="checkbox"
        class="v2-check"
        disabled={disabled}
        checked={checked}
        onChange={(e) => change(e.currentTarget.checked, e.currentTarget)}
      />
      {label}
    </label>
  );
}
