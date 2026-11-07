import { Menu, Wrench } from "lucide-preact";
import { useEffect, useState } from "preact/hooks";
import { t } from "../../i18n";
import type { tabBarModel } from "../../nav-model";
import type { NavTarget } from "../../router";
import { count, ICON } from "../../ui";
import { NavLink } from "./NavLink";
import { Popover } from "./Popover";
import { NAV_ICONS, SIDEBAR_ID } from "./Sidebar";

// The phone tab bar (docs/STYLEGUIDE.md, Part 1, 10.1): Dashboard, Movies
// and TV series as links, Tools as a menu of the visible tools (left out
// without any) and More, which opens the drawer. Plaques and counts are
// decorative; the bell names the open jobs.
export function TabBar({
  model,
  hrefOf,
  open,
  moreOpen,
  openMore,
}: {
  model: ReturnType<typeof tabBarModel>;
  hrefOf(target: NavTarget): string;
  open(target: NavTarget): void;
  moreOpen: boolean;
  openMore(anchor: HTMLElement): void;
}) {
  // The Tools button while its menu is open.
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const shown = model.tools.length ? menu : null;
  // The menu closes when the last tool leaves, so it does not reopen with
  // the tools.
  useEffect(() => {
    if (!model.tools.length) setMenu(null);
  }, [model.tools.length]);
  const tile = (Icon: typeof Menu, badge = 0) => (
    <span class="v2-tab-tile" aria-hidden="true">
      <Icon size={ICON.button} />
      {!!badge && <span class="v2-plaque">{count(badge)}</span>}
    </span>
  );
  const label = (text: string) => <span class="v2-tab-label">{text}</span>;
  return (
    <nav class="v2-tabbar" aria-label={t("Main navigation")}>
      {model.tabs.map((tab) => (
        <NavLink
          key={tab.key}
          class="v2-tab"
          href={hrefOf(tab.target)}
          current={tab.current}
          label={tab.label}
          open={() => open(tab.target)}
        >
          {tile(NAV_ICONS[tab.icon ?? "dashboard"])}
          {label(tab.label)}
        </NavLink>
      ))}
      {model.tools.length > 0 && (
        <button
          type="button"
          class="v2-tab"
          title={t("Tools")}
          aria-current={model.toolsCurrent ? "page" : undefined}
          aria-haspopup="menu"
          aria-expanded={!!shown}
          onClick={(event) => setMenu(shown ? null : event.currentTarget)}
        >
          {tile(Wrench, model.toolsBadge)}
          {label(t("Tools"))}
        </button>
      )}
      <button
        type="button"
        class="v2-tab"
        title={t("More")}
        aria-current={model.moreCurrent ? "page" : undefined}
        aria-expanded={moreOpen}
        aria-controls={SIDEBAR_ID}
        onClick={(event) => openMore(event.currentTarget)}
      >
        {tile(Menu)}
        {label(t("More"))}
      </button>
      {shown && (
        <Popover
          anchor={shown}
          placement="top-end"
          role="menu"
          label={t("Tools")}
          close={() => setMenu(null)}
        >
          {model.tools.map((tool) => {
            const Icon = NAV_ICONS[tool.icon ?? "mux"];
            return (
              <NavLink
                key={tool.key}
                role="menuitem"
                class="v2-menu-item v2-menu-item--tile"
                href={hrefOf(tool.target)}
                current={tool.current}
                open={() => {
                  setMenu(null);
                  open(tool.target);
                }}
              >
                <span
                  class={tool.current ? "v2-tile v2-tile--grad" : "v2-tile"}
                  aria-hidden="true"
                >
                  <Icon size={ICON.button} />
                </span>
                <span class="v2-menu-text">{tool.label}</span>
                {!!tool.badge && (
                  <span class="v2-count v2-count--on" aria-hidden="true">
                    {count(tool.badge)}
                  </span>
                )}
              </NavLink>
            );
          })}
        </Popover>
      )}
    </nav>
  );
}
