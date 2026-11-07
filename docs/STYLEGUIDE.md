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
6. **Tokens only.** No raw value outside token definitions. Exceptions: media tag palettes, custom tag colors (user data), the dark terminal, the app icon, 0 and 1px, percentages and aspect ratios; section 4 lists them all.
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

**Chart colors.** The design preview has four (`--c1` accent · `--c2` status-info · `--c3` status-wait · `--c4` mix(muted 55%, panel2)); 1.7.0 charts need up to eight series. v2 defines eight instead, from the accent and the status tokens (Phase 3 ruling). Each must reach 3:1 against `panel` (non-text contrast) in all 36 modes (2.6). The series assignment is decided in Phase 5a.

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

#### 2.3 Accent band

The **Accent band: Strong | Muted** setting lives in Display → General → Appearance as a compact segmented control. Without a stored choice, dark mode uses Muted and light mode uses Strong. A choice applies to both modes and can be withdrawn with a “use default” action; a hint explains the default and that one choice applies to dark and light. The choice is stored only in `localStorage`; Phase 4 names the key. The resolved value is always set as `data-band="strong|muted"` on `:root`, with the default resolved by JavaScript.

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
| Row mark, disk source | mix(tone 12%, panel) | Icon in `tone`, or text mix(warn 75%, text) with border mix(warn 25%, transparent) |
| Danger button | Hover mix(error 10%, panel) | Text mix(error 80%, text); border mix(error 40%, line) |
| Row marking | – | `inset 3px 0 0` in warn (conflict), info (incomplete) or accent (open) |

#### 2.5 Media tags, custom tags, track chip and disk tags

- **Media tags** are fixed and do not depend on the palette. Each mode has a background and foreground for resolution, r2160p/r4320p, r720p, codec, source, processing, hdr and audio, with the 1.7.0 values from `library.css` and `responsive.css`. They are tokens `--tag-<key>-bg` and `--tag-<key>-fg` in **one** file (`styles/v2/tokens.css`, under `[data-theme="light"]` and `[data-theme="dark"]`): `--tag-resolution-bg`, `--tag-resolution-fg`, `--tag-r2160p-bg`, `--tag-r2160p-fg` (also r4320p), `--tag-r720p-bg`, `--tag-r720p-fg`, `--tag-codec-bg`, `--tag-codec-fg`, `--tag-source-bg`, `--tag-source-fg`, `--tag-processing-bg`, `--tag-processing-fg`, `--tag-hdr-bg`, `--tag-hdr-fg`, `--tag-audio-bg` and `--tag-audio-fg`. Light audio is `#244a5a` on `#a1cddd` as in 1.7.0; the design preview's lighter value was a drift. The 1.7.0 per-tag border colors get no token. `unknown` is muted on panel2 at weight 500 (palette keys, no token). **SDR** shows the HDR value in the neutral tone (`neutral`: text on panel2 with a `line-soft` edge).
- **Custom tags** use the user color `--ct` and mix in `srgb`. Dark: text mix(ct 45%, text), background mix(ct 16%, panel), border mix(ct 38%, transparent). Light: text mix(ct 18%, text), background mix(ct 22%, panel). User colors are user data and are not contrast-checked.
- **Track chip:** every segment uses `--tag-audio-bg` and `--tag-audio-fg`; frame and 1px dividers use mix(tag-audio-fg 30%, transparent); hover and open use the full `tag-audio-fg`. Without a track assignment the chip is transparent with `text`, and frame and dividers are dashed in mix(muted 80%, transparent).
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
| `--field-border` | `--field-bg` and panel | 3.0 |
| `--chart-1` … `--chart-8` (Phase 3 ruling, non-text) | panel | 3.0 |

When a pair fails, the formula changes (a design decision), never the threshold and never a palette. `--muted-strong` exists because `--muted` on the accent tint of hovered or selected rows dropped to 4.09–4.58:1 in default dark mode; its measured minimum is 5.32:1 over all 36 modes on every surface it is used on; on exactly the surfaces in the table above the contrast test measures at least 5.42:1.

### 3. Typography

The typeface is **Inter Variable**, self-hosted as woff2 (Latin and Latin-ext, SIL OFL 1.1), the same files the design was measured with. It is **declared in Phase 3 and activated with the new shell** (Phase 4). The files live in `web/src/fonts/` (Vite hashes them into `/assets/`); the license is `web/public/fonts/LICENSE-Inter.txt`. `styles/v2/fonts.css` holds only the two `@font-face` rules: family **`"Inter Variable"`**, `font-weight: 100 900`, `font-display: swap` and the Fontsource `unicode-range`. The family name must differ from `Inter`, which the 1.7.0 stack names: a face under that name would apply at once.

- `--font`: `"Inter Variable"`, then `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`; with `font-feature-settings: "cv11", "ss01"`, `font-synthesis: none` and antialiasing.
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

The phone sizes are overrides of the same tokens in the phone block of `tokens.css` (`@media (max-width: 739px)`): `--fs-base` 13px, `--fs-kpi` 26px and `--fs-page` 21px.

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

- **Weights:** `--w-reg` 400 · `--w-med` 500 · `--w-semi` 600 · `--w-bold` 700, plus `--w-label` 550 (field labels) and `--w-title` 650 (card, dialog, drawer and section titles).
- **Letter spacing:** `--ls-caps` .07em (mini labels); `--ls-thead` .04em (table header); `--ls-group` .08em (group labels and flyout header); `--ls-title` −0.01em (titles); `--ls-display` −0.02em (page title and KPI).
- **Line height:** `--lh-text` 1.5 (text); `--lh-page-title` 32px; `--lh-kpi` 36px; `--lh-row-title` 18px; `--lh-sub` 15px (sub-line).

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

Component radii: `--r-frame` 10 (segment frame, 40px tile, sidebar home and sub-entry) · `--r-topbar` 14 · `--r-tabbar` 18 (mobile tab bar) and `--r-tabbar-tile` 9 (its tile) · `--r-band-phone` 24 (band bottom on phones) · `--r-bar` 3 (bars). Cards get 16, not 12: card, band and modal share 16, inner elements are one step smaller.

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
| `--tab-h` | 40px | Tab |
| `--check` | 16px | Checkbox and radio |
| `--check-touch` | 20px | Checkbox and radio under `pointer: coarse` |
| `--switch-w` | 36px | Switch width |
| `--switch-h` | 20px | Switch height |
| `--field-compact` | 32px | Compact fields in the filter area and the log |
| `--field-rename` | 30px | Rename field |
| `--count-in-btn` | 18px | Count inside a button |
| `--badge-h` | 18px | Badge |
| `--plaque` | 16px | Plaque (counter on sidebar, bell and tab bar) |
| `--dot` | 8px | Dot (legend, status) |
| `--dot-sm` | 6px | Dot in a status tag and a sidebar sub-entry |
| `--auto-mark` | 12px | Auto mark of a custom tag (12 × 12) |
| `--textarea-min` | 88px | Minimum textarea height |

Inputs are 36, not 40, so the filter row and buttons share one height.

