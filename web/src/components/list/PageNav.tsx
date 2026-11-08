import { ArrowLeft, ArrowRight } from "lucide-preact";
import type { ComponentChildren, JSX } from "preact";
import { t, useI18n } from "../../i18n";
import { count, ICON } from "../../ui";

// The pages a pager shows: the first and the last, the current one ± 1 and
// a gap for every run of pages between them. Pages below 1 count as one
// page; the current page is kept between 1 and the last.
export function pageWindow(page: number, pages: number): (number | "gap")[] {
  const last = Math.max(1, pages);
  const at = Math.min(Math.max(1, page), last);
  const shown = [...new Set([1, at - 1, at, at + 1, last])]
    .filter((n) => n >= 1 && n <= last)
    .sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  shown.forEach((n, i) => {
    if (i && n - shown[i - 1] > 1) out.push("gap");
    out.push(n);
  });
  return out;
}

// The pager of a table card's footer (docs/STYLEGUIDE.md, Part 1, 10.10):
// nav.v2-pager, named "Page {page} / {pages}", with the summary, Previous
// page, round page buttons (the current one aria-current="page") with gaps,
// and Next page. The page size comes from the settings.
export function PageNav({
  page,
  pages,
  setPage,
  summary,
}: {
  page: number;
  pages: number;
  setPage(page: number): void;
  summary: ComponentChildren;
}): JSX.Element {
  useI18n();
  return (
    <nav
      class="v2-pager"
      aria-label={t("Page {page} / {pages}", { page, pages })}
    >
      <span class="v2-pager-sum">{summary}</span>
      <span class="v2-pager-pages">
        <button
          type="button"
          class="v2-pager-btn"
          aria-label={t("Previous page")}
          title={t("Previous page")}
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          <ArrowLeft size={ICON.button} />
        </button>
        {pageWindow(page, pages).map((entry, i) =>
          entry === "gap" ? (
            <span key={"gap" + i} class="v2-pager-gap" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={entry}
              type="button"
              class="v2-pager-btn"
              aria-current={entry === page ? "page" : undefined}
              onClick={() => entry !== page && setPage(entry)}
            >
              {count(entry)}
            </button>
          ),
        )}
        <button
          type="button"
          class="v2-pager-btn"
          aria-label={t("Next page")}
          title={t("Next page")}
          disabled={page >= pages}
          onClick={() => setPage(page + 1)}
        >
          <ArrowRight size={ICON.button} />
        </button>
      </span>
    </nav>
  );
}
