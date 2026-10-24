import { isSDResolution, SD_RESOLUTION } from "./resolution-groups";
import { decimalBytes } from "./units";
import { presentedTagLabel } from "./tag-labels";
import { getLocale, t, useI18n } from "./i18n";
import { colorStyle } from "./color";
import { tagDisplayKey, tagIsDisplayed } from "./tag-display";
import {
  cloneElement,
  createContext,
  type ComponentChildren,
  type VNode,
} from "preact";
import { createPortal } from "preact/compat";
import {
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "preact/hooks";
import type { Results } from "./types";
const translatedLabels = <T extends Record<string, string>>(values: T): T =>
  new Proxy(values, {
    get: (target, key: string) => (key in target ? t(target[key]) : undefined),
  });
export const labels: Record<string, string> = translatedLabels({
  share: "Shares",
  resolution: "Resolution",
  codec: "Codec / encoder",
  family: "Codec family",
  source: "Source",
  processing: "Processing",
  hdr: "HDR",
  bitDepth: "Bit depth",
  audio: "Audio codec",
  channels: "Channels",
  language: "Language",
  custom: "Custom",
});
export const tableColumns = [
  ["info", "Info"],
  ["title", "Title / episode"],
  ["year", "Year"],
  ["resolution", "Resolution"],
  ["codec", "Codec"],
  ["source", "Source"],
  ["processing", "Processing"],
  ["size", "Size"],
  ["hdr", "HDR"],
  ["bitDepth", "Bit depth"],
  ["audio", "Audio"],
  ["channels", "Channels"],
  ["custom", "Custom"],
];
export type ConnectionService = string;
export const embyMatchLabels: Record<string, string> = translatedLabels({
  conflicting: "Conflicting media server metadata",
  pending: "Awaiting media server matching",
  unmatched: "All unsuccessful matches",
  matched: "Matched with audio tracks",
  unconfigured: "Without media server enrichment",
  missing: "Not found in media server",
  missing_size: "File size missing for matching",
  ambiguous: "Ambiguous file or stream match",
  no_tracks: "Matched, audio tracks missing",
});
export type FilterOperator = "eq" | "not" | "all" | "notAll";
export const operatorLabels: Record<FilterOperator, string> = translatedLabels({
  eq: "is",
  not: "is not",
  all: "contains all",
  notAll: "does not contain all",
});
export const compoundFields = [
  "hdr",
  "audio",
  "language",
  "channels",
  "custom",
];
export type FilterUpdate = string[] | ((current: string[]) => string[]);
export const defaultColumnOrder = tableColumns.map(([field]) => field);
export const columnLabels = translatedLabels(Object.fromEntries(tableColumns));
export const defaultColumns = [
  "info",
  "title",
  "year",
  "resolution",
  "codec",
  "source",
  "processing",
  "custom",
];
export const emptyResults: Results = {
  files: [],
  total: 0,
  displayTotal: 0,
  page: 1,
  pageSize: 100,
};
export const count = (n: number) =>
  new Intl.NumberFormat(getLocale()).format(n);
export const bytes = (n: number) =>
  Number.isFinite(n) && n >= 0 ? decimalBytes(n, getLocale()) : "—";
export const compactBytes = (n: number) => decimalBytes(n, getLocale());
export const date = (s: string | null | undefined) =>
  s
    ? new Date(s).toLocaleString(getLocale(), {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : t("Not synced yet");
export const TagVisibility = createContext<Record<string, string[]> | null>(
  null,
);
export const TagLabels = createContext<Record<string, string>>({});
export const SDListGrouping = createContext(false);
export const TagInformation = createContext<Record<string, string[]>>({});
export const TagColors = createContext<Record<string, string>>({});
export const TagTextColors = createContext<Record<string, string>>({});
export const HiddenTags = createContext<Record<string, boolean>>({});
export const CustomTagNames = createContext<Record<string, string>>({});
export const colorFields = [
  "resolution",
  "codec",
  "source",
  "processing",
  "hdr",
  "bitDepth",
  "channels",
  "audio",
  "custom",
];
export const defaultColor = (field: string, value: string) =>
  field === "resolution"
    ? value === "2160p" || value === "4320p"
      ? "#b7a0e8"
      : value === "720p"
        ? "#a6c582"
        : "#85bce5"
    : (
        {
          codec: "#72c9a4",
          source: "#e4c16d",
          processing: "#d894b0",
          hdr: "#b7a0e8",
          audio: "#87bad3",
        } as Record<string, string>
      )[field] || "#b0bbc5";
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
  const sd =
    kind.split(" ")[0] === "resolution" &&
    (value === SD_RESOLUTION ||
      (respectHidden && groupSD && isSDResolution(value)));
  const renderedValue = sd ? SD_RESOLUTION : value;
  const information = useContext(TagInformation);
  const names = useContext(CustomTagNames);
  const inherited = useContext(TagColors);
  const inheritedText = useContext(TagTextColors);
  const hidden = useContext(HiddenTags);
  const key = tagDisplayKey(kind, renderedValue);
  if (
    respectHidden &&
    (!tagIsDisplayed(hidden, kind, value) ||
      !tagIsDisplayed(hidden, kind, renderedValue))
  )
    return null;
  const color =
    (colors || inherited)[key] ||
    (["bitDepth", "channels", "language"].includes(kind)
      ? defaultColor(kind, value)
      : undefined);
  const isTag =
    sd ||
    forceTag ||
    (!(information[kind.split(" ")[0]] || []).includes(value) &&
      (!visibility ||
        !Object.hasOwn(visibility, kind.split(" ")[0]) ||
        (visibility[kind.split(" ")[0]] || []).includes(
          value || "__unknown__",
        )));
  return (
    <span
      style={
        isTag
          ? colorStyle(color, (textColors || inheritedText)[key])
          : undefined
      }
      class={
        isTag ? "tag " + kind + (!value ? " unknown" : "") : "tag-info-only"
      }
      title={title || (sd && value !== SD_RESOLUTION ? value : undefined)}
    >
      {children ||
        (kind === "custom"
          ? names[value] || label || value || t("Unknown")
          : label ||
            presentedTagLabel(kind, renderedValue, tagLabels) ||
            t("Unknown"))}
    </span>
  );
}

export const defaultWarningColors: Record<string, string> = {
  metadata: "#d9a870",
  recognition: "#b994f0",
};

export const ICON = {
  chip: 12,
  sort: 13,
  label: 15,
  row: 15,
  button: 16,
  large: 18,
  close: 20,
  empty: 28,
} as const;

export const percent = (n: number) =>
  new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 }).format(n) +
  "\u202f%";

