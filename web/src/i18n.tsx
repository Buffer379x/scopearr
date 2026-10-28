import { createContext, type ComponentChildren } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/hooks";
import { readPreference, writePreference } from "./browser-storage";
import {
  resolveLocale,
  translate,
  type Catalog,
  type Parameters,
} from "./i18n-core";
import fallback from "./locales/en.json";
import { notify } from "./notifications";
// Only names are eager; Vite tree-shakes catalog messages out of this glob.
const names = import.meta.glob<string>("./locales/*.json", {
  eager: true,
  import: "name",
});
const modules = import.meta.glob<Catalog>("./locales/*.json", {
  import: "default",
});
export const catalogs = Object.entries(names)
  .map(([path, name]) => ({
    locale: path.slice(path.lastIndexOf("/") + 1, -5),
    name,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));
const loaded = new Map<string, Catalog>([["en", fallback]]);
const loading = new Map<string, Promise<Catalog>>();
export async function loadLocale(locale: string): Promise<Catalog> {
  if (loaded.has(locale)) return loaded.get(locale)!;
  const load = modules[`./locales/${locale}.json`];
  if (!load) return fallback;
  if (!loading.has(locale)) {
    const pending = load()
      .then((catalog) => {
        loaded.set(locale, catalog);
        return catalog;
      })
      .finally(() => loading.delete(locale));
    loading.set(locale, pending);
  }
  return loading.get(locale)!;
}
export function prepareLocale(catalog: Catalog) {
  active = catalog;
}
let active: Catalog = fallback;
export const t = (key: string, parameters?: Parameters) =>
  translate(active, fallback, key, parameters);
export const getLocale = () => active.locale;
export function initialLocale() {
  const saved = readPreference("scopearr-language");
  return resolveLocale(
    saved ? [saved] : navigator.languages,
    catalogs.map((catalog) => catalog.locale),
  );
}
const Context = createContext({
  locale: "en",
  setLocale: (_locale: string) => {},
});
export function I18nProvider({ children }: { children: ComponentChildren }) {
  const [locale, updateLocale] = useState(() => active.locale);
  const selection = useRef(0);
  const setLocale = async (locale: string) => {
    const id = ++selection.current;
    try {
      const catalog = await loadLocale(locale);
      if (id !== selection.current) return;
      active = catalog;
      updateLocale(catalog.locale);
    } catch {
      notify(t("Request failed"), "error");
    }
  };
  useEffect(() => {
    document.documentElement.lang = active.locale;
    document.title = "Scopearr";
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute(
        "content",
        t("Your movie and TV library. Clearly filtered."),
      );
    writePreference("scopearr-language", locale);
  }, [locale]);
  return (
    <Context.Provider value={{ locale, setLocale }}>
      {children}
    </Context.Provider>
  );
}
export function useI18n() {
  return useContext(Context);
}
export function LanguageSelect({
  value,
  onChange,
}: { value?: string; onChange?: (locale: string) => void } = {}) {
  const { locale, setLocale } = useI18n();
  return (
    <label class="language-select">
      <span>{t("Interface language")}</span>
      <select
        aria-label={t("Interface language")}
        value={value ?? locale}
        onChange={(event) => (onChange ?? setLocale)(event.currentTarget.value)}
      >
        {catalogs.map((catalog) => (
          <option key={catalog.locale} value={catalog.locale}>
            {catalog.name}
          </option>
        ))}
      </select>
    </label>
  );
}
