import registry from "../../internal/langdata/registry.json" with { type: "json" };
type Row = [string, string, string, string, string[], string[], string];
const rows = registry as unknown as Row[];
export const audioLanguages = rows.map(
  ([id, iso1, name, canonical, codes, aliases, flag]) => ({
    id,
    iso1,
    name,
    canonical,
    flag: flag || undefined,
    codes,
    aliases: [canonical, ...codes, ...aliases],
  }),
);
const byAlias = new Map<string, (typeof audioLanguages)[number]>();
for (const language of audioLanguages)
  for (const alias of language.aliases) {
    const key = alias.trim().toLowerCase();
    if (!byAlias.has(key)) byAlias.set(key, language);
  }
for (const language of audioLanguages)
  for (const code of language.codes) byAlias.set(code, language);
export function isUnknownAudioLanguage(value: string) {
  return (
    [
      "",
      "__unknown__",
      "und",
      "unknown",
      "unknown language",
      "undetermined",
      "undefined",
      "n/a",
      "unbekannt",
      "desconocido",
      "sconosciuto",
    ].includes(value.trim().toLowerCase()) ||
    /^und[-_](?:[a-z]{2}|[0-9]{3}|[a-z]{4})$/i.test(value.trim())
  );
}
export function audioLanguage(value: string) {
  if (isUnknownAudioLanguage(value)) return undefined;
  const key = value.trim().toLowerCase();
  const exact = byAlias.get(key);
  if (exact) return exact.id === "und" ? undefined : exact;
  const match =
    /^([a-z]{2,3})[-_](?:[a-z]{2}|[0-9]{3}|[a-z]{4})(?:[-_][a-z0-9]{5,8})*$/i.exec(
      key,
    );
  const matched = match ? byAlias.get(match[1]) : undefined;
  return matched?.id === "und" ? undefined : matched;
}

const displayNames = new Map<string, Intl.DisplayNames>();
export function audioLanguageLabel(value: string, locale: string) {
  if (isUnknownAudioLanguage(value)) return "Unknown";
  const language = audioLanguage(value);
  if (!language) return value;
  try {
    let names = displayNames.get(locale);
    if (!names) {
      names = new Intl.DisplayNames([locale], {
        type: "language",
        fallback: "none",
      });
      displayNames.set(locale, names);
    }
    return names.of(language.iso1 || language.id) || language.name;
  } catch {
    return language.name;
  }
}
// A stored language list ("Deutsch, Englisch") in the interface language.
export function audioLanguageListLabel(
  value: string,
  locale: string,
  translate: (key: string) => string,
) {
  return value
    .split(/[,;/|]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => translate(audioLanguageLabel(part, locale)))
    .join(", ");
}
export function sameAudioLanguage(left: string, right: string) {
  return (
    left === right ||
    (!!audioLanguage(left) &&
      audioLanguage(left)?.id === audioLanguage(right)?.id)
  );
}