**Row density.** Comfortable rows are 48px (`--row-h`); compact rows are 40px (`--row-compact`, Phase 3 ruling). **Open:** the density switch (stored in `localStorage`) is decided in Phase 5a; until then only comfortable rows are used.

**Layout tokens** (structural):

| Token | Value |
| --- | --- |
| `--sb-w` | 260 (expanded sidebar) |
| `--sb-rail` | 72 (rail) |
| `--edge` | 16 (12 on phones) |
| `--topbar-h` | 52 |
| `--ph-h` | 70 (114 on phones) |
| `--overlap` | 64 (48 on phones) |
| `--bar-gap` | 8 (6 on phones): gap above the sticky topbar |
| `--band-h` | `--bar-gap` + topbar + page header + overlap = 194 (phones 6 + 52 + 114 + 48 = 220) |
| `--stat-h` | 84 |
| `--row-h` | 48 (touch 56) |
| `--row-compact` | 40 (compact density) |

Only the phone and touch values change by media query, and only as overrides of tokens defined on `:root`: `@media (max-width: 739px)` sets `--fs-base`, `--fs-kpi`, `--fs-page`, `--edge`, `--ph-h`, `--overlap`, `--bar-gap`, `--band-h`, `--content-bottom`, `--toast-top` and `--ring-size`; `@media (pointer: coarse)` sets `--row-h` and `--thead-h`. Phone font sizes are overrides of the same tokens (3), not component values.

**Further fixed geometry** is a component token too. The 69 `--layout-*` tokens disappear with the 1.7.0 CSS.

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

Overlays (10.5, 10.8, 10.9):

| Token | Value | For |
| --- | --- | --- |
| `--drawer-w` | 420px | Filter drawer |
| `--modal-w` | 480px | Modal |
| `--modal-w-md` | 640px | `md` modal |
| `--modal-w-lg` | 1040px | `lg` modal |
| `--file-dialog-h` | 800px | File & metadata dialog height |
| `--toast-w` | 380px | Toast |
| `--pop-min` | 220px | Popover and menu, minimum width |
| `--pop-max` | 360px | Popover and menu, maximum width |
| `--pop-track` | 460px | Track popover |

Other geometry (10.5, 10.10, 11):

| Token | Value | For |
| --- | --- | --- |
| `--search-w` | 260px | Search field |
| `--search-w-narrow` | 240px | Search field below 1600 |
| `--preset-w` | 184px | Preset select |
| `--kpi-min` | 118px | KPI card, minimum height |
| `--ring-size` | 128px (112 on phones) | Storage ring |
| `--tab-panel-min` | 420px | Tab panel, minimum height |
| `--progress-h` | 6px | Progress bar |
| `--progress-thin` | 4px | Thin progress bar |
| `--progress-dist` | 8px | Distribution bar |
| `--percent-slot` | 36px | Percent slot of a progress bar |
| `--dist-percent` | 52px | Percent of a distribution row |
| `--terminal-max` | 50dvh | Terminal, maximum height |

**Exceptions** to principle 6 (no token): Lucide icon sizes (`ICON` in TSX, section 12); timing constants in JavaScript (flyout 150/220ms, the 4px scroll threshold and the 4px page offset); icon and terminal colors (the app icon, the dark terminal); media tag palettes and custom tag colors (2.5, user data); percentages and aspect ratios; 0 and 1px; `z-index` 0, 1 and −1 (the transition sheet below the content); and 0.01ms under reduced motion (6).

### 5. Elevation

| Token | Light | Dark | For |
| --- | --- | --- | --- |
| `--shadow-card` | `0 1px 2px` text 6% + `0 6px 16px -6px` text 14% | `0 12px 28px -18px` bg 92% | Cards |
| `--shadow-float` | `0 2px 6px` text 6% + `0 24px 48px -16px` text 22% | `0 24px 48px -20px` bg 96% | Sidebar, flyout, menu, popover, toast, modal, drawer |
| `--shadow-btn` | `0 4px 7px -1px` text 12% + `0 2px 4px -1px` text 8% | `0 4px 10px -4px` bg 90% | Primary, active segments, tile hover |
| `--shadow-btn-hover` | `0 8px 16px -4px` text 18% + `0 3px 6px -2px` text 10% | `0 10px 18px -6px` bg 96% | Hover of primary and KPI |
| `--shadow-glass` | inner edge panel 80% + `0 18px 28px -12px` text 16% | inner edge `line-soft` + `0 18px 32px -16px` bg 96% | Topbar after scrolling, tab bar |
| `--shadow-tile` | `0 4px 10px -3px` accent 50% | `0 4px 12px -4px` accent 38% | Accent glow under gradient tiles, active page |

Shadow colors are mixes with `transparent`, so they follow the palette. The light secondary button uses border mix(line 80%, muted) and `0 1px 2px` text 6%. Under `forced-colors`, select, checkbox and radio use native rendering and visible borders remain (the approved design does not style this mode).

### 6. Motion

- `--t-fast` 150ms: hover, focus, color, page content.
- `--t-mid` 250ms: menus, popovers, flyouts, modals, drawers, topbar glass, groups.
- `--t-slow` 400ms: sidebar width, drawer sidebar.
- **One** curve: `--ease` `cubic-bezier(.2,.7,.2,1)`.

A page change fades the content in over 150ms with a 4px offset; sidebar, topbar and tab bar stay in place. A flyout opens after 150ms and closes 220ms after the pointer leaves. Buttons, pagination and palette tiles lift by 1px on hover, KPI cards by 2px; row buttons and ghost buttons do not lift. Ring 800ms, bar 600ms, spinner 1s linear, pulse 1s/1.4s. Under `prefers-reduced-motion: reduce` every duration is 0.01ms.

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

There is no page overflow from 320 to 1600px; tables scroll only inside their card. Under `pointer: coarse`, targets are 44 (icon buttons, buttons, pagination, fields, table header, tabs, menu entries), rows are 56, and compact targets get an invisible 44px hit area without a layout change.

### 9. Stylesheet architecture

`web/src/style.css` starts with the layer statement:

```css
@layer legacy, tokens, base, shell, recipes, pages, responsive;
```

All ten 1.7.0 stylesheets load in today's order with `@import … layer(legacy)`. v2 files load into their own layer: `styles/v2/tokens.css` and `styles/v2/fonts.css` into `layer(tokens)`, later rule files into `base`, `shell`, `recipes`, `pages` or `responsive`. Empty layers stay declared. No CSS is unlayered. A guard checks that the `layer(legacy)` imports equal `LEGACY_STYLESHEETS` (`web/test/helpers/legacy-styles.mjs`), so a new 1.7.0 sheet cannot escape the 1.7.0 guards.

The production build minifies with Lightning CSS. It drops the leading layer statement, moves the layer blocks into the declared order and emits the still-empty layers as a trailing statement (`@layer legacy{…}@layer tokens{…}@layer base,shell,recipes,pages,responsive;`). The cascade depends only on the order in which layer names first appear, so the guard checks that order in the built CSS, and that every rule sits in a layer.

