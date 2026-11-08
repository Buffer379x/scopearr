import type { ComponentChildren } from "preact";
import { useContext } from "preact/hooks";
import { colorStyle } from "../color";
import { t, useI18n } from "../i18n";
import { tagPresentation } from "../tag-display";
import {
  CustomTagNames,
  defaultColor,
  HiddenTags,
  SDListGrouping,
  TagColors,
  TagInformation,
  TagLabels,
  TagTextColors,
  TagVisibility,
} from "../ui";

// The 1.7.0 media tag (docs/STYLEGUIDE.md, Part 2, Tags and badges), until
// its last user goes in Phase 5d. It lives outside ui.tsx, so the start chunk
// carries neither it nor tagPresentation (ruling P1), and renders what
// tagPresentation decides, as MediaTag does; its DOM is that of 1.7.0.
export function Tag({
  value,
  kind = "source",
  title,
  colors,
  textColors,
  label,
  forceTag = false,
  respectHidden = false,
  children,
}: {
  label?: string;
  forceTag?: boolean;
  respectHidden?: boolean;
  children?: ComponentChildren;
  colors?: Record<string, string>;
  textColors?: Record<string, string>;
  value: string;
  kind?: string;
  title?: string;
}) {
  useI18n();
  const visibility = useContext(TagVisibility);
  const tagLabels = useContext(TagLabels);
  const groupSD = useContext(SDListGrouping);
  const information = useContext(TagInformation);
  const customNames = useContext(CustomTagNames);
  const inherited = useContext(TagColors);
  const inheritedText = useContext(TagTextColors);
  const hidden = useContext(HiddenTags);
  const shown = tagPresentation({
    value,
    kind,
    label,
    forceTag,
    respectHidden,
    visibility,
    information,
    hidden,
    colors: colors || inherited,
    textColors: textColors || inheritedText,
    customNames,
    tagLabels,
    groupSD,
    translate: t,
  });
  if (!shown) return null;
  // Bit depth, channels and language have a default color in 1.7.0.
  const color =
    shown.color ||
    (["bitDepth", "channels", "language"].includes(kind)
      ? defaultColor(kind, value)
      : undefined);
  return (
    <span
      style={shown.asTag ? colorStyle(color, shown.textColor) : undefined}
      class={
        shown.asTag
          ? "tag " + kind + (shown.unknown ? " unknown" : "")
          : "tag-info-only"
      }
      title={title || shown.title}
    >
      {children || shown.text}
    </span>
  );
}
