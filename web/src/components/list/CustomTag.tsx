import type { JSX } from "preact";
import { useContext, useState } from "preact/hooks";
import { instanceByID, instanceLabel } from "../../instances";
import { t, useI18n } from "../../i18n";
import { tagPresentation } from "../../tag-display";
import type { CustomTag as CustomTagType, Settings } from "../../types";
import {
  CustomTagNames,
  HiddenTags,
  SDListGrouping,
  TagColors,
  TagInformation,
  TagLabels,
  TagTextColors,
  TagVisibility,
} from "../../ui";
import { AutoTagDialog } from "../dialog/AutoTagDialog";

// The explanation of an auto tag: who uses it and that the service controls it.
export function autoTagHint(tag: CustomTagType, settings?: Settings | null) {
  return [
    t("Used by external auto-tag rules"),
    ...(tag.rules || []).map((rule) => {
      const [id, ...rest] = rule.split(" · ");
      return [
        instanceLabel(instanceByID(settings, id) || { id }),
        ...rest,
      ].join(" · ");
    }),
    t("Assignments and deletion are controlled by the service."),
  ].join("\n");
}

// A custom tag in media-tag form (docs/STYLEGUIDE.md, Part 1, 2.5 and 10.7):
// span.v2-ctag, with a valid user color as --ct and its mixes
// (v2-ctag--user) and the user's black or white text color, else the
// neutral tone. Hidden and information-only values follow tagPresentation
// as in the 1.7.0 table (a manual or auto tag stays a tag). The title is an
// auto tag's explanation, else its name; the auto mark (button.v2-ctag-auto)
// opens the explanation in AutoTagDialog (Phase 5d). `plain` (a phone
// card's chip line, rc.4 R6) keeps the mark as a span without its button:
// the tag stays titled with the explanation, and nothing in the line is a
// target.
export function CustomTag({
  tag,
  settings,
  plain = false,
}: {
  tag: CustomTagType;
  settings: Settings | null;
  plain?: boolean;
}): JSX.Element | null {
  useI18n();
  const [open, setOpen] = useState(false);
  const visibility = useContext(TagVisibility);
  const tagLabels = useContext(TagLabels);
  const groupSD = useContext(SDListGrouping);
  const information = useContext(TagInformation);
  const customNames = useContext(CustomTagNames);
  const colors = useContext(TagColors);
  const textColors = useContext(TagTextColors);
  const hidden = useContext(HiddenTags);
  const name = tag.displayName || tag.name;
  const shown = tagPresentation({
    value: String(tag.id),
    kind: "custom",
    label: name,
    forceTag: !!(tag.manual || tag.protected),
    respectHidden: true,
    visibility,
    information,
    hidden,
    colors,
    textColors,
    customNames,
    tagLabels,
    groupSD,
    translate: t,
  });
  if (!shown) return null;
  if (!shown.asTag)
    return (
      <span class="v2-tag-text" title={name}>
        {name}
      </span>
    );
  const auto = !!tag.protected;
  const hint = auto ? autoTagHint(tag, settings) : "";
  const color =
    shown.color && /^#[0-9a-f]{6}$/i.test(shown.color) ? shown.color : "";
  // The user's black or white text color stays the text, as in 1.7.0
  // (colorStyle takes only these two); without one the mixes derive it
  // from --ct.
  const text =
    shown.textColor === "#000000" || shown.textColor === "#ffffff"
      ? shown.textColor
      : "";
  return (
    <span
      class={"v2-ctag" + (color ? " v2-ctag--user" : "")}
      style={
        color
          ? text
            ? { "--ct": color, color: text }
            : { "--ct": color }
          : undefined
      }
      title={hint || name}
    >
      {auto &&
        (plain ? (
          <span class="v2-ctag-auto" aria-hidden="true">
            A
          </span>
        ) : (
          <button
            type="button"
            class="v2-ctag-auto"
            aria-label={hint}
            title={hint}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setOpen(true);
            }}
          >
            A
          </button>
        ))}
      {name}
      {auto && open && (
        <AutoTagDialog hint={hint} close={() => setOpen(false)} />
      )}
    </span>
  );
}
