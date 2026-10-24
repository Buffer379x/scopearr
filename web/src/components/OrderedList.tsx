import type { ComponentChildren } from "preact";
import { ArrowDown, ArrowUp } from "lucide-preact";
import { ICON } from "../ui";
import { t } from "../i18n";
export function OrderedList({
  order,
  visible,
  labels,
  icons,
  fixed = [],
  alwaysVisible = [],
  ariaPrefix,
  change,
}: {
  order: string[];
  visible: string[];
  labels: Record<string, string>;
  icons?: Record<string, ComponentChildren>;
  fixed?: string[];
  alwaysVisible?: string[];
  ariaPrefix: string;
  change: (order: string[], visible: string[]) => void;
}) {
  return (
    <div class="table-wrap">
      <table class="editor-table ordered-list">
        <thead>
          <tr>
            <th class="col-control" scope="col">
              <span class="sr-only">{t("Show")}</span>
            </th>
            <th scope="col">{t("Name")}</th>
            <th class="col-control" scope="col">
              <span class="sr-only">{t("Order")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {order.map((field, index) => (
            <tr key={field}>
              <td class="col-control">
                <input
                  type="checkbox"
                  aria-label={ariaPrefix + ": " + labels[field]}
                  checked={
                    alwaysVisible.includes(field) || visible.includes(field)
                  }
                  disabled={alwaysVisible.includes(field)}
                  onChange={(e) =>
                    change(
                      order,
                      e.currentTarget.checked
                        ? [...visible, field]
                        : visible.filter((k) => k !== field),
                    )
                  }
                />
              </td>
              <th scope="row">
                <span class="ordered-label">
                  {icons?.[field]}
                  {labels[field]}
                  {(fixed.includes(field) || alwaysVisible.includes(field)) && (
                    <em class="cell-hint">
                      {t(
                        fixed.includes(field)
                          ? "always first"
                          : "always visible",
                      )}
                    </em>
                  )}
                </span>
              </th>
              <td class="col-control">
                <div class="column-move-tools">
                  {([-1, 1] as const).map((direction) => (
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
                      title={t(direction === -1 ? "Move up" : "Move down")}
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
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
