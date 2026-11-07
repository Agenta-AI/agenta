# Design: Chinese (Simplified) in the web app

## Contract (fixed; every milestone builds on it)

- Package `@agenta/i18n` at `web/packages/agenta-i18n`.
- Catalogs: `web/packages/agenta-i18n/locales/<lang>/<namespace>.json`, `lang` in {`en`, `zh-CN`}. Flat JSON objects, string values only.
- Key in code: `"<namespace>.<rest>"`, for example `t("settings.members.inviteTitle")`. The first segment is the file name; the rest is the key inside that file (it may contain dots).
- Placeholders: `{{name}}` (i18next-compatible). Plurals: `"<key>_one"` / `"<key>_other"`, selected with `Intl.PluralRules` from a numeric `count` value. `zh-CN` needs only `"_other"`.
- Translation memory: `locales/.meta/zh-CN.json` = `{ "<full key>": "<sha256 of the English text at translation time>" }`. A plural `zh-CN` key hashes the English text of the same key, else the English `_other` form.
- Glossary: `glossary.zh-CN.json` = `{ "<English term>": { "zh": "<term or the same English>", "note": "<why>" } }`.
- Scripts: `scripts/check.ts` (parity and placeholders) and `scripts/translate.ts` (an LLM fills missing or changed `zh-CN` keys and writes `.meta`).

## Package layout

```text
web/packages/agenta-i18n/
  src/index.ts        richText, formatDate, formatNumber, TranslationKey, language atoms
  src/<namespace>.ts  t and useT for one namespace (@agenta/i18n/<namespace>)
  src/namespace.ts    defineNamespace: registers an English catalog, returns typed t and useT
  src/language.ts     languages, cookie, language atoms, zh-CN loaders, useLanguageSync,
                      languageInitScript (@agenta/i18n/language)
  src/catalogs.ts     the TranslationKey type and the English catalog registry
  src/translate.ts    lookup, plural choice, interpolation
  locales/en/*.json, locales/zh-CN/*.json, locales/.meta/zh-CN.json
```

M1 namespaces: `common`, `navigation`, `settings`, `billing`, `channels`, `publish`.

Code imports `t` and `useT` from the entry of the namespace it uses: `import {useT} from "@agenta/i18n/settings"`. Each entry bundles its own English catalog, so a page carries only the English text of the namespaces it imports. A single entry for all catalogs put the whole settings text (about 18 KB gzipped) on most pages, chat included, because the app shell, a confirm dialog that most pages use, the credit top-up dialog and the agent channels card all come from the settings area. So the text is split where other screens reach in:

- `common`: generic words (Cancel, Save, Delete, ...). Every entry bundles it, and every entry's `t` accepts its keys.
- `navigation`: the settings tab labels and scopes the app shell shows.
- `billing`, `channels`, `publish`: the parts of settings that chat and agent screens also render.
- `settings`: the rest. Its entry also bundles `billing`, `channels` and `publish` and accepts their keys, because the settings pages show all of them.

A new namespace adds one JSON file per language, one entry file, one line in `catalogs.ts` and one line in the `zh-CN` loader. Later areas follow the same rule: split a namespace where another screen imports a small part of it.

## Lookup

`translate(language, key, values)`: split the key at the first dot into namespace and rest. Look in the language's loaded catalogs, then in English, then return the key itself. With a numeric `values.count`, try `rest_<category>` (category from `Intl.PluralRules` for that catalog's language), then `rest_other`, then `rest`. Then replace `{{name}}` with `values[name]`; an unknown placeholder stays as written.

`TranslationKey` is built from the English JSON types: `"<namespace>.<key>"` with plural suffixes removed. A key that is not in the English catalog fails `tsc`.

## Language state

- `languageAtom`: the user's choice. A jotai `atomWithStorage` backed by the `agenta-language` cookie (`path=/`, one year, `samesite=lax`), read on init.
- `activeLanguageAtom`: the language whose catalogs are loaded and rendered. It starts as English on every render, so the server HTML and the first client render match.
- `useLanguageSync()`, mounted once in `AppProviders` (`LanguageSync`): after hydration, loads the chosen language with `import()`, then sets the active language and `<html lang>`.
- `useT()` (from a namespace entry) reads `activeLanguageAtom`, so components re-render on a change. The plain `t()` reads the active language at call time; use it in event handlers and non-React code.
- Labels defined at module load store the key and call `t()` at render.
- `detectBrowserLanguage()` maps `navigator.languages` to a supported language. It is not called until every screen is translated.

## No English flash

`/m` pages are prerendered, so the server cannot read the cookie per request. `_document` adds an inline script (same pattern as the theme script) that runs before paint: when the cookie names a non-English language, it sets `<html lang>` and the `data-i18n-pending` attribute, and a style hides the body while that attribute is present. `useLanguageSync` removes the attribute once the Chinese text has rendered. A 3-second timeout removes it too, so a failed load shows the English page instead of a blank one.

## Flag

`languagePickerEnabledAtom` in `@agenta/shared/state` is a per-user flag built with `userScopedFlagAtom`, like the other Preferences flags, but it has no switch row. The picker shows when the flag is on, or when the user has already chosen a language other than English (so they can switch back). To turn it on for testing, set `localStorage["agenta:settings:<user id>:language-picker"] = "true"`. Launch removes the gate.

## Bundle

The runtime is about 1.2 KB gzipped (jotai and React are already in the app). English text moves from component code into JSON; each namespace's catalog goes with the pages that import its entry. Each Chinese namespace is its own chunk, loaded only for Chinese users. A Chinese user loads every `zh-CN` namespace at start (about 20 KB gzipped today). When more areas move, load each `zh-CN` namespace when its entry is first used instead.

## Risks

- **Mixed language during the move.** The picker stays hidden until the main screens are done.
- **Text stored through the API.** Strings that are sent to the API and stored (for example a default name) stay English, so a stored value does not depend on who created it.
- **Dates.** dayjs `format` and `fromNow` calls still follow the dayjs locale (English). The areas move them to `formatDate` as they are translated.
- **Merge conflicts.** Each area moves in its own PR, right after a release is cut.
