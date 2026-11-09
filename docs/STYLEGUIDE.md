# Interface style guide

This guide has two parts:

- **Part 1 – 2.0.0 design system** is the approved 2.0.0 design. It binds every file in `web/src/styles/v2/` and every new component.
- **Part 2 – 1.7.0 recipes (until replaced)** describes the interface that ships today. It binds every change to the 1.7.0 stylesheets (`web/src/styles/*.css`) until a phase replaces that area. The replacing phase deletes the Part 2 section and its `web/test/legacy-ui/` tests in the same commit.

Precedence: `styles/v2/` and new components follow Part 1; changes to 1.7.0 CSS follow Part 2. Do not mix them: 1.7.0 rules read no v2 token, and v2 rules read no 1.7.0 token. The only shared inputs are the 9 palette keys and the 5 status tokens (2.1), which v2 reads but never defines. Add a new token or recipe to the matching part before using it.

## Part 1 – 2.0.0 design system

Part 1 is the approved 2.0.0 design (internally “C+”). Class names in the design preview are working names; the role and the values are binding. Where the preview simplifies (simulated flows, illustrative forms, missing cases), the 1.7.0 behavior stays authoritative (11.6). Values that the design does not define are marked **Open** and are never invented.

### 1. Principles

1. **One purpose, one component.** When two solutions serve the same purpose, one is removed.
2. **A calm work surface, expression in the frame.** Surfaces stay neutral, with exactly one accent per palette. Gradients appear only in fixed places: the accent band, the active navigation and tab tile, the hero KPI, the primary button, the active pagination page, a checked checkbox or switch, the tab underline and the service tile.
3. **Light: shadow instead of border. Dark: surface step, fine edge and a muted shadow.** Inputs always keep a visible border (at least 3:1).
4. **Dense, not cramped.** Table rows are 48px (touch 56px) on a 4px grid; content comes before decoration.
5. **Nothing jumps.** Band, page header, sidebar and topbar have fixed sizes per breakpoint, without JavaScript measurement. The first card starts at the same y position on every page (146px at ≥ 740px, 172px at ≤ 739px). A page change never moves a navigation entry; groups expand only on click.
6. **Tokens only.** No raw value outside token definitions. Exceptions: media tag palettes, user colors (tags, custom tags, warning marks and the storage ring: user data), the dark terminal, the app icon, 0 and 1px, percentages and aspect ratios; section 4 lists them all.
7. **Every palette, every mode.** Every derived color comes from `color-mix()` over the 9 palette keys and the status tokens and is checked automatically for contrast in all 36 modes (2.6).

### 2. Color tokens

#### 2.1 Base tokens

The base tokens are set per palette and mode and are unchanged from 1.7.0:

| Token | Purpose |
| --- | --- |
| `--bg` | Page |
| `--panel` | Card |
| `--panel2` | Raised surface |
| `--line` | Border and divider |
| `--text` | Main content |
| `--muted` | Secondary content |
| `--accent` | The one accent |
| `--accent-bg` | 1.7.0 selection; in v2 only a palette key |
| `--accent-text` | Text on accent |
| `--status-ok`, `--status-warn`, `--status-wait`, `--status-error`, `--status-info` | Status per mode, independent of the palette |

The defaults stay hex values in `base.css`, where the contrast test reads them. The other 17 palettes stay in `themes.ts` and `themes.go` with unchanged IDs. v2 files never **define** these 14 keys; they only read them.

#### 2.2 Derived tokens

Derived tokens are formulas only. They mix in `oklab` unless `srgb` is stated; “mix(a p, b)” means `color-mix(in oklab, a p, b)`.

| Token | Formula | Purpose |
| --- | --- | --- |
| `--accent-2` | mix(accent 62%, status-info) | Second gradient stop |
| `--grad-accent` | `linear-gradient(135deg, accent 0%, accent-2 100%)` | Tiles, hero, active navigation, tab underline, service tile |
| `--grad-btn` | `linear-gradient(135deg, accent 0%, mix(accent 85%, status-info) 100%)` | Primary button, checked checkbox/radio/switch, active page |
| `--tint` · `--tint-soft` · `--tint-strong` | mix(accent 14% · 8% · 22%, panel) | Accent surfaces: open/active · selection · strong |
| `--icon-tint` · `--accent-ink` | mix(accent 60%, text) · mix(accent 82%, text) | Icons in tiles · accent text on neutral surfaces |
| `--accent-line` | mix(accent 45%, line) | Hover border of row buttons |
| `--hover` · `--thead` | mix(panel2 75%, panel) · mix(panel2 45%, panel) | Hover · table header, season and group rows |
| `--line-soft` | mix(line 72%, transparent) | Row dividers, dark card edge |
| `--divider-fade` | `linear-gradient(90deg, transparent, line 22%, line 78%, transparent)` | Sidebar divider |
| `--field-border` · `--field-bg` | mix(muted 78%, panel) · light `panel`, dark `bg` | Field border (at least 3:1) · field background (inset in dark mode) |
| `--sunken` | `bg` | Inner boxes, option cards, detail row |
| `--card-border` | light `transparent`, dark `line-soft` | Card edge |
| `--glass` · `--glass-filter` | mix(panel 74%, transparent) · `saturate(180%) blur(18px)` (the backdrop filter) | Topbar after scrolling, mobile tab bar |
| `--scrim` · `--scrim-light` | mix(bg 62% · 30%, transparent) | Modal and drawer sidebar · filter drawer |
| `--focus` | `0 0 0 3px` mix(accent 40%, transparent) | Focus shadow of fields and checkboxes |
| `--ring` | mix(accent 70%, text) | `:focus-visible` outline, 2px wide with a 2px offset |
| `--muted-strong` | `color-mix(in srgb, text 35%, muted)` | Sub-lines and muted text on hover, selection, open rows, flyouts and track options |
| `--row-bg` (per row) | `panel` · hover `--hover` · selected `--tint-soft` · selected and hovered mix(accent 12%, panel) · open `--tint` with a 3px accent edge | Table row states; the table component sets it per row, so it is not in `tokens.css` |

The minimum browsers for nested `color-mix(in oklab)` are Chrome 111, Safari 16.2 and Firefox 113.

The scoped palette preview (10.11) uses the same formulas: derived tokens apply to `:root` **and** `[data-palette-scope]`. The preview sets the 9 keys and `data-theme`/`data-band` on its scope and gets the same formulas, never a copy.

**Chart colors.** The design preview has four (`--c1` accent · `--c2` status-info · `--c3` status-wait · `--c4` mix(muted 55%, panel2)); 1.7.0 charts need up to eight series. v2 defines eight instead, from the accent and the status tokens (Phase 3 ruling). Each must reach 3:1 against `panel` (non-text contrast) in all 36 modes (2.6). Phase 5a assigns them (below).

| Token | Formula |
| --- | --- |
| `--chart-1` | accent |
| `--chart-2` | status-info |
| `--chart-3` | status-wait |
| `--chart-4` | status-warn |
| `--chart-5` | status-error |
| `--chart-6` | mix(accent 50%, status-info) |
| `--chart-7` | mix(accent 50%, status-warn) |
| `--chart-8` | mix(status-info 50%, status-error) |

`status-ok` is not a series of its own: in default dark mode it equals the accent.

**Assignment** (Phase 5a, ruling R-F). Each distribution row draws a bar of its own in `--chart-1`; the Unknown row uses `--muted`. The media server matching bar stacks its four groups in status colors: Matched `--status-ok`, Not found `--status-error`, Needs review `--status-warn`, Not checked `--muted`. User tag colors color the tag in a row, never its bar. The stacked 1.7.0 distribution bar goes, so no row needs a series color of its own. Every bar repeats a count and a percent that stand beside it as text, so WCAG 1.4.11 does not bind the bars. `--chart-2` … `--chart-8` stay defined, contrast-checked and reserved; Phase 5b or 6 decides whether they stay.

#### 2.3 Accent band

The **Accent band: Strong | Muted** setting lives in Display → General → Appearance as a compact segmented control. Without a stored choice, dark mode uses Muted and light mode uses Strong. A choice applies to both modes and can be withdrawn with a “use default” action; a hint explains the default and that one choice applies to dark and light. The choice is stored only in `localStorage` under `scopearr-band` (10.1). The resolved value is always set as `data-band="strong|muted"` on `:root`, with the default resolved by JavaScript.

| | Strong (both modes) | Muted dark | Muted light |
| --- | --- | --- | --- |
| `--band-1` | accent | mix(accent 34%, bg) | mix(accent 22%, bg) |
| `--band-2` | accent-2 | mix(mix(accent 70%, status-info) 24%, bg) | mix(mix(accent 70%, status-info) 16%, bg) |
| `--band-ink` | accent-text | text | text |
| `--band-soft` | 88% | 88% | 94% |

- `--band-ink-soft` = mix(band-ink `--band-soft`, band-1), for breadcrumbs and the page summary.
- `--band-bg` = `radial-gradient(120% 140% at 100% 0%, mix(band-ink 8%, transparent) 0%, transparent 46%)` over `linear-gradient(110deg, band-1 8%, band-2 100%)`.
- `--band-edge` = `inset 0 -1px 0` mix(band-ink 10%, transparent), the lower inner edge of the band.
- The focus ring on the band and in the transparent topbar uses `--band-ink`.

Calculated contrast over 18 palettes × 2 modes × 2 styles has a minimum of 4.61:1 (Muted light, breadcrumbs).

#### 2.4 Status and tone surfaces

A component sets `--tone` to ok, warn, wait, error or info (`running` uses info, `neutral` uses muted). The component defines the mix:

| Component | Background | Text and border |
| --- | --- | --- |
| Status tag | mix(tone 12%, panel) | Text mix(tone 70%, text); 6px dot in `tone` (running: pulses) |
| Notice | mix(tone 10%, panel) | Text mix(tone 45%, text); inner border mix(tone 22%, transparent); icon in `tone` |
| Badge | mix(tone 14%, panel) | Text mix(tone 70%, text); inner border mix(tone 32%, transparent) |
| Tile tone, toast icon | mix(tone 14%, panel) | Icon in `tone` |
| Row mark, disk source | mix(tone 12%, panel) | Icon in `tone`, or text mix(warn 75%, text) with border mix(warn 25%, transparent); the accent mark uses `--accent-ink` on `--tint` |
| Excluded filter chip | mix(error 12%, panel) | Field name mix(error 80%, text), value `text` |
| Danger button | Hover mix(error 10%, panel) | Text mix(error 80%, text); border mix(error 40%, line) |
| Row marking | – | `inset 3px 0 0` (`--stripe`) in warn (a metadata or rule conflict), else info (incomplete metadata), or accent (open) |

#### 2.5 Media tags, custom tags, track chip and disk tags

- **Media tags** are fixed and do not depend on the palette. Each mode has a background and foreground for resolution, r2160p/r4320p, r720p, codec, source, processing, hdr and audio, with the 1.7.0 values from `library.css` and `responsive.css`. They are tokens `--tag-<key>-bg` and `--tag-<key>-fg` in **one** file (`styles/v2/tokens.css`, under `[data-theme="light"]` and `[data-theme="dark"]`): `--tag-resolution-bg`, `--tag-resolution-fg`, `--tag-r2160p-bg`, `--tag-r2160p-fg` (also r4320p), `--tag-r720p-bg`, `--tag-r720p-fg`, `--tag-codec-bg`, `--tag-codec-fg`, `--tag-source-bg`, `--tag-source-fg`, `--tag-processing-bg`, `--tag-processing-fg`, `--tag-hdr-bg`, `--tag-hdr-fg`, `--tag-audio-bg` and `--tag-audio-fg`. Light audio is `#244a5a` on `#a1cddd` as in 1.7.0; the design preview's lighter value was a drift. The 1.7.0 per-tag border colors get no token. `unknown` is muted on panel2 at weight 500 (palette keys, no token).
- **Neutral tone:** `--tag-neutral-bg` (`panel2`) with `--tag-neutral-fg` (`text`) and a `line-soft` edge, defined with the derived colors so it follows palette and mode. **SDR** shows the HDR value in it (`neutral`, at weight 500 as in the design preview), and so do the kinds without a palette of their own (bit depth, channels, language and any other) and a custom tag without a user color. 1.7.0 gave those the inline default `#b0bbc5` in both modes, a light chip in dark mode beside the dark media palette (ruling P11/M5). The pair is contrast-checked (2.6).
- **`MediaTag` and the 1.7.0 `Tag`** share one pure function, `tagPresentation()` (`tag-display.ts`), so both decide alike: with `respectHidden` a hidden value renders nothing; an information-only value renders as plain text (`span.v2-tag-text`, `text`); with the SD group (`groupSD`) every SD resolution shows as SD with its real value in `title`; the label comes from the tag labels, the custom tag names or the catalog (“Unknown” when empty); a user color (Settings → Display → Colors) sets only the background and the text color inline, the text color being the user's or black or white by luminance as in 1.7.0 (`colorStyle`), and never `--tag-border`. Without a user color `MediaTag` (`components/list/MediaTag.tsx`) reads `--tag-<k>-bg` and `--tag-<k>-fg`, or the neutral tone. The 1.7.0 `Tag` (`components/Tag.tsx`, outside `ui.tsx`, so the start chunk carries neither it nor `tagPresentation`, ruling P1) keeps its DOM until its last user goes (Phase 5d).
- **Custom tags** use the user color `--ct` and mix in `srgb`. Dark: text mix(ct 45%, text), background mix(ct 16%, panel), border mix(ct 38%, transparent). Light: text mix(ct 18%, text), background mix(ct 22%, panel). A user text color (black or white) replaces the mixed text, as in 1.7.0. User colors are user data and are not contrast-checked.
- **Track chip:** every segment uses `--tag-audio-bg` and `--tag-audio-fg`; frame and 1px dividers use mix(tag-audio-fg 30%, transparent); hover and open use the full `tag-audio-fg`. Without a track assignment the chip is transparent with `text`, and frame and dividers are dashed in mix(muted 80%, transparent). Its codec and channels segments keep the media tag rules of the 1.7.0 audio and channels cells (`tagPresentation` with `respectHidden`, ruling P4): a hidden value leaves its segment out, an information-only value (or one outside the visible list) shows as plain text in its segment (`text`, no surface), a user audio or channels color colors its segment (background and text inline, as `MediaTag`; no 1.7.0 default color), and a tag label replaces its text. An unknown part (language, codec or channels) is muted like `unknown`: `panel2` with `muted` at weight 500. The flag is the 1.7.0 `LanguageFlag`, so a user language color stays its edge. The segments carry the surface and the chip draws the frame, so the chip needs no overflow clip and its touch hit area stays whole.
- **Disk tags:** a target uses the accent (`--accent-ink` on `--tint`, border mix(accent 25%, transparent)); a source uses the warning tone (2.4). Both are monospace and show only the disk name.

#### 2.6 Contrast pairs

An automated test checks every pair in all 36 modes (18 palettes × light and dark):

| Foreground | Backgrounds | Minimum |
| --- | --- | --- |
| `--text` | bg, panel, `--thead`, `--hover`, `--tint-soft`, selected and hovered, `--tint`, `--field-bg` | 4.5 |
| `--muted` | bg, panel, panel2, `--thead` | 4.5 |
| `--muted-strong` | `--hover`, `--tint-soft`, selected and hovered, `--tint` | 4.5 |
| `--accent-text` | accent, accent-2, end of `--grad-btn` | 4.5 |
| `--band-ink` | band-1, band-2, middle (srgb 50%), band-2 with the radial light – per style and mode | 4.5 |
| `--band-ink-soft` | band-1, middle – per style and mode | 4.5 |
| Status text (status tag, notice, danger button) | its background from 2.4, per status | 4.5 |
| Excluded filter chip: field name mix(error 80%, text) and value `text` | its background from 2.4 | 4.5 |
| `--field-border` | `--field-bg` and panel | 3.0 |
| `--chart-1` … `--chart-8` (Phase 3 ruling, non-text) | panel | 3.0 |
| `--tag-neutral-fg` (ruling P11/M5) | `--tag-neutral-bg` | 4.5 |

When a pair fails, the formula changes (a design decision), never the threshold and never a palette. `--muted-strong` exists because `--muted` on the accent tint of hovered or selected rows dropped to 4.09–4.58:1 in default dark mode; its measured minimum is 5.32:1 over all 36 modes on every surface it is used on; on exactly the surfaces in the table above the contrast test measures at least 5.42:1. The neutral tag tone measures at least 6.31:1, the excluded filter chip at least 5.15:1 (its field name in Nord dark).

### 3. Typography

The typeface is **Inter Variable**, self-hosted as woff2 (Latin and Latin-ext, SIL OFL 1.1), the same files the design was measured with. It was declared in Phase 3 and is **active from Phase 4**. The files live in `web/src/fonts/` (Vite hashes them into `/assets/`); the license is `web/public/fonts/LICENSE-Inter.txt`. `styles/v2/fonts.css` holds only the two `@font-face` rules: family **`"Inter Variable"`**, `font-weight: 100 900`, `font-display: swap` and the Fontsource `unicode-range`. The family name must differ from `Inter`, which the 1.7.0 stack names: a face under that name would apply at once.

