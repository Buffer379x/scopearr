export function presentedTagLabel(
  field: string,
  value: string,
  labels: Record<string, string>,
): string {
  if (field.split(" ")[0] === "resolution" && value === "__sd__") return "SD";
  return labels[field.split(" ")[0] + ":" + value] || value;
}
