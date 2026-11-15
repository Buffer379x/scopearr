import { Check, Minus, TriangleAlert, X } from "lucide-preact";
import type { JSX } from "preact";
import { t, useI18n } from "../../i18n";
import { ICON } from "../../ui";

// A check of a path or state check (docs/STYLEGUIDE.md, Part 1, 10.9,
// Phase 5d E8; replaces the 1.7.0 PathCheckRow): its tone (ok, warn or
// error) as a tile icon, its label and its detail, by default "Ready" or
// "Needs attention" as in 1.7.0; a row of fixed height. A `pending` row (its
// answer is not here yet) has the muted tone and a dash, its detail given by
// the caller, so the answer fills the row without moving anything.
export function CheckRow({
  ok,
  warning = false,
  pending = false,
  label,
  detail,
}: {
  ok: boolean;
  warning?: boolean;
  pending?: boolean;
  label: string;
  detail?: string;
}): JSX.Element {
  useI18n();
  const tone = pending ? "pending" : ok ? "ok" : warning ? "warn" : "error";
  const Icon = pending ? Minus : ok ? Check : warning ? TriangleAlert : X;
  return (
    <div class="v2-check-row" data-tone={tone}>
      <span class="v2-check-row-tile" aria-hidden="true">
        <Icon size={ICON.button} />
      </span>
      <span class="v2-check-row-label">{label}</span>
      <span class="v2-check-row-detail">
        {detail || (pending ? "—" : t(ok ? "Ready" : "Needs attention"))}
      </span>
    </div>
  );
}
