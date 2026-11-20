import type { JSX } from "preact";
import { t, useI18n } from "../../i18n";
import type { NavTarget } from "../../router";
import type { Service } from "../../types";
import { Segmented } from "../list/Segmented";

// The instance segment in the library's page header (docs/STYLEGUIDE.md,
// Part 1, 10.6): with more than one enabled instance of the service, a
// named nav “Instances” on the band of “All” and one link per instance to
// {view: "library", service, instance}, opened through the caller's
// openLink like the sidebar's sub-entries; the shown instance filter is
// current (aria-current="page"), an unknown one leaves “All” current.
export function InstanceSegment({
  service,
  instances,
  current,
  hrefOf,
  open,
}: {
  service: Service;
  instances: { id: string; name: string }[];
  current: string;
  hrefOf(target: NavTarget): string;
  open(target: NavTarget): void;
}): JSX.Element {
  useI18n();
  const target = (instance: string): NavTarget => ({
    view: "library",
    service,
    instance,
  });
  return (
    <Segmented
      label={t("Instances")}
      kind="links"
      onBand
      value={
        instances.some((instance) => instance.id === current) ? current : ""
      }
      items={[
        { value: "", label: t("All"), href: hrefOf(target("")) },
        ...instances.map((instance) => ({
          value: instance.id,
          label: instance.name,
          href: hrefOf(target(instance.id)),
        })),
      ]}
      select={(value) => open(target(value))}
    />
  );
}
