export type Catalog = {
  locale: string;
  name: string;
  messages: Record<string, string>;
};
export type Parameters = Record<string, string | number>;
export function translate(
  catalog: Catalog,
  fallback: Catalog,
  key: string,
  parameters: Parameters = {},
) {
  const n = parameters.count;
  const category =
    typeof n === "number" && Number.isFinite(n)
      ? new Intl.PluralRules(catalog.locale).select(n)
      : undefined;
  const form = category ? key + "|" + category : key;
  const fallbackForm =
    typeof n === "number" && Number.isFinite(n)
      ? key + "|" + new Intl.PluralRules(fallback.locale).select(n)
      : key;
  const message =
    catalog.messages[form] ??
    catalog.messages[key] ??
    fallback.messages[fallbackForm] ??
    fallback.messages[key] ??
    key;
  return message.replace(/\{([a-zA-Z][\w]*)\}/g, (match, name: string) =>
    Object.hasOwn(parameters, name)
      ? name === "count" && typeof parameters[name] === "number"
        ? new Intl.NumberFormat(catalog.locale).format(parameters[name])
        : String(parameters[name])
      : match,
  );
}
export function resolveLocale(
  preferred: readonly string[],
  supported: readonly string[],
) {
  for (const preference of preferred) {
    const exact = supported.find(
      (locale) => locale.toLowerCase() === preference.toLowerCase(),
    );
    if (exact) return exact;
    const base = supported.find(
      (locale) =>
        locale.toLowerCase() === preference.toLowerCase().split("-")[0],
    );
    if (base) return base;
  }
  return "en";
}
