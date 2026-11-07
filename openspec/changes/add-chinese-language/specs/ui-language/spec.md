## ADDED Requirements

### Requirement: Text is looked up by key with English fallback

The web app SHALL render user-facing text through `t(key, values)` from an `@agenta/i18n` namespace entry (for example `@agenta/i18n/settings`). A key SHALL be `<namespace>.<rest>`. The lookup SHALL use the active language's catalog, then the English catalog, then return the key itself. `{{name}}` placeholders SHALL be replaced from `values`. With a numeric `count`, the plural form SHALL be chosen with `Intl.PluralRules` for the catalog's language.

#### Scenario: A translated key

- **WHEN** the active language is `zh-CN` and its catalog has the key
- **THEN** `t` returns the Chinese text with its placeholders filled

#### Scenario: A key with no Chinese text yet

- **WHEN** the active language is `zh-CN` and only the English catalog has the key
- **THEN** `t` returns the English text

#### Scenario: A plural

- **WHEN** `t("settings.members.count", {count: 1})` runs in English
- **THEN** it returns the `_one` form, and with `count` 5 it returns the `_other` form

#### Scenario: A wrong key

- **WHEN** code calls `t` with a key that is not in the English catalog
- **THEN** the type check fails

### Requirement: The user chooses the language

The system SHALL support `en` and `zh-CN`, with `en` as the default. The choice SHALL be stored in the `agenta-language` cookie. The Preferences page SHALL show a language picker with "English" and "中文 (Beta)" while the language picker flag is on, or while the stored choice is not English. The system SHALL NOT pick the language from the browser until every screen is translated.

#### Scenario: Flag off, no choice made

- **WHEN** a user with the flag off opens Preferences
- **THEN** no language picker shows and the app is in English

#### Scenario: Switch to Chinese

- **WHEN** a user with the flag on picks "中文 (Beta)"
- **THEN** the translated screens show Chinese, the screens not yet translated stay English, and `<html lang>` is `zh-CN`

#### Scenario: Reload in Chinese

- **WHEN** a user who chose Chinese reloads a page
- **THEN** the page does not show English text before the Chinese text

### Requirement: English users download no translations

English catalogs SHALL be bundled. A `zh-CN` catalog SHALL load with a dynamic import only when `zh-CN` is the chosen language. The runtime SHALL add no new runtime dependency.

#### Scenario: English user

- **WHEN** a user with no language cookie loads any page
- **THEN** no `zh-CN` catalog is requested

### Requirement: Chinese catalogs stay in step with English

Every `zh-CN` key SHALL exist in English with the same placeholders. `locales/.meta/zh-CN.json` SHALL hold the sha256 of the English text each Chinese string was translated from, so the translate script sends only new or changed strings.

#### Scenario: English text changes

- **WHEN** the English text of a key changes
- **THEN** its hash no longer matches the memory and the translate script translates it again
