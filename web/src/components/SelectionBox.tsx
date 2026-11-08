export function SelectionBox({
  count,
  total,
  label,
  disabled = false,
  className,
  change,
}: {
  count: number;
  total: number;
  label: string;
  disabled?: boolean;
  className?: string;
  change: (checked: boolean) => void;
}) {
  const mixed = count > 0 && count < total,
    checked = total > 0 && count >= total;
  return (
    <input
      type="checkbox"
      class={className}
      aria-label={label}
      aria-checked={mixed ? "mixed" : checked}
      checked={checked}
      disabled={disabled || !total}
      ref={(el) => {
        if (el) el.indeterminate = mixed;
      }}
      onChange={(e) => change(e.currentTarget.checked)}
    />
  );
}
