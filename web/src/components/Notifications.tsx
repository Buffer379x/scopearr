import { ICON } from "../ui";
import {
  topmostDialog,
  trackNativeDialog,
  removeDialog,
} from "../dialog-stack";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { createPortal } from "preact/compat";
import { Check, TriangleAlert, X } from "lucide-preact";
import { t, useI18n } from "../i18n";
import {
  placeToasts,
  TOASTS_EVENT,
  type NotificationKind,
} from "../notifications";
import { openLog, type LogFilter } from "../event-log";
type Item = {
  id: number;
  message: string;
  kind: NotificationKind;
  remaining: number;
  log?: LogFilter;
};
function Toast({ item, dismiss }: { item: Item; dismiss: () => void }) {
  const started = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const hovering = useRef(false),
    focused = useRef(false);
  const resume = () => {
    if (hovering.current || focused.current || timer.current) return;
    started.current = Date.now();
    timer.current = setTimeout(dismiss, item.remaining);
  };
  const pause = () => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = undefined;
    item.remaining = Math.max(
      0,
      item.remaining - (Date.now() - started.current),
    );
  };
  useEffect(() => {
    resume();
    return pause;
  }, []);
  return (
    <div
      class={"toast toast-" + item.kind}
      role={item.kind === "error" ? "alert" : "status"}
      onMouseEnter={() => {
        hovering.current = true;
        pause();
      }}
      onMouseLeave={() => {
        hovering.current = false;
        resume();
      }}
      onFocusIn={() => {
        focused.current = true;
        pause();
      }}
      onFocusOut={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          focused.current = false;
          resume();
        }
      }}
    >
      {item.kind === "success" ? (
        <Check size={ICON.button} />
      ) : (
        <TriangleAlert size={ICON.button} />
      )}
      <span>{item.message}</span>
      {item.log && (
        <button
          type="button"
          class="text-button"
          onClick={() => {
            openLog(item.log);
            dismiss();
          }}
        >
          {t("Show in log")}
        </button>
      )}
      <button
        type="button"
        class="icon-button"
        onClick={dismiss}
        aria-label={t("Dismiss notification")}
        title={t("Dismiss notification")}
      >
        <X size={ICON.button} />
      </button>
    </div>
  );
}
export function Notifications() {
  useI18n();
  const [items, setItems] = useState<Item[]>([]);
  const next = useRef(0);
  const region = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement>(
    () => topmostDialog() ?? document.body,
  );
  const popovers = "showPopover" in HTMLElement.prototype;
  useEffect(() => {
    // Register unmanaged dialogs when their native open attribute changes.
    const observed = new Set<HTMLDialogElement>();
    const update = () => setHost(topmostDialog() ?? document.body);
    const reconcile = () => {
      for (const dialog of observed) {
        if (!dialog.open || !dialog.isConnected) {
          observed.delete(dialog);
          removeDialog(dialog);
        }
      }
      for (const dialog of document.querySelectorAll<HTMLDialogElement>(
        "dialog[open]",
      )) {
        observed.add(dialog);
        trackNativeDialog(dialog);
      }
      update();
    };
    // A change of the page moves what the shown toasts keep clear of
    // (placeToasts): Retry, a card head that mounts or unmounts.
    const observer = new MutationObserver(() => {
      reconcile();
      if (region.current?.firstElementChild) placeToasts();
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    window.addEventListener("scopearr-dialogs", update);
    reconcile();
    return () => {
      observer.disconnect();
      window.removeEventListener("scopearr-dialogs", update);
    };
  }, []);
  // Before paint: a new toast shows in the top layer and clear of an open
  // popover and the page's top controls in its first frame (the region is
  // laid out while closed too).
  useLayoutEffect(() => {
    const el = region.current;
    if (!el?.isConnected) return;
    if (popovers && el.matches(":popover-open")) el.hidePopover();
    if (popovers && items.length) el.showPopover();
    placeToasts();
    // An open popover places itself and them again (frame/Popover.tsx).
    window.dispatchEvent(new Event(TOASTS_EVENT));
  }, [host, items]);
  // While toasts show, a scroll (in any scroller) and a resize move what
  // they keep clear of.
  const showing = items.length > 0;
  useLayoutEffect(() => {
    if (!showing) return;
    const measure = () => placeToasts();
    const scroll = { capture: true, passive: true };
    window.addEventListener("scroll", measure, scroll);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, scroll);
      window.removeEventListener("resize", measure);
    };
  }, [showing]);
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      setItems((items) => {
        if (
          items.some(
            (item) =>
              item.message === detail.message && item.kind === detail.kind,
          )
        )
          return items;
        return [
          ...items.slice(-3),
          {
            ...detail,
            id: ++next.current,
            remaining: detail.kind === "success" ? 5000 : 8000,
          },
        ];
      });
    };
    window.addEventListener("scopearr-notification", receive);
    return () => window.removeEventListener("scopearr-notification", receive);
  }, []);
  return createPortal(
    <div
      ref={region}
      popover={popovers ? "manual" : undefined}
      class="toast-region v2-toasts"
      aria-label={t("Notifications")}
    >
      {items.map((item) => (
        <Toast
          key={item.id}
          item={item}
          dismiss={() =>
            setItems((items) => items.filter((value) => value.id !== item.id))
          }
        />
      ))}
    </div>,
    host,
  );
}