- `--font`: `"Inter Variable"`, then `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`; with `font-feature-settings: "cv11", "ss01"`, `font-synthesis: none` and antialiasing.
- **Activation:** `index.html` puts the class `v2-root` on `<html>`. Its one rule in `styles/v2/base.css` (layer `base`) sets `font-family: var(--font)`, the features above, `font-synthesis: none` and antialiasing. It sets **no** `font-size`, so 1.7.0 sizes stay as they are. The layer `base` beats the 1.7.0 `:root` stack, and the page inherits the family, 1.7.0 content included. It is the only `font-family` declaration that reads `--font`, and the family name stands only in the value of `--font`.
- **First render:** `fontsReady(timeout = 1000)` in `main.tsx` loads the face named by `--font` (`document.fonts.load`) and waits for it, at most 1 s, together with the locale. Column widths that `tool-table.ts` measures with the body font are then measured with Inter. A face that fails or takes longer renders with the fallback stack and swaps in later (`font-display: swap`).
- `--mono`: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` (one token instead of three copies).
- Numbers in tables, counters, progress and KPIs use `tabular-nums`.

| Token | Size | Role |
| --- | --- | --- |
| `--fs-2xs` | 10.5px | Group labels, counters, track chip, mini labels |
| `--fs-xs` | 11.5px | Sub-lines, hints, status tag |
| `--fs-sm` | 12.5px | Table cells, small buttons, field labels, breadcrumbs |
| `--fs-md` | 13px | Buttons, inputs, menus, row titles, notices |
| `--fs-base` | 14px | Running text (`body`; 13px on phones) |
| `--fs-lg` | 15px | Card and drawer titles |
| `--fs-xl` | 18px | Dialog and section titles |
| `--fs-2xl` | 24px | Compact KPI value, ring value |
| `--fs-kpi` | 28px | KPI value (26px on phones) |
| `--fs-page` | 24px | Page title on the band (21px on phones) |

The phone sizes are overrides of the same tokens in the phone block of `tokens.css` (`@media (max-width: 739px)`): `--fs-base` 13px, `--fs-kpi` 26px and `--fs-page` 21px, with the page header's line heights `--lh-page-title` 28px and `--lh-page-sum` 18px.

Fixed special sizes are component tokens, used only in these components:

| Token | Size | Component |
| --- | --- | --- |
| `--fs-thead` | 10px | Table header (uppercase) |
| `--fs-tag` | 11px | Tag and custom tag |
| `--fs-nav` | 13.5px | Sidebar entry |
| `--fs-tabbar` | 10px | Mobile tab bar label |
| `--fs-tabbar-fit` | 9.5px | Mobile tab bar label when narrow |
| `--fs-plaque` | 9.5px | Plaques (counters on sidebar, bell, tab bar) |
| `--fs-mono` | 12px | Monospace (paths, textareas) |
| `--fs-mono-sm` | 11.5px | Small monospace (rename lists) |
| `--fs-mono-xs` | 11px | Smallest monospace |
| `--fs-badge` | 10px | Badge |
| `--fs-mark` | 8px | Auto mark of a custom tag |
| `--fs-brand` | 28px | Product name on the sign-in band (11.5) |

- **Weights:** `--w-reg` 400 · `--w-med` 500 · `--w-semi` 600 · `--w-bold` 700, plus `--w-label` 550 (field labels), `--w-title` 650 (card, dialog, drawer and section titles) and `--w-heavy` 800 (auto mark of a custom tag).
- **Letter spacing:** `--ls-caps` .07em (mini labels); `--ls-thead` .04em (table header); `--ls-group` .08em (group labels and flyout header); `--ls-title` −0.01em (titles); `--ls-display` −0.02em (page title and KPI).
- **Line height:** `--lh-text` 1.5 (text); `--lh-page-title` 32px (28 on phones); `--lh-page-sum` 20px (page summary; 18 on phones); `--lh-kpi` 36px; `--lh-row-title` 18px; `--lh-sub` 15px (sub-line); `--lh-brand` 34px (product name on the sign-in band).

This scale replaces a scale closer to 1.7.0 because it was measured: with Inter, the movie table at 1440px with the rail, including audio tracks and custom tags, fits 1318/1318px without horizontal scrolling. **Invariant:** standard columns fit at 1440px (rail) in all four languages without horizontal scrolling, checked automatically (es and it are still unmeasured at 1440px; Phase 5a measures them).

### 4. Spacing, radii, sizes and layout geometry

The v2 names (`--sp-*`, `--r-*`, `--ctl-*`, `--fs-*`, `--t-*`) never collide with 1.7.0 tokens, so both systems coexist until Phase 5; the 1.7.0 names disappear with the 1.7.0 CSS.

**Spacing** (4px base): `--sp-1` 4 · `--sp-2` 8 · `--sp-3` 12 · `--sp-4` 16 · `--sp-5` 20 · `--sp-6` 24 · `--sp-8` 32. Page blocks `--sp-4`; form grids `--sp-4`; toolbars and actions `--sp-2`; card header 16/20, card body 4/20/20 (16 on phones); modal 24 (16 on phones).

**Radii**

| Token | Value | For |
| --- | --- | --- |
| `--r-xs` | 6px | Tag, status tag, custom tag, track chip, mark icon, xs icon button, sort button, focus rounding |
| `--r-sm` | 8px | Button, input, 32px tile, row button, menu and flyout entry, segment button, palette tile, column entry |
| `--r-md` | 12px | KPI and disk card, inner box, menu/popover/flyout, toast, notice, navigation entry, 48px tile |
| `--r-lg` | 16px | Card, sidebar card, band, modal, drawer |
| `--r-pill` | 999px | Counter, chip, badge, demo and sync pill, switch; pagination buttons are round (50%) |

Component radii: `--r-frame` 10 (segment frame, 40px tile, sidebar home and sub-entry) · `--r-topbar` 14 · `--r-tabbar` 18 (mobile tab bar) and `--r-tabbar-tile` 9 (its tile) · `--r-band-phone` 24 (band bottom on phones) · `--r-bar` 3 (bars) · `--r-check` 5 (checkbox) · `--r-mark` 3 (auto mark of a custom tag, flag of a track chip). Cards get 16, not 12: card, band and modal share 16, inner elements are one step smaller.

**Heights**

| Token | Value | For |
| --- | --- | --- |
| `--ctl-lg` | 40px | `lg` button and input |
| `--ctl-md` | 36px | Button, **input and select** (default), topbar icon, flyout and menu entry |
| `--ctl-sm` | 30px | `sm` button, segment button, page size |
| `--ctl-xs` | 24px | xs icon button |
| `--touch` | 44px | Target under `pointer: coarse` |

**Other sizes** (component tokens, used only in their components):

| Token | Value | For |
| --- | --- | --- |
| `--btn-xs` | 26px | `xs` button |
| `--icon-btn` | 32px | Icon button |
| `--icon-btn-sm` | 28px | `sm` icon button, toast close button |
| `--row-btn` | 28px | Row button (framed tile) |
| `--row-btn-sm` | 24px | `sm` row button |
| `--page-btn` | 34px | Pagination button |
| `--chip-h` | 28px | Filter chip |
| `--tag-h` | 22px | Tag, status tag, counter, custom tag |
| `--tag-h-season` | 20px | Tag in a season row |
| `--track-chip-h` | 24px | Track chip |
| `--track-flag-w` | 16px | Flag in a track chip (16 × 11, as in the design preview) |
| `--track-flag-h` | 11px | Flag in a track chip |
| `--track-ch-min` | 38px | Channels segment of a stretched (stacked) track chip, so the dividers of a stack line up |
| `--tab-h` | 40px | Tab |
| `--check` | 16px | Checkbox and radio |
| `--check-touch` | 20px | Checkbox and radio under `pointer: coarse` |
| `--switch-w` | 36px | Switch width |
| `--switch-h` | 20px | Switch height |
| `--field-compact` | 32px | Compact fields in the filter area and the log |
| `--field-rename` | 30px | Rename field |
| `--count-in-btn` | 18px | Count inside a button |
| `--count-in-btn-w` | 24px | Slot of a count inside a button, at least two digits wide, so a count from 9 to 10 moves nothing (the Filters button and the page tools of the chips row) |
| `--badge-h` | 18px | Badge |
| `--plaque` | 16px | Plaque (counter on sidebar, bell and tab bar) |
| `--dot` | 8px | Dot (legend, status) |
| `--dot-sm` | 6px | Dot in a status tag and a sidebar sub-entry |
| `--auto-mark` | 12px | Auto mark of a custom tag (12 × 12) |
| `--textarea-min` | 88px | Minimum textarea height |
| `--check-border` | 1.5px | Checkbox and radio border |
| `--sort-btn` | 28px | Sort button in a table header |
| `--row-mark` | 20px | Row mark: title marks and outlier marks (10.7) |
| `--palette-tile-h` | 42px | Palette tile |
| `--order-item-h` | 46px | Entry of the column order editor |
| `--stripe` | 3px | Accent stripe: tab underline, edge of an open row, `inset 3px` row edge (conflict, incomplete) |
| `--outline-w` | 2px | Focus ring width and offset (12), ring of the selected palette tile |
| `--lift-kpi` | 2px | Hover lift of a KPI card (6) |
| `--glyph` | 16px | A glyph drawn in CSS: the eye of the password toggle (10.4), the size of `ICON.button` |

**Component spacing** (values off the 4px scale):

| Token | Value | For |
| --- | --- | --- |
| `--field-gap` | 6px | Field label to control |
| `--check-gap` | 10px | Checkbox or radio to its label |
| `--tag-pad` | 7px | Horizontal padding of a tag and a custom tag |
| `--box-pad` | 12px 14px | Padding of `Card inset` and `Notice` |
| `--input-icon-x` | 11px | Prefix icon of an input group, from the left |
| `--input-icon-pad` | 34px | Field padding beside a prefix icon |
| `--modal-head-pad` | 18px 16px 14px 24px | Modal header padding |

Inputs are 36, not 40, so the filter row and buttons share one height.

**Row density** (Phase 5a). Comfortable rows are 48px (`--row-h`); compact rows are 40px (`--row-compact`, Phase 3 ruling); under `pointer: coarse` both are 56, as the touch block sets both tokens. Comfortable is the default. The choice is a browser preference, never a stored setting: Display → General offers “Row density” (Comfortable | Compact), saved with Save settings like the interface language, into `scopearr-density` in `localStorage` only (10.1). The table card carries it as `data-density`. It applies to Movies and TV series; the tool tables follow in Phase 5b, and until Phase 5c the switch sits in the 1.7.0 layout of Display.

**Layout tokens** (structural):

| Token | Value |
| --- | --- |
| `--sb-w` | 260 (expanded sidebar) |
| `--sb-rail` | 72 (rail) |
| `--sb-drawer` | 300 (drawer sidebar; at most the viewport width minus 48) |
| `--edge` | 16 (12 on phones) |
| `--topbar-h` | 52 |
| `--ph-h` | 70 (114 on phones) |
| `--overlap` | 64 (48 on phones) |
| `--bar-gap` | 8 (6 on phones): gap above the sticky topbar |
| `--band-h` | `--bar-gap` + topbar + page header + overlap = 194 (phones 6 + 52 + 114 + 48 = 220) |
| `--stat-h` | 84 |
| `--row-h` | 48 (touch 56) |
| `--row-compact` | 40 (compact density; touch 56) |

Only the phone and touch values change by media query, and only as overrides of tokens defined on `:root`: `@media (max-width: 739px)` sets `--fs-base`, `--fs-kpi`, `--fs-page`, `--lh-page-title`, `--lh-page-sum`, `--edge`, `--ph-h`, `--overlap`, `--bar-gap`, `--band-h`, `--content-bottom`, `--toast-top` and `--ring-size`; `@media (pointer: coarse)` sets `--row-h`, `--row-compact` and `--thead-h`. Phone font sizes are overrides of the same tokens (3), not component values.

**Further fixed geometry** is a component token too. The 61 `--layout-*` tokens disappear with the 1.7.0 CSS. Until then each one is read by a 1.7.0 rule or a source (13); a deletion that leaves one unread removes it in the same commit.

Frame (10.1):

| Token | Value | For |
| --- | --- | --- |
| `--tile` | 32px | Icon tile 32 (sidebar entry) |
| `--tile-md` | 40px | Icon tile 40 (service, disk card) |
| `--tile-lg` | 48px | Icon tile 48 |
| `--brand-h` | 68px | Sidebar brand row |
| `--nav-group-h` | 34px | Sidebar group label |
| `--nav-group-rail-h` | 22px | Sidebar group label in the rail |
| `--nav-item-h` | 46px | Sidebar entry |
| `--nav-sub-h` | 34px | Sidebar sub-entry |
| `--fly-item-h` | 36px | Flyout entry |
| `--fly-min` | 212px | Flyout minimum width |
| `--fly-max` | 280px | Flyout maximum width |
| `--tabbar-h` | 64px | Mobile tab bar |
| `--tabbar-tile-w` | 30px | Active tab bar tile width |
| `--tabbar-tile-h` | 26px | Active tab bar tile height |
| `--ph-actions-h` | 40px | Page header action row on phones |
| `--content-bottom` | 48px (100 on phones, plus the safe area) | Space below the content |
| `--toast-top` | 80px (64 on phones) | Toast region below the topbar |
| `--topbar-mark` | 26px | Brand mark in the phone topbar |
| `--sync-chip-text` | 184px | Text of the sync chip (fixed, so a state change moves nothing) |

Tables and cards (10.2, 10.10):

| Token | Value | For |
| --- | --- | --- |
| `--thead-h` | 38px (44 under `pointer: coarse`) | Table header |
| `--season-row-h` | 34px | Season row |
| `--group-row-h` | 42px | Group row |
| `--chips-h` | 48px | Chips row |
| `--card-head-min` | 60px | Card header, minimum |
| `--card-foot-min` | 56px | Card footer, minimum |
| `--kv-row-min` | 40px | `kv2` row, minimum |
| `--kv-label-min` | 120px | `kv2` label, minimum width |
| `--kv-label-max` | 170px | `kv2` label, maximum width |
| `--select-col` | 44px | Selection column of a table (page, series and season checkboxes) |
| `--title-col-min` | 200px | Title column, minimum width |
| `--card-cell` | 100px | A cell of a card row (V15), minimum width: the narrow card's grid has as many of these columns as fit (3 at 375, 2 at 320, 5 at a 560 card); the Info buttons (three 28 buttons, 92) fit one |

Overlays (10.5, 10.8, 10.9):

| Token | Value | For |
| --- | --- | --- |
| `--drawer-w` | 420px | Filter drawer |
| `--ff-label` | 108px | Label column of a filter drawer field (10.5) |
| `--modal-w` | 480px | Modal |
| `--modal-w-md` | 640px | `md` modal |
| `--modal-w-lg` | 1040px | `lg` modal |
| `--file-dialog-h` | 800px | File & metadata dialog height |
| `--toast-w` | 380px | Toast |
| `--pop-min` | 220px | Popover and menu, minimum width |
| `--pop-max` | 360px | Popover and menu, maximum width |
| `--pop-track` | 460px | Track popover |
| `--qs-w` | 620px | Quick search, width (at most the viewport minus 32) |
| `--qs-top` | 12vh | Quick search, distance from the top |
| `--qs-h` | `min(600px, 100dvh − 2 × --qs-top)` | Quick search, height (fixed, whatever it lists) |
| `--qs-field-h` | 56px | Quick search, height of its field |

Other geometry (10.5, 10.10, 11):

| Token | Value | For |
| --- | --- | --- |
| `--search-w` | 260px | Search field |
| `--search-w-narrow` | 240px | Search field below 1600 |
| `--preset-w` | 184px | Preset select |
| `--kpi-min` | 118px | KPI card, minimum height |
| `--ring-size` | 128px (112 on phones) | Storage ring |
| `--ring-stroke` | 12px | Storage ring, stroke width |
| `--tab-panel-min` | 420px | Tab panel, minimum height |
| `--progress-h` | 6px | Progress bar |
| `--progress-thin` | 4px | Thin progress bar |
| `--progress-dist` | 8px | Distribution bar |
| `--percent-slot` | 36px | Percent slot of a progress bar |
| `--dist-percent` | 52px | Percent of a distribution row |
| `--dist-row-h` | 50px | Distribution row, measured from the design preview's `.dist-row`: padding 7, a 22 tag, a gap of 6, the 8 bar, padding 7 (its flag rows are 49 and get the same height) |
| `--dist-body-min` | 6 × `--dist-row-h` (300px) | Distribution card body, minimum: five rows and the More row, reserved also when there is no More |
| `--terminal-max` | 50dvh | Terminal, maximum height |

Sign-in, setup and the loading screen (11.5, 10.8):

| Token | Value | For |
| --- | --- | --- |
| `--login-screen` | 100dvh | Minimum height of the sign-in page and the loading screen |
| `--login-top` | 72px | Top padding of both: the app icon's top edge |
| `--login-icon` | 72px | App icon on the sign-in band and the loading screen |
| `--login-band-h` | 46vh | Sign-in band height … |
| `--login-band-min` | 300px | … at least this |
| `--login-w` | 400px | Sign-in card width (at most the page width) |
| `--login-pad` | 28px | Sign-in card padding, the space below the brand and above the footer |

**Exceptions** to principle 6 (no token): Lucide icon sizes (`ICON` in TSX, section 12); timing constants in JavaScript (flyout 150/220ms, the 4px scroll threshold and the 4px page offset); the popover's placement in JavaScript (6px from its anchor, at least 8px inside the viewport); icon and terminal colors (the app icon, the dark terminal); the lucide path data of a glyph drawn in CSS (the password toggle's eye, and the check and minus of `v2-check`, 10.4); media tag palettes and the user colors of tags, custom tags, warning marks and the storage ring (2.5, 10.7, 10.10; user data); percentages and aspect ratios; 0 and 1px; `z-index` 0, 1 and −1 (the transition sheet below the content); 0.01ms under reduced motion (6); and the media and container query widths (8: 1599 · 1279 · 1119 · 899 · 739 · 359 and 1060 · 760 · 560), because a query cannot read `var()`. Every other fixed value in this part is a token of sections 2–7.

### 5. Elevation

| Token | Light | Dark | For |
| --- | --- | --- | --- |
| `--shadow-card` | `0 1px 2px` text 6% + `0 6px 16px -6px` text 14% | `0 12px 28px -18px` bg 92% | Cards |
| `--shadow-float` | `0 2px 6px` text 6% + `0 24px 48px -16px` text 22% | `0 24px 48px -20px` bg 96% | Sidebar, flyout, menu, popover, toast, modal, drawer |
| `--shadow-btn` | `0 4px 7px -1px` text 12% + `0 2px 4px -1px` text 8% | `0 4px 10px -4px` bg 90% | Primary, active segments, tile hover |
| `--shadow-btn-hover` | `0 8px 16px -4px` text 18% + `0 3px 6px -2px` text 10% | `0 10px 18px -6px` bg 96% | Hover of primary and KPI |
| `--shadow-glass` | inner edge panel 80% + `0 18px 28px -12px` text 16% | inner edge `line-soft` + `0 18px 32px -16px` bg 96% | Topbar after scrolling, tab bar |
| `--shadow-tile` | `0 4px 10px -3px` accent 50% | `0 4px 12px -4px` accent 38% | Accent glow under gradient tiles, active page |

Shadow colors are mixes with `transparent`, so they follow the palette. The light secondary button uses border mix(line 80%, muted) and `0 1px 2px` text 6%. Under `forced-colors`, select, checkbox and radio use native rendering and visible borders remain (the approved design does not style this mode). A marker drawn only by a background, a gradient or a shadow, which forced colors drop, also sets a transparent `--outline-w` outline, which forced colors paint: the sign-in fields' focus (in every mode, where it draws nothing) and, in `@media (forced-colors: active)` only, quick search's focused field and active option and the current page's gradient tile in the rail and the tab bar (an outline there, even a transparent one, changed how the tab tile's icon rasterized), and in the lists the current segment, the current page of the pager and an open row button (Phase 5a). These carry it inset (offset −2) and only while they have no keyboard focus (`:not(:focus-visible)`); focused, they show the focus ring outside (12), so focus stays visible on the current item.

### 6. Motion

- `--t-fast` 150ms: hover, focus, color, page content.
- `--t-mid` 250ms: menus, popovers, flyouts, modals, drawers, topbar glass, groups.
- `--t-slow` 400ms: sidebar width, drawer sidebar.
- Animations: `--t-ring` 800ms (ring), `--t-bar` 600ms (bar), `--t-spin` 1s (spinner, linear), `--t-pulse` 1s and `--t-pulse-slow` 1.4s (pulses).
- **One** curve: `--ease` `cubic-bezier(.2,.7,.2,1)`.

A page change fades the content in over 150ms with a 4px offset; sidebar, topbar and tab bar stay in place. A flyout opens after 150ms and closes 220ms after the pointer leaves. Buttons, pagination and palette tiles lift by 1px on hover, KPI cards by 2px (`--lift-kpi`); row buttons and ghost buttons do not lift. Ring 800ms, bar 600ms, spinner 1s linear, pulse 1s/1.4s. Under `prefers-reduced-motion: reduce` every duration is 0.01ms.

### 7. Layers (z-index)

`--z-topbar` 20 · `--z-sidebar` 30 · `--z-fly` 32 · `--z-tabbar` 34 · `--z-modal` 50 (drawer sidebar, overlays) · `--z-popover` 55 · `--z-toast` 60 · `--z-skip` 100. A sticky table header uses `--z-sticky` 2 inside its card. Modals stay native `dialog` elements in the top layer (`Modal.tsx`, `dialog-stack.ts`, `fitViewport`); a popover opened from a modal renders inside that `dialog`. These layers replace the 1.7.0 values 1/2/3/10/20/30/35/40/100/10000.

### 8. Breakpoints and containers

v2 width thresholds use `max-width`, widest first, with one block per threshold and file: **1599 · 1279 · 1119 · 899 · 739 · 359**. TableCard container queries use **1060 · 760 · 560**. Other supported queries: `pointer: coarse`, `prefers-reduced-motion` and `forced-colors`. These thresholds apply only to v2 rules; 1.7.0 CSS keeps its own list (Part 2), and the stylesheet guards check both separately.

These thresholds replace the 1.7.0 list because 1280 (demo text, dashboard rows) and 360 (short labels) were measured as necessary. 600 disappears: the 1.7.0 behavior “narrow tool tables show Details instead of actions” applies at the phone boundary 739 (verified in Phase 5b).

| Width | Sidebar | Band | First card |
| --- | --- | --- | --- |
| ≥ 1600 | expanded 260 (default) | 194 | y = 146 |
| 1120–1599 | rail 72 (default), expandable by its button (the table then scrolls inside its card) | 194 | y = 146 |
| 740–1119 | rail 72 | 194 | y = 146 |
| ≤ 739 | drawer and tab bar | 220 | y = 172 |

There is no page overflow from 320 to 1600px; tables scroll only inside their card. Under `pointer: coarse`, targets are 44 (icon buttons, buttons, pagination, fields, table header, tabs, menu entries), rows are 56, and compact targets get an invisible 44px hit area without a layout change. In the lower group rows of TV series (series 42, season 34) the selection box's hit area is as high as its row (at least 24, WCAG 2.5.8), so it covers no other row's box.

### 9. Stylesheet architecture

`web/src/style.css` starts with the layer statement:

```css
@layer legacy, tokens, base, shell, recipes, pages, responsive;
```

All nine 1.7.0 stylesheets load in today's order with `@import … layer(legacy)`. v2 files load into their own layer: `styles/v2/tokens.css` and `styles/v2/fonts.css` into `layer(tokens)`, later rule files into `base`, `shell`, `recipes`, `pages` or `responsive`. Empty layers stay declared. No CSS is unlayered. A guard checks that the `layer(legacy)` imports equal `LEGACY_STYLESHEETS` (`web/test/helpers/legacy-styles.mjs`), so a new 1.7.0 sheet cannot escape the 1.7.0 guards, and that the v2 imports equal `V2_SHEETS` (`web/test/stylesheet-guards.test.mjs`) in file, layer and order, so a new v2 file needs its entry first.

The production build minifies with Lightning CSS. It drops the leading layer statement, moves the layer blocks into the declared order and emits the still-empty layers as a trailing statement (`@layer legacy{…}@layer tokens{…}@layer base,shell,recipes,pages,responsive;`). The cascade depends only on the order in which layer names first appear, so the guard checks that order in the built CSS, and that every rule sits in a layer.

`legacy` is the lowest layer. Within one layer, specificity and order decide as before, so the 1.7.0 interface renders unchanged. From Phase 4 on, v2 rules win without specificity fights, and 1.7.0 element resets (`input`, `button`, `label` …) cannot override v2 components. Unlayered 1.7.0 CSS would beat every layer.

Folder `web/src/styles/v2/`:

- `tokens.css` – custom properties only (sections 2–7): sizes on `:root`, derived colors and the Strong band on `:root, [data-palette-scope]`, mode-dependent fields, card edge, shadows and media tags on `[data-theme=…]`, the Muted band on `[data-band="muted"][data-theme=…]`, then the phone and touch blocks.
- `fonts.css` – the two `@font-face` rules only (3).
- `base.css` – layer `base`: `.v2-root` on `<html>` (3), `.v2-sr-only`, the focus ring of every v2 element (12) and reduced motion for v2 elements (6).
- `shell.css` – layer `shell`: the frame (10.1). It places recipes but never sets a property a recipe owns: the higher layer `recipes` would win regardless of specificity.
- `recipes.css` – layer `recipes`: the general building blocks and their variants as modifier classes (`v2-tile--grad`). It owns the class families `v2-tile`, `v2-card`, `v2-btn`, `v2-icon-btn`, `v2-field`, `v2-input` (with `v2-input-group`, `v2-input-icon` and `v2-reveal`), `v2-count`, `v2-plaque`, `v2-dot`, `v2-pill`, `v2-notice`, `v2-spin`, `v2-pop` (with its width variants `v2-pop--wide` and `v2-pop--track`), `v2-menu`, the jobs menu (`v2-jobs`, `v2-job`) and quick search (`v2-qs`). A recipe sets its look and size, never its placement (margins, offsets).
- `data.css` – layer `recipes` as well, imported right after `recipes.css` (Phase 5a): the building blocks of the lists and the dashboard. It owns exactly these class families:
  - controls: `v2-row-btn`, `v2-text-btn`, `v2-check`, `v2-select`, `v2-seg`, `v2-kpi` and `v2-empty`;
  - filters: `v2-filter-bar`, `v2-drawer` (with `v2-drawer-head`, `v2-drawer-title`, `v2-drawer-sub`, `v2-drawer-body`, `v2-drawer-foot`, its sections `v2-drawer-sec` and their heading line `v2-drawer-h`), `v2-ff` (with `v2-ff--state`, `v2-ff-label`, the operator `v2-ff-op` and `v2-ff-op--not` with its menu symbol `v2-ff-sym`, the value button `v2-ff-value`, `v2-ff-value--on`, `v2-ff-value--not` and its summary `v2-ff-sum`, the values `v2-ff-list`, `v2-ff-opt`, `v2-ff-ph` and `v2-ff-empty`, `v2-ff-range`, `v2-ff-check`, `v2-ff-combo` and `v2-ff-hint`) and `v2-chips-row` (with `v2-chips-group` and `v2-chips-empty`);
  - tags, chips and marks: `v2-tag`, `v2-ctag`, `v2-chip` (with `v2-chip-field` and `v2-chip-x`) and `v2-mark`;
  - data blocks: `v2-table-card` (with `v2-tc-…` and `v2-table-scroll`), `v2-table` (with its cells `v2-table-sel`, `v2-table-hit`, `v2-table-title`, `v2-table-info`, `v2-table-num` and `v2-table-wide`, their lines `v2-table-line`, `v2-table-name`, `v2-table-sub` and `v2-table-items`, and its rows `v2-row`, `v2-row--selected`, `v2-row--context`, `v2-row--warn`, `v2-row--info`, `v2-row--series`, `v2-row--season`, `v2-row--outlier` and `v2-row--placeholder`), `v2-sort`, `v2-pager`, `v2-trk`, the dashboard's widget card `v2-widget` (11.3), `v2-ring`, `v2-dist` and `v2-match`.

  This list is how E25 of the Phase 5a plan reads: its data building blocks (Design 8.5, 8.7 and 8.10) and the controls that Phase 5a adds for them. A new family of these kinds goes here; a variant of a `recipes.css` family, such as `v2-pop--track` or a disabled `v2-menu-item`, stays with its family, and HelpTip has no class of its own (`v2-icon-btn` and `v2-pop`). Both files share the layer, so each selector has one owner and the order never decides; the same rule holds: look and size, never placement.
- `pages.css` – layer `pages`: page recipes. Whole screens outside the frame: sign-in and setup (11.5) and the loading screen (10.8); and the layout of rebuilt frame pages, which places their building blocks: the list page without the transition sheet (`v2-list-page`, 11.1) and the dashboard without it (`v2-dash` with `v2-dash-kpis`, `v2-dash-row`, `v2-dash-head`, `v2-dash-grid` and `v2-dash-note`, 11.3).
- Further rule files per layer, added with the phase that uses them.

Rules for v2 files while 1.7.0 CSS exists:

- A v2 rule file contains **no type selector without a v2 class** and **no `!important`** (except under reduced motion). A higher layer beats every specificity: a v2 `button { padding: 0 }` would hit every 1.7.0 button. 1.7.0 `!important` still wins against v2, which affects only 1.7.0 classes.
- v2 class names never appear in 1.7.0 CSS, and v2 selectors never use a 1.7.0 class.
- One owner per selector, a class in every selector (a class inside `:not()` or `:has()` does not count; inside `:is()`/`:where()` it counts only when every alternative has one, and an empty list has none), only tokens, and only the thresholds of section 8 (one block per threshold and file).
- Only tokens means no raw value in any declaration, keyframes included. A raw value is:
  - a length other than 0 or 1px, in any CSS length unit (`px`, `rem`, `Q`, `cap`, `rcap`, `ic`, `rlh`, `dvi`, `svb`, `cqmin` …) and in any case (`10PX` counts);
  - a duration other than 0 (durations use `--t-*`; under reduced motion 0.01ms);
  - a `z-index` other than 0, 1, −1, a `--z-*` token or `calc(var(--z-…) ± 1)`;
  - a numeric `font-weight`, also in the `font` shorthand (weights use `--w-*`);
  - a hex color, `rgb()`/`hsl()` or a named color other than `transparent`, `currentColor` or `inherit`.

  Section 4 lists the exceptions.

Token names:

- v2 uses these names: `--fs-*`, `--w-*`, `--ls-*`, `--sp-*`, `--r-*`, `--ctl-*`, `--t-*`, `--z-*`, and the layout, color and shadow tokens of sections 2–7.
- No v2 token shares a name with a 1.7.0 token, in CSS or in `"--…"` strings in TSX. A same-named token with another value (`--radius-sm` 5 → 8, `--font-sm` 12 → 12.5) would be hidden or visible depending on its layer. A TSX name that a v2 file defines and no 1.7.0 rule defines or reads is a read of the v2 token, not a 1.7.0 name.
- The 9 palette keys and 5 status tokens are only read in v2. 1.7.0 names disappear with the 1.7.0 CSS.

| 1.7.0 | 2.0.0 |
| --- | --- |
| `--font-2xs` … `--font-stat` (10/11/12/13/15/18/32) | `--fs-2xs` … `--fs-kpi` (10.5/11.5/12.5/13/14/15/18/24/28) |
| `--radius-sm`, `--radius-control`, `--radius-surface`, `--radius-modal` (5/7/10/14) | `--r-xs`, `--r-sm`, `--r-md`, `--r-lg` (6/8/12/16), `--r-pill` |
| `--control-lg/-md/-sm/-xs` (42/34/28/24), `--touch-target`, `--checkbox` | `--ctl-lg/-md/-sm/-xs` (40/36/30/24), `--touch`, checkbox 16 |
| `--space-*`, `--weight-*`, `--letter-spacing` | `--sp-*`, `--w-*`, `--ls-*` |
| `--shadow`, `--toast-shadow`, `--backdrop` | `--shadow-float` and the other `--shadow-*` tokens, `--scrim` |
| `--app-header-height`, 61 `--layout-*` | `--topbar-h`, `--band-h`, layout tokens, or removed |
| `--tool-col-*`, `--tool-row-height*` | kept until the tool rebuild (Phase 5b), then `--row-h` |

Token selectors:

- Derived tokens: `:root, [data-palette-scope]`.
- Mode-dependent tokens: `[data-theme="light"]` and `[data-theme="dark"]`.
- Band tokens: `[data-band="muted"][data-theme=…]`; without the attribute the band is Strong.
- Phone values: `@media (max-width: 739px)`; touch values: `@media (pointer: coarse)`. Both blocks only override tokens defined on `:root` (4).
- Tokens hold no shell state (no `--offset`).

### 10. Components

Each component is defined once. Format: purpose · sizes · states · what it replaces in 1.7.0.

#### 10.1 Frame and page

- **AppShell** – sidebar card, band, topbar and content, with document scrolling. Content starts at `2 × edge + sidebar width`, with `edge` at the top and 48 at the bottom (phones 100 plus the safe area). Replaces the shell parts of the 1.7.0 header.
- **Transition sheet** – while a page is still 1.7.0 (until its Phase 5 rebuild), `main.v2-main[data-sheet]` draws a `::before` in `--bg` with `--r-lg` at the top. It starts where the page header ends (y = 146, phones 172), covers the band's `--overlap` and lies under the content (`isolation: isolate`, `z-index: -1`), so 1.7.0 text never stands on the band. The 1.7.0 content has the padding `--sp-5 --sp-6` (phones `--sp-4 --sp-3`). A rebuilt page drops `data-sheet`; its first card then overlaps the band itself. This is a deliberate step away from the design, where cards reach into the band from Phase 4 on. `sheetPage(route)` (`nav-model.ts`) decides per page: `true` while the page is 1.7.0 (the tools and the settings), `false` once it is rebuilt (the libraries and the dashboard, Phase 5a). `AppShell` sets the attribute only for `true`, and then exactly as `data-sheet=""`, so the DOM of the pages that keep it does not change. Without the sheet the first card (or the setup notice, 10.8) starts at y = 146 (phones 172) and overlaps the band by `--overlap`, and `div.v2-view` has no padding (11.1).
- **Sidebar** – a floating card (`edge` inset, radius 16, `--shadow-float`). Modes: **expanded 260** (default at ≥ 1600), **rail 72** (740–1599) and **drawer** (≤ 739, with `--scrim` and a focus trap). Brand 68 high; group labels 34 (rail 22); entries 46 high with a 32px tile in `--tint`/`--icon-tint`; the active entry uses `--grad-accent`, `--accent-text`, `--shadow-tile` and `aria-current`; its parent group is marked; counters are plaques. Sub-entries are 34 high with a 6px dot (accent when active). Groups (movie instances, settings) expand **only by their arrow** and remember their state. **One** expand/collapse button sits at the bottom of the card, in the same place in both states; only its icon changes (`panel-left-close` ↔ `panel-left-open`), and its label and `aria-expanded` follow. The drawer hides it. The expanded footer holds the sync card. The sidebar state is stored in `localStorage`. The rail uses `overflow: clip` and never scrolls sideways.
- **Flyout** (rail) – labeled, radius `--r-md`, beside the rail (+ 8), a header with the group name and entries 36 high; entries without sub-entries get a label-only flyout. State machine `rail → peek (150ms) → open`, with a bridge against flicker; a click navigates and closes. Keyboard: → or Enter opens, ↑/↓ move, ← or Escape go back. Touch: the first tap opens.
- **Drawer** (≤ 739) – the same sidebar in the mode `drawer`: 300 wide (`--sb-drawer`, at most the viewport minus 48), 8 from the edges. Closed, it is hidden; open, it slides in over `--scrim` as a modal dialog (`role="dialog"`, `aria-modal`, named “Main navigation”) at `--z-modal`, with a close button in the brand row, the sync row below the brand, and theme and sign out after the navigation. Escape (with focus in it or on `body`, after a press on a part that takes no focus), the close button, the scrim and a page change close it; Tab stays inside; focus starts on the close button and returns to the control that opened it (More). It has no expand button and no footer. Sub-entries are 44 high.
- **Band** – the accent band (2.3) at the fixed height `--band-h`, radius 16 (phones: no top radius, bottom 24). It carries the topbar and the page header; the first card row overlaps it by `--overlap`.
- **Topbar** – sticky (top 8), 52 high, radius 14. It is transparent over the band in `--band-ink`; after 4px of scrolling it uses `--glass` and `--shadow-glass` with `text`. Contents: breadcrumbs (starting with Scopearr), demo pill, **sync chip** (rail mode only; when expanded the sync card takes over; below 900 only a dot; popover per service with a sync-now action), quick search (⌘K), **bell** (counter; dropdown of running and failed jobs; errors open the filtered log), theme and sign out. Demo, sync and bell never overlap (long demo text from 1280, the short form below). Phones: brand, demo, bell and theme; the title appears only after scrolling.
- **PageHeader** – on the band at the fixed height `--ph-h`: title `--fs-page`/700, summary `--fs-md` in `--band-ink-soft`, actions on the right (`on-band` buttons, `band-primary`, an `on-band` area segment for instance, System Info/Log and Display; scan progress). Phones: title 21, action row 40 high and horizontally scrollable. Replaces `.library-intro`, `.statistics-heading` and the settings heading.
- **PageStack** – a column with `--sp-4` between blocks and no local margins.
- **Demo notice** – only a pill in the topbar. Replaces the 32px demo bar.
- **Mobile TabBar** (≤ 739) – a floating glass bar, 64 high, radius 18: Dashboard, Movies, TV series, Tools (counter, menu) and More (opens the drawer with the **sync row in its header**, theme and sign out). The active tile is 30 × 26 with the gradient.

**Shell markup.** `components/AppShell.tsx` builds the frame; roles, names and these classes are the test contract:

- `div.v2-shell[data-mode]` holds, in this order: `button.v2-skip` “Skip to content” (hidden until focused; it focuses `main` and sets no `#main` hash, which would be a route), the `Sidebar`, `div.v2-frame`, the `TabBar`, outside the demo `p.v2-sr-only[aria-live="polite"]` with the bell's name (“Tools, {count} open jobs”, so a changed count is announced; outside the frame, which the open drawer makes inert; the demo starts no job, so its count never changes) and the library dialogs. `div.v2-frame` (`position: relative`, `display: flow-root`, so the topbar's top margin stays inside and the phone band starts at 0) holds `div.v2-band[aria-hidden]`, the `Topbar` and `main#main.v2-main[data-sheet][tabindex="-1"]`. `main` holds `div.v2-page-slot` (`--ph-h` high) and `div.v2-view` with the page.
- The page renders its `PageHeader`; through `PageTitleContext` (exported by `components/PageHeader.tsx`) it lands in `div.v2-page-slot` on the band, before the page content, and reports its title for the phone topbar. Outside the frame it renders in place.
- The frame comes only from the route: the sidebar from `navModel`, the topbar's breadcrumbs from `breadcrumbs`, the tab bar from `tabBarModel`, the bell from `jobsSummary`, the sync display from `syncSummary` (left out without any instance).
- **Links:** every in-app link of the frame is a `NavLink` with `href` = `linkHref(target)` whose plain click runs `openLink(target)`, which asks like Back and Forward; the frame never gets a named action. Both brands link to `#/dashboard`, so a new tab opens the dashboard there.
- Until the first `/api/settings` answer (`AppData.settingsReady`, also after an error) the shell shows the loading screen, so instance entries never arrive after the first paint. The settings' palette (`applyInterfaceTheme`) applies in a layout effect, for the first frame and for each theme change, so no painted frame shows the default accent or the other mode's palette.
- A new page (`pageKey`: view, library, tool or settings area) scrolls to 0 and fades `div.v2-view` in with the Web Animations API (150ms, 4px, `--ease`); not under reduced motion. Filter, page and tab replaces keep the position.
- While the drawer is open, `div.v2-frame` and the tab bar are `inert`; focus returns to More when it closes.
- **Overlays:** the sync chip, card and row, Quick search and the bell get their handlers from the shell and carry `aria-haspopup="dialog"` and `aria-expanded`. The sync display opens the sync popover, the bell the jobs menu and Quick search the quick search dialog (below); one overlay at a time, and an overlay's link closes it before its target opens through `openLink`. ⌘K and Ctrl+K (`isSearchKey`, `nav-link.ts`: also with Caps Lock; with Shift or Alt they stay the browser's, as Firefox opens its console with Ctrl+Shift+K and AltGr is Ctrl+Alt) open quick search from anywhere, also from a field, through a `keydown` listener on `window` (`preventDefault`), but not while a modal is open: a dialog on the dialog stack (quick search is one) or the drawer. Focus then returns to the element that had it; from an open popover, which quick search replaces, to that popover's trigger (the shell's overlay's anchor, else the tab bar's expanded Tools button); from the rail's flyout, which closes when focus leaves it, to its entry (`[aria-controls="v2-fly"][aria-expanded="true"]`).
- Toasts (`v2-toasts` on the toast region) sit below the topbar (`--toast-top`, right `--sp-6`; phones 64, `--sp-4` at the sides), clear of the tab bar; their look stays 1.7.0 until Phase 5d. They keep clear of what they would cover in their column (`placeToasts`, `components/frame/Popover.tsx`): the open popover (10.8) and, in their host (the page or the open modal), a page's top controls, the card head of a list (`v2-tc-head`: search, preset, Filters) and the page header's action slot while it holds anything (`v2-page-actions:not(:empty)`: the instance segment, Retry). Each one the toasts at `--toast-top` would cover, from the highest down, moves the region to `--sp-3` below it (an inline `top`), so they start below the last one; with nothing in their way the inline `top` goes and they are back at `--toast-top`. If their first toast would then leave the view (on phones: reach the tab bar), they keep `--toast-top`. Only the toasts move. They measure again on each popover placement, in the layout effect of `Notifications` that shows a change of the toasts (so a new toast is clear in its first frame; it then sends `scopearr-toasts`, on which an open popover places itself again), and while toasts show on each DOM change (its dialog observer: Retry appears, a card head mounts), each scroll (a passive capture listener) and each resize. The selectors leave the markup as it was, so no page carries a marker of its own. The connection notice `p.v2-offline` is fixed over the topbar in the warn tone (2.4), so it moves nothing.
- The 1.7.0 settings heading sticks right under the stuck topbar, without a measurement: its `top` is `--app-header-height` (1.7.0), the fixed `var(--layout-60)` (top 8 plus 52), and `var(--layout-58)` (top 6 plus 52) at ≤ 740. 1.7.0 CSS has no 739 threshold, so at exactly 740px its top 2px slide under the topbar instead of leaving a gap. A heading counts as stuck (its bottom line shows) when it reaches its own sticky `top`, at every width.

**Sidebar markup.** `components/frame/Sidebar.tsx`, `SidebarFlyout.tsx`, `NavLink.tsx` and `BrandMark.tsx`, with the state from `hooks/useSidebar.ts`. Roles, names and these classes are the test contract:

