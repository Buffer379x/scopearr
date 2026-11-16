import { RotateCcw, X } from "lucide-preact";
import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { t, useI18n } from "../../i18n";
import { ICON } from "../../ui";

type Chip = { key: string; label: string; excluded: boolean; remove(): void };

// A chip's field name: its label up to the first ": " or " ≠ " (the shape
// of filterChips: "Resolution: 1080p", "Audio codec ≠ DTS", "HDR contains
// all: HDR10 + Dolby Vision"); a label without either has none.
function chipParts(label: string): [string, string] {
  const at = [": ", " ≠ "]
    .map((separator) => label.indexOf(separator))
    .filter((index) => index > 0);
  const end = at.length ? Math.min(...at) : 0;
  return [label.slice(0, end), label.slice(end)];
}

// The chips row between the head and the table of a table card
// (docs/STYLEGUIDE.md, Part 1, 10.5), of one height for no, one and twenty
// chips: a named group of chips, each a button named by its label that
// removes its filter (the group scrolls sideways), or without chips the
// empty text; then Reset filters, outside the group, so no number of chips
// scrolls it away; on the right the page tools of the caller.
// When a chip or Reset filters
// takes its button out of the page, focus moves to the chip now in its
// place (else the one before it, else the group), unless it went elsewhere.
export function ChipsRow({
  label,
  chips,
  empty,
  reset,
  tools,
}: {
  label: string;
  chips: Chip[];
  empty: string;
  reset?(): void;
  tools: ComponentChildren;
}): JSX.Element {
  useI18n();
  const group = useRef<HTMLDivElement>(null);
  // The place of a pressed chip; the effect runs once the chips changed.
  const removed = useRef<number | null>(null);
  useEffect(() => {
    const at = removed.current,
      box = group.current;
    if (at === null || !box) return;
    removed.current = null;
    const active = document.activeElement;
    if (active && active !== document.body && !box.contains(active)) return;
    const left = box.querySelectorAll<HTMLElement>(".v2-chip");
    (left[Math.min(at, left.length - 1)] ?? box).focus();
  }, [chips.map((chip) => chip.key).join("\n")]);
  return (
    <div class="v2-chips-row">
      <div
        ref={group}
        class="v2-chips-group"
        role="group"
        aria-label={label}
        tabIndex={-1}
      >
        {chips.map((chip, at) => {
          const [field, rest] = chipParts(chip.label);
          return (
            <button
              key={chip.key}
              type="button"
              class={"v2-chip" + (chip.excluded ? " v2-chip--excluded" : "")}
              onClick={() => {
                removed.current = at;
                chip.remove();
              }}
            >
              <span>
                {field && <span class="v2-chip-field">{field}</span>}
                {rest}
              </span>
              <X class="v2-chip-x" size={ICON.chip} />
            </button>
          );
        })}
        {!chips.length && <span class="v2-chips-empty">{empty}</span>}
      </div>
      {chips.length > 0 && reset && (
        <button
          type="button"
          class="v2-text-btn"
          onClick={() => {
            removed.current = 0;
            reset();
          }}
        >
          <RotateCcw size={ICON.chip} />
          {t("Reset filters")}
        </button>
      )}
      <div class="v2-tc-tools">{tools}</div>
    </div>
  );
}