`legacy` is the lowest layer. Within one layer, specificity and order decide as before, so the 1.7.0 interface renders unchanged. From Phase 4 on, v2 rules win without specificity fights, and 1.7.0 element resets (`input`, `button`, `label` …) cannot override v2 components. Unlayered 1.7.0 CSS would beat every layer.

Folder `web/src/styles/v2/`:

- `tokens.css` – custom properties only (sections 2–7): sizes on `:root`, derived colors and the Strong band on `:root, [data-palette-scope]`, mode-dependent fields, card edge, shadows and media tags on `[data-theme=…]`, the Muted band on `[data-band="muted"][data-theme=…]`, then the phone and touch blocks.
- `fonts.css` – the two `@font-face` rules only (3).
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
| `--app-header-height`, 69 `--layout-*` | `--topbar-h`, `--band-h`, layout tokens, or removed |
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
- **Sidebar** – a floating card (`edge` inset, radius 16, `--shadow-float`). Modes: **expanded 260** (default at ≥ 1600), **rail 72** (740–1599) and **drawer** (≤ 739, with `--scrim` and a focus trap). Brand 68 high; group labels 34 (rail 22); entries 46 high with a 32px tile in `--tint`/`--icon-tint`; the active entry uses `--grad-accent`, `--accent-text`, `--shadow-tile` and `aria-current`; its parent group is marked; counters are plaques. Sub-entries are 34 high with a 6px dot (accent when active). Groups (movie instances, settings) expand **only by their arrow** and remember their state. **One** expand/collapse button sits at the bottom of the card, in the same place in both states; only its icon changes (`panel-left-close` ↔ `panel-left-open`), and its label and `aria-expanded` follow. The drawer hides it. The expanded footer holds the sync card. The sidebar state is stored in `localStorage`. The rail uses `overflow: clip` and never scrolls sideways.
- **Flyout** (rail) – labeled, radius `--r-md`, beside the rail (+ 8), a header with the group name and entries 36 high; entries without sub-entries get a label-only flyout. State machine `rail → peek (150ms) → open`, with a bridge against flicker; a click navigates and closes. Keyboard: → or Enter opens, ↑/↓ move, ← or Escape go back. Touch: the first tap opens.
- **Band** – the accent band (2.3) at the fixed height `--band-h`, radius 16 (phones: no top radius, bottom 24). It carries the topbar and the page header; the first card row overlaps it by `--overlap`.
- **Topbar** – sticky (top 8), 52 high, radius 14. It is transparent over the band in `--band-ink`; after 4px of scrolling it uses `--glass` and `--shadow-glass` with `text`. Contents: breadcrumbs (starting with Scopearr), demo pill, **sync chip** (rail mode only; when expanded the sync card takes over; below 900 only a dot; popover per service with a sync-now action), quick search (⌘K), **bell** (counter; dropdown of running and failed jobs; errors open the filtered log), theme and sign out. Demo, sync and bell never overlap (long demo text from 1280, the short form below). Phones: brand, demo, bell and theme; the title appears only after scrolling.
- **PageHeader** – on the band at the fixed height `--ph-h`: title `--fs-page`/700, summary `--fs-md` in `--band-ink-soft`, actions on the right (`on-band` buttons, `band-primary`, an `on-band` area segment for instance, System Info/Log and Display; scan progress). Phones: title 21, action row 40 high and horizontally scrollable. Replaces `.library-intro`, `.statistics-heading` and the settings heading.
- **PageStack** – a column with `--sp-4` between blocks and no local margins.
- **Demo notice** – only a pill in the topbar. Replaces the 32px demo bar.
- **Mobile TabBar** (≤ 739) – a floating glass bar, 64 high, radius 18: Dashboard, Movies, TV series, Tools (counter, menu) and More (opens the drawer with the **sync row in its header**, theme and sign out). The active tile is 30 × 26 with the gradient.

#### 10.2 Surfaces

- **Card** – `panel`, border `--card-border`, radius 16, `--shadow-card`. Header at least 60 (title `--fs-lg`/650, count, actions), body, footer at least 56 with a `line-soft` divider. Variant `inset`: `--sunken`, radius 12, `line-soft` edge, padding 12/14. Replaces the eleven 1.7.0 card classes and seven inner boxes (`.settings-card`, `.connection` as a surface, `.stat-widget`, `.distribution-card`, `.filter-panel-v2`, `.recognition-preview`, `.connect-card`, `.system-service-card`, `.mux-tool-card`, `.tool-package-card`; `.filename-box`, `.storage-instance`, `.rule-save-status`, `.event-detail pre`, `.storage-path`, `.external-tag-conflict`, `.file-dialog-section`).
- **Tile** – icon tile 32 (radius 8), 40 (radius 10) or 48 (radius 12). Variants `tint` (default), `grad` (gradient and glow), `panel`, and the tones warn, info and muted.
- **KpiCard** – radius 12, at least 118 high, label `--fs-sm`, value `--fs-kpi`/700; `hero` uses `--grad-accent`. It is a link or button into the filtered list (an arrow appears on hover). `compact` is 84 high (value 24) and serves as filter buttons on the tool pages.
- **DiskCard** – 84 high like the KPI row, radius 12, 40px tile. Standby status appears only here; it blocks nothing and warns about nothing.

#### 10.3 Actions

- **Button** – `secondary` (default: panel with a `line` border), `primary` (`--grad-btn`, `--accent-text`, `--shadow-btn`), `ghost`, `danger` (2.4), `danger-solid`, and on the band `on-band` and `band-primary`. Sizes 36, `sm` 30, `xs` 26, `lg` 40. Font `--fs-md`/600. Disabled at opacity 0.42, keeping its space. A count inside a button is 18 high.
- **IconButton** – 32, `sm` 28, `xs` 24; `ghost` (default), `framed`, `danger`; open uses `--tint` with `--accent-ink`; 36 in the topbar. Always has `aria-label` and `title`.
- **RowButton** – a framed tile 28 (`sm` 24), radius 8, `line` edge. Hover: `--accent-ink`, `--accent-line` and `--shadow-btn`; `on` uses `--tint-soft`. Used for the Info column and row actions. Replaces the `.icon-button` overrides in tables, `.row-icon` and `.info-action`.
- **TextButton** – `--accent-ink`, `--fs-sm`/600, underlined on hover.
- **Toolbar** – a row with `--sp-2` that never wraps into the page layout (container width, 10.10).

#### 10.4 Forms

- **Field** – label above the control with a gap of 6; label `--fs-sm`/`--w-label`/muted; help text `--fs-xs` muted; errors in mix(error 80%, text) with `aria-invalid` and `role="alert"`.
- **Input / Select / Textarea** – 36 (`lg` 40), radius 8, border `--field-border`, background `--field-bg`. Hover border mix(muted 90%, text); focus border accent with `--focus`. The select chevron is a mask in `muted` (native under `forced-colors`). Textareas use monospace 12 and are at least 88 high.
- **InputGroup** – prefix icon (left 11, field padding 34), suffix or reveal on the right; a fixed extension as a suffix field (rename).
- **Check / Radio** – 16 (touch 20), radius 5 (radio round), border 1.5px `--field-border` on `--field-bg`. Checked uses `--grad-btn` with the check in `--accent-text`. The row uses a gap of 10 and aligns with the first text line.
- **Switch** – 36 × 20; off: `panel2` with the field border; on: `--grad-btn`.
- **OperatorToggle** – `=`/`≠` and all/not all in the filter drawer (10.5).

