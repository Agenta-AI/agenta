# Design: Chinese (Simplified) and Japanese in the web app

## Contract (every milestone builds on it)

- Package `@agenta/i18n` at `web/packages/agenta-i18n`.
- Catalogs: `web/packages/agenta-i18n/locales/<lang>/<namespace>.json`, `lang` in {`en`, `zh-CN`, `ja-JP`}. Flat JSON objects, string values only.
- A namespace is the file name and may contain dots (`settings.members`). Key in code: `"<namespace>.<key>"`, for example `t("settings.members.inviteTitle")` reads `inviteTitle` from `settings.members.json`. No namespace is a prefix of another one followed by a dot, so a key belongs to exactly one file.
- Placeholders: `{{name}}`. Plurals: `"<key>_one"` / `"<key>_other"`, selected with `Intl.PluralRules` from a numeric `count` value. `zh-CN` and `ja-JP` need only `"_other"`.
- Translation memory per language: `locales/.meta/<lang>.json` = `{ "<namespace>": { "<key>": "<sha256 of the English text at translation time>" } }`. A plural key hashes the English text of the same key, else the English `_other` form.
- Glossary per language: `glossary.<lang>.json`, a flat map from English term to the term in that language.
- Scripts: `scripts/check.ts` (parity and placeholders) and `scripts/translate.ts` (an LLM fills missing or changed keys and writes `.meta`). Both take `--lang`; without it they run every language folder except `en`.

## Package layout

```text
web/packages/agenta-i18n/
  src/index.ts            useT, createT, richText, formatDate, formatNumber, language atoms
  src/catalog.ts          defineCatalog, useT, createT, CatalogKey
  src/catalogs/<ns>.ts    one entry per catalog (@agenta/i18n/catalogs/<ns>)
  src/registry.ts         loaded catalogs, loadCatalog, loadLanguage, catalogVersionAtom
  src/language.ts         languages, cookie, language atoms, useLanguageSync (@agenta/i18n/language)
  src/document.ts         inline <head> script and style (@agenta/i18n/document)
  src/translate.ts        lookup, plural choice, interpolation
  locales/<lang>/*.json, locales/.meta/<lang>.json
```

A component names the catalogs it reads:

```ts
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import settingsMembersCatalog from "@agenta/i18n/catalogs/settings.members"

const t = useT(settingsMembersCatalog, commonCatalog)   // accepts keys of both
```

Code outside React uses `const t = createT(...)` at module level. A file that needs both names the module one `tNow`.

## Catalogs and loading

Catalogs are small and follow the screens: one per settings area or mobile tab (`settings.members`, `settings.membersTab`, `channels.connect`, `billing.topups`, ...), plus `common` (Cancel, Save, ...), `navigation` (the settings tab labels the app shell shows) and `publish`. A module imports only the catalogs whose keys it uses.

`defineCatalog(namespace, en, loaders)` takes the English as a static import, so a catalog's English ships in the same chunk as the screen that uses it and renders on the first paint, with no extra request for English users. It registers the catalog and, when the chosen language is not English, starts `import()` of that language at once, together with the screen's code. `t` returns `""` while the chosen language is still loading, so English does not flash first. Each finished load bumps `catalogVersionAtom`, and `useT` re-renders.

## Lookup

`translate(language, key, values, catalogs)`: find the catalog whose namespace starts the key, then look in that catalog's loaded language, then its English, then return the key itself. With a numeric `values.count`, try `<key>_<category>` (category from `Intl.PluralRules` for that language), then `<key>_other`, then `<key>`. Then replace `{{name}}` with `values[name]`; an unknown placeholder stays as written.

`useT` and `createT` are typed with the keys of the catalogs passed in, taken from the English JSON types. A key that is not in those catalogs fails `tsc`.

## Language state

- `languageAtom`: the user's choice. A jotai `atomWithStorage` backed by the `agenta-language` cookie (`path=/`, one year, `samesite=lax`), read on init.
- `activeLanguageAtom`: the language that is rendered. It starts as English on every render, so the first client render matches the prerendered HTML. `getActiveLanguage()` reads it from the default store, which `/m` passes to its `Provider`.
- `useLanguageSync()`, mounted once in `AppProviders` (`LanguageSync`): after hydration, loads the chosen language for every catalog imported so far, then sets the active language and `<html lang>` (`en`, `zh-CN`, `ja`). It sets the language only if no newer choice replaced the load.
- `formatDate` and `formatNumber` use `Intl` with the active language, and the browser locale when the language is English.
- Labels defined at module load store the key and call `t()` at render.
- `detectBrowserLanguage()` maps `navigator.languages` to a supported language. It is not called until every screen is translated.

## No English flash

`/m` pages are prerendered, so the server cannot read the cookie per request. `_document` adds an inline script (same pattern as the theme script) that runs before paint: when the cookie names a non-English language, it sets `<html lang>` and the `data-i18n-pending` attribute, and a style hides the body while that attribute is present. `useLanguageSync` removes the attribute once the translated text has rendered. A 3-second timeout removes it too, so a failed load shows the English page instead of a blank one. Embed routes skip the script, because they never mount `LanguageSync`.

## Flag

`languagePickerEnabledAtom` in `@agenta/shared/state` is a per-user flag built with `userScopedFlagAtom`, like the other Preferences flags, but it has no switch row. The picker shows when the flag is on, or when the user has already chosen a language other than English (so they can switch back). To turn it on for testing, set `localStorage["agenta:settings:<user id>:language-picker"] = "true"`. Launch removes the gate.

## Risks

- **Mixed language during the move.** The picker stays hidden until the main screens are done.
- **For a Chinese or Japanese user, a screen opened later shows its labels a moment after its code.** Its catalog loads as soon as the screen's code runs, in parallel with the screen's own data.
- **Text stored through the API.** Strings that are sent to the API and stored (for example a default name) stay English, so a stored value does not depend on who created it.
- **Dates.** dayjs `format` and `fromNow` calls still follow the dayjs locale (English). The areas move them to `formatDate` as they are translated.
- **Merge conflicts.** Each area moves in its own PR, right after a release is cut.
