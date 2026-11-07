## ADDED Requirements

### Requirement: Placeholders and plurals

`{{name}}` placeholders SHALL be replaced from `values`. With a numeric `count`, the plural form SHALL be chosen with `Intl.PluralRules` for the language.

#### Scenario: A placeholder

- **WHEN** `t("settings.members.inviteSent", {email: "a@b.co"})` runs and the text is "Invite sent to {{email}}"
- **THEN** it returns "Invite sent to a@b.co"

#### Scenario: A plural in English

- **WHEN** `t("settings.members.count", {count: 1})` runs in English
- **THEN** it returns the `_one` form, and with `count` 5 it returns the `_other` form

### Requirement: Keys are checked

A key that is not in the English catalogs passed to `useT` or `createT` SHALL fail the type check.

#### Scenario: A wrong key

- **WHEN** code calls `t` with a key that is not in the English catalogs it was given
- **THEN** `tsc` fails

### Requirement: Text is looked up by key with English fallback

The web app SHALL render user-facing text through a `t(key, values)` that `useT` or `createT` from `@agenta/i18n` builds from the catalogs a module uses. A key SHALL be `<namespace>.<key>`, where the namespace is the catalog file name. The lookup SHALL use the active language's text, then English, then return the key itself.

#### Scenario: A translated key

- **WHEN** the active language is `zh-CN` and its catalog has the key
- **THEN** `t` returns the Chinese text with its placeholders filled

#### Scenario: A key with no Chinese text yet

- **WHEN** the active language is `zh-CN` and only the English catalog has the key
- **THEN** `t` returns the English text

### Requirement: The user chooses the language

The system SHALL support `en`, `zh-CN` and `ja-JP`, with `en` as the default. The choice SHALL be stored in the `agenta-language` cookie. The Preferences page SHALL show a language picker with "English", "中文 (Beta)" and "日本語 (Beta)" while the language picker flag is on, or while the stored choice is not English. The system SHALL NOT pick the language from the browser until every screen is translated.

#### Scenario: Flag off, no choice made

- **WHEN** a user with the flag off opens Preferences
- **THEN** no language picker shows and the app is in English

#### Scenario: Switch to Chinese

- **WHEN** a user with the flag on picks "中文 (Beta)"
- **THEN** the translated screens show Chinese, the screens not yet translated stay English, and `<html lang>` is `zh-CN`

#### Scenario: Switch to Japanese

- **WHEN** a user with the flag on picks "日本語 (Beta)"
- **THEN** the translated screens show Japanese and `<html lang>` is `ja`

#### Scenario: Reload in Chinese

- **WHEN** a user who chose Chinese reloads a page
- **THEN** the page does not show English text before the Chinese text

### Requirement: A page loads only the text of its screens

Catalogs SHALL be split per screen. A catalog's English and its translation in the chosen language SHALL load with a dynamic import when a module that uses the catalog is loaded. A translation in a language the user did not choose SHALL NOT load. The runtime SHALL add no new runtime dependency.

#### Scenario: English user

- **WHEN** a user with no language cookie loads any page
- **THEN** no `zh-CN` or `ja-JP` catalog is requested, and only the English catalogs of the screens on that page load

### Requirement: Translations stay in step with English

Every `zh-CN` and `ja-JP` key SHALL exist in English with the same placeholders. `locales/.meta/<lang>.json` SHALL hold the sha256 of the English text each translated string was made from, so the translate script sends only new or changed strings.

#### Scenario: English text changes

- **WHEN** the English text of a key changes
- **THEN** its hash no longer matches the memory and the translate script translates it again
