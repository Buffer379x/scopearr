import { ICON } from "../ui";
import { CircleAlert, CircleHelp, Info } from "lucide-preact";
import { createPortal } from "preact/compat";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "preact/hooks";
import { t } from "../i18n";
export function HelpPopover({
  label,
  text,
  sections,
  variant = "help",
}: {
  label: string;
  text?: string;
  sections?: { heading: string; text: string; raw?: boolean }[];
  variant?: "help" | "notice" | "info";
}) {
  const [open, setOpen] = useState(false),
    id = useId(),
    button = useRef<HTMLButtonElement>(null),
    popup = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 16, top: 0 });
  useLayoutEffect(() => {
    if (!open || !button.current || !popup.current) return;
    const r = button.current.getBoundingClientRect(),
      f = popup.current.getBoundingClientRect();
    setPosition({
      left: Math.max(16, Math.min(r.left, innerWidth - f.width - 16)),
      top: Math.max(
        16,
        r.bottom + 8 + f.height <= innerHeight - 16
          ? r.bottom + 8
          : r.top - f.height - 8,
      ),
    });
  }, [open, text, sections]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      if (
        !button.current?.contains(e.target as Node) &&
        !popup.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }
    };
    const close = (e: Event) => { if (!popup.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);
  return (
    <span class="inline-help">
      <button
        type="button"
        ref={button}
        class="icon-button"
        aria-label={t(label)}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
        title={t(label)}
      >
        {variant === "notice" ? (
          <CircleAlert size={ICON.button} />
        ) : variant === "info" ? (
          <Info size={ICON.button} />
        ) : (
          <CircleHelp size={ICON.button} />
        )}
      </button>
      {open &&
        createPortal(
          <div
            ref={popup}
            id={id}
            role="dialog"
            aria-label={t(label)}
            class="floating-surface help-popover"
            style={position}
          >
            {sections ? sections.map((section) => (
              <section class="help-section" key={section.heading}>
                <h3>{t(section.heading)}</h3>
                <p>{section.raw ? section.text : t(section.text)}</p>
              </section>
            )) : variant === "info" ? text : t(text || "")}
          </div>,
          button.current?.closest("dialog") || document.body,
        )}
    </span>
  );
}
