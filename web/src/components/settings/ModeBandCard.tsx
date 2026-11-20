import type { JSX } from "preact";
import type { BandStyle, Theme } from "../../appearance";
import { t, useI18n } from "../../i18n";
import { bandChoice } from "../../settings-model";
import { Segmented } from "../list/Segmented";

// Mode and Accent band in the card "Interface theme" (docs/STYLEGUIDE.md,
// Part 1, 2.3 and 10.11): two radio segments, each a v2-mode group with its
// label, the band with "Use default" beside it and its hint. Both are
// drafts until Save settings (ruling P1): the card shows the drafted mode
// and band (null: no stored choice, the mode's default) and reports the
// next draft; it sets nothing itself. "Use default" is locked while the
// draft has no stored choice.
export function ModeBandCard({
  mode,
  band,
  change,
}: {
  mode: Theme;
  band: BandStyle | null;
  change(next: { mode: Theme; band: BandStyle | null }): void;
}): JSX.Element {
  useI18n();
  const shown = bandChoice(mode, band);
  return (
    <>
      <div class="v2-mode">
        <span aria-hidden="true">{t("Mode")}</span>
        <Segmented<Theme>
          label={t("Mode")}
          kind="radio"
          value={mode}
          items={[
            { value: "dark", label: t("Dark theme") },
            { value: "light", label: t("Light theme") },
          ]}
          select={(next) => change({ mode: next, band })}
        />
      </div>
      <div class="v2-mode">
        <span aria-hidden="true">{t("Accent band")}</span>
        <div>
          <Segmented<BandStyle>
            label={t("Accent band")}
            kind="radio"
            value={shown.value}
            items={[
              { value: "strong", label: t("Strong") },
              { value: "muted", label: t("Muted") },
            ]}
            select={(next) => change({ mode, band: next })}
          />
          <button
            type="button"
            class="v2-text-btn"
            disabled={!shown.stored}
            onClick={() => change({ mode, band: null })}
          >
            {t("Use default")}
          </button>
        </div>
        <small>
          {t(
            "Default: dark muted, light strong – one choice applies to dark and light.",
          )}
        </small>
      </div>
    </>
  );
}
