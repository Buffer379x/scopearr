import { LogOut, Moon, Sun } from "lucide-preact";
import { lazy, Suspense } from "preact/compat";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";

import { api } from "../api";
import { setTheme, storedTheme, type Theme } from "../appearance";
import { jobsSummary, syncSummary } from "../frame-status";
import { t } from "../i18n";
import { breadcrumbs, navModel, pageKey, tabBarModel } from "../nav-model";
import type { NavTarget } from "../router";
import { applyInterfaceTheme } from "../themes";
import type { Settings, Status } from "../types";
import { clock, date, ICON } from "../ui";

import type { AppNavigation } from "../hooks/useAppNavigation";
import type { ToolRoute } from "../hooks/useToolPageState";
import { useAppData } from "./AppDataProvider";
import { useLanguageRegistry } from "../hooks/useLanguageRegistry";
import { useLibraryState } from "../hooks/useLibraryState";
import { useScrolled } from "../hooks/useScrolled";
import { useSidebar } from "../hooks/useSidebar";
import { LibraryDialogs, LibraryPage } from "./LibraryPage";
import { LoadingScreen } from "./LoadingScreen";
import { PageTitleContext } from "./PageHeader";
import { StatisticsPage } from "./StatisticsPage";
import { Popover } from "./frame/Popover";
import { Sidebar } from "./frame/Sidebar";
import { SyncStatus } from "./frame/SyncStatus";
import { TabBar } from "./frame/TabBar";
import { Topbar } from "./frame/Topbar";
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

const HOME: NavTarget = { view: "statistics" };
// A page change fades the content in (JavaScript constants, an exception in
// docs/STYLEGUIDE.md, Part 1, 4).
const PAGE_FADE = 150,
  PAGE_SHIFT = 4;

// The frame's popovers: the sync display, the bell and quick search. Their
// overlays arrive in Tasks 11–13; until then each opens an empty popover
// named after its trigger, so the triggers already carry their final popup
// attributes (E15).
type Overlay = {
  key: "sync" | "jobs" | "search";
  anchor: HTMLElement;
  placement: "bottom-end" | "right-end";
};

