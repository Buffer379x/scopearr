import { ChartNoAxesColumnIncreasing } from "lucide-preact";
import type { JSX } from "preact";
import { useContext, useState } from "preact/hooks";
import { distributionRows } from "../../dashboard-model";
import { getLocale, t, useI18n } from "../../i18n";
import { audioLanguageLabel } from "../../languages";
import { presentedTagLabel } from "../../tag-labels";
import { count, ICON, labels, percent, TagLabels } from "../../ui";
import { NavLink } from "../frame/NavLink";
import { LanguageFlag } from "../LanguageFlag";
import { MediaTag } from "../list/MediaTag";

// Keeps an empty value's line (a placeholder before the data).
const NBSP = "\u00a0";

// A distribution card (docs/STYLEGUIDE.md, Part 1, 10.10): the 1.7.0
// chart's values as rows. Each value (its media tag, or flag and name for a
// language) is a NavLink named as 1.7.0's button, "Filter {field}:
// {value}", to hrefOf and open of the value; then its count, its percent of
// total and a bar in --chart-1 (Unknown in --muted). The head counts the
// scope's files (`files`), whatever the shares divide by. User tag colors color
// the tag, never the bar (ruling R-F). Five rows show; More shows all and
// Less five again. The body reserves five rows and the More row, so the
// card has its height before its data (buckets and total null) and only
// grows below its content when More opens.
export function DistributionCard({
  field,
  buckets,
  total,
  files,
  hrefOf,
  open,
}: {
  field: string;
  buckets: { value: string; count: number }[] | null;
  total: number | null;
  files: number | null;
  hrefOf(value: string): string;
  open(value: string): void;
}): JSX.Element {
  useI18n();
  const [expanded, setExpanded] = useState(false);
  const tagLabels = useContext(TagLabels);
  const name = (value: string) =>
    field === "language"
      ? t(audioLanguageLabel(value, getLocale()))
      : presentedTagLabel(field, value, tagLabels) || t("Unknown");
  const { rows, hidden } = distributionRows(
    buckets || [],
    total || 0,
    expanded,
  );
  return (
    <article class="v2-card v2-dist">
      <div class="v2-dist-head">
        <h3>{field === "audio" ? t("Audio") : labels[field]}</h3>
        <span class="v2-dist-sub">
          {files === null ? NBSP : t("{count} files", { count: files })}
        </span>
      </div>
      <div class="v2-dist-body">
        {buckets === null ? null : !total ? (
          <div class="v2-empty">
            <span class="v2-tile v2-tile--lg" aria-hidden="true">
              <ChartNoAxesColumnIncreasing size={ICON.empty} />
            </span>
            <p>{t("No files in cache yet")}</p>
          </div>
        ) : (
          rows.map((row) => (
            <div key={row.value} class="v2-dist-row">
              <NavLink
                class="v2-dist-go"
                href={hrefOf(row.value)}
                open={() => open(row.value)}
                label={t("Filter {field}: {value}", {
                  field: labels[field],
                  value: name(row.value),
                })}
              >
                {field === "language" ? (
                  <>
                    <LanguageFlag value={row.value} focusable={false} />
                    <span>{name(row.value)}</span>
                  </>
                ) : (
                  <MediaTag value={row.value} kind={field} />
                )}
              </NavLink>
              <span class="v2-dist-n">{count(row.count)}</span>
              <span class="v2-dist-pct">{percent(row.share)}</span>
              <span
                class={
                  row.unknown
                    ? "v2-dist-bar v2-dist-bar--unknown"
                    : "v2-dist-bar"
                }
                aria-hidden="true"
              >
                <span style={{ width: row.share + "%" }} />
              </span>
            </div>
          ))
        )}
        {!!total && hidden > 0 && (
          <button
            type="button"
            class="v2-text-btn"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {t(expanded ? "Less" : "More")}
          </button>
        )}
      </div>
    </article>
  );
}
