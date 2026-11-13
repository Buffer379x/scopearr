import { ArrowLeft, ArrowRight } from "lucide-preact";
import type { ComponentChildren, JSX } from "preact";
import { t, useI18n } from "../../i18n";
import { count, ICON } from "../../ui";

// The summary of a pager: the items of the page and the total.
export function itemRange(page: number, limit: number, total: number) {
  return t("{from}–{to} of {total}", {
    from: total ? count((page - 1) * limit + 1) : "0",
    to: count(Math.min(page * limit, total)),
    total: count(total),
  });
}

// The slots of a pager: every page up to seven pages, else seven: the
// first and the last page, the current one ± 1 and gaps, filled from the
// near end (1–5 … last, 1 … last − 4 – last). Their number stays the same
// for a page count, so paging moves no button, and a gap hides at least
// two pages (never 1 … 3). Pages below 1 count as one page; the current
// page is kept between 1 and the last.
const PAGE_SLOTS = 7;
export function pageWindow(page: number, pages: number): (number | "gap")[] {
  const last = Math.max(1, pages);
  const at = Math.min(Math.max(1, page), last);
  const run = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i);
  if (last <= PAGE_SLOTS) return run(1, last);
  if (at <= 4) return [...run(1, 5), "gap", last];
  if (at >= last - 3) return [1, "gap", ...run(last - 4, last)];
  return [1, "gap", at - 1, at, at + 1, "gap", last];
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
