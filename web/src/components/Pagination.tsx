import type { ComponentChildren } from "preact";
import { ArrowLeft, ArrowRight } from "lucide-preact";
import { t } from "../i18n";
import { ICON } from "../ui";

export function Pagination({
  page,
  pages,
  setPage,
  summary,
  summaryTitle,
  buttonType,
}: {
  page: number;
  pages: number;
  setPage: (page: number) => void;
  summary: ComponentChildren;
  summaryTitle?: string;
  buttonType?: "button";
}) {
  return (
    <div class="pagination">
      <span title={summaryTitle}>{summary}</span>
      <div>
        <button
          type={buttonType}
          class="icon-button"
          aria-label={t("Previous page")}
          title={t("Previous page")}
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          <ArrowLeft size={ICON.button} />
        </button>
        <span>{t("Page {page} / {pages}", { page, pages })}</span>
        <button
          type={buttonType}
          class="icon-button"
          aria-label={t("Next page")}
          title={t("Next page")}
          disabled={page >= pages}
          onClick={() => setPage(page + 1)}
        >
          <ArrowRight size={ICON.button} />
        </button>
      </div>
    </div>
  );
}