#### 10.5 Filters

- **FilterBar** – in the header of the results card: search (260), preset (184) and a Filter button with a counter, identical on all five lists. Below a container width of 760 the search takes the full width.
- **FilterDrawer** – on the right, 420 wide, floating (`edge`, radius 16) over `--scrim-light`; a full-screen sheet on phones. Multiple selection per attribute, `=`/`≠` operators everywhere, all/not all for HDR, audio codec, language, channels and custom tags, an **audio track combination** block, a live match count, and Reset. Only the apply action (with the match count) takes over the selection.
- **ChipsRow** – a fixed-height 48 row above the table: chips (28, pill, `--tint`, each removable), Reset, and on the right the page tools (selection actions, CSV, help). Empty: a hint text. Excluded values (`≠`) use the error tone.

#### 10.6 Tabs and switches

| Form | Use | Look |
| --- | --- | --- |
| **Segmented** | Exclusive areas (instance, System Info/Log, Display, service tabs, mode, band) | `panel2` background with an edge, buttons 30, active `panel` with `--shadow-btn`; variant `on-band` |
| **Tabs** | Tabs in cards and dialogs | 40 high, 3px underline in `--grad-accent` |
| **Navigation** | Sidebar | 10.1 |

#### 10.7 Labels and markers

- **Count** – 22, pill, muted on panel2; `on` and inside a card title `--accent-ink` on `--tint`. As a plaque (absolute, 16) on the sidebar, bell or tab bar it never changes the size of its host.
- **Dot** – 8 (legend, status) or 6 (inside a status tag, sub-entry).
- **Tag** – 22, radius 6, 11/600, padding 7. Variants: media (2.5), `neutral`, `unknown`, disk (2.5).
- **StatusTag** – 22, radius 6, `--fs-xs`/600, dot and text (2.4). Never truncated; long text goes into `title`.
- **Badge** – 18, pill, 10/700 (2.4).

#### 10.8 Feedback

- **Notice** – tone surface (2.4), radius 12, padding 12/14, icon; `error` uses `--status-error`.
- **SetupNotice** – a fixed position between the FilterBar and the result.
- **Toast** – top right below the topbar (top 80, right 24; phones top 64, 16 at the sides), 380 wide, radius 12, `--shadow-float`, an icon tile in the status tone and a close button of 28. An optional action opens the log or the mux list.
- **Popover / Menu** – **one** primitive: `panel`, radius 12, `--shadow-float`, 220–360 wide, entries at least 36, hover `--hover`, the chosen entry at 600 with an accent icon, a header in the mini-label style. Keyboard: arrows, Home/End, Escape and focus return. Replaces `.nav-menu-list`, `.operator-menu`, the `.select-popover` list, `.evidence-source-options` and `.media-link-popover`.
- **Tooltip / HelpPopover** – share their base with the popover.
- **EmptyState** – a 26px icon in a `--tint` tile (radius 12), heading `--fs-lg`, explanation and an optional action; always inside the table card.
- **Loading** – a spinner beside the result count; the busy table state stays as in 1.7.0.

#### 10.9 Overlays

- **Modal** (every pop-up) – centered, 480 / 640 / 1040 wide, radius 16, `--shadow-float`, `--scrim`. Header padding 18/16/14/24, title `--fs-xl`/650, footer with a divider and actions on the right (Cancel → primary or danger). Full screen on phones. Focus trap, Escape, focus return and `inert`.
- **File & metadata** – 1040 × 800 with a fixed header (title; the filename takes at most two lines and never breaks inside the extension), tabs, and ↑/↓ plus buttons that page through the filtered list (“3 of 26”). Opening focuses the title. **Rename** sits in the header: a pencil tile opens a field without the extension plus the fixed extension, with Cancel and Save, Enter and Escape, and field errors (empty or too long, invalid characters, unchanged, target exists – texts from the catalogs). A companion-file dialog lists old → new with a checkbox. Saving shows a toast and a log entry; the dialog stays open and focus returns to the pencil. ↑/↓ inside the field do not page; paging with an unsaved change asks to discard it. The header has the same height in both states.
- **Drawer** – the filter drawer (10.5) and the mobile sidebar (10.1).
- **ConfirmationDialog** and **SavePresetDialog** (one component, Cancel | Save).

#### 10.10 Data

- **TableCard** – a card with the filter row, ChipsRow, table and footer (pagination). Container queries 1060 / 760 / 560: labels disappear → compact header → wrapping tool row.
- **Table** – header 38, `--thead`, 10/700 uppercase .04em muted, sticky. Cells `--fs-sm` with horizontal padding 8 (first and last 20, below 760: 16), rows `--row-h`, dividers `line-soft`, states through `--row-bg` (2.2), sub-lines on hover, selection and open rows in `--muted-strong`. A title cell has the title at `--fs-md`/600 and a sub-line at `--fs-xs`. Child rows use mix(panel2 30%, panel) with an indentation line; the detail row uses `--sunken`.
- **SortableHeader** – a 28 button with an 11 arrow (55% opacity; active: full opacity and `--accent-ink`). Cycle ascending → descending → default with `aria-sort`. The audio tracks column has a sort menu (language, codec, channels).
- **RowActions / Info column** – the Info column holds the media-server link, File & metadata, series expansion and, on the tools, the **terminal**. The action column holds only start/retry/fix/consolidate and remove.
- **SelectionBox** and **BulkBar** – selection actions live in the ChipsRow.
- **Pagination** – round buttons 34; the active page uses `--grad-btn` with `--shadow-tile`; the page-size select is 30.
- **Progress** – bar 6 (thin 4, distribution 8), percent slot 36.
- **KeyValueList** – `kv` (dt muted, `line-soft` dividers) and `kv2` (two columns, rows at least 40, label 120–170) for service status.
- **Terminal** – stays dark and fixed (`#0b1012`, text `#cfe3dc`, ok/err/dim), monospace 12/1.65, at most 50dvh.
- **Ring / DistributionRow** – ring 128, value 24/700; a distribution row with a bar of 8 and a percent of 52. Every value opens the filtered list.
- **TrackChip** – **one continuous chip** `[flag | codec | channels]`, 24 high, radius 6, `--fs-2xs`/600. All segments share surface and frame with 1px dividers (colors 2.5); there is **no default dot**. Tooltip and `aria-label` name track number, language, codec, channels, default and title. Default yes/no appears only in the `+n` popover (Default column) and in File & metadata → Audio. Without a track assignment the chip is dashed all around. The same chip appears stacked, in the `+n` popover and in the mux options. A click opens a menu: language only · codec only · channels only · language with codec (same track).
- **TracksCell** – compact: at most two chips (the second only when both codecs together have at most 12 characters) and a `+n` popover; option “stacked” (the row grows). Column ID `audio`; channels normalized.
- **CustomTagsCell** – an edit tile and the tags **in media-tag form** (radius 6, 22, 11/600, padding 7, colors 2.5), with a 12 × 12 auto mark (radius 3, 8/800). The same form appears in the table, the custom tags dialog, settings and File & metadata; overflow uses `+n`.

