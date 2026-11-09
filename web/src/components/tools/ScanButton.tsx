import { ClipboardList, ScanSearch, Square } from "lucide-preact";
import type { JSX } from "preact";
import { t } from "../../i18n";
import { ICON } from "../../ui";

// The band's primary action of a scan tool (docs/STYLEGUIDE.md, Part 1,
// 10.3): v2-btn--band-primary with both labels, Scan and Cancel scan, in
// one grid cell, the hidden one span.v2-btn-alt, so the button is always as
// wide as the longer one and is named by the one it shows; v2-btn--ready
// marks it after a changed share mapping (the 1.7.0 scan-ready).
export function ScanButton({
  scanning,
  ready,
  disabled,
  press,
}: {
  scanning: boolean;
  ready: boolean;
  disabled: boolean;
  press(): void;
}): JSX.Element {
  const [shown, other] = scanning
    ? ["Cancel scan", "Scan"]
    : ["Scan", "Cancel scan"];
  return (
    <button
      type="button"
      class={"v2-btn v2-btn--band-primary" + (ready ? " v2-btn--ready" : "")}
      disabled={disabled}
      onClick={() => press()}
    >
      {scanning ? (
        <Square size={ICON.button} />
      ) : (
        <ScanSearch size={ICON.button} />
      )}
      <span>{t(shown)}</span>
      <span class="v2-btn-alt" aria-hidden="true">
        {t(other)}
      </span>
    </button>
  );
}

// The scan report on the band (10.3): v2-btn--on-band “Scan report”,
// locked without a report; while the last scan has notices a warning dot
// at the icon's corner, which never changes the width, and the name says
// it (“Scan report · contains notices”).
export function ReportButton({
  notices,
  disabled,
  open,
}: {
  notices: boolean;
  disabled: boolean;
  open(): void;
}): JSX.Element {
  const name = t(notices ? "Scan report · contains notices" : "Scan report");
  return (
    <button
      type="button"
      class="v2-btn v2-btn--on-band"
      disabled={disabled}
      aria-label={notices ? name : undefined}
      title={name}
      onClick={() => open()}
    >
      <ClipboardList size={ICON.button} />
      {t("Scan report")}
      {notices && <span class="v2-dot v2-dot--warn" aria-hidden="true" />}
    </button>
  );
}
