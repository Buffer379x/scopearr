import { openJobCount } from "../tool-table";
import { ICON } from "../ui";
import { FolderCog, HardDrive, Info, Scissors } from "lucide-preact";
import { lazy, Suspense } from "preact/compat";
import { useEffect, useState } from "preact/hooks";
import {
  writeSessionPreference,
  readPreference,
  writePreference,
} from "../browser-storage";

import { t } from "../i18n";
import { applyInterfaceTheme } from "../themes";
import type { Settings, Status } from "../types";

import { api } from "../api";
import type { AppNavigation } from "../hooks/useAppNavigation";
import { useAppData } from "./AppDataProvider";
import { useLibraryState } from "../hooks/useLibraryState";
import { disksTabVisible } from "../placement";
import { filesTabVisible } from "../filecheck";
import type { NavMenuItem } from "./NavMenu";
import { AppHeader } from "./AppHeader";
import { muxTabVisible } from "../mux-spec";
import { LibraryDialogs, LibraryPage } from "./LibraryPage";
import { StatisticsPage } from "./StatisticsPage";
const DiskPlacementPage = lazy(() =>
  import("./DiskPlacementPage").then((m) => ({ default: m.DiskPlacementPage })),
);
const FileCheckPage = lazy(() =>
  import("./FileCheckPage").then((m) => ({ default: m.FileCheckPage })),
);
const MuxPage = lazy(() =>
  import("./MuxPage").then((m) => ({ default: m.MuxPage })),
);
const SettingsPage = lazy(() =>
  import("./SettingsPage").then((module) => ({
    default: module.SettingsPage,
  })),
);
export function AppShell({
  status,
  refresh,
  navigation,
}: {
  status: Status;
  refresh: () => Promise<void>;
  navigation: AppNavigation;
}) {
  useEffect(() => {
    const header = document.querySelector<HTMLElement>(".header");
    if (!header) return;
    const measure = () =>
      document.documentElement.style.setProperty(
        "--app-header-height",
        header.getBoundingClientRect().height + "px",
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  const data = useAppData();
  const {
    settings,
    setSettings,
    loadSettings,
    loadPresets,
    customTags,
    loadCustom,
  } = data;
  const {
    view,
    setView,
    service,
    filters,
    settingsOpen,
    settingsSection,
    setSettingsSection,
    setSettingsDirty,
    setPlacementFileSearch,
    openSettings,
    canLeaveRules,
  } = navigation;
  const [theme, setTheme] = useState(
    readPreference("scopearr-theme") || "dark",
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    writePreference("scopearr-theme", theme);
  }, [theme]);
  useEffect(() => {
    applyInterfaceTheme(
      document.documentElement,
      settings?.interfaceTheme,
      theme,
    );
  }, [settings?.interfaceTheme, theme]);
  const library = useLibraryState({ status, navigation, data });
  const { openDashboardFilter, openLibrary } = library;
  const navigationPage = settingsOpen ? "settings" : view;
  const muxBadge = muxTabVisible(status) ? openJobCount(status.mux) : 0;
  const toolItems: NavMenuItem[] = [
    ...(muxTabVisible(status)
      ? [
          {
            key: "mux",
            label: t("Muxing"),
            icon: <Scissors size={ICON.button} />,
            badge: muxBadge,
            active: navigationPage === "mux",
            select: async () => {
              if (await canLeaveRules()) setView("mux");
            },
          },
        ]
      : []),
    ...(disksTabVisible(status)
      ? [
          {
            key: "disks",
            badge: openJobCount(status.unraid),
            label: t("Disk placement"),
            icon: <HardDrive size={ICON.button} />,
            active: navigationPage === "disks",
            select: async () => {
              if (await canLeaveRules()) setView("disks");
            },
          },
        ]
      : []),
    ...(filesTabVisible(status)
      ? [
          {
            key: "files",
            badge: openJobCount(status.files),
            label: t("Files & permissions"),
            icon: <FolderCog size={ICON.button} />,
            active: navigationPage === "files",
            select: async () => {
              if (await canLeaveRules()) setView("files");
            },
          },
        ]
      : []),
  ];
  return (
    <div class="shell">
      <AppHeader
        page={navigationPage}
        service={service}
        settings={settings}
        filters={filters}
        toolItems={toolItems}
        theme={theme}
        openDashboard={async () => {
          if (await canLeaveRules()) setView("statistics");
        }}
        openLibrary={openLibrary}
        openSettings={async () => {
          if (await canLeaveRules()) openSettings();
        }}
        toggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
        signOut={async () => {
          await api("logout", "POST");
          await refresh();
        }}
      />
      {status.demo && (
        <div class="demo-bar">
          <span>
            <Info size={ICON.label} />
            {t("Demo · sample data, no connection to your services")}
          </span>
        </div>
      )}
      <main class="main">
        <Suspense fallback={null}>
          {settingsOpen && settings ? (
            <SettingsPage
              customTags={customTags}
              customChanged={async () => {
                const tags = await loadCustom();
                await loadSettings();
                await loadPresets();
                await refresh();
                return tags;
              }}
              settings={settings}
              initialSection={settingsSection}
              onSectionChange={setSettingsSection}
              onDirty={setSettingsDirty}
              refresh={refresh}
              status={status}
              demo={status.demo}
              saved={async (settings) => {
                setSettings(settings);
                await refresh();
              }}
            />
          ) : view === "files" ? (
            <FileCheckPage
              settings={settings}
              changed={async () => {
                setSettings(await api<Settings>("settings"));
                await refresh();
              }}
              setup={(service = "mux") => {
                writeSessionPreference("scopearr-service-settings", service);
                openSettings();
              }}
            />
          ) : view === "disks" ? (
            <DiskPlacementPage
              openFiles={(path) => {
                setPlacementFileSearch(true);
                writePreference(
                  "scopearr-filecheck-filters",
                  JSON.stringify({
                    q: path,
                    statuses: [],
                    targets: [],
                    kinds: [],
                  }),
                );
                writeSessionPreference("scopearr-filecheck-page", "1");
                setView("files");
              }}
              settings={settings}
              changed={async () => {
                setSettings(await api<Settings>("settings"));
                await refresh();
              }}
              setup={() => {
                writeSessionPreference("scopearr-service-settings", "mux");
                openSettings();
              }}
            />
          ) : view === "mux" ? (
            <MuxPage
              settings={settings}
              changed={refresh}
              names={status.serviceNames || {}}
              installed={!!status.mux?.installed}
              setup={() => {
                writeSessionPreference("scopearr-service-settings", "mux");
                openSettings();
              }}
            />
          ) : view === "statistics" ? (
            <StatisticsPage
              status={status}
              settings={settings}
              onFilter={openDashboardFilter}
            />
          ) : (
            <LibraryPage
              status={status}
              refresh={refresh}
              settings={settings}
              library={library}
              navigation={navigation}
            />
          )}
        </Suspense>
      </main>
      <LibraryDialogs
        status={status}
        refresh={refresh}
        settings={settings}
        library={library}
        navigation={navigation}
      />
    </div>
  );
}
