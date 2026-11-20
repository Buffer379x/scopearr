import { Play } from "lucide-preact";
import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { t, useI18n } from "../../i18n";
import { mediaEntryChoices } from "../../media-link";
import type { MediaFile, Settings } from "../../types";
import { ICON } from "../../ui";
import { Popover } from "../frame/Popover";
import { RowButton } from "../list/RowButton";

// The media server button of the Info column (docs/STYLEGUIDE.md, Part 1,
// 10.10), with the choices of 1.7.0 (mediaEntryChoices): nothing without a
// media server; one linked server a RowButton link into a new tab; no
// linked entry a locked RowButton with the hint; several servers a
// RowButton "Choose media server" that opens a Popover menu of their links,
// one without an entry a disabled entry with the hint. A choice returns
// focus to the button and closes the menu, as 1.7.0 did.
export function MediaLinkButton({
  file,
  settings,
}: {
  file: MediaFile;
  settings: Settings | null;
}): JSX.Element | null {
  useI18n();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const choices = mediaEntryChoices(settings, file);
  if (!choices.length) return null;
  const label = t("Open media server entry in a new tab");
  const unavailable = t(
    "Media server link unavailable. Synchronize the library and check the file mapping.",
  );
  const icon = <Play size={ICON.row} />;
  if (choices.length === 1 && choices[0].href)
    return (
      <RowButton
        label={label}
        title={t("Open {service} entry in a new tab", {
          service: choices[0].label,
        })}
        icon={icon}
        href={choices[0].href}
        newTab
      />
    );
  if (!choices.some((choice) => choice.href))
    return <RowButton label={label} title={unavailable} icon={icon} disabled />;
  const name = t("Choose media server");
  return (
    <>
      <RowButton
        label={name}
        icon={icon}
        popup="menu"
        expanded={!!anchor}
        onClick={(event) =>
          setAnchor(anchor ? null : (event.currentTarget as HTMLElement))
        }
      />
      {anchor && (
        <Popover
          anchor={anchor}
          placement="bottom-end"
          role="menu"
          label={name}
          close={() => setAnchor(null)}
        >
          {choices.map((choice) =>
            choice.href ? (
              <a
                key={choice.provider}
                role="menuitem"
                class="v2-menu-item"
                href={choice.href}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
                onClick={() => {
                  anchor.focus();
                  setAnchor(null);
                }}
              >
                {choice.label}
              </a>
            ) : (
              <span
                key={choice.provider}
                role="menuitem"
                class="v2-menu-item"
                aria-disabled="true"
                title={unavailable}
              >
                {choice.label}
              </span>
            ),
          )}
        </Popover>
      )}
    </>
  );
}
