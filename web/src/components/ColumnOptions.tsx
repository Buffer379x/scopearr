import { ICON } from "../ui";
import { ArrowDown, ArrowUp, RotateCcw } from "lucide-preact";
import { t } from "../i18n";
export function ColumnOptions({
  order,
  visible,
  labels,
  fixed = [],
  alwaysVisible = [],
  ariaPrefix,
  onChange,
  onReset,
}: {
  order: string[];
  visible: string[];
  labels: Record<string, string>;
  fixed?: string[];
  alwaysVisible?: string[];
  ariaPrefix: string;
  onChange: (order: string[], visible: string[]) => void;
  onReset: () => void;
}) {
  return (
    <>
      <div class="column-options">
        {order.map((field, index) => (
          <div class="column-option" key={field}>
            <label class="check-field">
              <input
                type="checkbox"
                aria-label={ariaPrefix + ": " + labels[field]}
                checked={
                  alwaysVisible.includes(field) || visible.includes(field)
                }
                disabled={alwaysVisible.includes(field)}
                onChange={(e) =>
                  onChange(
                    order,
                    e.currentTarget.checked
                      ? [...visible, field]
                      : visible.filter((k) => k !== field),
                  )
                }
              />
              {labels[field]}
            </label>
            {!fixed.includes(field) && (
              <div class="column-move-tools">
                {([-1, 1] as const).map((direction) => {
                  const next = index + direction;
                  return (
                    <button
                      type="button"
                      class="icon-button"
                      aria-label={
                        ariaPrefix +
                        ": " +
                        labels[field] +
                        " · " +
                        t(direction === -1 ? "Move up" : "Move down")
                      }
                      title={t(
                        direction === -1
                          ? "Move column left"
                          : "Move column right",
                      )}
                      disabled={
                        next < 0 ||
                        next >= order.length ||
                        fixed.includes(order[next])
                      }
                      onClick={() => {
                        const copy = [...order];
                        [copy[index], copy[next]] = [copy[next], copy[index]];
                        onChange(copy, visible);
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
              </div>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        class="icon-button"
        aria-label={t("Restore defaults")}
        title={t("Restore defaults")}
        onClick={onReset}
      >
        <RotateCcw size={ICON.button} />
      </button>
    </>
  );
}
