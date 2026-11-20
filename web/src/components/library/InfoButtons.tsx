import { Film, Link2 } from "lucide-preact";
import type { JSX } from "preact";
import { entryLink } from "../../entry-link";
import { t, useI18n } from "../../i18n";
import { instanceByID, instanceLabel } from "../../instances";
import type { MediaFile, Settings } from "../../types";
import { ICON } from "../../ui";
import { RowButton } from "../list/RowButton";
import { MediaLinkButton } from "./MediaLinkButton";

// The info icons of a library row (Settings → Display → Lists, as in
// 1.7.0): link, media and details are buttons of the Info column, metadata,
// recognition and mux marks after the title (ruling R-H).
export const infoOrder = [
  "link",
  "media",
  "details",
  "metadata",
  "recognition",
  "mux",
];
// The keys of `of` the settings show, in their order (without settings
// every key, in the 1.7.0 order).
export function infoShown(settings: Settings | null, of: string[]): string[] {
  const visible = settings?.listInfoVisible || infoOrder;
  return (settings?.listInfoOrder || infoOrder).filter(
    (key) => of.includes(key) && visible.includes(key),
  );
}

// The Info column (docs/STYLEGUIDE.md, Part 1, 10.10): RowButtons in the
// saved order and visibility. The entry link opens the Radarr or Sonarr
// entry in a new tab, locked with its hint while there is no address; the
// media server button is MediaLinkButton; File & metadata opens the
// dialog, its title the filename.
export function InfoButtons({
  file,
  settings,
  openDetails,
}: {
  file: MediaFile;
  settings: Settings | null;
  openDetails(): void;
}): JSX.Element {
  useI18n();
  const instance = instanceByID(settings, file.service);
  const href = entryLink(instance, file);
  const buttons: Record<string, JSX.Element> = {
    link: (
      <RowButton
        key="link"
        label={t("Open {service} entry in a new tab", {
          service: instanceLabel(instance || { id: file.service }),
        })}
        title={
          href
            ? undefined
            : t(
                "Entry link unavailable. Configure the service and synchronize the library.",
              )
        }
        icon={<Link2 size={ICON.row} />}
        href={href}
        newTab
        disabled={!href}
      />
    ),
    media: <MediaLinkButton key="media" file={file} settings={settings} />,
    details: (
      <RowButton
        key="details"
        label={t("Filename and metadata: {title}", { title: file.title })}
        title={file.filename}
        icon={<Film size={ICON.row} />}
        onClick={openDetails}
      />
    ),
  };
  return (
    <div class="v2-table-items">
      {infoShown(settings, ["link", "media", "details"]).map(
        (key) => buttons[key],
      )}
    </div>
  );
}
