import type { JSX } from "preact";
import type { ToolOption } from "../../tool-list";
import { count } from "../../ui";

// An include-only value list of a filter drawer (docs/STYLEGUIDE.md, Part
// 1, 10.5, ruling M8): a drawer section (section.v2-drawer-sec) with its
// heading (h3, `id`) and the always open fieldset.v2-ff-list it names, no
// toggle and no operator. Each value is a label.v2-ff-opt with its v2-check
// box, its label and its count (span.v2-ff-n); a value with the count 0 is
// disabled unless it is chosen, so it can always be cleared (1.7.0
// FilterCheckList); `lockEmpty` false (Phase 5c, the event log, whose
// 1.7.0 filter let every value be chosen) keeps it choosable, with its 0.
// A change hands over the new list, in the order of choice.
export function CheckField({
  id,
  label,
  options,
  selected,
  change,
  lockEmpty = true,
}: {
  id: string;
  label: string;
  options: ToolOption[];
  selected: string[];
  change(values: string[]): void;
  lockEmpty?: boolean;
}): JSX.Element {
  return (
    <section class="v2-drawer-sec">
      <div class="v2-drawer-h">
        <h3 id={id}>{label}</h3>
      </div>
      <fieldset class="v2-ff-list" aria-labelledby={id}>
        {options.map((option) => {
          const on = selected.includes(option.value);
          const locked = lockEmpty && option.count === 0 && !on;
          return (
            <label
              key={option.value}
              class="v2-ff-opt"
              aria-disabled={locked ? "true" : undefined}
            >
              <input
                type="checkbox"
                class="v2-check"
                checked={on}
                disabled={locked}
                onChange={(event) => {
                  const others = selected.filter(
                    (value) => value !== option.value,
                  );
                  change(
                    event.currentTarget.checked
                      ? [...others, option.value]
                      : others,
                  );
                }}
              />
              {option.label}
              {option.count !== undefined && (
                <span class="v2-ff-n">{count(option.count)}</span>
              )}
            </label>
          );
        })}
      </fieldset>
    </section>
  );
}
