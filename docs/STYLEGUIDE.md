# Interface style guide

Scopearr 1.7.0 uses one visual language throughout the app: login, libraries, tools, statistics, settings and every dialog. This guide defines the interface, including the approved 1.7.0 recipes to implement. Reuse these tokens, components and recipes before adding CSS. Update this guide before introducing a new shared value or pattern.

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
--progress-label-width: 40px; /* compact progress percentage slot */
--touch-target: 44px;
--toast-shadow: 0 8px 30px #0003;
```

The --layout-1 token is reserved for the clipped .sr-only accessibility helper.

Structural `--layout-*` tokens preserve intrinsic image and flag geometry, chart dimensions, header height, dialog/popover widths, scroll limits, focus outlines and positioning. They are not an alternative typography, spacing, radius or control scale. Add structural tokens only for those purposes. `--backdrop`, `--letter-spacing` and `--progress-height` cover shared dialog, header and progress geometry. Tool columns and rows use the named `--tool-col-*` and `--tool-row-height*` tokens in `base.css` and the column model in `tool-table.ts`. Preset choices use the existing `--layout-200` width (200px). Small notification dots use `--space-1` for their diameter and token-based positioning inside a relatively positioned trigger; position them absolutely so they never change its size. Report dots use `--status-warn`. The settings button and Log tab have no unseen-error dot.

Exceptions: zero, 1px borders, percentages and intrinsic layout ratios, media tag palettes, the intentionally dark terminal, table column geometry, media query thresholds, and the 28px mobile stat number. Do not turn ordinary gaps or control heights into structural tokens.

### Colors

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
| Job log, event log | Terminal, ScrollText |
| File details (movies and episodes) | Film |
| Summary, search | ClipboardList, Search |
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

Form grids use `--space-4`, collapse at 600px, and set `min-width: 0` on field children. Service field pairs use equal halves in `.connection-grid` and `.sync-clock-grid`, with `--space-4` gaps: synchronization aligns with server address, start time with API key. MKVToolNix package channel is a labeled control in a `.connection-grid` below the key-value list, aligned and equal in width to retention.

## Tables

### Standard table and row actions

Use `.table-wrap > table`, `th scope="col"`, and `SortableHeader` for sortable columns. Sorting cycles ascending → descending → default and exposes `aria-sort`. Headers use the global uppercase recipe. Cells use `--space-4 --space-5` (compact mobile: `--space-3 --space-4`), a line border and vertically centered content. Table wrappers use surface radius; standard columns fit without horizontal scrolling from 1440px in all four languages. Smaller screens may scroll. Empty tables render `.empty-state`.

Title: `<strong class="cell-title">` at medium weight; secondary line: `<small class="cell-sub">`, muted, `--font-xs`, margin-top `--space-1`, only for actual secondary information such as a path, filename or episode title. Short qualifiers use `<em class="cell-hint">` in the same nonwrapping label group, space-2 after the name, font-xs, muted, italic and initially lowercase. Library rows retain their leading icon. Full paths remain available in tooltips and details.

Inspection/start actions (details, start, log, options) follow selection. Edit and delete/remove actions always occupy the last column, right-aligned. `.info-actions` holds up to three `.row-icon.info-action` controls with `--space-2` gaps. Extra actions belong in details. Compact settings/color/track tables reuse standard borders; track cells use `--space-2 --space-3`.

### Stable tool tables

Disk placement, files/permissions and mux use `.tool-table`, `table-layout: fixed` and a colgroup. `toolTableStyle()` computes minimum width from the selected columns; the title receives at least 200px. Selection is 40px; action width is 24 + n × 28 + (n − 1) × 8; removal 52px; service 120px, status at least 120px and wide enough for the longest translated status tag of that tool, progress 128px. Title receives the remaining width with a 200px minimum. `toolTableStyle()` measures translated uppercase labels using the actual font, size and letter spacing, sort icon and padding; every column receives the larger of content minimum and header width. Status widths measure every translated short label from the tool's label table, including tag padding and border, never visible rows. Remeasure headers and tags after a language change and after `document.fonts.ready`. Status cells use `.col-status` with no ellipsis; tags are never truncated. All tools, including Mux, show short status labels with the full label in `title` and `aria-label`. Widths never depend on rows. See `toolColumnWidths` for other minima.

The icon column is visibly labeled Info in all three tools and their column settings. Its header uses `.col-info` and `.th-label`, is left-aligned and never sortable; selection/removal keep `.col-control` and their accessible captions. Measure Info without a sort icon, preserving existing action-column minima and persisted `actions`/`buttons` keys.

Rows are 64px, 56px at ≤740px. Titles clamp to two lines, paths/subtitles to one ellipsized line. Data columns do not force new line wrapping after a removal. Disk tags wrap side by side; show two plus a details chip for remaining disks. Details retain all disks and sizes.

At ≤600px the action column shows Details; start/fix, terminal and mux options stay available in the details footer with their existing handlers and confirmations. Selection stays accessible. Removing an entry affects its own spinner/fade only; a failed request restores it. Reduced motion disables the fade. Slow reload indication is delayed 300ms.

### Counts and numbers

Page summary: **open entries**, with `title="Open items"`. Results badge: total rows in the filtered list, matching pagination, with `title="Items in the list"`. Pagination: `{from}–{to} of {total}`. Tools menu badges count queued/running/failed jobs; unstarted scan findings, succeeded and cancelled jobs do not count. Mux drafts/ready jobs count as open.

Use `count()` or translated numeric `count` parameters for localized integers, `bytes()` for adaptive decimal B/kB/MB/GB/TB, `percent()` for localized percentages with a narrow nonbreaking space, and `—` for unavailable values. Counts and progress use tabular numerals. `t()` selects `|one` / `|other` through Intl.PluralRules before formatting numeric counts; legacy messages remain a fallback.

## Tags and badges

Navigation counters are absolute plaques at the top right of relatively positioned menu buttons, above the chevron, using font-2xs and the shared badge height/padding. Use space-1 for their top offset and right inset, with at least space-2 separation from adjacent entries; at ≤740px translate the plaque up by its full height so it sits above the compact navigation label and chevron; counters never affect button width, cover labels/chevrons or change touch/focus geometry. The same recipe covers single-entry menus and Mux counters.

Tags use `--font-2xs`, medium weight, small radius. Media palettes are fixed/user-configurable and are separate from interface states. `.filter-chip` uses accent. Excluded filters (`is not`, `none of`) use `--status-error`: error text, 35% error border mixed with line, and 10% error tint on panel, for both chips and the filter's selected button. Counts use `.filter-count`. Results and card-heading counts share `.heading-count`: font-2xs, semibold, muted on panel2, line border, radius-sm and space-1/space-2 padding. Render heading badges inside the heading immediately after its text. Tag lists wrap with `--space-2`.

Status classes are neutral: `status-ok`, `status-warn`, `status-wait`, `status-error`, `status-info`, `status-running`, `status-neutral`. Ready/succeeded → ok; review/warning/no-space → warn; queued → wait; failed/needs-attention/actionable conflict → error; informational split → info; running → filled accent; draft/cancelled → neutral. `.status-button` opens details without a separate button frame. Disk targets use accent and sources warn.

## Metadata evidence

Metadata disagreement (`conflict`) means a known filename value disagrees with measured metadata (MediaInfo when available, otherwise media-server metadata). It uses the configured `metadata` warning color, the library warning icon and the yellow `evidence-conflict` detail row. Recognition-rule conflicts and disagreements between media servers remain separate findings.

Radarr/Sonarr differences (`apiDiffers`) are information in file details only: use `--muted` text and a lucide `Info` at `ICON.label` in the Arr cell, with the translated explanation in both `title` and `aria-label`. `.evidence-api-info` belongs to `dialogs.css`; its icon aligns vertically like `.detail-conflict-marker`. These differences add no row color, list icon or filter. The Category hint remains for a compatible but broader source category, only when `apiDiffers` is false. Display precedence is filename → MediaInfo → media server → Radarr/Sonarr; source and processing retain filename → Arr because media servers do not provide them. The metadata-disagreement filter describes filename versus measured metadata only.

The Used cell is a `text-button` with ChevronDown at `ICON.label` when two sources have values, the field has a warning, or a confirmation exists. Its `EvidenceSourceMenu` follows `.select-popover` and `.floating-surface`, offers only sources with values, and adds Automatic after a separator only for confirmed fields. Arrows, Home/End, Enter and Escape work; closing returns focus. The menu is portaled into its current native dialog and positioned against the trigger within the viewport, avoiding table clipping. On mobile it uses the full card width and scrolls the trigger into view before opening below it; if needed, it flips above. Closing or completing a choice returns focus to the trigger. A manual choice uses the current value of that source and suppresses metadata, rule and informational differences for that field only. Show a muted UserCheck at `ICON.label`, with the source, saved value and local date in its tooltip and accessible label. Other evidence remains visible. Automatic restores normal resolution. Confirmations belong to service/file ID and size; a missing source shows the cell-hint Confirmed source has no value and remains reversible. Status and metadata quality offers a yes/no Manually confirmed filter.

Show a MediaInfo evidence column only with a saved result. MediaInfo agreeing with the filename clears the measured disagreement; a different media-server value uses the same muted Info recipe as `apiDiffers`, in the media-server cell (`mediaServerDiffers`). MediaInfo audio tracks replace media-server tracks and show their source and read date.

## Dialogs and detail lists

Use `Modal`, which wraps native dialog behavior, Escape, backdrop click, focus and stacking. Default width 450px; wide 780px; table dialogs may use existing 900–1100px structural widths. Dialogs scroll within the viewport and use the common backdrop and shadow. File & metadata alone uses `.modal.wide.file-dialog` at `min(var(--layout-1060), calc(100vw - var(--layout-28)))`; companion, rename and tag dialogs keep their existing widths. Its Used evidence column never wraps; value columns may wrap without fixed widths.

Every modal reserves `scrollbar-gutter: stable`. Dialogs containing tabs use `Modal tabs` (`.modal-tabbed`), anchored at `margin-block: calc(var(--layout-50) / 2) auto`. Within one open session, remember the largest rendered height as a minimum, capped at `100dvh - var(--layout-50)` and responsive to viewport changes. The same height cap applies on phones. Clear that height on close; another opening starts fresh. Keep heading and tabs in place when content becomes shorter, with scrolling inside the dialog even at small heights and in landscape.

Use `DialogTabs` around every segmented tablist and its panel inside a modal, including nested MediaInfo sections. `.dialog-tabs` owns space-4 before the tablist and between it and the panel; each panel is a grid with space-4 gaps. Its first block and `.file-dialog-section` children have no extra margins. Preserve tab IDs, keyboard navigation and independent inner/outer selection. Scroll a tablist into view with `block: nearest` only when it is outside the dialog's visible area. Placement details introduces its disk tabs with Files by disk (`h3.card-title`); disk names use a heading-count size badge rather than punctuation in the label.

Scan reports start their key-values with Scanned at (local date/time and ISO title), then Duration when timestamps exist. A running replacement scan adds a notice that the report still describes the previous completed scan. Both reports use the shared scan-time formatter.

One footer: `.modal-actions`, right-aligned, gap `--space-2`, margin-top `--space-4`. Cancel/Close precedes the primary/danger action. A secondary tool action may sit at the far left using margin-right auto. Tool actions inside a dialog body are ordinary toolbars, not footers.

A Save/Apply action in the footer saves and closes the dialog on success, then shows an outcome toast. A failed save keeps the dialog open and shows a toast or field error. Clear the saved draft before closing so it cannot trigger an unsaved-changes confirmation. This applies to rule/preset editors, bulk tags, mux options/path mapping, tag policy, companion renaming and the allowed/ignored names editor. The exception is editing one part inside a detail dialog, such as a filename in File & metadata: saving that part leaves the detail dialog open. Confirmation dialogs close after a successful action.

Details use `<dl class="key-values"><div><dt>Label</dt><dd>Value</dd></div></dl>`: columns `minmax(140px, 1fr) 2fr`, muted extra-small label, small regular value, line separators and no label indentation. Apply the same recipe in system and MKVToolNix settings. A disk value uses `DiskTag`. Rename previews show each companion's physical device with DiskTag. Without Unraid setup, show the cell-hint Renamed through the user share, with a setup tooltip. After a successful service refresh, newly present folder devices are reported in the result toast and event log.

File & metadata uses session-persisted Overview | MediaInfo `SegmentedTabs` below the action row (`scopearr-file-dialog-tab`). MediaInfo appears when enabled or a result exists. Its action row appears for mux actions or enabled, installed MediaInfo and places Read with MediaInfo / Read again (ScanSearch or busy spinner) after the mux buttons. No unavailable MediaInfo placeholder appears. Reads switch to MediaInfo / Result only on success; failures retain the current tab and show a toast plus the MediaInfo notice. The last-read timestamp/version sits to the right of the inner tablist in a wrapping row with space-3 gaps, below it at ≤600px. Before the first read the tab explains how to use the action above. Results use `detail-table.stack-mobile`: Field | Scopearr value | MediaInfo. A second, session-persisted `SegmentedTabs` bar (`scopearr-mediainfo-section`, `mediainfo-section-*` IDs) offers Result | General | Video | Audio | Subtitles, showing only sections with data. Missing sections fall back to Result after a read. A single track uses a two-column `detail-table.stack-mobile` (Attribute | Value). Multiple tracks use one `detail-table` with attributes as rows and tracks as columns, language in each header and Default/Forced as cell-hints. The first column stays sticky at left zero on `--panel`; `dialogs.css` owns this rule. Multi-track tables scroll within `table-wrap` and never stack into cards. There are no expandable track sections. Both tablists keep their own keyboard focus and selection; errors stay as a notice in the tab.

## Feedback

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

## Navigation and page recipes

### Tool page

`.library-intro` (h1 + open count) → `.filter-panel.filter-panel-v2` → optional setup notice → `.library-section` with results heading, table/empty state and pagination.

All five library/tool pages share one vertical rhythm: page heading → filter card → optional setup notice → results heading → table. A central grid container owns `--space-6` between the blocks and `--space-4` between results heading and table. Do not add local margins to filter panels, notices or results headings. An optional setup notice participates in this same rhythm. There is never a scan-result-dependent box between filters and results; root/path diagnostics belong in the report.

Use the Shared filter panel recipe below. `.results-heading` uses `min-height: var(--control-md)`, centered alignment and the same spacing on every page. Scan uses `control-md`, like every toolbar button; activity stays beside the results count. Preset choices are fixed at `--layout-200` on all five pages.

### Scan dialogs

Use `Modal wide` with `className="scan-dialog"`, at `min(var(--layout-980), calc(100vw - var(--layout-28)))`. `.scan-dialog-grid` has two columns above 900px: Files & permissions places Services/Checks left and Target owner/Target permissions/Fixing right; Placement places Services/TV series left and Target disks right. Use a line border and space-6 inset between columns. At ≤900px stack them and use a horizontal separator. Use space-4 between sections and space-3 within them; headings have no additional margins. Check kinds use `.scan-dialog-checks`, two columns and one at ≤600px. Owner UID/GID remain side by side, each at most layout-160; permission radios use space-2 gaps. Put Custom values fields directly beneath the radio group. Owner defaults come from Unraid settings with a Reset to default text action only when different. Errors remain inside the relevant section or dialog.

The single `.modal-actions` footer stays visible without scrolling: sticky bottom zero, panel background, line separator and nonshrinking controls. Busy/fix reasons sit on its left, Cancel | Scan on its right. Use a flex column on the open dialog, a nonshrinking heading/footer and an independently scrollable `.scan-dialog-body` with zero minimum height and space-4 scroll padding. This keeps scrollable content above the footer, including when custom values or notices are visible. Scan dialogs opt into `Modal fitViewport`: track `visualViewport.height` and `offsetTop` through resize/scroll events while open, remove listeners and CSS overrides on close, and leave CSS viewport units as the fallback. The local geometry properties `--dialog-viewport-height` and `--dialog-viewport-top` hold browser measurements, not design tokens. Anchor at the visible viewport top plus half layout-50; cap height at its height minus layout-50. Focused body fields outside the resulting body bounds scroll into view with nearest alignment, above the footer and the mobile on-screen keyboard. Verify Scan is initially visible at 1440×780 and 1280×720; narrow layouts keep a reachable sticky footer. Explain strict permission checking with HelpPopover and link Checks to the Unraid names settings. `dialogs.css` owns this complete scan-dialog recipe.

### Settings section

Every settings area uses `SettingsSectionHeading` with title, description, optional help and optional save action. It renders `.settings-section-heading`: h2 and Save settings on one row, description directly beneath at space-1. Save always sits at the right of the section title, uses Check or a busy spinner and is disabled without changes; connect it to the area's existing form/callback. Areas without editable values (System) have no save button. The h2 has `min-height: var(--control-md)` and flex-centered text, so the title row always reserves the Save button height and does not jump between sections. Descriptions wrap naturally; their differing line counts may change the total heading height on narrower screens. Card headings never contain Save. Explanations that are not needed constantly belong in a HelpPopover beside the section title, not boxes above the content. Custom tags has a section-heading help popover like Tag rules, explaining Management, Count, Name, Colors and Creating tags.

Settings areas with multiple peer views use `SegmentedTabs` below `SettingsSectionHeading`, including System with Info | Log. Use `--space-4` from the section description to tabs and from tabs to the first card, and persist the active tab under its own sessionStorage key. System has no section save button. Info shows three equal-height peer cards (Version, Back up cache, Change password) in `.system-overview`: three columns on desktop, two plus a full-row password card at ≤900px, and one column at ≤600px. Use `align-items: stretch` and flex-column cards so cards in each grid row share a height, with content at the top. Overview headings wrap with a `--space-2` row gap; the Version card has no placeholder. Cards contain their heading, description and short values; forms open in a dialog.

Change password opens the standard `Modal`, with its description, current/new password fields and one footer: Cancel followed by the primary Change password and sign out action (disabled in demo). Focus the current-password field on opening; Escape, Close and Cancel reset both fields. `.password-dialog-fields` belongs to `dialogs.css`, uses the standard label recipe and full-width controls up to 360px. Controls associate through `form="password-form"` with the empty form outside the settings form; the dialog contains no nested form. The password state belongs to its card and does not make settings dirty. Info also retains sync status; Log contains the event viewer. The System description includes “The log shows events from the last 24 hours.” Internal links can open System → Log with source/service filters, via `openSettings("system", { tab: "log", source: "mux" })` and an optional service filter.

The heading starts level with the first navigation entry and sticks beneath the app header. Navigation uses font-md and active accent indication, vertical on desktop and wrapping at ≤900px. The settings-content grid owns space-4 between headings, tabs and cards without extra margins. Each settings-card/connection groups one topic, using 1–2 column form grids and border-top subsection separators. Service tabs and Add share a row. Preserve save routes and confirmations; resets use confirmReset().

The Unraid tab places a `.unraid-settings-grid` with equal Paths and Files & permissions settings cards above Shares; it collapses to one column at 900px. UID/GID controls use the standard field recipe and the existing 360px maximum; a muted hint states the running container UID:GID. The Files & permissions card combines default owner fields and allowed/ignored-name counts with Edit, using the shared names dialog and the section draft/Save route. Name edits apply to the next scan. Paths also contains the persisted Verify copies with checksums move preference. The default remains editable when Unraid is disabled. Files & permissions starts and resets to this default; scans retain their own execution values without changing it. Ownership fixes that cannot assign the requested owner are manual and explain the generated command route.

MediaInfo is a singleton service tab sorted alphabetically. MediaInfo and MKVToolNix share `ToolPackageCard` for package status, channel and install/update/check/remove actions, and `PathMappingsCard` for `mux.mappings`; its hint reads Shared with MKVToolNix and renaming. All mappings remain one setting.

### Navigation, accessibility and behavior

At ≤740px the demo banner is sticky below the measured app header (`--app-header-height`) with z-index 20 below the header/menu layer so scrolling cannot slide it beneath the two-row header; use its normal flow position without margin offsets.

The desktop header is a three-column grid: minmax(0, 1fr) auto minmax(0, 1fr), with the brand at start and actions at end. Keep the existing two-row mobile layout. Derive active navigation from the visible page: settings clears every main-navigation active state and activates the settings icon. All active page controls, including Dashboard and Settings, expose aria-current="page". Active header icons use the same accent indication as tabs.

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

## Stylesheet ownership

Import order: base → navigation → library → dialogs → login → dashboard → settings-and-filters → recognition → placement → responsive. A non-media selector has exactly one rule in its owning stylesheet (intentional reset groups require documented test exceptions); `web/test/stylesheet-ownership.test.mjs` enforces this. No unexplained cross-file duplicates are allowed. Add rules to the matching area, merge existing selectors and group media queries. Never add another improvements or override stylesheet. Remove unused rules only after checking static and dynamically constructed classes.

## Floating surfaces

Every floating tooltip, popover and menu uses `.floating-surface`: panel2 background, text foreground, line border, control radius and the shared shadow. Do not add local surface colors or shadows. Only floating surfaces, modals and toasts use shadows (a user-selected flag outline is a border effect).

`Tooltip` from `ui.tsx` wraps a trigger, supplies role tooltip and aria-describedby, opens after 150ms hover or immediately on keyboard focus, closes on Escape, and toggles on coarse-pointer taps. Outside taps close it. Its fixed position flips above/below and stays inside the viewport. `.tooltip` uses space-2/space-3 padding, font-sm, line-height 1.5, a 340px structural maximum width bounded by viewport minus space-8, pointer-events none and z-index 40. Offset: space-2. Flags, operators, filenames and disk tags reuse it. Interactive/long help uses HelpPopover (space-4), other popovers space-3. Menus use space-1 and small-radius entries.

## Shared filter panel

Filter panels only filter results. Files & permissions and Disk placement use `.tool-result-filters` without a collective Show heading. Groups sit side by side with border-left line and padding-left space-6 between adjacent groups, following the library state-filters divider recipe; never give the first visible group a leading border. Shares appears only with at least two choices. Placement groups Shares (`minmax(var(--layout-240), 1fr)`), Status (`2.5fr`, three checklist columns) and Kind (`1fr`); Files & permissions groups Shares, Kind (`2fr`, two checklist columns) and Status (`1fr`). Without Shares, the remaining groups fill the width. Counts follow labels immediately, with space-3 checklist gaps and control-sm row height. Expanded compact tool panels keep the panel's space-5 padding; padding never changes between collapsed and expanded states. They use space-3 above the expanded groups, no extra group padding or outer group border, and no extra footer top padding, with a control-sm footer minimum. Group headings use the card-title line-height 1.3 without margins. This retains the 360px height budget with five checklist rows while keeping the normal search controls and footer icons. At ≤1120px placement Status uses two columns; at ≤900px groups stack with border-top separators; at ≤600px every checklist uses one column. At 1440px both complete expanded panels must be at most 360px tall. `placement.css` owns this recipe.

Scan options live in a wide Scan dialog opened by the first primary Scan action; while scanning, Cancel scan remains direct. Tool presets continue to store result filters only. Scan dialogs may open during fixes/moves but disable starting with an explicit reason until work completes.


Every state filter has a HelpPopover explaining inclusion and exclusion. Its operator follows the label and help icon immediately with space-2 gaps; labels do not grow to push operators to the far edge. MediaInfo read is visible when MediaInfo is enabled or its filter is active, so loaded presets remain removable.

All five library/tool pages use `FilterRow`: labeled search, 200px preset choice, save/delete preset icons, collapse icon. Only this row and ActiveFilterBar remain visible when collapsed. Expanded filter-groups sit between them and have space-5 bottom padding. ActiveFilterBar owns the fixed footer order: Reset when active → page tools (Scan report) → CSV export → help, with named tools/export/help slots. Movies/TV series use Reset → CSV → Help; Disk placement and Files & permissions use Reset → Report → CSV → Help; Mux uses Reset → Help and has no export. CSV uses Download at ICON.button in an a.icon-button.control-sm with download, title and aria-label Export CSV; without results render an inert span with aria-disabled. Export follows current list filters and sort, retaining Placement target. CSV never appears in results toolbars or scan reports. Scan information belongs in the HelpPopover as Last scan, followed by How scanning works; omit Last scan before the first scan. There is no separate scan-info icon or info slot. Footer controls use control-sm and ICON.button. Scan is the first, sole primary results action. Running scans, moves, fixes and cleanup show a spinner and short muted aria-live text directly after the results count, never a page-wide progress bar or separate activity row. On phones Scan fills the first toolbar line.

Tool presets store list filters only, using service namespaces tool:placement, tool:filecheck and tool:mux in the existing presets table. No scan settings, pagination or ordering are saved. Shares is an include-only list filter under Show, independent of scan service selection, visible with two detected shares. Active shares remain chips when collapsed. Scan-result notices never appear between the filter panel and results; missing share-folder choices are resolved in Unraid settings and linked from the report.

### Compact filter row

Lists inside settings cards use a compact `FilterRow` variant when search and filters fit in one row. There are no presets and no expand/collapse control. Search uses `.input-wrap` with `ICON.button` and grows to fill the available width; include-only `MultiFilter` controls follow it, using counts where available. Controls have `control-lg` height. Below them, `ActiveFilterBar` shows active chips and Reset using the shared footer order (Reset → optional page tools → help). At ≤600px search occupies the full width and filters wrap on the next line. Inputs stay in the card body, never in `.card-heading`. The event log uses this variant with Level, Source and, only when entries have an instance, Service filters.

## Table recipes

Every table is a real table in `.table-wrap` with thead/tbody, th scope col, and optional th scope row styled as cell-title. Exactly one recipe applies: `.data-table` (libraries/rules), `.data-table.tool-table` (fixed tool rows), `.detail-table` (metadata, reports, previews, disk details), or `.editor-table` (controls/ordered lists). Tables in cards/dialogs have no minimum height. All heads share the library.css recipe: uppercase font-2xs, medium weight, letter-spacing, muted on panel2, nowrap. No other stylesheet sets header typography. Numeric cells and headers align right with tabular numerals; missing values use an em dash.

All tables use the single global border-collapse: collapse rule with zero border-spacing. Row separators come from td border-top only; do not add local cell borders. Heads never wrap or ellipsize. Only .th-label may carry last-resort ellipsis, which must remain inactive at standard desktop widths. Control columns (.col-control) have centered content, space-3 horizontal padding, no ellipsis and only sr-only captions. Data cells use space-4/space-5 and font-sm; tool cells use space-3 horizontally. Detail cells use space-3/space-4 and font-sm; paths/patterns remain monospace at the same size. Paginated or potentially >20-row details use SortableHeader; fixed property order stays unsorted. `.detail-table.stack-mobile` becomes labeled cards at 600px; data/tool tables keep horizontal scrolling. A row has either a whole-row action or cell actions, never both. Reports use a text-button in their first cell and DiskTag where appropriate.

Editor cells use space-2/space-3; headers never wrap, control columns size to content and preview takes remaining space. All color/visibility/text/reset/delete controls are framed control-md squares, including centered 16px checkboxes; icons use ICON.button. Color inputs use the named --color-input-padding token (6px). Text-color preview reads Aa on the selected tag background. Mux track inputs are the compact control-sm exception. Editors are never sorted: their order is content. Library/rule/tool sorting cycles ascending → descending → standard. Recognition rules use 64px rows, two-line names and ellipsized single-line pattern cells. Edit/delete buttons occupy the last column, aligned right. Rules paginate or scroll with the page, never inside a nested height-limited table wrapper.

## Segmented tabs

Use `SegmentedTabs` from ui.tsx and `.segmented` for 2–6 peer views. A line border, panel background, space-1 padding and control-md tabs surround the active panel2/accent-text tab. Use role tablist/tab, aria-selected/controls, roving tabindex, arrows and Home/End. Inside a modal, use DialogTabs to own tablist and panel spacing, with quantity badges using heading-count. The segmented container is content-width (width: max-content; max-width: 100%) and scrolls horizontally on overflow. Dashboard scopes, service instances, disk details and all settings areas with multiple views (including Display and System Info | Log) share this recipe. Display tabs persist per session; modified tabs show an accent dot with an accessible unsaved-changes label.

## Settings cards and ordered lists

`.card-heading` holds icon and h3.card-title on the left, actions on the right, with space-2 gaps, `min-height: var(--control-md)` and `align-items: center`. `h3.card-title` has margin zero and line-height 1.3. Actions are at most `control-md`. The shared `.card-actions` row wraps within the card on narrow screens using space-2 gaps; it never forces horizontal page overflow. A card heading is always at least `control-md` high; titles align at the same height with and without actions. Only icon, title, count badge and action buttons belong in the heading. `CardHeading` accepts `count` and `countTitle`; the `.heading-count` is inside `h3.card-title`, immediately after the title, including the event log. Inputs/selects/search belong in the card body under the description; standalone fields are at most 360px wide. A .card-intro wrapper groups the heading and optional quiet description at space-1; the card body follows at space-4, owned by one shared rule with no local margins. Apply this to every settings card and dialog using `CardHeading`. Card-wide Reset, test connection/paths, refresh storage and add-tag actions belong here, never below or centered. Save belongs only in SettingsSectionHeading. Resets use confirmReset. `--app-header-height` records the measured app header height (82px desktop, at least 110px on phones). The app header stays at the top and `.settings-section-heading` sticks beneath it; its separator appears only after scrolling, keeping Save reachable. Settings navigation is borderless except for the active accent indication.

`OrderedList` renders a compact editor-table: Show | Name | Order, centered control columns and control-sm arrows. Fixed items have disabled checkbox/arrows and an inline cell-hint after the name (always first / always visible), never an extra row of explanation. Widgets, list-info symbols and all four column lists reuse it. Reset lives in the card heading and affects the selected list only. General preferences stack at 900px. Lists & columns is one full-width card with session-persisted Icons, Movies, TV series, Files & permissions and Disk placement tabs and unsaved-change dots; the widget overview uses 2:1 from 1120px. Display uses General, Lists & columns, Colors tabs; the Lists & columns card has one description and resets only the active tab. Keep every existing save route and confirmation.

## Event log

System → Log is one `settings-card`. Its `CardHeading` contains ScrollText, Log, a badge counting the filtered list, and Refresh (`RefreshCw`), Download (`Download`) and Clear (`Trash2`, `icon-button danger-button`) actions. The quiet description reads “Events from the last 24 hours. Older entries are removed automatically.” Heading, description and content follow the shared card recipe; search and filters stay in the body.

### Event model and sources

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

### Filters and table

Use the Compact filter row with Log search …, Level, Source and Service. Filters are include-only `MultiFilter` controls with counts: Level offers Error, Warning and Info; Source offers only sources with entries; Service appears only when entries have `instance` values. Counts respect the current search/time range and other filters, omitting their own filter. Search matches stored message keys, parameters, subject and detail case-insensitively; it does not rely on a server translation of the visible message. `ActiveFilterBar` below the row shows chips and Reset.

Use `.table-wrap > table.data-table` and the standard sortable-header cycle, defaulting to Time descending. Time, Level and Source are sortable; Level's descending-severity order is Error → Warning → Info. The message column has no sort control. Page size is fixed at 25; badge and pagination count the filtered list and use the Counts and numbers recipe. Auto-reload keeps the newest first page at 25 rows. The API default stays 100 for compatibility; export remains unpaginated.

| Column | Recipe |
| --- | --- |
| Time | Local `HH:MM:SS`, with `cell-sub` Today/Yesterday and the full ISO timestamp in `title`; tabular numerals, 120px |
| Level | Short Error / Warning / Info tag using `status-error` / `status-warn` / `status-info`, 100px |
| Source | Translated source name with service display name in `cell-sub` when `instance` exists, 160px |
| Message | Translated message using `cell-title` with regular weight, subject beneath in `cell-sub`; remaining width, clamped to two lines |

For `repeat > 1`, append a `filter-count` badge “×{repeat}” with title “{repeat} occurrences combined in 10 minutes”. Only a message with `detail` or `subject` is a `text-button` opening details; otherwise show plain text. Never make the whole row clickable. Empty state uses ScrollText and “No entries in the last 24 hours.”; an empty filtered list uses “No matching entries.” and Reset.

### Details and actions

The Event entry `Modal` uses `key-values` for Time (ISO and local), Level (tag), Source, Service, Subject, Message and Repetitions. Technical detail is a wrapping monospace `pre`, with a Copy (`Copy`) action. Its footer offers Copy for the entire entry as text and Close. Mux events retain the job ID in `params.job` for copying and export. There is no job-log link. Do not duplicate job-progress output here.

Load on opening Log and on Refresh. Auto-reload silently every 10 seconds only while the tab is visible, Time descending is selected and page 1 is active. Insert new events at the top without jumping or changing focus/scroll position; other sorting, pages and hidden tabs do not auto-reload. Under `prefers-reduced-motion`, omit entry animations.

Download exports the current filters as `.txt`; its `title` names the JSON alternative, available from the context menu (right-click); use `scopearr-log-YYYY-MM-DD-HHMM.txt`. Clear calls `confirmDeletion()` with “You are about to clear the log.” (German: “Du bist dabei, das Log zu leeren.”). Clearing adds a new info event from System afterwards. Demo mode shows sample events and disables clearing.

The settings button and Log tab have no unseen-error indicator or browser seen timestamp. Background error toasts offer Show in log (`text-button`), opening System → Log with the event's source and service filters: Sync and Tag sync failures (with their service), Disk placement and Files & permissions scan failures. `notify(message, kind, log)` takes the filter; Mux, Move and Fix job failures stay visible in their job lists and do not toast.

## Dashboard widgets

The dashboard grid stretches every card in a row to equal height. Distribution cards are flex columns with the shared 468px structural minimum; More/Less sits at the bottom. All distributions share title, stacked chart, list and expansion logic. Language rows differ only in flag/name labels; flags and Unknown share a centered 27×18 box. Languages remain one column, except for the shared two-column compact distribution layout at 900px.

## Library sorting

Movies default to title ascending. Series default to series A–Z, season/episode ascending with season headings. Descending Episode reverses series only. Every other column sorts episodes flat, with series/season/episode tie breakers and no season headings/context. A quiet results hint explains temporarily hidden season context; the preference is retained. Third sort click restores the default. CSV uses the same ordering and mode. Film and series sorts have separate browser preferences.

## Disk tag tooltip

DiskTag keeps its tag appearance, default cursor and keyboard focus. Its shared Tooltip shows disk and target/source meaning, then adaptive bytes, plural file count and positive folder count. The overflow chip opens details and describes remaining disks/sizes. Tooltip placement never changes fixed row geometry; tapping the tag must not select the row.

## Selection and bulk actions

Files & permissions selection includes Manual and Failed findings, excluding queued, running and succeeded jobs. Fix selected counts and sends only automatically fixable entries. Terminal commands opens whenever the filtered list has findings, showing a selection count only with a selection. Its dialog owns the left-aligned Download script for all {count} matches action, using the complete current filtered result up to 50,000 findings. Without a selection, explain this scope and omit Copy. Selected commands group at most 100 paths per command/value, with deletion taking precedence on the same path. Owner and permission commands stay distinct; links/special entries and untracked media produce review comments only. The dialog shows up to 500 lines directly, otherwise the first 50 as preview with the total; copying the complete selected script and downloading .sh remain available. There is no separate all-matches button in the results toolbar.


Library selection is the fixed first column. Header selects visible page rows; grouped TV series and season checkboxes select only visible episodes of that group, including visible season context. Tri-state counts only visible rows. Series rows use panel2/font-sm; season rows use panel with space-6 indentation. Selected rows use color-mix(in srgb, var(--accent) 8%, var(--panel)); no bold or changed border. No group-row action beyond its checkbox.

Selection clears on pagination, sorting, filter/search/preset/library/instance changes and when leaving the library. There are no invisible selected files, no selection bar, no all-matching action and no explanatory selection text. Counts remain in toolbar buttons. Explicit keys are bounded by the visible page (at most 1,000).

Toolbar: All columns → Mark for mux ({n}) → Remove mux marking ({n}) → Set tag ({n}). Selection actions remain in place, secondary and disabled without a selection (or missing MKVToolNix/no marked jobs), with explanatory titles. While any selection action processes files, all selection actions are disabled. At ≤600px, library selection actions and All columns are icon-buttons in one line beside the results heading, with count badges and full text including the count in title and aria-label. Preserve desktop ordering and disabled states; above 600px keep labeled buttons. Touch targets follow the shared control recipe. CSV exports the filtered view from the filter footer. The mux info icon remains configurable and opens Mux with a filename search.

Actions affecting multiple items use confirmation.ts with one short sentence: “You are about to {verb} {count} {objects}.” German: “Du bist dabei, {count} {Objekte} zu {Verb}.” The confirm button is only the verb; Cancel precedes it. Use confirmAction for marking/starting/tag changes and confirmDeletion for removal. Keep existing safeguards for protected jobs and destructive file fixes. Single items and Remove completed add no confirmation; tag removal retains its existing deletion confirmation.

Mux marking is sequential on the visible selection, without a separate 200-file cap. Already marked files are silently skipped. One file has no confirmation or dialog; multiple files have one short confirmation. During processing the disabled toolbar button shows a spinner and Marking … {done}/{total}. There is no progress, cancellation or result dialog. Finish with one success toast, or one warning containing success/failure counts and the first error. Unmark still skips queued/running jobs and retained backups, naming skipped counts in its outcome toast. CustomBulk still receives explicit keys and saves through its existing endpoint, with the same short confirmation style. Reload after each action without inventing hidden selections.

The tag dialog offers a New tag input (`maxLength=80`) and secondary Add button with Plus below its checkboxes. Enter adds locally without submitting. A new tag is checked and marked with the cell-hint New; unchecking discards its creation. Names are trimmed and matched without case; an existing name selects its checkbox. Empty or oversized names show a field hint, and the 128-tag limit disables adding. Apply creates only checked drafts then applies tags; Cancel creates nothing. The empty message is No custom tags yet. Add one below. Disable Apply while busy.

Tools retain progress as a separate sortable column. Progress is a left-aligned bar column (not `.number`): shared compact progress component, 56px bar, unchanged progress-height, space-2 gap, and localized tabular percent in a right-aligned `--progress-label-width` slot without wrapping. Idle rows show an em dash at the start of the cell, aligned with the bars. Progress cells use `.col-progress` without ellipsis. Status contains its tag only.

## Placement diagnostics

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

### Placement checks

Store the last check and its UTC RFC3339 timestamp with the placement row. Keep it after closing, refreshing, a successful move, and an unchanged scan (`item_key` and `placementSame`); clear it on changed files or row removal. The dialog shows “Last checked: {time}” in local time with the ISO timestamp in `title`, or “Not checked yet”. Use the shared PathCheckRow recipe for Unraid reachable, Target writable, Enough free space, Files unchanged since scan, No conflicts, Sources readable, Sources removable, Owner unchanged, and Mover / parity state. Owner unchanged is a warning rather than a blocker and offers the text-button “Check in Files & permissions” with the folder search prefilled.

Use the existing wide (780px) Modal for placement status so the diagnostic reason column stays visible on desktop. Unreachable or unavailable target checks show Not checked as warnings; preserve and display failed recheck attempts as well as successful ones. Display unusual files in a `detail-table`: Disk | File | Owner | Permissions | Reason. Paths are monospace; keep at most 50 distinct disk/path rows (blockers take priority over owner warnings) plus “… and {count} more”; total stored JSON stays within 16 KiB. Reasons distinguish unreadable, not removable, special and owner changes. A status trigger with a stored blocker uses an absolutely positioned `notification-dot` with `--status-warn`, and tooltip “Last check: {blocker}”; it never changes trigger geometry. Footer actions remain Check again and Close.

Enrich by share folder plus the first child component relative to an Arr root: exact match first, then an unambiguous case-insensitive match; ambiguous matches stay unmatched. Matched folders take the Arr title, service, instance ID, media ID and type. Folders without an Arr entry use the folder name as title, an empty service and the `cell-sub` “No Radarr/Sonarr entry” (German: “Kein Radarr/Sonarr-Eintrag”). Without Arr entry (Ohne Arr-Eintrag) is a separate status-filter option (`no_arr`), not a disk status. These folders may move under the same safety rules. A share used only by Sonarr treats an unmatched folder as a whole series without season splitting; other unmatched folders act as movies. Keep stable Arr item keys (`type:service:mediaId`) and unmatched-folder keys (`folder:<S>/<name>`) so jobs remain associated across scans.

For Arr-matched Sonarr series, season-folder grouping keeps the existing series-root/season/seasons-spread logic when the series folder spans several devices; a series folder on one device is compact OK or Empty folder according to its metadata-only emptiness check. Arr entries without a folder on any device remain Not found, identifying the missing disk-relative path. Mux path mapping is used only in resolution step 2 above; plan validity is based on the resolved share folders rather than mapping text.

Every scanned folder is searchable, including compact one-device rows. Default placement hides only one-device OK rows and includes Empty folder; explicit All scanned includes them for report drilldowns; an empty search with hidden OK matches offers Show. Not found uses status-error and belongs to Errors. Errors also includes conflicts and insufficient space, so totals and drilldowns describe the same blocked decisions. Seasons spread uses status-info, belongs to presence-based Several disks and cannot start; choose series grouping to consolidate. Root/instance associations remain available for report provenance and enrichment; shared roots display every instance.

The scan report uses a Shares section (German: Freigaben), replacing Folders for placement, with a `detail-table` that fits the report dialog without horizontal scrolling: Share folder | Root folders | Folders | Several disks | One disk | Empty | Without Arr | Missing folders. Short headers carry their full wording (Folders on disks, On several disks, On one disk, Without Arr entry, Arr entries without folder) in `title`. Root paths do not wrap; their instances sit beneath in `cell-sub`, followed by “{count} devices checked” with the device names in its tooltip. Device errors appear as a notice inside the report. Numeric headers/cells align right; count cells are text-buttons that apply list filters, never whole-row actions. All clickable counts use the same SQL predicates as the list, from `placementStatusFilters`; shares use exact stored `share`, devices use stored `devices`. Fetch `/api/placement/report` on opening and list reloads while open so counts remain current after moves. Show Several disks by result below shares, with per-share breakdown and matching drilldowns. Static device lists/errors and unresolved roots remain facts of the scan. When Folders on disks is zero, a notice inside the report states the exact checked path and absence of folders, for example “No folder was found on any device under /unraid/<disk>/documentaries.” Missing choices/path warnings remain in this report, with a text-button Open in settings linking to the Shares card. A warning dot on the report icon signals notices without changing the page layout.

### Unraid Shares settings card

Under the Unraid path fields, a Shares `settings-card` uses `CardHeading` and a `detail-table`: Root folder | Instances | Share folder | Status. It shows only root folders reported by enabled Radarr/Sonarr services, never unrelated shares; a row disappears when no service reports that root. Load roots and first-level share names when opening the card; Check paths in the card heading refreshes them.

Each share-folder select offers Automatic ({detected}), Do not scan and first-level share names for manual association. Choosing a share assigns that existing root; it never adds scan scope. Choose subfolder … opens a second select and only then loads children of the chosen share. Persist optional `unraid.shareDirs` as `arrPath → shareDir | "" | "-"` (empty means automatic, `-` means skip), through the section's Save settings action. A change invalidates the placement plan. This card replaces Apply mapping in result notices. Files & permissions may reuse the display without changing its entry-based behavior.

## Mux selection actions

The Mux page reuses `MuxSelectionActions` with `actions={["remove"]}`, directly after Start selected in `results-tools`. It uses the same confirmation, progress, skipped-job counts and one result toast as the libraries. Running, queued and backed-up jobs cannot be removed in bulk; explain disabled selection in the tooltip. Changing search, filters, sorting or page clears the Mux selection; reloads prune it to the current page. Selection covers every visible job state so drafts can be unmarked and protected selections can be explained; Start selected still accepts only startable jobs. Clear the selection and reload after completion. Controls use `control-md` and the existing wrapping toolbar.

## Changelog of the guide

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