// The app in the frame (docs/STYLEGUIDE.md, Part 1, 10.1): the skip control,
// the sidebar, the frame with band, topbar and main (the page header slot on
// the band, then the page on the transition sheet), the phone tab bar and
// the library dialogs. Navigation comes only from the route; every link is
// the guarded openLink. The frame paints after the first settings answer,
// so instance entries never arrive after the first paint.
export function AppShell({
  status,
  refresh,
  navigation,
}: {
  status: Status;
  refresh: () => Promise<void>;
  navigation: AppNavigation;
}) {
  // Language names and flags outside the core appear once the registry loads.
  useLanguageRegistry();
  const data = useAppData();
  const {
    settings,
    settingsReady,
    setSettings,
    loadSettings,
    loadPresets,
    customTags,
    loadCustom,
  } = data;
  const {
    view,
    settingsOpen,
    settingsSection,
    settingsMount,
    route,
    revision,
    fromHistory,
    replaceRoute,
    setSettingsDirty,
    setSectionGuard,
    openLink,
    linkHref,
    openFiles,
    openSettings,
    canLeaveRules,
  } = navigation;
  // Tool pages start again from the route on a new revision.
  const toolRoute: ToolRoute = {
    query: "query" in route ? route.query : "",
    fromHistory,
    replace: (query) => replaceRoute({ query }),
  };
  // main.tsx applied the stored theme and band before the first render.
  const [theme, setShownTheme] = useState<Theme>(storedTheme);
  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(document.documentElement, next);
    setShownTheme(next);
  };
  useEffect(() => {
    applyInterfaceTheme(
      document.documentElement,
      settings?.interfaceTheme,
      theme,
    );
  }, [settings?.interfaceTheme, theme]);
  const signOut = async () => {
    await api("logout", "POST");
    await refresh();
  };
  const library = useLibraryState({ status, navigation, data });
  const { openDashboardFilter } = library;
  const sidebar = useSidebar();
  const scrolled = useScrolled();

  // The page header's slot on the band and the title it reports.
  const [title, setTitle] = useState("");
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const pageFrame = useMemo(() => ({ slot, setTitle }), [slot]);
  const main = useRef<HTMLElement>(null),
    content = useRef<HTMLDivElement>(null);

  // A new page (view, library, tool or settings area) starts at the top and
  // fades in; filters, pages and tabs keep the position (E30).
  const page = pageKey(route);
  const shownPage = useRef(page);
  useLayoutEffect(() => {
    if (shownPage.current === page) return;
    shownPage.current = page;
    window.scrollTo(0, 0);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    content.current?.animate(
      [
        { opacity: 0, transform: `translateY(${PAGE_SHIFT}px)` },
        { opacity: 1, transform: "none" },
      ],
      {
        duration: PAGE_FADE,
        easing: getComputedStyle(document.documentElement)
          .getPropertyValue("--ease")
          .trim(),
      },
    );
  }, [page]);

  // One overlay at a time; a trigger's second click closes its own.
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const toggle =
    (key: Overlay["key"], placement: Overlay["placement"] = "bottom-end") =>
    (anchor: HTMLElement) =>
      setOverlay((current) =>
        current?.key === key && current.anchor === anchor
          ? null
          : { key, anchor, placement },
      );
  const overlayLabels: Record<Overlay["key"], string> = {
    sync: t("Synchronization"),
    jobs: t("Jobs"),
    search: t("Quick search"),
  };

  if (!settingsReady) return <LoadingScreen />;

  const input = { route, settings, status, translate: t };
  const summary = syncSummary(status, settings, t, date, clock);
  // Without any instance there is no sync to show.
  const sync = summary.services.length ? summary : null;
  const syncOpen = overlay?.key === "sync";
  const drawer = sidebar.drawerOpen;
  const ThemeIcon = theme === "dark" ? Sun : Moon;
  const themeLabel = theme === "dark" ? t("Light theme") : t("Dark theme");

  return (
    <PageTitleContext.Provider value={pageFrame}>
      <div class="v2-shell" data-mode={sidebar.mode}>
        <button
          type="button"
          class="v2-skip"
          onClick={() => main.current?.focus()}
        >
          {t("Skip to content")}
        </button>
        <Sidebar
          mode={sidebar.mode}
          sections={navModel(input)}
          groups={sidebar.groups}
          toggleGroup={sidebar.toggleGroup}
          toggleMode={sidebar.toggleMode}
          drawerOpen={drawer}
          closeDrawer={sidebar.closeDrawer}
          hrefOf={linkHref}
          open={openLink}
          version={status.version}
          footer={
            sync && (
              <SyncStatus
                summary={sync}
                variant="card"
                onOpen={toggle("sync", "right-end")}
                expanded={syncOpen}
              />
            )
          }
          drawerHead={
            sync && (
              <SyncStatus
                summary={sync}
                variant="row"
                onOpen={toggle("sync")}
                expanded={syncOpen}
              />
            )
          }
          drawerExtras={
            <>
              <button type="button" class="v2-nav-item" onClick={toggleTheme}>
                <span class="v2-tile" aria-hidden="true">
                  <ThemeIcon size={ICON.button} />
                </span>
                <span class="v2-nav-text">{themeLabel}</span>
              </button>
              <button type="button" class="v2-nav-item" onClick={signOut}>
                <span class="v2-tile" aria-hidden="true">
                  <LogOut size={ICON.button} />
                </span>
                <span class="v2-nav-text">{t("Sign out")}</span>
              </button>
            </>
          }
        />
        <div class="v2-frame" inert={drawer}>
          <div class="v2-band" aria-hidden="true" />
          <Topbar
            mode={sidebar.mode}
            crumbs={breadcrumbs(input)}
            title={title}
            scrolled={scrolled}
            demo={status.demo}
            sync={sync}
            jobs={jobsSummary(status)}
            theme={theme}
            homeHref={linkHref(HOME)}
            openHome={() => void openLink(HOME)}
            toggleTheme={toggleTheme}
            signOut={signOut}
            onSync={toggle("sync")}
            onJobs={toggle("jobs")}
            onSearch={toggle("search")}
            open={overlay?.key ?? null}
          />
          <main
            id="main"
            class="v2-main"
            data-sheet=""
            tabIndex={-1}
            ref={main}
          >
            <div class="v2-page-slot" ref={setSlot} />
            <div class="v2-view" ref={content}>
              <Suspense fallback={null}>
                {settingsOpen && settings ? (
                  <SettingsPage
                    key={settingsMount}
                    customTags={customTags}
                    customChanged={async () => {
                      const tags = await loadCustom();
                      await loadSettings();
                      await loadPresets();
                      await refresh();
                      return tags;
                    }}
                    settings={settings}
                    section={settingsSection}
                    registerSectionGuard={setSectionGuard}
                    tab={route.view === "settings" ? route.tab : ""}
                    setTab={(tab) => replaceRoute({ tab })}
                    logQuery={route.view === "settings" ? route.query : ""}
                    setLogQuery={(query) => replaceRoute({ tab: "log", query })}
                    revision={revision}
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
                    key={revision}
                    route={toolRoute}
                    settings={settings}
                    changed={async () => {
                      setSettings(await api<Settings>("settings"));
                      await refresh();
                    }}
                    setup={async (service = "mux") => {
                      if (await canLeaveRules())
                        openSettings("connections", service);
                    }}
                  />
                ) : view === "disks" ? (
                  <DiskPlacementPage
                    key={revision}
                    route={toolRoute}
                    openFiles={async (path) => {
                      if (await canLeaveRules()) openFiles(path);
                    }}
                    settings={settings}
                    changed={async () => {
                      setSettings(await api<Settings>("settings"));
                      await refresh();
                    }}
                    setup={async () => {
                      if (await canLeaveRules())
                        openSettings("connections", "mux");
                    }}
                  />
                ) : view === "mux" ? (
                  <MuxPage
                    key={revision}
                    route={toolRoute}
                    settings={settings}
                    changed={refresh}
                    names={status.serviceNames || {}}
                    installed={!!status.mux?.installed}
                    setup={async () => {
                      if (await canLeaveRules())
                        openSettings("connections", "mux");
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
            </div>
          </main>
        </div>
        <TabBar
          model={tabBarModel(input)}
          hrefOf={linkHref}
          open={openLink}
          moreOpen={drawer}
          openMore={sidebar.openDrawer}
          inert={drawer}
        />
        {overlay && (
          <Popover
            key={overlay.key}
            anchor={overlay.anchor}
            placement={overlay.placement}
            role="dialog"
            label={overlayLabels[overlay.key]}
            close={() =>
              setOverlay((current) => (current === overlay ? null : current))
            }
          >
            {null}
          </Popover>
        )}
        <LibraryDialogs
          status={status}
          refresh={refresh}
          settings={settings}
          library={library}
          navigation={navigation}
        />
      </div>
    </PageTitleContext.Provider>
  );
}