#### 10.11 Settings components

- **ServiceCard** – header: 40px service tile (gradient), name/instance, status tag, actions and a “service active” switch behind a divider. **Status comes first** as `kv2`, then configuration (two-column form grid, `--sp-4`), then further sections with a divider and section header. Unraid shows **one** mover/parity status. Service tabs include Radarr 4K with the correct file count.
- **ModeToggle** – segment Dark | Light, beside the **BandToggle** Strong | Muted (2.3).
- **PalettePicker** – tiles 42 high (`--sunken`; selected `--tint` with a 2px accent ring and halo), 3 columns, 2 below 1120, 1 at ≤ 739. **PalettePreview** per mode with a mini band, header, row and buttons (scoped tokens, 2.2).
- **ColumnOrderEditor** – a segment per list; a list of 46-high entries (handle, visible, name, ↑/↓, lock) beside a preview of the list; stacked below 1120. Option to show audio tracks stacked.

### 11. Page recipes

#### 11.1 List and tool pages

Movies, TV series, Mux, Disk placement and Files & permissions: band page header → (tools: the 84 KPI row; Disk placement: the disk cards) → optional SetupNotice → TableCard. The first card sits at y = 146/172, and the first table row sits at the same height on all three tool pages (y = 401 at 1440 in the design).

#### 11.2 Disk placement

No “mover inactive” or “parity valid” display and no explanation text. Mover and parity appear only when they act: as the row status for waiting on the mover or a parity operation, and as a notice in the scan and start dialogs (texts from the catalogs). Disk tags show only names. The target disk is chosen as in 1.7.0 (`placement_scan.go`).

#### 11.3 Dashboard

KPI row (hero first, every KPI a link) → widget row with the storage ring (3 columns, 2 below 1280) → distribution grid (3, 2 below 1120, 1 on phones).

#### 11.4 Settings

Each area is reached through its sidebar group. The description and Save settings sit on the band. Cards use 1–2 columns (`--sp-4`). Services: a segment of the instances plus Add service, with **one** ServiceCard below. Display: segment General | Lists & columns | Colors. Settings routes follow `docs/ARCHITECTURE.md`, “Routing (2.0.0)”.

#### 11.5 Login and setup

A centered card with the brand, the form and a footer. The footer keeps a space between the version and the following text (“Scopearr 2.0.0 · For your own server”); 1.7.0 rendered “1.7.0· For …”.

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
| Charts with four colors | **Open** (2.2, chart colors) |
| No density switch | **Open** (4, row density) |
| Column editor dragging on desktop only, generic episodes | 1.7.0 keyboard/touch ordering and data |
| Counters consistent with demo data | Real counters |
| “Band off” mentioned as an idea | Not part of 2.0.0 |

### 12. Accessibility and icons

- Focus is always visible: `:focus-visible` uses a 2px `--ring` with a 2px offset (`--band-ink` on the band; fields use `--focus`). Provide a skip link; keyboard support in menus, tabs, flyouts and drawers; Escape with focus return; a focus trap in modals and drawers; `aria-current`, `aria-expanded`, `aria-sort`, and `aria-live` for jobs. Touch targets are at least 44.
- Icons come from `lucide-preact`. Sizes: 11 (sort arrow) · 12 · 13 (brand, xs button) · 14 · 15 (row button) · 16 (default) · 18 (40px tile) · 20 · 22 (48px tile) · 26 (empty state). Phases 4 and 5 map them onto `ICON`. The meaning table of Part 2 (Icons) stays valid.
- **App icon:** a squircle (radius about 28%) with a gradient from mint `#7ee4c5` through `#3fae8f` to teal `#14755c` and a light gloss; a magnifier with a dark rim and light glass, holding a teal funnel, **without** dots. The SVG master is `web/public/icon.svg`; a script derives PNG 64/180/256/1024 and `favicon.ico`. The in-app brand is single-color `currentColor` in `--accent`. The Unraid template icon URL carries `?v=2.0.0`.

### 13. Testing the interface

2.0.0 replaces tests that pin 1.7.0 class names and stylesheet text with tests of geometry, behavior and roles:

- **Pixel and DOM baseline.** The pixel project (`pnpm --dir web e2e:pixel`) compares screenshots and DOM snapshots. Phase 3 changes no pixel and no DOM node. Each frame or page rebuild re-records the baseline deliberately, in its own commit with a reason; an unexplained difference is fixed in code, never by updating the baseline.
- **Layout invariants** (automated e2e): the first card starts at y = 146 (≥ 740) and 172 (≤ 739) on every page; no page overflow from 320 to 1600px; the movie table at 1440px with the rail fits without horizontal scrolling in all four languages; the rail click test (ten fast clicks on five icons, with and without reduced motion) keeps the rail at 72 with `scrollLeft` 0; a page change moves no navigation entry; touch targets are at least 44 under `pointer: coarse`.
- **Stylesheet guards** (`web/test/stylesheet-guards.test.mjs`) enforce section 9: the layer statement comes first and every sheet loads into a layer, with the `layer(legacy)` imports equal to `LEGACY_STYLESHEETS`; the built stylesheet keeps the layer order and layers every rule; v2 tokens share no name with 1.7.0 and never redefine palette keys; 1.7.0 rules read no v2 token; token files hold only custom properties on token selectors, and their phone and touch blocks only override `:root` tokens; v2 rule files follow the rules of section 9, including durations, layers and weights; every v2 token is documented in Part 1. `web/test/test-layout.test.mjs` scans every file below `web/test/helpers/` for stylesheet reads. The 1.7.0 ownership guard stays separate and is not loosened.
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
| Custom tag chips in their own form | `CustomTag` in media-tag form |
| Mover and parity displays and the explanation text of Disk placement | DiskCards (standby), the waiting row status and the dialog notice; Unraid service: one status |
| Service layouts in `ConnectionSettings`, `MuxToolSettings`, `MediaInfoSettings`, `UnraidSettings`, `ToolPackageCard` | `ServiceCard` (status → configuration → sections) |
| Theme select, palette select without preview, `OrderedList` without a result view | `ModeToggle` and `BandToggle`, `PalettePicker` and `PalettePreview`, `ColumnOrderEditor` |

**Dead rules** – remove after checking static and dynamically constructed classes: `.footer`, `.filter-heading`, `.mux-progress`, `.recognition-actions`, `.column-settings`, `.appearance-lists`, `.list-layout-reset`, `.emby-match-field`, `.filecheck-kinds`, `.filecheck-owner`, `.language-chart-filter`, `.placement-detail-disks`, `.placement-footer`, `.placement-disk-source`, `.tab-dot-trigger`, `.notice.success`.

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

