import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { useToolMatchCount } from "../../hooks/useToolMatchCount";
import { t, useI18n } from "../../i18n";
import type { ToolDraft, ToolGroup } from "../../tool-list";
import { CheckField } from "../list/CheckField";
import { FilterDrawer } from "../list/FilterDrawer";

// The drawer's fields are include-only lists; Reset clears them and keeps
// the target, which is no field (a chip from the scan report).
const cleared = (draft: ToolDraft): ToolDraft => ({
  ...draft,
  statuses: [],
  kinds: [],
  shares: [],
});

// The filter drawer of a tool page (docs/STYLEGUIDE.md, Part 1, 10.5), a
// chunk of its own (drawer-chunk.ts, ruling I4), on the 5a FilterDrawer:
// “Filters” with the card title as its subtitle, one always open
// CheckField per group, in the tool's 1.7.0 order. It edits a draft
// (ToolDraft) of the applied filters: Apply hands it over once and closes,
// closing discards it, Reset clears statuses, kinds and shares. The live
// count asks countPath(draft) through useToolMatchCount (Disk placement,
// Files & permissions) or counts localCount(draft) (Mux, no request).
export default function ToolFilterDrawer({
  subtitle,
  groups,
  initial,
  countPath,
  localCount,
  apply,
  close,
}: {
  subtitle: string;
  groups: ToolGroup[];
  initial: ToolDraft;
  countPath?(draft: ToolDraft): string;
  localCount?(draft: ToolDraft): number;
  apply(draft: ToolDraft): void;
  close(): void;
}): JSX.Element {
  useI18n();
  const [draft, setDraft] = useState(initial);
  // Back or Forward while the drawer is open brings other filters: the
  // drawer stays open, and its draft starts again from them, so Apply
  // never writes back the filters the step left (5a ruling M2, M16). The
  // page builds `initial` anew on each render, so it compares by value.
  const filters = JSON.stringify(initial);
  const seeded = useRef(filters);
  useEffect(() => {
    if (seeded.current === filters) return;
    seeded.current = filters;
    setDraft(initial);
  }, [filters]);
  const remote = useToolMatchCount(countPath ? countPath(draft) : null);
  const match =
    !countPath && localCount
      ? { count: localCount(draft), stale: false }
      : remote;
  return (
    <FilterDrawer
      title={t("Filters")}
      subtitle={subtitle}
      count={match.count}
      stale={match.stale}
      apply={() => {
        apply(draft);
        close();
      }}
      reset={() => setDraft(cleared)}
      close={close}
    >
      {groups.map((group) => (
        <CheckField
          key={group.key}
          id={"v2-drawer-" + group.key}
          label={group.label}
          options={group.options}
          selected={draft[group.key]}
          change={(values) =>
            setDraft((current) => ({ ...current, [group.key]: values }))
          }
        />
      ))}
    </FilterDrawer>
  );
}