// A single trigger keeps its semantics and existing action; the tooltip adds
// description and pointer/keyboard access without an extra layout wrapper.
export function Tooltip({
  content,
  children,
}: {
  content: ComponentChildren;
  children: VNode<any>;
}) {
  const id = useId(),
    trigger = useRef<HTMLElement | null>(null),
    popup = useRef<HTMLDivElement>(null),
    timer = useRef<number>();
  const [open, setOpen] = useState(false),
    [position, setPosition] = useState({ left: 16, top: 0 }),
    [host, setHost] = useState<Element | null>(null);
  const close = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };
  const show = () => {
    setHost(trigger.current?.closest("dialog") || document.body);
    setOpen(true);
  };
  useLayoutEffect(() => {
    if (!open || !trigger.current || !popup.current) return;
    const r = trigger.current.getBoundingClientRect(),
      f = popup.current.getBoundingClientRect();
    setPosition({
      left: Math.max(16, Math.min(r.left, window.innerWidth - f.width - 16)),
      top: Math.max(
        16,
        r.bottom + 8 + f.height <= window.innerHeight - 16
          ? r.bottom + 8
          : r.top - f.height - 8,
      ),
    });
  }, [open, content]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      if (!trigger.current?.contains(e.target as Node)) close();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const props = children.props;
  return (
    <>
      {cloneElement(children, {
        ref: (el: HTMLElement | null) => {
          trigger.current = el;
          const ref = children.ref;
          if (typeof ref === "function") ref(el);
          else if (ref) ref.current = el;
        },
        "aria-describedby":
          [props["aria-describedby"], open ? id : null]
            .filter(Boolean)
            .join(" ") || undefined,
        onPointerEnter: (e: PointerEvent) => {
          props.onPointerEnter?.(e);
          if (e.pointerType !== "touch") {
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(show, 150);
          }
        },
        onPointerLeave: (e: PointerEvent) => {
          props.onPointerLeave?.(e);
          if (e.pointerType !== "touch") close();
        },
        onFocus: (e: FocusEvent) => {
          props.onFocus?.(e);
          if (trigger.current?.matches(":focus-visible")) show();
        },
        onBlur: (e: FocusEvent) => {
          props.onBlur?.(e);
          close();
        },
        onClick: (e: MouseEvent) => {
          if (window.matchMedia("(pointer: coarse)").matches) {
            e.stopPropagation();
            open ? close() : show();
          }
          props.onClick?.(e);
        },
      })}
      {open &&
        host &&
        createPortal(
          <div
            ref={popup}
            id={id}
            class="floating-surface tooltip"
            role="tooltip"
            style={position}
          >
            {content}
          </div>,
          host,
        )}
    </>
  );
}

export function SegmentedTabs({
  label,
  items,
  value,
  change,
  id: givenID,
}: {
  label: string;
  items: { value: string; label: ComponentChildren }[];
  value: string;
  change: (value: string) => void;
  id?: string;
}) {
  const generated = useId(),
    id = givenID || generated,
    ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      class="segmented"
      role="tablist"
      aria-label={label}
      onKeyDown={(e) => {
        const index = items.findIndex((item) => item.value === value);
        let next = index;
        if (e.key === "ArrowRight") next = (index + 1) % items.length;
        else if (e.key === "ArrowLeft")
          next = (index + items.length - 1) % items.length;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = items.length - 1;
        else return;
        e.preventDefault();
        change(items[next].value);
        const button =
          ref.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next];
        button?.focus();
        button?.scrollIntoView({ block: "nearest", inline: "nearest" });
      }}
    >
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          id={id + "-tab-" + item.value}
          aria-controls={id + "-panel-" + item.value}
          aria-selected={item.value === value}
          tabIndex={item.value === value ? 0 : -1}
          class={item.value === value ? "active" : ""}
          onClick={() => change(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function CardHeading({
  title,
  icon,
  actions,
  description,
}: {
  title: string;
  icon?: ComponentChildren;
  actions?: ComponentChildren;
  description?: ComponentChildren;
}) {
  return (
    <div class="card-intro">
      <div class="card-heading">
        <h3 class="card-title">
          {icon}
          {title}
        </h3>
        {actions && <div class="card-actions">{actions}</div>}
      </div>
      {description && <p class="quiet">{description}</p>}
    </div>
  );
}
