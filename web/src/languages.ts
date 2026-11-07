// Language lookups start from the bundled core (the ISO 639-1 languages plus
// mis, mul, und and zxx, written by web/scripts/language-core.mjs). The full
// registry is a chunk of its own: it loads when a value misses the core or a
// language list needs every entry, and subscribers then render again.
import core from "./language-core.json" with { type: "json" };
type Row = [string, string, string, string, string[], string[], string];
export type AudioLanguage = {
  id: string;
  iso1: string;
  name: string;
  canonical: string;
  flag: string | undefined;
  codes: string[];
  aliases: string[];
};
let languages: AudioLanguage[] = [];
let byAlias = new Map<string, AudioLanguage>();
function applyRows(rows: Row[]) {
  languages = rows.map(([id, iso1, name, canonical, codes, aliases, flag]) => ({
    id,
    iso1,
    name,
    canonical,
    flag: flag || undefined,
    codes,
    aliases: [canonical, ...codes, ...aliases],
  }));
  byAlias = new Map();
  for (const language of languages)
    for (const alias of language.aliases) {
      const key = alias.trim().toLowerCase();
      if (!byAlias.has(key)) byAlias.set(key, language);
    }
  for (const language of languages)
    for (const code of language.codes) byAlias.set(code, language);
}
applyRows(core as unknown as Row[]);

let loaded = false;
let loading: Promise<void> | undefined;
const listeners = new Set<() => void>();
// Loads the full registry once; a failed load may be retried by a later miss.
export function loadLanguageRegistry(): Promise<void> {
  loading ??= import("../../internal/langdata/registry.json", {
    with: { type: "json" },
  }).then(
    (module) => {
      applyRows(module.default as unknown as Row[]);
      loaded = true;
      for (const listener of [...listeners]) listener();
    },
    () => {
      loading = undefined;
    },
  );
  return loading;
}
export function languageRegistryLoaded() {
  return loaded;
}
export function onLanguageRegistry(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
// The languages known so far: the core, or the full registry once loaded.
export function audioLanguageList(): AudioLanguage[] {
  return languages;
}

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
function lookup(key: string) {
  const exact = byAlias.get(key);
  if (exact) return exact;
  const match =
    /^([a-z]{2,3})[-_](?:[a-z]{2}|[0-9]{3}|[a-z]{4})(?:[-_][a-z0-9]{5,8})*$/i.exec(
      key,
    );
  return match ? byAlias.get(match[1]) : undefined;
}
export function audioLanguage(value: string) {
  if (isUnknownAudioLanguage(value)) return undefined;
  const found = lookup(value.trim().toLowerCase());
  // A value outside the core may be in the full registry.
  if (!found && !loaded) void loadLanguageRegistry();
  return found?.id === "und" ? undefined : found;
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
