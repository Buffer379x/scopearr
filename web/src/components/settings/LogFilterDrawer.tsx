import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { useToolMatchCount } from "../../hooks/useToolMatchCount";
import { t, useI18n } from "../../i18n";
import type { LogDraft, LogGroup } from "../../settings-model";
import { CheckField } from "../list/CheckField";
import { FilterDrawer } from "../list/FilterDrawer";

const cleared = (): LogDraft => ({ level: [], source: [], instance: [] });
// A draft by its values, whatever their order: an Apply of the same values
// is no change.
const valuesOf = (draft: LogDraft) =>
  JSON.stringify(
    [draft.level, draft.source, draft.instance].map((values) =>
      [...values].sort(),
    ),
  );

// The filter drawer of System → Log (docs/STYLEGUIDE.md, Part 1, 10.5 and
// 11.4; E19, E20), a chunk of its own, loaded on its first opening, on the
// 5a FilterDrawer: “Filters” with the card title as its subtitle and one
// always open CheckField each for Level, Source and Service (logGroups),
// every value choosable, also with no entries (1.7.0). It edits a draft of
// the applied levels, sources and services: Apply hands it over once and
// closes (an Apply without a change only closes), closing discards it,
// Reset clears it. The search applies at once and is no part of it. The
// live count asks countPath(draft) (events?…&limit=1).
export default function LogFilterDrawer({
  subtitle,
  groups,
  initial,
  countPath,
  apply,
  close,
}: {
  subtitle: string;
  groups: LogGroup[];
  initial: LogDraft;
  countPath(draft: LogDraft): string;
  apply(draft: LogDraft): void;
  close(): void;
}): JSX.Element {
  useI18n();
  const [draft, setDraft] = useState(initial);
  // A link to other filters while the drawer is open: its draft starts
  // again from them, so Apply never writes back the filters it left.
  const filters = JSON.stringify(initial);
  const seeded = useRef(filters);
  useEffect(() => {
    if (seeded.current === filters) return;
    seeded.current = filters;
    setDraft(initial);
  }, [filters]);
  const match = useToolMatchCount(countPath(draft));
  return (
    <FilterDrawer
      title={t("Filters")}
      subtitle={subtitle}
      count={match.count}
      stale={match.stale}
      apply={() => {
        if (valuesOf(draft) !== valuesOf(initial)) apply(draft);
        close();
      }}
      reset={() => setDraft(cleared())}
      close={close}
    >
      {groups.map((group) => (
        <CheckField
          key={group.key}
          id={"v2-drawer-" + group.key}
          label={group.label}
          options={group.options}
          selected={draft[group.key]}
          lockEmpty={false}
          change={(values) =>
            setDraft((current) => ({ ...current, [group.key]: values }))
          }
        />
      ))}
    </FilterDrawer>
  );
}
