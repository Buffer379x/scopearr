import { ArrowRight, Clapperboard, FileVideo, Film, Tv } from "lucide-preact";
import type { JSX } from "preact";
import type { KpiModel } from "../../dashboard-model";
import { count, ICON } from "../../ui";
import { NavLink } from "../frame/NavLink";

// Keeps an empty value's line (a placeholder before the data).
const NBSP = "\u00a0";

const ICONS = {
  movies: Film,
  series: Tv,
  episodes: Clapperboard,
  files: FileVideo,
};

// A KPI card (docs/STYLEGUIDE.md, Part 1, 10.2): a NavLink into its list,
// named by its label, value and detail; the hero (v2-kpi--hero) in the
// accent gradient with a panel tile. Without data (value null) it keeps
// its size with an empty value line. The arrow shows on hover and focus.
export function KpiCard({
  model,
  href,
  open,
}: {
  model: KpiModel;
  href: string;
  open(): void;
}): JSX.Element {
  const Icon = ICONS[model.key];
  return (
    <NavLink
      href={href}
      open={open}
      class={model.hero ? "v2-kpi v2-kpi--hero" : "v2-kpi"}
    >
      <span class="v2-kpi-text">
        <span class="v2-kpi-label">{model.label}</span>
        <span class="v2-kpi-value">
          {model.value === null ? NBSP : count(model.value)}
        </span>
        <span class="v2-kpi-hint">{model.detail}</span>
      </span>
      <span
        class={
          model.hero
            ? "v2-tile v2-tile--lg"
            : "v2-tile v2-tile--lg v2-tile--grad"
        }
        aria-hidden="true"
      >
        <Icon size={ICON.large} />
      </span>
      <ArrowRight class="v2-kpi-go" size={ICON.chip} aria-hidden="true" />
    </NavLink>
  );
}
