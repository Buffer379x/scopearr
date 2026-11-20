import { Link2 } from "lucide-preact";
import type { JSX } from "preact";
import { t, useI18n } from "../../i18n";
import { matchingCount, matchingGroups } from "../../media-matching";
import { count, ICON } from "../../ui";
import { HelpTip } from "../list/HelpTip";

// Keeps an empty value's line (a placeholder before the data).
const NBSP = "\u00a0";

// The tones of the four groups, in their order (2.2, ruling R-F).
const TONES = [
  "v2-match--ok",
  "v2-match--error",
  "v2-match--warn",
  "v2-match--off",
];

// Media server matching in the widget row (docs/STYLEGUIDE.md, Part 1,
// 11.3): the files, a stacked bar of the groups with files (decoration: the
// counts stand as text) and the four 1.7.0 groups, each with its HelpTip
// and count. No group is one filter, so none is a link. Without data
// (counts null) the lines keep their place.
export function MatchingCard({
  counts,
  files,
}: {
  counts: Record<string, number> | null;
  files: number | null;
}): JSX.Element {
  useI18n();
  const values = matchingGroups.map((group) =>
    counts ? matchingCount(counts, group.states) : 0,
  );
  return (
    <article class="v2-card v2-widget">
      <div class="v2-widget-head">
        <span class="v2-tile v2-tile--md" aria-hidden="true">
          <Link2 size={ICON.large} />
        </span>
        <div class="v2-widget-name">
          <h2 class="v2-widget-title">{t("Media server matching")}</h2>
          <p class="v2-widget-sub">
            {files === null ? NBSP : t("{count} files", { count: files })}
          </p>
        </div>
      </div>
      <div class="v2-match" aria-hidden="true">
        {values.map((value, i) =>
          value ? (
            <span key={i} class={TONES[i]} style={{ flexGrow: value }} />
          ) : null,
        )}
      </div>
      <ul class="v2-match-list">
        {matchingGroups.map((group, i) => (
          <li key={group.label} class={TONES[i]}>
            {t(group.label)}
            <HelpTip label={group.label} text={group.help} />
            <span class="v2-match-n">{counts ? count(values[i]) : NBSP}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}
