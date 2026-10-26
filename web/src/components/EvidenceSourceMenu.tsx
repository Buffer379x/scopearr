import { ChevronDown, UserCheck } from "lucide-preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { createPortal } from "preact/compat";
import type { Evidence, FieldConfirmation } from "../types";
import {
  evidenceChoices,
  evidenceSelectable,
  evidenceMenuPosition,
} from "../evidence-source";
import { t, useI18n } from "../i18n";
import { ICON } from "../ui";
export const evidenceSourceLabel = (source: string) =>
  source === "filename" || source === "rule"
    ? t("Filename")
    : source === "api"
      ? "Radarr / Sonarr"
      : source === "mediaServer" || source === "emby"
        ? t("Media server")
        : source === "mediainfo"
          ? "MediaInfo"
          : source === "combined"
            ? t("Enriched")
            : t("Unknown");
export function EvidenceSourceMenu({
  evidence: e,
  field,
  ruleConflict,
  busy,
  choose,
}: {
  evidence: Evidence;
  field: string;
  ruleConflict: boolean;
  busy: boolean;
  choose: (source: FieldConfirmation["source"] | null) => Promise<void>;
}) {
  const { locale } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    width: number;
  }>();
  const contains = (node: Node | null) =>
    !!node && (!!ref.current?.contains(node) || !!menu.current?.contains(node));
  const select = async (source: FieldConfirmation["source"] | null) => {
    setOpen(false);
    try {
      await choose(source);
    } catch {
    } finally {
      trigger.current?.focus();
    }
  };
  const dismiss = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useLayoutEffect(() => {
    if (!open) return;
    const mobile = window.matchMedia("(max-width: 600px)").matches;
    if (mobile)
      trigger.current?.scrollIntoView({ block: "center", inline: "nearest" });
    const place = () => {
      if (!trigger.current || !menu.current) return;
      const cell = mobile
        ? trigger.current.closest("tr") || trigger.current
        : trigger.current;
      const gap = parseFloat(
        getComputedStyle(trigger.current).getPropertyValue("--space-2"),
      );
      setPosition(
        evidenceMenuPosition(
          {
            ...cell.getBoundingClientRect().toJSON(),
            top: trigger.current.getBoundingClientRect().top,
            bottom: trigger.current.getBoundingClientRect().bottom,
          },
          menu.current.getBoundingClientRect(),
          { width: window.innerWidth, height: window.innerHeight },
          gap,
          mobile,
        ),
      );
    };
    place();
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: MouseEvent) => {
      if (!contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("click", outside);
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("click", outside);
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [open]);
  useLayoutEffect(()=>{if(open&&position)menu.current?.querySelector<HTMLButtonElement>("button")?.focus()},[open,!!position]);
  const confirmation = e.confirmed
    ? t("Confirmed manually: {source} · {value} · {date}", {
        source: evidenceSourceLabel(e.confirmed.source),
        value: e.confirmed.value,
        date: new Date(e.confirmed.at).toLocaleString(locale),
      })
    : "";
  const label = (
    <>
      {evidenceSourceLabel(e.origin)}
      {e.confirmed && (
        <span
          class="quiet"
          role="img"
          title={confirmation}
          aria-label={confirmation}
        >
          <UserCheck size={ICON.label} />
        </span>
      )}
    </>
  );
  const keyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (!open) return;
    const buttons = Array.from(
      menu.current?.querySelectorAll<HTMLButtonElement>("button") || [],
    );
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      buttons[
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
              buttons.length
      ]?.focus();
    }
  };
  const focusOut = (event: FocusEvent) => {
    if (!contains(event.relatedTarget as Node)) setOpen(false);
  };
  return (
    <div
      class="evidence-source-menu"
      ref={ref}
      onFocusOut={focusOut}
      onKeyDown={keyDown}
    >
      {evidenceSelectable(e, ruleConflict) ? (
        <button
          ref={trigger}
          type="button"
          class="text-button"
          disabled={busy}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t("Choose source for {field}", { field })}
          onClick={() => {
            setPosition(undefined);
            setOpen(!open);
          }}
        >
          {label}
          <ChevronDown size={ICON.label} />
        </button>
      ) : (
        <span class="detail-value">{label}</span>
      )}
      {e.confirmed &&
        !evidenceChoices(e).some((c) => c.source === e.confirmed!.source) && (
          <em class="cell-hint">{t("Confirmed source has no value")}</em>
        )}
      {open &&
        trigger.current?.closest("dialog") &&
        createPortal(
          <div
            ref={menu}
            class="select-popover floating-surface evidence-source-options"
            role="menu"
            onKeyDown={keyDown}
            onFocusOut={focusOut}
            style={
              position
                ? {
                    left: position.left,
                    top: position.top,
                    width: position.width,
                  }
                : { visibility: "hidden" }
            }
            aria-label={field}
          >
            {evidenceChoices(e).map((c) => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={e.confirmed?.source === c.source}
                class="text-button"
                onClick={() => void select(c.source)}
              >
                {evidenceSourceLabel(c.source)} · {c.value}
              </button>
            ))}
            {e.confirmed && (
              <>
                <hr />
                <button
                  type="button"
                  role="menuitem"
                  class="text-button"
                  onClick={() => void select(null)}
                >
                  {t("Automatic")}
                </button>
              </>
            )}
          </div>,
          trigger.current.closest("dialog")!,
        )}
    </div>
  );
}
