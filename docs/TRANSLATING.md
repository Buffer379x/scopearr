# Translation guide

Scopearr keeps all interface text in `web/src/locales/<locale>.json`. English (`en.json`) is the source and fallback catalog. German, Spanish and Italian ship with the application. Catalogs are discovered automatically at build time by the frontend and embedded into Go for API messages and CSV headers.

## Add a language

1. Copy `en.json` to a new BCP 47 language filename, for example `fr.json`.
2. Set `locale` to the language tag and `name` to its native display name, for example `fr` and `Français`.
3. Translate the **values** in `messages`. Keep the English message keys unchanged: they are stable identifiers, not strings to translate.
4. Preserve named placeholders (`{field}`, `{count}`, etc.) and server format placeholders (`%d`, `%s`). You may reorder named placeholders to fit natural grammar. Do not add HTML or executable code; values are plain text rendered by Preact.
5. Run `pnpm --dir web test` and `pnpm --dir web build`, then `go test ./...`. Open login, settings, both libraries and dashboard; test mobile layout and keyboard tooltips.
6. Open a pull request with an English description. Include a version bump and release entry when contributing after a published version.

Example structure:

```json
{
  "locale": "fr",
  "name": "Français",
  "messages": {
    "Settings": "Paramètres",
    "Page {page} / {pages}": "Page {page} / {pages}"
  }
}
```

This excerpt is not a complete catalog; use the entire English file. No new components, backend switch statement or language-picker entries are required. Tests compare every discovered catalog with English and verify placeholder consistency. For development, missing entries fall back to English, but a shipped catalog must be complete.

## Language selection

Scopearr initially selects a supported browser language (including regional fallbacks such as `es-MX` → `es`), then English. The explicit choice is stored as `scopearr-language` in this browser. Login and Settings → Appearance both expose the selector. It does not change the account or other browsers. Numbers, dates and document language follow the selection; media titles and filenames remain original.

## Audio languages and flags

Audio language **values** are data, not interface translation keys. The backend’s existing normalized values remain unchanged, so old presets, facets and CSV content still refer to the same metadata. `web/src/languages.ts` maps display aliases to a translated language label and representative flag. `LanguageFlag.tsx` draws local SVGs; unknown/unmapped languages use a neutral icon with a tooltip. Flags do not establish a dialect or a media file’s origin.

To add an audio language label, add it to every catalog. To add a flag, extend the display-only alias registry and SVG definitions; never change stored values or infer languages from track titles.

## Maintain messages

Use complete sentences with named parameters rather than concatenating grammatical fragments. English message keys are stable: keep their wording unchanged when improving an English value. Add a new key only for a new message, then add it to every catalog. Public docs and release notes remain English. Preserve technical codec/source names and user-entered preset names. CSV headers use the interface language; media values retain their canonical form. API clients can use `Accept-Language`; CSV links additionally pass `lang` because download navigation cannot set that header.

Use the shared [interface wording glossary](STYLEGUIDE.md#wording). For numeric counts, add `|one` and `|other` forms and pass a numeric `count`; plural selection happens before localized number formatting. Legacy unsuffixed messages remain valid fallbacks.
