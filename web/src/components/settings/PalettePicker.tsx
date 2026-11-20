import { Check } from "lucide-preact";
import type { JSX } from "preact";
import type { Theme } from "../../appearance";
import { t, useI18n } from "../../i18n";
import { paletteDots } from "../../settings-model";
import {
  interfaceThemes,
  themeLabels,
  type InterfaceTheme,
} from "../../themes";
import { ICON } from "../../ui";

// The palette tiles (docs/STYLEGUIDE.md, Part 1, 10.11): a radiogroup named
// by the card's title of 18 labels, each with its radio named by the
// palette, four dots of the palette in the shown mode (inline data, an
// exception of 4), its name and, when chosen, the check. An unknown value
// chooses the default, as applyInterfaceTheme does. A choice sets the
// draft's interfaceTheme.
export function PalettePicker({
  labelledBy,
  value,
  mode,
  change,
}: {
  labelledBy: string;
  value: string;
  mode: Theme;
  change(theme: InterfaceTheme): void;
}): JSX.Element {
  useI18n();
  const chosen = interfaceThemes.includes(value as InterfaceTheme)
    ? value
    : "default";
  return (
    <div class="v2-pal-grid" role="radiogroup" aria-labelledby={labelledBy}>
      {interfaceThemes.map((key) => (
        <label key={key} class="v2-pal">
          <input
            type="radio"
            name="interfaceTheme"
            value={key}
            checked={key === chosen}
            onChange={() => change(key)}
          />
          <span class="v2-pal-dots" aria-hidden="true">
            {paletteDots(key, mode).map((color, at) => (
              <span key={at} style={{ background: color }} />
            ))}
          </span>
          <span class="v2-pal-name">{t(themeLabels[key])}</span>
          {key === chosen && (
            <Check class="v2-pal-check" size={ICON.button} aria-hidden="true" />
          )}
        </label>
      ))}
    </div>
  );
}