Scan report → Scan-Bericht; Help → Hilfe; Last scan → Letzter Scan; How scanning works → So funktioniert der Scan; From Arr → Von Arr; Shares → Freigaben; Tag colors → Tag-Farben; Resolution groups → Auflösungsgruppen; All items / All findings / All jobs → Alle Einträge / Alle Funde / Alle Aufträge. Selection / selected → Auswahl / ausgewählt; Mark for mux / Remove mux marking → Zum Muxen vormerken / Vormerkung entfernen; Match → Abgleich; Not found → Nicht gefunden; Seasons spread → Staffeln verteilt; On one disk → Auf einer Disk; Folders → Ordner. Use Reset for color reset headers; Reset column is reserved for actual column resets. Bulk confirmation wording follows the short “You are about to …” / “Du bist dabei, …” pattern above.

Use the same terms in all four catalogs. German instructions address the user in the imperative (Du). Help sentences end with a period; labels/headings/buttons do not. Ellipses use a leading space and the character ` …`. Status tags retain their specific result (Moved, Fixed, Succeeded), while cleanup buttons use Remove completed. All visible text uses `t()` and exists in every catalog; see [TRANSLATING.md](TRANSLATING.md).

## Part 2 – 1.7.0 recipes (until replaced)

Part 2 is the 1.7.0 guide, kept word for word with headings one level lower. Each section names the phase that replaces it. Until then it binds every change to the 1.7.0 stylesheets.

| Part 2 section | Replaced in |
| --- | --- |
| Navigation and page recipes → Navigation, accessibility and behavior | Phase 4 |
| Tables (except Stable tool tables), Table recipes, Tags and badges, Shared filter panel, Library sorting, Dashboard widgets, Selection and bulk actions | Phase 5a |
| Navigation and page recipes → Tool page; Tables → Stable tool tables; Placement diagnostics; Mux selection actions; Disk tag tooltip | Phase 5b |
| Navigation and page recipes → Settings section; Settings cards and ordered lists; Segmented tabs; Event log | Phase 5c |
| Dialogs and detail lists; Navigation and page recipes → Scan dialogs; Metadata evidence; Feedback | Phase 5d |
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

Font stack: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif. Paths, terminal and rule textareas use ui-monospace, SFMono-Regular, Menlo, Consolas, monospace.

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

_Replaced in Phase 5a, except Stable tool tables (Phase 5b)._

#### Standard table and row actions

Use `.table-wrap > table`, `th scope="col"`, and `SortableHeader` for sortable columns. Sorting cycles ascending → descending → default and exposes `aria-sort`. Headers use the global uppercase recipe. Cells use `--space-4 --space-5` (compact mobile: `--space-3 --space-4`), a line border and vertically centered content. Table wrappers use surface radius; standard columns fit without horizontal scrolling from 1440px in all four languages. Smaller screens may scroll. Empty tables render `.empty-state` via `EmptyState`.

Title: `<strong class="cell-title">` at medium weight; secondary line: `<small class="cell-sub">`, muted, `--font-xs`, margin-top `--space-1`, only for actual secondary information such as a path, filename or episode title. Short qualifiers use `<em class="cell-hint">` in the same nonwrapping label group, space-2 after the name, font-xs, muted, italic and initially lowercase. Library rows retain their leading icon. Full paths remain available in tooltips and details.

Inspection/start actions (details, start, log, options) follow selection. Edit and delete/remove actions always occupy the last column, right-aligned. `.info-actions` holds up to three `.row-icon.info-action` controls with `--space-2` gaps. Extra actions belong in details. Compact settings/color/track tables reuse standard borders; track cells use `--space-2 --space-3`.

#### Stable tool tables

_Replaced in Phase 5b._

Disk placement, files/permissions and mux use `.tool-table`, `table-layout: fixed` and a colgroup. `toolTableStyle()` computes minimum width from the selected columns; the title receives at least 200px. Selection is 40px; action width is 24 + n × 28 + (n − 1) × 8; removal 52px; service 120px, status at least 120px and wide enough for the longest translated status tag of that tool, progress 128px. Title receives the remaining width with a 200px minimum. `toolTableStyle()` measures translated uppercase labels using the actual font, size and letter spacing, sort icon and padding; every column receives the larger of content minimum and header width. Status widths measure every translated short label from the tool's label table, including tag padding and border, never visible rows. Remeasure headers and tags after a language change and after `document.fonts.ready`. Status cells use `.col-status` with no ellipsis; tags are never truncated. All tools, including Mux, show short status labels with the full label in `title` and `aria-label`. Widths never depend on rows. See `toolColumnWidths` for other minima.

The icon column is visibly labeled Info in all three tools and their column settings. Its header uses `.col-info` and `.th-label`, is left-aligned and never sortable; selection/removal keep `.col-control` and their accessible captions. Measure Info without a sort icon, preserving existing action-column minima and persisted `actions`/`buttons` keys.

Rows are 64px, 56px at ≤740px. Titles clamp to two lines, paths/subtitles to one ellipsized line. Data columns do not force new line wrapping after a removal. Disk tags wrap side by side; show two plus a details chip for remaining disks. Details retain all disks and sizes.

At ≤600px the action column shows Details; start/fix, terminal and mux options stay available in the details footer with their existing handlers and confirmations. Selection stays accessible. Removing an entry affects its own spinner/fade only; a failed request restores it. Reduced motion disables the fade. Slow reload indication is delayed 300ms.

#### Counts and numbers

Page summary: **open entries**, with `title="Open items"`. Results badge: total rows in the filtered list, matching pagination, with `title="Items in the list"`. Pagination: `{from}–{to} of {total}`. Tools menu badges count queued/running/failed jobs; unstarted scan findings, succeeded and cancelled jobs do not count. Mux drafts/ready jobs count as open.

Use `count()` or translated numeric `count` parameters for localized integers, `bytes()` for adaptive decimal B/kB/MB/GB/TB, `percent()` for localized percentages with a narrow nonbreaking space, and `—` for unavailable values. Counts and progress use tabular numerals. `t()` selects `|one` / `|other` through Intl.PluralRules before formatting numeric counts; legacy messages remain a fallback.

### Tags and badges

_Replaced in Phase 5a._

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

`.library-intro` via `PageHeader` (h1 + open count) → `.filter-panel.filter-panel-v2` → optional setup notice → `.library-section` with results heading, table/empty state and pagination.

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

The heading starts level with the first navigation entry and sticks beneath the app header. Navigation uses font-md and active accent indication, vertical on desktop and wrapping at ≤900px. The settings-content grid owns space-4 between headings, tabs and cards without extra margins. Each settings-card/connection groups one topic, using 1–2 column form grids and border-top subsection separators. Service tabs and Add share a row. Preserve save routes and confirmations; resets use confirmReset().

The Unraid tab places a `.unraid-settings-grid` with equal Paths and Files & permissions settings cards above Shares; it collapses to one column at 900px. UID/GID controls use the standard field recipe and the existing 360px maximum; a muted hint states the running container UID:GID. The Files & permissions card combines default owner fields and allowed/ignored-name counts with Edit, using the shared names dialog and the section draft/Save route. Name edits apply to the next scan. Paths also contains the persisted Verify copies with checksums move preference. The default remains editable when Unraid is disabled. Files & permissions starts and resets to this default; scans retain their own execution values without changing it. Ownership fixes that cannot assign the requested owner are manual and explain the generated command route.

