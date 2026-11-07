// Language lookups start from the bundled core (the ISO 639-1 languages plus
// mis, mul, und and zxx, written by web/scripts/language-core.mjs). The full
// registry is a chunk of its own: it loads when a value misses the core or a
// language list needs every entry, and subscribers then render again.
import core from "./language-core.json" with { type: "json" };
import { importLanguageRegistry } from "./language-registry.ts";
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
// After a failed load, no new attempt starts for 30 s; each further failure
// doubles the wait up to 8 minutes (30, 60, 120, 240, 480 s). A load only
// starts from a miss or a list that needs every entry, so an old tab or an
// offline browser does not request the chunk on every render.
const RETRY_FIRST_MS = 30_000;
const RETRY_MAX_MS = 480_000;
let retryDelay = 0;
let retryAt = 0;
// Loads the full registry once. During the wait after a failure it resolves
// without loading.
export function loadLanguageRegistry(): Promise<void> {
  if (!loading && !loaded && Date.now() >= retryAt) {
    const request = importLanguageRegistry();
    loading = request.then(
      (module) => {
        applyRows(module.default as Row[]);
        loaded = true;
        retryDelay = 0;
        for (const listener of [...listeners]) listener();
      },
      () => {
        loading = undefined;
        retryDelay = Math.min(retryDelay * 2 || RETRY_FIRST_MS, RETRY_MAX_MS);
        retryAt = Date.now() + retryDelay;
      },
    );
  }
  return loading ?? Promise.resolve();
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
  if (exact) return { language: exact, exact: true };
  const match =
    /^([a-z]{2,3})[-_](?:[a-z]{2}|[0-9]{3}|[a-z]{4})(?:[-_][a-z0-9]{5,8})*$/i.exec(
      key,
    );
  return { language: match ? byAlias.get(match[1]) : undefined, exact: false };
}
export function audioLanguage(value: string) {
  if (isUnknownAudioLanguage(value)) return undefined;
  const { language, exact } = lookup(value.trim().toLowerCase());
  // A value outside the core may be in the full registry, also one that only
  // the regional fallback finds: "oji-cree" is its own language there, not
  // "oji". Until the registry loads, the fallback answers.
  if (!exact && !loaded) void loadLanguageRegistry();
  return language?.id === "und" ? undefined : language;
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
