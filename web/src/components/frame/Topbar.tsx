import { Bell, Info, LogOut, Moon, Search, Sun } from "lucide-preact";
import type { Theme } from "../../appearance";
import type { jobsSummary, syncSummary } from "../../frame-status";
import { t } from "../../i18n";
import type { SidebarMode } from "../../sidebar-state";
import { count, ICON } from "../../ui";
import { BrandMark } from "./BrandMark";
import { NavLink } from "./NavLink";
import { SyncStatus } from "./SyncStatus";

// The popup attributes of a trigger: none until its overlay exists (E15).
const popup = (handler: unknown, expanded: boolean) =>
  handler
    ? { "aria-haspopup": "dialog" as const, "aria-expanded": expanded }
    : {};

// The topbar (docs/STYLEGUIDE.md, Part 1, 10.1), the page's banner. From
// 740: breadcrumbs, then demo, the sync chip (rail only), quick search, the
// bell, theme and sign out. Phones (the drawer mode): the brand, the page
// title after scrolling, demo, bell and theme. `scrolled` changes colors
// only; every part keeps its box.
export function Topbar({
  mode,
  crumbs,
  title,
  scrolled,
  demo,
  sync,
  jobs,
  theme,
  homeHref,
  openHome,
  toggleTheme,
  signOut,
  onSync,
  onJobs,
  onSearch,
  open = null,
}: {
  mode: SidebarMode;
  crumbs: string[];
  title: string;
  scrolled: boolean;
  demo: boolean;
  sync: ReturnType<typeof syncSummary> | null;
  jobs: ReturnType<typeof jobsSummary>;
  theme: Theme;
  homeHref: string;
  openHome(): void;
  toggleTheme(): void;
  signOut(): void;
  onSync?(anchor: HTMLElement): void;
  onJobs?(anchor: HTMLElement): void;
  onSearch?(anchor: HTMLElement): void;
  open?: "sync" | "jobs" | "search" | null;
}) {
  const phone = mode === "drawer";
  const demoText = t("Demo · sample data, no connection to your services");
  const jobsLabel = t("Tools, {count} open jobs", { count: jobs.count });
  const themeLabel = theme === "dark" ? t("Light theme") : t("Dark theme");
  const ThemeIcon = theme === "dark" ? Sun : Moon;
  const bar = "v2-icon-btn v2-icon-btn--bar";
  return (
    <header class="v2-topbar" data-scrolled={scrolled ? "" : undefined}>
      {phone ? (
        <>
          <NavLink
            class="v2-topbar-home"
            href={homeHref}
            label={t("Scopearr home")}
            open={openHome}
          >
            <BrandMark class="v2-topbar-mark" />
          </NavLink>
          <span class="v2-topbar-title" aria-hidden="true">
            {title}
          </span>
        </>
      ) : (
        <nav class="v2-crumbs" aria-label={t("Breadcrumbs")}>
          <ol>
            {crumbs.map((crumb, index) => (
              <li
                key={index}
                aria-current={index === crumbs.length - 1 ? "page" : undefined}
              >
                {crumb}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div class="v2-topbar-end">
        {demo && (
          <span class="v2-pill v2-demo" title={demoText}>
            {!phone && <Info size={ICON.sort} aria-hidden="true" />}
            <span class="v2-demo-long">{demoText}</span>
            <span class="v2-demo-short" aria-hidden="true">
              {t("Demo")}
            </span>
          </span>
        )}
        {mode === "rail" && sync && (
          <SyncStatus
            summary={sync}
            variant="chip"
            onOpen={onSync}
            expanded={open === "sync"}
          />
        )}
        {!phone && (
          <button
            type="button"
            class={bar}
            aria-label={t("Quick search")}
            title={t("Quick search")}
            aria-keyshortcuts="Control+K Meta+K"
            {...popup(onSearch, open === "search")}
            onClick={(event) => onSearch?.(event.currentTarget)}
          >
            <Search size={ICON.button} />
          </button>
        )}
        <button
          type="button"
          class={bar + " v2-bell"}
          aria-label={jobsLabel}
          title={jobsLabel}
          {...popup(onJobs, open === "jobs")}
          onClick={(event) => onJobs?.(event.currentTarget)}
        >
          <Bell size={ICON.button} />
          {jobs.count > 0 && (
            <span
              class={
                "v2-plaque" +
                (scrolled ? "" : " v2-plaque--band") +
                (jobs.failed ? " v2-plaque--error" : "")
              }
              aria-hidden="true"
            >
              {count(jobs.count)}
            </span>
          )}
        </button>
        <button
          type="button"
          class={bar}
          aria-label={themeLabel}
          title={themeLabel}
          onClick={toggleTheme}
        >
          <ThemeIcon size={ICON.button} />
        </button>
        {!phone && (
          <button
            type="button"
            class={bar}
            aria-label={t("Sign out")}
            title={t("Sign out")}
            onClick={signOut}
          >
            <LogOut size={ICON.button} />
          </button>
        )}
      </div>
    </header>
  );
}
