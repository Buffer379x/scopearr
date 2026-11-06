import type { ComponentChildren } from "preact";

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: ComponentChildren;
  title: ComponentChildren;
  children?: ComponentChildren;
}) {
  return (
    <div class="empty-state">
      {icon}
      <h3>{title}</h3>
      {children}
    </div>
  );
}
