import {
  ChartNoAxesColumnIncreasing,
  Film,
  Tv,
  Wrench,
  Sun,
  Moon,
  Settings as SettingsIcon,
  LogOut,
} from "lucide-preact";
import { t } from "../i18n";
import { ICON } from "../ui";
import { instancesOf, instanceLabel } from "../instances";
import type { Service, Settings } from "../types";
import { NavMenu, type NavMenuItem } from "./NavMenu";

// The header renders parent-owned navigation and actions without changing routes.
export function AppHeader({
  page,
  service,
  settings,
  filters,
  toolItems,
  theme,
  openDashboard,
  openLibrary,
  openSettings,
  toggleTheme,
  signOut,
}: {
  page: string;
  service: Service;
  settings: Settings | null;
  filters: Record<Service, string>;
  toolItems: NavMenuItem[];
  theme: string;
  openDashboard: () => void;
  openLibrary: (service: Service, instance: string) => void;
  openSettings: () => void;
  toggleTheme: () => void;
  signOut: () => void;
}) {
  return (
    <header class="header">
      <a href="/" class="brand" aria-label={t("Scopearr home")}>
        <img
          src="/icon-64.png"
          srcSet="/icon-64.png 1x, /icon-256.png 2x"
          width="34"
          height="34"
          alt=""
        />
        <b>
          Scopearr<span> / </span>
        </b>
      </a>
      <nav class="tabs" aria-label={t("Main navigation")}>
        <button
          class={page === "statistics" ? "active" : ""}
          aria-current={page === "statistics" ? "page" : undefined}
          onClick={openDashboard}
        >
          <ChartNoAxesColumnIncreasing size={ICON.button} />
          {t("Dashboard")}
        </button>
        {(["radarr", "sonarr"] as const).map((type) => {
          const all = instancesOf(settings, true).filter(
            (instance) => instance.type === type,
          );
          const current =
            page === "library" && service === type
              ? new URLSearchParams(filters[type]).get("instance") || ""
              : undefined;
          const Icon = type === "radarr" ? Film : Tv;
          const items: NavMenuItem[] = [
            ...(all.length > 1
              ? [
                  {
                    key: "all",
                    label: t(
                      type === "radarr" ? "All movies" : "All TV series",
                    ),
                    icon: <Icon size={ICON.button} />,
                    active: current === "",
                    select: () => openLibrary(type, ""),
                  },
                ]
              : []),
            ...all.map((instance) => ({
              key: instance.id,
              label: instanceLabel(instance),
              icon: <Icon size={ICON.button} />,
              // A single instance is the whole library.
              active:
                all.length > 1
                  ? current === instance.id
                  : current !== undefined,
              select: () =>
                openLibrary(type, all.length > 1 ? instance.id : ""),
            })),
          ];
          const label = t(type === "radarr" ? "Movies" : "TV series");
          return items.length ? (
            <NavMenu
              key={type}
              icon={<Icon size={ICON.button} />}
              label={label}
              items={items}
            />
          ) : (
            <button
              key={type}
              class={current !== undefined ? "active" : ""}
              aria-current={current !== undefined ? "page" : undefined}
              onClick={() => openLibrary(type, "")}
            >
              <Icon size={ICON.label} /> {label}
            </button>
          );
        })}
        {toolItems.length > 0 && (
          <NavMenu
            icon={<Wrench size={ICON.button} />}
            label={t("Tools")}
            badge={toolItems.reduce((sum, item) => sum + (item.badge || 0), 0)}
            badgeLabel={t("Tools, {count} open jobs", {
              count: toolItems.reduce(
                (sum, item) => sum + (item.badge || 0),
                0,
              ),
            })}
            items={toolItems}
          />
        )}
      </nav>
      <div class="header-actions">
        <button
          class="icon-button"
          aria-label={theme === "dark" ? t("Light theme") : t("Dark theme")}
          onClick={toggleTheme}
          title={theme === "dark" ? t("Light theme") : t("Dark theme")}
        >
          {theme === "dark" ? (
            <Sun size={ICON.button} />
          ) : (
            <Moon size={ICON.button} />
          )}
        </button>
        <button
          class={"icon-button" + (page === "settings" ? " active" : "")}
          aria-label={t("Settings")}
          aria-current={page === "settings" ? "page" : undefined}
          onClick={openSettings}
          title={t("Settings")}
        >
          <SettingsIcon size={ICON.button} />
        </button>
        <button
          class="icon-button"
          aria-label={t("Sign out")}
          onClick={signOut}
          title={t("Sign out")}
        >
          <LogOut size={ICON.button} />
        </button>
      </div>
    </header>
  );
}
