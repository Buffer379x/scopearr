import { CircleAlert, CircleHelp } from "lucide-preact";
import { createPortal } from "preact/compat";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import { t } from "../i18n";
export function HelpPopover({
  label,
  text,
  variant = "help",
}: {
  label: string;
  text: string;
  variant?: "help" | "notice";
}) {
  const [open, setOpen] = useState(false),
    id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ left: 24, top: 0 });
  const floating = variant === "notice";
  function show() {
    if (floating && button.current) {
      const rect = button.current.getBoundingClientRect();
      const width = Math.min(340, window.innerWidth - 48);
      setPosition({
        left: Math.max(24, Math.min(rect.left, window.innerWidth - width - 24)),
        top: rect.bottom + 6,
      });
    }
    setOpen(true);
  }
  useEffect(() => {
    if (!open || !floating) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, floating]);
  const tooltip = (
    <span
      id={id}
      role="tooltip"
      class={"filter-logic-tooltip" + (floating ? " floating-help" : "")}
      style={floating ? position : undefined}
    >
      {t(text)}
    </span>
  );
  return (
    <span
      class={"filter-logic-help inline-help" + (open ? " open" : "")}
      onMouseEnter={show}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        ref={button}
        class="icon-button"
        aria-label={t(label)}
        aria-describedby={id}
        aria-expanded={open}
        onFocus={show}
        onBlur={() => setOpen(false)}
        onClick={show}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        {floating ? <CircleAlert size={16} /> : <CircleHelp size={16} />}
      </button>
      {floating ? open && createPortal(tooltip, document.body) : tooltip}
    </span>
  );
}
