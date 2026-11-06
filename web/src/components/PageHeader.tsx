import type { ComponentChildren } from "preact";

export function PageHeader({
  title,
  meta,
  metaTitle,
  as = "section",
}: {
  title: ComponentChildren;
  meta?: ComponentChildren;
  metaTitle?: string;
  as?: "section" | "div";
}) {
  const Root = as;
  return (
    <Root class="library-intro">
      <h1>{title}</h1>
      {meta !== undefined && <span title={metaTitle}>{meta}</span>}
    </Root>
  );
}
