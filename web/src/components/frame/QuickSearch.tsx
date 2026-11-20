import { Search } from "lucide-preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { pushDialog, removeDialog } from "../../dialog-stack";
import { useTitleSearch } from "../../hooks/useTitleSearch";
import { t } from "../../i18n";
import { followLink, isSearchKey } from "../../nav-link";
import type { SearchOption } from "../../nav-model";
import type { NavTarget } from "../../router";
import { ICON } from "../../ui";
import { useOneOverlay } from "./Popover";
import { NAV_ICONS } from "./Sidebar";

const LIST = "v2-qs-list";
// A text's words in lower case. A page matches when every word of the
// query starts one of its words (name and context), as titles match.
const words = (text: string) => text.toLowerCase().split(/\s+/).filter(Boolean);
const matches = (page: SearchOption, query: string) => {
  const own = words(page.label + " " + page.meta);
  return words(query).every((term) => own.some((w) => w.startsWith(term)));
};

// Quick search (docs/STYLEGUIDE.md, Part 1, 10.9; E18, ruling R-C): a
// native modal dialog on the dialog stack, named "Quick search", one of the
// frame's overlays. The combobox filters the pages of the nav model and,
// from two letters on, finds titles (useTitleSearch); the listbox groups
// Pages, Movies and TV series. ↑/↓ move the active option (wrapping), the
// pointer too, and Enter or a click opens it: a page, or a title's library
// filtered by it. Escape and a press on the backdrop close it; focus
// returns to its anchor. Its size is fixed, so nothing moves when titles
// arrive.
export function QuickSearch({
  pages,
  hrefOf,
  open,
  close,
  anchor,
}: {
  pages: SearchOption[];
  hrefOf(target: NavTarget): string;
  open(target: NavTarget): void;
  close(): void;
  anchor: HTMLElement;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const { hits, busy } = useTitleSearch(query);
  const name = t("Quick search");
  const closer = useOneOverlay(close);
  useLayoutEffect(() => {
    const shown = dialog.current!;
    shown.showModal();
    pushDialog(shown, () => closer.current(false));
    return () => {
      shown.close();
      removeDialog(shown);
      // Focus returns to the anchor while it is shown; else (it went with a
      // resize to the phone layout) to the topbar's search, else the h1.
      const doc = shown.ownerDocument,
        visible = (el: HTMLElement | null) =>
          el?.isConnected && el.getClientRects().length ? el : null,
        h1 = doc.querySelector<HTMLElement>("h1");
      if (!visible(anchor) && h1 && !h1.hasAttribute("tabindex"))
        h1.setAttribute("tabindex", "-1");
      (
        visible(anchor) ??
        visible(doc.querySelector('[aria-keyshortcuts="Control+K Meta+K"]')) ??
        h1
      )?.focus({ preventScroll: true });
    };
  }, []);

  const groups: [string, SearchOption[]][] = [
    ["Pages", pages.filter((page) => matches(page, query))],
    ["Movies", hits.radarr],
    ["TV series", hits.sonarr],
  ];
  const options = groups.flatMap(([, list]) => list);
  const current = Math.min(active, options.length - 1);
  const id = (index: number) => LIST + "-" + index;
  useLayoutEffect(() => {
    if (current >= 0)
      dialog.current
        ?.querySelector("#" + id(current))
        ?.scrollIntoView({ block: "nearest" });
  }, [current]);
  const keydown = (event: KeyboardEvent) => {
    const step =
      event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    const chosen = options[current];
    if (step && chosen) {
      event.preventDefault();
      setActive((current + step + options.length) % options.length);
    } else if (event.key === "Enter" && chosen && !event.isComposing) {
      event.preventDefault();
      open(chosen.target);
      // ⌘K and Ctrl+K stay quick search's while it is open.
    } else if (isSearchKey(event)) event.preventDefault();
  };

  let index = 0;
  return (
    <dialog
      ref={dialog}
      class="v2-qs"
      aria-label={name}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div class="v2-qs-field">
        <Search size={ICON.button} aria-hidden="true" />
        <input
          class="v2-qs-input"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={LIST}
          aria-autocomplete="list"
          aria-activedescendant={current < 0 ? undefined : id(current)}
          aria-label={name}
          placeholder={t("Search pages, movies and TV series …")}
          autocomplete="off"
          spellcheck={false}
          value={query}
          onInput={(event) => {
            setQuery(event.currentTarget.value);
            setActive(0);
          }}
          onKeyDown={keydown}
        />
        <span
          class={"v2-dot " + (busy ? "v2-dot--running" : "v2-qs-idle")}
          aria-hidden="true"
        />
      </div>
      {!busy && !options.length && (
        <p class="v2-pop-text v2-qs-empty">{t("No matches.")}</p>
      )}
      <div
        class="v2-qs-list"
        id={LIST}
        role="listbox"
        aria-label={name}
        aria-busy={busy ? "true" : undefined}
      >
        {groups.map(
          ([label, list], group) =>
            !!list.length && (
              <div key={label} role="group" aria-labelledby={LIST + group}>
                <p class="v2-pop-title" id={LIST + group}>
                  {t(label)}
                </p>
                {list.map((option) => {
                  const at = index++;
                  const Icon = NAV_ICONS[option.icon ?? "dashboard"];
                  return (
                    <a
                      key={option.key}
                      id={id(at)}
                      role="option"
                      aria-selected={at === current}
                      class="v2-menu-item v2-menu-item--tile"
                      href={hrefOf(option.target)}
                      tabIndex={-1}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseMove={() => setActive(at)}
                      onClick={(event) =>
                        followLink(event, () => open(option.target))
                      }
                    >
                      <span
                        class={
                          "v2-tile" + (at === current ? " v2-tile--grad" : "")
                        }
                        aria-hidden="true"
                      >
                        <Icon size={ICON.button} />
                      </span>
                      <span class="v2-menu-text">{option.label}</span>
                      {option.meta && (
                        <span class="v2-qs-meta">{option.meta}</span>
                      )}
                    </a>
                  );
                })}
              </div>
            ),
        )}
      </div>
    </dialog>
  );
}
