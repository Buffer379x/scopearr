export type FilterOption = { value: string; label: string; count?: number };
export type FilterChip = { key: string; label: string; remove: () => void };

export function filterChips(
  title: string,
  options: FilterOption[],
  selected: string[],
  remove: (value: string) => void,
): FilterChip[] {
  return options
    .filter((option) => selected.includes(option.value))
    .map((option) => ({
      key: title + ":" + option.value,
      label: title + ": " + option.label,
      remove: () => remove(option.value),
    }));
}
export function toggleFilter(
  values: string[],
  value: string,
  checked: boolean,
) {
  return checked
    ? [...new Set([...values, value])]
    : values.filter((v) => v !== value);
}
export function toolFilterQuery(q: string, fields: Record<string, string[]>) {
  const params = new URLSearchParams({ q });
  for (const [key, values] of Object.entries(fields))
    for (const value of values) params.append(key, value);
  return params;
}

export function canonicalToolPresetQuery(raw: string) {
  const q = new URLSearchParams(raw),
    out = new URLSearchParams();
  for (const name of [...new Set(q.keys())]
    .filter((k) => !["service", "sort", "dir", "page"].includes(k))
    .sort()) {
    const values =
      name === "q"
        ? [
            ...new Set(
              (q.get(name) || "").toLowerCase().split(/\s+/).filter(Boolean),
            ),
          ]
            .sort()
            .join(" ")
        : null;
    for (const value of values === null
      ? [...new Set(q.getAll(name))].sort()
      : [values])
      if (value) out.append(name, value);
  }
  return out.toString();
}
