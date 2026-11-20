import { isSDResolution, SD_RESOLUTION } from "./resolution-groups.ts";
import { presentedTagLabel } from "./tag-labels.ts";

// A presentation preference only: never changes stored traits, queries or totals.
export function tagDisplayKey(field: string, value: string) {
  return field.split(" ")[0] + ":" + (value || "__unknown__");
}
export function tagIsDisplayed(
  hidden: Record<string, boolean>,
  field: string,
  value: string,
) {
  return hidden[tagDisplayKey(field, value)] !== true;
}

// A media tag and what decides how it shows: its value and kind (a field,
// "resolution r2160p" in the 1.7.0 form), the caller's options and the
// display settings of the tag contexts (ui.tsx).
export type TagInput = {
  value: string;
  kind: string;
  label?: string;
  forceTag?: boolean;
  respectHidden?: boolean;
  visibility: Record<string, string[]> | null;
  information: Record<string, string[]>;
  hidden: Record<string, boolean>;
  colors: Record<string, string>;
  textColors: Record<string, string>;
  customNames: Record<string, string>;
  tagLabels: Record<string, string>;
  groupSD: boolean;
  translate(key: string): string;
};
export type TagPresentation = {
  asTag: boolean;
  text: string;
  kindKey: string;
  unknown: boolean;
  sd: boolean;
  title?: string;
  color?: string;
  textColor?: string;
};

// The one decision the 1.7.0 Tag and MediaTag render (docs/STYLEGUIDE.md,
// Part 1, 2.5): null when respectHidden hides the value (or its SD group);
// else a tag (asTag) or, for an information-only value or one outside the
// visible list, plain text. With the SD group every SD resolution shows as
// SD, its value as title. The text comes from the custom tag names, the
// label, the tag labels or "Unknown"; color and textColor are the user's
// colors of the shown value, if any.
export function tagPresentation(input: TagInput): TagPresentation | null {
  const { value, kind, label, forceTag = false, respectHidden = false } = input;
  const kindKey = kind.split(" ")[0];
  const sd =
    kindKey === "resolution" &&
    (value === SD_RESOLUTION ||
      (respectHidden && input.groupSD && isSDResolution(value)));
  const shown = sd ? SD_RESOLUTION : value;
  if (
    respectHidden &&
    (!tagIsDisplayed(input.hidden, kind, value) ||
      !tagIsDisplayed(input.hidden, kind, shown))
  )
    return null;
  const key = tagDisplayKey(kind, shown);
  const visibility = input.visibility;
  const asTag =
    sd ||
    forceTag ||
    (!(input.information[kindKey] || []).includes(value) &&
      (!visibility ||
        !Object.hasOwn(visibility, kindKey) ||
        (visibility[kindKey] || []).includes(value || "__unknown__")));
  return {
    asTag,
    text:
      kind === "custom"
        ? input.customNames[value] ||
          label ||
          value ||
          input.translate("Unknown")
        : label ||
          presentedTagLabel(kind, shown, input.tagLabels) ||
          input.translate("Unknown"),
    kindKey,
    unknown: !value,
    sd,
    title: sd && value !== SD_RESOLUTION ? value : undefined,
    color: input.colors[key] || undefined,
    textColor: input.textColors[key] || undefined,
  };
}
