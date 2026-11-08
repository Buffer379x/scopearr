import { ScrollText } from "lucide-preact";
import { JOBS_SHOWN, logSources } from "../../frame-status";
import type { JobState, jobsSummary } from "../../frame-status";
import { useOpenJobs } from "../../hooks/useOpenJobs";
import { t } from "../../i18n";
import { TOOL_LABELS } from "../../nav-model";
import type { NavTarget } from "../../router";
import { count, ICON } from "../../ui";
import { NavLink } from "./NavLink";
import { Popover } from "./Popover";
import { NAV_ICONS } from "./Sidebar";

// The counts of a tool's row with their words, in this order.
const COUNTS = [
  ["running", "Running"],
  ["pending", "Waiting"],
  ["failed", "Failed"],
] as const;
// A job's state: its word and its dot.
const STATES: Record<JobState, [string, string]> = {
  running: ["Running", "v2-dot v2-dot--running"],
  failed: ["Failed", "v2-dot v2-dot--error"],
  waiting: ["Waiting", "v2-dot v2-dot--off"],
};
const NBSP = "\u00a0";
// A job row: its dot, its name and its line. A placeholder (`wait`) is the
// same row, decorative, with no-break spaces, so it has the job's height.
const entry = (
  key: number | string,
  dot: string,
  name: string,
  line: string,
  wait?: boolean,
) => (
  <li key={key} class="v2-job" aria-hidden={wait ? "true" : undefined}>
    <span class={dot} aria-hidden="true" />
    <span class="v2-jobs-text">
      <span class="v2-jobs-name">{name}</span>
      <span class="v2-jobs-line">{line}</span>
    </span>
  </li>
);

// The bell's jobs menu (docs/STYLEGUIDE.md, Part 1, 10.1; E17, ruling R-B):
// a wide dialog named "Jobs" below the bell. Each tool with open jobs is a
// link to its page with its counts from the status; its jobs load when the
// menu opens and show below it, at most three, running first. Until they
// arrive, placeholder rows of the same height hold their place (as many
// as the tool will show), so nothing moves when they do; when they cannot
// be loaded, the tool's row stands alone. Without open jobs it says so.
// With a failed job its footer leads to the error log of the failed tools.
export function JobsMenu({
  summary,
  hrefOf,
  open,
  showLog,
  close,
  anchor,
}: {
  summary: ReturnType<typeof jobsSummary>;
  hrefOf(target: NavTarget): string;
  open(target: NavTarget): void;
  showLog(sources: string[]): void;
  close(returnFocus: boolean): void;
  anchor: HTMLElement;
}) {
  const tools = summary.tools.filter((tool) => tool.open > 0);
  const jobs = useOpenJobs(tools);
  return (
    <Popover
      anchor={anchor}
      placement="bottom-end"
      role="dialog"
      label={t("Jobs")}
      close={close}
      wide
    >
      <p class="v2-pop-title">{t("Jobs")}</p>
      {tools.length ? (
        <ul class="v2-jobs">
          {tools.map((tool) => {
            const Icon = NAV_ICONS[tool.view];
            const target: NavTarget = { view: tool.view };
            const rows = jobs[tool.view];
            // Placeholders until the tool's jobs arrive (undefined).
            const slots =
              rows === undefined ? Math.min(tool.open, JOBS_SHOWN) : 0;
            return (
              <li key={tool.view}>
                <NavLink
                  class="v2-menu-item v2-menu-item--tile"
                  href={hrefOf(target)}
                  open={() => open(target)}
                >
                  <span class="v2-tile" aria-hidden="true">
                    <Icon size={ICON.button} />
                  </span>
                  <span class="v2-jobs-text">
                    <span class="v2-jobs-name">
                      {t(TOOL_LABELS[tool.view])}
                    </span>
                    <span class="v2-jobs-line">
                      {COUNTS.filter(([key]) => tool[key])
                        .map(([key, word]) => t(word) + " " + count(tool[key]))
                        .join(" · ")}
                    </span>
                  </span>
                </NavLink>
                {!!(rows?.length || slots) && (
                  <ul class="v2-jobs-list">
                    {Array.from({ length: slots }, (_, slot) =>
                      entry("w" + slot, STATES.waiting[1], NBSP, NBSP, true),
                    )}
                    {rows?.map((job) =>
                      entry(
                        job.id,
                        STATES[job.state][1],
                        job.name,
                        [t(STATES[job.state][0]), job.detail]
                          .filter(Boolean)
                          .join(" · "),
                      ),
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p class="v2-pop-text">{t("No open jobs.")}</p>
      )}
      {summary.failed > 0 && (
        <div class="v2-pop-foot">
          <button
            type="button"
            class="v2-btn v2-btn--sm"
            onClick={() => showLog(logSources(summary))}
          >
            <ScrollText size={ICON.sort} aria-hidden="true" />
            {t("Show in log")}
          </button>
        </div>
      )}
    </Popover>
  );
}
