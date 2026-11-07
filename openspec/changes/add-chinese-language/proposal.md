# Add Chinese (Simplified) to the web app

## Why

Every label in the web app (`web/mobile` and the `@agenta/*` packages) is written in English inside the components. Users in mainland China ask for a Chinese interface. Without a translation layer, no screen can show another language, and each later change adds more English text in code.

## What Changes

- **New: a small translation package, `@agenta/i18n`.** It gives `t(key, values)`, a `useT()` hook, `{{name}}` placeholders, plurals through the browser's `Intl.PluralRules`, a `richText` helper for a link or bold text inside a sentence, and `formatDate` / `formatNumber`. It is our own code, about 150 lines, with no new runtime dependency. i18next was considered and rejected: it adds about 26 KB gzipped for every user, and the app needs only lookup, placeholders and plurals. The keys and JSON files stay compatible with i18next, so a later switch is cheap.
- **New: text lives in JSON catalogs.** English is the source and is bundled. Chinese (`zh-CN`) loads on demand, only for users who chose it.
- **New: a language setting.** A picker in Preferences offers "English" and "中文 (Beta)". The choice is stored in a cookie. The picker stays hidden behind a per-user flag until the main screens are translated, so no user sees a half-translated app.
- **New: translation tooling.** A glossary of fixed product terms, a check script (same keys, same placeholders) and a translate script that sends only new or changed English strings to an LLM, with a hash of each English string as translation memory.
- **Text moves area by area.** Settings first, as the worked example. Then the shared UI kit, chat, agents and home, and the rest.
- **Later:** a lint rule against plain English text in JSX, and a GitHub Action that opens a PR with new Chinese text when English text changes.

## Decisions

- Own small layer, not i18next (speed of `/m` is a hard rule).
- The picker stays hidden until chat, agents, sessions, settings and onboarding are translated.
- Simplified Chinese only. Traditional Chinese is one more language entry and one script run when someone asks.
- An LLM writes the first Chinese text. A native speaker reviews the glossary first, then the main screens.

## Capabilities

### New Capabilities

- `ui-language`: the language choice, the catalogs, key lookup with English fallback, and how the page avoids showing English before Chinese.

## Impact

- **Web:** a new package `web/packages/agenta-i18n`; `@agenta/settings`, `@agenta/settings-ui` and `web/mobile` depend on it. `web/mobile` sets `<html lang>` and loads the chosen language in `_document` and `AppProviders`.
- **Speed:** English users download only the runtime (about 1.2 KB gzipped) plus the English text that was in the components before. Chinese users download one extra chunk per catalog after start.
- **Daily work:** new UI text goes into `locales/en/<namespace>.json` as a key. The translate script writes the Chinese text.
- **Out of scope:** `web/oss` and `web/ee` (abandoned), emails, API error messages, the docs.
