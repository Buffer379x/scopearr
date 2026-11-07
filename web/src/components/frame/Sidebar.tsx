import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import {
  ChevronDown,
  Film,
  FolderCheck,
  HardDrive,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Scissors,
  Settings,
  Tv,
  X,
} from "lucide-preact";
import { createFlyout, FLYOUT_RAIL } from "../../flyout";
import type { FlyoutInput } from "../../flyout";
import { t } from "../../i18n";
import type { NavEntry, NavIcon, NavNode, NavSection } from "../../nav-model";
import type { NavTarget } from "../../router";
import type { SidebarGroups, SidebarMode } from "../../sidebar-state";
import { count, ICON } from "../../ui";
import { BrandMark } from "./BrandMark";
import { NavLink } from "./NavLink";
import { FLYOUT_ID, SidebarFlyout } from "./SidebarFlyout";
import type { FlyoutContent } from "./SidebarFlyout";

export const SIDEBAR_ID = "v2-sidebar";
const HOME: NavTarget = { view: "statistics" };
// The icon of each nav entry, shared with the tab bar.
export const NAV_ICONS: Record<NavIcon, typeof Film> = {
  dashboard: LayoutDashboard,
  movies: Film,
  series: Tv,
  mux: Scissors,
  disks: HardDrive,
  files: FolderCheck,
  settings: Settings,
};
// The rail flyout's key for the expand button (a label-only flyout).
const TOGGLE = "toggle";

// Elements that take focus with Tab, as far as they are shown. A hidden
// element (visibility: hidden) keeps its boxes but takes no focus.
const focusables = (container: HTMLElement | null) =>
  [
    ...(container?.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled])",
    ) ?? []),
  ].filter(
    (element) =>
      element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility === "visible" &&
      !element.closest("[inert]"),
  );

