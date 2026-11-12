import type { ComponentChildren, JSX } from "preact";
import type { ToolStatusView } from "../../tool-status";
import { StatusTag } from "../tools/StatusTag";
import { Switch } from "./Switch";

// The card of one service tab (docs/STYLEGUIDE.md, Part 1, 10.11): the
// panel of its tab, with the head (the 40 tile, the name with its provider
// below, the status tag, the actions and, behind a divider, the enable
// switch) and its sections. The first section is always the status
// (callers pass it first).
export function ServiceCard({
  id,
  icon,
  name,
  sub,
  status,
  actions,
  active,
  children,
}: {
  id: string;
  icon: ComponentChildren;
  name: string;
  sub?: string;
  status: ToolStatusView;
  actions?: ComponentChildren;
  active: {
    label: string;
    checked: boolean;
    disabled: boolean;
    change(on: boolean): void;
  };
  children: ComponentChildren;
}): JSX.Element {
  return (
    <section
      class="v2-card v2-svc"
      role="tabpanel"
      id={"service-settings-panel-" + id}
      aria-labelledby={"service-settings-tab-" + id}
    >
      <div class="v2-svc-head">
        <span class="v2-tile v2-tile--grad v2-tile--md" aria-hidden="true">
          {icon}
        </span>
        <h2 class="v2-svc-name">
          {name}
          {sub && <span class="v2-svc-sub">{sub}</span>}
        </h2>
        <StatusTag view={status} />
        <div class="v2-svc-actions">{actions}</div>
        <div class="v2-svc-switch">
          <Switch
            label={active.label}
            checked={active.checked}
            disabled={active.disabled}
            change={active.change}
          />
        </div>
      </div>
      {children}
    </section>
  );
}

// A section of a service card: its heading line (h3 and its actions on the
// right, which wrap below it together) below a divider, then its content.
export function ServiceSection({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ComponentChildren;
  children: ComponentChildren;
}): JSX.Element {
  return (
    <section class="v2-svc-sec">
      <div class="v2-svc-sec-head">
        <h3>{title}</h3>
        {actions && <div class="v2-svc-actions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
