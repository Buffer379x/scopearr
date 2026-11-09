import { CircleAlert, ListFilter } from "lucide-preact";
import type { JSX } from "preact";
import { t, useI18n } from "../../i18n";
import { count as formatCount, ICON } from "../../ui";
import { NavLink } from "../frame/NavLink";

// Keeps an empty value's line (a placeholder before the data).
const NBSP = "\u00a0";

// Incomplete metadata in the widget row (docs/STYLEGUIDE.md, Part 1,
// 11.3): the count of the whole library with the 1.7.0 explanation, and
// "Show", a NavLink to metadata=incomplete in the scope's service. Its name
// starts with the visible "Show" (WCAG 2.5.3), then the 1.7.0 filter name.
// Without data (count null) the number keeps its line.
export function IncompleteCard({
  count,
  href,
  open,
}: {
  count: number | null;
  href: string;
  open(): void;
}): JSX.Element {
  useI18n();
  const name =
    t("Show") +
    " · " +
    t("Filter {field}: {value}", {
      field: t("Metadata status"),
      value: t("incomplete"),
    });
  return (
    <article class="v2-card v2-widget">
      <div class="v2-widget-head">
        <span class="v2-tile v2-tile--md v2-tile--warn" aria-hidden="true">
          <CircleAlert size={ICON.large} />
        </span>
        <h2 class="v2-widget-title">{t("Incomplete metadata")}</h2>
      </div>
      <p class="v2-widget-num">{count === null ? NBSP : formatCount(count)}</p>
      <p class="v2-widget-text">
        {t(
          "Resolution, codec, source, audio and language; HDR may be SDR or unknown.",
        )}
      </p>
      <NavLink class="v2-btn v2-btn--sm" href={href} open={open} label={name}>
        <ListFilter size={ICON.button} aria-hidden="true" />
        {t("Show")}
      </NavLink>
    </article>
  );
}
