# Add Chinese (Simplified) and Japanese to the web app

## Why

Every label in the web app (`web/mobile` and the `@agenta/*` packages) is written in English inside the components. Users in mainland China and in Japan ask for an interface in their language. Without a translation layer, no screen can show another language, and each later change adds more English text in code.

## What Changes

- **New: a small translation package, `@agenta/i18n`.** It gives `useT(...catalogs)` for components and `createT(...catalogs)` outside React, `{{name}}` placeholders, plurals through the browser's `Intl.PluralRules`, a `richText` helper for a link or bold text inside a sentence, and `formatDate` / `formatNumber`. It is our own code with no new runtime dependency. A full i18n library was considered and rejected: it adds about 26 KB gzipped for every user, and the app needs only lookup, placeholders and plurals.
- **New: text lives in small JSON catalogs, one per screen.** English ships with the screen that uses it and renders on the first paint. Chinese and Japanese load with `import()` per catalog, only for users who chose them.
- **New: a language setting.** A picker in Preferences offers "English", "中文 (Beta)" and "日本語 (Beta)". The choice is stored in a cookie. The picker stays hidden behind a per-user flag until the main screens are translated, so no user sees a half-translated app.
- **New: translation tooling.** A glossary of fixed product terms per language, a check script (same keys, same placeholders) and a translate script that sends only new or changed English strings to an LLM, with a hash of each English string as translation memory.
- **Text moves area by area.** Settings first, as the worked example. Then the shared UI kit, chat, agents and home, and the rest.
- **Later:** a lint rule against plain English text in JSX, and a GitHub Action that opens a PR with new translations when English text changes.

## Decisions

- Own small layer, not a full i18n library (speed of `/m` is a hard rule).
- Keys stay; catalogs are split per screen. English is bundled with its screen; other languages load lazily per catalog.
- The picker stays hidden until chat, agents, sessions, settings and onboarding are translated.
- Languages: English, Simplified Chinese (`zh-CN`) and Japanese (`ja-JP`). Traditional Chinese is one more language entry and one script run when someone asks.
- An LLM writes the first translations. A native speaker reviews each glossary first, then the main screens.

## Capabilities

### New Capabilities

- `ui-language`: the language choice, the catalogs, key lookup with English fallback, and how the page avoids showing English before the chosen language.

## Impact

- **Web:** a new package `web/packages/agenta-i18n`; `@agenta/settings`, `@agenta/settings-ui` and `web/mobile` depend on it. `web/mobile` sets `<html lang>` and loads the chosen language in `_document` and `AppProviders`.
- **Speed:** the app shell grows by about 0.8 KB gzipped (the language runtime). A page grows by the keys its code uses (the English text moves from the components into catalogs in the same chunks) and the small loaders of the other languages.
- **Daily work:** new UI text goes into `locales/en/<namespace>.json` as a key. The translate script writes the other languages.
- **Out of scope:** `web/oss` and `web/ee` (abandoned), emails, API error messages, the docs.
