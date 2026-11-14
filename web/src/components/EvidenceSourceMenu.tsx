import { ChevronDown, UserCheck } from "lucide-preact";
import { useRef, useState } from "preact/hooks";
import type { Evidence, FieldConfirmation } from "../types";
import { evidenceChoices, evidenceSelectable } from "../evidence-source";
import { t, useI18n } from "../i18n";
import { ICON } from "../ui";
import { Popover } from "./frame/Popover";
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
// The source of a field in File & metadata's Used column (docs/STYLEGUIDE.md,
// Part 1, 10.8; Phase 5d, E14): a text button with a chevron, named
// "Choose source for {field}", that opens a Popover menu in the dialog
// (bottom-end): each source with a value as a menuitemradio (checked: the
// confirmed one) and, after a separator, Automatic while one is confirmed.
// The Popover keeps it in the view, moves with ↑/↓/Home/End, closes on
// Escape and on a press outside it (not in the toasts) and returns focus to
// the button. A confirmed source shows its mark (UserCheck); one that has
// no value any more says so in the cell.
export function EvidenceSourceMenu({
  evidence: e,
  field,
  formatValue = (value) => value,
  ruleConflict,
  busy,
  choose,
}: {
  evidence: Evidence;
  field: string;
  formatValue?: (value: string) => string;
  ruleConflict: boolean;
  busy: boolean;
  choose: (source: FieldConfirmation["source"] | null) => Promise<void>;
}) {
  const { locale } = useI18n();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const select = async (source: FieldConfirmation["source"] | null) => {
    anchor?.focus();
    setAnchor(null);
    try {
      await choose(source);
    } catch {
    } finally {
      trigger.current?.focus();
    }
  };
  const confirmation = e.confirmed
    ? t("Confirmed manually: {source} · {value} · {date}", {
        source: evidenceSourceLabel(e.confirmed.source),
        value: formatValue(e.confirmed.value),
        date: new Date(e.confirmed.at).toLocaleString(locale),
      })
    : "";
  const label = (
    <>
      {evidenceSourceLabel(e.origin)}
      {e.confirmed && (
        <span role="img" title={confirmation} aria-label={confirmation}>
          <UserCheck size={ICON.label} />
        </span>
      )}
    </>
  );
  const name = t("Choose source for {field}", { field });
  return (
    <>
      {evidenceSelectable(e, ruleConflict) ? (
        <button
          ref={trigger}
          type="button"
          class="v2-text-btn"
          disabled={busy}
          aria-haspopup="menu"
          aria-expanded={!!anchor}
          aria-label={name}
          onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
        >
          {label}
          <ChevronDown size={ICON.label} />
        </button>
      ) : (
        <span>{label}</span>
      )}
      {e.confirmed &&
        !evidenceChoices(e).some((c) => c.source === e.confirmed!.source) && (
          <span class="v2-modal-hint">
            {t("Confirmed source has no value")}
          </span>
        )}
      {anchor && (
        <Popover
          anchor={anchor}
          placement="bottom-end"
          role="menu"
          label={name}
          close={() => setAnchor(null)}
        >
          {evidenceChoices(e).map((c) => (
            <button
              key={c.source}
              type="button"
              role="menuitemradio"
              aria-checked={e.confirmed?.source === c.source}
              class="v2-menu-item"
              onClick={() => void select(c.source)}
            >
              <span class="v2-menu-text">
                {evidenceSourceLabel(c.source)} · {formatValue(c.value)}
              </span>
            </button>
          ))}
          {e.confirmed && (
            <>
              <div role="separator" class="v2-menu-sep" />
              <button
                type="button"
                role="menuitem"
                class="v2-menu-item"
                onClick={() => void select(null)}
              >
                <span class="v2-menu-text">{t("Automatic")}</span>
              </button>
            </>
          )}
        </Popover>
      )}
    </>
  );
}
