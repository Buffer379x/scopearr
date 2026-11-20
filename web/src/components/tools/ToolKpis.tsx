import {
  CircleCheck,
  Clock,
  FolderCheck,
  Hand,
  LoaderCircle,
  OctagonAlert,
  ShieldCheck,
  TriangleAlert,
} from "lucide-preact";
import type { JSX } from "preact";
import { t } from "../../i18n";
import { kpiPressed, type ToolKpi } from "../../tool-list";
import { count, ICON } from "../../ui";

// The icons of the KPI cards by key (C+ toolStats); Open is the clock as
// Mux's hero and the warning of Files & permissions' open findings.
const ICONS: Record<string, typeof Clock> = {
  open: TriangleAlert,
  running: LoaderCircle,
  failed: OctagonAlert,
  succeeded: CircleCheck,
  checked: FolderCheck,
  fixed: ShieldCheck,
  manual: Hand,
};

// The KPI row of a tool page (docs/STYLEGUIDE.md, Part 1, 10.2, ruling
// M11): the dashboard's row section.v2-dash-kpis, named “Overview”, of
// compact KPI cards, the hero first. A card with statuses is a filter:
// button[aria-pressed], named by its label and value, titled “Show only
// {label}”, or “Reset filters” while the status filter is exactly its set;
// a press hands the card to choose. A hero without statuses is a div
// without a role. Without data the value reads “—” at the same height.
export function ToolKpis({
  kpis,
  statuses,
  choose,
}: {
  kpis: ToolKpi[];
  statuses: string[];
  choose(kpi: ToolKpi): void;
}): JSX.Element {
  return (
    <section class="v2-dash-kpis" aria-label={t("Overview")}>
      {kpis.map((kpi) => {
        const Icon =
          kpi.key === "open" && kpi.hero ? Clock : (ICONS[kpi.key] ?? Clock);
        const look =
          "v2-kpi v2-kpi--compact" + (kpi.hero ? " v2-kpi--hero" : "");
        // A space parts label and value in the name; between the flex
        // items it is not rendered.
        const content = (
          <>
            <span class="v2-kpi-text">
              <span class="v2-kpi-label">{kpi.label}</span>{" "}
              <span class="v2-kpi-value">
                {kpi.value === null ? "—" : count(kpi.value)}
              </span>
            </span>
            <span
              class={
                kpi.hero
                  ? "v2-tile v2-tile--lg"
                  : "v2-tile v2-tile--lg v2-tile--grad"
              }
              aria-hidden="true"
            >
              <Icon size={ICON.large} />
            </span>
          </>
        );
        if (!kpi.statuses)
          return (
            <div key={kpi.key} class={look}>
              {content}
            </div>
          );
        const pressed = kpiPressed(statuses, kpi);
        return (
          <button
            key={kpi.key}
            type="button"
            class={look}
            aria-pressed={pressed}
            title={
              pressed
                ? t("Reset filters")
                : t("Show only {label}", { label: kpi.label })
            }
            onClick={() => choose(kpi)}
          >
            {content}
          </button>
        );
      })}
    </section>
  );
}
