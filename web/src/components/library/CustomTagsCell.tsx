import { Tag as TagIcon } from "lucide-preact";
import type { JSX } from "preact";
import { useContext } from "preact/hooks";
import { t, useI18n } from "../../i18n";
import { tagIsDisplayed } from "../../tag-display";
import type { MediaFile, Settings } from "../../types";
import { HiddenTags, ICON } from "../../ui";
import { CustomTag } from "../list/CustomTag";
import { RowButton } from "../list/RowButton";

// The custom tags of a library row (docs/STYLEGUIDE.md, Part 1, 10.10): the
// sm RowButton "Edit custom tags: {title}", at most two CustomTags (an auto
// tag keeps its mark, explanation and dialog), then "+n" in tag form for
// the others, named and titled by their names as the tags read them
// (display name, else name). A hidden tag neither shows nor counts.
export function CustomTagsCell({
  file,
  settings,
  edit,
}: {
  file: MediaFile;
  settings: Settings | null;
  edit(): void;
}): JSX.Element {
  useI18n();
  const hidden = useContext(HiddenTags);
  const tags = (file.custom || []).filter((tag) =>
    tagIsDisplayed(hidden, "custom", String(tag.id)),
  );
  const rest = tags
    .slice(2)
    .map((tag) => tag.displayName || tag.name)
    .join(", ");
  return (
    <div class="v2-table-items">
      <RowButton
        label={t("Edit custom tags: {title}", { title: file.title })}
        icon={<TagIcon size={ICON.sort} />}
        size="sm"
        onClick={edit}
      />
      {tags.slice(0, 2).map((tag) => (
        <CustomTag key={tag.id} tag={tag} settings={settings} />
      ))}
      {rest && (
        <span class="v2-ctag" title={rest}>
          <span aria-hidden="true">+{tags.length - 2}</span>
          <span class="v2-sr-only">{rest}</span>
        </span>
      )}
    </div>
  );
}
