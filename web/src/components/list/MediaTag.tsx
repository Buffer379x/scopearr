import type { ComponentChildren, JSX } from "preact";
import { useContext } from "preact/hooks";
import { userColorStyle } from "../../color";
import { t, useI18n } from "../../i18n";
import { tagPresentation } from "../../tag-display";
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

// Resolutions with a palette of their own beside the resolution palette.
const RESOLUTIONS = ["2160p", "4320p", "720p"];

// The v2 media tag (docs/STYLEGUIDE.md, Part 1, 2.5 and 10.7): what
// tagPresentation decides, as the 1.7.0 Tag. A tag is span.v2-tag with its
// kind (v2-tag--<kind>; v2-tag--r2160p, --r4320p or --r720p for those
// resolutions, v2-tag--neutral for SDR, v2-tag--unknown when empty); a kind
// without a palette of its own takes the neutral base tone. An
// information-only value is span.v2-tag-text.
export function MediaTag({
  value,
  kind = "source",
  title,
  label,
  forceTag = false,
  respectHidden = false,
  children,
}: {
  value: string;
  kind?: string;
  title?: string;
  label?: string;
  forceTag?: boolean;
  respectHidden?: boolean;
  children?: ComponentChildren;
}): JSX.Element | null {
  useI18n();
  const visibility = useContext(TagVisibility);
  const tagLabels = useContext(TagLabels);
  const groupSD = useContext(SDListGrouping);
  const information = useContext(TagInformation);
  const customNames = useContext(CustomTagNames);
  const colors = useContext(TagColors);
  const textColors = useContext(TagTextColors);
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
    colors,
    textColors,
    customNames,
    tagLabels,
    groupSD,
    translate: t,
  });
  if (!shown) return null;
  const content = children || shown.text;
  if (!shown.asTag)
    return (
      <span class="v2-tag-text" title={title || shown.title}>
        {content}
      </span>
    );
  const k = shown.kindKey;
  return (
    <span
      class={
        "v2-tag v2-tag--" +
        k +
        (k === "resolution" && RESOLUTIONS.includes(value)
          ? " v2-tag--r" + value
          : "") +
        (k === "hdr" && value === "SDR" ? " v2-tag--neutral" : "") +
        (shown.unknown ? " v2-tag--unknown" : "")
      }
      style={userColorStyle(shown.color, shown.textColor)}
      title={title || shown.title}
    >
      {content}
    </span>
  );
}
