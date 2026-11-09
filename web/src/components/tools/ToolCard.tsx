import { Bookmark, Download, Trash2 } from "lucide-preact";
import type { ComponentChildren, JSX } from "preact";
import type { useToolPresets } from "../../hooks/useToolPresets";
import { useListPrefs } from "../../hooks/useListPrefs";
import { t, useI18n } from "../../i18n";
import { chipRow, type FilterChip } from "../../tool-filters";
import { toolPresetChoice } from "../../tool-list";
import { ICON } from "../../ui";
import { ChipsRow } from "../list/ChipsRow";
import { FilterBar } from "../list/FilterBar";
import { HelpTip } from "../list/HelpTip";
import { PageNav } from "../list/PageNav";
import { TableCard } from "../list/TableCard";

// A new separator each time: a VNode is never placed twice.
const sep = () => <span class="v2-tc-sep" aria-hidden="true" />;

// The results card of a tool page (docs/STYLEGUIDE.md, Part 1, 10.5 and
// 10.10): a TableCard at the list density, its hint line the activity as
// a polite live region (ruling R-J), with the FilterBar (the search, the
// preset select from toolPresetChoice: “All …”, the tool's presets and
// Custom selection, and the Filters button), the ChipsRow (the tool's
// chips, Reset filters) with the page's tools, then ║ Save preset · Delete
// selected preset (locked without a chosen preset) ║ Export CSV (only
// where the tool exports: a download link with results, else a disabled
// link in its place) ║ Help (the 1.7.0 sections), all sm icon buttons
// (ruling R-I); the PageNav in the foot and the table (or its empty state)
// as its body. The page renders the preset dialogs (presets.dialogs).
export function ToolCard(p: {
  id: string;
  title: string;
  total: number;
  busy: boolean;
  activity?: string;
  search: {
    label: string;
    placeholder: string;
    value: string;
    change(value: string): void;
  };
  presets: ReturnType<typeof useToolPresets>;
  allLabel: string;
  active: boolean;
  filters: {
    count: number;
    expanded: boolean;
    open(anchor: HTMLElement): void;
  };
  chips: FilterChip[];
  reset(): void;
  tools: ComponentChildren;
  csv?: { href: string; enabled: boolean };
  help: { heading: string; text: string; raw?: boolean }[];
  pager: {
    page: number;
    pages: number;
    setPage(page: number): void;
    summary: string;
  };
  children: ComponentChildren;
}): JSX.Element {
  useI18n();
  const { density } = useListPrefs();
  const { presets } = p;
  const choice = toolPresetChoice(
    p.allLabel,
    presets.presets,
    presets.selectedPreset,
    p.active,
  );
  const exportName = t("Export CSV");
  const exportIcon = <Download size={ICON.button} />;
  return (
    <TableCard
      id={p.id}
      title={p.title}
      count={p.total}
      countTitle={t("Items in the list")}
      busy={p.busy}
      hint={p.activity}
      live
      bar={
        <FilterBar
          search={p.search}
          preset={{
            label: t("Filter preset"),
            ...choice,
            choose: (value) => {
              const preset = presets.presets.find(
                (entry) => String(entry.id) === value,
              );
              if (preset) presets.applyPreset(preset);
              else presets.reset();
            },
          }}
          filters={p.filters}
        />
      }
      chips={
        <ChipsRow
          label={t("Filters")}
          chips={chipRow(p.chips)}
          empty={t("No active filters")}
          reset={p.reset}
          tools={
            <>
              {p.tools}
              {sep()}
              <button
                type="button"
                class="v2-icon-btn v2-icon-btn--sm"
                aria-label={t("Save preset")}
                title={t("Save filters as a permanent preset")}
                onClick={presets.savePreset}
              >
                <Bookmark size={ICON.button} />
              </button>
              <button
                type="button"
                class="v2-icon-btn v2-icon-btn--sm"
                aria-label={t("Delete selected preset")}
                title={t("Delete selected preset")}
                disabled={!presets.selectedPreset}
                onClick={() => void presets.deletePreset()}
              >
                <Trash2 size={ICON.button} />
              </button>
              {sep()}
              {p.csv &&
                (p.csv.enabled ? (
                  <a
                    class="v2-icon-btn v2-icon-btn--sm"
                    href={p.csv.href}
                    download
                    aria-label={exportName}
                    title={exportName}
                  >
                    {exportIcon}
                  </a>
                ) : (
                  <span
                    class="v2-icon-btn v2-icon-btn--sm"
                    role="link"
                    aria-disabled="true"
                    aria-label={exportName}
                    title={exportName}
                  >
                    {exportIcon}
                  </span>
                ))}
              {p.csv && sep()}
              <HelpTip label="Help" sections={p.help} />
            </>
          }
        />
      }
      density={density}
      regionLabel={p.title}
      foot={
        <PageNav
          page={p.pager.page}
          pages={p.pager.pages}
          setPage={p.pager.setPage}
          summary={p.pager.summary}
        />
      }
    >
      {p.children}
    </TableCard>
  );
}
