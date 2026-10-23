import { ICON } from "../ui";
import { useEffect, useRef, useState } from "preact/hooks";
import { createPortal } from "preact/compat";
import { Link2, Play } from "lucide-preact";
import type { MediaFile, Settings } from "../types";
import { mediaEntryChoices } from "../media-link";
import { t, useI18n } from "../i18n";

export function MediaServerLink({
  file,
  settings,
}: {
  file: MediaFile;
  settings: Settings | null;
}) {
  useI18n();
  const choices = mediaEntryChoices(settings, file);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null),
    popup = useRef<HTMLDivElement>(null);
  const dismiss = (focus = false) => {
    setPosition(null);
    if (focus) trigger.current?.focus();
  };
  useEffect(() => {
    if (!position) return;
    popup.current?.querySelector<HTMLElement>("a")?.focus();
    const outside = (event: Event) => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !popup.current?.contains(event.target as Node)
      )
        dismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss(true);
      }
    };
    const scroll = (event: Event) => {
      if (!popup.current?.contains(event.target as Node)) dismiss();
    };
    const resize = () => dismiss();
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", resize);
    };
  }, [position]);
  if (!choices.length) return null;
  const unavailable = t(
    "Media server link unavailable. Synchronize the library and check the file mapping.",
  );
  const label = t("Open media server entry in a new tab");
  const icon = (
    <span class="media-link-icon">
      <Link2 size={ICON.label} />
      <Play class="media-link-play" size={ICON.chip} />
    </span>
  );
  if (choices.length === 1 && choices[0].href)
    return (
      <a
        class="row-icon info-action"
        href={choices[0].href}
        target="_blank"
        rel="noopener noreferrer"
        referrerPolicy="no-referrer"
        title={t("Open {service} entry in a new tab", {
          service: choices[0].label,
        })}
        aria-label={label}
      >
        {icon}
      </a>
    );
  if (!choices.some((choice) => choice.href))
    return (
      <button
        class="row-icon info-action"
        disabled
        title={unavailable}
        aria-label={label}
      >
        {icon}
      </button>
    );
  const id = `media-links-${file.service}-${file.id}`;
  return (
    <span class="media-link-control">
      <button
        ref={trigger}
        class="row-icon info-action"
        title={t("Choose media server")}
        aria-label={t("Choose media server")}
        aria-haspopup="menu"
        aria-expanded={!!position}
        aria-controls={position ? id : undefined}
        onClick={() => {
          if (position) {
            dismiss();
            return;
          }
          const rect = trigger.current!.getBoundingClientRect();
          setPosition({
            left: Math.max(8, Math.min(rect.left, window.innerWidth - 228)),
            top:
              rect.bottom + 8 + 110 < window.innerHeight
                ? rect.bottom + 8
                : Math.max(8, rect.top - 118),
          });
        }}
      >
        {icon}
      </button>
      {position &&
        createPortal(
          <div
            ref={popup}
            id={id}
            role="menu"
            aria-label={t("Choose media server")}
            class="select-popover media-link-popover"
            style={{
              position: "fixed",
              left: position.left,
              top: position.top,
              width: 220,
              zIndex: 100,
            }}
            onKeyDown={(event) => {
              if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
                return;
              event.preventDefault();
              const links = Array.from(
                popup.current!.querySelectorAll<HTMLAnchorElement>("a"),
              );
              const current = links.indexOf(
                document.activeElement as HTMLAnchorElement,
              );
              links[
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? links.length - 1
                    : (current +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        links.length) %
                      links.length
              ]?.focus();
            }}
          >
            {choices.map((choice) =>
              choice.href ? (
                <a
                  role="menuitem"
                  key={choice.provider}
                  href={choice.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  onClick={() => dismiss(true)}
                >
                  {choice.label}
                </a>
              ) : (
                <span
                  role="menuitem"
                  aria-disabled="true"
                  class="media-link-unavailable"
                  title={unavailable}
                  key={choice.provider}
                >
                  {choice.label}
                </span>
              ),
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}
