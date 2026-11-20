import type { ComponentChildren, JSX } from "preact";
import { t, useI18n } from "../../i18n";
import {
  statusLabel,
  statusRows,
  type ServiceKind,
  type StatusKey,
} from "../../settings-model";
import type { ToolStatusView } from "../../tool-status";
import { StatusTag } from "../tools/StatusTag";
import { KeyValues } from "./KeyValues";

// A service's status (docs/STYLEGUIDE.md, Part 1, 10.11, ruling R-I): the
// fixed rows of its kind in two columns, always rendered; a missing value
// reads "—", so the card never grows while it polls.
export function ServiceStatus({
  kind,
  values,
}: {
  kind: ServiceKind;
  values: Partial<Record<StatusKey, ComponentChildren>>;
}): JSX.Element {
  useI18n();
  return (
    <KeyValues
      columns={2}
      rows={statusRows(kind).map((key) => ({
        key,
        label: t(statusLabel(key)),
        value: values[key],
      }))}
    />
  );
}

// A Status value (ruling P4, E22): the tag and, when it has more to say (an
// error), its long text on the same line, cut with an ellipsis and whole in
// its title; screen readers read it whole.
export function StatusValue({ view }: { view: ToolStatusView }): JSX.Element {
  return (
    <span class="v2-kv-line">
      <StatusTag view={view} />
      {view.long !== view.text && (
        <span class="v2-kv-long" title={view.long}>
          {view.long}
        </span>
      )}
    </span>
  );
}
