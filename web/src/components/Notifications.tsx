import { ICON } from "../ui";
import {
  topmostDialog,
  trackNativeDialog,
  removeDialog,
} from "../dialog-stack";
import { useEffect, useRef, useState } from "preact/hooks";
import { createPortal } from "preact/compat";
import { Check, TriangleAlert, X } from "lucide-preact";
import { t, useI18n } from "../i18n";
import type { NotificationKind } from "../notifications";
type Item = {
  id: number;
  message: string;
  kind: NotificationKind;
  remaining: number;
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
    const observer = new MutationObserver(reconcile);
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
  useEffect(() => {
    const el = region.current;
    if (!popovers || !el?.isConnected) return;
    if (el.matches(":popover-open")) el.hidePopover();
    if (items.length) el.showPopover();
  }, [host, items]);
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
      class="toast-region"
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
