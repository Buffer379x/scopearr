import { ArrowRight, Columns3 } from "lucide-preact";
import type { JSX } from "preact";
import { useRef, useState } from "preact/hooks";
import { api } from "../../api";
import { writeSessionPreference } from "../../browser-storage";
import { t, useI18n } from "../../i18n";
import { followLink } from "../../nav-link";
import type { NavTarget } from "../../router";
import { settingsPayload } from "../../settings-payload";
import type { Service, Settings } from "../../types";
import { columnLabels, ICON } from "../../ui";
import { Popover } from "../frame/Popover";
import { check } from "../settings/Check";

// The library's column menu (docs/STYLEGUIDE.md, Part 1, 10.5, rc.3 K1; the
// C+ "Spalten"): the page tool Columns3 "Columns" opens a Popover dialog
// with a checkbox per column of the list in its saved order (the title
// stays visible, as the backend requires, so it is not listed) and the link
// "Order under Display" to Settings › Display › Lists & columns on this
// list's tab. A change saves at once into the saved visibleColumns of the
// service, through PUT /api/settings as the Display settings save it; the
// box shows the change at once and, when the save fails, the saved state
// again (the request's error toast says why). Saves run one after another.
export function ColumnsMenu({
  service,
  settings,
  order,
  visible,
  saved,
  hrefOf,
  open,
}: {
  service: Service;
  settings: Settings | null;
  order: string[];
  visible: string[];
  saved(settings: Settings): void;
  hrefOf(target: NavTarget): string;
  open(target: NavTarget): void;
}): JSX.Element {
  useI18n();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  // The visible columns while saves run (null: the saved ones).
  const [shown, setShown] = useState<string[] | null>(null);
  const current = shown ?? visible;
  const latest = useRef(settings);
  latest.current = settings;
  const queue = useRef(Promise.resolve()),
    pending = useRef(0);
  const name = t("Columns");
  const target: NavTarget = {
    view: "settings",
    section: "appearance",
    tab: "lists",
  };
  const toggle = (field: string, on: boolean) => {
    const next = order.filter(
      (key) => key === "title" || (key === field ? on : current.includes(key)),
    );
    setShown(next);
    pending.current++;
    queue.current = queue.current.then(async () => {
      try {
        const base = latest.current;
        if (!base) throw new Error("Settings not loaded");
        await api("settings", "PUT", {
          ...settingsPayload({
            ...base,
            visibleColumns: { ...base.visibleColumns, [service]: next },
          }),
          tagApprovals: {},
        });
        const fresh = await api<Settings>("settings");
        latest.current = fresh;
        saved(fresh);
        if (--pending.current === 0) setShown(null);
      } catch {
        // The request's toast reports the failure; the boxes show the saved
        // columns again.
        pending.current--;
        setShown(null);
      }
    });
  };
  return (
    <>
      <button
        type="button"
        class="v2-icon-btn"
        aria-label={name}
        title={name}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        disabled={!settings}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
      >
        <Columns3 size={ICON.button} />
      </button>
      {anchor && (
        <Popover
          anchor={anchor}
          placement="bottom-end"
          role="dialog"
          label={name}
          close={() => setAnchor(null)}
        >
          <p class="v2-pop-title">{name}</p>
          <div class="v2-colmenu">
            {order
              .filter((field) => field !== "title")
              .map((field) =>
                check(
                  columnLabels[field],
                  current.includes(field),
                  (on) => toggle(field, on),
                  false,
                  field,
                ),
              )}
          </div>
          <div class="v2-pop-foot">
            <a
              class="v2-text-btn"
              href={hrefOf(target)}
              onClick={(event) =>
                followLink(event, () => {
                  writeSessionPreference("scopearr-columns-tab", service);
                  setAnchor(null);
                  open(target);
                })
              }
            >
              {t("Order under Display")}
              <ArrowRight size={ICON.label} aria-hidden="true" />
            </a>
          </div>
        </Popover>
      )}
    </>
  );
}
