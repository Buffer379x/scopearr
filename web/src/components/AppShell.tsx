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
import { topmostDialog } from "../dialog-stack";
import { openLog } from "../event-log";
import { jobsSummary, syncSummary } from "../frame-status";
import { t } from "../i18n";
import { isSearchKey } from "../nav-link";
import {
  breadcrumbs,
  navModel,
  pageKey,
  searchPages,
  sheetPage,
  tabBarModel,
} from "../nav-model";
import type { NavTarget } from "../router";
import { applyInterfaceTheme } from "../themes";
import type { Settings, Status } from "../types";
import { clock, date, ICON } from "../ui";

import type { AppNavigation } from "../hooks/useAppNavigation";
import type { ToolRoute } from "../hooks/useToolPageState";
import { useAppData } from "./AppDataProvider";
import { useLanguageRegistry } from "../hooks/useLanguageRegistry";
import { useLibraryState } from "../hooks/useLibraryState";
import { useManualSync } from "../hooks/useManualSync";
import { useScrolled } from "../hooks/useScrolled";
import { useSidebar } from "../hooks/useSidebar";
import { LibraryDialogs, LibraryPage } from "./LibraryPage";
import { LoadingScreen } from "./LoadingScreen";
import { PageTitleContext } from "./PageHeader";
import { StatisticsPage } from "./StatisticsPage";
import { JobsMenu } from "./frame/JobsMenu";
import { QuickSearch } from "./frame/QuickSearch";
import { Sidebar } from "./frame/Sidebar";
import { SyncPopover } from "./frame/SyncPopover";
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

// The frame's overlays: the sync popover of the sync display (Task 11), the
// bell's jobs menu (Task 12) and quick search (Task 13), whose anchor is
// where focus returns (its trigger, or the element focused for ⌘K).
type Overlay = {
  key: "sync" | "jobs" | "search";
  anchor: HTMLElement;
  placement: "bottom-end" | "right-end";
};

// The app in the frame (docs/STYLEGUIDE.md, Part 1, 10.1): the skip control,
// the sidebar, the frame with band, topbar and main (the page header slot on
// the band, then the page, on the transition sheet while sheetPage says it
// is still 1.7.0), the phone tab bar and
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
  // The palette of the settings for the shown theme, before paint: the
  // frame's first paint and a theme change never show another palette.
  useLayoutEffect(() => {
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
  // The manual sync of the sync popover, as on System → Info.
  const manual = useManualSync(refresh);

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
  const drawer = sidebar.drawerOpen;
  // A closing drawer takes the popover of its sync row along: nothing else
  // can open while it is open (the frame and the tab bar are inert). The
  // drawer alone is the dependency although the mode is read: the mode
  // changes only with the viewport width, and that resize closes the drawer
  // (useSidebar) and every popover (Popover's resize listener) anyway.
  useEffect(() => {
    if (!drawer && sidebar.mode === "drawer") setOverlay(null);
  }, [drawer]);
  // ⌘K and Ctrl+K open quick search from anywhere, also from a field,
  // unless a modal is open: a dialog (quick search is one) or the drawer.
  useEffect(() => {
    if (!settingsReady || drawer) return;
    const shortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isSearchKey(event) || topmostDialog())
        return;
      event.preventDefault();
      // Focus returns where it was; from an open popover, which quick
      // search replaces, to its trigger: the shell's overlay's, else the
      // tab bar's expanded Tools button; from the rail's flyout, which
      // closes when focus leaves it, to its entry.
      const active = document.activeElement as HTMLElement | null;
      const popover = !!active?.closest(".v2-pop");
      const trigger = popover
        ? '.v2-tabbar [aria-expanded="true"]'
        : active?.closest(".v2-fly") &&
          '[aria-controls="v2-fly"][aria-expanded="true"]';
      const back = trigger
        ? document.querySelector<HTMLElement>(trigger)
        : active;
      setOverlay((current) => ({
        key: "search",
        anchor: (popover && current?.anchor) || back || document.body,
        placement: "bottom-end",
      }));
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [settingsReady, drawer]);

  if (!settingsReady) return <LoadingScreen />;

  const input = { route, settings, status, translate: t };
  const sections = navModel(input);
  const summary = syncSummary(status, settings, t, date, clock);
  // Without any instance there is no sync to show.
  const sync = summary.services.length ? summary : null;
  const jobs = jobsSummary(status);
  const syncOpen = overlay?.key === "sync";
  const closeOverlay = (shown: Overlay) => () =>
    setOverlay((current) => (current === shown ? null : current));
  // An overlay's link: it closes, then the target opens like every link.
  const follow = (target: NavTarget) => {
    setOverlay(null);
    void openLink(target);
  };
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
          sections={sections}
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
            jobs={jobs}
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
            data-sheet={sheetPage(route) ? "" : undefined}
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
                    summary={summary}
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
        {/* Changes of the bell's count, outside the frame that the drawer
            makes inert (E17). The demo starts no job, so its count never
            changes. */}
        {!status.demo && (
          <p class="v2-sr-only" aria-live="polite">
            {t("Tools, {count} open jobs", { count: jobs.count })}
          </p>
        )}
        {overlay?.key === "sync" && sync && (
          <SyncPopover
            anchor={overlay.anchor}
            placement={overlay.placement}
            summary={sync}
            status={status}
            demo={status.demo}
            sync={manual.sync}
            syncing={manual.syncing}
            close={closeOverlay(overlay)}
          />
        )}
        {overlay?.key === "jobs" && (
          <JobsMenu
            anchor={overlay.anchor}
            summary={jobs}
            hrefOf={linkHref}
            open={follow}
            showLog={(sources) => {
              setOverlay(null);
              openLog({ level: ["error"], source: sources });
            }}
            close={closeOverlay(overlay)}
          />
        )}
        {overlay?.key === "search" && (
          <QuickSearch
            pages={searchPages(sections)}
            hrefOf={linkHref}
            open={follow}
            close={closeOverlay(overlay)}
            anchor={overlay.anchor}
          />
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
