import { createContext, type ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { useContext, useLayoutEffect } from "preact/hooks";

// What the frame gives a page header: its slot on the band (in main, before
// the page) and where the title goes for the phone topbar. Without it (a
// page outside the frame) the header renders in place.
export const PageTitleContext = createContext<{
  slot: HTMLElement | null;
  setTitle(title: string): void;
} | null>(null);

// The page header on the band (docs/STYLEGUIDE.md, Part 1, 10.1), at the
// fixed height --ph-h: the title, its summary and the slot for actions. The
// summary line and the slot are always there, so the title keeps its place
// on every page. In the frame it renders into the band slot, before the page
// content, and reports its title.
export function PageHeader({
  title,
  meta,
  metaTitle,
  actions,
  as = "div",
}: {
  title: string;
  meta?: ComponentChildren;
  metaTitle?: string;
  actions?: ComponentChildren;
  as?: "section" | "div";
}) {
  const frame = useContext(PageTitleContext);
  useLayoutEffect(() => {
    if (!frame) return;
    frame.setTitle(title);
    return () => frame.setTitle("");
  }, [frame, title]);
  const Root = as;
  const head = (
    <Root class="v2-page-head">
      <div class="v2-page-text">
        <h1 class="v2-page-title">{title}</h1>
        <p class="v2-page-sum" title={metaTitle}>
          {meta}
        </p>
      </div>
      <div class="v2-page-actions">{actions}</div>
    </Root>
  );
  if (!frame) return head;
  return frame.slot ? createPortal(head, frame.slot) : null;
}
