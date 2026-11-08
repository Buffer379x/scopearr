import type { JSX } from "preact";
import { useContext } from "preact/hooks";
import { t, useI18n } from "../../i18n";
import type { TrackFilterAction } from "../../library-filters";
import { TagLabels } from "../../ui";
import { Popover } from "../frame/Popover";
import { languageName, valueLabel } from "./TrackChip";

// The menu of a track chip (docs/STYLEGUIDE.md, Part 1, 10.10): a Popover
// menu "Filter by this track" with "Only {value}" per known part (a track's
// channels as the combination ||channels) and "{language} with {codec}
// (same track)". A choice returns focus to the chip, closes the menu and
// then filters.
export function TrackMenu({
  anchor,
  actions,
  choose,
  close,
}: {
  anchor: HTMLElement;
  actions: TrackFilterAction[];
  choose(action: TrackFilterAction): void;
  close(returnFocus: boolean): void;
}): JSX.Element {
  useI18n();
  const labels = useContext(TagLabels);
  return (
    <Popover
      anchor={anchor}
      placement="bottom-end"
      role="menu"
      label={t("Filter by this track")}
      close={close}
    >
      {actions.map((action, index) => (
        <button
          key={index}
          type="button"
          role="menuitem"
          class="v2-menu-item"
          onClick={() => {
            anchor.focus();
            close(true);
            choose(action);
          }}
        >
          <span class="v2-menu-text">
            {action.kind === "combo" && !action.channels
              ? t("{language} with {codec} (same track)", {
                  language: languageName(action.language),
                  codec: valueLabel("audio", action.codec, labels),
                })
              : t("Only {value}", {
                  value:
                    action.kind === "combo"
                      ? valueLabel("channels", action.channels ?? "", labels)
                      : action.kind === "language"
                        ? languageName(action.value)
                        : valueLabel(
                            action.kind === "codec" ? "audio" : "channels",
                            action.value,
                            labels,
                          ),
                })}
          </span>
        </button>
      ))}
    </Popover>
  );
}