- `div.v2-sidebar[data-mode]` (`id="v2-sidebar"`, `data-open` on the open drawer) holds, in this order: the brand row `div.v2-brand`; `div.v2-nav-sep`; `nav.v2-nav` (“Main navigation”) with a `p.v2-nav-group` per section; and `div.v2-nav-bottom` with the expanded footer and `button.v2-nav-toggle` (“Collapse navigation” / “Expand navigation”, `aria-expanded` = expanded). The brand row holds `NavLink.v2-brand-home` “Scopearr home” (`BrandMark` and “Scopearr”) and, beside the link, `span.v2-brand-version`, placed under the name as if it were inside: the link's visible text is the start of its name (WCAG 2.5.3, Label in Name).
- An entry is a `NavLink.v2-nav-item` with a decorative `span.v2-tile` and `span.v2-nav-text`. In the rail the text is `v2-sr-only` and stays the name. `aria-current="page"` marks the shown page and `data-parent` the entry whose area is shown; both get the `v2-tile--grad` tile. Counts (`v2-count v2-count--on`, expanded and drawer) and plaques (`v2-plaque` inside the tile, rail only) are `aria-hidden`; the bell names the open jobs.
- Settings is a `button.v2-nav-item` with `aria-expanded`; the other groups have an arrow `button.v2-nav-caret` (“Instances”, a `v2-icon-btn--sm`) beside their link in a `div.v2-nav-row`. Both control `div.v2-nav-subs[data-open]` (inert while closed) with `ul.v2-nav-list > li > NavLink.v2-nav-sub` and its count `span.v2-nav-meta`. The rail renders no arrow and hides the sub-entries; there a group trigger has `aria-expanded` and `aria-controls="v2-fly"`. Tab in a flyout goes on to the next shown rail element (`visibility: hidden` ones are skipped).
- `NavLink` is a real `<a href>`: a plain left click (also Enter) prevents the browser's navigation and runs the guarded action (`openLink`); middle and modified clicks keep the browser's link (`nav-link.ts`). `label` names an icon-only link (`aria-label` and `title`).
- The flyout `div.v2-fly` (`id="v2-fly"`, `data-open` while shown) is a sibling of the sidebar: `role="group"` named after its group, with `p.v2-fly-head` (a link when the group has a page of its own) and `NavLink.v2-fly-item` (count `span.v2-fly-meta`). `v2-fly--label` is the label-only flyout (`aria-hidden`). Its `top` comes from its entry's rectangle: a group starts at the entry and stays inside the sidebar card, a label is centered on it. The drawer's scrim is `div.v2-scrim[data-open]`.
- Wiring (`flyout.ts`): pointer enter and leave (mouse and pen) on entries and flyout; `focus` only for `:focus-visible` focus on an entry, `blur` for every blur; `focusin` and `focusout` of the flyout; `press` for a click on Settings, → on a group trigger (which then focuses the current entry) and the first tap on a group link; `dismiss` with `back` for ←, Escape (from the rail, the flyout or `body` only; Escape elsewhere, such as in a dialog, is left to the page) and a click on an entry, plain for Tab out, resize, a mode or page change, a press outside, and focus leaving rail and flyout. A focus return after ← or Escape is an ordinary focus event, and the machine keeps the entry closed. An entry that leaves while focused (a hidden tool) gets a `blur` from the sidebar, and a mode change sends `blur` and `dismiss`, so no stale focus holds a flyout open. The rail resets `scrollLeft` to 0.
- `useSidebar()` – `mode` from `matchMedia` and `scopearr-sidebar`, already on the first render; `toggleMode` stores the choice (nothing in the drawer); `groups` and `toggleGroup` (`scopearr-sidebar-groups`); `drawerOpen`, `openDrawer(trigger)` (only in the drawer mode) and `closeDrawer()`, after which focus returns to the trigger once the frame is no longer inert. A mode change closes the drawer without a focus return.

**Band, topbar, page header, tab bar, sync, jobs and quick search markup.** `components/frame/Topbar.tsx`, `TabBar.tsx`, `Popover.tsx` (10.8), `SyncStatus.tsx`, `SyncPopover.tsx`, `JobsMenu.tsx` and `QuickSearch.tsx` (10.9), with the scroll state from `hooks/useScrolled.ts`, the manual sync from `hooks/useManualSync.ts`, the bell's jobs from `hooks/useOpenJobs.ts` and quick search's titles from `hooks/useTitleSearch.ts`. Roles, names and these classes are the test contract:

- **Band:** `div.v2-band` (`aria-hidden`), absolute in its positioned frame: `edge` from the top and the right, `--band-h` high, radius 16, `--band-bg` with `--band-edge`, no pointer events. Phones: from the top at full width, bottom radius `--r-band-phone`.
- **Topbar:** `header.v2-topbar` (the `banner` landmark), sticky at `--bar-gap`, `--topbar-h` high at every width. `useScrolled()` (a passive scroll listener, `scrollY > 4`, already on the first render) sets `data-scrolled`; the state changes only colors and the backdrop (`--band-ink` over the band; then `--glass`, `--glass-filter`, `--shadow-glass` and `text`), never the box. While transparent, its focus ring uses `--band-ink`.
  - From 740: `nav.v2-crumbs` (“Breadcrumbs”) `> ol > li` with the crumbs of the nav model as text, the last with `aria-current="page"`; the separators are drawn lines, not text. Then `div.v2-topbar-end`: the demo pill, the sync chip (rail only), Quick search (`aria-keyshortcuts="Control+K Meta+K"`), the bell, the theme button (“Light theme”/“Dark theme”) and Sign out, all `v2-icon-btn v2-icon-btn--bar` with `aria-label` and `title`.
  - Phones (mode `drawer`): `NavLink.v2-topbar-home` “Scopearr home” with `BrandMark` (`--topbar-mark`), `span.v2-topbar-title` (the page title; decorative, since the page heading names it, and visible only with `data-scrolled`), then demo, bell and theme.
  - Demo pill: `span.v2-pill.v2-demo` with `title` = the long text, `span.v2-demo-long` (shown from 1280; below, only assistive technology reads it) and `span.v2-demo-short` “Demo” (`aria-hidden`, shown below 1280).
  - Bell: `button.v2-bell` named “Tools, {count} open jobs” (the open jobs of the visible tools, `jobsSummary`) with a `v2-plaque` while jobs are open: `v2-plaque--band` over the band, `v2-plaque--error` when a job failed. It opens the jobs menu (below).
  - Triggers before their overlay exists (sync chip, Quick search, bell) are buttons without `aria-haspopup` or `aria-expanded`; with their handler they get `aria-haspopup="dialog"` and `aria-expanded`.
