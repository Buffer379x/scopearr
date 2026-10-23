import { useEffect, useRef, useState } from "preact/hooks";
import { t, useI18n } from "../i18n";
import type { FilterOperator } from "../ui";

const symbols = { eq: "=", not: "≠", all: "∧", notAll: "¬∧" };
export function OperatorButton({
  field,
  value,
  change,
  compound = false,
}: {
  field: string;
  value: FilterOperator;
  change: (value: FilterOperator) => void;
  compound?: boolean;
}) {
  useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const labels = compound
    ? {
        eq: t("contains at least one"),
        not: t("contains none"),
        all: t("contains all"),
        notAll: t("does not contain all"),
      }
    : {
        eq: t("is"),
        not: t("is not"),
        all: t("contains all"),
        notAll: t("does not contain all"),
      };
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("click", outside);
    return () => document.removeEventListener("click", outside);
  }, [open]);
  return (
    <div
      class="operator-control"
      ref={ref}
      onFocusOut={(e) => {
        if (!ref.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        type="button"
        ref={trigger}
        class={
          "operator-button icon-button" +
          (["not", "notAll"].includes(value) ? " negative" : "")
        }
        aria-label={field + ": " + labels[value]}
        aria-haspopup={compound ? "menu" : undefined}
        aria-expanded={compound ? open : undefined}
        onClick={() =>
          compound ? setOpen(!open) : change(value === "not" ? "eq" : "not")
        }
        title={field + ": " + labels[value]}
      >
        {symbols[value]}
        <span class="control-tooltip" role="tooltip">
          {labels[value]}
        </span>
      </button>
      {compound && open && (
        <div
          class="operator-menu"
          role="menu"
          aria-label={t("{field}: operator", { field })}
        >
          {(["eq", "not", "all", "notAll"] as FilterOperator[]).map((mode) => (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={value === mode}
              onClick={() => {
                change(mode);
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <span>{symbols[mode]}</span>
              {labels[mode]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
