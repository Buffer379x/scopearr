// Sort the visible, localized labels without changing canonical filter keys.
export function sortFilterValues(
  values: string[],
  label: (value: string) => string,
  locale: string,
): string[] {
  const collator = new Intl.Collator(locale, { sensitivity: "base" });
  const unknown = (value: string) => value === "" || value === "__unknown__";
  return [...new Set(values)].sort(
    (left, right) =>
      Number(unknown(left)) - Number(unknown(right)) ||
      collator.compare(label(left), label(right)) ||
      (left < right ? -1 : left > right ? 1 : 0),
  );
}
