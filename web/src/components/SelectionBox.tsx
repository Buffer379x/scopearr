export function SelectionBox({
  count,
  total,
  label,
  disabled = false,
  change,
}: {
  count: number;
  total: number;
  label: string;
  disabled?: boolean;
  change: (checked: boolean) => void;
}) {
  const mixed = count > 0 && count < total,
    checked = total > 0 && count >= total;
  return (
    <input
      type="checkbox"
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
