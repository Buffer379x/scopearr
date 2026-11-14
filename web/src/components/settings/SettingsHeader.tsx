import { Check, LoaderCircle } from "lucide-preact";
import type { JSX } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { t, useI18n } from "../../i18n";
import type { SettingsSectionId } from "../../router";
import { SECTION_META } from "../../settings-model";
import { ICON } from "../../ui";
import { Segmented } from "../list/Segmented";
import { PageHeader } from "../PageHeader";

type Save = {
  form?: string;
  action?(): void;
  busy: boolean;
  disabled: boolean;
  dirty: boolean;
};

// Save settings: a submit button of the settings form (`form`), else a
// button with the area's action; the check and, while saving, the spinner
// take one place, so its width stays; locked while saving and when the
// caller locks it. A plain function, not a component, so the header's
// actions hold the button itself.
function saveButton(
  save: Save,
  look: string,
  bind?: (button: HTMLButtonElement | null) => void,
): JSX.Element {
  return (
    <button
      ref={bind}
      type={save.form ? "submit" : "button"}
      form={save.form}
      class={"v2-btn " + look}
      disabled={save.disabled || save.busy}
      onClick={save.form ? undefined : () => save.action?.()}
    >
      <span class="v2-btn-icon" aria-hidden="true">
        {save.busy ? (
          <LoaderCircle class="v2-spin" size={ICON.button} />
        ) : (
          <Check size={ICON.button} />
        )}
      </span>
      {t("Save settings")}
    </button>
  );
}

// The band of a settings area (docs/STYLEGUIDE.md, Part 1, 10.11 and
// 11.4): the PageHeader with the area's name, its description as the
// summary (the full text as its title) and on the right the area's segment
// before Save settings, which the SaveDock repeats while it is out of view.
export function SettingsHeader({
  section,
  save,
  segment,
}: {
  section: SettingsSectionId;
  save?: Save;
  segment?: {
    label: string;
    idPrefix: string;
    value: string;
    items: { value: string; label: string; dirty?: boolean }[];
    select(value: string): void;
  };
}): JSX.Element {
  useI18n();
  const [button, setButton] = useState<HTMLButtonElement | null>(null);
  const meta = SECTION_META[section];
  const description = t(meta.description);
  return (
    <>
      <PageHeader
        title={t(meta.title)}
        meta={description}
        metaTitle={description}
        actions={
          <>
            {segment && (
              <Segmented
                label={segment.label}
                kind="tabs"
                onBand
                idPrefix={segment.idPrefix}
                value={segment.value}
                items={segment.items}
                select={segment.select}
              />
            )}
            {save && saveButton(save, "v2-btn--band-primary", setButton)}
          </>
        }
      />
      {save && <SaveDock target={button} save={save} />}
    </>
  );
}

// Save settings within reach on long pages (10.8, ruling R-D): only while
// the area has unsaved changes and its band button is out of view, the
// same button as a primary in a fixed dock, a portal into main (no
// transformed ancestor), so it moves nothing. When it goes while it holds
// focus (a save from the dock succeeded, or the band came back) and focus
// fell to the page, focus moves to the band's heading (the area's h1,
// focusable by script only), not to the body.
export function SaveDock({
  target,
  save,
}: {
  target: HTMLElement | null;
  save: Save;
}): JSX.Element | null {
  const [away, setAway] = useState(false);
  const held = useRef(false);
  // The band's button counts as out of view under the sticky glass topbar
  // too (T3-M3): the observed area starts below it, measured again on a
  // resize (its height and offset change at the phone threshold).
  useEffect(() => {
    if (!target) return;
    let observer: IntersectionObserver | undefined;
    const watch = () => {
      observer?.disconnect();
      const bar = document.querySelector<HTMLElement>(".v2-topbar");
      const covered = bar
        ? (parseFloat(getComputedStyle(bar).top) || 0) + bar.offsetHeight
        : 0;
      observer = new IntersectionObserver(
        ([entry]) => setAway(!entry.isIntersecting),
        { threshold: 0, rootMargin: `-${covered}px 0px 0px` },
      );
      observer.observe(target);
    };
    watch();
    addEventListener("resize", watch);
    return () => {
      removeEventListener("resize", watch);
      observer?.disconnect();
    };
  }, [target]);
  const main = save.dirty && away && document.getElementById("main");
  useLayoutEffect(() => {
    if (main || !held.current) return;
    held.current = false;
    const focused = document.activeElement;
    if (focused && focused !== document.body) return;
    const heading = target
      ?.closest(".v2-page-head")
      ?.querySelector<HTMLElement>(".v2-page-title");
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }, [!!main]);
  if (!main) return null;
  // Focus leaving for another element releases it; a disabled or removed
  // button drops it without a new target and keeps it.
  return createPortal(
    <div
      class="v2-save-dock"
      onFocusIn={() => (held.current = true)}
      onFocusOut={(event) => {
        if (event.relatedTarget) held.current = false;
      }}
    >
      {saveButton(save, "v2-btn--primary")}
    </div>,
    main,
  );
}