MediaInfo is a singleton service tab sorted alphabetically. MediaInfo and MKVToolNix share `ToolPackageCard` for package status, channel and install/update/check/remove actions, and `PathMappingsCard` for `mux.mappings`; its hint reads Shared with MKVToolNix and renaming. All mappings remain one setting.

#### Navigation, accessibility and behavior

_Replaced in Phase 4._

At ≤740px the demo banner is sticky below the measured app header (`--app-header-height`) with z-index 20 below the header/menu layer so scrolling cannot slide it beneath the two-row header; use its normal flow position without margin offsets.

The desktop header is a three-column grid: minmax(0, 1fr) auto minmax(0, 1fr), with the brand at start and actions at end. Keep the existing two-row mobile layout. Derive active navigation from the visible page: settings clears every main-navigation active state and activates the settings icon. All active page controls, including Dashboard and Settings, expose aria-current="page". Active header icons use the same accent indication as tabs.

Main `.tabs` and `NavMenu` use active accent indication. Nav menus open on click, support arrows, Home/End and Escape. `SegmentedTabs` controls choose mutually exclusive scopes. Preserve the current library/tool/instance/page through session expiry with the hash route (`#/…`) instead of sessionStorage.

Keyboard focus remains visible with an offset outline; toggles expose expanded/controls, sorting exposes aria-sort. Small touch targets expand invisibly. Reduced motion disables animations. Long content remains readable or available in full through details/tooltips. Colors remain token-based in light, dark and all additional palettes.

### Stylesheet ownership

_Replaced with the last 1.7.0 section (end of Phase 5). The test named below now lives in `web/test/legacy-ui/stylesheet-ownership.test.mjs`._

Import order: base → navigation → library → dialogs → login → dashboard → settings-and-filters → recognition → placement → responsive. A non-media selector has exactly one rule in its owning stylesheet (intentional reset groups require documented test exceptions); `web/test/stylesheet-ownership.test.mjs` enforces this. No unexplained cross-file duplicates are allowed. Add rules to the matching area, merge existing selectors and group media queries. Never add another improvements or override stylesheet. Remove unused rules only after checking static and dynamically constructed classes.

### Floating surfaces

_Replaced with the last 1.7.0 section (end of Phase 5)._

Every floating tooltip, popover and menu uses `.floating-surface`: panel2 background, text foreground, line border, control radius and the shared shadow. Do not add local surface colors or shadows. Only floating surfaces, modals and toasts use shadows (a user-selected flag outline is a border effect).

`Tooltip` from `ui.tsx` wraps a trigger, supplies role tooltip and aria-describedby, opens after 150ms hover or immediately on keyboard focus, closes on Escape, and toggles on coarse-pointer taps. Outside taps close it. Its fixed position flips above/below and stays inside the viewport. `.tooltip` uses space-2/space-3 padding, font-sm, line-height 1.5, a 340px structural maximum width bounded by viewport minus space-8, pointer-events none and z-index 40. Offset: space-2. Flags, operators, filenames and disk tags reuse it. Interactive/long help uses HelpPopover (space-4), other popovers space-3. Menus use space-1 and small-radius entries.

### Shared filter panel

_Replaced in Phase 5a._

Filter panels only filter results. Files & permissions and Disk placement use `.tool-result-filters` without a collective Show heading. Groups sit side by side with border-left line and padding-left space-6 between adjacent groups, following the library state-filters divider recipe; never give the first visible group a leading border. Shares appears only with at least two choices. Placement groups Shares (`minmax(var(--layout-240), 1fr)`), Status (`2.5fr`, three checklist columns) and Kind (`1fr`); Files & permissions groups Shares, Kind (`2fr`, two checklist columns) and Status (`1fr`). Without Shares, the remaining groups fill the width. Counts follow labels immediately, with space-3 checklist gaps and control-sm row height. Expanded compact tool panels keep the panel's space-5 padding; padding never changes between collapsed and expanded states. They use space-3 above the expanded groups, no extra group padding or outer group border, and no extra footer top padding, with a control-sm footer minimum. Group headings use the card-title line-height 1.3 without margins. This retains the 360px height budget with five checklist rows while keeping the normal search controls and footer icons. At ≤1120px placement Status uses two columns; at ≤900px groups stack with border-top separators; at ≤600px every checklist uses one column. At 1440px both complete expanded panels must be at most 360px tall. `placement.css` owns this recipe.

Scan options live in a wide Scan dialog opened by the first primary Scan action; while scanning, Cancel scan remains direct. Tool presets continue to store result filters only. Scan dialogs may open during fixes/moves but disable starting with an explicit reason until work completes.


Every state filter has a HelpPopover explaining inclusion and exclusion. Its operator follows the label and help icon immediately with space-2 gaps; labels do not grow to push operators to the far edge. MediaInfo read is visible when MediaInfo is enabled or its filter is active, so loaded presets remain removable.

All five library/tool pages use `FilterRow`: labeled search, 200px preset choice, save/delete preset icons, collapse icon. Only this row and ActiveFilterBar remain visible when collapsed. Expanded filter-groups sit between them and have space-5 bottom padding. ActiveFilterBar owns the fixed footer order: Reset when active → page tools (Scan report) → CSV export → help, with named tools/export/help slots. Movies/TV series use Reset → CSV → Help; Disk placement and Files & permissions use Reset → Report → CSV → Help; Mux uses Reset → Help and has no export. CSV uses Download at ICON.button in an a.icon-button.control-sm with download, title and aria-label Export CSV; without results render an inert span with aria-disabled. Export follows current list filters and sort, retaining Placement target. CSV never appears in results toolbars or scan reports. Scan information belongs in the HelpPopover as Last scan, followed by How scanning works; omit Last scan before the first scan. There is no separate scan-info icon or info slot. Footer controls use control-sm and ICON.button. Scan is the first, sole primary results action. Running scans, moves, fixes and cleanup show a spinner and short muted aria-live text directly after the results count, never a page-wide progress bar or separate activity row. On phones Scan fills the first toolbar line.

Tool presets store list filters only, using service namespaces tool:placement, tool:filecheck and tool:mux in the existing presets table. No scan settings, pagination or ordering are saved. Shares is an include-only list filter under Show, independent of scan service selection, visible with two detected shares. Active shares remain chips when collapsed. Scan-result notices never appear between the filter panel and results; missing share-folder choices are resolved in Unraid settings and linked from the report.

#### Compact filter row

Lists inside settings cards use a compact `FilterRow` variant when search and filters fit in one row. There are no presets and no expand/collapse control. Search uses `.input-wrap` with `ICON.button` and grows to fill the available width; include-only `MultiFilter` controls follow it, using counts where available. Controls have `control-lg` height. Below them, `ActiveFilterBar` shows active chips and Reset using the shared footer order (Reset → optional page tools → help). At ≤600px search occupies the full width and filters wrap on the next line. Inputs stay in the card body, never in `.card-heading`. The event log uses this variant with Level, Source and, only when entries have an instance, Service filters.

