import { jobsSummary } from "./frame-status";
import { instanceLabel, instancesOf } from "./instances";
import { SETTINGS_SECTIONS } from "./router";
import type { NavTarget, Route, SettingsSectionId, ToolView } from "./router";
import { TOOLS } from "./tool-route";
import type { Service, Settings, Status } from "./types";

// The frame's navigation (sidebar, rail flyouts, tab bar, breadcrumbs and
// the page key) as pure functions of the route, the settings and the
// status. Entries name a NavTarget only: its href and its guarded action
// come from useAppNavigation (linkHref, openLink). Labels are catalog keys
// passed through translate; instance names are the user's own.

export type NavIcon =
  "dashboard" | "movies" | "series" | "mux" | "disks" | "files" | "settings";
export type NavEntry = {
  key: string;
  label: string;
  icon?: NavIcon;
  target: NavTarget;
  current: boolean;
  count?: number;
  badge?: number;
};
// group is set when the node has children (an arrow in the expanded
// sidebar, a flyout in the rail). parentOfCurrent: the route is in the
// node's area, but the node itself is not the current entry.
export type NavNode = NavEntry & {
  group?: "movies" | "series" | "settings";
  children: NavEntry[];
  parentOfCurrent: boolean;
};
export type NavSection = {
  key: "library" | "tools" | "system";
  label: string;
  nodes: NavNode[];
};
type NavInput = {
  route: Route;
  settings: Settings | null;
  status: Status;
  translate: (key: string) => string;
};

// The labels of the frame, once. The tools and their order come from TOOLS
// (tool-route.ts); the settings areas and their order from the router.
const LIBRARIES: Record<Service, { key: "movies" | "series"; label: string }> =
  {
    radarr: { key: "movies", label: "Movies" },
    sonarr: { key: "series", label: "TV series" },
  };
export const TOOL_LABELS: Record<ToolView, string> = {
  mux: "Muxing",
  disks: "Disk placement",
  files: "Files & permissions",
};
const AREA_LABELS: Record<SettingsSectionId, string> = {
  connections: "Services",
  appearance: "Display",
  widgets: "Widgets",
  custom: "Custom tags",
  recognition: "Tag rules",
  system: "System",
};

// The instance filter of the library the route shows, else "".
function instanceFilter(route: Route, service: Service) {
  return route.view === "library" && route.service === service
    ? new URLSearchParams(route.filters).get("instance") || ""
    : "";
}

function libraryNode(
  { route, settings, status, translate }: NavInput,
  service: Service,
): NavNode {
  const { key, label } = LIBRARIES[service];
  const shown = route.view === "library" && route.service === service,
    filter = instanceFilter(route, service);
  const ofService = (enabledOnly: boolean) =>
    instancesOf(settings, enabledOnly).filter(
      (instance) => instance.type === service,
    );
  const count = (ids: string[]) =>
    ids.reduce((sum, id) => sum + (status.sync?.[id]?.count || 0), 0);
  const instances = ofService(true);
  // Sub-entries only for more than one instance; one is the whole library.
  const children: NavEntry[] =
    instances.length > 1
      ? instances.map((instance) => ({
          key: key + ":" + instance.id,
          label: instanceLabel(instance),
          target: { view: "library", service, instance: instance.id },
          current: shown && filter === instance.id,
          count: count([instance.id]),
        }))
      : [];
  const current = shown && (!children.length || !filter);
  return {
    key,
    label: translate(label),
    icon: key,
    target: { view: "library", service, instance: "" },
    current,
    // The library's own count: outside the demo only enabled instances.
    count: count(ofService(!status.demo).map((instance) => instance.id)),
    ...(children.length ? { group: key } : {}),
    children,
    parentOfCurrent: shown && !current,
  };
}

function toolNodes({ route, status, translate }: NavInput): NavNode[] {
  return jobsSummary(status).tools.map((tool) => ({
    key: tool.view,
    label: translate(TOOL_LABELS[tool.view]),
    icon: tool.view,
    target: { view: tool.view },
    current: route.view === tool.view,
    badge: tool.open,
    children: [],
    parentOfCurrent: false,
  }));
}

function settingsNode({ route, translate }: NavInput): NavNode {
  const shown = route.view === "settings";
  return {
    key: "settings",
    label: translate("Settings"),
    icon: "settings",
    target: { view: "settings", section: "connections" },
    current: false,
    group: "settings",
    children: SETTINGS_SECTIONS.map((section) => ({
      key: "settings:" + section,
      label: translate(AREA_LABELS[section]),
      target: { view: "settings", section },
      current: shown && route.section === section,
    })),
    parentOfCurrent: shown,
  };
}

