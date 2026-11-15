import { CircleAlert, CircleHelp } from "lucide-preact";
import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { t, useI18n } from "../../i18n";
import { ICON } from "../../ui";
import { Popover } from "../frame/Popover";

// A help button with its explanation (docs/STYLEGUIDE.md, Part 1, 10.8):
// an sm icon button named by its label (a catalog key, as for the 1.7.0
// HelpPopover) that opens a Popover dialog at itself with the text or the
// sections (a heading and a text each; a raw text is shown as is). Escape
// and a press outside close it with the Popover's rules, focus returning to
// the button; a second press closes it as well.
export function HelpTip({
  label,
  text,
  sections,
  tone,
}: {
  label: string;
  text?: string;
  sections?: { heading: string; text: string; raw?: boolean }[];
  tone?: "notice";
}): JSX.Element {
  useI18n();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const name = t(label);
  return (
    <>
      <button
        type="button"
        class="v2-icon-btn v2-icon-btn--sm"
        aria-label={name}
        title={name}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
      >
        {tone === "notice" ? (
          <CircleAlert size={ICON.button} />
        ) : (
          <CircleHelp size={ICON.button} />
        )}
      </button>
      {anchor && (
        <Popover
          anchor={anchor}
          placement="bottom-end"
          role="dialog"
          label={name}
          close={() => setAnchor(null)}
        >
          {sections ? (
            sections.map((section) => (
              <section key={section.heading}>
                <h3 class="v2-pop-title">{t(section.heading)}</h3>
                <p class="v2-pop-text">
                  {section.raw ? section.text : t(section.text)}
                </p>
              </section>
            ))
          ) : (
            <p class="v2-pop-text">{t(text || "")}</p>
          )}
        </Popover>
      )}
    </>
  );
}
