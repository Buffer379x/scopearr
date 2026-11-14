import { cloneElement, type ComponentChildren, type VNode } from "preact";
import { createPortal } from "preact/compat";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "preact/hooks";

// A single trigger keeps its semantics and existing action; the tooltip adds
// description and pointer/keyboard access without an extra layout wrapper.
export function Tooltip({
  content,
  children,
}: {
  content: ComponentChildren;
  children: VNode<any>;
}) {
  const id = useId(),
    trigger = useRef<HTMLElement | null>(null),
    popup = useRef<HTMLDivElement>(null),
    timer = useRef<number>();
  const [open, setOpen] = useState(false),
    [position, setPosition] = useState({ left: 16, top: 0 }),
    [host, setHost] = useState<Element | null>(null);
  const close = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };
  const show = () => {
    setHost(trigger.current?.closest("dialog") || document.body);
    setOpen(true);
  };
  useLayoutEffect(() => {
    if (!open || !trigger.current || !popup.current) return;
    const r = trigger.current.getBoundingClientRect(),
      f = popup.current.getBoundingClientRect();
    setPosition({
      left: Math.max(16, Math.min(r.left, window.innerWidth - f.width - 16)),
      top: Math.max(
        16,
        r.bottom + 8 + f.height <= window.innerHeight - 16
          ? r.bottom + 8
          : r.top - f.height - 8,
      ),
    });
  }, [open, content]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      if (!trigger.current?.contains(e.target as Node)) close();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const props = children.props;
  return (
    <>
      {cloneElement(children, {
        ref: (el: HTMLElement | null) => {
          trigger.current = el;
          const ref = children.ref;
          if (typeof ref === "function") ref(el);
          else if (ref) ref.current = el;
        },
        "aria-describedby":
          [props["aria-describedby"], open ? id : null]
            .filter(Boolean)
            .join(" ") || undefined,
        onPointerEnter: (e: PointerEvent) => {
          props.onPointerEnter?.(e);
          if (e.pointerType !== "touch") {
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(show, 150);
          }
        },
        onPointerLeave: (e: PointerEvent) => {
          props.onPointerLeave?.(e);
          if (e.pointerType !== "touch") close();
        },
        onFocus: (e: FocusEvent) => {
          props.onFocus?.(e);
          if (trigger.current?.matches(":focus-visible")) show();
        },
        onBlur: (e: FocusEvent) => {
          props.onBlur?.(e);
          close();
        },
        onClick: (e: MouseEvent) => {
          if (window.matchMedia("(pointer: coarse)").matches) {
            e.stopPropagation();
            open ? close() : show();
          }
          props.onClick?.(e);
        },
      })}
      {open &&
        host &&
        createPortal(
          <div
            ref={popup}
            id={id}
            class="floating-surface tooltip"
            role="tooltip"
            style={position}
          >
            {content}
          </div>,
          host,
        )}
    </>
  );
}