// Library (Dashboard, Movies, TV series), Tools (only the visible ones; the
// section is left out without any) and System (Settings with its areas).
export function navModel(input: NavInput): NavSection[] {
  const { route, translate } = input;
  const tools = toolNodes(input);
  return [
    {
      key: "library",
      label: translate("Library"),
      nodes: [
        {
          key: "dashboard",
          label: translate("Dashboard"),
          icon: "dashboard",
          target: { view: "statistics" },
          current: route.view === "statistics",
          children: [],
          parentOfCurrent: false,
        },
        libraryNode(input, "radarr"),
        libraryNode(input, "sonarr"),
      ],
    },
    ...(tools.length
      ? [{ key: "tools" as const, label: translate("Tools"), nodes: tools }]
      : []),
    { key: "system", label: translate("System"), nodes: [settingsNode(input)] },
  ];
}

// An option of quick search (E18): a page or a title with its icon, its
// name, its context on the right and its target.
export type SearchOption = {
  key: string;
  label: string;
  meta: string;
  icon?: NavIcon;
  target: NavTarget;
};
// Quick search's pages: the sidebar's entries in their order with their
// section as context; a sub-entry has its group's icon and name. Settings
// lists its areas only, as its own entry opens the first one.
export function searchPages(sections: NavSection[]): SearchOption[] {
  const option = (
    entry: NavEntry,
    icon: NavIcon | undefined,
    meta: string,
  ) => ({
    key: entry.key,
    label: entry.label,
    meta,
    icon,
    target: entry.target,
  });
  return sections.flatMap((section) =>
    section.nodes.flatMap((node) => [
      ...(node.group === "settings"
        ? []
        : [option(node, node.icon, section.label)]),
      ...node.children.map((child) => option(child, node.icon, node.label)),
    ]),
  );
}

// ["Scopearr", section, page, (instance | settings area)]. Settings are a
// page of their own: ["Scopearr", "Settings", area]. The crumbs follow the
// route, so a hidden tool keeps its name; an instance the settings do not
// know is not echoed from the URL.
export function breadcrumbs({
  route,
  settings,
  translate,
}: NavInput): string[] {
  const home = "Scopearr";
  switch (route.view) {
    case "statistics":
      return [home, translate("Library"), translate("Dashboard")];
    case "library": {
      const id = instanceFilter(route, route.service);
      const instance = id
        ? instancesOf(settings).find(
            (candidate) =>
              candidate.id === id && candidate.type === route.service,
          )
        : undefined;
      return [
        home,
        translate("Library"),
        translate(LIBRARIES[route.service].label),
        ...(instance ? [instanceLabel(instance)] : []),
      ];
    }
    case "settings":
      return [
        home,
        translate("Settings"),
        translate(AREA_LABELS[route.section]),
      ];
    default:
      return [home, translate("Tools"), translate(TOOL_LABELS[route.view])];
  }
}

// The phone tab bar: Dashboard, Movies and TV series as tabs (current for
// their whole area), the visible tools for the Tools menu with their open
// jobs as the tab's badge, and More (the drawer) for settings.
export function tabBarModel(input: NavInput): {
  tabs: NavEntry[];
  tools: NavEntry[];
  toolsBadge: number;
  toolsCurrent: boolean;
  moreCurrent: boolean;
} {
  const sections = navModel(input);
  const entry = ({
    children: _children,
    group: _group,
    parentOfCurrent,
    ...node
  }: NavNode): NavEntry => ({
    ...node,
    current: node.current || parentOfCurrent,
  });
  const tools =
    sections.find((section) => section.key === "tools")?.nodes.map(entry) ?? [];
  return {
    tabs: sections[0].nodes.map(entry),
    tools,
    toolsBadge: tools.reduce((sum, tool) => sum + (tool.badge || 0), 0),
    toolsCurrent: Object.hasOwn(TOOLS, input.route.view),
    moreCurrent: input.route.view === "settings",
  };
}

// Changes only with the page: the view, the library's service, the tool or
// the settings area. Filters, instance, page, sort, tab and log query keep
// it (E30: a page change scrolls to the top and fades the content in).
export function pageKey(route: Route): string {
  switch (route.view) {
    case "library":
      return "library:" + route.service;
    case "settings":
      return "settings:" + route.section;
    default:
      return route.view;
  }
}

// Whether a page still stands on the transition sheet (docs/STYLEGUIDE.md,
// Part 1, 10.1): its 1.7.0 content needs it until its Phase 5 rebuild. The
// libraries and the dashboard are rebuilt (Phase 5a), Muxing, Disk
// placement and Files & permissions in Phase 5b; only the settings stay.
export function sheetPage(route: Route): boolean {
  return (
    route.view !== "library" &&
    route.view !== "statistics" &&
    route.view !== "mux" &&
    route.view !== "disks" &&
    route.view !== "files"
  );
}
