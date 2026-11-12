import { Moon, Sun } from "lucide-preact";
import type { JSX } from "preact";
import type { BandStyle, Theme } from "../../appearance";
import { t, useI18n } from "../../i18n";
import { bandChoice, previewStyle } from "../../settings-model";
import {
  interfaceThemes,
  themeLabels,
  type InterfaceTheme,
} from "../../themes";
import { ICON } from "../../ui";
import { MediaTag } from "../list/MediaTag";

const MODES: readonly Theme[] = ["dark", "light"];

// The scoped palette preview (docs/STYLEGUIDE.md, Part 1, 2.2 and 10.11):
// per mode a block hidden from assistive technology that scopes the
// palette (its 9 keys and the 5 status tokens inline, an exception of 4),
// the mode and the draft band resolved for that mode (null: each mode's
// default), so derived tokens, band and palette fixes resolve on it. It
// shows a mini band, the mode and palette, a mini table and two surfaces
// drawn as buttons, never controls.
export function PalettePreview({
  theme,
  band,
}: {
  theme: string;
  band: BandStyle | null;
}): JSX.Element {
  useI18n();
  const palette = interfaceThemes.includes(theme as InterfaceTheme)
    ? (theme as InterfaceTheme)
    : "default";
  return (
    <>
      {MODES.map((mode) => (
        <div
          key={mode}
          class="v2-pal-prev"
          data-palette-scope=""
          data-palette={palette}
          data-theme={mode}
          data-band={bandChoice(mode, band).value}
          style={previewStyle(palette, mode)}
          aria-hidden="true"
        >
          <div class="v2-pal-prev-band">{t("Movie library")}</div>
          <div class="v2-pal-prev-head">
            <span>
              {mode === "dark" ? (
                <Moon size={ICON.label} />
              ) : (
                <Sun size={ICON.label} />
              )}
              {t(mode === "dark" ? "Dark theme" : "Light theme")}
            </span>
            <b>{t(themeLabels[palette])}</b>
          </div>
          <div class="v2-pal-prev-table">
            <div class="v2-pal-prev-row">
              <span>{t("Title")}</span>
              <span>{t("Resolution")}</span>
              <span>{t("Audio tracks")}</span>
            </div>
            <div class="v2-pal-prev-row">
              <span>Arrival</span>
              <span>
                <MediaTag value="1080p" kind="resolution" forceTag />
              </span>
              <span>
                <MediaTag value="DTS · 5.1" kind="audio" forceTag />
              </span>
            </div>
          </div>
          <div class="v2-pal-prev-btns">
            <span class="v2-btn v2-btn--sm v2-btn--primary">{t("Save")}</span>
            <span class="v2-btn v2-btn--sm">{t("Cancel")}</span>
          </div>
        </div>
      ))}
    </>
  );
}
