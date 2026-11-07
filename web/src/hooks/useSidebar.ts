import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import {
  readSidebarGroups,
  readSidebarPreference,
  sidebarMode,
  writeSidebarGroups,
  writeSidebarPreference,
} from "../sidebar-state";
import type { SidebarGroups, SidebarMode } from "../sidebar-state";

// The sidebar's state for the frame (docs/STYLEGUIDE.md, Part 1, 10.1): the
// mode from the viewport width and the stored choice, the open groups, and
// the drawer. The width is read with matchMedia at the thresholds of
// sidebarMode, as the CSS reads it; no element is measured.
const PHONE = "(max-width: 739px)",
  WIDE = "(min-width: 1600px)";
// A width with the viewport's mode: 739 (phone), 1600 (wide) or 740.
const viewportWidth = () =>
  window.matchMedia(PHONE).matches
    ? 739
    : window.matchMedia(WIDE).matches
      ? 1600
      : 740;

export function useSidebar(): {
  mode: SidebarMode;
  toggleMode(): void;
  groups: SidebarGroups;
  toggleGroup(group: keyof SidebarGroups): void;
  drawerOpen: boolean;
  openDrawer(trigger?: HTMLElement): void;
  closeDrawer(): void;
} {
  // The first render already has the mode, the choice and the groups, so the
  // frame paints once, in its final layout.
  const [width, setWidth] = useState(viewportWidth);
  const [preference, setPreference] = useState(readSidebarPreference);
  const [groups, setGroups] = useState(readSidebarGroups);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // The drawer as of the last call (calls between renders see it), the
  // control that opened it, and where focus goes once it has closed.
  const opened = useRef(false),
    trigger = useRef<HTMLElement | null>(null),
    restore = useRef<HTMLElement | null>(null);
  const mode = sidebarMode(width, preference);

  useEffect(() => {
    const queries = [PHONE, WIDE].map((query) => window.matchMedia(query));
    const update = () => setWidth(viewportWidth());
    for (const query of queries) query.addEventListener("change", update);
    update();
    return () => {
      for (const query of queries) query.removeEventListener("change", update);
    };
  }, []);
  // A mode change closes the drawer and returns no focus.
  useLayoutEffect(() => {
    opened.current = false;
    trigger.current = restore.current = null;
    setDrawerOpen(false);
  }, [mode]);
  // Once the drawer has closed (the frame is no longer inert), focus goes
  // back to the control that opened it.
  useLayoutEffect(() => {
    const target = restore.current;
    if (drawerOpen || !target) return;
    restore.current = null;
    target.focus();
  }, [drawerOpen]);

  return {
    mode,
    toggleMode() {
      if (mode === "drawer") return;
      const next = mode === "expanded" ? "rail" : "expanded";
      writeSidebarPreference(next);
      setPreference(next);
    },
    groups,
    toggleGroup(group) {
      const next = { ...groups, [group]: !groups[group] };
      writeSidebarGroups(next);
      setGroups(next);
    },
    drawerOpen: drawerOpen && mode === "drawer",
    openDrawer(element) {
      if (mode !== "drawer" || opened.current) return;
      opened.current = true;
      trigger.current = element ?? null;
      setDrawerOpen(true);
    },
    closeDrawer() {
      if (!opened.current) return;
      opened.current = false;
      restore.current = trigger.current;
      trigger.current = null;
      setDrawerOpen(false);
    },
  };
}
