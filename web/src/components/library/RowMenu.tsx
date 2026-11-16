import { EllipsisVertical, Film, Info, Link2, Play, Tag } from "lucide-preact";
import type { JSX } from "preact";
import { useContext, useState } from "preact/hooks";
import { entryLink } from "../../entry-link";
import { t, useI18n } from "../../i18n";
import { instanceByID, instanceLabel } from "../../instances";
import { mediaEntryChoices } from "../../media-link";
import { tagIsDisplayed } from "../../tag-display";
import type { MediaFile, Settings } from "../../types";
import { HiddenTags, ICON } from "../../ui";
import { AutoTagDialog } from "../dialog/AutoTagDialog";
import { Popover } from "../frame/Popover";
import { autoTagHint } from "../list/CustomTag";
import { infoShown } from "./InfoButtons";

// A link entry of the menu: a menuitem link into a new tab, or without its
// target a disabled entry with the reason in its title.
function linkItem(
  key: string,
  label: string,
  href: string,
  hint: string,
  icon: JSX.Element,
  done: () => void,
) {
  return href ? (
    <a
      key={key}
      role="menuitem"
      class="v2-menu-item"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      referrerPolicy="no-referrer"
      onClick={done}
    >
      {icon}
      <span class="v2-menu-text">{label}</span>
    </a>
  ) : (
    <span
      key={key}
      role="menuitem"
      class="v2-menu-item"
      aria-disabled="true"
      title={hint}
    >
      {icon}
      <span class="v2-menu-text">{label}</span>
    </span>
  );
}

// The row menu of a phone card (docs/STYLEGUIDE.md, Part 1, 10.10; rc.4
// R6): one ⋮ button at the end of the card (36, a 44 hit area), named
// "Actions: {title}", that opens a Popover menu. The menu starts with the
// filename (a plain line, not an entry), then "Filename and metadata"
// (named "Filename and metadata: {title}" as the Info button, titled with
// the filename) and "Edit custom tags" (named "Edit custom tags: {title}"
// as the custom tags' button), then the Info column's links in the order
// and visibility of the settings: the service entry and the media server
// entries (one per server, as MediaLinkButton's choices), each locked with
// its hint while it has no address, and last an entry "Auto tag: {name}"
// per shown auto tag of the file (titled with its explanation), which
// opens External auto-tag: the chip line's auto mark is no target, so the
// explanation the custom tags cell's mark opens stays one tap away. A
// choice returns focus to the button
// and closes the menu before its action runs; Escape returns focus too.
export function RowMenu({
  file,
  settings,
  openDetails,
  editTags,
}: {
  file: MediaFile;
  settings: Settings | null;
  openDetails(): void;
  editTags(): void;
}): JSX.Element {
  useI18n();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [hint, setHint] = useState("");
  const hidden = useContext(HiddenTags);
  const autos = (file.custom || []).filter(
    (tag) => tag.protected && tagIsDisplayed(hidden, "custom", String(tag.id)),
  );
  const name = t("Actions: {title}", { title: file.title });
  const done = () => {
    anchor?.focus();
    setAnchor(null);
  };
  const run = (action: () => void) => () => {
    done();
    action();
  };
  const links = (key: string): JSX.Element[] => {
    if (key === "link") {
      const instance = instanceByID(settings, file.service);
      return [
        linkItem(
          "link",
          t("Open {service} entry in a new tab", {
            service: instanceLabel(instance || { id: file.service }),
          }),
          entryLink(instance, file) || "",
          t(
            "Entry link unavailable. Configure the service and synchronize the library.",
          ),
          <Link2 size={ICON.row} />,
          done,
        ),
      ];
    }
    const unavailable = t(
      "Media server link unavailable. Synchronize the library and check the file mapping.",
    );
    return mediaEntryChoices(settings, file).map((choice) =>
      linkItem(
        "media-" + choice.provider,
        t("Open {service} entry in a new tab", { service: choice.label }),
        choice.href || "",
        unavailable,
        <Play size={ICON.row} />,
        done,
      ),
    );
  };
  return (
    <>
      <button
        type="button"
        class="v2-table-act"
        aria-label={name}
        title={t("Actions")}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        onClick={(event) =>
          setAnchor(anchor ? null : (event.currentTarget as HTMLElement))
        }
      >
        <EllipsisVertical size={ICON.large} />
      </button>
      {anchor && (
        <Popover
          anchor={anchor}
          placement="bottom-end"
          role="menu"
          label={name}
          close={() => setAnchor(null)}
        >
          <p class="v2-menu-file" role="none">
            {file.filename}
          </p>
          <div role="separator" class="v2-menu-sep" />
          <button
            type="button"
            role="menuitem"
            class="v2-menu-item"
            aria-label={t("Filename and metadata: {title}", {
              title: file.title,
            })}
            title={file.filename}
            onClick={run(openDetails)}
          >
            <Film size={ICON.row} />
            <span class="v2-menu-text">{t("Filename and metadata")}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            class="v2-menu-item"
            aria-label={t("Edit custom tags: {title}", { title: file.title })}
            onClick={run(editTags)}
          >
            <Tag size={ICON.row} />
            <span class="v2-menu-text">{t("Edit custom tags")}</span>
          </button>
          {infoShown(settings, ["link", "media"]).flatMap(links)}
          {autos.map((tag) => {
            const explanation = autoTagHint(tag, settings);
            return (
              <button
                key={"auto-" + tag.id}
                type="button"
                role="menuitem"
                class="v2-menu-item"
                title={explanation}
                onClick={run(() => setHint(explanation))}
              >
                <Info size={ICON.row} />
                <span class="v2-menu-text">
                  {t("Auto tag: {name}", {
                    name: tag.displayName || tag.name,
                  })}
                </span>
              </button>
            );
          })}
        </Popover>
      )}
      {hint && <AutoTagDialog hint={hint} close={() => setHint("")} />}
    </>
  );
}
