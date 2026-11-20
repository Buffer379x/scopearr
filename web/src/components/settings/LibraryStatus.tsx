import type { ComponentChildren, JSX } from "preact";
import { t } from "../../i18n";
import type { ServiceTexts, StatusKey } from "../../settings-model";
import type { ToolStatusView } from "../../tool-status";
import type { Status } from "../../types";
import { externalTagText } from "../ExternalTagStatus";
import { StatusValue } from "./ServiceStatus";

// A long status value on one line, cut with an ellipsis and whole in its
// title (ruling P4); screen readers read it whole. With a button at its
// end (v2-kv-line--act) the button moves below it where the column is
// narrow. An error reads in the error tone (1.7.0 class="error").
const line = (text: string, act?: JSX.Element, error = false) => (
  <span class={"v2-kv-line" + (act ? " v2-kv-line--act" : "")}>
    <span
      class={"v2-kv-long" + (error ? " v2-kv-long--error" : "")}
      title={text}
    >
      {text}
    </span>
    {act}
  </span>
);

// The status values of a library or media server (E9, docs/STYLEGUIDE.md,
// Part 1, 10.11), each one line, from its texts (serviceValues), once for
// its Services card and its System → Info block: the head tag with the
// last success in its title, Files, Next sync, for a library Realtime
// updates and External tags, and Tag synchronization with Review tag
// removals, which keeps its place, locked without an approval to give
// (ruling P4).
export function libraryStatus(
  texts: ServiceTexts,
  head: ToolStatusView,
  media: boolean,
  tags: NonNullable<Status["tagSync"]>[string] | undefined,
  review: () => void,
): Partial<Record<StatusKey, ComponentChildren>> {
  const values: Partial<Record<StatusKey, ComponentChildren>> = {
    status: (
      <StatusValue
        view={texts.last ? { ...head, long: head.long + texts.last } : head}
      />
    ),
    files: texts.files,
    next: texts.next,
  };
  if (!media) {
    values.webhook =
      texts.webhook === null
        ? t("Disabled")
        : line(texts.webhook, undefined, texts.webhookError);
    values.external = texts.external
      ? line(externalTagText(tags))
      : t("Disabled");
  }
  values.tags = line(
    texts.tags ?? t("Disabled"),
    <button
      type="button"
      class="v2-btn v2-btn--sm"
      disabled={!texts.review}
      onClick={review}
    >
      {t("Review tag removals")}
    </button>,
    texts.tagsError,
  );
  return values;
}
