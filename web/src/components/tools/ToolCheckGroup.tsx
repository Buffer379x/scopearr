import { ChevronDown } from "lucide-preact";
import type { JSX } from "preact";
import { useState } from "preact/hooks";
import type { ToolOption } from "../../tool-list";
import { count, ICON } from "../../ui";

// Which groups the user folded, by list and group ("placement:shares"),
// for the session (the chunk's lifetime); a group not in it starts open.
const folded = new Map<string, boolean>();

// A group of the tools' filter drawer (docs/STYLEGUIDE.md, Part 1, 10.5,
// rc.3 K5, preview C+): a full-width head button (h3 > button, its name
// the group's label) with the count of the values chosen in the draft
// (v2-count, --on above 0, aria-hidden as the Filters button's) and a
// chevron; it folds the body (aria-expanded, aria-controls, the folded
// body inert), remembered per `memo` for the session. The body is the
// include-only value list (fieldset.v2-fgroup-list named by the label):
// one row per value, its v2-check box and label, its count right-aligned
// as a muted v2-count. A value with the count 0 is disabled unless it is
// chosen, so it can always be cleared (1.7.0 FilterCheckList, as
// CheckField). A change hands over the new list, in the order of choice.
export function ToolCheckGroup({
  id,
  memo,
  label,
  options,
  selected,
  change,
}: {
  id: string;
  memo: string;
  label: string;
  options: ToolOption[];
  selected: string[];
  change(values: string[]): void;
}): JSX.Element {
  const [open, setOpen] = useState(() => !folded.get(memo));
  const body = id + "-body";
  return (
    <section class="v2-fgroup">
      <h3 class="v2-fgroup-h">
        <button
          type="button"
          class="v2-fgroup-head"
          aria-expanded={open}
          aria-controls={body}
          onClick={() => {
            folded.set(memo, open);
            setOpen(!open);
          }}
        >
          <span id={id}>{label}</span>
          <span
            class={"v2-count" + (selected.length ? " v2-count--on" : "")}
            aria-hidden="true"
          >
            {count(selected.length)}
          </span>
          <ChevronDown
            size={ICON.label}
            class="v2-fgroup-chev"
            aria-hidden="true"
          />
        </button>
      </h3>
      <div id={body} class="v2-fgroup-body" inert={!open}>
        <div class="v2-fgroup-inner">
          <fieldset class="v2-fgroup-list" aria-labelledby={id}>
            {options.map((option) => {
              const on = selected.includes(option.value);
              const locked = option.count === 0 && !on;
              return (
                <label
                  key={option.value}
                  class="v2-fgroup-opt"
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
                  <span class="v2-fgroup-label">{option.label}</span>
                  {option.count !== undefined && (
                    <span class="v2-count">{count(option.count)}</span>
                  )}
                </label>
              );
            })}
          </fieldset>
        </div>
      </div>
    </section>
  );
}