// The sidebar (docs/STYLEGUIDE.md, Part 1, 10.1) in one of three modes:
// expanded, the rail with its flyout, or the drawer on phones. Every entry
// comes from the nav model; its href from hrefOf and its click from open
// (both from useAppNavigation). Groups open only by their arrow (Settings:
// its own button). The rail keeps every entry mounted and feeds the flyout
// machine (flyout.ts) with real pointer, focus and key events only.
export function Sidebar({
  mode,
  sections,
  groups,
  toggleGroup,
  toggleMode,
  drawerOpen,
  closeDrawer,
  hrefOf,
  open,
  version,
  footer,
  drawerHead,
  drawerExtras,
}: {
  mode: SidebarMode;
  sections: NavSection[];
  groups: SidebarGroups;
  toggleGroup(group: keyof SidebarGroups): void;
  toggleMode(): void;
  drawerOpen: boolean;
  closeDrawer(): void;
  hrefOf(target: NavTarget): string;
  open(target: NavTarget): void;
  version: string;
  // The expanded sidebar's footer (the sync card).
  footer?: ComponentChildren;
  // Below the brand of the drawer (the sync row).
  drawerHead?: ComponentChildren;
  // At the end of the drawer's navigation (theme and sign out).
  drawerExtras?: ComponentChildren;
}) {
  const rail = mode === "rail",
    drawer = mode === "drawer",
    shown = drawer && drawerOpen;
  const root = useRef<HTMLDivElement>(null),
    close = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null);

  // The rail flyout: the machine on timers, the entry element of each item
  // (from its own events, for placement and focus return), the last pointer
  // (a tap opens a group first) and the content shown last (it stays while
  // the flyout fades out).
  const [fly, setFly] = useState(FLYOUT_RAIL);
  const machine = useRef<ReturnType<typeof createFlyout> | null>(null);
  machine.current ??= createFlyout(setFly);
  const send = (input: FlyoutInput) => machine.current!.send(input);
  const anchors = useRef<Map<string, HTMLElement>>(new Map()),
    pointer = useRef(""),
    last = useRef<FlyoutContent | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const visible = rail && (fly.phase === "open" || fly.phase === "closing");

  const nodeList = sections.flatMap((section) => section.nodes);
  const keys = [
    ...nodeList.map((node) => node.key),
    ...(drawer ? [] : [TOGGLE]),
  ];
  // The shown page as far as the sidebar marks it.
  const page = [
    ...nodeList
      .flatMap((node) => [node, ...node.children])
      .filter((entry) => entry.current)
      .map((entry) => entry.key),
    ...nodeList
      .filter((node) => node.parentOfCurrent)
      .map((node) => node.key + "^"),
  ].join(" ");
  const shownItem = () => {
    const item = machine.current!.state().item;
    return item ? anchors.current.get(item) : undefined;
  };
  const inside = (node: Node | null) =>
    !!node &&
    (!!root.current?.contains(node) || !!panel.current?.contains(node));
  const hovering = () =>
    !!panel.current?.matches(":hover") || !!root.current?.matches(":hover");

  useEffect(() => () => machine.current!.stop(), []);
  // A mode change leaves no rail focus or flyout behind.
  useEffect(() => {
    send({ type: "blur" });
    send({ type: "dismiss" });
  }, [mode]);
  // A page change closes the flyout and the drawer.
  const lastPage = useRef(page);
  useEffect(() => {
    if (lastPage.current === page) return;
    lastPage.current = page;
    send({ type: "dismiss" });
    if (shown) closeDrawer();
  }, [page]);
  // An entry that leaves (a tool the status hides) takes its focus and its
  // flyout along: the machine clears its focus only on blur.
  const keyList = keys.join(" ");
  useEffect(() => {
    if (fly.focused !== null && !keys.includes(fly.focused))
      send({ type: "blur" });
    if (fly.item !== null && !keys.includes(fly.item))
      send({ type: "dismiss" });
  }, [keyList, fly]);
  // A resize closes the flyout.
  useEffect(() => {
    if (!rail) return;
    const dismiss = () => send({ type: "dismiss" });
    window.addEventListener("resize", dismiss);
    return () => window.removeEventListener("resize", dismiss);
  }, [rail]);
  // While it shows: a press outside rail and flyout closes it, Escape steps
  // back to its entry.
  useEffect(() => {
    if (!visible) return;
    const outside = (event: Event) => {
      if (!inside(event.target as Node)) send({ type: "dismiss" });
    };
    // Only for focus in rail or flyout, or nowhere (body): elsewhere, such
    // as in a dialog, Escape stays the page's.
    const escape = (event: KeyboardEvent) => {
      const active = document.activeElement;
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (active && active !== document.body && !inside(active)) return;
      event.preventDefault();
      back();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
    };
  }, [visible]);
  // The open drawer takes focus on its close button.
  useLayoutEffect(() => {
    if (shown) close.current?.focus({ preventScroll: true });
  }, [shown]);

  // ←, Escape: close as a step back; focus in the flyout returns to the entry.
  const back = () => {
    const anchor = shownItem(),
      active = document.activeElement;
    const focused = !!active && (inside(active) || active === anchor);
    send({ type: "dismiss", back: true });
    if (focused) anchor?.focus();
  };
  // Tab in the flyout: close and go on from its entry (Shift: to the entry).
  const tab = (backward: boolean) => {
    const anchor = shownItem();
    send({ type: "dismiss" });
    if (!anchor) return;
    const list = focusables(root.current);
    (backward ? anchor : (list[list.indexOf(anchor) + 1] ?? anchor)).focus();
  };
  // A flyout entry: close as a step back, then open its target. Keyboard
  // focus goes back to the rail entry, a pointer's focus is dropped.
  const pick = (target: NavTarget) => {
    const anchor = shownItem(),
      active = document.activeElement as HTMLElement | null;
    const held = !!active && !!panel.current?.contains(active);
    send({ type: "dismiss", back: true });
    if (held && active!.matches(":focus-visible")) anchor?.focus();
    else if (held) active!.blur();
    open(target);
  };
  const focusOut = (next: Node | null) => {
    if (!inside(next) && !hovering()) send({ type: "dismiss" });
  };
  const press = (key: string, element: HTMLElement, focus: boolean) => {
    anchors.current.set(key, element);
    send({ type: "press", item: key });
    if (focus) setFocusRequest((request) => request + 1);
  };
  // The events of a rail entry. Outside the rail they send nothing.
  const railEvents = (key: string, group: boolean) => ({
    onPointerEnter(event: PointerEvent) {
      if (!rail || event.pointerType === "touch") return;
      anchors.current.set(key, event.currentTarget as HTMLElement);
      send({ type: "enter", item: key });
    },
    onPointerLeave(event: PointerEvent) {
      if (rail && event.pointerType !== "touch") send({ type: "leave" });
    },
    onPointerDown(event: PointerEvent) {
      pointer.current = event.pointerType;
      if (rail) anchors.current.set(key, event.currentTarget as HTMLElement);
    },
    onFocus(event: FocusEvent) {
      const element = event.currentTarget as HTMLElement;
      if (!rail || !element.matches(":focus-visible")) return;
      anchors.current.set(key, element);
      send({ type: "focus", item: key });
    },
    onBlur() {
      if (rail) send({ type: "blur" });
    },
    onKeyDown(event: KeyboardEvent) {
      pointer.current = "keyboard";
      if (!rail || !group || event.key !== "ArrowRight") return;
      event.preventDefault();
      press(key, event.currentTarget as HTMLElement, true);
    },
  });
  // A link's plain click. In the rail the first tap on a group opens its
  // flyout; otherwise the flyout closes as a step back and the drawer closes.
  const go = (entry: NavEntry, group: boolean) => () => {
    const state = machine.current!.state();
    const showing = state.phase === "open" || state.phase === "closing";
    if (
      rail &&
      group &&
      pointer.current === "touch" &&
      !(showing && state.item === entry.key)
    ) {
      send({ type: "press", item: entry.key });
      return;
    }
    if (rail) send({ type: "dismiss", back: true });
    if (shown) closeDrawer();
    open(entry.target);
  };

  // The drawer: Escape closes it, Tab stays inside.
  const keydown = (event: KeyboardEvent) => {
    if (!shown) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeDrawer();
      return;
    }
    if (event.key !== "Tab") return;
    const list = focusables(root.current);
    if (!list.length) return;
    const edge = event.shiftKey ? list[0] : list[list.length - 1];
    if (document.activeElement !== edge) return;
    event.preventDefault();
    (event.shiftKey ? list[list.length - 1] : list[0]).focus();
  };
  // The rail never scrolls sideways (focus or a script could move it).
  const unscroll = (event: Event) => {
    const element = event.currentTarget as HTMLElement;
    if (element.scrollLeft) element.scrollLeft = 0;
  };

  const text = rail ? "v2-nav-text v2-sr-only" : "v2-nav-text";
  const toggleLabel =
    mode === "expanded" ? t("Collapse navigation") : t("Expand navigation");
  const ToggleIcon = mode === "expanded" ? PanelLeftClose : PanelLeftOpen;

  const renderNode = (node: NavNode) => {
    const Icon = NAV_ICONS[node.icon ?? "dashboard"];
    const group = node.children.length ? node.group : undefined;
    const subs = group && "v2-nav-sub-" + group;
    const flyOpen = visible && fly.item === node.key;
    const number = node.badge || node.count;
    const tile = (
      <span
        class={
          node.current || node.parentOfCurrent
            ? "v2-tile v2-tile--grad"
            : "v2-tile"
        }
        aria-hidden="true"
      >
        <Icon size={ICON.button} />
        {rail && !!node.badge && (
          <span class="v2-plaque">{count(node.badge)}</span>
        )}
      </span>
    );
    const label = <span class={text}>{node.label}</span>;
    const parent = node.parentOfCurrent ? "" : undefined;
    const item =
      group === "settings" ? (
        <button
          type="button"
          class="v2-nav-item"
          data-parent={parent}
          aria-expanded={rail ? flyOpen : groups.settings}
          aria-controls={rail ? FLYOUT_ID : subs}
          {...railEvents(node.key, true)}
          onClick={(event) => {
            if (rail) press(node.key, event.currentTarget, event.detail === 0);
            else toggleGroup("settings");
          }}
        >
          {tile}
          {label}
          {!rail && <ChevronDown size={ICON.label} class="v2-nav-chevron" />}
        </button>
      ) : (
        <NavLink
          class="v2-nav-item"
          href={hrefOf(node.target)}
          current={node.current}
          open={go(node, !!group)}
          data-parent={parent}
          aria-expanded={rail && group ? flyOpen : undefined}
          aria-controls={rail && group ? FLYOUT_ID : undefined}
          {...railEvents(node.key, !!group)}
        >
          {tile}
          {label}
          {!rail && !!number && (
            <span class="v2-count v2-count--on" aria-hidden="true">
              {count(number)}
            </span>
          )}
        </NavLink>
      );
    return (
      <div key={node.key} class="v2-nav-node">
        {group && group !== "settings" ? (
          <div class="v2-nav-row">
            {item}
            {/* The rail hides the arrow: no box, no focus. */}
            {!rail && (
              <button
                type="button"
                class="v2-icon-btn v2-icon-btn--sm v2-nav-caret"
                aria-label={t("Instances")}
                title={t("Instances")}
                aria-expanded={groups[group]}
                aria-controls={subs}
                onClick={() => toggleGroup(group)}
              >
                <ChevronDown size={ICON.button} class="v2-nav-chevron" />
              </button>
            )}
          </div>
        ) : (
          item
        )}
        {group && (
          <div
            class="v2-nav-subs"
            id={subs}
            data-open={groups[group] ? "" : undefined}
            inert={rail || !groups[group]}
          >
            <ul class="v2-nav-list">
              {node.children.map((child) => (
                <li key={child.key}>
                  <NavLink
                    class="v2-nav-sub"
                    href={hrefOf(child.target)}
                    current={child.current}
                    open={go(child, false)}
                  >
                    <span class="v2-nav-text">{child.label}</span>
                    {!!child.count && (
                      <span class="v2-nav-meta" aria-hidden="true">
                        {count(child.count)}
                      </span>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  };

  // What the flyout shows: the group or the label of the machine's item.
  const flyNode = nodeList.find((node) => node.key === fly.item);
  const content: FlyoutContent | null =
    fly.item === TOGGLE
      ? { key: TOGGLE, label: toggleLabel }
      : flyNode
        ? {
            key: flyNode.key,
            label: flyNode.label,
            ...(flyNode.children.length
              ? {
                  head: flyNode.group === "settings" ? undefined : flyNode,
                  entries: flyNode.children,
                }
              : {}),
          }
        : null;
  if (content) last.current = content;

  return (
    <>
      <div
        ref={root}
        id={SIDEBAR_ID}
        class="v2-sidebar"
        data-mode={mode}
        data-open={shown ? "" : undefined}
        role={shown ? "dialog" : undefined}
        aria-modal={shown ? "true" : undefined}
        aria-label={shown ? t("Main navigation") : undefined}
        onKeyDown={keydown}
        onFocusOut={(event) => {
          if (rail) focusOut(event.relatedTarget as Node | null);
        }}
        onScroll={unscroll}
      >
        <div class="v2-sidebar-inner" onScroll={unscroll}>
          <div class="v2-brand">
            <NavLink
              class="v2-brand-home"
              href={hrefOf(HOME)}
              label={t("Scopearr home")}
              open={() => {
                if (shown) closeDrawer();
                open(HOME);
              }}
            >
              <BrandMark class="v2-brand-mark" />
              <span class="v2-brand-word">
                <span class="v2-brand-name">Scopearr</span>
              </span>
            </NavLink>
            {/* Beside the link, where it was in it: the link's visible text
                is the start of its name (WCAG 2.5.3, Label in Name). */}
            <span class="v2-brand-version">{version}</span>
            {drawer && (
              <button
                ref={close}
                type="button"
                class="v2-icon-btn"
                aria-label={t("Close")}
                title={t("Close")}
                onClick={closeDrawer}
              >
                <X size={ICON.button} />
              </button>
            )}
          </div>
          {drawer && drawerHead}
          <div class="v2-nav-sep" />
          <nav class="v2-nav" aria-label={t("Main navigation")}>
            {sections.flatMap((section) => [
              <p key={section.key} class="v2-nav-group">
                <span class={text}>{section.label}</span>
              </p>,
              ...section.nodes.map(renderNode),
            ])}
            {drawer && drawerExtras}
          </nav>
          {!drawer && (
            <div class="v2-nav-bottom">
              {mode === "expanded" && footer}
              <button
                type="button"
                class="v2-nav-item v2-nav-toggle"
                aria-expanded={mode === "expanded"}
                aria-controls={SIDEBAR_ID}
                {...railEvents(TOGGLE, false)}
                onClick={toggleMode}
              >
                <span class="v2-tile v2-tile--line" aria-hidden="true">
                  <ToggleIcon size={ICON.button} />
                </span>
                <span class={text}>{toggleLabel}</span>
              </button>
            </div>
          )}
        </div>
      </div>
      {rail && (
        <SidebarFlyout
          panel={panel}
          content={content ?? last.current}
          visible={visible}
          anchor={fly.item ? (anchors.current.get(fly.item) ?? null) : null}
          hrefOf={hrefOf}
          pick={pick}
          send={send}
          back={back}
          tab={tab}
          focusOut={(next) => {
            send({ type: "focusout" });
            focusOut(next);
          }}
          focusRequest={focusRequest}
        />
      )}
      {drawer && (
        <div
          class="v2-scrim"
          data-open={shown ? "" : undefined}
          aria-hidden="true"
          onClick={closeDrawer}
        />
      )}
    </>
  );
}
