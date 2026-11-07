## 1. M1 Foundation

- [x] 1.1 Create `@agenta/i18n`: `t`, `useT`, placeholders, plurals, `richText`, `formatDate`, `formatNumber`, typed keys
- [x] 1.2 Language atom stored in the `agenta-language` cookie; English bundled per screen, other languages loaded with `import()` per catalog; `detectBrowserLanguage` written but not called
- [x] 1.3 Unit tests in `tests/unit/`
- [x] 1.4 Per-user flag `languagePickerEnabledAtom`; language picker in the shared Preferences page
- [x] 1.5 `web/mobile`: `<html lang>` and a hidden page before paint from the cookie; `LanguageSync` in `AppProviders`
- [x] 1.6 Move every string in `agenta-settings-ui/src`, `mobile/src/features/settings` into small per-screen catalogs (see design)
- [x] 1.7 Write the `zh-CN` and `ja-JP` catalogs and `locales/.meta/<lang>.json`
- [x] 1.8 Smoke `/m`: English unchanged; with the flag on, settings in Chinese and in Japanese, other screens in English, no errors

## 2. M2 Translation tooling

- [ ] 2.1 `glossary.zh-CN.json` and `glossary.ja-JP.json` from public open-source translations of similar products
- [ ] 2.2 `scripts/check.ts`: same keys, same placeholders, complete plural families
- [ ] 2.3 `scripts/translate.ts`: send missing or changed keys with the glossary to the model; write `zh-CN` and `.meta`
- [ ] 2.4 Run the check in CI
- [ ] 2.5 A native speaker reviews the glossary

## 3. M3 Shared UI kit

- [ ] 3.1 Move `agenta-ui` text (buttons, dialogs, empty states, theme names) into a `common` or `ui` namespace
- [ ] 3.2 Run the translate script; review

## 4. M4 Chat

- [ ] 4.1 Move `agenta-chat`, `agenta-sessions-ui`, `mobile/src/features/chat` and `sessions`
- [ ] 4.2 Run the translate script; review

## 5. M5 Agents, home and onboarding

- [ ] 5.1 Move `features/agents`, `agenta-home-ui`, `agenta-navigation-ui`, onboarding and auth
- [ ] 5.2 Run the translate script; review

## 6. M6 Settings, rest

- [ ] 6.1 Move what M1 left in English: audit event type labels, member role names, the `@agenta/entities` messages that settings shows, dayjs dates in settings
- [ ] 6.2 Run the translate script; review

## 7. M7 The rest

- [ ] 7.1 `agenta-entity-ui` (2 or 3 PRs), observability, playground, automations, skills, annotation
- [ ] 7.2 Run the translate script; review

## 8. M8 Keep it up to date

- [ ] 8.1 Lint rule against plain English text in JSX: a warning first, an error per area once it is moved
- [ ] 8.2 GitHub Action: when English catalogs change on a release branch, run the translate script and open a PR

## 9. Launch

- [ ] 9.1 A native speaker reviews the main screens in Chinese
- [ ] 9.2 Remove the picker flag; "中文 (Beta)" shows in Preferences
- [ ] 9.3 When every area is moved, call `detectBrowserLanguage` for users with no stored choice
