import { OctagonAlert, RotateCcw, TriangleAlert } from "lucide-preact";
import type { JSX } from "preact";
import type { Dispatch, StateUpdater } from "preact/hooks";
import { confirmReset } from "../../confirmation";
import { t, useI18n } from "../../i18n";
import type { Settings } from "../../types";
import { ICON, defaultWarningColors } from "../../ui";
import { RowButton } from "../list/RowButton";
import { card, colorTable } from "./Card";

const WARNINGS = [
  [
    "metadata",
    TriangleAlert,
    "Metadata disagreement",
    "Metadata warning color",
  ],
  [
    "recognition",
    OctagonAlert,
    "Conflicting recognition rules",
    "Recognition warning color",
  ],
] as const;

// Display → Colors, the card "Warning colors" (docs/STYLEGUIDE.md, Part 1,
// 11.4): a v2 table of the two warnings, each with its icon in the draft's
// color (the name keeps the text color, for its contrast), the color and
// Restore defaults with its question, as in 1.7.0.
export function WarningColorsCard({
  cfg,
  setCfg,
}: {
  cfg: Settings;
  setCfg: Dispatch<StateUpdater<Settings>>;
}): JSX.Element {
  useI18n();
  const set = (key: string, color: string) =>
    setCfg({ ...cfg, warningColors: { ...cfg.warningColors, [key]: color } });
  return card(
    "warning-colors",
    t("Warning colors"),
    <>
      <p>
        {t(
          "Metadata disagreements and conflicting recognition rules use separate icons.",
        )}
      </p>
      {colorTable(
        [t("Tag preview"), t("Color"), t("Reset")],
        WARNINGS.map(([key, Icon, name, label]) => [
          key,
          [
            <span class="v2-table-items">
              <Icon size={ICON.button} color={cfg.warningColors[key]} />
              {t(name)}
            </span>,
            <input
              type="color"
              class="v2-color"
              aria-label={t(label)}
              value={cfg.warningColors[key]}
              onInput={(e) => set(key, e.currentTarget.value)}
            />,
            <RowButton
              label={t("Restore defaults: {name}", { name: t(name) })}
              icon={<RotateCcw size={ICON.button} />}
              onClick={async () => {
                if (
                  await confirmReset(
                    t("Reset this warning color to its default?"),
                  )
                )
                  set(key, defaultWarningColors[key]);
              }}
            />,
          ],
        ]),
        undefined,
        "v2-set-colors",
      )}
    </>,
  );
}
