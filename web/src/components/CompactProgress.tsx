import { percent } from "../ui";
export function CompactProgress({
  status,
  value,
  label,
}: {
  status: string;
  value: number;
  label: string;
}) {
  if (!["queued", "running"].includes(status)) return <>—</>;
  return (
    <div class="compact-progress">
      <progress
        max={100}
        value={status === "queued" ? undefined : value}
        aria-label={label}
      />
      <span>{status === "queued" ? "—" : percent(value)}</span>
    </div>
  );
}
