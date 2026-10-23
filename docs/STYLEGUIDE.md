# Interface style guide

This guide describes how the Scopearr web interface looks and is built today, so new features reuse the same patterns instead of inventing new ones. It is written from the current code (`web/src/styles/*.css`, `web/src/components/*.tsx`).

Each section lists the current rules. Where the code is inconsistent, a **Deviation** note names what varies and a **Proposal** gives the value to standardize on. Proposals are not implemented yet. Until they are, new code follows the proposal where it does not clash with neighboring elements; otherwise it matches the surrounding screen.

All deviations are collected with IDs in [Deviations and proposals](#deviations-and-proposals).

## How to use this guide

Name a recipe when describing a feature, for example "a tool page with the standard table and row actions" or "a confirmation dialog". The recipes are:

| Recipe | Section |
| --- | --- |
| Tool page (filter panel, results, table, pagination) | [Page recipes](#page-recipes) |
| Settings section | [Page recipes](#page-recipes) |
| Standard table | [Tables](#tables) |
| Row actions | [Tables](#tables) |
| Dialog, wide dialog, confirmation | [Dialogs](#dialogs) |
| Buttons (primary, secondary, danger, icon, text) | [Buttons](#buttons) |
| Form fields, multi-select filter, check list | [Form controls](#form-controls) |
| Tags, status tags, chips, counts | [Tags and badges](#tags-and-badges) |
| Card, stat widget | [Surfaces](#surfaces) |
| Toast, notice, help popover, empty state, progress | [Feedback](#feedback) |

General rules:

- Reuse existing classes and components before adding CSS. New CSS goes into the stylesheet of the matching area (`library.css`, `placement.css`, `dialogs.css` …), never into a new "improvements" file.
- Colors come from CSS variables only. Never hard-code a hex value for interface chrome.
- All visible text goes through `t()` and is added to every catalog in `web/src/locales/` (see [TRANSLATING.md](TRANSLATING.md)).
- Every icon-only button has `aria-label` **and** `title`.
- Numbers in tables, counts and progress use `font-variant-numeric: tabular-nums` (`.nowrap` or the existing cell classes) and are formatted with `count()` / `bytes()` from `ui.tsx`.

## Foundations

### Color tokens

Defined on `:root` in `styles/base.css`; light values under `:root[data-theme="light"]`. The 17 additional interface themes in `themes.ts` override the first nine tokens per dark/light mode.

| Token | Purpose | Default dark | Default light |
| --- | --- | --- | --- |
| `--bg` | Page background, input background | `#101719` | `#f5f8f8` |
| `--panel` | Cards, panels, tables, dialogs | `#151e21` | `#fff` |
| `--panel2` | Raised/secondary surface: table header, secondary buttons, hover | `#1a2529` | `#edf3f3` |
| `--line` | All borders and dividers | `#29363b` | `#dbe5e7` |
| `--text` | Primary text | `#e5edef` | `#1d3238` |
| `--muted` | Secondary text, labels, inactive icons | `#819399` | `#617a81` |
| `--accent` | Primary action, active state, focus, links | `#7ee4c5` | `#14755c` |
| `--accent-bg` | Tinted background for active/selected items | `#1c3931` | `#e0f4eb` |
| `--accent-text` | Text on an `--accent` background | `#123429` | `#ffffff` |
| `--status-ok` | Success, ready, done | `#7ee4c5` | `#126347` |
| `--status-warn` | Warning, needs review, source disk | `#f0bf66` | `#795109` |
| `--status-wait` | Queued, waiting | `#f29b5c` | `#9a4a0b` |
| `--status-error` | Error, failed, conflict | `#f09099` | `#a33743` |
| `--status-info` | Neutral information state | `#86c5f4` | `#205f94` |
| `--shadow` | Popovers, menus, dialogs | `0 20px 80px #0007` | `0 20px 80px #19323c20` |

Usage rules:

- Hover on neutral controls: background `--panel2` or border `--muted`. Hover on accent elements: `filter: brightness(1.06)`.
- Selected/active: text `--accent`, background `--accent-bg`, border `--accent`.
- Tinted states use `color-mix(in srgb, var(--accent) 12%, var(--panel2))` rather than new colors.
- Disabled: `opacity: 0.4` (global `button:disabled`).
- Media tag colors (`.tag.resolution`, `.tag.codec` …) are a separate, fixed palette and are user-configurable; do not use them for interface states.

> **Deviation D1:** About 120 raw hex colors exist in the stylesheets outside the token block. Examples: `.toast` border colors `#31b99a`, `#e45d68`, `#dda13a`; `.danger-button svg` `#c7666e`; `.operator-button.negative` `#fa8993`; `.conflict-button` `#d9a870`; `.sync-dot` states; `.notice.error`; `.error`; `.evidence-conflict`; terminal colors.
> **Proposal:** Map every state color to a status token (`--status-error`, `--status-warn`, `--status-ok`, `--status-wait`). Keep raw colors only for the media tag palette and the terminal (`pre.terminal`), which is intentionally always dark.

### Typography

Font stack: `Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. Monospace (paths, terminal, rule textareas): `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.

Current scale in practice:

| Role | Size | Weight | Example class |
| --- | --- | --- | --- |
| Stat number | 32px (28 mobile) | 600 | `.stat-widget strong` |
| Modal title | 19px | 550 | `.modal-heading h2` |
| Page title | 18px (16 mobile) | 600 | `.library-intro h1` |
| Section title | 18px | 600 | `.settings-section-heading h2` |
| Results title | 16px | 550 | `.results-heading h2` |
| Card title | 14–15px | 600 | `.distribution-title h3`, `.card-title` |
| Group heading | 13px | 550 | `.filter-groups h2`, `.placement-panel h3` |
| Form text, inputs | 13px | 400 | `input`, `select`, `label` |
| Body, table cells, buttons | 12px | 400 (buttons 550) | `table`, `.button`, `.notice` |
| Secondary text | 11–12px | 400 | `small`, `.quiet`, `.field-label` |
| Tags, chips, footer | 10px | 500 | `.tag`, `.filter-chip`, `.pagination` |
| Table header | 9px uppercase, `letter-spacing: 1px` | 500 | `th` |

Text colors: `--text` for content, `--muted` for labels, hints, counts and secondary lines. Line height 1.5–1.6 for running text.

> **Deviation D2:** 23 different font sizes (8–36px, plus two `rem` values) and five weights (400, 500, 550, 570, 600).
> **Proposal:** Scale `10 / 11 / 12 / 13 / 15 / 18 / 32` px. Map 9→10 (table headers stay uppercase), 14/16/17/19→15 or 18 by role, 20/21/24→18. Weights: 400 regular, 500 medium (labels, table titles), 600 semibold (headings, buttons). Replace 550/570 with 600 for headings and 500 for buttons. Replace the `rem` values in `presentation.css`.

### Spacing

Spacing is in pixels. Common values: gaps 6–12px inside controls, 16–24px between blocks; card padding 20px (16px on mobile); page gutter 24px (16px on phones).

> **Deviation D3:** Almost every value from 2 to 25px appears (gaps of 5, 7, 9, 11, 13, 15 px next to 4, 8, 12, 16).
> **Proposal:** 4px grid: `4 / 8 / 12 / 16 / 20 / 24 / 32`. Inside a control 8px between icon and label; between sibling controls 8px (toolbar) or 12px (form row); between blocks 16px; between page sections 24px.

### Corner radius

| Element | Current |
| --- | --- |
| Checkbox-like small items, filter count, `.filter-operator` | 4px |
| Tags, chips, count badges, menu items | 5–6px |
| Inputs, selects, buttons, notices | 7px |
| Popovers, menus, connection fieldsets, filename box | 8px |
| Table wrap, connect card, recognition guide | 9px |
| Filter panel, stat widget, distribution card, storage path | 10px |
| Settings cards, toasts, service logo | 12px |
| Modal | 14px |

> **Deviation D4:** Nine different radii; comparable surfaces differ (table wrap 9, filter panel 10, settings card 12).
> **Proposal:** Four steps: `5px` small (tags, chips, badges, menu items), `7px` control (inputs, buttons, notices, popovers), `10px` surface (panels, cards, table wrap, toasts), `14px` modal. Circles stay `50%`.

### Elevation and layering

Only floating elements get a shadow (`var(--shadow)`): popovers, menus, dialogs. Cards and panels are flat with a 1px `--line` border. Toasts use `0 8px 30px #0003`.

Z-index in use: popovers 10, filter panel 2, menus/tooltips 35–40, toasts 10000. Dialogs use the native `<dialog>` top layer.

### Breakpoints

| Width | Effect |
| --- | --- |
| ≥ 1600px | Header and main get centered fixed padding |
| ≤ 1120px | Gutter 24px, footer stacks, local status hidden |
| ≤ 900px | Filter groups stack to one column, settings tabs become a row |
| ≤ 740px | Header becomes two rows, tables get 13/15px cell padding, filter footer stacks |
| ≤ 600px | Phone layout: gutter 16px, single-column grids, smaller titles |
| `pointer: coarse` | Touch targets 44px for menus and operator buttons |

> **Deviation D5:** Also used: 650, 700, 800, 850, 1000, 1100px.
> **Proposal:** Only `1120 / 900 / 740 / 600` (plus `min-width: 1600px` and `pointer: coarse`). Map 1100→1120, 1000/850/800→900, 700/650→740 or 600 by intent.

## Icons

- Library: `lucide-preact` only, imported per icon (`import { Trash2 } from "lucide-preact"`). Default stroke width. No emoji, no remote images; language flags are local SVGs (`LanguageFlag.tsx`).
- Color: icons inherit `currentColor`. Icons that mark a heading, card or empty state use `--accent`; inactive icons use `--muted`.
- Spinner: `<LoaderCircle class="spin" />`.

Sizes by context:

| Context | Size |
| --- | --- |
| Remove "x" inside a filter chip | 12 |
| Sort arrows in table headers | 13 |
| Inside `.button` / `.primary` with a label | 15 |
| Row action buttons (`.row-icon.info-action`) | 15 |
| `.icon-button` in toolbars, pagination, dialog actions, help popovers | 16 |
| Large icon buttons in the filter row (summary, collapse) | 18 |
| Modal close | 20 |
| Empty state illustration | 28 |

> **Deviation D6:** Sizes 14 and 17 are also common (`Search` 17, `Eye`/`EyeOff` 17, `CircleHelp` 17, `Info` 14, `ArrowUp`/`ArrowDown` 14), and the same icon/context sometimes uses 15 or 16 (`Trash2`, `Plus`, `Pencil`).
> **Proposal:** Only the sizes in the table above. 17→16 (field icons like `Search` and password reveal), 14→15 (or 13 for inline arrows). Labeled buttons always 15, icon-only buttons always 16.

Meaning of icons (use these; do not pick alternatives for the same action):

| Action / meaning | Icon |
| --- | --- |
| Delete, remove | `Trash2` |
| Edit | `Pencil` |
| Add | `Plus` |
| Close, remove chip | `X` |
| Reset to default, reset filters | `RotateCcw` |
| Refresh, sync (spins while running) | `RefreshCw` |
| Start, run | `Play` |
| Stop, cancel running work | `Square` |
| Scan | `ScanSearch` |
| Confirm, success | `Check` |
| Download / export | `Download` |
| Copy | `Copy` |
| Details | `Info` |
| Help text | `CircleHelp` |
| Notice / caution help | `CircleAlert` |
| Warning | `AlertTriangle` |
| Log / terminal output | `Terminal` |
| Summary | `ClipboardList` |
| Search | `Search` |
| Expand/collapse (rotate with `.rotated`) | `ChevronDown` |
| Previous/next page (pagination) | `ArrowLeft` / `ArrowRight` |
| Step between items inside a widget | `ChevronLeft` / `ChevronRight` |
| Sort | `ArrowDownUp`, `ArrowUp`, `ArrowDown` |
| Column settings | `Columns3` |
| Filters | `SlidersHorizontal` |
| Disk, storage | `HardDrive` |
| Show/hide secret | `Eye` / `EyeOff` |

## Buttons

All buttons are `<button>` with an explicit `type="button"` inside forms. Icon first, then label.

| Variant | Class | Look | Use |
| --- | --- | --- | --- |
| Primary | `primary` (or `button primary`) | Accent background, `--accent-text` | The one main action of an area: Save, Scan, Start |
| Secondary | `button` | `--panel2` background, `--line` border | All other labeled actions |
| Danger | `button danger-button` | Secondary + red icon | Destructive labeled action; always confirmed |
| Icon | `icon-button` | Transparent, `--muted` icon, hover `--panel2` | Toolbars, pagination, close, help |
| Icon danger | `icon-button danger-button` | Red icon | Delete in a list or table |
| Icon success | `icon-button success-button` | Accent icon | Remove a finished item |
| Text | `text-button` | No frame, 11px muted, hover accent | Low-priority links in footers |
| Row action | `row-icon info-action` | 29×29 framed square | Per-row actions in tables |

Sizes (current):

| Element | Height | Padding | Font |
| --- | --- | --- | --- |
| `.primary`, `.button` | min 38px | 9px 13px | 12px / 550 |
| `.button` in results toolbar on phones | 34px | 8px 10px | 10px |
| `.icon-button` | min 34×34px | 8px | — |
| Icon button in the filter row | 42px | — | — |
| `.filter-footer-tools` icon buttons | 32×32px | 0 | — |
| Pagination icon buttons | 28×28px | 5px | — |
| `.row-icon.info-action` | 29×29px | 0 | — |
| Inline help / toast close | 24×24px | 3px | — |

Rules:

- At most one primary button per panel, toolbar or dialog.
- Labels are short verbs in sentence case ("Start all", "Remove moved items"). A selection count is appended in parentheses: "Start selected (3)".
- Destructive actions use `confirmDeletion()`; other irreversible actions use `confirmAction()`; resets use `confirmReset()`; leaving unsaved changes uses `confirmDiscard()` (all in `confirmation.ts`).
- Disabled buttons keep their place; explain why with `title` when it is not obvious.

> **Deviation D7:** Eight control heights (24, 28, 29, 30, 32, 34, 38, 42px) for buttons that often sit next to each other; a 38px button next to a 42px input in the filter row needs local overrides (`.placement-panel .preset-toolbar button { min-height: 42px }`).
> **Proposal:** Three control sizes. **Large 42px** for everything in a form/filter row (inputs, selects, buttons, icon buttons next to fields). **Medium 34px** for toolbar buttons and standalone icon buttons (`.button` drops from 38 to 34 outside form rows). **Small 28px** for icon buttons inside tables, lists and pagination (`.row-icon.info-action` 29→28, `.column-move-tools` 30→28, filter footer 32→28). Inline help and toast close stay 24px.

> **Deviation D8:** Danger color is hard-coded (`#c7666e` / `#a33743`) and only colors the icon.
> **Proposal:** `.danger-button svg { color: var(--status-error) }`; on hover also `border-color: var(--status-error)`.

## Form controls

Fields are wrapped in a `<label>` that stacks the caption above the control (`display: flex; flex-direction: column; gap: 9px`). The caption is a `<span>` (12px, `--muted`, 500).

| Control | Class / markup | Current specs |
| --- | --- | --- |
| Text, number, password | `<input>` | height min 42px, padding 11px 12px, 13px, radius 7, background `--bg`, border `--line`; focus border `--accent` + 2px accent outline at 15% |
| Search | `.input-wrap` with `<Search size={17}/>` before the input | Icon absolute at 12px, input padding-left 38px |
| Password with reveal | `.password-reveal-field` + `.password-reveal` icon button | 32×32 button inside the field |
| Field with unit | `.input-suffix` | Input + unit text, gap 9px |
| Native select | `<select>` | 42px, custom chevron, padding-right 40px |
| Multi-select filter | `MultiFilter` (`.select-button` + `.select-popover`) | Looks like a select; selected state accent text and border; popover `--panel2`, radius 8, max 300px high |
| Include/exclude operator | `OperatorButton` (`.operator-button`) | 42×36px, accent symbol; negative is red |
| Checkbox / radio row | `<label class="check-field">` | Row, gap 9px, 12–13px text; checkbox 15px, radio 16px, `accent-color: var(--accent)` |
| Checkbox list with counts | `FilterCheckList` (`ToolFilters.tsx`) | `h3` + `.check-field` rows + `.filter-count` |
| Textarea | `<textarea>` | padding 10px, radius 6, monospace for rules/paths |
| Label with help | `.field-label-row` + `HelpPopover` | Caption left, help icon right |

Layout: forms use `display: grid` with `gap: 14–18px`; two-column grids (`repeat(2, minmax(0, 1fr))`) collapse to one column at 600px. Always set `min-width: 0` on grid children with inputs.

> **Deviation D9:** Checkbox 15px vs 16px (radio, recognition table, color table); textarea radius 6 vs inputs 7; compact inputs in the mux track table use 30px height and `rem` padding.
> **Proposal:** Checkbox and radio 16px everywhere. Textarea radius 7. Compact in-table inputs 28px (the small control size from D7).

## Tables

### Standard table

Markup:

```tsx
<div class="table-wrap my-table-wrap">
  <table class="my-table">
    <thead>
      <tr>
        <SortableHeader label={t("Title")} active={…} direction={…} onSort={…} />
        <th scope="col">{t("Status")}</th>
      </tr>
    </thead>
    <tbody>…</tbody>
  </table>
</div>
```

| Part | Current specs |
| --- | --- |
| Wrapper `.table-wrap` | Border `--line`, radius 9, background `--panel`, horizontal scroll, min-height 220px (set `min-height: 0` for short tables). Add `.busy` while reloading (opacity 0.55) |
| `table` | width 100%, 12px, `border-collapse: collapse`, `min-width` per table (690–1100px) so narrow screens scroll instead of squeezing |
| `th` | 9px, uppercase, `letter-spacing: 1px`, 500, `--muted`, background `--panel2`, padding 14px 20px, no wrap, `scope="col"` |
| Sortable header | `SortableHeader` component: label + 13px arrow; active column accent; sets `aria-sort`; cycle asc → desc → default |
| `td` | padding 16px 20px (13px 15px ≤ 740px), `border-top: 1px solid var(--line)`, vertically centered |
| Row hover | background `--panel2` at 60% |
| Disabled/context rows | text `--muted` or `opacity: 0.5` |

Column order for tool tables (as in disk placement, file check, mux):

1. **Select** – checkbox, header checkbox selects all visible rows (supports `indeterminate`).
2. **Actions** – `.info-actions` with `.row-icon.info-action` buttons (Info, Play, Terminal …), 15px icons, gap 6px.
3. **Title** – title on the first line, path or episode on a second muted `small` line.
4. Data columns – sizes via `bytes()`, counts via `count()`, `—` for empty values.
5. **Status** – a status tag inside a borderless `.mux-status-button` that opens details.
6. **Progress** – `.col-progress` (150px): `<progress>` 6px high + percentage.
7. **Remove** – `.col-remove` (80px, centered): icon button, only when the row can be removed.

Below the table: `.pagination` (count left, previous / "Page x / y" / next right). Above it: `.results-heading` (see [Tool page](#tool-page)). When the table has no rows, render an `.empty-state` instead of the table.

Compact settings tables (`.color-settings-table`, `.dashboard-settings-table`) use `table-layout: fixed`, 10–12px cell padding and right-aligned narrow columns.

> **Deviation D10:** Uppercase headers are set per table (`.mux-table th`, `.placement-table th`, `.column-sort`), while the global `th` is not uppercase.
> **Proposal:** Make `th` uppercase globally and remove the per-table copies.

> **Deviation D11:** Title cells differ: the library uses `.title-line b` (500), tool tables use `<strong>` (bold) with `.placement-relative`; secondary lines use `.placement-relative`, `.episode-filename`, `.context-label` or plain `small`.
> **Proposal:** Title `<strong>` at weight 500; secondary line `<small class="cell-sub">` (block, 11px, `--muted`, margin-top 4px, wraps anywhere). Keep the library's row icon as an optional leading element.

> **Deviation D12:** Status tag classes are named `mux-status-*` but are reused by disk placement and file check.
> **Proposal:** Rename to neutral `status-*` (`status-ok`, `status-warn`, `status-wait`, `status-error`, `status-running`, `status-neutral`) mapped to the status tokens.

> **Deviation D13:** `.mux-track-table` uses `rem` padding and `border-bottom` instead of the standard cell borders.
> **Proposal:** Use the compact settings-table spec.

### Row actions

- Always the second column (after select), never at the end, except the single "remove" action.
- Up to three row icon buttons; more actions go into the details dialog.
- Each button: `aria-label` naming the row ("Details for {title}") and a short `title` ("Details").
- Hover: accent icon and border.

## Tags and badges

| Element | Class | Current specs | Use |
| --- | --- | --- | --- |
| Tag | `.tag` | 10px / 500, padding 6px 8px, radius 5, 1px border | Base for all tags |
| Media tags | `.tag.resolution`, `.r2160p`, `.r720p`, `.codec`, `.source`, `.processing`, `.hdr`, `.audio`, `.unknown`, `.custom` | Fixed palette, light variants in `responsive.css`, user colors via `TagColors` | Media metadata only |
| Status tag | `.tag.mux-status-<state>` | Text and border in status color, background `--panel` | Job/scan state |
| Running status | `.tag.mux-status-running` | Filled accent | Work in progress |
| Disk tag | `.tag.placement-disk-tag` / `-source` (warn) / `-target` (accent) | | Disk placement |
| Filter chip | `.filter-chip` | Accent text on `--accent-bg`, 10px, radius 5, `X` 12px; excluded variant amber | Active filters, click removes |
| Count badge | `.filter-count`, `.results-heading h2 > span`, `.tabs button > span` | 10–11px, `--panel2`, radius 4–5, tabular numbers | Counts next to labels |
| Tag list | `.tag-list` / `.source-tags` | flex, gap 6px, wrap | Several tags in one cell |

Status color mapping: done/ready → `--status-ok`; warning/needs review → `--status-warn`; queued/waiting → `--status-wait`; failed/conflict → `--status-error`; neutral info → `--status-info`; draft/cancelled → `--text` on `--panel2`; running → filled `--accent`.

## Surfaces

| Surface | Class | Current specs |
| --- | --- | --- |
| Filter/tool panel | `.filter-panel.filter-panel-v2` | `--panel`, border, radius 10, padding 20 (16 mobile), margin-bottom 28 |
| Settings card | `.settings-card`, `.settings-content .connection` | `--panel`, border, radius 12, padding 20 (16 mobile) |
| Fieldset group | `.connection` (as `<fieldset>`) | border, radius 8, padding 18, gap 16, `legend` 13px / 550 with accent icon |
| Stat widget | `.stat-widget` | `--panel`, radius 10, padding 21, 32px number, accent icon |
| Dashboard card | `.distribution-card` | `--panel`, radius 10, padding 21 |
| Inner box | `.filename-box`, `.storage-path`, `.external-tag-conflict` | border, radius 8–10, padding 12–18 |

Inside cards, sub-sections are separated by `border-top: 1px solid var(--line)` with 16px padding-top, not by nested cards.

> **Deviation D14:** Card padding 14, 16, 18, 20 and 21px; radius 8–12px.
> **Proposal:** Surface padding 20px (16px ≤ 600px), radius 10px (D4). Nested boxes padding 12px, radius 7px.

## Dialogs

Use the `Modal` component (`components/Modal.tsx`). It renders a native `<dialog>`, handles Escape, backdrop click, focus and stacking, and adds the title and a close button (`X` 20px).

| Variant | Width | How |
| --- | --- | --- |
| Default | 450px | `<Modal title close>` |
| Wide | 780px | `wide` |
| Extra wide (tables) | 900–1100px via `className` and `width: min(…px, calc(100vw - 28px))` | e.g. `.mux-options-dialog` |

Specs: `--panel`, radius 14, padding 25 (20 ≤ 740px), `--shadow`, backdrop `#071011b8` with 5px blur, max-height `100dvh - 50px` with internal scroll. Title 19px / 550. Body content: `form` with `gap: 16px`, sections separated by `border-top`.

Confirmation dialogs are not built by hand: call `confirmAction()`, `confirmDeletion()`, `confirmReset()` or `confirmDiscard()`. They render Cancel (`.button`) on the left and the confirm button on the right (primary, or `button danger-button` with `Trash2` for deletion).

> **Deviation D15:** Three footer patterns: `.modal-actions` (space-between), `.dialog-actions` (flex-end, gap 10) and `.row-actions` (wrapping row).
> **Proposal:** One `.modal-actions` footer: right-aligned, gap 8px, margin-top 16px; Cancel first, primary/danger last. A secondary tool action (e.g. "Test connection") may sit on the far left with `margin-right: auto`.

## Feedback

| Element | How | Specs / rules |
| --- | --- | --- |
| Toast | `notify(message, "success" \| "warning" \| "error")` | Bottom right, max 420px, `--panel`, radius 12, 4px colored left border; for results of actions |
| Inline notice | `<p class="notice">`, `.notice.error`, `.notice.success` | `--panel2`, radius 7, padding 13px 16px, 12px muted; `role="alert"` for errors; for persistent state on the page |
| Help popover | `<HelpPopover label text variant>` | `help` (CircleHelp), `info` (Info, untranslated dynamic text), `notice` (CircleAlert); 16px icon, tooltip max 340px |
| Simple tooltip | `title` attribute | For icon buttons and disabled states |
| Empty state | `.empty-state` with icon (28px, accent), `h3`, `p`, optional `.button` | Centered, padding 55px 20px |
| Loading | `<LoaderCircle size={14} class="spin" />` next to the results title; `.table-wrap.busy` while reloading | No full-page spinners after first load |
| Progress | `<progress>` | 6px high, `accent-color: var(--accent)`; label beside it with tabular numbers |
| Live updates | `aria-live="polite"` on progress footers | |

Toasts confirm that an action finished; notices describe a condition that remains (missing setup, scan error). Do not show both for the same event.

## Navigation

| Element | Class | Use |
| --- | --- | --- |
| Main tabs | `.tabs` in the header | Top-level areas; active tab has accent icon and 2px accent underline |
| Menu tab | `NavMenu` (`.nav-menu`, `.nav-menu-list`) | Areas with subpages (Movies, TV, Tools); items 38px (44px on touch) |
| Settings sections | `.settings-tabs` | Vertical list at 210px, row ≤ 900px; active = accent border/text on `--accent-bg` |
| Segmented control | `.statistics-scopes` | 2–5 mutually exclusive views in a framed group; active `--panel2` + accent text |
| Instance tabs | `.service-instance-tabs` | One button per configured service instance, horizontal scroll |

## Page recipes

### Tool page

Reference implementation: `DiskPlacementPage.tsx`. Also used by file check and mux.

```
.library-intro          h1 (18px) + muted summary span
.filter-panel.filter-panel-v2[.collapsed]
  .filter-always-visible   [search field] [primary action] [icon tools: summary, collapse]
  .filter-groups           2–4 <section class="attribute-filters"> each with h3 + .placement-options
  .filter-footer           progress while work runs (aria-live)
  ActiveFilterBar          chips | reset + HelpPopovers
.notice (optional)       errors from the last action/scan
.library-section
  .results-heading        h2 + count badge + spinner | .results-tools (secondary buttons)
  .table-wrap > table     standard table, or .empty-state
  .pagination
```

Rules: the primary action sits in the filter row; bulk actions on results sit in `.results-tools` as secondary buttons; filter groups are separated by vertical lines and stack below 900px.

### Settings section

```
.settings-section-heading   h2 (18px) + optional action button right + .quiet description below
.settings-card / fieldset.connection   one per topic, stacked with gap 18px
  .card-title or legend      icon + title
  fields in a 1- or 2-column grid
  sub-sections separated by border-top
```

Saving follows the existing settings form; destructive resets use `confirmReset()`.

## Accessibility and behavior

- Focus is always visible: browser outline with `outline-offset: 4px`, inputs get an accent outline.
- Icon-only controls: `aria-label` + `title`. Toggles: `aria-expanded` + `aria-controls`. Sort headers: `aria-sort`.
- Touch: minimum 44px targets under `pointer: coarse` for menus and small controls.
- Motion: animations are disabled under `prefers-reduced-motion`.
- High contrast: native selects fall back to `appearance: auto` under `forced-colors`.
- Long paths and names use `overflow-wrap: anywhere`; titles may wrap, numbers and tags do not.

## Deviations and proposals

| ID | Area | Today | Proposal |
| --- | --- | --- | --- |
| D1 | Colors | ~120 raw hex values outside tokens | State colors via `--status-*`; raw values only for media tags and terminal |
| D2 | Typography | 23 sizes, 5 weights | `10/11/12/13/15/18/32` px; weights 400/500/600 |
| D3 | Spacing | Nearly every value 2–25px | 4px grid `4/8/12/16/20/24/32` |
| D4 | Radius | 4, 5, 6, 7, 8, 9, 10, 12, 14 | `5` small, `7` control, `10` surface, `14` modal |
| D5 | Breakpoints | 11 widths | `1120/900/740/600` + 1600 + coarse |
| D6 | Icon sizes | 12–32 incl. 14/17, same icon in different sizes | `12/13/15/16/18/20/28` by context |
| D7 | Control heights | 24–42px, eight heights | Large 42, medium 34, small 28 (+24 inline) |
| D8 | Danger buttons | Hard-coded red icon | `--status-error` for icon and hover border |
| D9 | Form controls | Checkbox 15/16, textarea radius 6, compact inputs 30px | 16px checks, radius 7, compact 28px |
| D10 | Table headers | Uppercase set per table | Global uppercase `th` |
| D11 | Title cells | `b`, `strong`, four secondary-line classes | `strong` 500 + `small.cell-sub` |
| D12 | Status tags | `mux-status-*` reused everywhere | Neutral `status-*` classes |
| D13 | Track table | `rem` padding, own borders | Compact settings-table spec |
| D14 | Cards | Padding 14–21, radius 8–12 | Padding 20/16, radius 10; nested 12/7 |
| D15 | Dialog footers | `.modal-actions`, `.dialog-actions`, `.row-actions` | One right-aligned `.modal-actions` |
| D16 | Stylesheets | `improvements.css`, `interface-v2.css`, `presentation.css` override earlier files; unused `.intro`, `.eyebrow` | Move rules into the area stylesheets, add tokens for radius/spacing/sizes in `base.css`, delete unused rules |

Suggested order when standardizing: tokens first (D1–D5 as CSS variables in `base.css`), then icons and controls (D6–D9), then tables and tags (D10–D13), then surfaces and dialogs (D14–D15), and the stylesheet cleanup (D16) alongside. Each step should be checked in light and dark mode, in at least two interface themes and at 600px width.
