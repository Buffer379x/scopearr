import { ICON } from "../ui";
import type { ComponentChildren } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import { Check, ChevronDown } from "lucide-preact";

export type NavMenuItem = {
  key: string;
  label: string;
  icon?: ComponentChildren;
  badge?: number;
  active: boolean;
  select: () => void;
};

// Opens on click (not hover) so desktop and touch behave the same.
export function NavMenu({
  icon,
  label,
  badge,
  badgeLabel,
  items,
}: {
  icon: ComponentChildren;
  label: string;
  badge?: number;
  badgeLabel?: string;
  items: NavMenuItem[];
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const multiple = items.length > 1;
  const active = items.some((item) => item.active);
  const entries = () =>
    Array.from(
      root.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ||
        [],
    );
  useEffect(() => {
    if (!multiple) {
      if (open) setOpen(false);
      return;
    }
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    const current = items.findIndex((item) => item.active);
    entries()[Math.max(0, current)]?.focus();
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, multiple]);
  const close = (focus = true) => {
    setOpen(false);
    if (focus) trigger.current?.focus();
  };
  const keydown = (event: KeyboardEvent) => {
    const list = entries();
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    const move = (next: number) => {
      event.preventDefault();
      list[(next + list.length) % list.length]?.focus();
    };
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(list.length - 1);
    else if (event.key === "Tab") setOpen(false);
  };
  if (!items.length) return null;
  if (!multiple) {
    return (
      <button
        aria-label={badgeLabel}
        ref={trigger}
        class={"nav-menu-button" + (active ? " active" : "")}
        aria-current={active ? "page" : undefined}
        onClick={items[0].select}
        title={badgeLabel}
      >
        {icon}
        {label}
        {!!badge && <span class="filter-count">{badge}</span>}
      </button>
    );
  }
  return (
    <div class="nav-menu" ref={root} onKeyDown={keydown}>
      <button
        aria-label={badgeLabel}
        ref={trigger}
        class={"nav-menu-button" + (active ? " active" : "")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        title={badgeLabel}
      >
        {icon}
        {label}
        {!!badge && <span class="filter-count">{badge}</span>}
        <ChevronDown size={ICON.label} class={open ? "rotated" : ""} />
      </button>
      {open && (
        <div class="nav-menu-list" role="menu" id={id} aria-label={label}>
          {items.map((item) => (
            <button
              key={item.key}
              role="menuitem"
              class={item.active ? "active" : ""}
              aria-current={item.active ? "page" : undefined}
              onClick={() => {
                close(false);
                item.select();
              }}
            >
              {item.icon}
              <span class="nav-menu-label">{item.label}</span>
              {!!item.badge && <span class="filter-count">{item.badge}</span>}
              {item.active && (
                <Check size={ICON.label} class="nav-menu-check" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