### Table recipes

_Replaced in Phase 5a._

Every table is a real table in `.table-wrap` with thead/tbody, th scope col, and optional th scope row styled as cell-title. Exactly one recipe applies: `.data-table` (libraries/rules), `.data-table.tool-table` (fixed tool rows), `.detail-table` (metadata, reports, previews, disk details), or `.editor-table` (controls/ordered lists). Tables in cards/dialogs have no minimum height. All heads share the library.css recipe: uppercase font-2xs, medium weight, letter-spacing, muted on panel2, nowrap. No other stylesheet sets header typography. Numeric cells and headers align right with tabular numerals; missing values use an em dash.

All tables use the single global border-collapse: collapse rule with zero border-spacing. Row separators come from td border-top only; do not add local cell borders. Heads never wrap or ellipsize. Only .th-label may carry last-resort ellipsis, which must remain inactive at standard desktop widths. Control columns (.col-control) have centered content, space-3 horizontal padding, no ellipsis and only sr-only captions. Data cells use space-4/space-5 and font-sm; tool cells use space-3 horizontally. Detail cells use space-3/space-4 and font-sm; paths/patterns remain monospace at the same size. Paginated or potentially >20-row details use SortableHeader; fixed property order stays unsorted. `.detail-table.stack-mobile` becomes labeled cards at 600px; data/tool tables keep horizontal scrolling. A row has either a whole-row action or cell actions, never both. Reports use a text-button in their first cell and DiskTag where appropriate.

Editor cells use space-2/space-3; headers never wrap, control columns size to content and preview takes remaining space. All color/visibility/text/reset/delete controls are framed control-md squares, including centered 16px checkboxes; icons use ICON.button. Color inputs use the named --color-input-padding token (6px). Text-color preview reads Aa on the selected tag background. Mux track inputs are the compact control-sm exception. Editors are never sorted: their order is content. Library/rule/tool sorting cycles ascending → descending → standard. Recognition rules use 64px rows, two-line names and ellipsized single-line pattern cells. Edit/delete buttons occupy the last column, aligned right. Rules paginate or scroll with the page, never inside a nested height-limited table wrapper.

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

### Dashboard widgets

_Replaced in Phase 5a._

The dashboard grid stretches every card in a row to equal height. Distribution cards are flex columns with the shared 468px structural minimum; More/Less sits at the bottom. All distributions share title, stacked chart, list and expansion logic. Language rows differ only in flag/name labels; flags and Unknown share a centered 27×18 box. Languages remain one column, except for the shared two-column compact distribution layout at 900px.

### Library sorting

_Replaced in Phase 5a._

Movies default to title ascending. Series default to series A–Z, season/episode ascending with season headings. Descending Episode reverses series only. Every other column sorts episodes flat, with series/season/episode tie breakers and no season headings/context. A quiet results hint explains temporarily hidden season context; the preference is retained. Third sort click restores the default. CSV uses the same ordering and mode. Film and series sorts have separate browser preferences.

### Disk tag tooltip

_Replaced in Phase 5b._

DiskTag keeps its tag appearance, default cursor and keyboard focus. Its shared Tooltip shows disk and target/source meaning, then adaptive bytes, plural file count and positive folder count. The overflow chip opens details and describes remaining disks/sizes. Tooltip placement never changes fixed row geometry; tapping the tag must not select the row.

### Selection and bulk actions

_Replaced in Phase 5a._

Files & permissions selection includes Manual and Failed findings, excluding queued, running and succeeded jobs. Fix selected counts and sends only automatically fixable entries. Terminal commands opens whenever the filtered list has findings, showing a selection count only with a selection. Its dialog owns the left-aligned Download script for all {count} matches action, using the complete current filtered result up to 50,000 findings. Without a selection, explain this scope and omit Copy. Selected commands group at most 100 paths per command/value, with deletion taking precedence on the same path. Owner and permission commands stay distinct; links/special entries and untracked media produce review comments only. The dialog shows up to 500 lines directly, otherwise the first 50 as preview with the total; copying the complete selected script and downloading .sh remain available. There is no separate all-matches button in the results toolbar.


Library selection is the fixed first column. Header selects visible page rows; grouped TV series and season checkboxes select only visible episodes of that group, including visible season context. Tri-state counts only visible rows. Series rows use panel2/font-sm; season rows use panel with space-6 indentation. Selected rows use color-mix(in srgb, var(--accent) 8%, var(--panel)); no bold or changed border. No group-row action beyond its checkbox.

Selection clears on pagination, sorting, filter/search/preset/library/instance changes and when leaving the library. There are no invisible selected files, no selection bar, no all-matching action and no explanatory selection text. Counts remain in toolbar buttons. Explicit keys are bounded by the visible page (at most 1,000).

Toolbar: All columns → Mark for mux ({n}) → Remove mux marking ({n}) → Set tag ({n}). Selection actions remain in place, secondary and disabled without a selection (or missing MKVToolNix/no marked jobs), with explanatory titles. While any selection action processes files, all selection actions are disabled. At ≤600px, library selection actions and All columns are icon-buttons in one line beside the results heading, with count badges and full text including the count in title and aria-label. Preserve desktop ordering and disabled states; above 600px keep labeled buttons. Touch targets follow the shared control recipe. CSV exports the filtered view from the filter footer. The mux info icon remains configurable and opens Mux with a filename search.

Actions affecting multiple items use confirmation.ts with one short sentence: “You are about to {verb} {count} {objects}.” German: “Du bist dabei, {count} {Objekte} zu {Verb}.” The confirm button is only the verb; Cancel precedes it. Use confirmAction for marking/starting/tag changes and confirmDeletion for removal. Keep existing safeguards for protected jobs and destructive file fixes. Single items and Remove completed add no confirmation; tag removal retains its existing deletion confirmation.

Mux marking is sequential on the visible selection, without a separate 200-file cap. Already marked files are silently skipped. One file has no confirmation or dialog; multiple files have one short confirmation. During processing the disabled toolbar button shows a spinner and Marking … {done}/{total}. There is no progress, cancellation or result dialog. Finish with one success toast, or one warning containing success/failure counts and the first error. Unmark still skips queued/running jobs and retained backups, naming skipped counts in its outcome toast. CustomBulk still receives explicit keys and saves through its existing endpoint, with the same short confirmation style. Reload after each action without inventing hidden selections.

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

The Mux page reuses `MuxSelectionActions` with `actions={["remove"]}`, directly after Start selected in `results-tools`. It uses the same confirmation, progress, skipped-job counts and one result toast as the libraries. Running, queued and backed-up jobs cannot be removed in bulk; explain disabled selection in the tooltip. Changing search, filters, sorting or page clears the Mux selection; reloads prune it to the current page. Selection covers every visible job state so drafts can be unmarked and protected selections can be explained; Start selected still accepts only startable jobs. Clear the selection and reload after completion. Controls use `control-md` and the existing wrapping toolbar.

## Changelog of the guide

- **2.0.0.** Design system v2 (Part 1); 1.7.0 recipes kept until replaced (Part 2).

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