- **Sync display:** `SyncStatus` shows the one state of `syncSummary` in three places, never two at once. `chip` (topbar, rail): `button.v2-pill.v2-sync-chip` named by the summary, with `v2-dot--ring`; its text has the fixed width `--sync-chip-text` with an ellipsis and `title`, so a state change moves nothing; below 900 only the dot shows. `card` (footer of the expanded sidebar): `button.v2-sync.v2-sync--card` with a gradient tile, “Synchronization”, the dot and the summary. `row` (drawer head): `button.v2-sync.v2-sync--row`, the dot and the summary on one line. In the card and the row the text fills its line (the card's body fills the card), so no box depends on the time it shows. Without any sync (`off`) it shows “Synchronization” instead of the summary, never a bare “Last sync:”.
- **No sync data:** without an enabled instance (the demo) there is nothing to sync, and the frame shows no sync display at all: no chip, card or row. With enabled instances that have not synced yet (or a status without sync data), the display shows “Synchronization” with the `off` dot, and the popover lists each instance with its System → Info line (“Last sync: Not synced yet”, “Last match: Not synced yet” for a media server).
- **Sync popover:** `SyncPopover` opens from the chip and the drawer row below them (`bottom-end`) and from the card beside it (`right-end`): a wide `Popover` dialog (10.8) named “Synchronization” with `p.v2-pop-title` “Synchronization” and `ul.v2-sync-list` with one `li.v2-sync-item` per enabled instance, in the order of System → Info: its `v2-dot` (the instance's state, `aria-hidden`), `span.v2-sync-main` with `span.v2-sync-name` (its name) and `span.v2-sync-state` (its System → Info line from `syncSummary`, so a media server says “Last match”, while the frame's one summary says “Last sync”), and `button.v2-btn.v2-btn--sm` “Sync now” (“Match now” for a media server). The button is locked as on System → Info: in the demo, for a disabled instance, while its request is on its way and while the instance syncs. A press moves focus to the popover, so it stays in the dialog while the button locks. There is no “sync all”. `useManualSync(refresh)` sends the request, refreshes the status and shows the notice, as System → Info does with the same hook; System → Info takes its status lines from the frame's summary (`summary`, handed through the settings page). From the drawer row the popover renders inside the drawer (10.8): Tab stays in the drawer, the first Escape closes the popover and returns focus to the row, the next one closes the drawer. A closing drawer closes the popover too.
- **Jobs menu:** `JobsMenu` opens from the bell below it (`bottom-end`, on phones too): a wide `Popover` dialog (10.8) named “Jobs” with `p.v2-pop-title` “Jobs”. Each tool with open jobs (a visible tool without any has no row), in the order of `TOOLS`, is an `li` of `ul.v2-jobs` with `NavLink.v2-menu-item.v2-menu-item--tile` to its page: its `v2-tile` icon (`aria-hidden`) and `span.v2-jobs-text` with `span.v2-jobs-name` (the tool) and `span.v2-jobs-line` (its counts from the status, only those above 0: “Running 1 · Waiting 2 · Failed 1”). A tool row returns focus to the bell, closes the menu and opens its page through `openLink` (as an entry of the drawer returns focus to More, so a declined link leaves it on the bell). Its jobs (ruling R-B) load only when the menu opens, never at startup, and again when a tool's counts change while it is open (`useOpenJobs`): mux from `mux/jobs`, Disk placement and Files & permissions from the item lists of their pages, the running and waiting items (running first) and the failed ones each at most three (`jobRequests`, `frame-status.ts`). Below the tool, `ul.v2-jobs-list` shows at most three of them (`JOBS_SHOWN`), running first, then failed, then waiting, as `li.v2-job`: a `v2-dot` (`v2-dot--running`, `v2-dot--error`, `v2-dot--off` for waiting; `aria-hidden`) and `span.v2-jobs-text` with the job's title (`v2-jobs-name`) and its state with its file (`v2-jobs-line`, “Running · Arrival (2016).mkv”); job entries are text, the tool row is the link. A job's state is the status count's: mux drafts and ready jobs wait, jobs that need attention or review count as failed. Until a tool's jobs arrive, `ul.v2-jobs-list` holds as many placeholder rows as it will show (its open jobs, at most three): `li.v2-job[aria-hidden="true"]` with a `v2-dot--off` and both lines holding only a no-break space, so they have the final row height and the menu and its footer do not move when the jobs arrive (as long as the list agrees with the counts; a count change loads again). When they cannot be loaded or read (no notice), the placeholders go and the tool's row stands alone. Without open jobs it shows `p.v2-pop-text` “No open jobs.”. With a failed job, `div.v2-pop-foot` holds `button.v2-btn.v2-btn--sm` “Show in log”, which returns focus to the bell, closes the menu and opens the log filtered to errors of the failed tools' sources (mux `mux`, Disk placement `placement`, Files & permissions `filecheck`; `logSources`).
- **Quick search:** `QuickSearch` (E18, ruling R-C) is a native modal `dialog.v2-qs` named “Quick search” on the dialog stack (`pushDialog`/`removeDialog`, so a toast shows above it), not a legacy `Modal`; it takes part in the one-overlay registry of the popovers (`useOneOverlay`, 10.8). `div.v2-qs-field` holds the search icon, `input.v2-qs-input[role="combobox"]` (`type="text"`, so Escape never clears it first; named “Quick search”, placeholder “Search pages, movies and TV series …”, `aria-controls` the listbox, `aria-autocomplete="list"`, `aria-activedescendant` the active option) and a decorative `v2-dot`: `v2-dot--running` while titles are on their way, else `v2-qs-idle` (hidden in its place, so the field never resizes). Then `p.v2-pop-text.v2-qs-empty` “No matches.” when nothing matches and nothing is on its way, and `div.v2-qs-list[role="listbox"]` (“Quick search”, `aria-busy` while titles are on their way; the dialog's scrolling part) with a `div[role="group"]` per group that has options, labelled by its `p.v2-pop-title`: Pages, Movies, TV series. An option is `a.v2-menu-item.v2-menu-item--tile[role="option"]` with `href` = `linkHref(target)`, `tabindex="-1"` and `aria-selected`: its `v2-tile` icon (`v2-tile--grad` while active), `span.v2-menu-text` (its name) and `span.v2-qs-meta` (its context: a page's section or group, a movie's year). Focus stays in the field (a press on an option keeps it there); a plain click opens the option, a modified one keeps the browser's link. **Pages** are `searchPages(navModel)`: the sidebar's entries in their order, Settings by its areas; a page matches when every word of the query starts one of the words of its name and context. **Titles** (`useTitleSearch`): from 2 letters on, 180ms after the last keystroke, one request per library, `files?service=radarr|sonarr&mode=matches&q=…&limit=6` (`notifyErrors: false`); a new query and closing abort what is on its way; until the answer, the titles of the query before stay; a failed library finds nothing, and a titles chunk that cannot load ends the search without titles. A movie is one option with its year; a series' episodes fold into one option, and the same title in two instances is one option, as both open the same list. A title opens its library filtered by it (`{view: "library", service, query: "q=" + title}`, R-C; File & metadata in 5d). ↑/↓ move the active option and wrap, the pointer makes the option under it active, and the active option scrolls into view; Enter (not while an input method composes) opens it; typing starts at the first option. ⌘K and Ctrl+K inside it are taken, so the browser's search does not open. Escape (the dialog's `cancel`) and a press on the backdrop close it; a resize does not, as an on-screen keyboard resizes the view. Focus returns to its anchor.
- **PageHeader geometry:** `div.v2-page-head` (`--ph-h` high, padding 0 24 8, `--band-ink`) with `div.v2-page-text` > `h1.v2-page-title` (`--fs-page`/700, `--lh-page-title`, one line with an ellipsis) and `p.v2-page-sum` (`--fs-md`, `--lh-page-sum`, `--band-ink-soft`; `title` = `metaTitle`), then `div.v2-page-actions`. The summary line and the action slot are always rendered, also empty, so the title keeps its place on every page; the slot stays empty on a page without actions, and the libraries put their instance segment there (10.6), so the header has one height with or without it. `as` sets the root element (`div` by default). Phones: stacked, with the action row `--ph-actions-h` high and horizontally scrollable.
- **TabBar:** `nav.v2-tabbar` (“Main navigation”, shown up to 739, fixed 6 from the edges and the safe area) with three `NavLink.v2-tab` (Dashboard, Movies, TV series; `title` = label), `button.v2-tab` Tools (`aria-haspopup="menu"`, `aria-expanded`, the open jobs as a `v2-plaque` on its tile; left out without visible tools) and `button.v2-tab` More (`aria-expanded`, `aria-controls="v2-sidebar"`). Each holds `span.v2-tab-tile` and `span.v2-tab-label` (one line with an ellipsis; `--fs-tabbar-fit` below 360). `aria-current` gives the current tab the gradient tile. Tools opens a `Popover` menu above it (`top-end`) with a `NavLink.v2-menu-item.v2-menu-item--tile[role="menuitem"]` per visible tool; an entry returns focus to Tools (as an entry of the drawer to More), closes the menu and opens its tool.

The frame's state is pure JavaScript, tested without a browser:

- **Navigation model** (`nav-model.ts`) – sidebar, rail flyouts, tab bar, breadcrumbs and the page key come only from the route, the settings and the status. Entries name a `NavTarget`; their href and guarded action come from `linkHref` and `openLink`. The tools and their order come from `TOOLS` (`tool-route.ts`), and hidden tools are left out. Movies and TV series list their enabled instances as sub-entries only when there is more than one. Breadcrumbs are text only and start with “Scopearr”: section, page, then the instance or settings area (settings: “Settings”, area). `pageKey` changes only with the view, the library service, the tool or the settings area. `searchPages` gives quick search its pages: the sidebar's entries with their section as context, a sub-entry with its group's icon and name, Settings by its areas. `sheetPage(route)` tells the shell whether the page still stands on the transition sheet (above).
- **Frame status** (`frame-status.ts`) – `jobsSummary` counts the open jobs of the visible tools (the bell, the Tools plaques); `logSources`, `jobRequests` and `jobRows` give the jobs menu its log sources, the requests of a tool's jobs and their rows. `syncSummary` gives every enabled instance its System → Info line, plus one state for the sync card, chip and drawer row: a running sync, then an error, then the newest sync.
- **Sidebar mode and storage** (`sidebar-state.ts`) – `sidebarMode(width, preference)`: up to 739 the drawer; from 740 the stored choice; without one, expanded from 1600 and the rail below. `scopearr-sidebar` holds `"expanded"` or `"rail"`, and `scopearr-sidebar-groups` holds JSON `{movies, series, settings}` (default `true`, `true`, `false`). Both live in `localStorage` only and are read and written through `browser-storage.ts`. Unknown values, broken JSON and blocked storage give the defaults, group by group.
- **Flyout timing** (`flyout.ts`) – the JavaScript constants `FLYOUT_OPEN_DELAY` 150 and `FLYOUT_CLOSE_DELAY` 220 (an exception in section 4). `flyoutNext(state, input)` is the state machine `rail → peek (150) → open → closing (220) → rail`. Pointer enter peeks and a pass-through never opens. While the flyout is open, another entry opens at once. Leaving waits 220ms, and entering the flyout in that time keeps it open (the bridge). Visible focus, a click or a tap opens at once and never closes. Dismiss closes. A step back (`back`: ←, Escape, a click on an entry) also suppresses the closed entry; Tab out, an outside click, resize, a mode or route change do not. Focus returning to a suppressed entry, or the pointer on it, does not reopen it. `leave`, `blur` (focus leaves the entry) or another entry end the suppression, and a press opens anyway. The flyout holds while focus is inside it (`focusin` and `focusout`) or while the shown item's own rail entry has visible focus (noted by `focus`; cleared by `blur`, a press or focus moving into the flyout). During a hold, a pointer leave starts no close and a timeout closes nothing. When the hold ends, a closing flyout closes after the full 220ms, and focus coming back to its entry holds it again. Each result sets the timer: `wait` > 0 replaces it, 0 stops it, and `null` keeps it. Inputs that do not apply return `null`, so a peek keeps its delay; only a new `enter` restarts it, as in C+. `createFlyout` runs the machine on timers.
- **Theme and band** (`appearance.ts`) – `data-theme` and, always, `data-band` are set on `<html>` before the first render, for sign-in, setup, the loading screen and the app. `scopearr-theme` holds `dark` or `light`, as in 1.7.0; any other value means dark. `scopearr-band` holds `strong` or `muted`; without a valid value, dark is muted and light is strong (2.3). `setBandPreference(root, null)` is “use default”. Both keys live in `localStorage` only, and the page's own choices hold while storage is blocked.
- **List preferences** (`list-prefs.ts`, `hooks/useListPrefs.ts`) – `scopearr-density` holds `compact` (no key or any other value means comfortable) and `scopearr-tracks-stacked` holds `true` (otherwise tracks are compact). Both live in `localStorage` only and are read and written in `try`/`catch` through `browser-storage.ts`: the default removes the key, unknown values and blocked storage give the defaults, and a write sends the `scopearr-list-prefs` event, so a shown list follows at once. The last choice written holds in memory for the session and is read first, as i18n holds the interface language, so with blocked storage Display is clean after Save and the lists use the choice until the page loads again. Display writes them only after a successful Save settings that changed them (4, 10.11); until then a changed choice is an unsaved change of the settings draft (`useSettingsDraft`: `draftPrefs`, `savedPrefs`), so leaving asks once and Discard keeps the stored values. The settings sent to the server never hold them (its PUT rejects unknown fields). They are the only values Phase 5a stores: no setting, enum value, column ID, sort field or widget value is added, so 1.7.0 still reads everything after a downgrade. The dashboard keeps the 1.7.0 browser keys `scopearr-dashboard-scope` (its scope tabs) and `scopearr-storage-areas` (the storage area per scope).

#### 10.2 Surfaces

- **Card** – `panel`, border `--card-border`, radius 16, `--shadow-card`. Header at least 60 (title `--fs-lg`/650, count, actions), body, footer at least 56 with a `line-soft` divider. Variant `inset`: `--sunken`, radius 12, `line-soft` edge, padding 12/14. Class so far: `v2-card` (the surface: `panel`, border, radius 16, shadow, `text`; its host sets padding and layout), first used by the sign-in card. Replaces the eleven 1.7.0 card classes and seven inner boxes (`.settings-card`, `.connection` as a surface, `.stat-widget`, `.distribution-card`, `.filter-panel-v2`, `.recognition-preview`, `.connect-card`, `.system-service-card`, `.mux-tool-card`, `.tool-package-card`; `.filename-box`, `.storage-instance`, `.rule-save-status`, `.event-detail pre`, `.storage-path`, `.external-tag-conflict`, `.file-dialog-section`).
- **Tile** – icon tile 32 (radius 8), 40 (radius 10) or 48 (radius 12). Variants `tint` (default), `grad` (gradient and glow), `panel`, and the tones warn, info and muted. Classes: `v2-tile` (32, tint), `v2-tile--grad`, `v2-tile--line` (transparent with a 1px `line` ring, in its host's color: the sidebar's expand button) `v2-tile--md` (40, radius 10: the head of a dashboard widget, a KPI card on phones), `v2-tile--lg` (48, radius 12: the empty state of a list, a KPI card, Phase 5a) and the tone `v2-tile--warn` (Incomplete metadata). Further sizes and variants come with the phases that use them.
- **KpiCard** – radius 12, at least 118 high, label `--fs-sm`, value `--fs-kpi`/700; `hero` uses `--grad-accent`. It is a link or button into the filtered list (an arrow appears on hover). `compact` is 84 high (value 24) and serves as filter buttons on the tool pages. Classes: `v2-kpi` on a `NavLink` and `v2-kpi--hero` (Phase 5a, the dashboard, `components/dashboard/KpiCard.tsx`); `compact` comes with the tools (Phase 5b). Its parts: `v2-kpi-text` with `v2-kpi-label`, `v2-kpi-value` and `v2-kpi-hint`, then the 48 tile (`v2-tile--grad`; the hero's is `panel` with `--accent-ink`) and the arrow `v2-kpi-go`, shown on hover and focus. The card is named by its text (label, value, detail). On phones the tile (40) stands above the text and the arrow is hidden. The dashboard's four cards, in the 1.7.0 order Movies, TV series, Episodes and Media files (the hero, last), each with its 1.7.0 detail text, open their lists without filters (`query: ""`): Movies and Media files the movie library, TV series and Episodes the series library. Without data a card keeps its final size; its value line stays empty.
- **DiskCard** – 84 high like the KPI row, radius 12, 40px tile. Standby status appears only here; it blocks nothing and warns about nothing.

#### 10.3 Actions

- **Button** – `secondary` (default: panel with a `line` border), `primary` (`--grad-btn`, `--accent-text`, `--shadow-btn`), `ghost`, `danger` (2.4), `danger-solid`, and on the band `on-band` and `band-primary`. Sizes 36, `sm` 30, `xs` 26, `lg` 40. Font `--fs-md`/600. Disabled at opacity 0.42, keeping its space. A count inside a button is 18 high and sits in a slot at least `--count-in-btn-w` wide, so the button's width never changes with the number. Classes so far: `v2-btn` (secondary, 36; hover `--hover` with `--shadow-btn`; in the light theme a border 80% `line`, 20% `muted`) and `v2-btn--sm` (30, `--fs-sm`, gap 6), first used by the sync popover; `v2-btn--lg` (40, padding 18) and `v2-btn--primary` (`--grad-btn` without a border, `--accent-text`, `--shadow-btn`; hover keeps the gradient with `--shadow-btn-hover`), first used by sign-in. Under `pointer: coarse` it is at least 44 high. Further variants come with the phases that use them.
- **IconButton** – 32, `sm` 28, `xs` 24; `ghost` (default), `framed`, `danger`; open uses `--tint` with `--accent-ink`; 36 in the topbar. Always has `aria-label` and `title`. Classes: `v2-icon-btn` (32, ghost), `v2-icon-btn--sm` (28) and `v2-icon-btn--bar` (36 on a bar: the bar's ink, hover and open 12% of it). Open is `[aria-haspopup][aria-expanded="true"]`, so a disclosure arrow stays ghost; a pressed toggle (`aria-pressed="true"`, the page tool All columns) looks the same, except the reveal toggle, whose eye shows its state. Under `pointer: coarse` every size is 44.
- **RowButton** – a framed tile 28 (`sm` 24), radius 8, `line` edge. Hover: `--accent-ink`, `--accent-line` and `--shadow-btn`; `on` uses `--tint-soft`. Used for the Info column and row actions. Replaces the `.icon-button` overrides in tables, `.row-icon` and `.info-action`. Class `v2-row-btn` on a `button`, or on an `a` for a link (`v2-row-btn--sm` 24, `v2-row-btn--on`), always named (`aria-label` and `title`). A link into another app (Radarr, Sonarr, a media server) opens a new tab with `rel="noopener noreferrer"` and `referrerpolicy="no-referrer"`; a menu or dialog trigger carries `aria-haspopup` and `aria-expanded` and is `on` while open; a locked one keeps its place, disabled, with its reason in `title`. Under `pointer: coarse` it keeps its size with an invisible 44 hit area (8). Phase 5a uses it in the libraries; the tools keep their 1.7.0 row icons until Phase 5b.
- **TextButton** – `--accent-ink`, `--fs-sm`/600, underlined on hover. Class `v2-text-btn`: Reset filters in the chips row, More and Less in a distribution card.
- **Toolbar** – a row with `--sp-2` that never wraps into the page layout (container width, 10.10).

#### 10.4 Forms

- **Field** – label above the control with a gap of 6; label `--fs-sm`/`--w-label`/muted; help text `--fs-xs` muted; errors in mix(error 80%, text) with `aria-invalid` and `role="alert"`. Class `v2-field`: a column of its `label` (with `for`), the control and its help text as `small`, which the control names in `aria-describedby`.
- **Input / Select / Textarea** – 36 (`lg` 40), radius 8, border `--field-border`, background `--field-bg`. Hover border mix(muted 90%, text); focus border accent with `--focus`. The select chevron is drawn in `muted` (native under `forced-colors`): two gradients draw it on `select.v2-select`, because a select has no pseudo-element to carry a mask. Textareas use monospace 12 and are at least 88 high. Classes: `v2-input` (36, `--fs-md`; focus without the ring: border `accent` and `--focus`, plus a transparent `--outline-w` outline that forced colors paint, as they drop border color and shadow) and `v2-input--lg` (40); under `pointer: coarse` both are 44. `select.v2-select` is the select of the same size and states with the chevron (`--sp-8` on its right for it): the preset select of the filter bar (`--preset-w`) and the columns of a track combination in the filter drawer.
- **InputGroup** – prefix icon (left 11, field padding 34), suffix or reveal on the right; a fixed extension as a suffix field (rename). Class `v2-input-group`: its `v2-input` keeps room for an icon button at its end (`--icon-btn-sm` + 12; 44 + 4 under `pointer: coarse`), the button sits 4 from the end, centered. With a prefix icon (`svg.v2-input-icon` before the field: the search of the filter bar, 10.5) the icon sits `--input-icon-x` from the start in `muted`, the field is padded `--input-icon-pad` at its start and has no button at its end.
  - **Reveal** (ruling R-A): `button.v2-icon-btn.v2-icon-btn--sm.v2-reveal` after the field, always named “Show password” (`aria-label` and `title`; a toggle keeps its name, APG) with `aria-pressed` while the password shows and `aria-controls` the field; a press switches the field's `type` between `password` and `text`, and a submit switches it back to `password` first, so password managers see a password field. A pointer press keeps focus and the caret in the field (`mousedown` is prevented); from the keyboard (Tab, Space) focus stays on the toggle. The recipe draws lucide's `eye`, `eye-off` while pressed, as a `--glyph` mask in the button's ink, like the select chevron, so the start chunk carries no icon code (E24); under `forced-colors` it uses `ButtonText`.
- **Check / Radio** – 16 (touch 20), radius 5 (radio round), border 1.5px `--field-border` on `--field-bg`. Checked uses `--grad-btn` with the check in `--accent-text`, mixed the same with a dash: lucide's check and minus as a mask on its `::after` (native under `forced-colors`). Disabled at opacity 0.42. The row uses a gap of 10 and aligns with the first text line. Class `v2-check` on the native `input`: the selection boxes of the libraries (`SelectionBox` with `className="v2-check"`, which the 1.7.0 table leaves out, so its markup stays as it was: tri-state per page, series and season, mixed as `indeterminate` with `aria-checked="mixed"`; locked while a selection action runs) and the value lists of the filter drawer. Until Phase 5b the tool tables keep the 1.7.0 checkbox.
- **Switch** – 36 × 20; off: `panel2` with the field border; on: `--grad-btn`.
- **OperatorToggle** – the operator of a drawer field (10.5): `button.v2-ff-op` (`--ctl-md` square, 44 under `pointer: coarse`, the symbol `=`, `≠`, `∧` or `¬∧` at 700 in `--accent-ink`; the excluding ones, `v2-ff-op--not`, in the excluded chip's tone, 2.4), named as the 1.7.0 operator button “{field}: {operator}” (“Resolution: is not”) with the operator as `title`. Simple fields switch between “is” (`=`) and “is not” (`≠`) in this one button (a deep link's “all” switches to “is not”, as in 1.7.0); the compound fields HDR, Audio codec, Language, Channels and Custom tags, and the track combinations, open a `Popover` menu named “{field}: operator” (`aria-haspopup="menu"`, `aria-expanded`) of `menuitemradio` entries with the 1.7.0 names (contains at least one, contains none, contains all, does not contain all), each after its symbol (`v2-ff-sym`, hidden from assistive technology); a choice returns focus to the button. `eq` removes the field's `…Op` parameter, as in 1.7.0. On a state filter, choosing an operator activates nothing: it is kept while the filter is unchecked and applies once it is checked.

#### 10.5 Filters

The libraries use these from Phase 5a, the tools from Phase 5b (their 1.7.0 filter panel stays until then). The general parts live in `components/list/` (`FilterBar`, `ChipsRow`, `FilterDrawer`), the library's fields in `components/library/`.

- **FilterBar** – in the header of the results card, identical on all five lists: `div.v2-filter-bar` with the search (a `v2-input-group`, `--search-w`, `--search-w-narrow` below 1600, named by its label, on the libraries “Title or filename” with its placeholders), the preset select (`select.v2-select`, `--preset-w`, named “Filter preset”) and the Filters button (`button.v2-btn` “Filters” with `aria-haspopup="dialog"` and `aria-expanded`, and its count as a `v2-count` in a `--count-in-btn-w` slot: the number of chips without the search and the instance, `v2-count--on` from 1, hidden from assistive technology, so the button is named “Filters” and the chips name the filters). A press opens the drawer with the button as its anchor. The search is a `v2-input-group` with lucide's Search as its prefix icon (10.4). Below a container width of 760 the header stacks and the search takes the full width; the preset select and the Filters button share the line below it.
  - **At once**, as a route replace without a history entry, as in 1.7.0: the search (debounced as before), a preset, removing a chip, Reset filters and the instance. What the drawer holds applies only with Apply.
  - **Presets:** “All files” and the user presets of the service (bundled presets come after 2.0.0). The instance (the segment, 10.6) is navigation, not a filter: alone it reads “All files”, and a preset without an instance of its own also matches the filters beside it. When filters other than the instance are active and match no preset (`canonicalPresetQuery`, which normalizes `track` and `trackOp` like `presets.go`), the select shows the disabled option “Custom selection” (ruling R-I), where 1.7.0 showed “All files”: the last option, with the value `""`, which no preset has, and the select is never disabled (“All files” resets, as in 1.7.0; a reset and a chosen preset replace the instance too, as in 1.7.0). Saving and deleting a preset are page tools of the chips row; the save dialog with its duplicate check and the confirmed deletion stay as they are.
- **FilterDrawer** – a native modal `dialog.v2-drawer` (`aria-modal="true"`, `aria-labelledby`; on the dialog stack through `pushDialog`/`removeDialog` and in the one-overlay registry through `useOneOverlay`) on the right: `--drawer-w` wide, `edge` from the viewport, radius `--r-lg`, `--shadow-float`, its `::backdrop` in `--scrim-light`; a full-screen sheet at ≤ 739. Its head holds “Filters”, the card title as a subtitle, and Close; its footer “Reset” (clears the draft and applies nothing) and the primary “Apply ({count} matches)”, which fills the width (“Apply” without a number while the count loads or fails). Escape (`cancel`), the backdrop (a press that also began on it, not a drag from inside) and Close close it without applying; focus starts on Close and returns to the Filters button (the caller focuses it with `preventScroll`; the dialog's own restore does not scroll either). A popover opened in it renders inside it (10.8) and is one of its overlays, so it leaves the drawer open: Tab stays in the drawer, the first Escape closes the popover, the next one the drawer. Quick search does not open over it (it is on the dialog stack). `FilterDrawer` (`components/list/FilterDrawer.tsx`) is the general shell, open while mounted (5b uses it for the tools); `LibraryFilterDrawer` (`components/library/`) holds the library's draft and fields.
  - **Geometry:** only the open dialog has a box (`.v2-drawer[open]`), so it never shows in the page's flow before `showModal()`. Its head and foot keep their height and the body between them scrolls in place (`scrollbar-gutter: stable`, `overscroll-behavior: contain`), so neither a list that opens nor a count that changes moves them; Apply fills the foot and wraps a long count (“Aplicar (12.345 resultados)” at 360) inside its fixed height. The page behind keeps its place when the drawer opens and closes: there is no scroll lock (as in C+ and the other dialogs; a wheel over the backdrop still scrolls the page), and the root keeps its scrollbar gutter. It opens with the popovers' fade.
  - **Draft:** the drawer edits a copy of the service's filters (a query string). Apply hands it over once (the page replaces them in **one** route replace and returns to page 1, keeping the current search and instance) and closes; closing discards the draft. Back or Forward inside the library leaves it open, as dialogs stay open on a history step, and its draft starts again from the filters the step brought; leaving the library or its service closes it. Reset clears the draft's filters but keeps the search and the instance, which apply at once outside the drawer (the filter bar, the instance segment); it applies nothing.
  - **Live match count:** `useMatchCount(service, draft)` asks `files?<draft>&service=…&limit=1` (`matchCountPath`), 180ms after the last change, the request before it aborted (`AbortController`); the count is the answer's `total`. While a changed draft's count loads, the last one stays (`stale`), so Apply never flashes to “Apply” and back: Apply then carries `aria-busy="true"` and is dimmed as the busy table is (opacity 0.55). It is null before the first answer and when it fails (Apply then has no number); its errors are not toasted, as the list's own request reports them. Page and sort do not change it.
  - **Sections**, always open (opening and closing them would change heights), each a `section.v2-drawer-sec[aria-labelledby]` after its heading line `div.v2-drawer-h` with an `h3`: Media attributes (the 11 fields in 1.7.0 order, Year from–to, File size (GB) from–to, the help “Filter logic”); Audio track combination (`div.v2-ff-combo`, a grid of the column names, hidden from assistive technology, and the operator of a compound field over all rows, then rows of Language, Audio codec and Channels, each a `select.v2-select` with “Any” first, and Remove combination (an sm icon button) per row, then Add combination (an sm button, locked at 16) and the hint that files without measured tracks never match (`p.v2-ff-hint`, the section's description); a row of Any is no combination and stays on screen only, removing the last row leaves a row of Any, Add focuses the new row and Remove the Remove now in its place; the options are the files' values from the facets `language`, `audio` and `channels`, plus a value of the draft outside them); Status and metadata quality (the state filters with their help, the season outliers on TV series, MediaInfo read only while MediaInfo is enabled or its filter is set in the applied filters, so no field comes or goes while the draft changes, and media server matching under an `h4`). A state field (`div.v2-ff.v2-ff--state`) is its box with its label (`label.v2-ff-check`, at least 44 high under `pointer: coarse`, as it is the field's target), its HelpTip and its operator.
  - **Field:** `div.v2-ff`, a grid of the label column (`--ff-label`, a label may take two lines), the operator and the value: its label (`span.v2-ff-label`), its OperatorToggle (10.4) and `button.v2-ff-value[aria-expanded][aria-controls]` (`--ctl-md`, 44 under `pointer: coarse`; `v2-ff-value--on` with values, `v2-ff-value--not` when they exclude), named by the label and the 1.7.0 summary it shows (`aria-labelledby` on both, “Resolution All”, so the shown values belong to its name, WCAG 2.5.3; `span.v2-ff-sum`: “All”, “No exclusions”, or the values after “Not: ”, “All: ” or “Not all: ”), which opens and closes its `fieldset.v2-ff-list` **inside** the drawer, below the line: “Reset selection”, then each value as a pill (`label.v2-ff-opt`, `--chip-h`, 44 on touch, `--tint` when checked) with a `v2-check` box, or, without values, “No values in cache yet”. The values and their labels are the 1.7.0 ones (`filterOptions`, `filterLabel`: the SD group, hidden tags, custom tag names, languages, Unknown, No custom tags; one language's names count as one value), from facets that load only while the drawer is open (ruling P11/M15): until they arrive (`facets` null) an open list is busy and shows three placeholder pills (`v2-ff-ph`) instead. Ranges (`div.v2-ff-range`) hold two `v2-input` number fields (1.7.0 names and placeholders) across the operator and value columns. The box and a value pill are labels and set their direction, which the 1.7.0 label rule (a column) would give them.
  - **Loading:** the drawer is a lazy chunk of its own (`LibraryFilterDrawer`), preloaded at idle after the library's first paint (`requestIdleCallback`, else a timeout of 500ms). A failed preload is caught and ignored and never starts the preload recovery; opening after a failure tries the import once more, and when that fails too the drawer closes with the existing error notice “Scopearr is not reachable”, without a reload (as quick search's titles, 10.1). The loader is `lazyChunk(load)` with `useLazyChunk(chunk, open, close)` (`hooks/useLazyChunk.ts`); `drawerChunk` (`components/library/drawer-chunk.ts`) writes the failure handler on the `import()` itself, `import(…).then(ok, () => null)`, so Vite keeps it inside its preload wrapper and a failed import never raises `vite:preloadError`. One import runs at a time; opening during the preload waits for it and retries once when it fails.
- **ChipsRow** – `div.v2-chips-row`, a row of the fixed height `--chips-h` between the card header and the table, with the same height for no, one and twenty chips. On the left `div.v2-chips-group`, a group (`role="group"`) named “Filters” (an existing key, ruling P11/M7) that scrolls sideways and fades out over its last `--sp-6` (its end padding and `scroll-padding-inline-end` are as wide, so the last or a focused chip clears the fade): `button.v2-chip` (`--chip-h`, pill, `text` on `--tint`, `--tint-strong` on hover, `--fs-sm`, the field name `span.v2-chip-field` at `--w-title` in `--accent-ink`, then lucide's X as `v2-chip-x` at `ICON.chip` in `--muted-strong`; named by its label) removes its filter, one value or, with all/not all, the whole field, as in 1.7.0; the field name is the label up to its first “: ” or “ ≠ ” (the shape of `filterChips`); an excluded value (`≠`, none of, not all) is `v2-chip--excluded` (2.4). “Reset filters” (RotateCcw) follows as a TextButton **after the group, outside its scroller**, so twenty chips never scroll it away or fade it; the group gives it room, so the tools do not move when it appears. Without filters the row reads “No active filters” (`span.v2-chips-empty`, muted) and offers no reset. When a chip or Reset filters takes its button out of the page, focus moves to the chip now in its place, else the one before it, else the group (`tabindex="-1"`), unless it went elsewhere meanwhile. On the right `div.v2-tc-tools`, the page tools in this order: the selection actions (Mark for muxing and Remove mux marking through `useMuxSelection`, Set tag ({count})) │ All columns / Default view │ Save preset, Delete selected preset │ Export CSV (the 1.7.0 `href` with filters, sort and language; inert without results). A selection action is a count tool (`CountTool`, `components/list/TableCard.tsx`): a `v2-btn v2-btn--sm` with its icon, the catalog text around its `{count}` in `span.v2-tc-label` (`countParts`: the brackets right around the placeholder go, as the slot frames the number; no new text) and the number in the button's count slot (10.3, `v2-count`, `--on` from 1), which holds the number (`v2-count-num`) and, hidden in the same grid cell, the largest number the tool can show (`v2-count-max`: the page size, the most files a selection holds), so the slot is always as wide as that, the label never carries the number and no count change from 0 to the page size moves a tool. Its name is what it shows, label and number (“Set tag 2”, WCAG 2.5.3; no `aria-label`): a space text node parts them (not rendered between the flex items) and the hidden widest number is no part of it; its `title` carries the catalog text with the number and the reason (“Set tag (2) · Set tags for selected files”). Below a container width of 1060 it shows only its icon and count; the label is then visually hidden (as `v2-sr-only`), so the name keeps it. While a mux run works, its slot shows the files handled instead (on, also at 0), as 1.7.0 showed “Marking … 3/12”; its icon turns (`v2-spin`), its `title` reads “Marking … {done}/{total}” (“Removing …” for Remove mux marking; its name is its label and the slot's number), and a polite live region (`v2-sr-only`, `aria-live="polite"`, there only during the run) announces that text at each quarter of the run, not at every file; the label and the slot keep their width. The other tools are icon buttons (`v2-icon-btn`, as in C+), named by their label with the 1.7.0 `title`: All columns / Default view (`aria-pressed`, `--tint` while pressed), Save preset, Delete selected preset (locked without a chosen preset) and Export CSV (`a[download]`, or a `span[role="link"][aria-disabled="true"]` without results; a locked icon button is at 0.42 opacity). `span.v2-tc-sep` (1 × `--sp-5`, `line`, hidden from assistive technology) separates the groups. Below 560 the tools take a wrapping line of their own below the chips, in their page and tab order (no CSS `order`). The filter help sits in the drawer, not in this row.

#### 10.6 Tabs and switches

| Form | Use | Look |
| --- | --- | --- |
| **Segmented** | Exclusive areas (instance, System Info/Log, Display, service tabs, mode, band, the dashboard scope) | `panel2` background with a `line-soft` edge, radius `--r-frame`, buttons 30 (`--ctl-sm`), `--fs-sm`/600 `muted`, active `text` on `panel` with `--shadow-btn`; variant `on-band`: transparent with an edge of 50% `--band-ink`, items in `--band-ink`, the active one `text` on `panel` |
| **Tabs** | Tabs in cards and dialogs | 40 high, 3px underline in `--grad-accent` |
| **Navigation** | Sidebar | 10.1 |

`Segmented` (`components/list/Segmented.tsx`, from Phase 5a; the 1.7.0 `SegmentedTabs` stays for its other users until 5c/5d) comes in two kinds:

- `tabs`: `div[role="tablist"]` (named) of `button[role="tab"]` with `aria-selected` and `aria-controls="<idPrefix>-panel-<value>"`, a roving `tabindex`, ←/→ and Home/End: the dashboard scope “Entire library / Movies / TV series” (“Statistics scope”, `scopearr-dashboard-scope`).
- `links`: a named `nav` of `NavLink`s, the current one with `aria-current="page"`: the instance segment.
- **Instance segment** (`InstanceSegment`): with more than one enabled instance of the service (as the sidebar's sub-entries), `on-band` in the page header's action slot, named “Instances”: “All” and one link per instance, to `{view: "library", service, instance}` through `openLink`. On phones it sits in the 40 action row and scrolls sideways. The chip of the instance filter stays.
- Classes: `v2-seg` with `v2-seg-item` entries, and `v2-seg--on-band`.

#### 10.7 Labels and markers

- **Count** – 22, pill, `--fs-2xs`/700, muted on panel2; `on` and inside a card title `--accent-ink` on `--tint`. As a plaque (absolute, 16) on the sidebar, bell or tab bar it never changes the size of its host. Classes: `v2-count`, `v2-count--on` (with `v2-count-num` and `v2-count-max` for a count with a reserved width, 10.5) and `v2-plaque` (accent, with a 2px `panel` ring; its host sets its offsets), `v2-plaque--band` (`--band-ink` on `--band-1` without a ring, over the transparent topbar) and `v2-plaque--error` (`--status-error` with `bg` text, when a job failed).
- **Dot** – 8 (legend, status) or 6 (inside a status tag, sub-entry). Classes: `v2-dot` (8, `--status-ok`), `v2-dot--running` (`--status-wait`, pulsing over `--t-pulse`), `v2-dot--error`, `v2-dot--off` (muted) and `v2-dot--ring` (a 2px ring of 35% of its host's ink, for a dot on the band).
- **Pill** – 28 high, pill radius, `--fs-xs`/500 in its host's ink with a 1px inner ring of 45% of that ink: the demo pill and the sync chip. As a button, hover and open use 12% of the ink. Under `pointer: coarse` it stays 28 and gets an invisible hit area (a `::after` centered on the pill) of its own width, at least `--touch`, and `--touch` high. The dot-only sync chip below 900 (28 wide) thus reaches 44 by 8 on each side, exactly the room to its neighbours (the pill's 4 margin and the topbar's 4 gap); its neighbours never move, and no hit area overlaps them (the e2e touch test measures it). Class `v2-pill`.
- **Tag** – 22 (`--tag-h`; 20 in a season row, `--tag-h-season`), radius 6, 11/600 (`--fs-tag`), padding 7 (`--tag-pad`), on one line. Variants: media (2.5), `neutral`, `unknown`, disk (2.5). `MediaTag` (2.5) renders `span.v2-tag` with `v2-tag--<kind>` for a media palette (`resolution`, with `v2-tag--r2160p`, `--r4320p` or `--r720p` for those resolutions, `codec`, `source`, `processing`, `hdr`, `audio`). The base `v2-tag` draws the neutral tone, so a kind without a palette of its own needs no rule; `v2-tag--neutral` sets it for SDR (at 500), whose kind has one; `v2-tag--unknown` is an empty value (“Unknown”, muted on panel2 at 500). An information-only value is `span.v2-tag-text`. A user color is inline (2.5).
- **CustomTag** – `CustomTag` (`components/list/CustomTag.tsx`) renders a custom tag in media-tag form: `span.v2-ctag` with a valid user color (`#rrggbb`) as `--ct` and its mixes (`v2-ctag--user`, 2.5; without a user color the neutral tone), its `title` as in 1.7.0 (an auto tag's explanation, else its name). A user text color of the tag (black or white, as `colorStyle` reads it) stays its text color, as in 1.7.0; without one the mixes derive the text from `--ct`, and the neutral tone (no user color) ignores it. Hidden and information-only custom tags follow `tagPresentation` as in the 1.7.0 table (a manual or auto tag stays a tag). An auto tag adds `button.v2-ctag-auto`, the 12 × 12 auto mark (`--auto-mark`, radius `--r-mark`, an “A” in `--fs-mark`/`--w-heavy` as in the design preview, named by the explanation), which opens its explanation (`autoTagHint`, in the 1.7.0 dialog until Phase 5d).
- **RowMark** – `RowMark` (`components/list/RowMark.tsx`): `v2-mark v2-mark--<tone>` (`warn`, `info` or `accent`), 20 × 20 (`--row-mark`), radius `--r-xs`, its 13 icon in the tone on mix(tone 12%, panel) (2.4; accent: `--accent-ink` on `--tint`). A user warning color (Settings → Display) replaces the tone inline. Without an action it is a `span[role="img"]`, with one a `button` or an `a`; it is always named (`aria-label`), and its `title` is the label unless it has a title of its own (the 1.7.0 tooltip of a warning, such as “Metadata disagreement” for “Show conflicting metadata”); a link runs its action on a plain click, as `NavLink`. Under `pointer: coarse` a mark with an action keeps its size with an invisible 44 hit area. The libraries use it for title marks and outliers (10.10).
- **Chip** – a filter chip: 28 (`--chip-h`), pill, `--tint`, removable, the excluded one in the error tone (2.4, 10.5).
- **StatusTag** – 22, radius 6, `--fs-xs`/600, dot and text (2.4). Never truncated; long text goes into `title`.
- **Badge** – 18, pill, 10/700 (2.4).

#### 10.8 Feedback

- **Notice** – tone surface (2.4), radius 12, padding 12/14, icon; `error` uses `--status-error`. Classes: `v2-notice` (info, `--fs-md`, line height 1.5) and the tones `v2-notice--ok`, `v2-notice--warn` and `v2-notice--error` (each sets `--tone`). The icon comes with the pages that use notices (Phase 5); sign-in shows its notices without one.
- **SetupNotice** – a `v2-notice` with an icon, a title (“Connect your movie library.” or “Connect your TV library.”), a sentence and the button “Set up service” (a named action after `canLeaveRules()`, Phase 4 ruling T3): `div.v2-notice.v2-notice--setup`, a wrapping row of lucide's Database (`ICON.large`, in the tone), `div.v2-notice-body` (the title as `b` in `text`, the sentence as `p`; at least 60% of the row, so the button wraps below the text on phones) and the primary `v2-btn` with ArrowUpRight. A library that is not set up (not the demo, settings loaded, no instance) shows it **before** the results card, as the page's first block at y = 146 (phones 172). The design preview places it between the FilterBar and the result, but the FilterBar sits in the card header (11.1).
- **Toast** – top right below the topbar (top 80, right 24; phones top 64, 16 at the sides), 380 wide, radius 12, `--shadow-float`, an icon tile in the status tone and a close button of 28. An optional action opens the log or the mux list. Toasts start below the open popover and a page's top controls they would cover (10.1).
- **Popover / Menu** – **one** primitive: `panel`, radius 12, `--shadow-float`, 220–360 wide, entries at least 36, hover `--hover`, the chosen entry at 600 with an accent icon, a header in the mini-label style. Keyboard: arrows, Home/End, Escape and focus return. Replaces `.nav-menu-list`, `.operator-menu`, the `.select-popover` list, `.evidence-source-options` and `.media-link-popover`.
  - `Popover` (`components/frame/Popover.tsx`) renders `div.v2-pop` into `body`, or into the modal its anchor sits in (`[aria-modal="true"]`: the open phone sidebar, so the sync row's popover stays in the sidebar's tree and focus trap, or the open filter drawer, so its operator menus and help stay in the drawer's): `role` menu (with the class `v2-menu`) or dialog, named by `label`, `position: fixed` at `--z-popover` from its anchor's rectangle: `bottom-end`, `top-end` (above the anchor) or `right-end`, 6px from the anchor and at least 8px inside the viewport, flipped when it does not fit, and placed again when its size changes (content that loads after opening), on every scroll (a passive capture listener: the sticky topbar moves its anchor) and when its placement changes. It opens with a 4px fade over `--t-mid` and focuses its first element (else itself).
  - Escape with focus in the popover, on its anchor or on `body` returns focus to the anchor and calls `close(true)`; the popover hears it in the capture phase and takes it (`preventDefault`), so a modal around it (the drawer, which leaves a taken Escape alone) closes only with the next Escape; Escape elsewhere, such as in a dialog, stays the page's. A press outside popover and anchor and a resize call `close(false)`; after a resize, focus in the popover or on `body` returns to the anchor while it is still in the document; a press in the toast region is never outside (`inToasts`, `notifications.ts`), here and in every menu and popover that closes on a press outside, so dismissing a toast keeps them open. These listeners are in place from the commit on (a layout effect), so an Escape or a press right after the popover shows counts too. The owner closes it on a second click of its anchor.
  - Only one popover is open at a time in its scope: one that opens calls `close(false)` of the one before it in its scope, whoever owns it (the topbar's popovers, the tab bar's Tools menu) and however it opened (a click or a program). The registry is `useOneOverlay(close, scope)`, which quick search and the filter drawer use too (scope: the page), so ⌘K closes a shown popover. A popover in a modal (`[aria-modal="true"]`: the open phone sidebar or the open filter drawer) takes that modal as its scope: it closes another popover there and leaves the modal open (the filter drawer is an overlay of the page).
  - A menu moves with ↑/↓ (wrapping), Home and End over its entries, `[role^="menuitem"]`: `menuitem`, `menuitemradio` (the operator and sort menus) and `menuitemcheckbox` (ruling P6); it skips disabled entries (`disabled` or `aria-disabled="true"`), which take no focus. Tab leaves a menu, and a dialog after its last element, from the anchor; Shift+Tab out of either lands on the anchor; both call `close(false)`. With focus on a dialog itself (a pressed button that locks, such as “Sync now”, hands focus to it), Tab goes to its first element and Shift+Tab to its last, and it stays open; with nothing to focus, Tab leaves as above.
  - Entries: `v2-menu-item` (36, 44 under `pointer: coarse`; `aria-current` or `aria-checked="true"` at 600; `aria-selected="true"`, the active option of a listbox, on `--tint`; `aria-disabled="true"`, an entry without its target such as a media server without the file's entry, at opacity 0.42 with its reason as `title`) with `v2-menu-text`, and `v2-menu-item--tile` (46, with a 32 tile).
  - Header: `p.v2-pop-title`, the mini-label style (`--fs-2xs`/700, `--ls-group`, uppercase, `muted`), used by the sync popover, the jobs menu and the groups of quick search.
  - Text and footer: `p.v2-pop-text`, a popover's sentence (`--fs-sm`, `muted`), such as “No open jobs.” and quick search's “No matches.” (`v2-qs-empty` lines it up with the groups); `div.v2-pop-foot`, a footer below a `line-soft` divider with its actions on the right, such as the jobs menu's “Show in log”.
  - `wide`: `v2-pop--wide` takes the widest popover width (`--pop-max`, at most the viewport minus 24) whatever its content, so content that changes while it is open (times, states) never moves or resizes it. The sync popover and the jobs menu are wide. `track`: `v2-pop--track` takes `--pop-track` the same way, for the track popover (10.10). The width is the prop `wide` of `Popover` (`true` or `"track"`); without it, and with `true`, the DOM of every existing popover stays the same (ruling P6).
  - In the lists every menu and popover is a `Popover` with `useOneOverlay`: the operator menu, the track menu, the `+n` popover, the sort menu, the media server choice and `HelpTip`. A press in the toast region closes none of them (`inToasts`). Opened in the filter drawer they render inside it. The 1.7.0 menus `MultiFilter`, `OperatorButton` and `EvidenceSourceMenu` keep their behavior until Phases 5b, 5c and 5d replace them.
- **Tooltip / HelpPopover** – share their base with the popover.
- **HelpTip** – `HelpTip` (`components/list/HelpTip.tsx`, from Phase 5a): `button.v2-icon-btn.v2-icon-btn--sm` named by its label, with `aria-haspopup="dialog"` and `aria-expanded`, which opens a `Popover` dialog with its text or its sections (a heading and a text each); Escape and a second press close it, and focus returns to the button. The 1.7.0 `HelpPopover` stays for its other users until Phase 5d.
- **EmptyState** – a 26px icon in a `--tint` tile (radius 12), heading `--fs-lg`, explanation and an optional action; always inside the table card. `ListEmpty` (`components/list/ListEmpty.tsx`, `div.v2-empty`, from Phase 5a) is it, with its icon (`ICON.empty`) in `v2-tile v2-tile--lg` and `h3.v2-empty-title`: without matches it offers Reset filters, without a set-up library the settings. The tools keep the 1.7.0 `EmptyState` until Phase 5b.
- **Loading** – a spinner beside the result count; the busy table state stays as in 1.7.0. The spinner is `v2-spin` on lucide's `LoaderCircle` (a turn per `--t-spin`, linear). In the table card its place (`v2-tc-busy`) is always taken and only `visibility` shows it, while the table's scroll region carries `aria-busy` (10.10); until a service's first results, placeholder rows hold the table's height.
- **Loading screen** – `LoadingScreen({ message })` (`components/LoadingScreen.tsx`, in the start chunk) is `div.v2-loading` on `--bg`: the app icon (`/icon.svg?v=2.0.0`, 72 × 72, decorative), a `v2-spin` spinner and `p` with “Loading Scopearr …” or `message` (such as a status error). The start shows it until the status answers, the library chunk loads and the shell has its first settings answer (10.1). Its icon sits where the sign-in band shows it (`--login-top`, centered, `--login-icon`), so sign-in follows without a jump.

#### 10.9 Overlays

- **Modal** (every pop-up) – centered, 480 / 640 / 1040 wide, radius 16, `--shadow-float`, `--scrim`. Header padding 18/16/14/24, title `--fs-xl`/650, footer with a divider and actions on the right (Cancel → primary or danger). Full screen on phones. Focus trap, Escape, focus return and `inert`.
- **File & metadata** – 1040 × 800 with a fixed header (title; the filename takes at most two lines and never breaks inside the extension), tabs, and ↑/↓ plus buttons that page through the filtered list (“3 of 26”). Opening focuses the title. **Rename** sits in the header: a pencil tile opens a field without the extension plus the fixed extension, with Cancel and Save, Enter and Escape, and field errors (empty or too long, invalid characters, unchanged, target exists – texts from the catalogs). A companion-file dialog lists old → new with a checkbox. Saving shows a toast and a log entry; the dialog stays open and focus returns to the pencil. ↑/↓ inside the field do not page; paging with an unsaved change asks to discard it. The header has the same height in both states.
- **Drawer** – the filter drawer (10.5) and the mobile sidebar (10.1).
- **Quick search** (⌘K) – a native modal dialog at `--qs-top`, centered, `--qs-w` wide and `--qs-h` high whatever it lists, so it neither moves nor resizes while typing or when titles arrive: `panel`, the popovers' border (`--card-border`, light `line-soft`), radius 16, `--shadow-float`, the popover's fade, over `--scrim`. The field is `--qs-field-h` high with a `line-soft` divider, its text `--fs-lg`, without a focus ring (it holds focus for the dialog's whole life; the caret and the active option show where you are). Below it the list scrolls; options are tile menu entries with the context in `muted` (`muted-strong` on the hovered or active option), the active one on `--tint` with the gradient tile. Markup and behavior: 10.1.
- **ConfirmationDialog** and **SavePresetDialog** (one component, Cancel | Save).

#### 10.10 Data

The list building blocks live in `components/list/` and serve all five lists (Design 8.5); in Phase 5a only the libraries use them, the tools follow in Phase 5b. Library-only parts live in `components/library/`. Until a 1.7.0 counterpart has no user left it stays as it is, beside its v2 successor (14).

- **TableCard** – `TableCard` (`components/list/TableCard.tsx`): `section.v2-card.v2-table-card[aria-labelledby][data-density]` with `overflow: clip` (the rounding without a scroll container) holds, in this order:
  - `div.v2-tc-head`, at least `--card-head-min`: on the left `div.v2-tc-heading` with `h2.v2-tc-title` (`--fs-lg`/`--w-title`: the title in `span.v2-tc-text`, such as “Your movies”, with “ · {instance}” when one instance is filtered, which ends in an ellipsis before the filter bar would move; its count `span.v2-count.v2-count--on` (`title` “Items in the list”); the spinner place `span.v2-tc-busy`, `--glyph` square and hidden from assistive technology, always rendered with its LoaderCircle, which `v2-tc-busy--on` shows (`visibility`) and lets turn (`v2-spin`)) and the hint line `p.v2-tc-hint` below the title (hidden season context: one line in `--fs-xs` muted, an ellipsis with the full text as `title`), always rendered, which never changes the head's height: above a card width of 760 it hangs below the title in the head's lower padding, below 760 it has a line of its own, reserved also when empty; on the right the FilterBar (10.5). The head is 68 high (`--sp-4` padding around the 36 controls; 76 under `pointer: coarse`).
  - the ChipsRow (10.5).
  - `div.v2-table-scroll` with the table, `aria-busy` while results load (dimmed to 0.55, as in 1.7.0). Only while the table overflows (`data-overflow`) is it a focusable named region (`role="region"`, `aria-label`, `tabindex="0"`, ruling P11/M1); once focused it stays one until focus leaves it, so focus never falls to the page when the overflow ends. While the table fits, the region keeps the place of its horizontal scrollbar free below it (`padding-bottom: var(--tc-gutter)`): `useTableOverflow` measures that scrollbar once (`overflow-x: scroll` for a moment; 0 with overlay scrollbars) and sets `--tc-gutter` on the region, so the footer stays put when the overflow switches, also with always-shown scrollbars.
  - `div.v2-tc-foot`, at least `--card-foot-min`, with the PageNav.

  Container queries on the card: **1060** the tools drop their labels and keep their counts; **760** the head stacks and the search takes the full width; **560** card rows (below) and a wrapping tool row. No count, spinner, hint or chip change moves the tools, the filter bar or the table. The card sets `--tc-row` from its `data-density` (`--row-h`, compact `--row-compact`; both 56 under `pointer: coarse`, ruling P11/M10): the row height its table and its placeholder rows use, a per-card property like `--row-bg`, so it is not in `tokens.css`.
- **Table** – header 38, `--thead`, 10/700 uppercase .04em muted, sticky. Cells `--fs-sm` with horizontal padding 8 (first and last 20, below 760: 16), rows `--row-h` (compact: `--row-compact`, from the card's `data-density`), dividers `line-soft`, states through `--row-bg` (2.2), sub-lines on hover, selection and open rows in `--muted-strong`. A title cell has the title at `--fs-md`/600 and a sub-line at `--fs-xs`. Child rows use mix(panel2 30%, panel) with an indentation line; the detail row uses `--sunken`. `table.v2-table` (`border-collapse: separate`, so a sticky header keeps its borders) sets its own value for every property of the global 1.7.0 `table`, `th`, `td` and `tbody tr:hover` rules that would change it (the minimum width of 780, or 690 on a phone, the `panel2` header, the cells' top border and padding, the row hover tint), so none reaches it while the 1.7.0 tables still need those rules; the track popover's `v2-trk-table` does the same; the two share the rules for these properties and their header type (`:is(.v2-table, .v2-trk-table)`), and a stylesheet guard checks that every property of the 1.7.0 rules is set. Each body row paints `var(--row-bg, var(--panel))`; a file row (`v2-row`) takes `--hover` on hover, `--tint-soft` selected (`v2-row--selected`) and mix(accent 12%, panel) selected and hovered.
  - **Sticky header** (V7, ruling R-B): `useTableOverflow(scroll)` (a `ResizeObserver` on the scroll region and the table) sets `data-overflow` while the table is wider than its card. Without overflow the region is `overflow: visible`, and `thead th` sticks under the topbar (`top: calc(var(--bar-gap) + var(--topbar-h))`, `z-index: var(--z-sticky)`); with overflow the region scrolls sideways (`overflow-x: auto`) and the header does not stick, since a scroll container catches `sticky`. The switch changes no geometry. Standard columns fit at 1440 (3), so the header normally sticks.
  - **`MediaTable`** (`components/library/MediaTable.tsx`, `table.v2-table`): the selection column (`th`/`td.v2-table-sel`, at least `--select-col`: `SelectionBox` with `v2-check` inside `label.v2-table-hit`, tri-state per page, series and season, “Select this page”, “Select {title}”, “Select series {name}”, “Select season {number} of {series}”, locked while a selection action runs), then the columns of the settings in their order and visibility (All columns shows the hidden ones), each sortable through SortHeader under its label (“Title”, for TV series “Episode”; “Audio tracks” with its sort menu; the others from the column labels); the numbers (year, size, bit depth: `v2-table-num`) right-aligned in `tabular-nums`, `—` for a missing year. Each file's rows are keyed by its file key (`service:id`), so files of two instances never share a key. The cells are those of 1.7.0: media tags (`MediaTag respectHidden`; the codec titled with its family, an HDR tag per value in `div.v2-table-items`), the audio tracks (`TracksCell`), the channels a tag per track (`channelRows`, laid out as the tracks: `v2-trk-row`, stacked `v2-trk-stack`), the custom tags (`CustomTagsCell`), Info (`InfoButtons`) and the title (`TitleCell`); each file row sits in its `TagInformation` provider, as in 1.7.0. Every cell carries `data-label` (its column's label), and the explicit roles `table`, `rowgroup`, `row`, `columnheader` and `cell` keep the semantics when the rows turn into cards. Under `pointer: coarse` the box keeps 20 and its label gets the 44 hit area; the column grows by 8 (padding right `--sp-3`), so that area ends where the next cell's buttons' areas begin.
  - **Title cell** (`TitleCell` in `td.v2-table-title`, at least `--title-col-min`; the column takes the room the others leave, and its lines end in an ellipsis with the full text as `title`): the title (`div.v2-table-line` with `span.v2-table-name`), then one sub-line (`div.v2-table-sub`) with the filename (movies too), the instance name before it when the service has more than one instance (the file's instance name, else the instance's label); a series sorted by another column reads “Series · S01E02” (S01E02–03 for two episodes) and “Episode title · filename”; a season context row (`v2-row--context`, its text `muted`) starts its sub-line with “Season context · not a filter match”, so it keeps the row height. After the title stand the **title marks** (`TitleMarks`: `RowMark`s with a 13 icon in the order and visibility of the info icon settings): `metadata` (warn, in the user's warning color, “Show conflicting metadata” titled “Metadata disagreement”, opens File & metadata), `recognition` (warn, in the user's color, “Show recognition conflicts” titled “Conflicting recognition rules”, opens File & metadata) and `mux` (accent, only with a mux job, “Marked for muxing · {status}”, opens Mux as in 1.7.0); and the outlier mark (info, an image, “Technical outliers”, “Language outliers” or both). A season name with an outlier (`v2-row--outlier`) is `--accent-ink`.
  - **Info column** (`InfoButtons` in `td.v2-table-info`, `div.v2-table-items`, in the order and visibility of the settings): `link` (“Open {service} entry in a new tab”, locked with its hint “Entry link unavailable. …” while the service gives no address), `media` (`MediaLinkButton`, the choices of 1.7.0: none without a media server; one linked server a link titled “Open {server} entry in a new tab”; no linked entry locked with its hint; several servers “Choose media server”, a `Popover` menu of their links, a server without the file's entry a disabled entry with the hint; a choice returns focus to the button) and `details` (“Filename and metadata: {title}”, titled with the filename), each a RowButton with a 15 icon.
  - **Row edge:** `--stripe` in warn for a metadata or rule conflict (`conflict`, `ruleConflict`: `v2-row--warn`), else in info for incomplete metadata (`metadataIncomplete`: `v2-row--info`) (2.4): the row sets `--row-edge`, its first cell draws `inset var(--stripe) 0 0 var(--row-edge, transparent)` (a card row draws it itself).
  - **Group rows** (TV series in their default sort): a series row (`v2-row--series`, `--group-row-h`: the series and “{count} episodes · {count} seasons” of this page) and a season row (`v2-row--season`, `--season-row-h`: Layers, “Season 01” or “Specials” and “Matching files” or “Season context enabled”), both on `--thead`, always shown, without expanding, each with its tri-state box and one cell across the columns. They set `--tc-row` and `--row-bg` for themselves and take no hover.
  - **Placeholder rows:** until a service's first results the body holds `min(page size, files in the cache)` rows `tr.v2-row--placeholder[aria-hidden="true"]` of the row height, so the card does not grow when they arrive. A placeholder row has the cells of a file row (the same classes, without roles and labels), each a no-break space and the title's two lines, so a narrow card wraps them into the same lines as a file row (below).
  - **Card rows** (V15, ruling R-D, below a card width of 560, so a phone; 740 with the rail stays a table; all in the card's single 560 block of `data.css`): `table` and `tbody` become blocks, and every body `tr` becomes a grid of as many `--card-cell` columns as fit (`repeat(auto-fill, minmax(var(--card-cell), 1fr))`: 3 at 375, 2 at 320, 5 at a 560 card) with `--sp-3`/`--sp-2` padding, a row gap of `--sp-2` and a `line-soft` divider (none after the last). Its first line holds the box (`grid-area: 1 / 1`, above the title, at 16 like the sort bar's box), the title with its sub-line (all columns but the last, its text after `--select-col`) and the Info buttons (the last column, at its end); then every other visible column follows in column order, wrapping into further lines, the audio tracks and custom tags (`v2-table-wide`) two columns wide, their tags and chips wrapping inside; a number (year, size, bit depth) takes its `data-label` as a `muted` prefix (`::before`, `content: attr(data-label) / ""`, so the label stays out of the cell's accessible text, which the column header gives) and may wrap. Without the Info column the title takes the whole first line (`:has()`), so no other cell moves up into it. A placeholder row's cells are at least a tag high (`--tag-h`; the two-column ones a track chip, `--track-chip-h`), so with the default columns it is exactly as high as a file row (150 at 375); a file row with taller cells (two HDR values, stacked tracks) is higher. A card row draws its edge itself. `thead` becomes a sort bar that scrolls sideways (the same buttons and names, the page checkbox first, the title column at its own width, the last header filling the bar), and a group row becomes a full-width header line (its cell across the grid).
- **SortableHeader** – a 28 button with an 11 arrow (55% opacity; active: full opacity and `--accent-ink`). Cycle ascending → descending → default with `aria-sort`. `SortHeader` (`components/list/SortHeader.tsx`) is it: `th[scope="col"][aria-sort]` with `button.v2-sort` (`--sort-btn`; the arrow `v2-sort-arrow` at `ICON.arrow`), named “Sort by {field}” with the 1.7.0 `title`; a numeric column sets `th.v2-table-num` (right aligned) and `v2-sort--num` (the arrow first); `grow` sets `th.v2-table-title`, the title column that takes the room left; the explicit `role="columnheader"` keeps the header a column header in the sort bar of a narrow card. A press asks `onSort(field)`, and the caller cycles with `nextTableSort`. The audio tracks column has a sort menu instead: its button (`aria-haspopup="menu"`, `aria-expanded`) opens a `Popover` menu of `menuitemradio` entries (`v2-menu-item`, `aria-checked` on the active one, which shows its arrow), each “Sort by {field}” with an existing label and the cycle's `title`: “Sort by Audio tracks” for `audio` (by language, then codec) and “Sort by Channels” for `channels`. A choice sorts by it and returns focus to the button, and `aria-sort` follows the active entry. Language has no sort field of its own: `language` is the legacy alias that both clients fold into `audio` (ruling P3), so a stored sort stays valid for 1.7.0. The tools keep the 1.7.0 `SortableHeader` until Phase 5b.
  - **Library sorting** (from Part 2): movies sort by title ascending by default; TV series by series A–Z, then season and episode ascending, with season rows. Descending Episode reverses the series only. Every other column sorts episodes flat, with series, season and episode as tie breakers and without season rows or context; the card's hint line says when season context is hidden, and the season setting is kept. The third click restores the default. CSV uses the same order and mode. Movies and TV series keep separate sorts in the browser.
- **RowActions / Info column** – the Info column holds the Arr link, the media-server link, File & metadata and, on the tools, the **terminal**; TV series have no expansion (group rows, above). The action column holds only start/retry/fix/consolidate and remove.
- **SelectionBox** and **BulkBar** – selection actions live in the ChipsRow. The selection covers the visible page only and clears on a page, sort, filter, preset or instance change and when the library is left (`useFileSelection`, as in 1.7.0).
- **Pagination** – round buttons 34; the active page uses `--grad-btn` with `--shadow-tile`. `PageNav` (`components/list/PageNav.tsx`) is it: `nav.v2-pager`, named “Page {page} / {pages}”, with the summary (`v2-pager-sum`: “{from}–{to} of {total} files”, “ · by series and season” with season rows, “0 files”), then in `v2-pager-pages` “Previous page”, the page buttons (`v2-pager-btn`, at least `--page-btn` and round, 44 under `pointer: coarse`; the current one with `aria-current="page"`, a press on it is no jump), the gaps (`v2-pager-gap`, as wide as a button, hidden from assistive technology) and “Next page”, with the arrows of the meaning table (Part 2, Icons). `pageWindow` gives a fixed number of slots for a page count, so paging moves no button: every page up to seven pages, else seven slots with the first and the last page, the current one ± 1 and gaps, filled from the near end (1–5 … last; 1 … last − 4 – last); a gap hides at least two pages (never 1 … 3). Page numbers up to three digits fit a button. The page size (1–1000) comes from the settings; the footer has no page-size select (V12 not chosen). A page beyond the last, after a filter change, jumps back to the last one, as in 1.7.0. The tools keep the 1.7.0 `Pagination` until Phase 5b.
- **Progress** – bar 6 (thin 4, distribution 8), percent slot 36.
- **KeyValueList** – `kv` (dt muted, `line-soft` dividers) and `kv2` (two columns, rows at least 40, label 120–170) for service status.
- **Terminal** – stays dark and fixed (`#0b1012`, text `#cfe3dc`, ok/err/dim), monospace 12/1.65, at most 50dvh.
- **Ring / DistributionRow** – ring 128, value 24/700; a distribution row with a bar of 8 and a percent of 52. Every value opens the filtered list.
  - **Ring** (`StorageCard`, class family `v2-ring`): an SVG of `--ring-size` with a stroke of `--ring-stroke` on a `panel2` track; used and free in the user's colors from Settings → Widgets (inline, user data like custom tag colors); in its middle the used share (`percent()`, `--fs-2xl`/700); named “{used} used · {free} free”. Beside it the legend Used space, Free space and Total space (dots in the user's colors, Total in `muted`). The areas with their buttons (“Storage area”, “Previous storage area”, “Next storage area”), `scopearr-storage-areas`, the refresh every 60s and the error and hint texts are those of 1.7.0. The area's name (without “radarr · ”/“sonarr · ”, its paths as `title`) is the card's sub-line, the buttons sit at the end of its head. Before the first reading the ring shows its track and the legend its labels; without a reading (no paths, or an error) the hint takes the ring's place, which keeps the ring's height; an area's own error reads below. Parts: `v2-ring-nav`, `v2-ring-chart` (`role="img"` with the name; the SVG `aria-hidden`), `v2-ring-track`, `v2-ring-arc`, `v2-ring-value`, `v2-ring-side`, `v2-ring-legend`, `v2-ring-note` and `v2-ring-error`.
  - **DistributionRow** (`DistributionCard`, class family `v2-dist`): a row of at least `--dist-row-h`. The value (its media tag, or flag and name for a language) is a `NavLink` named “Filter {field}: {value}” to the filtered list (the target of `openDashboardFilter`: the scope's service, the preset reset), followed by its count, its percent (`--dist-percent`, `tabular-nums`) and, across the row, a bar of `--progress-dist` in `--chart-1` (Unknown: `--muted`, 2.2). A card shows five rows; More shows all and Less five again, as in 1.7.0. Its body is at least `--dist-body-min`, so the More place is reserved and the card has its height before its data. Without values it reads “No files in cache yet” (`v2-empty`). All distributions share this card: a language row differs only in its flag and name. The card's head shows its title (“Audio” for the audio codecs, as in 1.7.0) and the files counted (“{count} files”: the scope's files for audio, its language total for languages, else the sum of the values). In the grid each card keeps its own height, so More grows only its card, below its content. Parts: `v2-dist-head`, `v2-dist-sub`, `v2-dist-body`, `v2-dist-row`, `v2-dist-go`, `v2-dist-n`, `v2-dist-pct`, `v2-dist-bar` and `v2-dist-bar--unknown`.
  - **Matching bar** (`MatchingCard`, class family `v2-match`): the groups with files stacked in a bar of `--progress-dist` in their tones (`v2-match--ok`, `--error`, `--warn`, `--off`, 2.2), decoration only (`aria-hidden`: the counts stand as text), then the list `v2-match-list` of the four groups, each a line of at least 36 with the tone's dot, the group, its HelpTip and the count `v2-match-n`.
- **TrackChip** – **one continuous chip** `[flag | codec | channels]`, 24 high, radius 6, `--fs-2xs`/600. All segments share surface and frame with 1px dividers (colors 2.5); there is **no default dot**. Tooltip and `aria-label` name track number, language, codec, channels, default and title. Default yes/no appears only in the `+n` popover (Default column) and in File & metadata → Audio. Without a track assignment the chip is dashed all around. The same chip appears stacked, in the `+n` popover and in the mux options. A click opens a menu: language only · codec only · channels only · language with codec (same track).
  - Markup (`components/library/TrackChip.tsx`): with a menu `button.v2-trk` (`aria-haspopup="menu"`, `aria-expanded`), else `span.v2-trk`; its name and `title` are “Track {number} · language · codec · channels”, then “Default track” and the title when they apply (codec and channels as their tags read, with the user's tag labels; an unknown part reads “Unknown” or “Unknown channels”; a hidden codec or channel value is left out, as `Tag respectHidden` left it out entirely). Segments: `span.v2-trk-f` (the flag, a `LanguageFlag` that takes no focus, `--track-flag-w` × `--track-flag-h`), `span.v2-trk-a` (codec) and `span.v2-trk-c` (channels); an information-only value adds `v2-trk-text`, an unknown one `v2-trk-unknown` (also the flag segment of an unknown language). `v2-trk--stretch` (stacked) fills the stack's width, the codec takes the room and the channels (at least `--track-ch-min`) align right. A chip without a track assignment is `LooseChip`, `v2-trk--loose`: one `v2-trk-f` with a flag per language (when it has languages), then a `v2-trk-a` per codec and a `v2-trk-c` per channel value. A chip offers its menu only when it knows a part to filter by; else it is a span. Under `pointer: coarse` a chip with a menu keeps its size with an invisible 44 hit area, and the lines of a stack are 44 apart. A space separates its segments (whitespace between its flex items is not rendered), so its visible text reads as words of its name (“DTS 5.1”, WCAG 2.5.3).
  - The menu (`TrackMenu`, a `Popover` menu “Filter by this track” of `menuitem` entries): “Only {value}” for its language, its codec and its channels, and “{language} with {codec} (same track)”, each only for a part it knows and that is not hidden (as the drawer's options; a loose chip has no “same track”), a value named as its tag reads. A track chip's channels entry is the combination `||{channels}`, which the file's own measured tracks match; the stored channels field may hold a filename's or a confirmed value instead. A loose chip offers a channel value only when the stored channels field holds it (`file.channels`, split at “ + ”), as its entry sets that field. A choice returns focus to the chip, closes the menu and then asks the cell's `onFilter` with the action; the page replaces only that field (operator `eq`) or sets `track` (its operator reset), on page 1.
- **TracksCell** – compact: at most two chips (the second only when both codecs together have at most 12 characters) and a `+n` popover; option “stacked” (the row grows). Column ID `audio`; channels normalized.
  - Compact: `div.v2-trk-row` with the chips and `button.v2-trk.v2-trk--more` (“+n”, named “+n · Show all {count} audio tracks” – what it shows, then what it does, WCAG 2.5.3 – and titled “Show all {count} audio tracks”, with the number of all tracks, `aria-haspopup="dialog"`), which opens `TracksPopover`: a `Popover` dialog “Audio tracks of {title}” (`v2-pop--track`) with that title as its `v2-pop-title` and a `table.v2-trk-table` of Track (the static chip), Language, Title (a muted “—”, `v2-trk-quiet`, without one) and Default (Yes or No); the table sets its own minimum width, header surface and borders, so the global 1.7.0 `table`, `th` and `td` rules do not reach it. Stacked (`scopearr-tracks-stacked`, 10.1): `div.v2-trk-stack`, every track on a line of its own. A loose chip follows the tracks. One menu or popover of a cell is open at a time; a second press on its chip closes it.
  - Without a track assignment (no measured tracks, or an active audio or language confirmation) the file's languages, codecs and channels form one dashed chip, named by its values (“German, English · AC-3 · 5.1, 2.0”). Beside assigned tracks, values reported without a track form one more dashed chip, named “Additional reported values without track attribution” followed by its values. A loose chip without a language whose values are all hidden is not shown. A file without any audio value shows one muted chip without a menu, as the 1.7.0 audio cell: the unknown language and “Unknown” (`span.v2-trk.v2-trk--unknown`, its frame `line-soft`, named “Unknown”; a hidden `audio:__unknown__` leaves the flag; Task 4 fix round, ruling M3).
  - Only an audio or a language confirmation drops the track assignment (L30). A confirmed channel value keeps the measured tracks: the chips and the popover show the measured channels, the values a track combination matches, and the Channels column (`channelRows`) shows the confirmed one.
  - The column is labeled “Audio tracks”. “Channels” stays an optional column of its own (`channels`, a media tag per track); there is no “Language” column, which would need a new column ID.
- **CustomTagsCell** – an edit tile and the tags **in media-tag form** (radius 6, 22, 11/600, padding 7, colors 2.5), with a 12 × 12 auto mark (radius 3, 8/800). The same form appears in the table, the custom tags dialog, settings and File & metadata; overflow uses `+n`. In the libraries (`components/library/CustomTagsCell.tsx`, `div.v2-table-items`): the sm RowButton “Edit custom tags: {title}” (a 13 icon), at most two `CustomTag`s (10.7), then “+n”, a `span.v2-ctag` in the neutral tone that reads “+n” (hidden from assistive technology) and is named by a `v2-sr-only` list of the other names as their tags read them (display name, else name) and titled with it. A hidden custom tag neither shows nor counts. An auto tag keeps its mark, explanation and dialog; under `pointer: coarse` the mark's 44 area starts at the mark and runs right, so it stays clear of the edit button and of its area (the button's area ends 1 before the mark).

#### 10.11 Settings components

- **ServiceCard** – header: 40px service tile (gradient), name/instance, status tag, actions and a “service active” switch behind a divider. **Status comes first** as `kv2`, then configuration (two-column form grid, `--sp-4`), then further sections with a divider and section header. Unraid shows **one** mover/parity status. Service tabs include Radarr 4K with the correct file count.
- **ModeToggle** – segment Dark | Light, beside the **BandToggle** Strong | Muted (2.3).
- **PalettePicker** – tiles 42 high (`--sunken`; selected `--tint` with a 2px accent ring and halo), 3 columns, 2 below 1120, 1 at ≤ 739. **PalettePreview** per mode with a mini band, header, row and buttons (scoped tokens, 2.2).
- **ColumnOrderEditor** – a segment per list; a list of 46-high entries (handle, visible, name, ↑/↓, lock) beside a preview of the list; stacked below 1120. Option to show audio tracks stacked. Until Phase 5c rebuilds Display, that option is the checkbox “Show audio tracks stacked” in the 1.7.0 layout of Display → Lists & columns (its own card “Audio tracks” after the column editor), and “Row density” a select (`standalone-field`) in Display → General (its own card between the TV view and Pagination row and Resolution groups), each with its hint and without new 1.7.0 CSS; both are drafts like the interface language and are written to `localStorage` only after a successful Save settings (4, 10.1). Both cards render only while Display is shown, so the hidden section keeps its 1.7.0 markup.

### 11. Page recipes

#### 11.1 List and tool pages

Movies, TV series, Mux, Disk placement and Files & permissions: band page header → (tools: the 84 KPI row; Disk placement: the disk cards) → optional SetupNotice → TableCard. The first card sits at y = 146/172, and the first table row sits at the same height on all three tool pages (y = 401 at 1440 in the design).

**Libraries** (`LibraryPage`, rebuilt in Phase 5a) stand without the transition sheet (`sheetPage`, 10.1): the PageHeader (“Movie library” or “TV library”, the files in cache, the instance segment in its action slot, 10.6) → the SetupNotice when the library is not set up (10.8) → the TableCard (10.10) with its filter drawer (10.5). The first block starts at y = 146/172 and overlaps the band by `--overlap`; `div.v2-view` has no padding on such a page (the sheet's padding goes with `data-sheet`, 10.1), and `div.v2-list-page` (`pages.css`) stacks the SetupNotice and the TableCard with `--sp-4` between them. Entering a library clears the selection and closes the drawer, and every filter change is a route replace (10.5). The tools keep the sheet and the 1.7.0 filter panel until Phase 5b.

#### 11.2 Disk placement

No “mover inactive” or “parity valid” display and no explanation text. Mover and parity appear only when they act: as the row status for waiting on the mover or a parity operation, and as a notice in the scan and start dialogs (texts from the catalogs). Disk tags show only names. The target disk is chosen as in 1.7.0 (`placement_scan.go`).

#### 11.3 Dashboard

KPI row (the 1.7.0 order, the hero Media files last; every KPI a link) → widget row with the storage ring (3 columns, 2 below 1280) → distribution grid (3, 2 below 1120, 1 on phones).

`StatisticsPage` (rebuilt in Phase 5a from `components/dashboard/`, without the transition sheet) keeps its header “Dashboard” / “From the local cache”:

- **KPI row:** the four KpiCards (10.2) in the 1.7.0 order, Media files last as the hero (`v2-dash-kpis`; 2 columns below 1120).
- **Widget row** (`v2-dash-row`, 1 : 1.25 : 1, its cards as high as the highest; without storage the two cards share the row 1 : 1.25; below 1280 two columns, the third card spanning both; phones one): each a widget card (`v2-card v2-widget`: padding 20, its head `v2-widget-head` with a 40 tile, the title `v2-widget-title` and the sub-line `v2-widget-sub` in `v2-widget-name`, actions at its end, at least 44 high on touch; then its content: `v2-widget-num` and `v2-widget-text` share the KPI value's and detail's look, a `v2-btn--sm` at the bottom). **Incomplete metadata** (`IncompleteCard`: the count, its explanation and the link “Show”, named “Show · Filter Metadata status: incomplete” – the visible text first, WCAG 2.5.3 – to `metadata=incomplete` in the scope's service); **Media server matching** (`MatchingCard`: the files as its sub-line, the stacked bar in status colors, 2.2, class family `v2-match`, 10.10, and its four groups Matched, Not found, Needs review and Not checked, each with a HelpTip and its count, without links, as no group is a single filter); **Storage** (`StorageCard`, the ring, 10.10) whenever the widget settings show it and the settings are loaded (ruling R-E). The storage card shows the areas of the scope chosen below it; in 1.7.0 it sat inside the scope's tab panel.
- **Distribution:** the heading “Distribution” with `Segmented` tabs “Entire library / Movies / TV series” (`v2-dash-head`; “Statistics scope”, `scopearr-dashboard-scope`, 10.6), then the distribution grid, the tabs' panel (`v2-dash-grid`, 3 columns, 2 below 1120, 1 on phones, each card its own height): the visible distribution widgets in the order of the settings, each a DistributionCard (10.10), or, when no widget at all shows, “No dashboard widgets selected.” (`v2-dash-note`). There is no HDR distribution (no new widget value).
- **Fixed geometry:** every card has its final height from the first paint; while loading, the cards show placeholders (empty value lines, the ring's track, empty distribution bodies) and only screen readers hear “Loading dashboard …” (`p.v2-sr-only[role="status"]`); a failed load offers “Retry” (as in 1.7.0, without the error text) in the page header's action slot, so nothing moves. Retry leaves the slot while its load runs; when that load ends, focus that fell to the page goes on to `main` (without scrolling), or to Retry again when it failed (5a fix wave).
- “Show” and the Media files KPI count the whole library but open one list: the scope's service (`dashboardService`) and the movies. Both are on the deviation list for the user (ruling R-K).

#### 11.4 Settings

Each area is reached through its sidebar group. The description and Save settings sit on the band. Cards use 1–2 columns (`--sp-4`). Services: a segment of the instances plus Add service, with **one** ServiceCard below. Display: segment General | Lists & columns | Colors. Settings routes follow `docs/ARCHITECTURE.md`, “Routing (2.0.0)”.

#### 11.5 Login and setup

A centered card with the brand, the form and a footer. The footer keeps a space between the version and the following text (“Scopearr 2.0.0 · For your own server”); 1.7.0 rendered “1.7.0· For …”.

`components/Login.tsx` is sign-in and, on an uninitialized instance, setup (one component, props `status`, `done`, `expired`); `data-theme` and `data-band` are already on `<html>` (10.1, theme and band). Roles, names and these classes are the test contract:

- `main.v2-login` (`--login-screen` high at least, padding `--login-top` 16 `--login-pad`, a centered column) holds `div.v2-login-band`, the card and the footer.
- **Band:** `div.v2-login-band` (`--band-ink`) holds `img` `/icon.svg?v=2.0.0` (“Scopearr icon”, 72 × 72 in its attributes, so its box is known before it loads), `h1` “Scopearr” (`--fs-brand`/700, `--lh-brand`, `--ls-display`) and `p` “Your movie and TV library. Clearly filtered.” (`--band-ink-soft`, `--fs-md`), with a gap of 10 and `--login-pad` below. Its `::before` draws the band from the page's edge (`--edge`), `max(--login-band-min, --login-band-h)` high, radius 16, `--band-bg` and `--band-edge`, under the brand and the top of the card (`isolation` on the page, `z-index: -1`).
- **Card:** `form.v2-card.v2-login-card` (`--login-w` at most, padding `--login-pad`, a column with a gap of 16): `div.v2-login-head` with `h2` (“Welcome back.” or “Your library starts here.”, `--fs-xl`/650, wrapping beside the language) and the 1.7.0 `LanguageSelect` (its label text hidden, the select named “Interface language”, 36 high like a field, with the field's focus and transparent outline); `p.v2-login-text` (the description, muted); the notices `p.v2-notice.v2-notice--warn[role="status"]` “Your session expired. Sign in again.” and, in the demo, `p.v2-notice` “Interactive demo with sample data. Credentials are prefilled.”; then the fields in the order of 1.7.0, each a `v2-field` with a `v2-input v2-input--lg`: Setup code (setup only; `autocomplete="off"`, its hint “Copy the one-time code …”), Username (`autocomplete="username"`) and Password in a `v2-input-group` with the reveal toggle (10.4; `current-password`, on setup `new-password` with `minlength` 12 and its hint “At least 12 characters, at most 72 UTF-8 bytes.”). All are required; the browser's own checks stop a submit. Last the `v2-btn v2-btn--primary v2-btn--lg` “Sign in” or “Create account” with the arrow, which a `v2-spin` spinner replaces while the request runs (the button is disabled, nothing moves).
- **Footer:** `p.v2-login-foot` “Scopearr {version} · For your own server” (`--fs-sm`, muted), at the page's bottom.
- **Behavior** as in 1.7.0: the demo fills in its credentials; a submit posts `login` or `setup` with username, password and code, then refreshes the status; a refusal (such as “Login failed or temporarily locked” or “Setup code is invalid”) is the API's error toast and the page stays; a signed-out deep link opens after sign-in.

#### 11.6 Behavior and preview simplifications

1. Hash routing without reloads, as specified in `docs/ARCHITECTURE.md`, “Routing (2.0.0)”. A page change scrolls to 0 and fades the content in; the frame stays in place.
2. Sidebar: rail flyouts and their state machine (10.1), no automatic expansion, one expand/collapse button at the bottom, state in `localStorage`.
3. Filters as in 10.5, no filter column; the bell; framed table icons; **every pop-up is a centered modal**, no side sheet.
4. Sync: card in the sidebar footer (expanded), chip in the topbar (rail), row in the drawer header (phones) – never visible twice.
5. KPIs (dashboard, tools) and distribution values filter or open the filtered list; marking for mux offers a link to Mux.

Where the design preview simplifies, 1.7.0 stays authoritative:

| The preview shows | Authoritative |
| --- | --- |
| Simulated flows (timers), no persistence | The real 1.7.0 API and jobs |
| Illustrative service form fields | 1.7.0 fields and flows |
| Bundled presets | Only user presets as in 1.7.0 (bundled presets come after 2.0.0) |
| Storage ring from disk placement data | 1.7.0 storage widget data, shown as a ring |
| Charts with four colors | One bar color per row, status colors for matching (2.2, Phase 5a) |
| No density switch | Comfortable and compact rows, chosen in Display (4, Phase 5a) |
| Expanding series, a language sort and column, a page-size select in the footer, a “More” row in distributions, an HDR distribution | Group rows as in 1.7.0; the `audio` and `channels` sorts and no Language column (10.10); the page size from the settings; More and Less; no HDR distribution (Phase 5a) |
| Column editor dragging on desktop only, generic episodes | 1.7.0 keyboard/touch ordering and data |
| Counters consistent with demo data | Real counters |
| “Band off” mentioned as an idea | Not part of 2.0.0 |

### 12. Accessibility and icons

- Focus is always visible: `:focus-visible` uses a 2px (`--outline-w`) `--ring` with a 2px offset (`--band-ink` on the band; fields use `--focus`). Provide a skip link; keyboard support in menus, tabs, flyouts and drawers; Escape with focus return; a focus trap in modals and drawers; `aria-current`, `aria-expanded`, `aria-sort`, and `aria-live` for jobs. Touch targets are at least 44. In CSS, `.v2-root [class*="v2-"]:focus-visible` gives every v2 element the ring (1.7.0 content keeps its own until its phase), and `.v2-sr-only` hides text visually while assistive technology still reads it.
- Icons come from `lucide-preact`. Sizes: 11 (sort arrow, `ICON.arrow`) · 12 · 13 (brand, xs button) · 14 · 15 (row button) · 16 (default) · 18 (40px tile) · 20 · 22 (48px tile) · 26 (empty state). Phases 4 and 5 map them onto `ICON`. The meaning table of Part 2 (Icons) stays valid. One glyph is drawn in CSS instead, with lucide's path data: the password toggle's eye (10.4), to keep the start chunk in its budget.
- **App icon:** a squircle (radius about 28%) with a gradient from mint `#7ee4c5` through `#3fae8f` to teal `#14755c` and a light gloss; a magnifier with a dark rim and light glass, holding a teal funnel, **without** dots. The SVG master is `web/public/icon.svg`; a script derives PNG 64/180/256/1024 and `favicon.ico`. The in-app brand is single-color `currentColor` in `--accent`. The Unraid template icon URL carries `?v=2.0.0`.

### 13. Testing the interface

2.0.0 replaces tests that pin 1.7.0 class names and stylesheet text with tests of geometry, behavior and roles:

- **Pixel and DOM baseline.** The pixel project (`pnpm --dir web e2e:pixel`) compares screenshots and DOM snapshots. Phase 3 changes no pixel and no DOM node. Each frame or page rebuild re-records the baseline deliberately, in its own commit with a reason; an unexplained difference is fixed in code, never by updating the baseline. Screenshots compare at a per-pixel threshold of 0.05: Playwright's default of 0.2 let the old header behind a dimmed modal backdrop pass, and 0 flakes on the band's gradient. The same threshold holds for the sign-in shots since Task 15 drew their icon from the SVG master (1.7.0 downscaled PNGs, which Chromium resampled one of two ways from run to run, and kept them at 0.1). New open states are added with `--update-snapshots=missing` only. No shot depends on the network: the pixel and review projects pin the demo server's live GitHub release check to the baselines' “Version is up to date” (`pinReleaseCheck` in `web/e2e/app.ts`).
- **Layout invariants** (automated e2e): the first card starts at y = 146 (≥ 740) and 172 (≤ 739) on every page; no page overflow from 320 to 1600px; the movie table at 1440px with the rail fits without horizontal scrolling in all four languages; the rail click test (ten fast clicks on five icons, with and without reduced motion) keeps the rail at 72 with `scrollLeft` 0; a page change moves no navigation entry; touch targets are at least 44 under `pointer: coarse`; with the typeface 1.5s late the mux table's headers get the widths they have with it from the start and none is cut, in four languages.
- **Frame invariants and behavior** (`web/e2e/frame.spec.ts`, e2e project `invariants`, tolerance 0.5px, at 1600, 1440, 1120, 1119, 820, 740, 739, 375 and 320):
  - **Geometry per breakpoint** on eight pages: the sidebar 260 (expanded), 72 (rail) or a hidden drawer; the band at 16/194 (≤ 739: 0/220); the topbar at y 24 (6), 52 high; the page header 70 (114) high; the sheet and the content at 146 (172).
  - **Nothing moves:** the boxes of every shown sidebar entry, topbar control and tab stay the same between pages, after theme and band changes, with a flyout or a popover open and closed, and after a 600px scroll (the sticky topbar keeps its size, its controls their place in it). The targets recorded when `.v2-nav` first appears, and in each animation frame of the load, equal the settled ones, and none appears or leaves later; with two enabled movie instances and the settings answer 300ms late, the instance entries come with the first paint (E12). On fresh loads of eager and lazy pages the page header paints with the frame; on a slow connection a lazy page may show the band without a title until its chunk arrives, and nothing moves when it does.
  - **Scroll:** `data-scrolled` from 5px with the same topbar box; a page change scrolls to 0, a filter or a sort change (a route replace of the same page) does not.
  - **Overflow:** no page scrolls sideways from 320 to 1600 with either stored sidebar choice; a stored expanded sidebar at 900, 899, 820 and 740 is checked on its own on all five lists, each time with the sidebar expanded (the libraries' filter bar follows its card, `library.spec.ts`; the tools' 1.7.0 filter row puts its search on a line of its own there, Part 2 Shared filter panel).
  - **Content and toasts:** the 1.7.0 content and its text start on the transition sheet, no band point between topbar and sheet shows it; toasts stay clear of the tab bar; a toast after Sync now in the sync popover and one while the jobs menu is open starts 12 below the popover, in no animation frame over it, the popover stays open after a press on the toast, and the frame does not move; at 1440, 820 and 375 two toasts on Movies (two instances) start 12 below the card head and an error's toast on a failed dashboard load 12 below Retry, at the top and while scrolling no animation frame shows a toast over the filter bar or the header's actions, scrolled away they are back at their top, and Retry takes its click with the toast up.
  - **Rail and flyout:** the fast-click test; tiles at x = 36 and the toggle in one place in both modes; peek after 150ms, a switch without delay, closing 220ms after leaving with the bridge into the flyout; an outside press and a resize close; mouse focus does not open; → / Enter / Space focus the current entry, ↑ ↓ Home End wrap, ← and Escape return focus and keep it closed; Tab and Shift+Tab leave every group flyout in rail order; the first tap opens a group, the second navigates; a group sits at its entry's top − 4 and inside the card, a label centered on its entry; hiding the focused tool closes its flyout; Escape in a native dialog closes the dialog, not the flyout; a popover or menu closes on Escape or a press outside as soon as it shows.
  - **Sync display:** with enabled instances the chip (1440), the card (1600) and the drawer row (375) open the sync popover, one display and one popover at a time, with each instance's System → Info line and its locked button; Escape returns focus to the trigger. From the drawer row the popover renders in the drawer: Tab and Shift+Tab stay in the drawer, the first Escape closes the popover (focus on the row), the second the drawer (focus on More). Without sync data the display reads “Synchronization” and the lines “Not synced yet”; without an enabled instance there is none.
  - **Jobs menu:** the bell is named with the count of the status's open jobs and shows it as an error-toned plaque when a job failed; startup asks for no job list beyond the library's `mux/jobs`. Opening it asks only for the jobs of the tools with open jobs and shows a row per such tool (none for a visible tool without jobs) with its counts and its jobs below, focus on the first row; its height and the place of “Show in log” are the same while the jobs load (held) and after they arrive; the bell's Disk placement, Files & permissions and mux requests answer 200 from the demo server; Escape returns focus to the bell; a row opens its tool page (by pointer and by Enter) and returns focus to the bell, also when the unsaved-changes question declines it; “Show in log” opens `#/settings/system/log?level=error&source=…` with the failed tools' sources and returns focus to the bell; a resize closes the menu and returns focus to the bell (none to a sync chip the new layout removes); jobs that cannot be loaded leave the tool's row alone, without a notice. Outside the demo a polite live region carries the bell's name, and the same node changes its text when the status's count changes; the demo has none.
  - **Quick search:** Quick search and Ctrl+K open it (also from the library's filter field, focus back there after Escape), Meta+K too; “arri” finds Arrival, Enter opens `#/movies?q=Arrival` with “Movie library”; Escape returns focus to the button; ↑/↓ and the pointer move the active option; a page opens through its link; its requests ask for 6 titles per library and reach the server; its box, its field and its first option keep their place and size while titles are on their way (held) and after they arrive; ⌘K from the open jobs menu (or the phone's Tools menu) and Escape return focus to the bell (Tools), Ctrl+K and Meta+K from the rail's flyout to its entry; it has the popovers' border in both themes.
  - **Drawer and tab bar:** a closed drawer takes no focus; the open drawer is modal above topbar and tab bar with focus on Close, keeps Tab and Shift+Tab inside, and Escape (also with focus on body), the scrim, Close and an entry return focus to More, a resize to 740 none; the Tools menu opens the tools and returns focus to Tools; Spanish and Italian tab labels fit at 375 and only end in an ellipsis with their name as `title` at 320.
  - **Focus rings** of brand, entries, sub-entries, flyout items and Close are never cut off by a clipping ancestor; every frame target reaches 44 × 44 on a touch screen (phone and drawer, tablet rail at 1024 and 820, where the dot-only sync chip reaches 44 by its hit area, 10.7, and no hit area of the topbar overlaps a neighbour; the sync popover at both); the sidebar keeps its mode and groups through a reload; `data-theme` and `data-band` are set at `DOMContentLoaded`; with a palette (Nordic), every animation frame of the app shows its accent for the shown theme, from the first frame and through two theme changes; a Ctrl/Cmd click on a frame link opens its route in a new tab, a plain click opens it without a reload.
  - **Sign-in and setup** (signed out, 1440 and 375, status answers 300ms late): the loading screen comes first, with `data-theme` and `data-band` already set, and its icon has the box of the sign-in band's icon; every box of the sign-in or setup page (icon, name, claim, card, heading, language, notices, fields, password toggle, button, footer) is the same from the moment the page enters the document through 60 animation frames. Behavior tests check the password toggle (a press keeps focus in the field, Space on the focused toggle keeps it there, the name stays “Show password” while `aria-pressed` changes) and the 1.7.0 checks and messages (a refused sign-in, the setup code and the 12-character minimum without a request, a refused setup code).
- **List and dashboard invariants and behavior** (`web/e2e/library.spec.ts` and `web/e2e/dashboard.spec.ts`, e2e project `invariants`, tolerance 0.5px, Phase 5a). The libraries: the card starts on the band (146/172) right below the page header without a sheet, at 1600 to 320 and with a stored expanded sidebar at 899, 820 and 740, without sideways overflow; nothing above the table body moves from the first paint on (lists answered 300ms late; band, page header, card, its head, title, filter bar, chips row, tools, table header and the first row's place, recorded in every animation frame; the movies' placeholders also keep the first row, the card and the footer in place, also as cards at 375; TV series learn their group rows with the results, so only the card's end grows), also through movies → series → movies, at 1440, 1119, 820, 740 and 375 and with a stored expanded sidebar at 820 and 740 (where the default columns overflow the card, at 820 and 740 beside the rail, the table keeps its place and widens once when the results replace the placeholders, a known limit); selection 0 → 12, filters 0 → 9 → 10 and busy move no tool, the Filters button, the title or the table header, and the spinner never moves while it shows; the chips row keeps its height with 0, 1 and 20 chips; the season hint never moves the head; the drawer (Escape, Close, Apply, at the top and scrolled) moves nothing of the page, stands at the right and fills a phone; movies and series share one card head on phones. The header sticks at 60 while the table fits (also under the card's `container-type`) and the region is then no focusable region; with All columns and an expanded sidebar the table scrolls in a named, focusable region and the header scrolls away. At 375 every row is a card with all its visible columns (rows and cells by role) under a sort bar that names every column, scrolls sideways and sorts the route, and TV series read the same for assistive technology as at 1440 (Chromium drops a group cell's column span in card rows, a known limit). Rows are 48, compact 40 and 56 on touch. The default and the C+ columns fit at 1440 in four languages; the page tools keep their places at card widths 1061 to 1300 in four languages for a whole-page selection and through every frame of a mux run, also in four languages. Operation: the drawer applies only on Apply (its count is the live request's `total`, no history entry), keeps Tab inside, closes in Escape order (its operator menu first) and returns focus to Filters, takes the filters of a history step, and its chunk loads once more after a failed preload (twice failed: the error notice, no reload); track combinations, a track chip's menu (only its own field, page 1), the `+n` popover and stacked tracks; chips (one value, all/not all the whole field, focus to the chip in its place), presets (saved, chosen, duplicate named, deleted), All columns, Set tag, the media server menu, the season outlier filters, the instance segment (it stays in place), menus that survive a press on a toast, quick search closed over the drawer, a page past the end, and 44 px targets of the card and the drawer on a touch screen, where TV series' group rows keep their boxes' areas within the row. The drawer takes the filters of Back and of Forward, and a drag out of it leaves it open. Helpers in `web/e2e/app.ts`: `recordFirstPaint`, `firstPaintChanges`, `preferSidebar` and `touchPage` (shared with `frame.spec.ts`), `recordBoxes`/`recordedBoxes`, `withSeasonMode`, `withListPrefs`, `withAudioTracks`, `filterDrawer`, `libraryCard`. The dashboard: its rows follow 1280 and 1120, its links open their lists (each value's link filters by the field and value it names, as the library's chip shows), More and Less (the Codec card found by its heading; the grid keeps its place and width), the remembered scope and storage area, the widget settings, a storage ring drawn late inside the loading recording, focus on `main` after Retry, and 44 px targets on a touch screen (KPI cards, Show, HelpTips, the storage arrows, the scope tabs, the value links and More).
- **Accessibility** (`web/e2e/a11y.spec.ts`, D18): axe-core, an exact dev dependency (not in the image) injected with `page.addScriptTag` from the app's own origin through a test route (the Content-Security-Policy allows only `'self'` scripts), runs `axeFrame(page, label)` with the tags `wcag2a`, `wcag2aa`, `wcag21a` and `wcag21aa` on the visible frame regions (`.v2-sidebar`, `.v2-fly`, `.v2-topbar`, `.v2-page-head`, `.v2-tabbar`, `.v2-pop`, `.v2-qs`): 1600 dark (expanded), 1440 dark and light (rail), 820 light and 375 dark and light, at rest, scrolled and with each open state (flyout, popover, drawer, Tools menu), also with instance groups and the sync display, with the sync popover open from the chip, the card and the drawer row, and with the jobs menu open without and with open jobs (1600, 1440, 820 and 375) and while its jobs load (1440), and with quick search open with pages and titles, without a match and while its titles are on their way (1600, 1440, 820 and 375). `axeScreen(page, label)` checks sign-in, setup and the loading screen (`.v2-login`, `.v2-loading`) as whole documents, without the 1.7.0 toast region: at 1440 and 375 in both themes, with the password hidden and shown, and the loading screen while the status is held; sign-in after an expired session (the warn notice) at 1440 in both themes. Under `forcedColors: "active"` the focused username, password and language select, quick search's focused field and its active option (not the others) and the current page's tile in the rail and the tab bar (not the others) have a solid 2px outline in a system color; the dashboard's current scope tab, the instance segment's current link and the current page button have it inset (−2) without focus and as the focus ring outside (2) with keyboard focus, the other items none until focused (Phase 5a). `axeView(page, label)` checks the content of rebuilt pages with the same tags: `.v2-view`, an open `dialog.v2-drawer` and `.v2-pop` (a region inside another counts with it); the libraries and the dashboard at 1600 dark, 1440 dark and light, 820 light and 375 dark and light (Phase 5a): Movies and TV series with two movie instances, the track menu, the `+n` popover, the audio sort menu, the drawer with its values, an operator menu and its help, card rows and the empty state. Label in Name (WCAG 2.5.3) is part of it: a control named by `aria-label` or `aria-labelledby` holds the words it shows, so the count tools are named by label and number, the drawer's value buttons by label and values, `+n` by “+n” and its action, and a chip's segments are separate words. Zero violations; incomplete results are logged as annotations; no rule is turned off.
- **Stylesheet guards** (`web/test/stylesheet-guards.test.mjs`) enforce section 9: the layer statement comes first and every sheet loads into a layer, with the `layer(legacy)` imports equal to `LEGACY_STYLESHEETS`; the built stylesheet keeps the layer order and layers every rule; v2 tokens share no name with 1.7.0 and never redefine palette keys; 1.7.0 rules read no v2 token; token files hold only custom properties on token selectors, and their phone and touch blocks only override `:root` tokens; v2 rule files follow the rules of section 9, including durations, layers and weights; every v2 token is documented in Part 1. `web/test/test-layout.test.mjs` scans every file below `web/test/helpers/` for stylesheet reads. The 1.7.0 ownership guard (`web/test/legacy-ui/stylesheet-ownership.test.mjs`) stays separate and is not loosened; it also checks that every `--layout-*` token a 1.7.0 sheet defines is read through `var()`, in a 1.7.0 rule or in a string of a `.ts` or `.tsx` source; a write or any other mention is no read, and comments do not count.
- **Contrast test** (`web/test/contrast.test.mjs`) reads the formulas from `styles/v2/tokens.css`, never from a copy, and checks every pair of 2.6 in all 36 modes and both band styles. Its color helper (`web/test/helpers/color.mjs`) is calibrated against Chromium within ±1/255.
- **Component tests** query roles and accessible names instead of class names. The component harness stubs an allow-list of pure presentation modules as named components; every other module is explicit or throws.
- **`web/test/legacy-ui/`** holds the 1.7.0 appearance tests: each test case that reads 1.7.0 stylesheets or checks CSS class names in TSX source or VNode props. Mixed cases are split; the logic stays in place and the appearance part moves as “… (1.7.0 look)”. Each file starts with `// Legacy UI (1.7.0 look) – replaced in Phase X by …` and reads stylesheets only through `LEGACY_STYLESHEETS`. The phase that replaces an area deletes its tests together with the Part 2 section.

### 14. Migration from 1.7.0

Each 1.7.0 solution on the left goes away when the phase that replaces its area lands. Token renames are listed in section 9.

| 1.7.0 | 2.0.0 |
| --- | --- |
| Header (`AppHeader`, `.tabs`, `NavMenu`, Tools dropdown), `.settings-tabs` | Sidebar card (3 modes, flyouts), topbar and mobile TabBar |
| Demo bar below the header | Demo pill in the topbar |
| `.library-intro`, `.statistics-heading`, settings heading | PageHeader on the band (fixed height) |
| `.settings-card`, `.connection` (as a surface), `.stat-widget`, `.distribution-card`, `.filter-panel-v2`, `.recognition-preview`, `.connect-card`, `.system-service-card`, `.mux-tool-card`, `.tool-package-card` | `Card`, `KpiCard`, `DiskCard` |
| `.filename-box`, `.storage-instance`, `.rule-save-status`, `.event-detail pre`, `.storage-path`, `.external-tag-conflict`, `.file-dialog-section` | `Card inset` or `CodeBlock` |
| Expanding filter panel (`.filter-panel-v2`) | FilterBar in the card header, FilterDrawer and ChipsRow (48) |
| `.heading-count`, `.filter-count`, `.selection-action-count`, navigation counters | `Count` (and plaque) |
| `.icon-button` with 21 overrides, `.row-icon.info-action`, `.password-reveal`, `.auto-tag-mark` | `IconButton` (32/28/24) or `RowButton` (28, framed) |
| Terminal button in the tool action column | Terminal in the Info column |
| `.nav-menu-list`, `.operator-menu`, `.evidence-source-options`, `.media-link-popover` | `Popover/Menu` |
| Inline pagination ×6, tri-state ×3, terminal ×3, preset dialog ×2, color actions ×2 | One `Pagination` (round), `SelectionBox`, `TerminalDialog`, `SavePresetDialog` and `ColorActions` each |
| `.notice.error`/`.error` in the warning color, `.check-ok`/`.success-button` with the accent | Tone surfaces (2.4) |
| `.is-selected` / `.selected` | `--row-bg` states and `[aria-selected]` |
| `AudioCell` and `ChannelsCell` (and language) as separate columns | `TracksCell` of continuous `TrackChip`s, without a default dot |
| `FilterPanel`, `StateFilter`, `AudioCell`, `ChannelsCell`, `RowInfo`, `MediaServerLink`, `LibraryTable`, `StorageWidget` (used only by the libraries and the dashboard) | Removed in Phase 5a, replaced by the blocks of 10.5 and 10.10 |
| `Tag`, `HelpPopover`, `Pagination`, `SortableHeader`, `EmptyState`, `SegmentedTabs`, the `MuxSelectionActions` view, `FilterRow`, `ActiveFilterBar`, `FilterCheckList`, `MultiFilter`, `OperatorButton`, `CSVExport` | `MediaTag` (sharing `tagPresentation`), `HelpTip`, `PageNav`, `SortHeader`, `ListEmpty`, `Segmented`, `SelectionTools` (sharing `useMuxSelection`), `FilterBar`, `ChipsRow` and the drawer's fields. Phase 5a builds them and uses them in the libraries; each 1.7.0 part keeps its DOM until its last user goes (Phase 5b tools, 5c settings, 5d dialogs). Until then two components serve one purpose, the one exception to principle 1 |
| Custom tag chips in their own form | `CustomTag` in media-tag form |
| Mover and parity displays and the explanation text of Disk placement | DiskCards (standby), the waiting row status and the dialog notice; Unraid service: one status |
| Service layouts in `ConnectionSettings`, `MuxToolSettings`, `MediaInfoSettings`, `UnraidSettings`, `ToolPackageCard` | `ServiceCard` (status → configuration → sections) |
| Theme select, palette select without preview, `OrderedList` without a result view | `ModeToggle` and `BandToggle`, `PalettePicker` and `PalettePreview`, `ColumnOrderEditor` |

**Dead rules** – removed in Phase 4 after checking static and dynamically constructed classes: `.footer`, `.filter-heading`, `.mux-progress`, `.recognition-actions`, `.column-settings`, `.appearance-lists`, `.list-layout-reset`, `.emby-match-field`, `.filecheck-kinds`, `.filecheck-owner`, `.language-chart-filter`, `.placement-detail-disks`, `.placement-footer`, `.tab-dot-trigger`, `.notice.success`. `legacy-ui/stylesheet-ownership` keeps them removed. `.placement-disk-source` stays: `DiskTag` builds it from `"placement-disk-"` and the disk tone.

### 15. Wording

| English key | German |
| --- | --- |
| Disk placement | Disk-Verteilung |
| Scan | Scannen |
| Start selected / Fix selected | Ausgewählte starten / Ausgewählte beheben |
| Remove completed | Erledigte entfernen |
| Remove {title} from the list | {title} aus der Liste entfernen |
| Reset column | Spalte zurücksetzen (only actual column resets) |
| Tag rules | Tag-Regeln |
| Items / Jobs | Einträge / Aufträge |
| Completed | Erledigt |
| Empty folder / Empty copies | Leerer Ordner / Leere Kopien |
| One disk | Eine Disk |
| Share folder | Freigabe-Ordner |
| Shares (scan report/settings) | Freigaben |
| No Radarr/Sonarr entry | Kein Radarr/Sonarr-Eintrag |
| Without Arr entry | Ohne Arr-Eintrag |
| Do not scan / Automatic | Nicht scannen / Automatisch |
| Contains notices | enthält Hinweise |
| Log / Level / Source / Message | Log / Stufe / Quelle / Meldung |
| Sources readable / Sources removable | Quellen lesbar / Quellen entfernbar |
| Owner unchanged | Besitzer bleibt gleich |
| Last checked / Not checked yet | Zuletzt geprüft / Noch nicht geprüft |
| Subject | Bezug |
| Category (Arr source category) | Kategorie |
| Changing the password signs out every session. | Beim Ändern des Passworts werden alle Sitzungen abgemeldet. |
| Error / Warning / Info | Fehler / Warnung / Info |
| Show in log / Clear log / Event entry | Im Log anzeigen / Log leeren / Log-Eintrag |

Scan report → Scan-Bericht; Help → Hilfe; Last scan → Letzter Scan; How scanning works → So funktioniert der Scan; From Arr → Von Arr; Shares → Freigaben; Tag colors → Tag-Farben; Resolution groups → Auflösungsgruppen; All items / All findings / All jobs → Alle Einträge / Alle Funde / Alle Aufträge. Selection / selected → Auswahl / ausgewählt; Mark for mux / Remove mux marking → Zum Muxen vormerken / Vormerkung entfernen; Match → Abgleich; Not found → Nicht gefunden; Seasons spread → Staffeln verteilt; On one disk → Auf einer Disk; Folders → Ordner. Use Reset for color reset headers; Reset column is reserved for actual column resets. Bulk confirmation wording follows the short “You are about to …” / “Du bist dabei, …” pattern in Part 2 → [Selection and bulk actions](#selection-and-bulk-actions).

Use the same terms in all four catalogs. German instructions address the user in the imperative (Du). Help sentences end with a period; labels/headings/buttons do not. Ellipses use a leading space and the character ` …`. Status tags retain their specific result (Moved, Fixed, Succeeded), while cleanup buttons use Remove completed. All visible text uses `t()` and exists in every catalog; see [TRANSLATING.md](TRANSLATING.md).

## Part 2 – 1.7.0 recipes (until replaced)

Part 2 is the 1.7.0 guide, kept word for word with headings one level lower. Each section names the phase that replaces it. Until then it binds every change to the 1.7.0 stylesheets.

| Part 2 section | Replaced in |
| --- | --- |
| Navigation and page recipes → Tool page; Tables (Standard table and row actions, Stable tool tables, Counts and numbers: the tools); Table recipes (`.data-table.tool-table`); Tags and badges (status tags, filter chips, results and heading counts, disk tags); Shared filter panel (tool filters, presets and scan options); Selection and bulk actions (Files & permissions selection, Terminal commands, bulk confirmations, mux marking, the progress column); Placement diagnostics; Mux selection actions; Disk tag tooltip | Phase 5b |
| Navigation and page recipes → Settings section; Settings cards and ordered lists; Segmented tabs; Event log; the settings and rules parts of Table recipes (`.editor-table`, recognition rules), Tags and badges (tags and counts in the settings) and Shared filter panel (Compact filter row) | Phase 5c |
| Dialogs and detail lists; Navigation and page recipes → Scan dialogs; Metadata evidence; Feedback; the dialog parts of Table recipes (`.detail-table`), Tags and badges (tags in dialogs) and Selection and bulk actions (the tag dialog) | Phase 5d |
| Tokens, Icons, Buttons, Form controls, Stylesheet ownership, Floating surfaces | With the last 1.7.0 section (end of Phase 5) |

Scopearr 1.7.0 uses one visual language throughout the app: login, libraries, tools, statistics, settings and every dialog. This guide defines the interface, including the approved 1.7.0 recipes to implement. Reuse these tokens, components and recipes before adding CSS. Update this guide before introducing a new shared value or pattern.

### Tokens

_Replaced with the last 1.7.0 section (end of Phase 5)._

Never use a raw size, spacing, radius or color.

Scale tokens live in `web/src/styles/base.css` and apply to every theme:

```css
--font-2xs: 10px; --font-xs: 11px; --font-sm: 12px; --font-md: 13px;
--font-lg: 15px; --font-xl: 18px; --font-stat: 32px;
--weight-regular: 400; --weight-medium: 500; --weight-semibold: 600;
--space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
--space-5: 20px; --space-6: 24px; --space-8: 32px;
--radius-sm: 5px; --radius-control: 7px; --radius-surface: 10px; --radius-modal: 14px;
--control-lg: 42px; --control-md: 34px; --control-sm: 28px; --control-xs: 24px;
--checkbox: 16px;
--progress-label-width: 40px; /* compact progress percentage slot */
--touch-target: 44px;
--toast-shadow: 0 8px 30px #0003;
```

The --layout-1 token is reserved for the clipped .sr-only accessibility helper.

Structural `--layout-*` tokens preserve intrinsic image and flag geometry, chart dimensions, header height, dialog/popover widths, scroll limits, focus outlines and positioning. They are not an alternative typography, spacing, radius or control scale. Add structural tokens only for those purposes. `--backdrop`, `--letter-spacing` and `--progress-height` cover shared dialog, header and progress geometry. Tool columns and rows use the named `--tool-col-*` and `--tool-row-height*` tokens in `base.css` and the column model in `tool-table.ts`. Preset choices use the existing `--layout-200` width (200px). Small notification dots use `--space-1` for their diameter and token-based positioning inside a relatively positioned trigger; position them absolutely so they never change its size. Report dots use `--status-warn`. The settings button and Log tab have no unseen-error dot.

Exceptions: zero, 1px borders, percentages and intrinsic layout ratios, media tag palettes, the intentionally dark terminal, table column geometry, media query thresholds, and the 28px mobile stat number. Do not turn ordinary gaps or control heights into structural tokens.

#### Colors

The default light palette uses --muted #536b72. Both default palettes and additional palettes must pass the contrast test for text and muted on bg, panel and panel2.

Themes override colors only; layout and semantics stay the same.

| Token | Purpose |
| --- | --- |
| `--bg` | Page/input background |
| `--panel` | Cards, tables, dialogs |
| `--panel2` | Raised surface, table headers, secondary buttons, hover |
| `--line` | Borders and dividers |
| `--text` | Main content |
| `--muted` | Labels, hints and secondary content |
| `--accent` | Main action, active state, focus and links |
| `--accent-bg`, `--accent-text` | Selected background and text on accent |
| `--status-ok` | Success and ready |
| `--status-warn` | Warning and review |
| `--status-wait` | Queued/waiting |
| `--status-error` | Failed and actionable conflict |
| `--status-info` | Neutral information |
| `--shadow`, `--toast-shadow` | Floating surfaces and toasts |

Use `color-mix(in srgb, var(--status-warn) 12%, var(--panel))` for tinted states. Hover uses `--panel2` or `--muted` borders; accent actions brighten slightly. Disabled controls retain their space with opacity 0.4. The dark `--status-error` token is `#ffb4bd` so its 10% exclusion tint stays above 4.5:1 on every shipped palette, including Nordic. Raw colors remain only in token definitions, marked fixed media-tag palettes and the terminal. Custom media/tag warning colors remain user preferences.

#### Typography

Font stack: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif. From 2.0.0 Phase 4, `.v2-root` (Part 1, section 3) overrides it on `<html>`, so 1.7.0 content, toasts included (`.toast-region` inherits), renders in Inter Variable. Paths, terminal and rule textareas use ui-monospace, SFMono-Regular, Menlo, Consolas, monospace.

| Role | Token | Weight |
| --- | --- | --- |
| Stat number | `--font-stat` (28px on phones) | semibold |
| Page, settings section and modal title | `--font-xl` (page title `--font-lg` on phones) | semibold |
| Results/card title | `--font-lg` | semibold |
| Group heading, legend | `--font-md` | semibold |
| Form/input/select, settings navigation, instance tabs | `--font-md` | regular |
| Body, table cells, notices | `--font-sm` | regular |
| Buttons | `--font-sm` | medium |
| Secondary text, labels, `.cell-sub` | `--font-xs` | regular (labels medium) |
| Tags, chips, counts, pagination, footer, table headers | `--font-2xs` | medium |

Running text has line-height 1.5–1.6. Table headers are uppercase with `--letter-spacing` (0.6px). Titles in cells use medium weight, never browser-default bold.

#### Spacing, surfaces and breakpoints

Icon to label: `--space-2`. Toolbar siblings: `--space-2`; form rows: `--space-3`; form grids and blocks: `--space-4`; page sections: `--space-6`. Page gutters are `--space-6` and `--space-4` on phones.

| Surface | Radius | Padding |
| --- | --- | --- |
| Tag, chip, count, menu item | small | by recipe |
| Input, button, textarea, notice, popover, menu, inner box | control | by recipe; inner boxes `--space-3` |
| Filter panel, table wrapper, settings card, fieldset, widget, toast | surface | `--space-5` (`--space-4` on phones) |
| Modal | modal | `--space-6` (`--space-4` at ≤740px) |

Circles remain 50%. Cards are flat with a 1px `--line` border. Only floating elements have shadows. Popovers use z-index 10, menus/tooltips 35–40, toasts 10000. Native dialogs use the top layer.

Width breakpoints use 1120 / 900 / 740 / 600px and min-width 1600px. Settings use min-width 1120px for the widget overview; Lists & columns is one full-width card. Keep one block per threshold in each stylesheet, widest first. Other supported queries: pointer coarse, reduced motion, forced colors. Settings navigation and filter groups stack at 900px; phone grids collapse at 600px.

### Icons

_Replaced with the last 1.7.0 section (end of Phase 5)._

Use `lucide-preact`, imported per icon. Language flags remain local SVGs. Icons inherit currentColor; heading/empty-state icons use accent. Spinner: `LoaderCircle` with `.spin`.

Always use `ICON` from `ui.tsx`, never a numeric JSX size:

| Context | Constant | Size |
| --- | --- | --- |
| Filter chip remove | `ICON.chip` | 12 |
| Sort arrow | `ICON.sort` | 13 |
| Labeled button | `ICON.label` | 15 |
| Table row action | `ICON.row` | 15 |
| Standalone/toolbar/help icon, input icon | `ICON.button` | 16 |
| Large filter summary/collapse | `ICON.large` | 18 |
| Modal close | `ICON.close` | 20 |
| Empty state | `ICON.empty` | 28 |

| Meaning | Icon |
| --- | --- |
| Delete/remove, edit, add | Trash2, Pencil, Plus |
| Close/chip remove, reset, refresh | X, RotateCcw, RefreshCw |
| Start, stop, scan, confirm | Play, Square, ScanSearch, Check |
| Export, copy, details | Download, Copy, Info |
| Help, caution, warning | CircleHelp, CircleAlert, TriangleAlert |
| Job log, event log | Terminal, ScrollText |
| File details (movies and episodes) | Film |
| Summary, search | ClipboardList, Search |
| Expand, pagination, widget navigation | ChevronDown, ArrowLeft/ArrowRight, ChevronLeft/ChevronRight |
| Sort, columns, filters | ArrowDownUp/ArrowUp/ArrowDown, Columns3, SlidersHorizontal |
| Storage, reveal/hide secret | HardDrive, Eye/EyeOff |
| Mark/unmark mux, mux info | Scissors, CircleMinus, Scissors |

Every icon-only button has both an accessible label naming the affected item and a pointer tooltip (`title`).

### Buttons

_Replaced with the last 1.7.0 section (end of Phase 5)._

Use button elements, with explicit `type="button"` inside forms unless submitting. Icon precedes the label.

| Variant | Class | Use |
| --- | --- | --- |
| Primary | `primary` / `button primary` | One main action per panel, toolbar or dialog |
| Secondary | `button` | Other labeled actions |
| Destructive | `button danger-button` | Confirmed destructive action; error icon and hover border |
| Icon | `icon-button` | Transparent toolbar/pagination/close/help control |
| Icon danger / success | `icon-button danger-button` / `success-button` | Actual deletion / removing a finished list entry |
| Text | `text-button` | Low-priority inline action |
| Row | `row-icon info-action` | Framed action in a table |

Large (`--control-lg`) is for inputs and adjacent actions in form/filter rows; use `.control-lg`. Medium (`--control-md`) is for toolbar buttons and standalone icons. Small (`--control-sm`) is for table/list actions, removal buttons, pagination, column movement and filter footer icons. Inline help and toast close use `--control-xs`. Under pointer coarse, small/XS controls receive an invisible 44px hit area without changing row geometry.

Keep labels short, sentence case, with selected counts in parentheses. Destruction uses `confirmDeletion()`, irreversible actions `confirmAction()`, resets `confirmReset()`, and unsaved changes `confirmDiscard()`. Explain non-obvious disabled states in `title`. Paginated lists render `.pagination` via `Pagination`, with `itemRange` for the `{from}–{to} of {total}` summary.

### Form controls

_Replaced with the last 1.7.0 section (end of Phase 5)._

Labels stack caption and control with `--space-2`; label text is muted. Input/select height is large; control radius, `--bg` background, line border, accent focus. Native selects use the existing chevron; forced-colors restores native appearance. `.input-wrap` reserves space for the search icon. `.password-reveal-field` keeps the reveal button inside the field. `.input-suffix` holds a unit beside the input.

Checkboxes and radios have one global size rule: `--checkbox` for width, height, min-width and flex basis, with margin zero. Never add local checkbox size rules. `.check-field`, MultiFilter options, column options and tool checklists align to the first text line with `margin-top: calc((1.5em - var(--checkbox)) / 2)`; labels use `--font-sm`. Inputs never shrink, even with long labels.

`MultiFilter` uses `.select-button` / `.select-popover`; operator controls select include/exclude behavior. A share filter is include-only and may show per-value counts. `FilterCheckList` provides a heading, checkbox rows and count badges. Textareas use control radius; compact track-table inputs use the small height.

Form grids use `--space-4`, collapse at 600px, and set `min-width: 0` on field children. Service field pairs use equal halves in `.connection-grid` and `.sync-clock-grid`, with `--space-4` gaps: synchronization aligns with server address, start time with API key. MKVToolNix package channel is a labeled control in a `.connection-grid` below the key-value list, aligned and equal in width to retention.

### Tables

_The tool parts and Stable tool tables are replaced in Phase 5b, the settings and rules tables in Phase 5c. The libraries use Part 1 (10.10) since Phase 5a._

#### Standard table and row actions

Use `.table-wrap > table`, `th scope="col"`, and `SortableHeader` for sortable columns. Sorting cycles ascending → descending → default and exposes `aria-sort`. Headers use the global uppercase recipe. Cells use `--space-4 --space-5` (compact mobile: `--space-3 --space-4`), a line border and vertically centered content. Table wrappers use surface radius; standard columns fit without horizontal scrolling from 1440px in all four languages. Smaller screens may scroll. Empty tables render `.empty-state` via `EmptyState`.

Title: `<strong class="cell-title">` at medium weight; secondary line: `<small class="cell-sub">`, muted, `--font-xs`, margin-top `--space-1`, only for actual secondary information such as a path, filename or episode title. Short qualifiers use `<em class="cell-hint">` in the same nonwrapping label group, space-2 after the name, font-xs, muted, italic and initially lowercase. Full paths remain available in tooltips and details.

Inspection/start actions (details, start, log, options) follow selection. Edit and delete/remove actions always occupy the last column, right-aligned. `.info-actions` holds up to three `.row-icon.info-action` controls with `--space-2` gaps. Extra actions belong in details. Compact settings/color/track tables reuse standard borders; track cells use `--space-2 --space-3`.

#### Stable tool tables

_Replaced in Phase 5b._

Disk placement, files/permissions and mux use `.tool-table`, `table-layout: fixed` and a colgroup. `toolTableStyle()` computes minimum width from the selected columns; the title receives at least 200px. Selection is 40px; action width is 24 + n × 28 + (n − 1) × 8; removal 52px; service 120px, status at least 120px and wide enough for the longest translated status tag of that tool, progress 128px. Title receives the remaining width with a 200px minimum. `toolTableStyle()` measures translated uppercase labels using the actual font, size and letter spacing, sort icon and padding; every column receives the larger of content minimum and header width. Status widths measure every translated short label from the tool's label table, including tag padding and border, never visible rows. Remeasure headers and tags after a language change, after `document.fonts.ready` and after every later `loadingdone` (`useFontsLoaded`, Phase 5a): `fontsReady` in `main.tsx` waits at most 1s, so a face that arrives after the first render still sets the widths. Status cells use `.col-status` with no ellipsis; tags are never truncated. All tools, including Mux, show short status labels with the full label in `title` and `aria-label`. Widths never depend on rows. See `toolColumnWidths` for other minima.

The icon column is visibly labeled Info in all three tools and their column settings. Its header uses `.col-info` and `.th-label`, is left-aligned and never sortable; selection/removal keep `.col-control` and their accessible captions. Measure Info without a sort icon, preserving existing action-column minima and persisted `actions`/`buttons` keys.

Rows are 64px, 56px at ≤740px. Titles clamp to two lines, paths/subtitles to one ellipsized line. Data columns do not force new line wrapping after a removal. Disk tags wrap side by side; show two plus a details chip for remaining disks. Details retain all disks and sizes.

At ≤600px the action column shows Details; start/fix, terminal and mux options stay available in the details footer with their existing handlers and confirmations. Selection stays accessible. Removing an entry affects its own spinner/fade only; a failed request restores it. Reduced motion disables the fade. Slow reload indication is delayed 300ms.

#### Counts and numbers

Page summary: **open entries**, with `title="Open items"`. Results badge: total rows in the filtered list, matching pagination, with `title="Items in the list"`. Pagination: `{from}–{to} of {total}`. Tools menu badges count queued/running/failed jobs; unstarted scan findings, succeeded and cancelled jobs do not count. Mux drafts/ready jobs count as open.

Use `count()` or translated numeric `count` parameters for localized integers, `bytes()` for adaptive decimal B/kB/MB/GB/TB, `percent()` for localized percentages with a narrow nonbreaking space, and `—` for unavailable values. Counts and progress use tabular numerals. `t()` selects `|one` / `|other` through Intl.PluralRules before formatting numeric counts; legacy messages remain a fallback.

### Tags and badges

_Status tags, filter chips, counts and disk tags are replaced in Phase 5b, the settings in Phase 5c, the dialogs in Phase 5d. The libraries use Part 1 (10.7) since Phase 5a._

Navigation counters are absolute plaques at the top right of relatively positioned menu buttons, above the chevron, using font-2xs and the shared badge height/padding. Use space-1 for their top offset and right inset, with at least space-2 separation from adjacent entries; at ≤740px translate the plaque up by its full height so it sits above the compact navigation label and chevron; counters never affect button width, cover labels/chevrons or change touch/focus geometry. The same recipe covers single-entry menus and Mux counters.

Tags use `--font-2xs`, medium weight, small radius. Media palettes are fixed/user-configurable and are separate from interface states. `.filter-chip` uses accent. Excluded filters (`is not`, `none of`) use `--status-error`: error text, 35% error border mixed with line, and 10% error tint on panel, for both chips and the filter's selected button. Counts use `.filter-count`. Results and card-heading counts share `.heading-count`: font-2xs, semibold, muted on panel2, line border, radius-sm and space-1/space-2 padding. Render heading badges inside the heading immediately after its text. Tag lists wrap with `--space-2`.

Status classes are neutral: `status-ok`, `status-warn`, `status-wait`, `status-error`, `status-info`, `status-running`, `status-neutral`. Ready/succeeded → ok; review/warning/no-space → warn; queued → wait; failed/needs-attention/actionable conflict → error; informational split → info; running → filled accent; draft/cancelled → neutral. `.status-button` opens details without a separate button frame. Disk targets use accent and sources warn.

### Metadata evidence

_Replaced in Phase 5d._

Metadata disagreement (`conflict`) means a known filename value disagrees with measured metadata (MediaInfo when available, otherwise media-server metadata). It uses the configured `metadata` warning color, the library warning icon and the yellow `evidence-conflict` detail row. Recognition-rule conflicts and disagreements between media servers remain separate findings. Language values appear in the interface language; stored values stay canonical.

Radarr/Sonarr differences (`apiDiffers`) are information in file details only: use `--muted` text and a lucide `Info` at `ICON.label` in the Arr cell, with the translated explanation in both `title` and `aria-label`. `.evidence-api-info` belongs to `dialogs.css`; its icon aligns vertically like `.detail-conflict-marker`. These differences add no row color, list icon or filter. The Category hint remains for a compatible but broader source category, only when `apiDiffers` is false. Display precedence is filename → MediaInfo → media server → Radarr/Sonarr; source and processing retain filename → Arr because media servers do not provide them. The metadata-disagreement filter describes filename versus measured metadata only.

The Used cell is a `text-button` with ChevronDown at `ICON.label` when two sources have values, the field has a warning, or a confirmation exists. Its `EvidenceSourceMenu` follows `.select-popover` and `.floating-surface`, offers only sources with values, and adds Automatic after a separator only for confirmed fields. Arrows, Home/End, Enter and Escape work; closing returns focus. The menu is portaled into its current native dialog and positioned against the trigger within the viewport, avoiding table clipping. On mobile it uses the full card width and scrolls the trigger into view before opening below it; if needed, it flips above. Closing or completing a choice returns focus to the trigger. A manual choice uses the current value of that source and suppresses metadata, rule and informational differences for that field only. Show a muted UserCheck at `ICON.label`, with the source, saved value and local date in its tooltip and accessible label. Other evidence remains visible. Automatic restores normal resolution. Confirmations belong to service/file ID and size; a missing source shows the cell-hint Confirmed source has no value and remains reversible. Status and metadata quality offers a yes/no Manually confirmed filter.

Show a MediaInfo evidence column only with a saved result. MediaInfo agreeing with the filename clears the measured disagreement; a different media-server value uses the same muted Info recipe as `apiDiffers`, in the media-server cell (`mediaServerDiffers`). MediaInfo audio tracks replace media-server tracks and show their source and read date.

### Dialogs and detail lists

_Replaced in Phase 5d._

Use `Modal`, which wraps native dialog behavior, Escape, backdrop click, focus and stacking. Default width 450px; wide 780px; table dialogs may use existing 900–1100px structural widths. Dialogs scroll within the viewport and use the common backdrop and shadow. File & metadata alone uses `.modal.wide.file-dialog` at `min(var(--layout-1060), calc(100vw - var(--layout-28)))`; companion, rename and tag dialogs keep their existing widths. Its Used evidence column never wraps; value columns may wrap without fixed widths.

Every modal reserves `scrollbar-gutter: stable`. Dialogs containing tabs use `Modal tabs` (`.modal-tabbed`), anchored at `margin-block: calc(var(--layout-50) / 2) auto`. Within one open session, remember the largest rendered height as a minimum, capped at `100dvh - var(--layout-50)` and responsive to viewport changes. The same height cap applies on phones. Clear that height on close; another opening starts fresh. Keep heading and tabs in place when content becomes shorter, with scrolling inside the dialog even at small heights and in landscape.

Use `DialogTabs` around every segmented tablist and its panel inside a modal, including nested MediaInfo sections. `.dialog-tabs` owns space-4 before the tablist and between it and the panel; each panel is a grid with space-4 gaps. Its first block and `.file-dialog-section` children have no extra margins. Preserve tab IDs, keyboard navigation and independent inner/outer selection. Scroll a tablist into view with `block: nearest` only when it is outside the dialog's visible area. Placement details introduces its disk tabs with Files by disk (`h3.card-title`); disk names use a heading-count size badge rather than punctuation in the label.

Scan reports start their key-values with Scanned at (local date/time and ISO title), then Duration when timestamps exist. A running replacement scan adds a notice that the report still describes the previous completed scan. Both reports use the shared scan-time formatter.

One footer: `.modal-actions`, right-aligned, gap `--space-2`, margin-top `--space-4`. Cancel/Close precedes the primary/danger action. A secondary tool action may sit at the far left using margin-right auto. Tool actions inside a dialog body are ordinary toolbars, not footers. Log dialogs render their `.terminal` output via `TerminalOutput` (follows new text only while scrolled to the end), and the Save filter view dialogs share the `SavePresetDialog` frame with their own footer as children.

A Save/Apply action in the footer saves and closes the dialog on success, then shows an outcome toast. A failed save keeps the dialog open and shows a toast or field error. Clear the saved draft before closing so it cannot trigger an unsaved-changes confirmation. This applies to rule/preset editors, bulk tags, mux options/path mapping, tag policy, companion renaming and the allowed/ignored names editor. The exception is editing one part inside a detail dialog, such as a filename in File & metadata: saving that part leaves the detail dialog open. Confirmation dialogs close after a successful action.

Details use `<dl class="key-values"><div><dt>Label</dt><dd>Value</dd></div></dl>`: columns `minmax(140px, 1fr) 2fr`, muted extra-small label, small regular value, line separators and no label indentation. Apply the same recipe in system and MKVToolNix settings. A disk value uses `DiskTag`. Rename previews show each companion's physical device with DiskTag. Without Unraid setup, show the cell-hint Renamed through the user share, with a setup tooltip. After a successful service refresh, newly present folder devices are reported in the result toast and event log.

File & metadata uses session-persisted Overview | MediaInfo `SegmentedTabs` below the action row (`scopearr-file-dialog-tab`). MediaInfo appears when enabled or a result exists. Its action row appears for mux actions or enabled, installed MediaInfo and places Read with MediaInfo / Read again (ScanSearch or busy spinner) after the mux buttons. No unavailable MediaInfo placeholder appears. Reads switch to MediaInfo / Result only on success; failures retain the current tab and show a toast plus the MediaInfo notice. The last-read timestamp/version sits to the right of the inner tablist in a wrapping row with space-3 gaps, below it at ≤600px. Before the first read the tab explains how to use the action above. Results use `detail-table.stack-mobile`: Field | Scopearr value | MediaInfo. A second, session-persisted `SegmentedTabs` bar (`scopearr-mediainfo-section`, `mediainfo-section-*` IDs) offers Result | General | Video | Audio | Subtitles, showing only sections with data. Missing sections fall back to Result after a read. A single track uses a two-column `detail-table.stack-mobile` (Attribute | Value). Multiple tracks use one `detail-table` with attributes as rows and tracks as columns, language in each header and Default/Forced as cell-hints. The first column stays sticky at left zero on `--panel`; `dialogs.css` owns this rule. Multi-track tables scroll within `table-wrap` and never stack into cards. There are no expandable track sections. Both tablists keep their own keyboard focus and selection; errors stay as a notice in the tab.

### Feedback

_Replaced in Phase 5d._

API failures display translated message keys; never show browser network or JSON-parser messages. Non-JSON or malformed responses use Request failed; network failures use Scopearr is not reachable.

| Element | Recipe |
| --- | --- |
| Toast | `notify(message, "success" | "warning" | "error")`; surface radius, status left border, toast shadow; action results |
| Persistent condition | `.notice` with small body text and optional CircleAlert; error notices have role alert; setup notices link to the relevant settings |
| Help | `HelpPopover` with help/info/notice variants and 16px icon; accepts plain text or sections `{ heading, text, raw? }`, font-sm, medium section headings and space-3 gaps. Width 340px; long help scrolls within `max-height: min(60vh, 480px)`. Keyboard opening focuses the help scroll region so arrows and Page Up/Down can reach every section; Escape closes it and returns focus to its trigger. Pointer opening retains trigger focus |
| Empty state | `.empty-state`, 28px accent icon, heading, explanation, optional action |
| Loading | Spinner beside results title; delayed `.table-wrap.busy`; retain existing content |
| Tool activity | LoaderCircle (ICON.label, spin) and short muted font-xs text with aria-live polite directly after the results count, in the same heading line; no page-wide bar. Row progress stays separate |

Toasts report finished actions; notices describe conditions. Avoid reporting the same event through both. Disk placement and Files & permissions show scan/action errors once when the operation finishes, using an error toast; remember the seen error timestamp so reopening a page does not replay it. Persistent scan diagnostics (unresolved share folders, path warnings, empty shares) live only in the scan report. Its footer icon has an absolutely positioned warning dot while the last scan contains notices, with `title` and accessible label “Scan report · contains notices” (German: “Scan-Bericht · enthält Hinweise”). Setup notices may remain in the page flow because they describe configuration rather than scan results. Error toasts for background work offer the text-button “Show in log” to open System → Log with source and service filters. Three consecutive status failures show one connection notice while retaining the current authenticated view; recovery clears it.

### Navigation and page recipes

_Replaced per subsection (see below)._

#### Tool page

_Replaced in Phase 5b._

`PageHeader` on the band (Part 1, 10.1; h1 + open count) → `.filter-panel.filter-panel-v2` → optional setup notice → `.library-section` with results heading, table/empty state and pagination.

All five library/tool pages share one vertical rhythm: page heading → filter card → optional setup notice → results heading → table. A central grid container owns `--space-6` between the blocks and `--space-4` between results heading and table. Do not add local margins to filter panels, notices or results headings. An optional setup notice participates in this same rhythm. There is never a scan-result-dependent box between filters and results; root/path diagnostics belong in the report.

Use the Shared filter panel recipe below. `.results-heading` uses `min-height: var(--control-md)`, centered alignment and the same spacing on every page. Scan uses `control-md`, like every toolbar button; activity stays beside the results count. Preset choices are fixed at `--layout-200` on all five pages.

#### Scan dialogs

_Replaced in Phase 5d._

Use `Modal wide` with `className="scan-dialog"`, at `min(var(--layout-980), calc(100vw - var(--layout-28)))`. `.scan-dialog-grid` has two columns above 900px: Files & permissions places Services/Checks left and Target owner/Target permissions/Fixing right; Placement places Services/TV series left and Target disks right. Use a line border and space-6 inset between columns. At ≤900px stack them and use a horizontal separator. Use space-4 between sections and space-3 within them; headings have no additional margins. Check kinds use `.scan-dialog-checks`, two columns and one at ≤600px. Owner UID/GID remain side by side, each at most layout-160; permission radios use space-2 gaps. Put Custom values fields directly beneath the radio group. Owner defaults come from Unraid settings with a Reset to default text action only when different. Errors remain inside the relevant section or dialog.

The single `.modal-actions` footer stays visible without scrolling: sticky bottom zero, panel background, line separator and nonshrinking controls. Busy/fix reasons sit on its left, Cancel | Scan on its right. Use a flex column on the open dialog, a nonshrinking heading/footer and an independently scrollable `.scan-dialog-body` with zero minimum height and space-4 scroll padding. This keeps scrollable content above the footer, including when custom values or notices are visible. Scan dialogs opt into `Modal fitViewport`: track `visualViewport.height` and `offsetTop` through resize/scroll events while open, remove listeners and CSS overrides on close, and leave CSS viewport units as the fallback. The local geometry properties `--dialog-viewport-height` and `--dialog-viewport-top` hold browser measurements, not design tokens. Anchor at the visible viewport top plus half layout-50; cap height at its height minus layout-50. Focused body fields outside the resulting body bounds scroll into view with nearest alignment, above the footer and the mobile on-screen keyboard. Verify Scan is initially visible at 1440×780 and 1280×720; narrow layouts keep a reachable sticky footer. Explain strict permission checking with HelpPopover and link Checks to the Unraid names settings. `dialogs.css` owns this complete scan-dialog recipe.

#### Settings section

_Replaced in Phase 5c._

Every settings area uses `SettingsSectionHeading` with title, description, optional help and optional save action. It renders `.settings-section-heading`: h2 and Save settings on one row, description directly beneath at space-1. Save always sits at the right of the section title, uses Check or a busy spinner and is disabled without changes; connect it to the area's existing form/callback. Areas without editable values (System) have no save button. The h2 has `min-height: var(--control-md)` and flex-centered text, so the title row always reserves the Save button height and does not jump between sections. Descriptions wrap naturally; their differing line counts may change the total heading height on narrower screens. Card headings never contain Save. Explanations that are not needed constantly belong in a HelpPopover beside the section title, not boxes above the content. Custom tags has a section-heading help popover like Tag rules, explaining Management, Count, Name, Colors and Creating tags.

Settings areas with multiple peer views use `SegmentedTabs` below `SettingsSectionHeading`, including System with Info | Log. Use `--space-4` from the section description to tabs and from tabs to the first card, and persist the chosen tab under its own sessionStorage key and in the route (`#/settings/<section>/<tab>`, replaced without a new history entry). A valid route tab wins over the key; a tab opened by a link is written only to the route. System has no section save button. Info shows three equal-height peer cards (Version, Back up cache, Change password) in `.system-overview`: three columns on desktop, two plus a full-row password card at ≤900px, and one column at ≤600px. Use `align-items: stretch` and flex-column cards so cards in each grid row share a height, with content at the top. Overview headings wrap with a `--space-2` row gap; the Version card has no placeholder. Cards contain their heading, description and short values; forms open in a dialog.

Change password opens the standard `Modal`, with its description, current/new password fields and one footer: Cancel followed by the primary Change password and sign out action (disabled in demo). Focus the current-password field on opening; Escape, Close and Cancel reset both fields. `.password-dialog-fields` belongs to `dialogs.css`, uses the standard label recipe and full-width controls up to 360px. Controls associate through `form="password-form"` with the empty form outside the settings form; the dialog contains no nested form. The password state belongs to its card and does not make settings dirty. Info also retains sync status; Log contains the event viewer. The System description includes “The log shows events from the last 24 hours.” Internal links can open System → Log with source/service filters through `openLog({ source: ["mux"] })` and an optional `instance` filter, which opens the route `#/settings/system/log?source=mux`.

The heading sticks beneath the app header (`--app-header-height`, Part 1, 10.1). The areas are the entries of the sidebar's Settings group (Part 1, 10.1); `.settings-layout` has one column. The settings-content grid owns space-4 between headings, tabs and cards without extra margins. Each settings-card/connection groups one topic, using 1–2 column form grids and border-top subsection separators. Service tabs and Add share a row. Preserve save routes and confirmations; resets use confirmReset().

The Unraid tab places a `.unraid-settings-grid` with equal Paths and Files & permissions settings cards above Shares; it collapses to one column at 900px. UID/GID controls use the standard field recipe and the existing 360px maximum; a muted hint states the running container UID:GID. The Files & permissions card combines default owner fields and allowed/ignored-name counts with Edit, using the shared names dialog and the section draft/Save route. Name edits apply to the next scan. Paths also contains the persisted Verify copies with checksums move preference. The default remains editable when Unraid is disabled. Files & permissions starts and resets to this default; scans retain their own execution values without changing it. Ownership fixes that cannot assign the requested owner are manual and explain the generated command route.

MediaInfo is a singleton service tab sorted alphabetically. MediaInfo and MKVToolNix share `ToolPackageCard` for package status, channel and install/update/check/remove actions, and `PathMappingsCard` for `mux.mappings`; its hint reads Shared with MKVToolNix and renaming. All mappings remain one setting.

### Stylesheet ownership

_Replaced with the last 1.7.0 section (end of Phase 5). The test named below now lives in `web/test/legacy-ui/stylesheet-ownership.test.mjs`._

Import order: base → navigation → library → dialogs → dashboard → settings-and-filters → recognition → placement → responsive. A non-media selector has exactly one rule in its owning stylesheet (intentional reset groups require documented test exceptions); `web/test/stylesheet-ownership.test.mjs` enforces this. No unexplained cross-file duplicates are allowed. Add rules to the matching area, merge existing selectors and group media queries. Never add another improvements or override stylesheet. Remove unused rules only after checking static and dynamically constructed classes.

### Floating surfaces

_Replaced with the last 1.7.0 section (end of Phase 5)._

Every floating tooltip, popover and menu uses `.floating-surface`: panel2 background, text foreground, line border, control radius and the shared shadow. Do not add local surface colors or shadows. Only floating surfaces, modals and toasts use shadows (a user-selected flag outline is a border effect).

`Tooltip` from `ui.tsx` wraps a trigger, supplies role tooltip and aria-describedby, opens after 150ms hover or immediately on keyboard focus, closes on Escape, and toggles on coarse-pointer taps. Outside taps close it. Its fixed position flips above/below and stays inside the viewport. `.tooltip` uses space-2/space-3 padding, font-sm, line-height 1.5, a 340px structural maximum width bounded by viewport minus space-8, pointer-events none and z-index 40. Offset: space-2. Flags, operators, filenames and disk tags reuse it. Interactive/long help uses HelpPopover (space-4), other popovers space-3. Menus use space-1 and small-radius entries.

### Shared filter panel

_The tool filters are replaced in Phase 5b, the compact filter row in Phase 5c. The libraries use Part 1 (10.5) since Phase 5a._

Filter panels only filter results. Files & permissions and Disk placement use `.tool-result-filters` without a collective Show heading. Groups sit side by side with border-left line and padding-left space-6 between adjacent groups; never give the first visible group a leading border. Shares appears only with at least two choices. Placement groups Shares (`minmax(var(--layout-240), 1fr)`), Status (`2.5fr`, three checklist columns) and Kind (`1fr`); Files & permissions groups Shares, Kind (`2fr`, two checklist columns) and Status (`1fr`). Without Shares, the remaining groups fill the width. Counts follow labels immediately, with space-3 checklist gaps and control-sm row height. Expanded compact tool panels keep the panel's space-5 padding; padding never changes between collapsed and expanded states. They use space-3 above the expanded groups, no extra group padding or outer group border, and no extra footer top padding, with a control-sm footer minimum. Group headings use the card-title line-height 1.3 without margins. This retains the 360px height budget with five checklist rows while keeping the normal search controls and footer icons. At ≤1120px placement Status uses two columns; at ≤900px groups stack with border-top separators; at ≤600px every checklist uses one column. At 1440px both complete expanded panels must be at most 360px tall. `placement.css` owns this recipe.

Scan options live in a wide Scan dialog opened by the first primary Scan action; while scanning, Cancel scan remains direct. Tool presets continue to store result filters only. Scan dialogs may open during fixes/moves but disable starting with an explicit reason until work completes.


The three tool pages use `FilterRow`: labeled search, 200px preset choice, save/delete preset icons, collapse icon. At ≤600px, and at ≤900px beside an expanded sidebar (the shell's `data-mode`, Phase 5a), the search takes its own line and the preset choice and icons follow on the next; elsewhere the row is unchanged. Only this row and ActiveFilterBar remain visible when collapsed. Expanded filter-groups sit between them and have space-5 bottom padding. ActiveFilterBar owns the fixed footer order: Reset when active → page tools (Scan report) → CSV export → help, with named tools/export/help slots. Disk placement and Files & permissions use Reset → Report → CSV → Help; Mux uses Reset → Help and has no export. CSV uses Download at ICON.button in an a.icon-button.control-sm with download, title and aria-label Export CSV; without results render an inert span with aria-disabled. Export follows current list filters and sort, retaining Placement target. CSV never appears in results toolbars or scan reports. Scan information belongs in the HelpPopover as Last scan, followed by How scanning works; omit Last scan before the first scan. There is no separate scan-info icon or info slot. Footer controls use control-sm and ICON.button. Scan is the first, sole primary results action. Running scans, moves, fixes and cleanup show a spinner and short muted aria-live text directly after the results count, never a page-wide progress bar or separate activity row. On phones Scan fills the first toolbar line.

Tool presets store list filters only, using service namespaces tool:placement, tool:filecheck and tool:mux in the existing presets table. No scan settings, pagination or ordering are saved. Shares is an include-only list filter under Show, independent of scan service selection, visible with two detected shares. Active shares remain chips when collapsed. Scan-result notices never appear between the filter panel and results; missing share-folder choices are resolved in Unraid settings and linked from the report.

#### Compact filter row

Lists inside settings cards use a compact `FilterRow` variant when search and filters fit in one row. There are no presets and no expand/collapse control. Search uses `.input-wrap` with `ICON.button` and grows to fill the available width; include-only `MultiFilter` controls follow it, using counts where available. Controls have `control-lg` height. Below them, `ActiveFilterBar` shows active chips and Reset using the shared footer order (Reset → optional page tools → help). At ≤600px search occupies the full width and filters wrap on the next line. Inputs stay in the card body, never in `.card-heading`. The event log uses this variant with Level, Source and, only when entries have an instance, Service filters.

### Table recipes

_Tool tables are replaced in Phase 5b, editor and rule tables in Phase 5c, detail tables in Phase 5d. The libraries use Part 1 (10.10) since Phase 5a._

Every table is a real table in `.table-wrap` with thead/tbody, th scope col, and optional th scope row styled as cell-title. Exactly one recipe applies: `.data-table` (rules), `.data-table.tool-table` (fixed tool rows), `.detail-table` (metadata, reports, previews, disk details), or `.editor-table` (controls/ordered lists). Tables in cards/dialogs have no minimum height. All heads share the library.css recipe: uppercase font-2xs, medium weight, letter-spacing, muted on panel2, nowrap. No other stylesheet sets header typography. Numeric cells and headers align right with tabular numerals; missing values use an em dash.

All tables use the single global border-collapse: collapse rule with zero border-spacing. Row separators come from td border-top only; do not add local cell borders. Heads never wrap or ellipsize. Only .th-label may carry last-resort ellipsis, which must remain inactive at standard desktop widths. Control columns (.col-control) have centered content, space-3 horizontal padding, no ellipsis and only sr-only captions. Data cells use space-4/space-5 and font-sm; tool cells use space-3 horizontally. Detail cells use space-3/space-4 and font-sm; paths/patterns remain monospace at the same size. Paginated or potentially >20-row details use SortableHeader; fixed property order stays unsorted. `.detail-table.stack-mobile` becomes labeled cards at 600px; data/tool tables keep horizontal scrolling. A row has either a whole-row action or cell actions, never both. Reports use a text-button in their first cell and DiskTag where appropriate.

Editor cells use space-2/space-3; headers never wrap, control columns size to content and preview takes remaining space. All color/visibility/text/reset/delete controls are framed control-md squares, including centered 16px checkboxes; icons use ICON.button. Color inputs use the named --color-input-padding token (6px). Text-color preview reads Aa on the selected tag background. Mux track inputs are the compact control-sm exception. Editors are never sorted: their order is content. Rule and tool sorting cycles ascending → descending → standard. Recognition rules use 64px rows, two-line names and ellipsized single-line pattern cells. Edit/delete buttons occupy the last column, aligned right. Rules paginate or scroll with the page, never inside a nested height-limited table wrapper.

### Segmented tabs

_Replaced in Phase 5c._

Use `SegmentedTabs` from ui.tsx and `.segmented` for 2–6 peer views. A line border, panel background, space-1 padding and control-md tabs surround the active panel2/accent-text tab. Use role tablist/tab, aria-selected/controls, roving tabindex, arrows and Home/End. Inside a modal, use DialogTabs to own tablist and panel spacing, with quantity badges using heading-count. The segmented container is content-width (width: max-content; max-width: 100%) and scrolls horizontally on overflow. Dashboard scopes, service instances, disk details and all settings areas with multiple views (including Display and System Info | Log) share this recipe. Display tabs persist per session; modified tabs show an accent dot with an accessible unsaved-changes label.

### Settings cards and ordered lists

_Replaced in Phase 5c._

`.card-heading` holds icon and h3.card-title on the left, actions on the right, with space-2 gaps, `min-height: var(--control-md)` and `align-items: center`. `h3.card-title` has margin zero and line-height 1.3. Actions are at most `control-md`. The shared `.card-actions` row wraps within the card on narrow screens using space-2 gaps; it never forces horizontal page overflow. A card heading is always at least `control-md` high; titles align at the same height with and without actions. Only icon, title, count badge and action buttons belong in the heading. `CardHeading` accepts `count` and `countTitle`; the `.heading-count` is inside `h3.card-title`, immediately after the title, including the event log. Inputs/selects/search belong in the card body under the description; standalone fields are at most 360px wide. A .card-intro wrapper groups the heading and optional quiet description at space-1; the card body follows at space-4, owned by one shared rule with no local margins. Apply this to every settings card and dialog using `CardHeading`. Card-wide Reset, test connection/paths, refresh storage and add-tag actions belong here, never below or centered. Save belongs only in SettingsSectionHeading. Resets use confirmReset. `--app-header-height` records the measured app header height (82px desktop, at least 110px on phones). The app header stays at the top and `.settings-section-heading` sticks beneath it; its separator appears only after scrolling, keeping Save reachable. Settings navigation is borderless except for the active accent indication.

`OrderedList` renders a compact editor-table: Show | Name | Order, centered control columns and control-sm arrows. Fixed items have disabled checkbox/arrows and an inline cell-hint after the name (always first / always visible), never an extra row of explanation. Widgets, list-info symbols and all four column lists reuse it. Reset lives in the card heading and affects the selected list only. General preferences stack at 900px. Lists & columns is one full-width card with session-persisted Icons, Movies, TV series, Files & permissions and Disk placement tabs and unsaved-change dots; the widget overview uses 2:1 from 1120px. Display uses General, Lists & columns, Colors tabs; the Lists & columns card has one description and resets only the active tab. Keep every existing save route and confirmation.

### Event log

_Replaced in Phase 5c._

System → Log is one `settings-card`. Its `CardHeading` contains ScrollText, Log, a badge counting the filtered list, and Refresh (`RefreshCw`), Download (`Download`) and Clear (`Trash2`, `icon-button danger-button`) actions. The quiet description reads “Events from the last 24 hours. Older entries are removed automatically.” Heading, description and content follow the shared card recipe; search and filters stay in the body.

#### Event model and sources

The additive `event_log` table stores `id`, UTC Unix-millisecond `ts`, `level` (`error`, `warning`, `info`), fixed `source`, optional service-ID `instance`, English translation-key `message`, JSON placeholder `params`, short searchable `subject`, redacted technical `detail` and `repeat` (default 1). Render messages in the current language, with English fallback for unknown keys. Translate every array-valued parameter element and join with comma-space before interpolating the message. Settings saves log the changed areas (including service names) and up to 50 field-change lines in details; secrets appear only as `changed`. No-op saves create no event. Custom tags, tag rules and presets have their own concrete settings events; password changes remain auth events. Redact credentials, API keys, tokens, passwords, cookies/headers and credential-bearing URLs before storage; media titles and paths remain useful context. Retention is fixed at 24 hours, cleaned at startup and every 10 minutes; above 20,000 rows remove the oldest info entries first. Equal level/source/instance/message/params/subject values within 10 minutes update the latest entry's timestamp and repetition count, except Settings events: each successful user change remains a separate entry so its field details and chronology are preserved. The viewer lists events, not individual requests, status polls, file contents or job-progress lines; job terminal logs retain their own detail.

| Source key | English label | German label |
| --- | --- | --- |
| `system` | System | System |
| `auth` | Sign-in | Anmeldung |
| `settings` | Settings | Einstellungen |
| `sync` | Synchronization | Synchronisierung |
| `tags` | Tag sync | Tag-Sync |
| `webhook` | Webhooks | Webhooks |
| `media` | Media servers | Medienserver |
| `mux` | Mux | Muxen |
| `placement` | Disk placement | Disk-Verteilung |
| `filecheck` | Files & permissions | Dateien & Rechte |
| `rename` | Rename | Umbenennen |
| `metadata` | Metadata | Metadaten |
| `mediainfo` | MediaInfo | MediaInfo |

#### Filters and table

Use the Compact filter row with Log search …, Level, Source and Service. Filters are include-only `MultiFilter` controls with counts: Level offers Error, Warning and Info; Source offers only sources with entries; Service appears only when entries have `instance` values. Counts respect the current search/time range and other filters, omitting their own filter. Search matches stored message keys, parameters, subject and detail case-insensitively; it does not rely on a server translation of the visible message. `ActiveFilterBar` below the row shows chips and Reset.

Use `.table-wrap > table.data-table` and the standard sortable-header cycle, defaulting to Time descending. Time, Level and Source are sortable; Level's descending-severity order is Error → Warning → Info. The message column has no sort control. Page size is fixed at 25; badge and pagination count the filtered list and use the Counts and numbers recipe. Auto-reload keeps the newest first page at 25 rows. The API default stays 100 for compatibility; export remains unpaginated.

| Column | Recipe |
| --- | --- |
| Time | Local `HH:MM:SS`, with `cell-sub` Today/Yesterday and the full ISO timestamp in `title`; tabular numerals, 120px |
| Level | Short Error / Warning / Info tag using `status-error` / `status-warn` / `status-info`, 100px |
| Source | Translated source name with service display name in `cell-sub` when `instance` exists, 160px |
| Message | Translated message using `cell-title` with regular weight, subject beneath in `cell-sub`; remaining width, clamped to two lines |

For `repeat > 1`, append a `filter-count` badge “×{repeat}” with title “{repeat} occurrences combined in 10 minutes”. Only a message with `detail` or `subject` is a `text-button` opening details; otherwise show plain text. Never make the whole row clickable. Empty state uses ScrollText and “No entries in the last 24 hours.”; an empty filtered list uses “No matching entries.” and Reset.

#### Details and actions

The Event entry `Modal` uses `key-values` for Time (ISO and local), Level (tag), Source, Service, Subject, Message and Repetitions. Technical detail is a wrapping monospace `pre`, with a Copy (`Copy`) action. Its footer offers Copy for the entire entry as text and Close. Mux events retain the job ID in `params.job` for copying and export. There is no job-log link. Do not duplicate job-progress output here.

Load on opening Log and on Refresh. Auto-reload silently every 10 seconds only while the tab is visible, Time descending is selected and page 1 is active. Insert new events at the top without jumping or changing focus/scroll position; other sorting, pages and hidden tabs do not auto-reload. Under `prefers-reduced-motion`, omit entry animations.

Download exports the current filters as `.txt`; its `title` names the JSON alternative, available from the context menu (right-click); use `scopearr-log-YYYY-MM-DD-HHMM.txt`. Clear calls `confirmDeletion()` with “You are about to clear the log.” (German: “Du bist dabei, das Log zu leeren.”). Clearing adds a new info event from System afterwards. Demo mode shows sample events and disables clearing.

The settings button and Log tab have no unseen-error indicator or browser seen timestamp. Background error toasts offer Show in log (`text-button`), opening System → Log with the event's source and service filters: Sync and Tag sync failures (with their service), Disk placement and Files & permissions scan failures. `notify(message, kind, log)` takes the filter; Mux, Move and Fix job failures stay visible in their job lists and do not toast.

### Disk tag tooltip

_Replaced in Phase 5b._

DiskTag keeps its tag appearance, default cursor and keyboard focus. Its shared Tooltip shows disk and target/source meaning, then adaptive bytes, plural file count and positive folder count. The overflow chip opens details and describes remaining disks/sizes. Tooltip placement never changes fixed row geometry; tapping the tag must not select the row.

### Selection and bulk actions

_Tool selection, Terminal commands, bulk confirmations and mux marking are replaced in Phase 5b, the tag dialog in Phase 5d. The libraries use Part 1 (10.5, 10.10) since Phase 5a._

Files & permissions selection includes Manual and Failed findings, excluding queued, running and succeeded jobs. Fix selected counts and sends only automatically fixable entries. Terminal commands opens whenever the filtered list has findings, showing a selection count only with a selection. Its dialog owns the left-aligned Download script for all {count} matches action, using the complete current filtered result up to 50,000 findings. Without a selection, explain this scope and omit Copy. Selected commands group at most 100 paths per command/value, with deletion taking precedence on the same path. Owner and permission commands stay distinct; links/special entries and untracked media produce review comments only. The dialog shows up to 500 lines directly, otherwise the first 50 as preview with the total; copying the complete selected script and downloading .sh remain available. There is no separate all-matches button in the results toolbar.


Actions affecting multiple items use confirmation.ts with one short sentence: “You are about to {verb} {count} {objects}.” German: “Du bist dabei, {count} {Objekte} zu {Verb}.” The confirm button is only the verb; Cancel precedes it. Use confirmAction for marking/starting/tag changes and confirmDeletion for removal. Keep existing safeguards for protected jobs and destructive file fixes. Single items and Remove completed add no confirmation; tag removal retains its existing deletion confirmation.

Mux marking (`useMuxSelection`, shared with the libraries' selection tools) is sequential on the visible selection, without a separate 200-file cap. Already marked files are silently skipped. One file has no confirmation or dialog; multiple files have one short confirmation. During processing the disabled toolbar button shows a spinner and Marking … {done}/{total}. There is no progress, cancellation or result dialog. Finish with one success toast, or one warning containing success/failure counts and the first error. Unmark still skips queued/running jobs and retained backups, naming skipped counts in its outcome toast. CustomBulk still receives explicit keys and saves through its existing endpoint, with the same short confirmation style. Reload after each action without inventing hidden selections.

The tag dialog offers a New tag input (`maxLength=80`) and secondary Add button with Plus below its checkboxes. Enter adds locally without submitting. A new tag is checked and marked with the cell-hint New; unchecking discards its creation. Names are trimmed and matched without case; an existing name selects its checkbox. Empty or oversized names show a field hint, and the 128-tag limit disables adding. Apply creates only checked drafts then applies tags; Cancel creates nothing. The empty message is No custom tags yet. Add one below. Disable Apply while busy.

Tools retain progress as a separate sortable column. Progress is a left-aligned bar column (not `.number`): shared compact progress component, 56px bar, unchanged progress-height, space-2 gap, and localized tabular percent in a right-aligned `--progress-label-width` slot without wrapping. Idle rows show an em dash at the start of the cell, aligned with the bars. Progress cells use `.col-progress` without ellipsis. Status contains its tag only.

### Placement diagnostics

_Replaced in Phase 5b._

Disk placement is share-first. Selected Radarr/Sonarr libraries determine the root folders to check; they are the only basis for the scan scope. Normalize Arr root paths and resolve each to a share folder relative to `/unraid/user`. Never enumerate unrelated shares to decide what to scan. Arr entries enrich disk findings with title, service, instance, media ID and type; they do not determine which item folders exist. Files & permissions keeps its existing entry-based scan and scope, with normalized Arr roots, instance IDs for logic, instance display names and longest Arr-path root matching within each instance for its counters.

Resolve a share folder using the first matching step:

1. The saved `unraid.shareDirs[arrPath]` choice, including Do not scan.
2. Path mapping plus filesystem identity: use the candidate implied by the mapped container path relative to ShareRoot when `os.SameFile` confirms it. Identity comparisons may check only first-level `/unraid/user/*` share roots, without reading their contents. Nested targets come only from a saved choice or a candidate explicitly implied by the path.
3. The exact `/unraid/user/<last Arr-path component>` folder, checked by one `Lstat`. Do not search other shares for matching nested names.
4. Otherwise mark the root unresolved, offer Choose share in the report/settings, and skip it without guessing.

Only valid folders under `/unraid/user` qualify: exclude `user0`, `disks`, `remotes`, `addons`, `system` and dot folders; enforce `validPlacementRel` and do not follow symlinks. Merge roots resolving to the same share folder and combine their instances. When one selected share folder contains another, the parent scan skips the separately selected nested folder so neither is scanned twice.

For each resolved share folder and device (array disks and pools), read its immediate item folders once with `ReadDir`. Ignore files and symlinks. Exclude these exact system-folder names case-insensitively: `#recycle`, `#snapshot`, `@eaDir`, `@Recycle`, `@Recently-Snapshot`, `@tmp`, `@SynoResource`, `lost+found`, `.Recycle.Bin`, and the `.Trash-` prefix. Other `#`/`@` names are ordinary media folders. Leading-dot folders are excluded unless an Arr entry points to that exact name; reserved system names are always excluded. Apply the same policy to seasons. Missing device folders are normal; other errors remain scan facts in the report.

Presence on two or more devices, including cache/pools and empty copies, defines Several disks, regardless of scan status; successfully moved rows are excluded. Every one-device folder gets a metadata-only `WalkDir` that stops at the first non-directory entry. No such entry means Empty folder; a link or special file makes it nonempty, without following links or reading contents. Compact one-device rows retain no file list or calculated size (`—`). Detailed inspection walks only devices holding that folder. Never read media contents or unrelated shares.

| Status | Meaning | Action |
| --- | --- | --- |
| `ok` | One device with content (array or pool) | None |
| `empty` | No non-directory entry anywhere, including nested trees | Neutral, never selectable/startable |
| `split` | Files on multiple devices, or pool files with an array folder | Consolidate onto an eligible array disk |
| `empty_folders` | Files on one array disk, only empty copies elsewhere | Empty copies; remove only non-target empty folders |
| `waiting_for_mover` | Legacy scan result only | Check again; show its filter/report column only while its count is positive |
| `seasons_spread` | A series root with seasons on separate devices | Choose series grouping |

Pools are ordinary source devices. The target is always an eligible array disk: prefer an existing folder by bytes, free space, then disk number; when no array disk has that folder, choose by free space and explain that the target is new. Pool-only content with an empty array folder is Split and can move onto that disk. Content on only one pool is OK. Read each share's Use cache policy from the bounded `shares.ini`: Prefer/Only never moves pool content to the array; pool plus array content stays Split without a target and explains why. Missing settings produce one report notice. Show “Cache: Yes/Prefer/Only/No/unknown” beneath the share folder in the report. A running mover or parity operation still prevents execution and makes the queue wait.

Legacy `foreign_owner` values remain readable, but new scans block only on unreadable sources, sources that cannot be removed, conflicts, links/special entries, insufficient space and inaccessible targets. Check effective-process access with metadata only. Different ownership is a warning: copies belong to 99:100 and retain their modes. Start confirmations name how many files change owner; an info event records the count and bounded file details. Empty-copy cleanup always leaves the target untouched, including zero-byte files. Empty copies means “Files are on one disk; the other disks only hold empty folders.” Empty folder means “No file or link exists in this folder on any disk.”

#### Placement checks

Store the last check and its UTC RFC3339 timestamp with the placement row. Keep it after closing, refreshing, a successful move, and an unchanged scan (`item_key` and `placementSame`); clear it on changed files or row removal. The dialog shows “Last checked: {time}” in local time with the ISO timestamp in `title`, or “Not checked yet”. Use the shared PathCheckRow recipe for Unraid reachable, Target writable, Enough free space, Files unchanged since scan, No conflicts, Sources readable, Sources removable, Owner unchanged, and Mover / parity state. Owner unchanged is a warning rather than a blocker and offers the text-button “Check in Files & permissions” with the folder search prefilled.

Use the existing wide (780px) Modal for placement status so the diagnostic reason column stays visible on desktop. Unreachable or unavailable target checks show Not checked as warnings; preserve and display failed recheck attempts as well as successful ones. Display unusual files in a `detail-table`: Disk | File | Owner | Permissions | Reason. Paths are monospace; keep at most 50 distinct disk/path rows (blockers take priority over owner warnings) plus “… and {count} more”; total stored JSON stays within 16 KiB. Reasons distinguish unreadable, not removable, special and owner changes. A status trigger with a stored blocker uses an absolutely positioned `notification-dot` with `--status-warn`, and tooltip “Last check: {blocker}”; it never changes trigger geometry. Footer actions remain Check again and Close.

Enrich by share folder plus the first child component relative to an Arr root: exact match first, then an unambiguous case-insensitive match; ambiguous matches stay unmatched. Matched folders take the Arr title, service, instance ID, media ID and type. Folders without an Arr entry use the folder name as title, an empty service and the `cell-sub` “No Radarr/Sonarr entry” (German: “Kein Radarr/Sonarr-Eintrag”). Without Arr entry (Ohne Arr-Eintrag) is a separate status-filter option (`no_arr`), not a disk status. These folders may move under the same safety rules. A share used only by Sonarr treats an unmatched folder as a whole series without season splitting; other unmatched folders act as movies. Keep stable Arr item keys (`type:service:mediaId`) and unmatched-folder keys (`folder:<S>/<name>`) so jobs remain associated across scans.

For Arr-matched Sonarr series, season-folder grouping keeps the existing series-root/season/seasons-spread logic when the series folder spans several devices; a series folder on one device is compact OK or Empty folder according to its metadata-only emptiness check. Arr entries without a folder on any device remain Not found, identifying the missing disk-relative path. Mux path mapping is used only in resolution step 2 above; plan validity is based on the resolved share folders rather than mapping text.

Every scanned folder is searchable, including compact one-device rows. Default placement hides only one-device OK rows and includes Empty folder; explicit All scanned includes them for report drilldowns; an empty search with hidden OK matches offers Show. Not found uses status-error and belongs to Errors. Errors also includes conflicts and insufficient space, so totals and drilldowns describe the same blocked decisions. Seasons spread uses status-info, belongs to presence-based Several disks and cannot start; choose series grouping to consolidate. Root/instance associations remain available for report provenance and enrichment; shared roots display every instance.

The scan report uses a Shares section (German: Freigaben), replacing Folders for placement, with a `detail-table` that fits the report dialog without horizontal scrolling: Share folder | Root folders | Folders | Several disks | One disk | Empty | Without Arr | Missing folders. Short headers carry their full wording (Folders on disks, On several disks, On one disk, Without Arr entry, Arr entries without folder) in `title`. Root paths do not wrap; their instances sit beneath in `cell-sub`, followed by “{count} devices checked” with the device names in its tooltip. Device errors appear as a notice inside the report. Numeric headers/cells align right; count cells are text-buttons that apply list filters, never whole-row actions. All clickable counts use the same SQL predicates as the list, from `placementStatusFilters`; shares use exact stored `share`, devices use stored `devices`. Fetch `/api/placement/report` on opening and list reloads while open so counts remain current after moves. Show Several disks by result below shares, with per-share breakdown and matching drilldowns. Static device lists/errors and unresolved roots remain facts of the scan. When Folders on disks is zero, a notice inside the report states the exact checked path and absence of folders, for example “No folder was found on any device under /unraid/<disk>/documentaries.” Missing choices/path warnings remain in this report, with a text-button Open in settings linking to the Shares card. A warning dot on the report icon signals notices without changing the page layout.

#### Unraid Shares settings card

Under the Unraid path fields, a Shares `settings-card` uses `CardHeading` and a `detail-table`: Root folder | Instances | Share folder | Status. It shows only root folders reported by enabled Radarr/Sonarr services, never unrelated shares; a row disappears when no service reports that root. Load roots and first-level share names when opening the card; Check paths in the card heading refreshes them.

Each share-folder select offers Automatic ({detected}), Do not scan and first-level share names for manual association. Choosing a share assigns that existing root; it never adds scan scope. Choose subfolder … opens a second select and only then loads children of the chosen share. Persist optional `unraid.shareDirs` as `arrPath → shareDir | "" | "-"` (empty means automatic, `-` means skip), through the section's Save settings action. A change invalidates the placement plan. This card replaces Apply mapping in result notices. Files & permissions may reuse the display without changing its entry-based behavior.

### Mux selection actions

_Replaced in Phase 5b._

The Mux page reuses `MuxSelectionActions` with `actions={["remove"]}`, directly after Start selected in `results-tools`. It uses the same confirmation, progress, skipped-job counts and one result toast as the libraries (`useMuxSelection`). Running, queued and backed-up jobs cannot be removed in bulk; explain disabled selection in the tooltip. Changing search, filters, sorting or page clears the Mux selection; reloads prune it to the current page. Selection covers every visible job state so drafts can be unmarked and protected selections can be explained; Start selected still accepts only startable jobs. Clear the selection and reload after completion. Controls use `control-md` and the existing wrapping toolbar.

## Changelog of the guide

- **2.0.0.** Design system v2 (Part 1); 1.7.0 recipes kept until replaced (Part 2). Phase 4 puts the frame in place (sidebar, band, topbar, page header, transition sheet, tab bar), removes Part 2 “Navigation, accessibility and behavior”, and pins the frame with invariant, keyboard, touch and axe tests (13). The sync display opens the sync popover per instance (10.1); the first v2 button classes (10.3); a pill's hit area is at least 44 wide (10.7); a popover renders in the modal of its anchor (10.8); the bell opens the jobs menu, its jobs loaded only when it opens, with popover text and footer parts (10.1, 10.8); quick search (⌘K) is a modal dialog of fixed size with pages and titles (10.1, 10.9). Phase 5a documents the list and dashboard building blocks before it builds them: their tokens and row density (4), the neutral media tag tone (2.5), the chart color assignment (2.2), `data.css` (9), the list preferences and `sheetPage` (10.1), the filter bar, drawer and chips row (10.5), the table card, table, sort header, pagination, track chips, ring and distribution rows (10.10) and the list and dashboard pages (11); it removes six unread 1.7.0 layout tokens. Its base building blocks follow, built but not mounted: the 1.7.0 `Tag` leaves the start chunk and shares `tagPresentation` with `MediaTag` (2.5), the row button, check and select (10.3, 10.4), `Segmented` (10.6), media and custom tags and row marks (10.7), `HelpTip`, `ListEmpty` and the popover's track width and radio entries (10.8), `SortHeader` and `PageNav` (10.10); then the track chips, the tracks cell, its menu and its popover (2.5, 10.10); then the table card with `useTableOverflow`, the filter bar with the search icon and the button count slot, the chips row with the text button, and the list page recipe (10.3–10.5, 10.10, 11.1); then the media table with its title cell, title marks, Info buttons, media server button and custom tags cell, shielded from the global 1.7.0 table rules, with the card rows as a grid of `--card-cell` columns (4, 10.7, 10.8, 10.10); its fix round gives placeholder rows the cells of a file row (10.10); then the filter drawer with its fields, operator toggle, draft, live count and its own lazy chunk with an idle preload and one retry, the label column token `--ff-label` and one overlay per scope, so a popover in the drawer leaves it open (4, 9, 10.4, 10.5, 10.8). Then the libraries switch to these blocks: `LibraryPage` without the transition sheet (`sheetPage`), with the setup notice, the instance segment, the count tools and icon tools of the chips row, the mux selection logic shared with the mux page (`useMuxSelection`, its run counted in the tool's slot and announced at each quarter) and the drawer opened from its chunk, its facets loaded only while it is open and its draft taken again from a history step (10.1, 10.5, 10.6, 10.8, 10.10, 11.1); Part 2 loses Library sorting and the library parts of Tables, Table recipes, Tags and badges, Shared filter panel and Selection and bulk actions, and the 1.7.0 rules only the replaced library parts used are deleted. Then the libraries are pinned by invariant, behavior, touch and axe tests (13); the drawer's state labels grow to 44 on touch (10.5), and the count tools, the drawer's value buttons, `+n` and the track chips are named by the words they show (10.5, 10.10, WCAG 2.5.3). Then the dashboard switches to its blocks without the transition sheet: the KPI cards, the widget cards with the matching bar and the storage ring, the distribution cards and the dashboard page, with the 40 tile and the warn tone (10.2, 10.10, 11.3); Part 2 loses Dashboard widgets, and `dashboard.css` keeps only `.chart-dot` and `.storage-color-preview` (Settings → Widgets). Then the dashboard is pinned by invariant, behavior and axe tests (13); Display offers row density and stacked audio tracks, kept in this browser only and shown in its 1.7.0 layout until Phase 5c (10.1, 10.11); beside an expanded sidebar at 740–899 the tools' 1.7.0 filter row puts its search on a line of its own (13, Part 2 Shared filter panel), and the tool tables measure their headers again when a face arrives late (13, Part 2 Stable tool tables). The Phase 5a fixes: toasts keep clear of a page's top controls too, a list's card head and the page header's actions (`placeToasts`, 10.1, 10.8, 13); a saved list preference holds for the session when storage is blocked (10.1); the instance alone is no filter selection: “All files”, no count, presets match beside it (10.5); in forced colors a focused current segment, page button or open row button shows the focus ring instead of its inset outline (5); the drawer's Apply keeps its last count, busy and dimmed, while a new one loads, and only a press that began on the backdrop closes the drawer (10.5); 10.8 names both modals a popover can sit in; after Retry on the dashboard focus goes on to the page or to Retry (11.3); on touch a group row's box area is as high as its row (8, 10.10), and a pressed icon button's state sits with its family in `recipes.css` (9, 10.3).

- **1.7.0.** Stable filter panel padding, layout-neutral navigation counters, settings active state, JSON-only API errors, default light muted contrast, one rule per selector, operators beside state filter labels, compact mobile selection actions.

- **1.6.3.** CSV in filter footers, compact result filters with dividers, dialog tabs recipe, top-anchored tabbed dialogs, Info column header in tool tables, two-column scan dialogs with sticky footer. Media-folder checks never create entries; only actual mux, rename and move operations may write there. The configured mux working directory may retain its write probe.

- **1.6.2.** Scan dialogs, result-only filters, manual-finding commands, scan time in reports, MediaInfo action, one details icon.

- **1.6.1.** Help for every state filter, MediaInfo read filter, custom-tag help, MediaInfo section tabs, 1060px file details.

- **1.6.0.** Selectable Used source with manual confirmations, MediaInfo tab and column, inline custom tags, owner default card, no unseen-error dot.

- **1.5.1.** Arr differences as information, equal System cards, password dialog, log page size 25.

- **1.5.0.** Measured status columns without ellipsis, left-aligned progress with a fixed percent slot, red excluded filters, password as the third System card.

- **1.4.6.** Pools as ordinary devices, stored placement checks, real move blockers instead of fixed owner, mux bulk unmark.

- **1.4.5.** Presence-based several-disks model, empty folders, live report counts, heading count badge, settings change details, half-width service fields, stable section heading height.

- **1.4.4.** Share-first disk placement, no result-dependent notices, dialogs close on save, uniform tool page rhythm, card heading minimum height, system tabs and 24-hour event log with compact filter row.
- **1.4.3.** Instance-ID root matching, visible-only selection, no page-wide tool progress, combined scan help, inline list hints, shared settings heading, short bulk confirmations and rule help popover.
- **1.4.2.** Measured table headers and desktop fit, control columns, library selection and bulk confirmations, card-heading actions only, unified settings spacing, Icons tab and edit/delete at row end.
- **1.4.1.** Shared floating surfaces, filters/presets, segmented tabs, ordered lists and four table recipes; appwide settings organization, sticky headings, disk tooltips and enforced stylesheet ownership.
- **1.4.0.** Appwide scale/status tokens, icons, controls, checkbox alignment, surfaces, table headers, titles, dialog footers, stable tool geometry, wording/plurals, key-value lists and setup notices.
