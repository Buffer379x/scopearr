import { ArrowDown, ArrowUp, Lock } from "lucide-preact";
import type { ComponentChildren, JSX } from "preact";
import { t, useI18n } from "../../i18n";
import { columnPreview } from "../../settings-model";
import { ICON } from "../../ui";

type OrderProps = {
  order: string[];
  visible: string[];
  labels: Record<string, string>;
  icons?: Record<string, ComponentChildren>;
  fixed?: string[];
  alwaysVisible?: string[];
  change(order: string[], visible: string[]): void;
};

// The column editor (docs/STYLEGUIDE.md, Part 1, 10.11, ruling R-G): the
// order list of one list beside the numbered preview of its visible
// header cells. No dragging: ↑/↓ work by keyboard and touch.
export function ColumnOrderEditor({
  list,
  ...props
}: OrderProps & { list: string }): JSX.Element {
  const shown = [
    ...props.visible,
    ...(props.alwaysVisible ?? []).filter(
      (key) => !props.visible.includes(key),
    ),
  ];
  return (
    <div class="v2-set-cols">
      <OrderList {...props} ariaPrefix={list} />
      <div class="v2-colprev">
        {columnPreview(props.order, shown, props.labels).map((cell) => (
          <span key={cell.key} class="v2-colprev-cell">
            <span class="v2-colprev-n">{cell.n}</span>
            {props.icons?.[cell.key]}
            {cell.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// The order list (also the dashboard widgets): per entry its checkbox
// "{list}: {name}", its symbol, its name, for a fixed entry the hint and
// the lock, and ↑/↓ "{list}: {name} · Move up|Move down", locked as in
// 1.7.0: a fixed entry neither moves nor lets another pass it, and an
// always visible one stays checked.
export function OrderList({
  order,
  visible,
  labels,
  icons,
  fixed = [],
  alwaysVisible = [],
  ariaPrefix,
  change,
}: OrderProps & { ariaPrefix: string }): JSX.Element {
  useI18n();
  return (
    <ol class="v2-order">
      {order.map((field, index) => {
        const always = alwaysVisible.includes(field);
        const locked = fixed.includes(field) || always;
        const name = ariaPrefix + ": " + labels[field];
        return (
          <li key={field} class="v2-order-item">
            <input
              type="checkbox"
              class="v2-check"
              aria-label={name}
              checked={always || visible.includes(field)}
              disabled={always}
              onChange={(e) =>
                change(
                  order,
                  e.currentTarget.checked
                    ? [...visible, field]
                    : visible.filter((key) => key !== field),
                )
              }
            />
            {icons?.[field]}
            <span class="v2-order-name">{labels[field]}</span>
            {locked && (
              <span class="v2-order-hint">
                {t(fixed.includes(field) ? "always first" : "always visible")}
              </span>
            )}
            {locked && (
              <Lock
                class="v2-order-lock"
                size={ICON.label}
                aria-hidden="true"
              />
            )}
            <span class="v2-order-move">
              {([-1, 1] as const).map((direction) => {
                const move = t(direction === -1 ? "Move up" : "Move down");
                return (
                  <button
                    key={direction}
                    type="button"
                    class="v2-icon-btn v2-icon-btn--sm"
                    aria-label={name + " · " + move}
                    title={move}
                    disabled={
                      fixed.includes(field) ||
                      index + direction < 0 ||
                      index + direction >= order.length ||
                      fixed.includes(order[index + direction])
                    }
                    onClick={() => {
                      const next = [...order];
                      [next[index], next[index + direction]] = [
                        next[index + direction],
                        next[index],
                      ];
                      change(next, visible);
                    }}
                  >
                    {direction === -1 ? (
                      <ArrowUp size={ICON.button} />
                    ) : (
                      <ArrowDown size={ICON.button} />
                    )}
                  </button>
                );
              })}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
