# @agenta/i18n

Small translation package for `/m` and the `@agenta/*` packages. No i18next.

## Languages

`SUPPORTED_LANGUAGES` in `src/language.ts` is the one list: `en`, `zh-CN`, `ja-JP`, `es-ES`,
`pt-BR`, `de-DE`, `fr-FR`. The language atom, the cookie, `<html lang>`, `Intl` formatting and the
picker follow it. An unknown cookie value means English.

## Catalogs

- One catalog per screen or panel: `locales/<lang>/<namespace>.json`, flat `{key: text}`.
  The namespace is `<area>.<screen>`, for example `chat.composer`. No namespace may be a prefix
  of another namespace plus a dot.
- One entry file per catalog, `src/catalogs/<namespace>.ts`:

```ts
import en from "../../locales/en/settings.access.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("settings.access", en)
```

English is bundled with the screen. Other languages load from
`locales/<language>/<namespace>.json` through one loader module per language
(`src/languages/<language>.ts`), so a catalog adds no loader code to the page. The bundler
makes one chunk per other-language file. A language file that does not exist shows English.

- Import it as `@agenta/i18n/catalogs/<namespace>`.

## Text

- Keys are camelCase. Plurals use `key_one` and `key_other` with a numeric `count`.
- Placeholders are `{{name}}`. Rich text uses `<link>text</link>` with `richText()`.
- `useT(catalogA, catalogB)` in components; `createT(...)` at module level (name it `tNow` when the
  file also uses `useT`).
- Do not put `t` in hook dependency lists, and do not use a `t()` result as a check, id or key.
- Do not translate text that is saved to the API or sent to a third party.

## Tests

`pnpm test` in this folder.

## Scripts

- `pnpm i18n:check` checks every language against English: keys, plural forms, placeholders and tags.
  A language in `LANGUAGES_IN_PROGRESS` (`scripts/catalog.ts`) may miss whole catalog files; remove
  it from that list when its files are complete.
- `pnpm i18n:translate [--lang <lang>] [--namespace <name>] [--dry-run]` fills missing or changed
  keys with an LLM (`ANTHROPIC_API_KEY`). Style guides per language are in `scripts/translate.ts`;
  glossaries are `glossary.<lang>.json`.
