# Interface style guide

Scopearr 1.4.2 uses one visual language throughout the app: login, libraries, tools, statistics, settings and every dialog. This guide describes the implemented interface. Reuse these tokens, components and recipes before adding CSS. Update this guide before introducing a new shared value or pattern.

## Tokens

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
--touch-target: 44px;
--toast-shadow: 0 8px 30px #0003;
```

The --layout-1 token is reserved for the clipped .sr-only accessibility helper.

Structural `--layout-*` tokens preserve intrinsic image and flag geometry, chart dimensions, header height, dialog/popover widths, scroll limits, focus outlines and positioning. They are not an alternative typography, spacing, radius or control scale. Add structural tokens only for those purposes. `--backdrop`, `--letter-spacing` and `--progress-height` cover shared dialog, header and progress geometry. Tool columns and rows use the named `--tool-col-*` and `--tool-row-height*` tokens in `base.css` and the column model in `tool-table.ts`.

Exceptions: zero, 1px borders, percentages and intrinsic layout ratios, media tag palettes, the intentionally dark terminal, table column geometry, media query thresholds, and the 28px mobile stat number. Do not turn ordinary gaps or control heights into structural tokens.

### Colors

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

Use `color-mix(in srgb, var(--status-warn) 12%, var(--panel))` for tinted states. Hover uses `--panel2` or `--muted` borders; accent actions brighten slightly. Disabled controls retain their space with opacity 0.4. Raw colors remain only in token definitions, marked fixed media-tag palettes and the terminal. Custom media/tag warning colors remain user preferences.

### Typography

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

### Spacing, surfaces and breakpoints

Icon to label: `--space-2`. Toolbar siblings: `--space-2`; form rows: `--space-3`; form grids and blocks: `--space-4`; page sections: `--space-6`. Page gutters are `--space-6` and `--space-4` on phones.

| Surface | Radius | Padding |
| --- | --- | --- |
| Tag, chip, count, menu item | small | by recipe |
| Input, button, textarea, notice, popover, menu, inner box | control | by recipe; inner boxes `--space-3` |
| Filter panel, table wrapper, settings card, fieldset, widget, toast | surface | `--space-5` (`--space-4` on phones) |
| Modal | modal | `--space-6` (`--space-4` at ≤740px) |

Circles remain 50%. Cards are flat with a 1px `--line` border. Only floating elements have shadows. Popovers use z-index 10, menus/tooltips 35–40, toasts 10000. Native dialogs use the top layer.

Width breakpoints use 1120 / 900 / 740 / 600px and min-width 1600px. Settings use min-width 1120px for the widget overview; Lists & columns is one full-width card. Keep one block per threshold in each stylesheet, widest first. Other supported queries: pointer coarse, reduced motion, forced colors. Settings navigation and filter groups stack at 900px; phone grids collapse at 600px.

## Icons

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
| Log, summary, search | Terminal, ClipboardList, Search |
| Expand, pagination, widget navigation | ChevronDown, ArrowLeft/ArrowRight, ChevronLeft/ChevronRight |
| Sort, columns, filters | ArrowDownUp/ArrowUp/ArrowDown, Columns3, SlidersHorizontal |
| Storage, reveal/hide secret | HardDrive, Eye/EyeOff |
| Mark/unmark mux, mux info | Scissors, CircleMinus, Scissors |

Every icon-only button has both an accessible label naming the affected item and a pointer tooltip (`title`).

## Buttons

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

Keep labels short, sentence case, with selected counts in parentheses. Destruction uses `confirmDeletion()`, irreversible actions `confirmAction()`, resets `confirmReset()`, and unsaved changes `confirmDiscard()`. Explain non-obvious disabled states in `title`.

## Form controls

Labels stack caption and control with `--space-2`; label text is muted. Input/select height is large; control radius, `--bg` background, line border, accent focus. Native selects use the existing chevron; forced-colors restores native appearance. `.input-wrap` reserves space for the search icon. `.password-reveal-field` keeps the reveal button inside the field. `.input-suffix` holds a unit beside the input.

Checkboxes and radios have one global size rule: `--checkbox` for width, height, min-width and flex basis, with margin zero. Never add local checkbox size rules. `.check-field`, MultiFilter options, column options and tool checklists align to the first text line with `margin-top: calc((1.5em - var(--checkbox)) / 2)`; labels use `--font-sm`. Inputs never shrink, even with long labels.

`MultiFilter` uses `.select-button` / `.select-popover`; operator controls select include/exclude behavior. A share filter is include-only and may show per-value counts. `FilterCheckList` provides a heading, checkbox rows and count badges. Textareas use control radius; compact track-table inputs use the small height.

Form grids use `--space-4`, collapse at 600px, and set `min-width: 0` on field children.

## Tables

### Standard table and row actions

Use `.table-wrap > table`, `th scope="col"`, and `SortableHeader` for sortable columns. Sorting cycles ascending → descending → default and exposes `aria-sort`. Headers use the global uppercase recipe. Cells use `--space-4 --space-5` (compact mobile: `--space-3 --space-4`), a line border and vertically centered content. Table wrappers use surface radius; standard columns fit without horizontal scrolling from 1440px in all four languages. Smaller screens may scroll. Empty tables render `.empty-state`.

Title: `<strong class="cell-title">` at medium weight; secondary line: `<small class="cell-sub">`, muted, `--font-xs`, margin-top `--space-1`. Library rows retain their leading icon. Full paths remain available in tooltips and details.

Inspection/start actions (details, start, log, options) follow selection. Edit and delete/remove actions always occupy the last column, right-aligned. `.info-actions` holds up to three `.row-icon.info-action` controls with `--space-2` gaps. Extra actions belong in details. Compact settings/color/track tables reuse standard borders; track cells use `--space-2 --space-3`.

### Stable tool tables

Disk placement, files/permissions and mux use `.tool-table`, `table-layout: fixed` and a colgroup. `toolTableStyle()` computes minimum width from the selected columns; the title receives at least 200px. Selection is 40px; action width is 24 + n × 28 + (n − 1) × 8; removal 52px; service/status/progress 120px. Title receives the remaining width with a 200px minimum. `toolTableStyle()` measures translated uppercase labels using the actual font, size and letter spacing, sort icon and padding; every column receives the larger of content minimum and header width. Widths never depend on rows. See `toolColumnWidths` for other minima.

Rows are 64px, 56px at ≤740px. Titles clamp to two lines, paths/subtitles to one ellipsized line. Data columns do not force new line wrapping after a removal. Disk tags wrap side by side; show two plus a details chip for remaining disks. Details retain all disks and sizes.

At ≤600px the action column shows Details; start/fix, terminal and mux options stay available in the details footer with their existing handlers and confirmations. Selection stays accessible. Removing an entry affects its own spinner/fade only; a failed request restores it. Reduced motion disables the fade. Slow reload indication is delayed 300ms.

### Counts and numbers

Page summary: **open entries**, with `title="Open items"`. Results badge: total rows in the filtered list, matching pagination, with `title="Items in the list"`. Pagination: `{from}–{to} of {total}`. Tools menu badges count queued/running/failed jobs; unstarted scan findings, succeeded and cancelled jobs do not count. Mux drafts/ready jobs count as open.

Use `count()` or translated numeric `count` parameters for localized integers, `bytes()` for adaptive decimal B/kB/MB/GB/TB, `percent()` for localized percentages with a narrow nonbreaking space, and `—` for unavailable values. Counts and progress use tabular numerals. `t()` selects `|one` / `|other` through Intl.PluralRules before formatting numeric counts; legacy messages remain a fallback.

## Tags and badges

Tags use `--font-2xs`, medium weight, small radius. Media palettes are fixed/user-configurable and are separate from interface states. `.filter-chip` uses accent; excluded filters use warn. Counts use `.filter-count`. Tag lists wrap with `--space-2`.

Status classes are neutral: `status-ok`, `status-warn`, `status-wait`, `status-error`, `status-info`, `status-running`, `status-neutral`. Ready/succeeded → ok; review/warning/no-space → warn; queued → wait; failed/needs-attention/actionable conflict → error; informational split → info; running → filled accent; draft/cancelled → neutral. `.status-button` opens details without a separate button frame. Disk targets use accent and sources warn.

## Dialogs and detail lists

Use `Modal`, which wraps native dialog behavior, Escape, backdrop click, focus and stacking. Default width 450px; wide 780px; table dialogs may use existing 900–1100px structural widths. Dialogs scroll within the viewport and use the common backdrop and shadow.

One footer: `.modal-actions`, right-aligned, gap `--space-2`, margin-top `--space-4`. Cancel/Close precedes the primary/danger action. A secondary tool action may sit at the far left using margin-right auto. Tool actions inside a dialog body are ordinary toolbars, not footers.

Details use `<dl class="key-values"><div><dt>Label</dt><dd>Value</dd></div></dl>`: columns `minmax(140px, 1fr) 2fr`, muted extra-small label, small regular value, line separators and no label indentation. Apply the same recipe in system and MKVToolNix settings. A disk value uses `DiskTag`.

## Feedback

| Element | Recipe |
| --- | --- |
| Toast | `notify(message, "success" | "warning" | "error")`; surface radius, status left border, toast shadow; action results |
| Persistent condition | `.notice` with small body text and optional CircleAlert; error notices have role alert; setup notices link to the relevant settings |
| Help | `HelpPopover` with help/info/notice variants and 16px icon |
| Empty state | `.empty-state`, 28px accent icon, heading, explanation, optional action |
| Loading | Spinner beside results title; delayed `.table-wrap.busy`; retain existing content |
| Progress | Existing progress bar, tabular label and `aria-live="polite"` footer |

Toasts report finished actions; notices describe conditions. Avoid reporting the same event through both. Root coverage shows missing mappings first, with verified suggestions and manual setup links; saved mappings highlight the manual Scan action. Three consecutive status failures show one connection notice while retaining the current authenticated view; recovery clears it.

## Navigation and page recipes

### Tool page

`.library-intro` (h1 + open count) → `.filter-panel.filter-panel-v2` → `.notice` if needed → `.library-section` with results heading, table/empty state and pagination.

Use the Shared filter panel recipe below. Scan and progress belong beside results; root diagnostics appear above results.

### Settings section

`.settings-section-heading` (h2 and Save action, description in the following row at space-1) → `.settings-card` / `fieldset.connection` per topic, stacked with `--space-4`. Each card uses a card title/legend, 1–2 column form grids and border-top subsection separators. Keep every setting and its confirmation accessible. Navigation uses `--font-md`, active accent border/text/background, vertical at desktop and wrapping at ≤900px. All six settings sections align their heading with the first navigation entry. The settings-content grid owns space-4 between descriptions, tabs and cards, with no duplicated margins. Service tabs and adjacent Add action share a row. Saving follows the existing form; resets use `confirmReset()`.

### Navigation, accessibility and behavior

Main `.tabs` and `NavMenu` use active accent indication. Nav menus open on click, support arrows, Home/End and Escape. `SegmentedTabs` controls choose mutually exclusive scopes. Preserve the current library/tool/instance/page through session expiry using optional sessionStorage.

Keyboard focus remains visible with an offset outline; toggles expose expanded/controls, sorting exposes aria-sort. Small touch targets expand invisibly. Reduced motion disables animations. Long content remains readable or available in full through details/tooltips. Colors remain token-based in light, dark and all additional palettes.

## Wording

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

Use the same terms in all four catalogs. German instructions address the user in the imperative (Du). Help sentences end with a period; labels/headings/buttons do not. Ellipses use a leading space and the character ` …`. Status tags retain their specific result (Moved, Fixed, Succeeded), while cleanup buttons use Remove completed. All visible text uses `t()` and exists in every catalog; see [TRANSLATING.md](TRANSLATING.md).

## Stylesheet ownership

Import order: base → navigation → library → dialogs → login → dashboard → settings-and-filters → recognition → placement → responsive. A non-media selector has exactly one owning stylesheet; `web/test/stylesheet-ownership.test.mjs` enforces this. No unexplained cross-file duplicates are allowed. Add rules to the matching area, merge existing selectors and group media queries. Never add another improvements or override stylesheet. Remove unused rules only after checking static and dynamically constructed classes.

## Floating surfaces

Every floating tooltip, popover and menu uses `.floating-surface`: panel2 background, text foreground, line border, control radius and the shared shadow. Do not add local surface colors or shadows. Only floating surfaces, modals and toasts use shadows (a user-selected flag outline is a border effect).

`Tooltip` from `ui.tsx` wraps a trigger, supplies role tooltip and aria-describedby, opens after 150ms hover or immediately on keyboard focus, closes on Escape, and toggles on coarse-pointer taps. Outside taps close it. Its fixed position flips above/below and stays inside the viewport. `.tooltip` uses space-2/space-3 padding, font-sm, line-height 1.5, a 340px structural maximum width bounded by viewport minus space-8, pointer-events none and z-index 40. Offset: space-2. Flags, operators, filenames and disk tags reuse it. Interactive/long help uses HelpPopover (space-4), other popovers space-3. Menus use space-1 and small-radius entries.

## Shared filter panel

All five library/tool pages use `FilterRow`: labeled search, 200px preset choice, save/delete preset icons, collapse icon. Only this row and ActiveFilterBar remain visible when collapsed. Expanded filter-groups sit between them and have space-5 bottom padding. ActiveFilterBar owns the fixed footer order: Reset when active → tools → info → help, with named slots. Footer controls use control-sm and ICON.button. Scan is the first, sole primary results action; progress uses `.tool-progress` under results-heading with aria-live polite. On phones Scan fills the first toolbar line.

Tool presets store list filters only, using service namespaces tool:placement, tool:filecheck and tool:mux in the existing presets table. No scan settings, pagination or ordering are saved. Shares is an include-only list filter under Libraries, independent of scan library selection, visible with two detected shares. Active shares remain chips when collapsed. Missing root mappings retain their manual Apply action in a notice above results.

## Table recipes

Every table is a real table in `.table-wrap` with thead/tbody, th scope col, and optional th scope row styled as cell-title. Exactly one recipe applies: `.data-table` (libraries/rules), `.data-table.tool-table` (fixed tool rows), `.detail-table` (metadata, reports, previews, disk details), or `.editor-table` (controls/ordered lists). Tables in cards/dialogs have no minimum height. All heads share the library.css recipe: uppercase font-2xs, medium weight, letter-spacing, muted on panel2, nowrap. No other stylesheet sets header typography. Numeric cells and headers align right with tabular numerals; missing values use an em dash.

All tables use the single global border-collapse: collapse rule with zero border-spacing. Row separators come from td border-top only; do not add local cell borders. Heads never wrap or ellipsize. Only .th-label may carry last-resort ellipsis, which must remain inactive at standard desktop widths. Control columns (.col-control) have centered content, space-3 horizontal padding, no ellipsis and only sr-only captions. Data cells use space-4/space-5 and font-sm; tool cells use space-3 horizontally. Detail cells use space-3/space-4 and font-sm; paths/patterns remain monospace at the same size. Paginated or potentially >20-row details use SortableHeader; fixed property order stays unsorted. `.detail-table.stack-mobile` becomes labeled cards at 600px; data/tool tables keep horizontal scrolling. A row has either a whole-row action or cell actions, never both. Reports use a text-button in their first cell and DiskTag where appropriate.

Editor cells use space-2/space-3; headers never wrap, control columns size to content and preview takes remaining space. All color/visibility/text/reset/delete controls are framed control-md squares, including centered 16px checkboxes; icons use ICON.button. Color inputs use the named --color-input-padding token (6px). Text-color preview reads Aa on the selected tag background. Mux track inputs are the compact control-sm exception. Editors are never sorted: their order is content. Library/rule/tool sorting cycles ascending → descending → standard. Recognition rules use 64px rows, two-line names and ellipsized single-line pattern cells. Edit/delete buttons occupy the last column, aligned right. Rules paginate or scroll with the page, never inside a nested height-limited table wrapper.

## Segmented tabs

Use `SegmentedTabs` from ui.tsx and `.segmented` for 2–6 peer views. A line border, panel background, space-1 padding and control-md tabs surround the active panel2/accent-text tab. Use role tablist/tab, aria-selected/controls, roving tabindex, arrows and Home/End. The segmented container is content-width (width: max-content; max-width: 100%) and scrolls horizontally on overflow. Dashboard scopes, service instances, disk details and display/column tabs share this recipe. Display tabs persist per session; modified tabs show an accent dot with an accessible unsaved-changes label.

## Settings cards and ordered lists

`.card-heading` holds icon and h3.card-title on the left, actions on the right, with space-2 gaps. Only icon, title, count badge and action buttons belong in the heading. Inputs/selects/search belong in the card body under the description; standalone fields are at most 360px wide. A .card-intro wrapper groups the heading and optional quiet description at space-1; the card body follows at space-4. Card-wide Reset, test connection/paths, refresh storage and add-tag actions belong here, never below or centered. Resets use confirmReset. `--app-header-height` records the measured app header height (82px desktop, at least 110px on phones). The app header stays at the top and `.settings-section-heading` sticks beneath it; its separator appears only after scrolling, keeping Save reachable. Settings navigation is borderless except for the active accent indication.

`OrderedList` renders a compact editor-table: Show | Name | Order, centered control columns and control-sm arrows. Fixed items have disabled checkbox/arrows and a cell-sub explanation. Widgets, list-info symbols and all four column lists reuse it. Reset lives in the card heading and affects the selected list only. General preferences stack at 900px. Lists & columns is one full-width card with session-persisted Icons, Movies, TV series, Files & permissions and Disk placement tabs and unsaved-change dots; the widget overview uses 2:1 from 1120px. Display uses General, Lists & columns, Colors tabs; the Lists & columns card has one description and resets only the active tab. Keep every existing save route and confirmation.

## Dashboard widgets

The dashboard grid stretches every card in a row to equal height. Distribution cards are flex columns with the shared 468px structural minimum; More/Less sits at the bottom. All distributions share title, stacked chart, list and expansion logic. Language rows differ only in flag/name labels; flags and Unknown share a centered 27×18 box. Languages remain one column, except for the shared two-column compact distribution layout at 900px.

## Library sorting

Movies default to title ascending. Series default to series A–Z, season/episode ascending with season headings. Descending Episode reverses series only. Every other column sorts episodes flat, with series/season/episode tie breakers and no season headings/context. A quiet results hint explains temporarily hidden season context; the preference is retained. Third sort click restores the default. CSV uses the same ordering and mode. Film and series sorts have separate browser preferences.

## Disk tag tooltip

DiskTag keeps its tag appearance, default cursor and keyboard focus. Its shared Tooltip shows disk and target/source meaning, then adaptive bytes, plural file count and positive folder count. The overflow chip opens details and describes remaining disks/sizes. Tooltip placement never changes fixed row geometry; tapping the tag must not select the row.

## Additional wording

Scan report → Scan-Bericht; Scan help → Hilfe zum Scan; Shares → Freigaben; Tag colors → Tag-Farben; Resolution groups → Auflösungsgruppen; All items / All findings / All jobs → Alle Einträge / Alle Funde / Alle Aufträge. Use Reset for color reset headers; Reset column is reserved for actual column resets.

## Changelog of the guide

- **1.4.1.** Shared floating surfaces, filters/presets, segmented tabs, ordered lists and four table recipes; appwide settings organization, sticky headings, disk tooltips and enforced stylesheet ownership.
- **1.4.0 – all proposals implemented.** Appwide scale/status tokens, icons, controls, checkbox alignment, table/header/title recipes, stable tool rows, counts, wording/plurals, key-value lists, setup notices and shared dialog footers. The guide now describes the implementation rather than outstanding proposals.

- **1.4.2.** Measured table headers and desktop fit, control columns, library selection and bulk actions with confirmations, card-heading actions only, unified settings spacing, Icons tab in Lists & columns, edit/delete at row end.

## Selection and bulk actions

Library selection is the fixed first column. Header selects the page; grouped TV adds series and season checkboxes with tri-state state, counting all displayed files including season context across pages. Selected rows use color-mix(in srgb, var(--accent) 8%, var(--panel)); no bold or changed border. Series rows use panel2 and font-sm; season rows use panel with space-6 indentation. No group-row action beyond its checkbox.

Selection survives pagination/sorting, and clears on filter/search/preset/library/instance changes or leaving the library. The results selection bar shows count, Clear selection and Select all {total} matching when the page is selected; cap 10,000 keys and explain truncation. Group selection includes visible season context.

Toolbar: All columns → Mark for mux ({n}) → Remove mux marking ({n}) → Set tag ({n}) → Export CSV. Selection actions are secondary, disabled in place without selection (or missing MKVToolNix/no marked jobs), with explanatory titles. Phone toolbars wrap with selection actions first. CSV continues to export the filtered view. The mux info icon is visible by default, appended to existing info preferences, and opens Mux with the filename search.

Every action affecting more than one file/item requires confirmation.ts: confirmAction for marking/starting/adding tags, confirmDeletion for removal, including tools Start selected/all and Fix selected/all. Confirm text and button name action/count; cancel left, confirm right. Single items and Remove completed need no extra confirmation. Removing tags retains its deletion confirmation.

Mux marking is sequential, at most 200 files per action; confirm the cap. Modal progress reports done/total with aria-live, Cancel stops after the active file. Results summarize marked/already marked/failed and a detail-table of errors. Unmark skips queued/running jobs and retained backups. Reload data after each action while preserving selection. CustomBulk receives explicit files, capped at 10,000, and labels the selected count.

Tools retain progress as a separate sortable column: shared compact progress component, 56px bar, unchanged progress-height, space-2 gap and localized tabular percent without wrapping. Idle nonqueued jobs show an em dash. Status contains its tag only.

## Placement diagnostics

Every scanned item is searchable, including compact one-disk rows. Default placement excludes one-disk OK rows; explicit All scanned includes them for report drilldowns; an empty search with hidden OK matches offers Show. Not found uses status-error and belongs to Errors. Seasons spread uses status-info, belongs to Several disks and cannot start; choose series grouping to consolidate. Root path diagnostics remain actionable notices above results and in the Folders report. Report counts are right-aligned text-button cell actions, never row actions.

## 1.4.2 wording

Selection / selected → Auswahl / ausgewählt; Select all {total} matching → Alle {total} passenden auswählen; Mark for mux / Remove mux marking → Zum Muxen vormerken / Vormerkung entfernen; Match → Abgleich; Not found → Nicht gefunden; Seasons spread → Staffeln verteilt; On one disk → Auf einer Disk; Folders → Ordner (scan report).
